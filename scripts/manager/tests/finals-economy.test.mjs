import test from 'node:test';
import assert from 'node:assert/strict';
import {finalsQuote,finalsProgress,finalsSettlementDelta,FINALS_CUTOFF} from '../lib/finals-economy.mjs';
test('confirmed Beijing cutoff',()=>assert.equal(Date.parse(FINALS_CUTOFF),Date.parse('2026-11-08T20:00:00Z')));
test('RR payouts and fixed purchase cost',()=>{
  for(let wins=0;wins<=3;wins++)for(const top8 of [false,true]){
    const q=finalsQuote({wins,top8});
    assert.equal(q.cost,top8?0:1000);
    assert.equal(q.gross,wins*(top8?250:200));
  }
});
test('SF F W bonuses accumulate independently',()=>{
  for(const [stage,ordinary,elite] of [['SF',1400,2000],['F',3400,5000],['W',7400,11000]]){
    assert.equal(finalsQuote({wins:2,stage}).gross,ordinary);
    assert.equal(finalsQuote({wins:2,stage,top8:true}).gross,elite);
  }
  assert.equal(finalsQuote({wins:3,stage:'W',top8:true}).gross,11250);
});
test('group loss does not eliminate; win does not grant SF',()=>{
  const loss={id:'a',phase:'RR',completed:true,winnerId:'other'};
  const win={id:'b',phase:'RR',completed:true,winnerId:'p'};
  assert.deepEqual(finalsProgress({matches:[loss,win,win],playerId:'p'}),{wins:1,stage:'RR',groupEliminated:false});
  assert.equal(finalsProgress({matches:[loss],playerId:'p',groupComplete:true}).groupEliminated,true);
  assert.equal(finalsProgress({matches:[win],playerId:'p',qualifiedSF:true}).stage,'SF');
});
test('pending and knockout matches do not inflate RR wins',()=>{
  assert.equal(finalsProgress({playerId:'p',matches:[{id:'a',phase:'RR',completed:false,winnerId:'p'},{id:'b',phase:'SF',completed:true,winnerId:'p'}]}).wins,0);
});
test('repeat settlement pays zero and corrections require review',()=>{
  const q=finalsQuote({wins:2,stage:'SF',top8:true});
  assert.equal(finalsSettlementDelta(q,500),1500);
  assert.equal(finalsSettlementDelta(q,2000),0);
  assert.throws(()=>finalsSettlementDelta(q,2100));
});
