import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');

function functionSource(name, nextName) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf(`function ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return html.slice(start, end);
}

function loadRollover(packs) {
  const context = vm.createContext({
    managerContestPacks: () => packs,
    managerEarliestDate: values => {
      const dates = values.map(value => value ? new Date(value) : null).filter(Boolean).sort((a, b) => a - b);
      return dates[0] || null;
    },
    Date,
    Number
  });
  vm.runInContext(
    `${functionSource('managerCurrentStationR1Start', 'managerCurrentStationStarted')}
     ${functionSource('managerCurrentStationStarted', 'managerDailyIncomeContext')}
     this.started = managerCurrentStationStarted;`,
    context
  );
  return context.started;
}

test('income popup and station board do not roll over from a calendar start_date', () => {
  const started = loadRollover([
    { event: { start_date: '2026-08-01', main_draw_first_match_at: null } },
    { event: { start_date: '2026-08-02', main_draw_first_match_at: null } }
  ]);
  assert.equal(started(Date.parse('2026-08-03T00:00:00Z')), false);
});

test('income popup and station board roll over only after the first official R1 start', () => {
  const started = loadRollover([
    { event: { main_draw_first_match_at: '2026-08-02T14:30:00Z' } },
    { event: { main_draw_first_match_at: '2026-08-03T15:00:00Z' } }
  ]);
  assert.equal(started(Date.parse('2026-08-02T14:29:59Z')), false);
  assert.equal(started(Date.parse('2026-08-02T14:30:00Z')), true);
});

test('both the station board and daily-income context use the strict R1 rollover gate', () => {
  assert.match(html, /function managerPublicBoardStationMeta\(\)\{[\s\S]*?!managerCurrentStationStarted\(\)&&prev/);
  assert.match(html, /function managerDailyIncomeContext\(\)\{[\s\S]*?!managerCurrentStationStarted\(\)&&MANAGER_PREVIOUS_STATE&&prev/);
  const rolloverSource = functionSource('managerCurrentStationStarted', 'managerDailyIncomeContext');
  assert.doesNotMatch(rolloverSource, /managerEventStarted/);
  assert.doesNotMatch(rolloverSource, /start_date/);
});
