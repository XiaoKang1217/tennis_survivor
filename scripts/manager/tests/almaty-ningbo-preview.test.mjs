import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { mergeDrawPlayers } from '../lib/live-tennis-current-station.mjs';
import { buildStationPayload } from '../lib/station-payload.mjs';
const read=p=>JSON.parse(fs.readFileSync(p));
const active=read('data/manager/active_events.json');
const events=active.events.map(item=>({item,event:read('data/manager/'+item.data_file)}));
const html=fs.readFileSync('index.html','utf8');
const source=(name,next)=>html.slice(html.indexOf(`function ${name}(`),html.indexOf(`function ${next}(`,html.indexOf(`function ${name}(`)));
test('new station configuration, group boundaries and prices',()=>{
  assert.equal(active.station_key,'2026-w43-almaty-ningbo');
  assert.equal(active.rules.station_grant,600);
  assert.equal(active.pricing.market_prices_locked,true);
  assert.deepEqual(events.map(x=>[x.event.tour,x.event.level,x.event.players.length]),[['ATP','250',28],['WTA','500',28]]);
  for(const {event} of events){
    assert.equal(new Set(event.players.map(p=>p.draw_position)).size,28);
    assert.equal(Date.parse(event.submission_cutoff_at),Date.parse('2026-10-19T11:00:00+08:00'));
    const incoming=event.players.map(p=>({...p,price:999,...(p.is_qualifier_placeholder?{name_en:'Winner '+p.draw_position,player_key:event.tour+'|winner-'+p.draw_position,is_qualifier_placeholder:false,profile_id:'new'+p.draw_position}:{})}));
    const merged=mergeDrawPlayers(event,incoming,'test');
    event.players.forEach(p=>assert.equal(merged.find(x=>x.draw_position===p.draw_position).price,p.price));
  }
  const payload=buildStationPayload({active,events});
  assert.deepEqual(payload.stationConfigRow.metadata.roster,{min_players:1,max_players:4});
  assert.equal(active.daily_prediction.starts_on,'2026-10-18');
  assert.deepEqual(active.daily_prediction.event_groups.map(x=>x.event_key),active.events.map(x=>x.event_key));
  assert.deepEqual(active.display_groups.previous.station_keys,['2026-w41-shanghai','2026-w42-wuhan']);
});
test('combo cap, thresholds, independent welfare limit',()=>{
  const order=['OUT','R128','R64','R32','R16','QF','SF','F','W'];
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,MANAGER_REMOTE_STATE:null,MANAGER_LEDGER:[],managerSeason:()=>2026,
    managerRoundAtLeast:(a,b)=>order.indexOf(a)>=order.indexOf(b)});
  vm.runInContext(source('managerWashingtonComboScenario','managerCanadaRoundReward')+source('managerWelfareConfig','managerCalc'),c);
  const rounds=events.map(({event})=>({player:{tour:event.tour,eventKey:event.event_key,price:60},round:'W'}));
  let r=c.managerWashingtonComboScenario(5000,rounds);
  assert.equal(r.bonus,600);assert.equal(r.comboRaw,820);assert.equal(r.stable,120);assert.equal(r.villageHopeBonus,undefined);
  for(const [round,reward]of [['R16',0],['QF',50],['SF',100],['F',170],['W',250]]){
    r=c.managerWashingtonComboScenario(500,rounds.map(x=>({...x,round})));
    assert.equal(r.dualBonus,reward);assert.equal(r.jewelBonus,reward);
  }
  assert.equal(c.managerWashingtonComboScenario(500,rounds.map(x=>({...x,player:{...x.player,eventKey:events[0].event.event_key}}))).dualBonus,0);
  const players=[{price:200},{price:200},{price:200}];
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:2};assert.equal(c.managerWelfareQuote(players,500,null).discount,120);
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:3};assert.equal(c.managerWelfareQuote(players,300,null).discount,0);
});
test('current and previous income remain separate with lifetime totals',()=>{
  const rows=[{id:'a',station_key:active.station_key,amount:100},{id:'s',station_key:'2026-w41-shanghai',amount:200},{id:'w',station_key:'2026-w42-wuhan',amount:300}];
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,MANAGER_REMOTE_STATE:{},AUTH_USER:{id:'u'},managerStationKey:()=>active.station_key,
    managerRemoteLedgerContexts:()=>[{state:{ledger:rows}},{state:{ledger:[rows[1]]}}],managerVisibleLedgerRows:r=>r,
    managerLedgerRowStationKey:r=>r.station_key,managerIncomePartsFromRow:r=>({kind:'player',amount:r.amount}),managerChinaDateKey:()=> '2026-10-19',
    managerRenderCurrentLineup:()=> 'NEW ROSTER ONLY'});
  vm.runInContext(fs.readFileSync('assets/manager/station-groups.js','utf8'),c);
  assert.equal(c.managerGroupedStationIncome().total,100);
  const s=c.managerGroupedDailyIncomeSummary();assert.equal(s.groups[1].total.total,500);assert.equal(s.careerTotal,600);
  assert.equal(c.managerRenderMyLineup(),'NEW ROSTER ONLY');
});
test('opening notice is account-scoped, expires and uses compressed shared QR',()=>{
  const sql=fs.readFileSync('supabase/migrations/202610180001_manager_almaty_ningbo_cutoff.sql','utf8');
  assert.match(sql,/auth.uid\(\)/);assert.match(sql,/on conflict do nothing/);assert.match(sql,/2026-10-19 11:00:00\+08/);
  assert.equal(active.opening_notice.closes_at,'2026-10-19T11:00:00+08:00');
  assert.match(html,/wechat-group-20261017.webp/);
  assert.ok(fs.statSync('assets/manager/wechat-group-20261017.webp').size<80000);
  assert.match(fs.readFileSync('assets/manager/station-opening.js','utf8'),/Date.now\(\) >= Date.parse\(config.closes_at\)/);
});
