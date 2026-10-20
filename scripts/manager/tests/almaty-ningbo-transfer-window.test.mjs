import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {publishWindow, keys, opens, closes} from '../publish-almaty-ningbo-transfer-window.mjs';
const active=JSON.parse(fs.readFileSync('data/manager/active_events.json'));
const events=keys.map(key=>JSON.parse(fs.readFileSync(`data/manager/events/${key}.json`)));
test('fixed cross-tour window and copy agree',()=>{
  assert.equal(active.rules.cross_tour_transfer,true);
  assert.match(active.announcement,/10\/20 23:00.*10\/21 13:00/);
  for(const e of events){
    assert.equal(e.manual_schedule_windows,true);
    assert.equal(e.cross_tour_transfer,true);
    assert.equal(e.transfer_window_opens_at,opens);
    assert.equal(e.transfer_window_closes_at,closes);
    assert.match(e.transfer_window_note,/男女可互换/);
  }
});
test('transfer pool supports both directions, excluding already owned players',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const src=html.slice(html.indexOf('function managerCrossTourTransferEnabled('),html.indexOf('function managerTransferOptionLabel('));
  const pool=events.map((e,i)=>({id:String(i),eventKey:e.event_key,tour:e.tour}));
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:active,managerContestPacks:()=>events.map(e=>({event:e,meta:{eventKey:e.event_key}})),managerBuildPool:()=>pool,managerSelected:id=>id==='0'});
  vm.runInContext(src,c);
  assert.equal(c.managerEligibleTransferPool(pool[0])[0].tour,'WTA');
  c.managerSelected=id=>id==='1';
  assert.equal(c.managerEligibleTransferPool(pool[1])[0].tour,'ATP');
  assert.match(c.managerTransferCrossNotice(),/男女可互换/);
});
test('publisher preserves other fields and is repeatable; missing event blocks all writes',async()=>{
  let rows=events.map(e=>({event_key:e.event_key,metadata:{untouched:'keep'}}));
  let writes=0;
  const client={select:async()=>structuredClone(rows),update:async(table,values,q)=>{
    assert.equal(table,'tour_manager_events');
    assert.deepEqual(Object.keys(values).sort(),['metadata','transfer_window_closes_at','transfer_window_note','transfer_window_opens_at']);
    const row=rows.find(r=>'eq.'+r.event_key===q.event_key);Object.assign(row,values);writes++;return [row];
  }};
  await publishWindow(client);const first=structuredClone(rows);await publishWindow(client);
  assert.deepEqual(rows,first);assert.ok(rows.every(r=>r.metadata.untouched==='keep'));
  const before=writes;
  await assert.rejects(publishWindow({...client,select:async()=>rows.slice(0,1)}));
  assert.equal(writes,before);
});
