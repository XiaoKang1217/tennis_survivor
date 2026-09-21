import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('function managerPredictionSummaryReferenceDate('),html.indexOf('async function managerLoadDailyPredictions('));
function setup(){
 const calls=[];
 const c=vm.createContext({Date,AUTH_USER:{id:'u'},MANAGER_DAILY_PREDICTIONS:null,
  MANAGER_DAILY_PREDICTION_SUMMARY:null,MANAGER_DAILY_PREDICTION_SUMMARY_KEY:'',
  MANAGER_DAILY_PREDICTION_SUMMARY_SYNC_AT:0,MANAGER_DAILY_PREDICTION_SUMMARY_LOADING:null,
  supabaseConfigured:()=>true,authErrorText:e=>e.message,trackSupabaseError:()=>{},
  managerLoadDailyPredictions:async()=>{c.MANAGER_DAILY_PREDICTIONS={contest_date:'2026-09-22'};},
  ensureSupabaseClient:async()=>({rpc:async(name,args)=>{
   calls.push(args.p_reference_date);
   return {data:{previous_contest_date:'2026-09-21'}};
  }})});
 vm.runInContext(source,c);return {c,calls};
}
test('summary waits for published contest date and uses it as reference',async()=>{
 const {c,calls}=setup();
 await c.managerLoadDailyPredictionSummary();
 assert.deepEqual(calls,['2026-09-22']);
 assert.equal(c.MANAGER_DAILY_PREDICTION_SUMMARY.previous_contest_date,'2026-09-21');
 assert.equal(c.managerDailyPredictionSummaryIsFresh(),true);
 await c.managerLoadDailyPredictionSummary();assert.equal(calls.length,1);
 c.MANAGER_DAILY_PREDICTIONS.contest_date='2026-09-23';
 assert.equal(c.managerDailyPredictionSummaryIsFresh(),false);
});
test('response for an obsolete contest date cannot overwrite the current summary',async()=>{
 const {c}=setup();let finish;
 c.ensureSupabaseClient=async()=>({rpc:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=c.managerLoadDailyPredictionSummary();
 while(!finish)await new Promise(resolve=>setImmediate(resolve));
 c.MANAGER_DAILY_PREDICTIONS.contest_date='2026-09-23';
 finish({data:{previous_contest_date:'2026-09-21'}});await pending;
 assert.equal(c.MANAGER_DAILY_PREDICTION_SUMMARY,null);
});
test('missing contest date does not fall back to the Beijing calendar',async()=>{
 const {c,calls}=setup();c.managerLoadDailyPredictions=async()=>null;
 await c.managerLoadDailyPredictionSummary();assert.equal(calls.length,0);
});
