import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {publishWindow} from '../publish-seoul-singapore-transfer-window.mjs';
const active=JSON.parse(fs.readFileSync('data/manager/active_events.json'));
const events=['seoul','singapore'].map(s=>JSON.parse(fs.readFileSync(`data/manager/events/wta-2026-w39-${s}.json`)));
test('both windows use explicit Beijing times and cross-event policy',()=>{
 assert.equal(active.rules.cross_tour_transfer,true);
 assert.match(active.announcement,/09\/23 01:00～09\/23 13:00/);
 for(const e of events){
  assert.equal(e.manual_schedule_windows,true);assert.equal(e.cross_tour_transfer,true);
  assert.equal(Date.parse(e.transfer_window_opens_at),Date.parse('2026-09-22T17:00:00Z'));
  assert.equal(Date.parse(e.transfer_window_closes_at),Date.parse('2026-09-23T05:00:00Z'));
 }
});
test('cross-event pool allows Seoul to Singapore and vice versa without reselecting owned players',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const src=html.slice(html.indexOf('function managerCrossTourTransferEnabled('),html.indexOf('function managerTransferOptionLabel('));
 const pool=events.map((e,i)=>({id:String(i),eventKey:e.event_key,tour:'WTA'}));
 const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,managerContestPacks:()=>events.map(e=>({event:e,meta:{eventKey:e.event_key}})),managerBuildPool:()=>pool,managerSelected:id=>id==='0'});
 vm.runInContext(src,c);
 assert.equal(c.managerEligibleTransferPool(pool[0])[0].eventKey,pool[1].eventKey);
 c.managerSelected=id=>id==='1';
 assert.equal(c.managerEligibleTransferPool(pool[1])[0].eventKey,pool[0].eventKey);
 assert.match(c.managerTransferCrossNotice(),/首尔、新加坡/);
});
test('publisher only patches window policy, preserves other metadata and is repeatable',async()=>{
 let rows=events.map(e=>({event_key:e.event_key,metadata:{untouched:'keep'}}));
 const client={select:async()=>structuredClone(rows),update:async(table,values,q)=>{
  assert.equal(table,'tour_manager_events');
  assert.deepEqual(Object.keys(values).sort(),['metadata','transfer_window_closes_at','transfer_window_note','transfer_window_opens_at']);
  const row=rows.find(r=>'eq.'+r.event_key===q.event_key);Object.assign(row,values);return [row];
 }};
 await publishWindow(client);const first=structuredClone(rows);await publishWindow(client);
 assert.deepEqual(rows,first);assert.ok(rows.every(r=>r.metadata.untouched==='keep'));
 await assert.rejects(publishWindow({...client,select:async()=>rows.slice(0,1)}));
});
