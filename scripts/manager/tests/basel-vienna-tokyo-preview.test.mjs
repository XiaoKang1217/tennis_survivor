import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { mergeDrawPlayers, parseDrawPlayersFromAjax } from '../lib/live-tennis-current-station.mjs';
import { buildStationPayload } from '../lib/station-payload.mjs';
const read=p=>JSON.parse(fs.readFileSync(p));
const active=read('data/manager/active_events.json');
const events=active.events.map(item=>({item,event:read('data/manager/'+item.data_file)}));
const html=fs.readFileSync('index.html','utf8');
const source=(name,next)=>html.slice(html.indexOf(`function ${name}(`),html.indexOf(`function ${next}(`,html.indexOf(`function ${name}(`)));
test('three markets, per-station roster, dates, prediction sources and locked prices',()=>{
  assert.equal(active.station_key,'2026-w44-basel-vienna-tokyo');
  assert.equal(active.rules.station_grant,700);
  assert.equal(active.pricing.market_prices_locked,true);
  assert.equal(new Set(events.flatMap(x=>x.event.players.map(p=>p.player_key))).size,92);
  assert.deepEqual(events.map(x=>[x.event.tour,x.event.level,x.event.players.length]),[['ATP','500',32],['ATP','500',32],['WTA','500',28]]);
  for(const {event} of events){
    assert.equal(new Set(event.players.map(p=>p.player_key)).size,event.players.length);
    assert.equal(Date.parse(event.submission_cutoff_at),Date.parse('2026-10-26T11:00:00+08:00'));
    const incoming=event.players.map(p=>({...p,price:999,...(p.is_qualifier_placeholder?{name_en:'Winner '+p.draw_position,player_key:event.tour+'|winner-'+p.draw_position,is_qualifier_placeholder:false,profile_id:'new'+p.draw_position}:{})}));
    const merged=mergeDrawPlayers(event,incoming,'test');
    event.players.forEach(p=>assert.equal(merged.find(x=>x.draw_position===p.draw_position).price,p.price));
    const unchanged=mergeDrawPlayers(event,event.players.map(p=>({...p,player_key:p.is_qualifier_placeholder?`${event.tour}|qualifier-${p.draw_position}`:p.player_key})), 'test');
    event.players.forEach(p=>assert.equal(unchanged.find(x=>x.draw_position===p.draw_position).player_key,p.player_key));
  }
  const payload=buildStationPayload({active,events});
  assert.deepEqual(payload.stationConfigRow.metadata.roster,{min_players:1,max_players:6});
  assert.equal(active.daily_prediction.starts_on,'2026-10-26');
  assert.deepEqual(active.daily_prediction.event_groups.map(x=>x.event_key),['atp-2026-w44-vienna','wta-2026-w44-tokyo']);
  assert.deepEqual(active.display_groups.previous.station_keys,['2026-w43-almaty-ningbo']);
});
test('both ATP events qualify with WTA, never with each other; cap and welfare',()=>{
  const order=['OUT','R128','R64','R32','R16','QF','SF','F','W'];
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,MANAGER_REMOTE_STATE:null,MANAGER_LEDGER:[],managerSeason:()=>2026,
    managerRoundAtLeast:(a,b)=>order.indexOf(a)>=order.indexOf(b)});
  vm.runInContext(source('managerWashingtonComboScenario','managerCanadaRoundReward')+source('managerWelfareConfig','managerCalc'),c);
  const rounds=events.map(({event})=>({player:{tour:event.tour,eventKey:event.event_key,price:80},round:'W'}));
  const result=c.managerWashingtonComboScenario(5000,rounds);
  assert.equal(result.bonus,1000);assert.equal(result.comboRaw,1500);assert.equal(result.stable,300);
  for(const [round,reward]of [['R16',0],['QF',150],['SF',250],['F',350],['W',450]]){
    for(const atp of [0,1]){
      const r=c.managerWashingtonComboScenario(500,[rounds[atp],rounds[2]].map(x=>({...x,round})));
      assert.equal(r.dualBonus,reward);assert.equal(r.jewelBonus,reward);
    }
  }
  assert.equal(c.managerWashingtonComboScenario(500,rounds.slice(0,2)).dualBonus,0);
  for(const [gross,bonus] of [[179,0],[180,150],[240,200],[300,250],[360,300]]) {
    assert.equal(c.managerWashingtonComboScenario(gross,rounds).smallBusinessBonus,bonus);
  }
  const players=[{price:200},{price:200},{price:200}];
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:2};assert.equal(c.managerWelfareQuote(players,500,null).discount,120);
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:3};assert.equal(c.managerWelfareQuote(players,300,null).discount,0);
});
test('documented provider correction expires when a real qualifier lands',()=>{
  const event=events[0].event;
  const row=(id,name)=>`<div class="cDrawPart" data-id="MS"><tr><td class="cDrawSeq">2</td><td class="cDrawGrid cDrawGridSideBorder"><pname data-id="${id}" alt="${name}">${name}</pname></td></tr><tr><td class="cDrawSeq">16</td><td class="cDrawGrid cDrawGridSideBorder"><pname data-id="RH16" alt="Casper RUUD">鲁德</pname></td></tr></div>`;
  assert.equal(parseDrawPlayersFromAjax(row('RH16','Casper RUUD'),event)[0].is_qualifier_placeholder,true);
  const placed=parseDrawPlayersFromAjax(row('NEW1','Confirmed Winner'),event);
  assert.equal(placed[0].is_qualifier_placeholder,false);
  const merged=mergeDrawPlayers(event,placed);
  assert.equal(merged[0].name_en,'Confirmed Winner');
  assert.equal(merged[0].price,event.players.find(p=>p.draw_position===2).price);
  assert.equal(event.players.find(p=>p.draw_position===2).is_qualifier_placeholder,true);
  assert.equal(event.players.filter(p=>p.profile_id==='RH16').length,1);
  assert.equal(event.draw_source_corrections[0].expected_profile_id,'RH16');
  assert.match(fs.readFileSync('scripts/manager/lib/live-tennis-current-station.mjs','utf8'),/slot.profile_id === correction.expected_profile_id/);
});
test('income groups retain previous station and lifetime sum',()=>{
  const rows=[{id:'new',station_key:active.station_key,amount:100},{id:'old',station_key:'2026-w43-almaty-ningbo',amount:200},{id:'career',station_key:'2026-w42-wuhan',amount:300}];
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,MANAGER_REMOTE_STATE:{},AUTH_USER:{id:'u'},managerStationKey:()=>active.station_key,
    managerRemoteLedgerContexts:()=>[{state:{ledger:rows}},{state:{ledger:[rows[1]]}}],managerVisibleLedgerRows:r=>r,
    managerLedgerRowStationKey:r=>r.station_key,managerIncomePartsFromRow:r=>({kind:'player',amount:r.amount}),managerChinaDateKey:()=> '2026-10-26',
    managerRenderCurrentLineup:()=> 'NEW ROSTER ONLY'});
  vm.runInContext(fs.readFileSync('assets/manager/station-groups.js','utf8'),c);
  assert.equal(c.managerGroupedStationIncome().total,100);
  const s=c.managerGroupedDailyIncomeSummary();assert.equal(s.groups[1].total.total,200);assert.equal(s.careerTotal,600);
});
test('notice expires, account receipts and compact shared QR',()=>{
  const sql=fs.readFileSync('supabase/migrations/202610250001_manager_basel_vienna_tokyo.sql','utf8');
  assert.match(sql,/auth.uid\(\)/);assert.match(sql,/on conflict do nothing/);assert.match(sql,/2026-10-26 11:00:00\+08/);
  assert.equal(active.opening_notice.closes_at,'2026-10-26T11:00:00+08:00');
  assert.match(html,/wechat-group-20261025.webp/);
  assert.ok(fs.statSync('assets/manager/wechat-group-20261025.webp').size<80000);
});
