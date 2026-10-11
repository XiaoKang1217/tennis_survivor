import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { mergeDrawPlayers } from '../lib/live-tennis-current-station.mjs';
import { buildStationPayload } from '../lib/station-payload.mjs';
const read=p=>JSON.parse(fs.readFileSync(p));
const active=read('data/manager/active_events.json');
const event=read('data/manager/'+active.events[0].data_file);
const html=fs.readFileSync('index.html','utf8');
const source=(name,next)=>html.slice(html.indexOf(`function ${name}(`),html.indexOf(`function ${next}(`,html.indexOf(`function ${name}(`)));
test('Wuhan purchase scope, 1-4 exception and separate Shanghai ownership',()=>{
  assert.equal(active.station_key,'2026-w42-wuhan');
  assert.equal(active.events.length,1);assert.equal(active.events[0].tour,'WTA');
  assert.equal(event.players.length,56);assert.equal(new Set(event.players.map(p=>p.draw_position)).size,56);
  assert.equal(event.players.filter(p=>p.is_qualifier_placeholder).length,8);
  assert.equal(active.rules.station_grant,700);assert.equal(active.rules.combo.value_pick.max_price,135);
  assert.equal(Date.parse(event.submission_cutoff_at),Date.parse('2026-10-12T11:00:00+08:00'));
  const payload=buildStationPayload({active,events:[{item:active.events[0],event}]});
  assert.deepEqual(payload.stationConfigRow.metadata.roster,{min_players:1,max_players:4});
  assert.equal(payload.eventRows.length,1);assert.equal(payload.eventRows[0].station_key,active.station_key);
  assert.equal(active.continuing_stations[0].station_key,'2026-w41-shanghai');
  assert.equal(active.previous_station.station_key,'2026-w40-beijing');
  assert.equal(read('data/manager/events/atp-2026-w41-shanghai.json').station_key,'2026-w41-shanghai');
});
test('frozen Wuhan prices survive qualifier placement and incoming repricing',()=>{
  assert.equal(active.pricing.market_prices_locked,true);
  const incoming=event.players.map(p=>({...p,price:999,...(p.is_qualifier_placeholder?{name_en:'Winner '+p.draw_position,player_key:'WTA|winner-'+p.draw_position,is_qualifier_placeholder:false,profile_id:'new'+p.draw_position}:{})}));
  const merged=mergeDrawPlayers(event,incoming,'test');
  event.players.forEach(p=>assert.equal(merged.find(x=>x.draw_position===p.draw_position).price,p.price));
});
test('combo rewards capped at 1000 and welfare third permitted, fourth denied',()=>{
  const order=['OUT','R128','R64','R32','R16','QF','SF','F','W'];
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,MANAGER_REMOTE_STATE:null,MANAGER_LEDGER:[],managerSeason:()=>2026,
    managerVillageHopePlayer:r=>r[0],managerVillageHopeUserSelected:()=>true,managerPlayerDisplayName:p=>p.id,
    managerRoundAtLeast:(a,b)=>order.indexOf(a)>=order.indexOf(b)});
  vm.runInContext(source('managerComboRewardText','managerCanadaComboRuleCard')+source('managerCanadaRoundReward','managerVillageHopePlayer')+source('managerCanadaComboScenario','managerWimbledonJewelBonus')+source('managerWelfareConfig','managerCalc'),c);
  const rounds=[0,1,2].map(id=>({player:{id:String(id),tour:'WTA',price:100},round:'W'}));
  const result=c.managerCanadaComboScenario(5000,rounds);
  assert.equal(result.comboItems.length,3);assert.equal(result.comboRaw,1800);assert.equal(result.bonus,1000);assert.equal(result.stable,300);
  for(const [round,reward,hope] of [['R16',150,150],['QF',250,250],['SF',350,350],['F',550,550],['W',700,800]]){
    const r=c.managerCanadaComboScenario(1000,rounds.map(x=>({...x,round})));
    assert.equal(r.jewelBonus,reward);assert.equal(r.villageHopeBonus,hope);
  }
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:2};assert.equal(c.managerWelfareQuote(rounds.map(x=>x.player),500,null).discount,60);
  c.MANAGER_REMOTE_STATE={welfare_uses_this_season:3};assert.equal(c.managerWelfareQuote(rounds.map(x=>x.player),300,null).discount,0);
});
test('grouped income deduplicates contexts, excludes Beijing from current, keeps popup totals',()=>{
  const row=(id,station,amount)=>({id,station_key:station,amount,type:'player_points_delta',created_at:'2026-10-12T14:00:00Z'});
  const rows=[row('s','2026-w41-shanghai',100),row('w',active.station_key,200),row('b','2026-w40-beijing',300)];
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,MANAGER_REMOTE_STATE:{},AUTH_USER:{id:'u'},managerStationKey:()=>active.station_key,
    managerRemoteLedgerContexts:()=>[{state:{ledger:rows}},{state:{ledger:[rows[0]]}}],managerVisibleLedgerRows:r=>r,
    managerLedgerRowStationKey:r=>r.station_key,managerIncomePartsFromRow:r=>({kind:'player',amount:r.amount}),
    managerChinaDateKey:()=> '2026-10-12'});
  vm.runInContext(fs.readFileSync('assets/manager/station-groups.js','utf8'),c);
  assert.equal(c.managerGroupedStationIncome().total,300);
  const s=c.managerGroupedDailyIncomeSummary();assert.equal(s.groups[0].total.total,300);assert.equal(s.groups[1].total.total,300);assert.equal(s.careerTotal,600);
  assert.match(c.managerGroupedIncomeDialogText(s,'测试'),/本站：ATP 上海 \+ WTA 武汉/);
  assert.equal(c.managerPlayerPurchasable({tour:'ATP'}),false);assert.equal(c.managerPlayerPurchasable({tour:'WTA'}),true);
});
test('new prediction sources and continuing settlement are explicit',()=>{
  assert.equal(active.daily_prediction.starts_on,'2026-10-12');
  assert.deepEqual(active.daily_prediction.event_groups.map(g=>g.event_key),['atp-2026-w41-shanghai','wta-2026-w42-wuhan']);
  assert.match(fs.readFileSync('scripts/manager/settle-current-or-previous-station.mjs','utf8'),/active.continuing_stations/);
  const sql=fs.readFileSync('supabase/migrations/202610110001_manager_wuhan_notice_and_grouped_board.sql','utf8');
  assert.match(sql,/group by user_id/);assert.match(sql,/2026-10-12 11:00:00\+08/);assert.match(sql,/on conflict do nothing/);
});
