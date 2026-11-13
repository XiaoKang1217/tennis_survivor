// Run with PGLITE_DIR pointing at an installed @electric-sql/pglite package.
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const directory = process.env.PGLITE_DIR || '/tmp/finals-qa-deps/node_modules/@electric-sql/pglite';
const { PGlite } = await import(`${directory}/dist/index.js`);
const { pgcrypto } = await import(`${directory}/dist/contrib/pgcrypto.js`);
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
create table public.profiles(id uuid primary key,display_name text);
`);
const wanted = [
 '202606200001','202606200002','202606200003','202606210001','202606210003',
 '202606270001','202606270002','202606270004','202607040001','202607120001',
 '202607120002','202607150001','202607170001','202607170002','202607170003',
 '202607170004','202607260001','202607260002','202607310001','202608010001',
 '202608120001','202608280001','202609210001','202610060001','202610060002'
];
const files = (await readdir('supabase/migrations')).sort();
for (const file of files.filter(f => wanted.some(p => f.startsWith(p)))) {
 try { await db.exec(await readFile(`supabase/migrations/${file}`,'utf8')); }
 catch(error) { console.error('BASE MIGRATION',file,error.message); process.exit(1); }
}
const active=JSON.parse(await readFile('data/manager/active_events.json','utf8'));
const elite=active.rules.finals.top8_user_ids;
const ordinary='00000000-0000-0000-0000-000000000001';
for(const id of new Set([...elite,...(active.previous_finals_top8_ids||[]),ordinary]))await db.query('insert into auth.users(id) values($1)',[id]);
for(const file of files.filter(f=>f.startsWith('20261107')||f.startsWith('20261112'))){
 try{await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));}
 catch(error){console.error('FINALS MIGRATION',file,error.message);process.exit(1);}
}
console.log('All Finals migrations compiled against historical schema.');
if(active.station_key==='2026-w47-atp-finals' && Date.now()<Date.parse(active.opening_notice.closes_at)){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ordinary]);
 const first=(await db.query('select tour_manager_take_atp_finals_opening_notice() notice')).rows[0].notice;
 const second=(await db.query('select tour_manager_take_atp_finals_opening_notice() notice')).rows[0].notice;
 assert.match(first.message,/ATP年终/);assert.equal(second,null);
 console.log('Opening notice is delivered once per account: passed');
}
const station=active.station_key;
const event=JSON.parse(await readFile('data/manager/'+active.events[0].data_file,'utf8'));
// Make fixture windows independent of the date the regression suite is run.
await db.exec(`update tour_manager_events set submission_opens_at=now()-interval '1 day',submission_cutoff_at=now()+interval '1 day',submission_closes_at=now()+interval '1 day',main_draw_first_match_at=now()+interval '1 day' where station_key='${station}';`);
if(active.previous_finals_top8_ids){
 const eligibility=(await db.query('select station_key,user_id from tour_manager_finals_eligibility')).rows;
 const eligible=(station,id)=>eligibility.some(r=>r.station_key===station&&r.user_id===id);
 assert.ok(eligible(station,'4137f767-01c4-4821-a350-533329c03762'));
 assert.ok(!eligible(station,'57722850-cc58-4170-a35f-cf49b06973f0'));
 assert.ok(!eligible('2026-w46-wta-finals','4137f767-01c4-4821-a350-533329c03762'));
 assert.ok(eligible('2026-w46-wta-finals','57722850-cc58-4170-a35f-cf49b06973f0'));
 console.log('ATP and WTA frozen eligibility remain isolated: passed');
}
const keys=event.players.slice(0,2).map(p=>p.player_key);
const contracts=keys.map(player_key=>({event_key:event.event_key,player_key,price:0,finals_elite:true}));
async function asUser(id,role='authenticated'){
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[id,role]);
}
async function balance(id){return (await db.query('select balance from tour_manager_wallets where user_id=$1 and season=2026',[id])).rows[0]?.balance;}
async function submit(id){
 await asUser(id);
 return db.query(`select tour_manager_submit_lineup_v2($1,2026,999999,1,100,0,$2::jsonb,'{}',0,0,0,null,null)`,[station,JSON.stringify(contracts)]);
}
const newUser='00000000-0000-0000-0000-000000000002';
await db.query('insert into auth.users(id)values($1)',[newUser]);await asUser(newUser);
await db.query('select tour_manager_get_my_state($1,2026)',[station]);
assert.equal(await balance(newUser),0);
await assert.rejects(()=>submit(newUser),/insufficient_budget/);
console.log('New Finals accounts start at zero; no opening principal granted: passed');
for(const id of [ordinary,elite[0]]){
 await asUser(id);
 await db.query('select tour_manager_bootstrap_wallet(2026)');
 await db.query('update tour_manager_wallets set balance=3000 where user_id=$1',[id]);
 await submit(id);
 assert.equal(await balance(id),id===ordinary?1000:3000);
 const rows=(await db.query(`select lp.* from tour_manager_lineup_players lp join tour_manager_lineups l on l.id=lp.lineup_id where l.user_id=$1 and l.station_key=$2 and l.status<>'cancelled'`,[id,station])).rows;
 assert.equal(rows.length,2);
 assert.ok(rows.every(p=>p.price===(id===ordinary?1000:0)&&p.metadata.finals_elite===(id!==ordinary)));
 await assert.rejects(()=>submit(id),/lineup_already_submitted/);
}
console.log('Server-enforced ordinary/elite pricing, forged fields and duplicate submission: passed');
await asUser(ordinary);
await db.query('select tour_manager_withdraw_lineup($1,2026)',[station]);
assert.equal(await balance(ordinary),3000);
await submit(ordinary);
assert.equal(await balance(ordinary),1000);
console.log('Withdrawal refund and resubmission: passed');
await asUser(ordinary);
const lineup=(await db.query("select id from tour_manager_lineups where user_id=$1 and status<>'cancelled'",[ordinary])).rows[0];
await assert.rejects(()=>db.query("select tour_manager_transfer_player($1,null,'{}'::jsonb,0)",[lineup.id]),/finals_transfer_not_allowed/);
assert.equal((await db.query("select count(*)::int n from tour_manager_wallet_ledger where station_key=$1 and type in ('submit_bonus','station_grant_issued')",[station])).rows[0].n,0);
console.log('Finals transfers rejected; no signing grant or submission bonus ledger: passed');
await asUser(ordinary,'service_role');
await db.query('update tour_manager_event_players set price=9999 where event_key=$1',[event.event_key]);
for(const [i,key]of keys.entries())await db.query(`insert into tour_manager_finals_progress(season,station_key,event_key,player_key,rr_wins,stage,source)values(2026,$1,$2,$3,$4,'RR','{}')`,[station,event.event_key,key,i===0?1:0]);
await db.query('select tour_manager_settle_completed_matches($1,2026,$2::date)',[station,'2026-11-09']);
assert.equal(await balance(ordinary),1200);assert.equal(await balance(elite[0]),3250);
assert.ok((await db.query("select lp.metadata from tour_manager_lineup_players lp join tour_manager_lineups l on l.id=lp.lineup_id where lp.is_active and l.status<>'cancelled'")).rows.every(r=>r.metadata.finals_eliminated===false));
for(const [i,key]of keys.entries())await db.query('update tour_manager_finals_progress set rr_wins=$1,stage=$2 where player_key=$3',[i===0?2:3,i===0?'W':'SF',key]);
await db.query('select tour_manager_settle_completed_matches($1,2026,$2::date)',[station,'2026-11-15']);
assert.equal(await balance(ordinary),10000);
assert.equal(await balance(elite[0]),16250);
const ledger=(await db.query("select count(*)::int n from tour_manager_wallet_ledger where type='player_points_delta'")).rows[0].n;
await db.query('select tour_manager_settle_completed_matches($1,2026,$2::date)',[station,'2026-11-15']);
assert.equal(await balance(ordinary),10000);
assert.equal((await db.query("select count(*)::int n from tour_manager_wallet_ledger where type='player_points_delta'")).rows[0].n,ledger);
console.log('9000/13250 payout example and repeat-run idempotency: passed');
await asUser(ordinary);
await assert.rejects(()=>db.query('select tour_manager_settle_completed_matches($1,2026,$2::date)',[station,'2026-11-15']),/admin_required/);
console.log('Unauthorised settlement denied: passed');
await db.exec(await readFile(active.previous_finals_top8_ids?'docs/20261112-atp-finals-release.sql':'docs/20261107-wta-finals-release.sql','utf8'));
console.log('Standalone SQL replay is idempotent: passed');
for(const slot of [1,2])await db.query(`insert into tour_manager_daily_prediction_games(season,station_key,contest_date,event_key,tour,game_slot,match_key,scheduled_at,closes_at,player1_key,player1_name,player1_ranking,player2_key,player2_name,player2_ranking,ranking_gap)
values(2026,$1,'2026-11-16',$2,'${event.tour}',$3,$4,'2026-11-16 20:00Z','2026-11-16 20:00Z',$5,'P1',1,$6,'P2',2,1)`,[station,event.event_key,slot,'finals-game-'+slot,...keys]);
assert.equal((await db.query('select count(*)::int n from tour_manager_daily_prediction_games')).rows[0].n,2);
console.log(`Two games of the same ${event.tour} event accepted by database uniqueness rules: passed`);
await db.close();
