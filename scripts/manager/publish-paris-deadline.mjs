import assert from 'node:assert/strict';
import { SupabaseRestClient } from './lib/supabase-rest.mjs';
const client = new SupabaseRestClient();
const station = '2026-w45-paris-hongkong';
const cutoff = '2026-11-02T14:00:00+08:00';
const keys = ['atp-2026-w45-paris', 'wta-2026-w45-hongkong'];
const query = {station_key:`eq.${station}`,season:'eq.2026',select:'event_key,submission_cutoff_at,submission_closes_at,metadata'};
const rows = await client.select('tour_manager_events', query);
assert.deepEqual(rows.map(r=>r.event_key).sort(), [...keys].sort());
for (const row of rows) {
  assert.ok([Date.parse('2026-11-02T11:00:00+08:00'), Date.parse(cutoff)].includes(Date.parse(row.submission_cutoff_at)));
}
// Update only submission windows and their display text; never touch prices or contracts.
for (const row of rows) {
  const result = await client.update('tour_manager_events', {
    submission_cutoff_at:cutoff, submission_closes_at:cutoff,
    metadata:{...row.metadata,market_message:(row.metadata?.market_message || '').replace('11/02 11:00','11/02 14:00')}
  }, {event_key:`eq.${row.event_key}`,station_key:`eq.${station}`,season:'eq.2026'});
  assert.equal(result.length,1);
}
const verified = await client.select('tour_manager_events',query);
assert.equal(verified.length,2);
for (const row of verified) {
  assert.equal(Date.parse(row.submission_cutoff_at),Date.parse(cutoff));
  assert.equal(Date.parse(row.submission_closes_at),Date.parse(cutoff));
}
console.log(JSON.stringify(verified,null,2));
