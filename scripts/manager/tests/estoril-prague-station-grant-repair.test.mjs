import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const refresh = fs.readFileSync('scripts/manager/refresh-current-station-data.mjs', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202607190002_manager_estoril_prague_station_grant_repair.sql',
  'utf8'
);
const html = fs.readFileSync('index.html', 'utf8');

test('current-station refresh syncs and verifies station config before settlement', () => {
  const configAt = refresh.indexOf("client.upsert('tour_manager_station_configs'");
  const eventsAt = refresh.indexOf("client.upsert('tour_manager_events'");
  const rulesAt = refresh.indexOf("client.rpc('tour_manager_station_rules'");
  assert.ok(configAt >= 0);
  assert.ok(eventsAt > configAt);
  assert.ok(rulesAt > eventsAt);
  assert.match(refresh, /station grant sync mismatch/);
});

test('repair restores 200 grant and refunds only the excess principal allocation', () => {
  assert.match(migration, /'2026-w30-estoril-prague'[\s\S]+?200[\s\S]+?'normal_2026_v2'/);
  assert.match(migration, /v_wallet_used_after := greatest\(v_lineup\.lineup_cost - v_station_grant, 0\)/);
  assert.match(migration, /v_principal_refund := greatest\(v_lineup\.wallet_used - v_wallet_used_after, 0\)/);
  assert.match(migration, /balance = balance \+ v_principal_refund/);
  assert.match(migration, /lineup_principal_allocation_refund/);
  assert.match(migration, /exclude_from_income', true/);
});

test('repair ledger has a user-facing label and is excluded from station income', () => {
  assert.match(html, /lineup_principal_allocation_refund\|transfer/);
  assert.match(html, /签约金配置修复退款/);
});
