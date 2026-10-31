// Only a disposable localhost database; no production connection or credentials.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const sql=s=>execFileSync('/opt/homebrew/opt/postgresql@16/bin/psql',['-h','127.0.0.1','-p','55441','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input:s,encoding:'utf8'}).trim();
sql(`create schema auth; create role anon; create role authenticated; create role service_role;
create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
create function tour_manager_round_order(text) returns int language sql immutable as $$ select array_position(array['OUT','R128','R64','R32','R16','QF','SF','F','W'],$1) $$;
create table tour_manager_station_configs(station_key text,season int,combo_version text,station_grant int,metadata jsonb);
create table tour_manager_lineups(id uuid,user_id uuid,season int,station_key text,status text,original_lineup_cost int,lineup_cost int,village_hope_player_key text);
create table tour_manager_lineup_players(lineup_id uuid,is_active boolean,event_key text,tour text,reached_round text,price int,earned_points int,name_zh text,name_en text,player_key text,created_at timestamptz default now());
create table tour_manager_wallets(user_id uuid,season int,balance int,updated_at timestamptz);
create table tour_manager_wallet_ledger(user_id uuid,season int,station_key text,lineup_id uuid,type text,amount int,balance_after int,description text,metadata jsonb);
create table tour_manager_opening_notice_receipts(user_id uuid,notice_key text,primary key(user_id,notice_key));`);
const original=fs.readFileSync('supabase/migrations/202608010001_manager_canada_combo_and_welfare.sql','utf8');
const start=original.indexOf('create or replace function public.tour_manager_apply_canada_combo_v1(');
sql(original.slice(start,original.indexOf('\nrevoke all',start)));
const migration=fs.readFileSync('supabase/migrations/202610310001_manager_paris_hongkong.sql','utf8');
sql(migration);sql(migration);
const active=JSON.parse(fs.readFileSync('data/manager/active_events.json'));
const u='00000000-0000-0000-0000-000000000001',l='00000000-0000-0000-0000-000000000002';
sql(`insert into tour_manager_station_configs values('${active.station_key}',2026,'canada_2026_v1',700,'${JSON.stringify({combo:active.rules.combo})}');
insert into tour_manager_lineups values('${l}','${u}',2026,'${active.station_key}','submitted',370,370,'b');
insert into tour_manager_wallets values('${u}',2026,300,now());
insert into tour_manager_lineup_players(lineup_id,is_active,tour,reached_round,price,earned_points,player_key) values
('${l}',true,'ATP','R16',120,100,'a'),('${l}',true,'WTA','R16',121,100,'b'),('${l}',true,'ATP','R32',129,100,'c');`);
const settle=()=>sql(`select tour_manager_apply_canada_combo_v1('${active.station_key}',2026)`);
const rows=()=>JSON.parse(sql('select coalesce(json_agg(t),\'[]\') from tour_manager_wallet_ledger t'));
settle();let r=rows();assert.equal(r[0].amount,180);assert.equal(r[0].metadata.stable_bonus,30);
assert.deepEqual(r[0].metadata.combo_entitled_details[0].players,['a','b']);
settle();assert.equal(rows().length,1);
sql("update tour_manager_lineup_players set reached_round='W',earned_points=2000");settle();
r=rows();assert.equal(r[1].amount,820);assert.equal(r[1].metadata.combo_cap,1000);assert.equal(r[1].metadata.combo_entitled_details.length,4);
settle();assert.equal(rows().length,2);assert.equal(Number(sql('select balance from tour_manager_wallets')),1300);
// Without a configured threshold, old Canada-family stations still require QF.
sql("truncate tour_manager_wallet_ledger; update tour_manager_lineup_players set reached_round='R16',earned_points=100; update tour_manager_station_configs set metadata=metadata #- '{combo,steady,qualifying_round}';");
settle();assert.equal(rows()[0].metadata.stable_bonus,0);assert.equal(rows()[0].amount,150);
console.log('PASS: migration idempotence, R16 threshold, old QF default, frozen hope, 1000 cap, daily deltas and ledger details');
