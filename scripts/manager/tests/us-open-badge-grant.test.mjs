import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('index.html','utf8');
const sql=fs.readFileSync('supabase/migrations/202609200001_manager_us_open_badge_grant.sql','utf8');
test('US Open exact copy and buttons; Wimbledon remains distinct',()=>{
  const c=vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('function managerBadgeGrantCopy('),html.indexOf('function managerRenderBadgeGrantNotice(')),c);
  const copy=c.managerBadgeGrantCopy({badge_key:'usopen-night-2026'});
  assert.equal(copy.message,'由于您参与了经纪人2026美网赛事，恭喜您获得了「2026美网限定·不夜之境」！');
  assert.equal(copy.equip,'立马佩戴');assert.equal(copy.later,'稍后佩戴');
  assert.match(c.managerBadgeGrantCopy({badge_key:'wimbledon-2026'}).message,/温网/);
});
test('grant is guarded, deduplicated, non-equipping and leaves owned badges intact',()=>{
  assert.match(sql,/select distinct user_id/);
  assert.match(sql,/season = 2026/);
  assert.match(sql,/<> 80/);
  assert.match(sql,/on conflict \(user_id, badge_key\) do nothing/);
  assert.match(sql,/select user_id, 'usopen-night-2026', false/);
  assert.doesNotMatch(sql,/\b(?:insert into|update|delete from)\s+(?:public\.)?tour_manager_(?:wallets|wallet_ledger|lineups|lineup_players)\b/i);
});
test('notification uses auth identity and a database row lock, not device storage',()=>{
  assert.match(sql,/v_user uuid := auth.uid\(\)/);
  assert.match(sql,/ub.user_id = v_user/);
  assert.match(sql,/for update of ub skip locked/);
  assert.match(sql,/grant_notified_at is null/);
  assert.match(sql,/set grant_notified_at = now\(\)/);
  assert.match(sql,/'us_open_event_grant'/);
  assert.match(html,/supabaseRpc\('tour_manager_take_us_open_badge_grant_notice'/);
});
