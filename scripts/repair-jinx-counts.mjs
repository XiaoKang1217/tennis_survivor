import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { SupabaseRestClient } from './manager/lib/supabase-rest.mjs';

const apply = process.argv.includes('--apply');
const client = new SupabaseRestClient();
const source = JSON.parse(await readFile('data/daily_jinx_settlements.json', 'utf8'));
const {corrections} = JSON.parse(await readFile('data/daily_jinx_count_corrections.json', 'utf8'));
const snapshots = JSON.parse(await readFile('data/daily_jinx_pick_counts.json', 'utf8')).snapshots;
const rowKey = r => [r.date, r.tour, r.event_id, r.match_id, r.player_name].join('|');
const dates = [...new Set(corrections.map(r => r.date))].sort();
const correctionMap = new Map(corrections.map(r => [rowKey(r), r]));
assert.equal(correctionMap.size, corrections.length, 'Duplicate corrections');
for (const c of corrections) {
  assert.ok(Number.isSafeInteger(c.pick_count) && c.pick_count > 0);
  const snapshot = snapshots.find(s => s.date === c.snapshot_date && s.tour === c.tour && s.event_id === c.event_id && Number(s.today_day) === c.official_day);
  assert.equal(snapshot?.player_counts[c.player_name], c.pick_count, 'Snapshot evidence mismatch');
  const rows = source.settlements.filter(r => rowKey(r) === rowKey(c));
  assert.equal(rows.length, 1, 'Settlement must resolve uniquely');
  assert.ok(rows[0].pick_count === 0 || rows[0].pick_count === c.pick_count, 'Do not overwrite another positive score');
}
source.settlements = source.settlements.map(r => correctionMap.has(rowKey(r)) ? {...r, pick_count: correctionMap.get(rowKey(r)).pick_count, pick_count_official_day: correctionMap.get(rowKey(r)).official_day} : r);
async function all(table, select) {
  const out = [];
  for (let offset = 0;;offset += 500) {
    const rows = await client.select(table, {select, vote_date:`in.(${dates.join(',')})`, order:'id.asc', limit:500, offset});
    out.push(...rows);
    if (rows.length < 500) return out;
  }
}
const votes = await all('daily_jinx_votes', 'id,vote_date,tour,event_id,selected_players,created_at');
const before = await all('daily_jinx_score_ledger', 'id,vote_id,vote_date,tour,event_id,player_name,score');
const hitKey = (voteId, r) => [voteId, r.tour, r.event_id, r.player_name].join('|');
const expected = new Map();
const reports = [];
for (const s of source.settlements.filter(r => dates.includes(r.date) && r.pick_count > 0 && r.match_start_at)) {
  const hits = votes.filter(v => v.vote_date === s.date && v.tour === s.tour && v.event_id === s.event_id && v.selected_players.includes(s.player_name) && Date.parse(v.created_at) < Date.parse(s.match_start_at));
  for (const v of hits) {
    const key = hitKey(v.id, s);
    assert.ok(!expected.has(key), 'Ambiguous duplicate match hit');
    expected.set(key, s.pick_count);
  }
  if (correctionMap.has(rowKey(s)) && hits.length) {
    reports.push({date:s.date, tour:s.tour, event:s.event_name, player:s.player_name, score_each:s.pick_count, valid_votes:hits.length, total_points:hits.length*s.pick_count});
  }
}
// Rebuilding affected dates must preserve every previously awarded hit exactly.
for (const hit of before) assert.equal(expected.get(hitKey(hit.vote_id, hit)), hit.score, 'Repair would remove/change an existing score');
console.log(JSON.stringify({mode:apply?'apply':'audit', checked_corrections:corrections.length, existing_hits:before.length, expected_hits:expected.size, new_hits:expected.size-before.length, total_new_points:[...expected.values()].reduce((a,b)=>a+b,0)-before.reduce((a,b)=>a+b.score,0), reports},null,2));
if (apply) {
  source.refreshed_dates = dates;
  await writeFile('data/daily_jinx_settlements.json', JSON.stringify(source));
  execFileSync(process.execPath, ['scripts/update_daily_jinx_leaderboard.mjs'], {stdio:'inherit'});
  const after = await all('daily_jinx_score_ledger', 'id,vote_id,vote_date,tour,event_id,player_name,score');
  assert.equal(after.length, expected.size, 'Ledger count mismatch after repair');
  for (const hit of after) assert.equal(expected.get(hitKey(hit.vote_id,hit)),hit.score,'Ledger score mismatch');
  console.log('VERIFIED: every affected ledger row matches; all previous scores preserved.');
}
