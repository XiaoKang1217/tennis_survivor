import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');
function fn(name){
  const start=html.indexOf('async function '+name+'(');
  return html.slice(start,html.indexOf('\nfunction ',start));
}
function setup(rows=[],user=null){
  const calls=[];
  const query={};
  for(const method of ['select','in','eq','gte','lte'])query[method]=(...args)=>{calls.push([method,...args]);return query;};
  query.then=resolve=>Promise.resolve(resolve({data:rows}));
  const client={from:table=>{calls.push(['from',table]);return query;}};
  const c=vm.createContext({Date,AUTH_USER:user,MANAGER_DAILY_PREDICTIONS:null,MANAGER_DAILY_PREDICTIONS_KEY:'',MANAGER_DAILY_PREDICTIONS_LOADING:null,
    MANAGER_DAILY_PREDICTION_DRAFT:{},managerPredictionDataKey:()=> 'key',ensureSupabaseClient:async()=>client,
    managerDailyPredictionStationKeys:()=>['old','new'],managerDailyPredictionDateKeys:()=>['2026-09-18','2026-09-19'],managerSeason:()=>2026,
    managerStationKey:()=> 'new',authErrorText:e=>e.message,trackSupabaseError:()=>{},
    managerDailyPredictionSetHasOpenGame:d=>d.games.some(g=>g.status==='open'&&Date.parse(g.closes_at)>Date.now())});
  vm.runInContext(fn('managerLoadDailyPredictions'),c);
  return {c,calls,client};
}
const game=(extra={})=>({id:'1',station_key:'old',contest_date:'2026-09-18',tour:'WTA',status:'open',closes_at:'2099-01-01T00:00:00Z',...extra});
test('one range request retains cross-day games and caches the result',async()=>{
  const {c,calls}=setup([game()]);
  const data=await c.managerLoadDailyPredictions();
  assert.equal(data.carried_over,true);assert.equal(data.games[0].id,'1');
  await c.managerLoadDailyPredictions();
  assert.equal(calls.filter(x=>x[0]==='from').length,1);
  assert.equal(calls.find(x=>x[0]==='select')[1],'*');
});
test('authenticated query embeds only RLS-filtered picks; expired games close',async()=>{
  const {c,calls}=setup([game({station_key:'new',contest_date:'2026-09-19',closes_at:'2000-01-01',my_pick:[{picked_player_key:'A'}]})],{id:'user'});
  const data=await c.managerLoadDailyPredictions();
  assert.equal(data.games[0].status,'closed');assert.equal(data.games[0].my_pick.picked_player_key,'A');
  assert.match(calls.find(x=>x[0]==='select')[1],/my_pick:/);
});
test('empty range returns today and concurrent loads share one request',async()=>{
  const {c,calls}=setup();
  const [a,b]=await Promise.all([c.managerLoadDailyPredictions(),c.managerLoadDailyPredictions()]);
  assert.equal(a,b);assert.equal(a.contest_date,'2026-09-19');assert.equal(a.games.length,0);
  assert.equal(calls.filter(x=>x[0]==='from').length,1);
});
test('submission reports success and unlocks button before background refresh completes',async()=>{
  const {c,client}=setup();let refreshDone,alert;
  Object.assign(c,{MANAGER_DAILY_PREDICTIONS:{games:[game()]},MANAGER_DAILY_PREDICTION_DRAFT:{1:'A'},MANAGER_DAILY_PREDICTION_SAVING:false,
    managerRequireLogin:()=>true,managerLocalQaMode:()=>false,managerSetMsg:()=>{},renderManagerDemo:()=>{},trackManagerEvent:()=>{},
    managerAlert:(msg,title)=>{alert=title;},managerPredictionErrorText:e=>e.message,MANAGER_VIEW:'prediction',
    managerLoadDailyPredictions:()=>new Promise(resolve=>{refreshDone=resolve;})});
  client.rpc=async()=>({data:{picks:[{game_id:'1',picked_player_key:'A'}]}});
  vm.runInContext(fn('managerSubmitDailyPredictions'),c);
  await c.managerSubmitDailyPredictions();
  assert.equal(alert,'竞猜已提交');assert.equal(c.MANAGER_DAILY_PREDICTION_SAVING,false);
  assert.equal(c.MANAGER_DAILY_PREDICTIONS.games[0].my_pick.picked_player_key,'A');
  refreshDone(null);
});
