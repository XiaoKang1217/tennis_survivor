import test from 'node:test';
import assert from 'node:assert/strict';
import { LivePoller } from '../src/poller.mjs';

function setup(used, fixtures = []) {
  const cache = { data: { fixtures: { fetchedAt: 1, items: fixtures }, live: [], details: {}, budget: { day: '2026-07-21', used } }, scheduleWrite() {} };
  const client = { beijingDate: () => '2026-07-21', budgetToday: () => cache.data.budget };
  const config = { timeZone: 'Asia/Shanghai', dailyLimit: 8000, fixturesTtlMs: 300000, observationBeforeMs: 1200000, observationAfterMs: 14400000 };
  return new LivePoller({ client, cache, config, now: () => Date.parse('2026-07-21T12:00:00+08:00') });
}

test('adaptive live interval protects daily quota', () => {
  assert.equal(setup(100).budgetDelay(), 8000);
  assert.equal(setup(6500).budgetDelay(), 15000);
  assert.equal(setup(7300).budgetDelay(), 60000);
  assert.equal(setup(7800).budgetDelay(), null);
});

test('does not poll live endpoint outside observation window', () => {
  const poller = setup(100, [{ event_key: 1, event_date: '2026-07-21', event_time: '18:00' }]);
  assert.equal(poller.shouldObserve(), false);
});

test('checks once per minute inside observation window until a match is confirmed live', () => {
  const poller = setup(100, [{
    event_key: 1,
    event_date: '2026-07-21',
    event_time: '12:00',
    event_type_type: 'Atp Singles',
    tournament_name: 'Today'
  }]);
  assert.equal(poller.shouldObserve(), true);
  assert.equal(poller.snapshot.hasLive, false);
  assert.equal(poller.nextDelay(), 60_000);
});

test('uses the adaptive live interval after a match is confirmed live', () => {
  const poller = setup(100, [{
    event_key: 1,
    event_date: '2026-07-21',
    event_time: '12:00',
    event_status: 'Set 1',
    event_live: '1',
    event_type_type: 'Atp Singles',
    tournament_name: 'Today'
  }]);
  assert.equal(poller.snapshot.hasLive, true);
  assert.equal(poller.nextDelay(), 8_000);
});

test('snapshot contains only matches on the current Beijing date', () => {
  const poller = setup(100, [
    { event_key: 1, event_date: '2026-07-20', event_time: '23:30', event_type_type: 'Atp Singles', tournament_name: 'Yesterday' },
    { event_key: 2, event_date: '2026-07-21', event_time: '12:00', event_type_type: 'Atp Singles', tournament_name: 'Today' }
  ]);
  assert.equal(poller.snapshot.tournaments.length, 1);
  assert.equal(poller.snapshot.tournaments[0].name, 'Today');
});
