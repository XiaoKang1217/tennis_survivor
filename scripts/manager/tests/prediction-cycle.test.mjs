import test from 'node:test';
import assert from 'node:assert/strict';
import {predictionCycle,shiftOfficialDate} from '../lib/prediction-cycle.mjs';
const events=[{event_key:'a',metadata:{timezone:'America/New_York'}}];
const match=(date,status='completed')=>({event_key:'a',raw:{date},status});
test('Asia evening and America morning both advance the completed official day',()=>{
 for(const scheduled_at of ['2026-09-21T12:00:00Z','2026-09-22T02:00:00Z']){
  assert.deepEqual(predictionCycle(events,[{...match('2026-09-21'),scheduled_at},match('2026-09-22','scheduled')],new Date('2026-09-22T03:00:00Z')),
   {throughDate:'2026-09-21',contestDate:'2026-09-22'});
 }
});
test('unfinished matches do not block advancing the official day',()=>{
 for(const status of ['scheduled','live','postponed']){
  assert.equal(predictionCycle(events,[match('2026-09-20'),match('2026-09-21'),match('2026-09-21',status)]).contestDate,'2026-09-22');
 }
});
test('missing tomorrow schedule does not select a later day',()=>{
 assert.equal(predictionCycle(events,[match('2026-09-21'),match('2026-09-23','scheduled')]).contestDate,'2026-09-22');
 assert.equal(predictionCycle(events,[]),null);
});
test('opening day, repeat runs, month and year boundaries',()=>{
 const rows=[match('2026-09-21','scheduled')];
 assert.deepEqual(predictionCycle(events,rows),{throughDate:'2026-09-20',contestDate:'2026-09-21'});
 assert.deepEqual(predictionCycle(events,rows),predictionCycle(events,rows));
 assert.equal(shiftOfficialDate('2026-12-31',1),'2027-01-01');
});

test('official raw date wins over Beijing and local clock dates; missing raw date is not guessed',()=>{
 assert.equal(predictionCycle(events,[{...match('2026-09-21'),scheduled_at:'2026-09-22T05:00:00Z'}],new Date('2026-09-22T06:00:00Z')).contestDate,'2026-09-22');
 assert.equal(predictionCycle(events,[{status:'completed',scheduled_at:'2026-09-21T00:00:00Z'}]),null);
 assert.throws(()=>shiftOfficialDate('2026-02-30',1));
});

test('future schedules and early walkovers do not advance D',()=>{
 assert.equal(predictionCycle(events,[match('2026-09-21'),{...match('2026-09-22','walkover'),scheduled_at:'2026-09-22T05:00:00Z'}],new Date('2026-09-21T15:00:00Z')).contestDate,'2026-09-22');
});
