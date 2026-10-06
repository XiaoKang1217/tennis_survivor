import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const js=fs.readFileSync('assets/manager/station-opening.js','utf8');
const sql=fs.readFileSync('supabase/migrations/202610060002_manager_shanghai_opening_notice.sql','utf8');

test('account-wide once-only claim is atomic and derives identity from auth',()=>{
  assert.match(sql,/primary key \(user_id, notice_key\)/);
  assert.match(sql,/v_user uuid := auth.uid\(\)/);
  assert.match(sql,/on conflict do nothing/);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on function.*from public, anon/);
  assert.doesNotMatch(sql,/update public.tour_manager_wallet|insert into public.tour_manager_wallet/);
  assert.match(js,/>好的<.*>不了，谢谢</);
  assert.match(js,/modal.close\(\); modal.remove\(\);/);
});

test('repeated loads claim once, local previews never claim, account switches reset',async()=>{
  let requests=0,shown=0,preview=false;
  const c=vm.createContext({AUTH_USER:{id:'a'},MANAGER_ACTIVE_EVENTS:{station_key:'2026-w41-shanghai'},
    MANAGER_DIALOG:null,MANAGER_BADGE_GRANT_NOTICE:null,managerLocalSimulationMode:()=>preview,
    Date:class extends Date{static now(){return Date.parse('2026-10-06T10:00:00Z');}},
    document:{hidden:false,querySelector:()=>null,getElementById:()=>null},
    clearTimeout(){},setTimeout(){},supabaseRpc:async()=>{requests++;return {message:'notice'};}});
  vm.runInContext(js,c);c.managerShowOpeningNotice=()=>shown++;
  await c.managerLoadOpeningNotice();await c.managerLoadOpeningNotice();
  assert.equal(requests,1);assert.equal(shown,1);
  c.managerResetOpeningNotice();c.AUTH_USER={id:'b'};
  await c.managerLoadOpeningNotice();assert.equal(requests,2);
  preview=true;c.managerResetOpeningNotice();await c.managerLoadOpeningNotice();assert.equal(requests,2);
});
