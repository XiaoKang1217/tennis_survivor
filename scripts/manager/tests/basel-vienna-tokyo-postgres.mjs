// Isolated disposable database only: node this-file.mjs /absolute/path/to/pg
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { Client } = require(process.argv[2]);
const db = new Client({host:'127.0.0.1',port:55439,user:process.env.USER,database:'postgres'});
await db.connect();
try {
  await db.query(`
    create schema auth;
    create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
    create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
    create function tour_manager_round_order(text) returns int language sql immutable as $$ select array_position(array['OUT','R128','R64','R32','R16','QF','SF','F','W'],$1) $$;
    create table tour_manager_station_configs(station_key text,season int,combo_version text,station_grant int,metadata jsonb);
    create table tour_manager_lineups(id uuid,user_id uuid,season int,station_key text,status text,original_lineup_cost int,lineup_cost int);
    create table tour_manager_lineup_players(lineup_id uuid,is_active boolean,event_key text,tour text,reached_round text,price int,earned_points int,name_zh text,name_en text,player_key text,created_at timestamptz default now());
    create table tour_manager_wallets(user_id uuid,season int,balance int,updated_at timestamptz);
    create table tour_manager_wallet_ledger(user_id uuid,season int,station_key text,lineup_id uuid,type text,amount int,balance_after int,description text,metadata jsonb);
    create table tour_manager_opening_notice_receipts(user_id uuid,notice_key text,primary key(user_id,notice_key));
  `);
  const original = await readFile('supabase/migrations/202609190001_manager_seoul_singapore_combo.sql','utf8');
  await db.query(original.slice(original.indexOf('create or replace function'),original.indexOf('\nrevoke all')));
  const migration = await readFile('supabase/migrations/202610250001_manager_basel_vienna_tokyo.sql','utf8');
  await db.query(migration);
  await db.query(migration);
  const active=JSON.parse(await readFile('data/manager/active_events.json','utf8'));
  const user='00000000-0000-0000-0000-000000000001';
  const lineup='00000000-0000-0000-0000-000000000002';
  await db.query('insert into tour_manager_station_configs values($1,2026,$2,700,$3)',[active.station_key,active.rules.combo_version,JSON.stringify({combo:active.rules.combo})]);
  await db.query('insert into tour_manager_lineups values($1,$2,2026,$3,\'submitted\',240,240)',[lineup,user,active.station_key]);
  await db.query('insert into tour_manager_wallets values($1,2026,300,now())',[user]);
  for(const event of active.events) await db.query('insert into tour_manager_lineup_players(lineup_id,is_active,event_key,tour,reached_round,price,earned_points,player_key) values($1,true,$2,$3,\'QF\',80,100,$2)',[lineup,event.event_key,event.tour]);
  const settle=()=>db.query('select tour_manager_apply_seoul_singapore_combo_v1($1,2026)',[active.station_key]);
  await settle();
  let ledger=(await db.query('select * from tour_manager_wallet_ledger')).rows;
  assert.equal(ledger[0].metadata.dual_bonus,150);
  assert.equal(ledger[0].metadata.small_budget_bonus,250);
  assert.equal(ledger[0].amount,580);
  await settle();assert.equal((await db.query('select * from tour_manager_wallet_ledger')).rows.length,1);
  await db.query("update tour_manager_lineup_players set reached_round='W',earned_points=1000");
  await settle();
  ledger=(await db.query('select * from tour_manager_wallet_ledger')).rows;
  assert.equal(ledger[1].amount,420);
  assert.equal(ledger[1].metadata.combo_cap,1000);
  assert.ok(ledger[1].metadata.combo_entitled_details.length===4);
  assert.equal((await db.query('select balance from tour_manager_wallets')).rows[0].balance,1300);
  await settle();assert.equal((await db.query('select * from tour_manager_wallet_ledger')).rows.length,2);
  // Check either ATP event can provide the ATP half, and ATP+ATP is never dual-tour.
  for(const selected of ['basel','vienna']) {
    await db.query('truncate tour_manager_wallet_ledger');
    await db.query("update tour_manager_lineup_players set is_active=(tour='WTA' or event_key like $1)",['%'+selected]);
    await settle();assert.equal((await db.query('select metadata from tour_manager_wallet_ledger')).rows[0].metadata.dual_bonus,450);
  }
  await db.query('truncate tour_manager_wallet_ledger');
  await db.query("update tour_manager_lineup_players set is_active=(tour='ATP')");
  await settle();assert.equal((await db.query('select metadata from tour_manager_wallet_ledger')).rows[0].metadata.dual_bonus,0);
  // Original event grouping still permits two same-tour events.
  const legacy=structuredClone(active.rules.combo);
  legacy.dual_tour.grouping='event';legacy.dual_tour.event_keys=active.events.slice(0,2).map(x=>x.event_key);
  await db.query('update tour_manager_station_configs set metadata=$1',[JSON.stringify({combo:legacy})]);
  await db.query('truncate tour_manager_wallet_ledger');await settle();
  assert.equal((await db.query('select metadata from tour_manager_wallet_ledger')).rows[0].metadata.dual_bonus,450);
  console.log('PASS: SQL migration twice; tour/event grouping; 1000 cap; daily delta; repeat settlement; ledger details.');
} finally { await db.end(); }
