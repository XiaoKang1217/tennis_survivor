#!/usr/bin/env node
import { parseArgs } from './lib/manager-utils.mjs';
import { SupabaseRestClient } from './lib/supabase-rest.mjs';

const TARGET_DATE = '2026-08-25';
const STATION_KEY = '2026-w33-cincinnati';
const EVENT_KEY = 'wta-2026-w34-monterrey-monterrey-open';
const TOO_EARLY_MATCH_KEY = `${EVENT_KEY}:LS019`;
const REPLACEMENT_MATCH_KEY = `${EVENT_KEY}:LS014`;
const MIN_REPLACEMENT_LEAD_MINUTES = 120;

function chinaDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function positiveRanking(value) {
  const ranking = Number(value);
  return Number.isInteger(ranking) && ranking > 0 ? ranking : null;
}

async function latestRanking(client, tour, playerKey) {
  const rows = await client.select('tour_manager_ranking_snapshots', {
    tour: `eq.${tour}`,
    player_key: `eq.${playerKey}`,
    select: 'player_key,name_en,rank,ranking_date',
    order: 'ranking_date.desc',
    limit: '1'
  });
  const rank = positiveRanking(rows[0]?.rank);
  return rank ? { ...rows[0], ranking: rank } : null;
}

async function playerWithRanking(client, eventKey, playerKey) {
  const rows = await client.select('tour_manager_event_players', {
    event_key: `eq.${eventKey}`,
    player_key: `eq.${playerKey}`,
    select: 'player_key,name_zh,name_en,ranking'
  });
  const player = rows[0] || { player_key: playerKey };
  const ranking = positiveRanking(player.ranking);
  if (ranking) return { ...player, ranking };
  const snapshot = await latestRanking(client, 'WTA', playerKey);
  if (!snapshot) return { ...player, ranking: null };
  return {
    ...player,
    ranking: snapshot.ranking,
    name_en: player.name_en || snapshot.name_en || null
  };
}

const args = parseArgs();
const today = args.date || chinaDateKey();
if (today !== TARGET_DATE) {
  console.log(`Skipped Cincinnati WTA prediction replacement: target=${TARGET_DATE} today=${today}`);
  process.exit(0);
}

const dryRun = Boolean(args['dry-run']) || !process.env.SUPABASE_SERVICE_ROLE_KEY;
if (dryRun) {
  console.log(`DRY RUN replace ${TOO_EARLY_MATCH_KEY} with ${REPLACEMENT_MATCH_KEY}`);
  process.exit(0);
}

const client = new SupabaseRestClient();
const games = await client.select('tour_manager_daily_prediction_games', {
  station_key: `eq.${STATION_KEY}`,
  season: 'eq.2026',
  contest_date: `eq.${TARGET_DATE}`,
  tour: 'eq.WTA',
  select: '*'
});

if (games.length !== 1) {
  throw new Error(`Expected one Cincinnati WTA prediction for ${TARGET_DATE}, got ${games.length}`);
}

const game = games[0];
if (game.match_key === REPLACEMENT_MATCH_KEY) {
  console.log(`Cincinnati WTA prediction already uses ${REPLACEMENT_MATCH_KEY}`);
  process.exit(0);
}
if (game.match_key !== TOO_EARLY_MATCH_KEY) {
  throw new Error(`Refusing to replace unexpected Cincinnati WTA prediction ${game.match_key}`);
}
if (game.status !== 'open') {
  throw new Error(`Refusing to replace Cincinnati WTA prediction with status ${game.status}`);
}

const matches = await client.select('tour_manager_matches', {
  event_key: `eq.${EVENT_KEY}`,
  match_key: `eq.${REPLACEMENT_MATCH_KEY}`,
  select: '*'
});
if (matches.length !== 1) {
  throw new Error(`Replacement WTA match not found: ${REPLACEMENT_MATCH_KEY}`);
}

const match = matches[0];
if (match.raw?.date !== TARGET_DATE) {
  throw new Error(`Replacement WTA match has unexpected official date ${match.raw?.date || ''}`);
}
const minStart = Date.now() + MIN_REPLACEMENT_LEAD_MINUTES * 60000;
if (match.status !== 'scheduled' || !match.scheduled_at || new Date(match.scheduled_at).getTime() <= minStart) {
  throw new Error(`Replacement WTA match is too soon or unavailable: ${match.status} ${match.scheduled_at || ''}`);
}
if (!match.player1_key || !match.player2_key) {
  throw new Error('Replacement WTA match has unresolved players');
}

const [player1, player2] = await Promise.all([
  playerWithRanking(client, EVENT_KEY, match.player1_key),
  playerWithRanking(client, EVENT_KEY, match.player2_key)
]);
if (!positiveRanking(player1.ranking) || !positiveRanking(player2.ranking)) {
  throw new Error('Replacement WTA match is missing valid player rankings');
}

const duplicate = await client.select('tour_manager_daily_prediction_games', {
  event_key: `eq.${EVENT_KEY}`,
  match_key: `eq.${REPLACEMENT_MATCH_KEY}`,
  select: 'id'
});
if (duplicate.some((row) => row.id !== game.id)) {
  throw new Error(`Replacement WTA match was already used by prediction game ${duplicate[0].id}`);
}

const picks = await client.select('tour_manager_daily_prediction_picks', {
  game_id: `eq.${game.id}`,
  select: 'id'
});

// This manual replacement changes the matchup, so any old picks must choose
// again instead of being carried to unrelated players.
if (picks.length) {
  await client.delete('tour_manager_daily_prediction_picks', { game_id: `eq.${game.id}` });
}

const replacement = {
  event_date: TARGET_DATE,
  event_key: EVENT_KEY,
  match_key: REPLACEMENT_MATCH_KEY,
  scheduled_at: match.scheduled_at,
  closes_at: match.scheduled_at,
  player1_key: match.player1_key,
  player1_name: match.player1_name || player1.name_zh || player1.name_en,
  player1_ranking: player1.ranking,
  player2_key: match.player2_key,
  player2_name: match.player2_name || player2.name_zh || player2.name_en,
  player2_ranking: player2.ranking,
  ranking_gap: Math.abs(player1.ranking - player2.ranking),
  selection_method: 'manual_replacement_too_early_question_20260825',
  status: 'open',
  winner_key: null,
  winner_name: null,
  settled_at: null,
  updated_at: new Date().toISOString()
};
const updated = await client.update('tour_manager_daily_prediction_games', replacement, {
  id: `eq.${game.id}`,
  match_key: `eq.${TOO_EARLY_MATCH_KEY}`,
  status: 'eq.open'
});
if (updated.length !== 1 || updated[0].match_key !== REPLACEMENT_MATCH_KEY) {
  throw new Error('Cincinnati WTA prediction replacement did not update exactly one game');
}

console.log(JSON.stringify({
  replaced: true,
  contest_date: TARGET_DATE,
  old_match_key: TOO_EARLY_MATCH_KEY,
  new_match_key: REPLACEMENT_MATCH_KEY,
  closes_at: match.scheduled_at,
  players: [replacement.player1_name, replacement.player2_name],
  rankings: [replacement.player1_ranking, replacement.player2_ranking],
  ranking_gap: replacement.ranking_gap,
  cleared_old_picks: picks.length
}));
