import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {SupabaseRestClient} from './lib/supabase-rest.mjs';

const station='2026-w39-seoul-singapore';
const keys=['wta-2026-w39-seoul','wta-2026-w39-singapore'];
const query={station_key:`eq.${station}`,season:'eq.2026',select:'event_key,station_key,season,metadata,transfer_window_opens_at,transfer_window_closes_at,transfer_window_note'};
export async function publishWindow(client){
 const rows=await client.select('tour_manager_events',query);
 assert.deepEqual(rows.map(r=>r.event_key).sort(),[...keys].sort());
 for(const row of rows){
  const event=JSON.parse(readFileSync(new URL(`../../data/manager/events/${row.event_key}.json`,import.meta.url)));
  assert.equal(event.transfer_window_opens_at,'2026-09-23T01:00:00+08:00');
  assert.equal(event.transfer_window_closes_at,'2026-09-23T13:00:00+08:00');
  assert.equal(event.cross_tour_transfer,true);
  const result=await client.update('tour_manager_events',{
   transfer_window_opens_at:event.transfer_window_opens_at,
   transfer_window_closes_at:event.transfer_window_closes_at,
   transfer_window_note:event.transfer_window_note,
   metadata:{...row.metadata,cross_tour_transfer:true}
  },{event_key:`eq.${row.event_key}`,station_key:`eq.${station}`,season:'eq.2026'});
  assert.equal(result.length,1);
 }
 const verified=await client.select('tour_manager_events',query);
 assert.equal(verified.length,2);
 for(const row of verified){
  assert.equal(Date.parse(row.transfer_window_opens_at),Date.parse('2026-09-23T01:00:00+08:00'));
  assert.equal(Date.parse(row.transfer_window_closes_at),Date.parse('2026-09-23T13:00:00+08:00'));
  assert.equal(row.metadata.cross_tour_transfer,true);
 }
 return verified.map(({metadata,...row})=>({...row,cross_tour_transfer:metadata.cross_tour_transfer}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 console.log(JSON.stringify(await publishWindow(new SupabaseRestClient()),null,2));
}
