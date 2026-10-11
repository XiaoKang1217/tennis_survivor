import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const js=fs.readFileSync('assets/manager/station-opening.js','utf8');
const sql=fs.readFileSync('supabase/migrations/202610110001_manager_wuhan_notice_and_grouped_board.sql','utf8');

test('homepage and notice share the compressed new group QR',()=>{
  const html=fs.readFileSync('index.html','utf8');
  assert.match(html,/MANAGER_GROUP_QR_SRC='assets\/manager\/wechat-group-20261011.png'/);
  assert.match(js,/querySelector\('img'\).src = MANAGER_GROUP_QR_SRC/);
  assert.match(js,/<figcaption>经纪人新群聊<\/figcaption>/);
  assert.ok(fs.statSync('assets/manager/wechat-group-20261011.png').size<50000);
});

test('account-wide once-only claim is atomic and derives identity from auth',()=>{
  assert.match(sql,/v_user uuid := auth.uid\(\)/);
  assert.match(sql,/on conflict do nothing/);
  assert.match(sql,/revoke all on function.*from public, anon/);
  assert.doesNotMatch(sql,/update public.tour_manager_wallet|insert into public.tour_manager_wallet/);
  assert.match(js,/>好的<.*>不了，谢谢</);
  assert.match(js,/modal.close\(\); modal.remove\(\);/);
});

test('repeated loads claim once, local previews never claim, account switches reset',async()=>{
  let requests=0,shown=0,preview=false;
  const c=vm.createContext({AUTH_USER:{id:'a'},MANAGER_ACTIVE_EVENTS:{station_key:'2026-w42-wuhan',opening_notice:{rpc:'tour_manager_take_wuhan_opening_notice',closes_at:'2026-10-12T11:00:00+08:00'}},
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

test('removed opening configuration never requests or renders a notice',async()=>{
  const c=vm.createContext({MANAGER_ACTIVE_EVENTS:{}});
  vm.runInContext(js,c);
  await c.managerLoadOpeningNotice();
  c.managerShowOpeningNotice({message:'notice'});
});

test('Wuhan cutoff blocks every account and discards a response crossing the deadline',async()=>{
  let now=Date.parse('2026-10-12T02:59:59Z'),requests=0,shown=0;
  const cutoff=Date.parse('2026-10-12T03:00:00Z');
  const c=vm.createContext({AUTH_USER:{id:'a'},MANAGER_ACTIVE_EVENTS:{opening_notice:{rpc:'test',closes_at:'2026-10-12T11:00:00+08:00'}},
    MANAGER_DIALOG:null,MANAGER_BADGE_GRANT_NOTICE:null,managerLocalSimulationMode:()=>false,
    Date:class extends Date{static now(){return now;}},document:{hidden:false,querySelector:()=>null},
    supabaseRpc:async()=>{requests++;now=cutoff;return {message:'notice'};}});
  vm.runInContext(js,c);c.managerShowOpeningNotice=()=>shown++;
  await c.managerLoadOpeningNotice();assert.equal(requests,1);assert.equal(shown,0);
  c.AUTH_USER={id:'b'};await c.managerLoadOpeningNotice();assert.equal(requests,1);
});
