import { readFile, writeFile } from 'node:fs/promises';
import { loadActiveStation, buildStationPayload } from './lib/station-payload.mjs';
const {active,events}=await loadActiveStation();
if(active.station_key!=='2026-w46-wta-finals')throw new Error('Wrong station');
const photos=JSON.parse(await readFile('data/manager/player_photos.json','utf8'));
const payload=buildStationPayload({active,events,photoMap:photos.players||{}});
const quote=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
let seed='-- Generated from the reviewed Finals configuration; does not change existing contracts or balances.\nbegin;\n';
for(const [table,rows,keys] of [
 ['tour_manager_station_configs',[payload.stationConfigRow],['station_key','season']],
 ['tour_manager_events',payload.eventRows,['event_key']],
 ['tour_manager_players',payload.playerRows,['tour','player_key']],
 ['tour_manager_event_players',payload.eventPlayerRows,['event_key','player_key']],
 ['tour_manager_draw_entries',payload.drawRows,['event_key','draw_version','draw_position']]
]){
 const cols=Object.keys(rows[0]);
 seed+=`insert into public.${table}(${cols.join(',')})\nselect ${cols.join(',')} from jsonb_populate_recordset(null::public.${table},${quote(rows)})\non conflict(${keys.join(',')}) do update set ${cols.filter(c=>!keys.includes(c)).map(c=>`${c}=excluded.${c}`).join(',')};\n`;
}
seed+='commit;\n';
await writeFile('supabase/migrations/202611070004_manager_finals_station.sql',seed);
const names=['economy','submission','runtime','station'];
const parts=await Promise.all(names.map((name,i)=>readFile(`supabase/migrations/20261107000${i+1}_manager_finals_${name}.sql`,'utf8')));
// One atomic transaction in the standalone handoff document, even on first install.
const combined='-- WTA Finals 2026: execute the whole document once in Supabase SQL Editor.\n-- Idempotent; existing wallets and historical results are not rewritten.\nbegin;\n'
 +parts.map(s=>s.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')).join('\n')+'\ncommit;\n';
await writeFile('docs/20261107-wta-finals-release.sql',combined);
console.log('Wrote standalone SQL and station migration.');
