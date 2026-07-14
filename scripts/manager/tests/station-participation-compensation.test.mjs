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
  const replacementInfo = loadFunction('managerCurrentReplacementInfo', 'managerPublicConfigPlayerName');

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
    /class="manager-origin" title="原为 '\+esc\(p\.originalName\)\+'">原为 '\+esc\(p\.originalName\)/
  );
  assert.match(html, /manager-player-title-line\{display:flex;flex-direction:column;align-items:flex-start/);
  assert.equal(
    replacementInfo({ event: { players: [{
      player_key: 'WTA|lilli-tagger',
      name_zh: '塔格尔',
      name_en: 'Lilli TAGGER',
      qualifier_replacement: {
        placeholder_player_key: 'WTA|qualifier-6',
        placeholder_name_zh: '资格赛选手 Q2',
        replacement_player_key: 'WTA|lilli-tagger',
        replacement_name_zh: '塔格尔'
      }
    }] } }, '', '塔格尔', {}).originalName,
    '资格赛选手 Q2'
  );
  assert.equal(
    replacementInfo({ event: { players: [{
      player_key: 'WTA|miriana-tona',
      name_zh: '托纳',
      name_en: 'Miriana TONA',
      pre_r1_substitution: {
        out_player_key: 'WTA|ajla-tomljanovic',
        out_name_zh: '汤姆亚诺维奇',
        replacement_player_key: 'WTA|miriana-tona',
        replacement_name_zh: '托纳'
      }
    }] } }, '', '托纳', {}).originalName,
    '汤姆亚诺维奇'
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

test('player yesterday income is derived from the same daily ledger as the team total', () => {
  const playerYesterdayIncome = loadFunction('managerPlayerYesterdayIncome', 'managerPlayerCurrentStats', {
    managerVisibleLedgerRows: (rows) => rows,
    managerIncomePartsFromRow: (row) => row.type === 'player_points_delta'
      ? { kind: 'player', amount: Number(row.amount) || 0 }
      : null,
    managerLedgerBelongsToStation: (row, stationKey) => row.station_key === stationKey,
    managerChinaDateKey: (value) => value ? String(value).slice(0, 10) : '2026-07-14'
  });
  const player = {
    id: 'WTA|qinwen-zheng',
    playerKey: 'WTA|qinwen-zheng',
    eventKey: 'wta-2026-w29-athens',
    contractId: 'contract-zheng'
  };
  const contract = {
    id: 'contract-zheng',
    lineup_id: 'lineup-1',
    event_key: 'wta-2026-w29-athens',
    player_key: 'WTA|qinwen-zheng',
    metadata: {}
  };
  const state = {
    lineup: { id: 'lineup-1' },
    ledger: [
      { type: 'player_points_delta', amount: 30, station_key: '2026-w29-bastad-athens', lineup_id: 'lineup-1', created_at: '2026-07-14T01:37:00Z', metadata: { event_key: 'wta-2026-w29-athens', player_key: 'WTA|qinwen-zheng' } },
      { type: 'player_points_delta', amount: 45, station_key: '2026-w29-bastad-athens', lineup_id: 'lineup-1', created_at: '2026-07-14T01:37:00Z', metadata: { event_key: 'atp-2026-w29-bastad', player_key: 'ATP|andrey-rublev' } },
      { type: 'player_points_delta', amount: 10, station_key: '2026-w29-bastad-athens', lineup_id: 'lineup-1', created_at: '2026-07-13T01:37:00Z', metadata: { event_key: 'wta-2026-w29-athens', player_key: 'WTA|qinwen-zheng' } },
      { type: 'station_combo_bonus', amount: 20, station_key: '2026-w29-bastad-athens', lineup_id: 'lineup-1', created_at: '2026-07-14T01:37:00Z', metadata: {} }
    ]
  };

  assert.equal(playerYesterdayIncome(player, contract, state, '2026-w29-bastad-athens'), 30);
  assert.equal(playerYesterdayIncome(player, { ...contract, metadata: { yesterday_earned: 7 } }, { ledger: [] }, '2026-w29-bastad-athens'), 7);
});

test('compensation popup uses the requested copy and precedes daily income', () => {
  assert.match(html, /tour_manager_take_station_compensation_notice/);
  assert.match(html, /亲爱的'\+name\+'，由于今日bug，特补偿'\+amount\+'至您的本金账户，请查收！/);
  assert.match(html, /if\(!compensationShown\)managerMaybeShowDailyIncomeDialog\(\)/);
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
  assert.match(migration, /tour_manager_take_station_compensation_notice/);
  assert.match(migration, /security definer/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /notice_claimed_at/);
  assert.match(migration, /grant execute on function public\.tour_manager_take_station_compensation_notice\(text, int\) to authenticated/);
  assert.doesNotMatch(migration, /update public\.tour_manager_lineups\s+set/i);
  assert.doesNotMatch(migration, /station_grant_used\s*=/i);
});
