import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { mergeDrawPlayers } from '../lib/live-tennis-current-station.mjs';
import { buildStationPayload } from '../lib/station-payload.mjs';
import { predictionDateEnabled } from '../lib/prediction-cycle.mjs';
import { refreshDailyPredictionGamesByMedian } from '../lib/daily-prediction-selection.mjs';
const read=p=>JSON.parse(fs.readFileSync(p));
const active=read('data/manager/active_events.json');
const event=read('data/manager/'+active.events[0].data_file);
const html=fs.readFileSync('index.html','utf8');
const source=(name,next)=>html.slice(html.indexOf(`function ${name}(`),html.indexOf(`function ${next}(`,html.indexOf(`function ${name}(`)));

test('Shanghai-only market, grant, cutoff, isolated roster exception and prior ownership',()=>{
  assert.equal(active.station_key,'2026-w41-shanghai');
  assert.equal(active.rules.station_grant,700);
  assert.equal(active.events.length,1);
  assert.equal(event.players.length,96);
  assert.equal(new Set(event.players.map(p=>p.draw_position)).size,96);
  assert.equal(Date.parse(event.submission_cutoff_at),Date.parse('2026-10-07T11:45:00+08:00'));
  assert.equal(active.previous_station.station_key,'2026-w40-beijing');
  assert.equal(active.settlement.overlap_previous,true);
  assert.equal(read('data/manager/events/wta-2026-w40-beijing.json').station_key,'2026-w40-beijing');
  const payload=buildStationPayload({active,events:[{item:active.events[0],event}]});
  assert.deepEqual(payload.stationConfigRow.metadata.roster,{min_players:1,max_players:4});
  const context=vm.createContext({MANAGER_ACTIVE_EVENTS:active,MANAGER_LEVEL_CONFIG:{'1000':{min:2,max:3,sideGrant:500}},managerContestPacks:()=>[{meta:{level:'1000'}}],managerWallet:()=>300});
  vm.runInContext(source('managerRules','managerDemoLedgerAllowed'),context);
  assert.equal(context.managerRules().minPlayers,1);assert.equal(context.managerRules().maxPlayers,4);
  context.MANAGER_ACTIVE_EVENTS={rules:{}};
  assert.equal(context.managerRules().minPlayers,2);assert.equal(context.managerRules().maxPlayers,3);
});

test('opening price lock survives all 12 qualifier placements and source repricing',()=>{
  assert.equal(active.pricing.market_prices_locked,true);
  assert.equal(event.market_price_lock.publication_version,1);
  const incoming=event.players.map(p=>({...p,price:999,...(p.is_qualifier_placeholder?{name_en:'Qualifier Winner '+p.draw_position,player_key:'ATP|winner-'+p.draw_position,is_qualifier_placeholder:false,profile_id:'winner'+p.draw_position}:{})}));
  const merged=mergeDrawPlayers(event,incoming,'test');
  for(const p of event.players){
    const after=merged.find(x=>x.draw_position===p.draw_position);
    assert.equal(after.price,p.price);
    if(p.is_qualifier_placeholder)assert.equal(after.qualifier_replacement.placeholder_player_key,p.player_key);
  }
});

test('three Combo types cap at 1000; annual welfare third use allowed, fourth denied',()=>{
  const order=['OUT','R128','R64','R32','R16','QF','SF','F','W'];
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,MANAGER_REMOTE_STATE:null,MANAGER_LEDGER:[],managerSeason:()=>2026,
    managerVillageHopePlayer:r=>r[0],managerVillageHopeUserSelected:()=>true,managerPlayerDisplayName:p=>p.id,
    managerRoundAtLeast:(a,b)=>order.indexOf(a)>=order.indexOf(b)});
  vm.runInContext(source('managerComboRewardText','managerCanadaComboRuleCard')+source('managerCanadaRoundReward','managerVillageHopePlayer')+source('managerCanadaComboScenario','managerWimbledonJewelBonus')+source('managerWelfareConfig','managerCalc'),c);
  const rounds=[0,1,2].map(id=>({player:{id:String(id),tour:'ATP',price:100},round:'W'}));
  const result=c.managerCanadaComboScenario(5000,rounds);
  assert.equal(result.comboItems.length,3);assert.equal(result.comboRaw,1800);assert.equal(result.bonus,1000);
  assert.equal(result.stable,300);assert.equal(result.dualBonus,0);
  for(const [round,reward,hope] of [['R16',150,150],['QF',250,250],['SF',350,350],['F',550,550],['W',700,800]]){
    const q=c.managerCanadaComboScenario(1000,rounds.map(x=>({...x,round})));
    assert.equal(q.jewelBonus,reward);assert.equal(q.villageHopeBonus,hope);
    assert.equal(q.stable,round==='R16'?0:150);
  }
  c.managerComboSelectionFromRules=()=> 'user_selected_at_submission';
  c.managerComboRuleSection=(title,lines)=>title+' '+lines.join(' ');
  const text=c.managerCanadaComboRulesHtml(active.rules);
  assert.match(text,/三项赛果 Combo 合计封顶 1000/);assert.doesNotMatch(text,/双线经营|四项/);
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:2};
  assert.equal(c.managerWelfareQuote(rounds.map(x=>x.player),500,null).discount,60);
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:3};
  assert.equal(c.managerWelfareQuote(rounds.map(x=>x.player),300,null).discount,0);
});

test('Oct 7 predictions read each original station, never migrate Beijing WTA',async()=>{
  assert.equal(predictionDateEnabled(active.daily_prediction,'2026-10-06'),false);
  assert.equal(predictionDateEnabled(active.daily_prediction,'2026-10-07'),true);
  const queried=[];
  const client={async select(table,q){
    if(table==='tour_manager_events')queried.push(q);
    return [];
  }};
  await refreshDailyPredictionGamesByMedian({client,stationKey:active.station_key,season:2026,contestDate:'2026-10-07',now:'2026-10-06T15:00:00Z',eventGroups:active.daily_prediction.event_groups,exactEventDate:true});
  assert.deepEqual(queried.map(q=>[q.station_key,q.event_key]),[
    ['eq.2026-w41-shanghai','eq.atp-2026-w41-shanghai'],['eq.2026-w40-beijing','eq.wta-2026-w40-beijing']]);
});

test('overlapping daily income combines actual rows without dropping Beijing',()=>{
  let rows=[
    {kind:'player',amount:100,stationKey:'beijing',stationName:'北京',row:{created_at:'2026-10-07T14:00:00Z',metadata:{event_key:'wta-beijing'}}},
    {kind:'player',amount:30,stationKey:'shanghai',stationName:'上海',row:{created_at:'2026-10-07T14:00:00Z',metadata:{event_key:'atp-shanghai'}}},
    {kind:'combo',amount:150,stationKey:'beijing',stationName:'北京',row:{created_at:'2026-10-07T14:00:00Z',metadata:{}}}
  ];
  const c=vm.createContext({managerChinaDateKey:v=>v?v.slice(0,10):'2026-10-07',managerIncomeLedgerRows:()=>rows,
    managerContestPacks:()=>[{meta:{eventKey:'atp-shanghai'},event:{tour:'ATP',name_zh:'上海'}}],
    managerPreviousEventByKey:k=>k==='wta-beijing'?{tour:'WTA',name_zh:'北京'}:null});
  vm.runInContext(source('managerOverlappingDailyIncomeSummary','managerMaybeShowStationCompensationDialog').replace(/async\s*$/,''),c);
  const summary=c.managerOverlappingDailyIncomeSummary();
  assert.equal(summary.yesterdayIncome,280);assert.equal(summary.yesterdayCombo,150);
  assert.match(summary.stationName,/ATP 上海/);assert.match(summary.stationName,/WTA 北京/);
  rows=[];assert.equal(c.managerOverlappingDailyIncomeSummary(),null);
});

test('unstarted previous Beijing question also blocks the Shanghai cycle',async()=>{
  const client={async select(table,q){
    if(table==='tour_manager_daily_prediction_games'&&q.station_key==='eq.2026-w40-beijing'&&q.status==='eq.open')return [{id:'old',contest_date:'2026-10-06',closes_at:'2026-10-06T16:00:00Z'}];
    return [];
  }};
  const result=await refreshDailyPredictionGamesByMedian({client,stationKey:active.station_key,season:2026,contestDate:'2026-10-07',now:'2026-10-06T15:00:00Z',eventGroups:active.daily_prediction.event_groups,exactEventDate:true});
  assert.equal(result.skipped_active,true);assert.equal(result.created,0);
});
