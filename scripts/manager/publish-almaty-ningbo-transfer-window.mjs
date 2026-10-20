import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {SupabaseRestClient} from './lib/supabase-rest.mjs';

export const station = '2026-w43-almaty-ningbo';
export const keys = ['atp-2026-w43-almaty', 'wta-2026-w43-ningbo'];
export const opens = '2026-10-20T23:00:00+08:00';
export const closes = '2026-10-21T13:00:00+08:00';
export async function publishWindow(client) {
  const query = {station_key:`eq.${station}`,season:'eq.2026',select:'event_key,station_key,season,metadata,transfer_window_opens_at,transfer_window_closes_at,transfer_window_note'};
  const rows = await client.select('tour_manager_events', query);
  assert.deepEqual(rows.map(r => r.event_key).sort(), [...keys].sort());
  const patches = rows.map(row => {
    const event = JSON.parse(readFileSync(new URL(`../../data/manager/events/${row.event_key}.json`, import.meta.url)));
    assert.equal(event.transfer_window_opens_at, opens);
    assert.equal(event.transfer_window_closes_at, closes);
    assert.equal(event.cross_tour_transfer, true);
    assert.equal(event.manual_schedule_windows, true);
    return {row, values:{
      transfer_window_opens_at:opens,
      transfer_window_closes_at:closes,
      transfer_window_note:event.transfer_window_note,
      metadata:{...row.metadata,cross_tour_transfer:true}
    }};
  });
  for (const {row, values} of patches) {
    const result = await client.update('tour_manager_events', values, {event_key:`eq.${row.event_key}`,station_key:`eq.${station}`,season:'eq.2026'});
    assert.equal(result.length, 1);
  }
  const verified = await client.select('tour_manager_events', query);
  assert.equal(verified.length, 2);
  for (const row of verified) {
    assert.equal(Date.parse(row.transfer_window_opens_at), Date.parse(opens));
    assert.equal(Date.parse(row.transfer_window_closes_at), Date.parse(closes));
    assert.equal(row.metadata.cross_tour_transfer, true);
  }
  return verified.map(({metadata,...row}) => ({...row,cross_tour_transfer:metadata.cross_tour_transfer}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await publishWindow(new SupabaseRestClient()), null, 2));
}
