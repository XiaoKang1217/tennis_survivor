import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { mergeDrawPlayers } from '../lib/live-tennis-current-station.mjs';
import { canonicalPlayerKey } from '../lib/manager-utils.mjs';

const html = fs.readFileSync('index.html', 'utf8');
const active = JSON.parse(fs.readFileSync('data/manager/active_events.json'));
const events = ['seoul', 'singapore'].map(slug => JSON.parse(fs.readFileSync(`data/manager/events/wta-2026-w39-${slug}.json`)));
function source(name, next) {
  return html.slice(html.indexOf(`function ${name}(`), html.indexOf(`function ${next}(`, html.indexOf(`function ${name}(`)));
}
function context() {
  const ctx = vm.createContext({MANAGER_ACTIVE_EVENTS:active, MANAGER_REMOTE_STATE:null, MANAGER_LEDGER:[], managerSeason:()=>2026,
    managerRules:()=>({stationGrant:500}), managerRoundAtLeast:(a,b)=>['OUT','R32','R16','QF','SF','F','W'].indexOf(a)>=['OUT','R32','R16','QF','SF','F','W'].indexOf(b)});
  vm.runInContext(source('managerWashingtonComboScenario','managerCanadaRoundReward')+source('managerWelfareConfig','managerCalc'),ctx);
  return ctx;
}
test('both official draws retain independent qualifier identities and price scales',()=>{
  assert.deepEqual(events.map(e=>[e.tour,e.level,e.players.length]),[['WTA','250',32],['WTA','500',28]]);
  const players=events.flatMap(e=>e.players);
  assert.equal(new Set(players.map(p=>p.player_key)).size,60);
  for(const e of events){
    assert.equal(e.players.filter(p=>p.is_qualifier_placeholder).length,4);
    assert.equal(new Set(e.players.map(p=>p.draw_position)).size,e.players.length);
    assert.ok(e.players.every(p=>p.price>0));
    assert.ok(e.players.filter(p=>!p.is_qualifier_placeholder).every(p=>p.rank>0&&p.overall_elo>0&&p.surface_elo>0));
    assert.equal(Date.parse(e.submission_cutoff_at),Date.parse('2026-09-21T10:45:00+08:00'));
  }
});
test('frontend submits every Q slot with the same event-specific key as the backend',()=>{
  const c=vm.createContext({MANAGER_PREDICTIONS:{}});
  vm.runInContext(source('managerSlug','managerContestPacks')+source('managerContractPayload','managerApplyRemoteState'),c);
  const keys=[];
  for(const event of events){
    for(const q of event.players.filter(p=>p.is_qualifier_placeholder)){
      const key=c.managerCanonicalPlayerKey(event.tour,q);
      assert.equal(key,canonicalPlayerKey(event.tour,q));
      assert.equal(key,q.player_key);
      const payload=c.managerContractPayload({eventKey:event.event_key,playerKey:key,id:key,tour:event.tour,name:q.name_zh,price:q.price});
      assert.equal(payload.player_key,q.player_key);
      assert.equal(payload.event_key,event.event_key);
      assert.equal(payload.price,q.price);
      keys.push(key);
    }
  }
  assert.equal(new Set(keys).size,keys.length);
  assert.equal(c.managerCanonicalPlayerKey('WTA',{is_qualifier_placeholder:true,draw_position:4}),'WTA|qualifier-4');
});
test('opening market prices are locked for both events',()=>{
  assert.equal(active.pricing.market_prices_locked,true);
  for(const event of events){
    assert.equal(event.market_price_lock.publication_version,active.pricing.publication_version);
    const refreshed=mergeDrawPlayers(event,event.players.map(p=>({...p,price:p.price+500})),'test');
    for(const p of event.players)assert.equal(refreshed.find(x=>x.draw_position===p.draw_position).price,p.price);
  }
});
test('dual Combo needs both events; two players from Seoul do not count as two lines',()=>{
  const c=context(),make=(key,round)=>({player:{tour:'WTA',eventKey:key,price:150},round});
  const [a,b]=events.map(e=>e.event_key);
  assert.equal(c.managerWashingtonComboScenario(300,[make(a,'QF'),make(a,'QF')]).dualBonus,0);
  assert.equal(c.managerWashingtonComboScenario(300,[make(a,'QF'),make(b,'SF')]).dualBonus,60);
  assert.equal(c.managerWashingtonComboScenario(1000,[make(a,'W'),make(b,'W')]).dualBonus,300);
});
test('daily draw refresh and qualifier landing preserve event-specific locked Q prices',()=>{
  for(const event of events){
    const q=event.players.find(p=>p.is_qualifier_placeholder);
    const parsed=event.players.map(p=>p===q?{...p,player_key:`WTA|qualifier-${p.draw_position}`}:{...p});
    const unchanged=mergeDrawPlayers(event,parsed,'test').find(p=>p.draw_position===q.draw_position);
    assert.equal(unchanged.player_key,q.player_key);assert.equal(unchanged.price,q.price);
    parsed[parsed.findIndex(p=>p.draw_position===q.draw_position)]={...q,player_key:'WTA|new-player',profile_id:'999999',name_en:'New Player',name_zh:'新球员',is_qualifier_placeholder:false};
    const landed=mergeDrawPlayers(event,parsed,'test').find(p=>p.draw_position===q.draw_position);
    assert.equal(landed.price,q.price);
    assert.equal(landed.qualifier_replacement.placeholder_player_key,q.player_key);
  }
});
test('cap is 700 and normal ATP/WTA policy still works',()=>{
  const c=context(),[a,b]=events.map(e=>e.event_key);
  const rounds=[a,b].map(eventKey=>({player:{tour:'WTA',eventKey,price:50},round:'W'}));
  const result=c.managerWashingtonComboScenario(2000,rounds);
  assert.equal(result.comboRaw,950);assert.equal(result.bonus,700);
  c.MANAGER_ACTIVE_EVENTS={rules:{...active.rules,combo:{...active.rules.combo,dual_tour:{QF:60,SF:120,F:200,W:300}}}};
  assert.equal(c.managerWashingtonComboScenario(300,rounds).dualBonus,0);
  rounds[0].player.tour='ATP';assert.equal(c.managerWashingtonComboScenario(300,rounds).dualBonus,300);
});
test('revised steady cap, value ladder and small-budget thresholds agree with display',()=>{
  const c=context(),[a,b]=events.map(e=>e.event_key);
  const rounds=[a,b].map(eventKey=>({player:{tour:'WTA',eventKey,price:100},round:'QF'}));
  assert.equal(c.managerWashingtonComboScenario(3000,rounds).stable,150);
  for(const [round,amount] of [['QF',60],['SF',120],['F',200],['W',300]]){
    rounds.forEach(r=>r.round=round);
    assert.equal(c.managerWashingtonComboScenario(200,rounds).jewelBonus,amount);
  }
  for(const [gross,bonus] of [[149,0],[150,50],[200,100],[250,150],[300,200]]){
    assert.equal(c.managerWashingtonComboScenario(gross,rounds).smallBusinessBonus,bonus);
  }
  const result=c.managerWashingtonComboScenario(3000,rounds);
  assert.match(result.comboItems[0].desc,/封顶150/);
  assert.match(result.comboItems[2].desc,/60\/\+120\/\+200\/\+300/);
  rounds.forEach(r=>r.player.price=101);
  assert.equal(c.managerWashingtonComboScenario(200,rounds).jewelBonus,0);
});
test('welfare grants third use, refuses fourth use and principal above 500',()=>{
  const c=context(),players=[{price:100},{price:100},{price:100}];
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:2};
  assert.equal(c.managerWelfareQuote(players,500,null).discount,60);
  assert.equal(c.managerWelfareQuote(players,501,null).discount,0);
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:3};
  assert.equal(c.managerWelfareQuote(players,300,null).discount,0);
  c.MANAGER_REMOTE_STATE=null;
  c.MANAGER_LEDGER=[{season:2025,lineup_id:'old',metadata:{welfare_discount:20}},{season:2026,lineup_id:'new',metadata:{welfare_discount:20}},{season:2026,lineup_id:'new',metadata:{welfare_discount:20}}];
  assert.equal(c.managerWelfareUsesThisSeason(),1);
});
