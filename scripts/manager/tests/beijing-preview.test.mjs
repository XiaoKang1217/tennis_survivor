import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { mergeDrawPlayers } from '../lib/live-tennis-current-station.mjs';
import { predictionDateEnabled, predictionCycle } from '../lib/prediction-cycle.mjs';
const active=JSON.parse(fs.readFileSync('data/manager/active_events.json'));
const events=active.events.map(e=>JSON.parse(fs.readFileSync('data/manager/'+e.data_file)));
const html=fs.readFileSync('index.html','utf8');
const source=(name,next)=>html.slice(html.indexOf(`function ${name}(`),html.indexOf(`function ${next}(`,html.indexOf(`function ${name}(`)));
test('Beijing opening, grant, cap, preceding station and draws',()=>{
  assert.equal(active.station_key,'2026-w40-beijing');
  assert.equal(active.rules.station_grant,1000);
  assert.equal(active.rules.combo.total_cap,1500);
  assert.equal(active.previous_station.station_key,'2026-w39-seoul-singapore');
  assert.deepEqual(events.map(e=>[e.tour,e.level,e.players.length]),[['ATP','500',32],['WTA','1000',96]]);
  for(const e of events){
    assert.equal(Date.parse(e.submission_cutoff_at),Date.parse('2026-09-30T10:30:00+08:00'));
    assert.equal(e.main_draw_first_match_at,null);
    assert.equal(new Set(e.players.map(p=>p.draw_position)).size,e.players.length);
    assert.ok(e.players.every(p=>p.price>0));
  }
});
test('all opening prices and qualifier landing prices remain frozen',()=>{
  assert.equal(active.pricing.market_prices_locked,true);
  for(const e of events){
    const q=e.players.find(p=>p.is_qualifier_placeholder);
    const incoming=e.players.map(p=>p===q?{...p,name_en:'New Qualifier',player_key:e.tour+'|new-qualifier',profile_id:'99999',is_qualifier_placeholder:false,price:999}:{...p,price:999});
    const refreshed=mergeDrawPlayers(e,incoming,'test');
    for(const p of e.players)assert.equal(refreshed.find(x=>x.draw_position===p.draw_position).price,p.price);
    assert.equal(refreshed.find(x=>x.draw_position===q.draw_position).qualifier_replacement.placeholder_player_key,q.player_key);
  }
});
test('prediction publication begins on official Sep 30, not the Beijing clock',()=>{
  assert.equal(predictionDateEnabled(active.daily_prediction,'2026-09-29'),false);
  assert.equal(predictionDateEnabled(active.daily_prediction,'2026-09-30'),true);
  assert.equal(predictionDateEnabled(active.daily_prediction,'2026-10-01'),true);
  assert.equal(predictionDateEnabled({},'2026-09-29'),true);
  assert.deepEqual(active.daily_prediction.event_groups.map(g=>g.tour),['ATP','WTA']);
  assert.equal(predictionCycle([], [{raw:{date:'2026-09-30'},status:'scheduled'}]).contestDate,'2026-09-30');
});
test('four Combo types cap at 1500 and welfare grants third but not fourth use',()=>{
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,MANAGER_REMOTE_STATE:null,MANAGER_LEDGER:[],managerSeason:()=>2026,
    managerVillageHopePlayer:r=>r[0],managerVillageHopeUserSelected:()=>true,managerPlayerDisplayName:p=>p.id,
    managerRoundAtLeast:(a,b)=>['OUT','R128','R64','R32','R16','QF','SF','F','W'].indexOf(a)>=['OUT','R128','R64','R32','R16','QF','SF','F','W'].indexOf(b)});
  vm.runInContext(source('managerComboRewardText','managerCanadaComboRuleCard')+source('managerCanadaRoundReward','managerVillageHopePlayer')+source('managerCanadaComboScenario','managerWimbledonJewelBonus')+source('managerWelfareConfig','managerCalc'),c);
  const rounds=['ATP','WTA','WTA'].map((tour,i)=>({player:{tour,price:100,id:String(i)},round:'W'}));
  const quote=c.managerCanadaComboScenario(5000,rounds);
  assert.equal(quote.comboItems.length,4);assert.equal(quote.comboRaw,2600);assert.equal(quote.bonus,1500);
  assert.equal(quote.stable,400);assert.equal(quote.villageHopeBonus,800);
  for(const [round,reward,hope] of [['R16',150,150],['QF',250,250],['SF',350,350],['F',550,550],['W',700,800]]){
    const q=c.managerCanadaComboScenario(1000,rounds.map(x=>({...x,round})));
    assert.equal(q.dualBonus,reward);assert.equal(q.jewelBonus,reward);assert.equal(q.villageHopeBonus,hope);
    assert.equal(q.stable,round==='R16'?0:150);
  }
  c.managerComboSelectionFromRules=()=> 'user_selected_at_submission';
  c.managerComboRuleSection=(title,lines)=>title+' '+lines.join(' ');
  const rulesText=c.managerCanadaComboRulesHtml(active.rules);
  assert.match(rulesText,/毛收益的 15%，封顶 400/);
  assert.match(rulesText,/合计封顶 1500/);
  assert.doesNotMatch(rulesText,/700 (封顶|上限)/);
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:2};
  assert.equal(c.managerWelfareQuote(rounds.map(x=>x.player),500,null).discount,60);
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:3};
  assert.equal(c.managerWelfareQuote(rounds.map(x=>x.player),300,null).discount,0);
  c.MANAGER_REMOTE_STATE=null;
  c.MANAGER_LEDGER=[1,2].map(i=>({id:'local-'+i,station:active.station_key,date:'2026-09-28',status:'已撤回',welfareDiscount:60}));
  assert.equal(c.managerWelfareUsesThisSeason(),2);
  assert.equal(c.managerWelfareQuote(rounds.map(x=>x.player),300,null).discount,60);
  assert.equal(c.managerWelfareQuote(rounds.slice(0,2).map(x=>x.player),300,null).discount,0);
  c.MANAGER_LEDGER.push({id:'local-3',station:active.station_key,date:'2026-09-28',status:'已提交',welfareDiscount:60});
  assert.equal(c.managerWelfareUsesThisSeason(),3);
  assert.equal(c.managerWelfareQuote(rounds.map(x=>x.player),300,null).discount,0);
});
