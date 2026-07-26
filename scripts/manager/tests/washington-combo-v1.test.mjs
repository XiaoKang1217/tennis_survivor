import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const active = JSON.parse(fs.readFileSync('data/manager/active_events.json', 'utf8'));
const html = fs.readFileSync('index.html', 'utf8');
const migrationV1 = fs.readFileSync(
  'supabase/migrations/202607260001_manager_washington_combo_v1.sql',
  'utf8',
);
const migrationV2 = fs.readFileSync(
  'supabase/migrations/202607260002_manager_washington_combo_v2.sql',
  'utf8',
);
const openingPublication = JSON.parse(fs.readFileSync(
  'data/manager/publications/2026-w31-washington-v1.json',
  'utf8',
));

function washingtonScenario(gross, rounds) {
  const start = html.indexOf('function managerWashingtonComboScenario');
  const end = html.indexOf('function managerWimbledonJewelBonus', start);
  assert.ok(start >= 0 && end > start);
  const order = ['OUT', 'R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', 'W'];
  const context = {
    MANAGER_ACTIVE_EVENTS: active,
    managerRoundAtLeast: (round, threshold) => order.indexOf(round) >= order.indexOf(threshold),
  };
  vm.runInNewContext(html.slice(start, end), context);
  return context.managerWashingtonComboScenario(gross, rounds);
}

test('Washington publishes the confirmed station-specific Combo contract', () => {
  const { rules } = active;
  assert.equal(rules.station_grant, 500);
  assert.equal(rules.combo_version, 'washington_2026_v2');
  assert.equal(rules.combo_design_status, 'confirmed');
  assert.equal(rules.combo.total_cap, 400);
  assert.deepEqual(rules.combo.steady, {
    min_players: 2,
    qf_ratio: 0.5,
    gross_rate: 0.08,
    cap: 80,
  });
  assert.deepEqual(rules.combo.dual_tour, { QF: 60, SF: 120, F: 200, W: 300 });
  assert.deepEqual(rules.combo.value_pick, {
    max_price: 100,
    QF: 50,
    SF: 100,
    F: 150,
    W: 200,
    max_triggers: 1,
  });
  assert.deepEqual(rules.combo.small_budget, {
    max_cost: 500,
    gross_multipliers: [0.75, 1, 1.25, 1.5],
    bonuses: [50, 100, 150, 200],
  });
});

test('Washington calculator applies all four rules and caps the combined reward at 400', () => {
  const rounds = [
    { player: { tour: 'ATP', price: 100 }, round: 'W' },
    { player: { tour: 'WTA', price: 100 }, round: 'W' },
  ];
  const result = washingtonScenario(300, rounds);
  assert.equal(result.stable, 24);
  assert.equal(result.dualBonus, 300);
  assert.equal(result.jewelBonus, 200);
  assert.equal(result.smallBusinessBonus, 200);
  assert.equal(result.comboRaw, 724);
  assert.equal(result.comboCap, 400);
  assert.equal(result.bonus, 400);
  assert.equal(result.comboVersion, 'washington_2026_v2');
});

test('Washington small-business ladder starts at 0.75x and uses the highest reached tier', () => {
  const rounds = [{ player: { tour: 'ATP', price: 200 }, round: 'OUT' }];
  assert.equal(washingtonScenario(149, rounds).smallBusinessBonus, 0);
  assert.equal(washingtonScenario(150, rounds).smallBusinessBonus, 50);
  assert.equal(washingtonScenario(200, rounds).smallBusinessBonus, 100);
  assert.equal(washingtonScenario(250, rounds).smallBusinessBonus, 150);
  assert.equal(washingtonScenario(300, rounds).smallBusinessBonus, 200);
});

test('Washington value pick is price-based rather than tier-based', () => {
  const eligible = washingtonScenario(0, [
    { player: { tour: 'ATP', tier: 'S', price: 100 }, round: 'SF' },
  ]);
  const ineligible = washingtonScenario(0, [
    { player: { tour: 'ATP', tier: 'D', price: 101 }, round: 'SF' },
  ]);
  assert.equal(eligible.jewelBonus, 100);
  assert.equal(ineligible.jewelBonus, 0);
});

test('current and calculator rule cards render Washington values from station config', () => {
  assert.match(html, /policy==='washington_2026_v1'\|\|policy==='washington_2026_v2'/);
  assert.match(html, /c\.comboVersion==='washington_2026_v1'\|\|c\.comboVersion==='washington_2026_v2'/);
  assert.match(html, /签约价不高于/);
  assert.match(html, /value\.max_price/);
  assert.match(html, /small\.gross_multipliers/);
  assert.match(html, /small\.bonuses/);
});

test('Washington v1 opening publication remains immutable after the v2 rule amendment', () => {
  assert.equal(openingPublication.combo_version, 'washington_2026_v1');
  assert.deepEqual(openingPublication.snapshot.station_config.combo.value_pick, {
    max_price: 100,
    QF: 20,
    SF: 45,
    F: 80,
    W: 125,
    max_triggers: 1,
  });
});

test('backend preserves v1 and legacy routes while adding Washington v2', () => {
  assert.match(
    migrationV1,
    /alter function public\.tour_manager_apply_station_combo\(text, int\)[\s\S]+?rename to tour_manager_apply_station_combo_legacy_20260719/,
  );
  assert.match(migrationV2, /if v_combo_version = 'washington_2026_v2'/);
  assert.match(migrationV2, /if v_combo_version = 'washington_2026_v1'/);
  assert.match(
    migrationV2,
    /return public\.tour_manager_apply_station_combo_legacy_20260719\(p_station_key, p_season\)/,
  );
});

test('backend keeps serialized daily delta settlement and detailed entitlement evidence', () => {
  assert.match(migrationV2, /pg_advisory_xact_lock/);
  assert.match(migrationV2, /v_bonus_delta := greatest\(v_entitled_bonus - v_paid_bonus, 0\)/);
  assert.match(migrationV2, /'combo_version', v_combo_version \|\| '_daily_delta'/);
  assert.match(migrationV2, /'combo_details', v_delta_details/);
  assert.match(migrationV2, /'combo_entitled_details', v_combo_details/);
  assert.match(migrationV2, /v_gross \* 4 >= v_lineup\.lineup_cost \* 3[\s\S]+?v_small_bonus := 50/);
  assert.match(migrationV2, /v_gross \* 4 >= v_lineup\.lineup_cost \* 6[\s\S]+?v_small_bonus := 200/);
  assert.match(migrationV2, /coalesce\(\(metadata #>> '\{combo,value_pick,QF\}'\)::int, 50\)/);
  assert.match(migrationV2, /coalesce\(\(metadata #>> '\{combo,value_pick,SF\}'\)::int, 100\)/);
  assert.match(migrationV2, /coalesce\(\(metadata #>> '\{combo,value_pick,F\}'\)::int, 150\)/);
  assert.match(migrationV2, /coalesce\(\(metadata #>> '\{combo,value_pick,W\}'\)::int, 200\)/);
});
