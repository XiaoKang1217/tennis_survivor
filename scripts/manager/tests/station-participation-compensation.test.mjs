import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = await readFile(new URL('../../../index.html', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../../../supabase/migrations/202607130003_manager_station_participation_compensation.sql', import.meta.url),
  'utf8'
);

function loadFunction(name, nextName, extras = {}) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf(`function ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  const context = vm.createContext({ ...extras });
  vm.runInContext(`${html.slice(start, end)};this.result=${name};`, context);
  return context.result;
}

test('qualifier placements retain their original Q slot in display names', () => {
  const originalName = loadFunction('managerOriginalNameFromMeta', 'managerDisplayNameWithOriginal');
  const displayName = loadFunction('managerDisplayNameWithOriginal', 'managerPlayerDisplayName');

  assert.equal(
    originalName({
      qualifier_replacement: {
        placeholder_name_zh: '资格赛选手 Q2',
        placeholder_name_en: 'Qualifier Q2'
      }
    }),
    '资格赛选手 Q2'
  );
  assert.equal(
    originalName({
      qualifier_replacement_from_name_zh: '资格赛选手 Q5',
      qualifier_replacement_from_name_en: 'Qualifier Q5'
    }),
    '资格赛选手 Q5'
  );
  assert.equal(displayName('塔格尔', '资格赛选手 Q2'), '塔格尔（原资格赛选手 Q2）');
  assert.match(
    html,
    /class="manager-name" title="'\+esc\(displayName\)\+'">'\+esc\(displayName\)\+'<\/div>/
  );
});

test('participation compensation is rendered as other station income', () => {
  const incomeParts = loadFunction('managerIncomePartsFromRow', 'managerStationIncomeSummary', {
    managerLedgerRowHidden: () => false
  });
  const statusText = loadFunction('managerLedgerStatusText', 'managerLedgerRowSortTime');

  assert.deepEqual(
    { ...incomeParts({ type: 'station_participation_compensation', amount: 120 }) },
    { kind: 'other', amount: 120 }
  );
  assert.equal(statusText('station_participation_compensation'), '本站参赛补偿');
});

test('compensation migration is one-time, principal-only, and scoped to active participants', () => {
  assert.match(migration, /v_station_key constant text := '2026-w29-bastad-athens'/);
  assert.match(migration, /v_amount constant int := 120/);
  assert.match(migration, /lineup\.status in \('submitted', 'locked', 'settling', 'settled'\)/);
  assert.match(migration, /ledger\.metadata ->> 'compensation_key' = v_compensation_key/);
  assert.match(migration, /set balance = balance \+ v_amount/);
  assert.match(migration, /'station_participation_compensation'/);
  assert.match(migration, /'income_category', 'other'/);
  assert.match(migration, /'exclude_from_income', false/);
  assert.match(migration, /station_participation_compensation_verification_failed/);
  assert.match(migration, /ledger\.amount = 120/);
  assert.doesNotMatch(migration, /update public\.tour_manager_lineups\s+set/i);
  assert.doesNotMatch(migration, /station_grant_used\s*=/i);
});
