import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { mergeDrawPlayers } from '../lib/live-tennis-current-station.mjs';
const read=p=>JSON.parse(fs.readFileSync(p));
const active=read('data/manager/active_events.json');
const events=active.events.map(item=>({item,event:read('data/manager/'+item.data_file)}));
const html=fs.readFileSync('index.html','utf8');
test('Alcaraz uses formula form without historical manual override',()=>{
  const overrides=read('data/manager/player_source_overrides.json');
  assert.equal(overrides['ATP|carlos-alcaraz']?.scores?.form,undefined);
  const p=events[0].event.players.find(p=>p.player_key==='ATP|carlos-alcaraz');
  assert.equal(p.scores.form,90.82);
  assert.equal(p.price,450);
  assert.equal(p.pricing_detail.score_overrides,null);
  assert.equal(Math.round((p.pricing_detail.peak_close_score*.7+p.pricing_detail.peak_recency_score*.3)*100)/100,p.scores.form);
});
const source=(name,next)=>html.slice(html.indexOf(`function ${name}(`),html.indexOf(`function ${next}(`,html.indexOf(`function ${name}(`)));
test('Paris/Hong Kong complete draws, mixed-level roster, deadline and price locks',()=>{
  assert.equal(active.station_key,'2026-w45-paris-hongkong');
  assert.equal(active.rules.station_grant,700);
  assert.equal(active.pricing.market_prices_locked,true);
  assert.deepEqual(events.map(x=>[x.event.tour,x.event.level,x.event.players.length]),[['ATP','1000',56],['WTA','250',32]]);
  const archive=read('data/manager/publications/2026-w45-paris-hongkong-v1.json');
  assert.equal(new Set(events.flatMap(x=>x.event.players.map(p=>p.player_key))).size,88);
  for(const {event} of events){
    assert.equal(event.submission_cutoff_at,'2026-11-02T11:00:00+08:00');
    const incoming=event.players.map(p=>({...p,price:999,...(p.is_qualifier_placeholder?{name_en:'Winner '+p.draw_position,player_key:event.tour+'|winner-'+p.draw_position,is_qualifier_placeholder:false,profile_id:'new'+p.draw_position}:{})}));
    const merged=mergeDrawPlayers(event,incoming,'test');
    event.players.forEach(p=>assert.equal(merged.find(x=>x.draw_position===p.draw_position).price,p.price));
  }
  assert.ok(archive.snapshot);
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,MANAGER_LEVEL_CONFIG:{'250':{min:1,max:2},'1000':{min:2,max:3}},managerContestPacks:()=>events.map(x=>({meta:x.event})),managerWallet:()=>300});
  vm.runInContext(source('managerRules','managerDemoLedgerAllowed'),c);
  assert.equal(c.managerRules().minPlayers,1);assert.equal(c.managerRules().maxPlayers,5);
  assert.equal(active.daily_prediction.starts_on,'2026-11-02');
  assert.deepEqual(active.daily_prediction.event_groups.map(x=>x.event_key),events.map(x=>x.event.event_key));
  assert.deepEqual(active.display_groups.previous.station_keys,['2026-w44-basel-vienna-tokyo']);
});
test('R16 steady, configurable rewards, frozen hope, cap and old QF default',()=>{
  const order=['OUT','R128','R64','R32','R16','QF','SF','F','W'];
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,managerRoundAtLeast:(a,b)=>order.indexOf(a)>=order.indexOf(b),
    managerVillageHopeUserSelected:()=>true,managerComboRewardText:()=>'',managerPlayerDisplayName:p=>p.id});
  vm.runInContext(source('managerCanadaRoundReward','managerVillageHopePlayer')+source('managerCanadaComboScenario','managerWimbledonJewelBonus'),c);
  const players=[{id:'a',tour:'ATP',price:120},{id:'b',tour:'WTA',price:121},{id:'c',tour:'ATP',price:130}];
  const calc=(rounds,gross=300,rules=active.rules)=>c.managerCanadaComboScenario(gross,rounds,{rules,hopeId:'b'});
  for(const [round,reward] of [['R32',0],['R16',50],['QF',150],['SF',250],['F',400],['W',550]]) {
    const r=calc(players.map(player=>({player,round})));
    assert.equal(r.dualBonus,reward);assert.equal(r.jewelBonus,reward);assert.equal(r.villageHopeBonus,reward);
    assert.equal(r.villageHopePlayer.id,'b');
  }
  const rounds=players.map((player,i)=>({player,round:i===2?'R32':'R16'}));
  assert.equal(calc(rounds).stable,30);
  assert.equal(calc(rounds.slice(0,2)).stable,0);
  assert.equal(calc(rounds.map((r,i)=>({...r,round:i===0?'R16':'R32'}))).stable,0);
  const old=structuredClone(active.rules);delete old.combo.steady.qualifying_round;
  assert.equal(calc(rounds,300,old).stable,0);
  assert.equal(calc(players.map(player=>({player,round:'W'})),5000).bonus,1000);
  assert.equal(calc(players.map(player=>({player:{...player,price:121},round:'W'}))).jewelBonus,0);
  assert.equal(calc(players.map(player=>({player:{...player,tour:'ATP'},round:'W'}))).dualBonus,0);
});
test('welfare stops at three uses, independent of combo cap',()=>{
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,MANAGER_REMOTE_STATE:null,MANAGER_LEDGER:[],managerSeason:()=>2026});
  vm.runInContext(source('managerWelfareConfig','managerCalc'),c);
  const players=[{price:200},{price:200},{price:200}];
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:2};assert.equal(c.managerWelfareQuote(players,500,null).discount,120);
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:3};assert.equal(c.managerWelfareQuote(players,300,null).discount,0);
});
test('notice is account scoped, expires with submission and uses compressed shared QR',()=>{
  const sql=fs.readFileSync('supabase/migrations/202610310001_manager_paris_hongkong.sql','utf8');
  assert.match(sql,/auth.uid\(\)/);assert.match(sql,/on conflict do nothing/);assert.match(sql,/2026-11-02 11:00:00\+08/);
  assert.equal(active.opening_notice.closes_at,'2026-11-02T11:00:00+08:00');
  assert.match(html,/wechat-group-20261031.webp/);
  assert.ok(fs.statSync('assets/manager/wechat-group-20261031.webp').size<80000);
});
