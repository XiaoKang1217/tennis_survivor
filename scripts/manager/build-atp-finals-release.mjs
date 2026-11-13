import fs from 'node:fs';
import {loadActiveStation,buildStationPayload} from './lib/station-payload.mjs';
const {active,events}=await loadActiveStation();
if(active.station_key!=='2026-w47-atp-finals')throw Error('Wrong station');
let sql=`begin;
do $patch$
declare r record; d text;
begin
 for r in select oid from pg_proc where pronamespace='public'::regnamespace and proname in
 ('tour_manager_submit_finals_lineup','tour_manager_settle_finals','tour_manager_submit_lineup','tour_manager_settle_completed_matches','tour_manager_station_rules','tour_manager_get_my_state') loop
 d:=pg_get_functiondef(r.oid);
 d:=regexp_replace(d,'p_station_key\\s*<>\\s*''2026-w46-wta-finals''','p_station_key not in (''2026-w46-wta-finals'',''2026-w47-atp-finals'')','g');
 d:=regexp_replace(d,'p_station_key\\s*=\\s*''2026-w46-wta-finals''','p_station_key in (''2026-w46-wta-finals'',''2026-w47-atp-finals'')','g');
 execute d;
 end loop;
end;
$patch$;
insert into public.tour_manager_finals_eligibility(season,station_key,user_id) values
${active.rules.finals.top8_user_ids.map(id=>`(2026,'${active.station_key}','${id}'::uuid)`).join(',\n')}
on conflict do nothing;
drop index if exists public.tour_manager_prediction_group_once_idx;
alter table public.tour_manager_daily_prediction_games drop column selection_group;
alter table public.tour_manager_daily_prediction_games add column selection_group text generated always as (
 case when station_key='2026-w39-seoul-singapore' then event_key
 when station_key in ('2026-w46-wta-finals','2026-w47-atp-finals') then tour||':'||game_slot::text else tour end) stored;
create unique index tour_manager_prediction_group_once_idx on public.tour_manager_daily_prediction_games(station_key,contest_date,selection_group);
`;
const runtime=fs.readFileSync('supabase/migrations/202611070003_manager_finals_runtime.sql','utf8');
sql+=runtime.slice(runtime.indexOf('create or replace function public.tour_manager_take_finals_opening_notice'),runtime.indexOf('do $patch$')).replaceAll('take_finals_opening_notice','take_atp_finals_opening_notice').replaceAll('2026-w46-wta-finals',active.station_key).replaceAll('wta_finals_2026_opening','atp_finals_2026_opening').replaceAll('2026-11-09 04:00:00+08','2026-11-15 21:00:00+08').replaceAll('WTA年终','ATP年终');
const payload=buildStationPayload({active,events,photoMap:{}});
for(const [table,rows,keys] of [['tour_manager_station_configs',[payload.stationConfigRow],['station_key','season']],['tour_manager_events',payload.eventRows,['event_key']],['tour_manager_players',payload.playerRows,['tour','player_key']],['tour_manager_event_players',payload.eventPlayerRows,['event_key','player_key']],['tour_manager_draw_entries',payload.drawRows,['event_key','draw_version','draw_position']]]){
 const cols=Object.keys(rows[0]);sql+=`insert into public.${table}(${cols}) select ${cols} from jsonb_populate_recordset(null::public.${table},'${JSON.stringify(rows).replaceAll("'","''")}'::jsonb) on conflict(${keys}) do update set ${cols.filter(c=>!keys.includes(c)).map(c=>`${c}=excluded.${c}`).join(',')};\n`;
}
sql+="notify pgrst, 'reload schema';\ncommit;\n";
fs.writeFileSync('supabase/migrations/202611120001_manager_atp_finals.sql',sql);
fs.writeFileSync('docs/20261112-atp-finals-release.sql',sql);
