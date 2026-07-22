import test from 'node:test';
import assert from 'node:assert/strict';
import { LivePoller } from '../src/poller.mjs';

function setup(used, fixtures = []) {
  const now = Date.parse('2026-07-21T12:00:00+08:00');
  const cache = { data: { fixtures: { fetchedAt: now, items: fixtures }, live: [], details: {}, budget: { day: '2026-07-21', used } }, scheduleWrite() {} };
  const client = { beijingDate: () => '2026-07-21', dateAfter: () => '2026-07-22', budgetToday: () => cache.data.budget };
  const config = { timeZone: 'Asia/Shanghai', dailyLimit: 8000, fixturesTtlMs: 6 * 60 * 60_000, observationBeforeMs: 15 * 60_000, observationAfterMs: 6 * 60 * 60_000 };
  return new LivePoller({ client, cache, config, now: () => now });
}

test('live interval stays at eight seconds regardless of the local request counter', () => {
  const liveFixture = [{ event_key: 1, event_date: '2026-07-21', event_time: '12:00', event_status: 'Set 1', event_live: '1', event_type_type: 'Atp Singles', tournament_name: 'Today' }];
  assert.equal(setup(100, liveFixture).nextDelay(), 8_000);
  assert.equal(setup(7300, liveFixture).nextDelay(), 8_000);
  assert.equal(setup(9000, liveFixture).nextDelay(), 8_000);
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

test('uses the fixed live interval after a match is confirmed live', () => {
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

test('wakes at the next fifteen-minute observation window', () => {
  const poller = setup(100, [{ event_key: 1, event_date: '2026-07-21', event_time: '13:00', event_type_type: 'Atp Singles', tournament_name: 'Today' }]);
  assert.equal(poller.nextDelay(), 45 * 60_000);
});

test('waits until the next Beijing day after all matches finish', () => {
  const poller = setup(100, [{ event_key: 1, event_date: '2026-07-21', event_time: '10:00', event_status: 'Finished', event_type_type: 'Atp Singles', tournament_name: 'Today' }]);
  assert.equal(poller.nextDelay(), 12 * 60 * 60_000 + 1_000);
});

test('snapshot contains only matches on the current Beijing date', () => {
  const poller = setup(100, [
    { event_key: 1, event_date: '2026-07-20', event_time: '23:30', event_type_type: 'Atp Singles', tournament_name: 'Yesterday' },
    { event_key: 2, event_date: '2026-07-21', event_time: '12:00', event_type_type: 'Atp Singles', tournament_name: 'Today' }
  ]);
  assert.equal(poller.snapshot.tournaments.length, 1);
  assert.equal(poller.snapshot.tournaments[0].name, 'Today');
});
