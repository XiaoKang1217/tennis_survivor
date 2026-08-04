#!/usr/bin/env node
import { parseArgs } from './lib/manager-utils.mjs';
import { SupabaseRestClient } from './lib/supabase-rest.mjs';

const TARGET_DATE = '2026-08-04';
const STATION_KEY = '2026-w32-canada';
const EVENT_KEY = 'atp-2026-w32-montreal-national-bank-open';
const EXPIRED_MATCH_KEY = `${EVENT_KEY}:MS109`;
const REPLACEMENT_MATCH_KEY = `${EVENT_KEY}:MS074`;

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

const args = parseArgs();
const today = args.date || chinaDateKey();
if (today !== TARGET_DATE) {
  console.log(`Skipped Canada ATP prediction replacement: target=${TARGET_DATE} today=${today}`);
  process.exit(0);
}

const dryRun = Boolean(args['dry-run']) || !process.env.SUPABASE_SERVICE_ROLE_KEY;
if (dryRun) {
  console.log(`DRY RUN replace ${EXPIRED_MATCH_KEY} with ${REPLACEMENT_MATCH_KEY}`);
  process.exit(0);
}

const client = new SupabaseRestClient();
const games = await client.select('tour_manager_daily_prediction_games', {
  station_key: `eq.${STATION_KEY}`,
  season: 'eq.2026',
  contest_date: `eq.${TARGET_DATE}`,
  tour: 'eq.ATP',
  select: '*'
});

if (games.length !== 1) {
  throw new Error(`Expected one Canada ATP prediction for ${TARGET_DATE}, got ${games.length}`);
}

const game = games[0];
if (game.match_key === REPLACEMENT_MATCH_KEY) {
  console.log(`Canada ATP prediction already uses ${REPLACEMENT_MATCH_KEY}`);
  process.exit(0);
}
if (game.match_key !== EXPIRED_MATCH_KEY) {
  throw new Error(`Refusing to replace unexpected Canada ATP prediction ${game.match_key}`);
}
if (new Date(game.closes_at).getTime() > Date.now()) {
  throw new Error(`Refusing to replace a prediction that is still open until ${game.closes_at}`);
}

const matches = await client.select('tour_manager_matches', {
  event_key: `eq.${EVENT_KEY}`,
  match_key: `eq.${REPLACEMENT_MATCH_KEY}`,
  select: '*'
});
if (matches.length !== 1) {
  throw new Error(`Replacement ATP match not found: ${REPLACEMENT_MATCH_KEY}`);
}

const match = matches[0];
if (match.status !== 'scheduled' || !match.scheduled_at || new Date(match.scheduled_at).getTime() <= Date.now()) {
  throw new Error(`Replacement ATP match is no longer available: ${match.status} ${match.scheduled_at || ''}`);
}
if (!match.player1_key || !match.player2_key) {
  throw new Error('Replacement ATP match has unresolved players');
}

const players = await client.select('tour_manager_event_players', {
  event_key: `eq.${EVENT_KEY}`,
  select: 'player_key,name_zh,name_en,ranking'
});
const playerByKey = new Map(players.map((player) => [player.player_key, player]));
const player1 = playerByKey.get(match.player1_key);
const player2 = playerByKey.get(match.player2_key);
if (!Number.isInteger(player1?.ranking) || player1.ranking <= 0 || !Number.isInteger(player2?.ranking) || player2.ranking <= 0) {
  throw new Error('Replacement ATP match is missing valid player rankings');
}

const duplicate = await client.select('tour_manager_daily_prediction_games', {
  event_key: `eq.${EVENT_KEY}`,
  match_key: `eq.${REPLACEMENT_MATCH_KEY}`,
  select: 'id'
});
if (duplicate.length) {
  throw new Error(`Replacement ATP match was already used by prediction game ${duplicate[0].id}`);
}

const picks = await client.select('tour_manager_daily_prediction_picks', {
  game_id: `eq.${game.id}`,
  select: 'id'
});

// Old player choices cannot be mapped fairly to a different match. Clear them
// before changing the immutable question so every user must choose again.
if (picks.length) {
  await client.delete('tour_manager_daily_prediction_picks', { game_id: `eq.${game.id}` });
}

const replacement = {
  event_date: match.raw?.date || TARGET_DATE,
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
  selection_method: 'manual_replacement_expired_question_20260804',
  status: 'open',
  winner_key: null,
  winner_name: null,
  settled_at: null,
  updated_at: new Date().toISOString()
};
const updated = await client.update('tour_manager_daily_prediction_games', replacement, {
  id: `eq.${game.id}`,
  match_key: `eq.${EXPIRED_MATCH_KEY}`
});
if (updated.length !== 1 || updated[0].match_key !== REPLACEMENT_MATCH_KEY) {
  throw new Error('Canada ATP prediction replacement did not update exactly one game');
}

console.log(JSON.stringify({
  replaced: true,
  contest_date: TARGET_DATE,
  old_match_key: EXPIRED_MATCH_KEY,
  new_match_key: REPLACEMENT_MATCH_KEY,
  closes_at: match.scheduled_at,
  players: [replacement.player1_name, replacement.player2_name],
  cleared_old_picks: picks.length
}));
