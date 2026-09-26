import { readFile } from 'node:fs/promises';
import { SupabaseRestClient } from './manager/lib/supabase-rest.mjs';

const client = new SupabaseRestClient();
const source = JSON.parse(await readFile('data/daily_jinx_settlements.json', 'utf8'));
const counts = JSON.parse(await readFile('data/daily_jinx_pick_counts.json', 'utf8'));
async function all(table, select) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const rows = await client.select(table, {select, order: 'id.asc', limit: 500, offset});
    out.push(...rows);
    if (rows.length < 500) return out;
  }
}
const votes = await all('daily_jinx_votes', 'id,vote_date,tour,event_id,selected_players,created_at');
const ledger = await all('daily_jinx_score_ledger', 'id,vote_id,vote_date,tour,event_id,player_name,score');
const groups = new Map();
for (const vote of votes) {
  for (const player of vote.selected_players) {
    const snapshots = counts.snapshots.filter(s => s.date === vote.vote_date && s.tour === vote.tour && s.event_id === vote.event_id);
    const score = Number(snapshots[0]?.player_counts?.[player] || 0);
    if (!score) continue;
    const matches = source.settlements.filter(s => s.tour === vote.tour && s.event_id === vote.event_id && s.player_name === player && s.date > vote.vote_date && (Date.parse(s.date) - Date.parse(vote.vote_date)) <= 3 * 86400000 && Date.parse(vote.created_at) < Date.parse(s.match_start_at));
    const credited = ledger.filter(s => s.vote_id === vote.id && s.event_id === vote.event_id && s.player_name === player);
    if (!matches.length || credited.length) continue;
    const key = [vote.vote_date, vote.tour, vote.event_id, player].join('|');
    if (!groups.has(key)) groups.set(key, {vote_date: vote.vote_date, tour: vote.tour, event_id: vote.event_id, player, score, votes: 0, earliest: vote.created_at, latest: vote.created_at, matches});
    const group = groups.get(key);
    group.votes++;
    if (vote.created_at < group.earliest) group.earliest = vote.created_at;
    if (vote.created_at > group.latest) group.latest = vote.created_at;
  }
}
const recent = new Map();
for (const vote of votes.filter(v => v.vote_date >= '2026-09-20')) {
  for (const player of vote.selected_players) {
    const key = [vote.vote_date, vote.tour, vote.event_id, player].join('|');
    if (!recent.has(key)) recent.set(key, {key, votes: 0, credited: 0, score: 0, earliest: vote.created_at, latest: vote.created_at});
    const r = recent.get(key);
    r.votes++;
    const hits = ledger.filter(l => l.vote_id === vote.id && l.player_name === player);
    r.credited += hits.length;
    r.score += hits.reduce((n, l) => n + l.score, 0);
    if (vote.created_at < r.earliest) r.earliest = vote.created_at;
    if (vote.created_at > r.latest) r.latest = vote.created_at;
  }
}
console.log(JSON.stringify({vote_rows: votes.length, ledger_rows: ledger.length, recent: [...recent.values()], candidates: [...groups.values()]}, null, 2));
