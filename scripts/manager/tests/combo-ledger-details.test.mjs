import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const themeCss = fs.readFileSync('assets/theme/full-site-badge-themes.css', 'utf8');
const migration = fs.readFileSync('supabase/migrations/202607170004_manager_combo_ledger_detail_context.sql', 'utf8');

test('Combo ledger display prefers per-rule entitlement details over delta wrappers', () => {
  assert.match(html, /meta\.combo_entitled_details/);
  assert.match(html, /item&&item\.key==='combo_delta'/);
  assert.match(html, /players\.join\('\/'\)/);
  assert.match(html, /context\.join\('，'\)/);
});

test('normal Combo rules expose rule-specific evidence', () => {
  assert.match(html, /key==='steady'[\s\S]+?毛收益/);
  assert.match(html, /key==='dual'[\s\S]+?highestCommonTourRound/);
  assert.match(html, /key==='jewel'[\s\S]+?jewelRound/);
  assert.match(html, /key==='small_budget'[\s\S]+?阵容成本/);
  assert.match(html, /managerComboMultipleText/);
});

test('Combo ledger renders the exact player and business evidence format', () => {
  const start = html.indexOf('function managerComboPlainContractName');
  const end = html.indexOf('function managerLedgerDisplayAmounts', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    managerDisplayNameWithOriginal: name => name,
    managerOriginalNameFromMeta: () => '',
    managerRoundIndex: round => ['OUT', 'R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', 'W'].indexOf(round),
    managerRoundAtLeast: (round, threshold) => ['OUT', 'R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', 'W'].indexOf(round) >= ['OUT', 'R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', 'W'].indexOf(threshold),
  };
  vm.runInNewContext(html.slice(start, end), context);

  const contracts = [
    { name_zh: '卢布列夫', tour: 'ATP', tier: 'A', reached_round: 'QF', earned_points: 50, price: 120, is_active: true },
    { name_zh: '郑钦文', tour: 'WTA', tier: 'B', reached_round: 'QF', earned_points: 54, price: 95, is_active: true },
  ];
  const standard = context.managerComboLedgerDetailTokens({
    combo_version: 'normal_2026_v2_daily_delta', gross: 104,
    combo_details: [{ key: 'combo_delta', label: 'Combo升档补差', bonus: 24 }],
    combo_entitled_details: [
      { key: 'steady', label: '稳健经营', bonus: 8 },
      { key: 'dual', label: '双线经营', bonus: 20 },
    ],
  }, 'station_combo_bonus', contracts, { lineup_cost: 215 });
  assert.deepEqual(Array.from(standard), [
    '稳健经营+8（卢布列夫/郑钦文，毛收益104）',
    '双线经营+20（卢布列夫/郑钦文，QF）',
  ]);

  const business = context.managerComboLedgerDetailTokens({
    combo_version: 'normal_2026_v2_daily_delta', gross: 300,
    combo_entitled_details: [{ key: 'small_budget', label: '小本经营', bonus: 50 }],
  }, 'station_combo_bonus', contracts, { lineup_cost: 200 });
  assert.deepEqual(Array.from(business), ['小本经营+50（毛收益300，阵容成本200，1.5倍）']);

  const jewelContracts = [{ name_zh: '黑马球员', tour: 'WTA', tier: 'D', reached_round: 'SF', price: 40, is_active: true }];
  const jewel = context.managerComboLedgerDetailTokens({
    combo_version: 'normal_2026_v2_daily_delta', gross: 45,
    combo_entitled_details: [{ key: 'jewel', label: '慧眼识珠', bonus: 45 }],
  }, 'station_combo_bonus', jewelContracts, { lineup_cost: 40 });
  assert.deepEqual(Array.from(jewel), ['慧眼识珠+45（黑马球员，SF）']);
});

test('backend freezes Combo players and context without touching money', () => {
  assert.match(migration, /tour_manager_combo_ledger_details/);
  assert.match(migration, /'players', v_players, 'context', v_context/);
  assert.match(migration, /v_key = 'steady'[\s\S]+?'毛收益'/);
  assert.match(migration, /v_key = 'dual'[\s\S]+?v_round/);
  assert.match(migration, /v_key = 'jewel'[\s\S]+?limit 1/);
  assert.match(migration, /v_key = 'small_budget'[\s\S]+?'阵容成本'/);
  assert.match(migration, /set metadata = metadata/);
  assert.doesNotMatch(migration, /set\s+balance\s*=|balance_after\s*=|set\s+amount\s*=/i);
});

test('daily prediction cards use full-site skin variables', () => {
  assert.match(themeCss, /每日竞猜/);
  assert.match(themeCss, /body\.luwang-site-skin \.manager-prediction-card/);
  assert.match(themeCss, /body\.luwang-site-skin \.manager-prediction-option\.on/);
  assert.match(themeCss, /body\.luwang-site-skin \.manager-prediction-result\.ok/);
  assert.match(themeCss, /var\(--site-accent-soft\)/);
  assert.match(themeCss, /var\(--site-surface-raised\)/);
});
