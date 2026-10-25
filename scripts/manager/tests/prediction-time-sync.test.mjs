import test from 'node:test';
import assert from 'node:assert/strict';
import { syncOpenPredictionTimes } from '../lib/daily-prediction-selection.mjs';

const game = {id:'game',event_key:'tokyo',match_key:'tokyo:LS019',event_date:'2026-10-26',
  player1_key:'a',player2_key:'b',scheduled_at:'2026-10-27T02:00:00Z',closes_at:'2026-10-27T02:00:00Z'};
const match = {status:'scheduled',raw:{date:'2026-10-26'},player1_key:'a',player2_key:'b',scheduled_at:'2026-10-26T04:30:00Z'};
function fixture(overrides={}) {
  const saved = {...game};
  const writes=[];
  return {saved,writes,client:{
    async select(table) {return table==='tour_manager_matches' ? [{...match,...overrides}] : [saved];},
    async update(table,values,query) {writes.push({table,values,query});Object.assign(saved,values);return [saved];}
  }};
}
test('corrects existing Tokyo time without replacing identity or picks; rerun is idempotent',async()=>{
  const f=fixture();
  assert.equal(await syncOpenPredictionTimes(f.client,'station',2026),1);
  assert.equal(f.saved.closes_at,match.scheduled_at);
  assert.equal(f.saved.id,game.id);
  assert.deepEqual(Object.keys(f.writes[0].values).sort(),['closes_at','scheduled_at','updated_at']);
  assert.equal(await syncOpenPredictionTimes(f.client,'station',2026),0);
});
for(const overrides of [{status:'live'},{status:'completed'},{raw:{date:'2026-10-27'}},{player2_key:'other'},{scheduled_at:null}]) {
  test(`does not change an unverified fixture ${JSON.stringify(overrides)}`,async()=>{
    const f=fixture(overrides);
    assert.equal(await syncOpenPredictionTimes(f.client,'station',2026),0);
    assert.equal(f.writes.length,0);
  });
}
