import test from 'node:test';
import assert from 'node:assert/strict';
import { LivePoller } from '../src/poller.mjs';

function setup(used, fixtures = [], options = {}) {
  const calendarDate = options.calendarDate || '2026-07-21';
  const now = options.now || Date.parse(`${calendarDate}T12:00:00+08:00`);
  const cache = {
    data: {
      fixtures: { fetchedAt: now, date: options.activeScheduleDate || calendarDate, items: fixtures },
      live: fixtures.filter(item => item.event_live === '1'
        || /^(?:set \d+|live|in progress)$/i.test(String(item.event_status || ''))),
      details: {},
      budget: { day: calendarDate, used },
      pipelineVersion: 6,
      activeScheduleDate: options.activeScheduleDate || ''
    },
    scheduleWrite() {}
  };
  const client = { beijingDate: () => calendarDate, dateAfter: date => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), budgetToday: () => cache.data.budget };
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

test('a stale live marker in fixtures cannot keep eight-second polling alive', () => {
  const fixture = {
    event_key: 1,
    event_date: '2026-07-21',
    event_time: '12:00',
    event_status: 'Set 1',
    event_live: '1',
    event_type_type: 'Atp Singles',
    tournament_name: 'Today'
  };
  const poller = setup(100, [fixture]);
  assert.equal(poller.snapshot.hasLive, true);
  poller.cache.data.live = [];
  poller.snapshot = poller.buildSnapshot();
  assert.equal(poller.snapshot.hasLive, false);
  assert.equal(poller.nextDelay(), 60_000);
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

test('keeps API tournaments even when the metadata source has no matching tournament', () => {
  const poller = setup(100, [{
    event_key: 20,
    event_date: '2026-07-21',
    event_time: '17:00',
    event_type_type: 'Wta Singles',
    tournament_name: 'WTA Hamburg',
    event_first_player: 'M. Sherif',
    event_second_player: 'E. Jacquemot'
  }]);
  poller.localizer = {
    enrich(matches) {
      matches.forEach(match => { match.officialScheduleMatch = false; });
      return matches;
    }
  };
  poller.snapshot = poller.buildSnapshot();
  assert.equal(poller.snapshot.tournaments.length, 1);
  assert.equal(poller.snapshot.tournaments[0].name, 'WTA Hamburg');
});

test('assigns a Beijing next-day fixture to its tournament-local official date', () => {
  const poller = setup(100, [
    { event_key: 21, event_date: '2026-07-23', event_time: '01:30', event_type_type: 'Atp Singles', tournament_name: 'Estoril' },
    { event_key: 22, event_date: '2026-07-23', event_time: '17:00', event_type_type: 'Wta Singles', tournament_name: 'Hamburg' }
  ], { calendarDate: '2026-07-23', activeScheduleDate: '2026-07-22' });
  const matches = poller.snapshot.tournaments.flatMap(tour => tour.venues.flatMap(venue => venue.matches));
  assert.deepEqual(matches.map(match => match.id), ['21']);
  assert.equal(matches[0].dayOffset, 1);
});

test('does not repeat the previous official schedule day after Beijing midnight', () => {
  const poller = setup(100, [
    { event_key: 23, event_date: '2026-07-23', event_time: '01:25', event_status: 'Finished', event_type_type: 'Atp Doubles', tournament_name: 'Estoril' },
    { event_key: 24, event_date: '2026-07-23', event_time: '19:00', event_type_type: 'Atp Singles', tournament_name: 'Estoril' },
    { event_key: 25, event_date: '2026-07-24', event_time: '01:30', event_type_type: 'Atp Singles', tournament_name: 'Estoril' }
  ], { calendarDate: '2026-07-23', activeScheduleDate: '2026-07-23' });
  const matches = poller.snapshot.tournaments.flatMap(tour => tour.venues.flatMap(venue => venue.matches));
  assert.deepEqual(matches.map(match => match.id), ['24', '25']);
  assert.equal(matches[0].dayOffset, 0);
  assert.equal(matches[1].dayOffset, 1);
});

test('a match confirmed finished by livescore cannot regress to live on a later poll', () => {
  const scheduled = [{
    event_key: 7,
    event_date: '2026-07-21',
    event_time: '12:00',
    event_status: 'Scheduled',
    event_type_type: 'Atp Singles',
    tournament_name: 'Today'
  }];
  const poller = setup(100, scheduled);
  poller.cache.data.live = [{
    ...scheduled[0],
    event_status: 'Finished',
    event_final_result: '2 - 1',
    scores: [
      { score_set: '1', score_first: '6', score_second: '2' },
      { score_set: '2', score_first: '3', score_second: '6' },
      { score_set: '3', score_first: '6', score_second: '1' }
    ]
  }];
  poller.rememberTerminalMatches(poller.cache.data.live);
  poller.snapshot = poller.buildSnapshot();
  assert.equal(poller.snapshot.tournaments[0].venues[0].matches[0].status, 'finished');

  poller.cache.data.live = [{
    ...scheduled[0],
    event_status: 'Set 3',
    event_live: '1',
    event_game_result: '15 - 0',
    scores: [{ score_set: '3', score_first: '2', score_second: '1' }]
  }];
  poller.snapshot = poller.buildSnapshot();
  const match = poller.snapshot.tournaments[0].venues[0].matches[0];
  assert.equal(match.status, 'finished');
  assert.equal(match.statusText, 'Finished');
  assert.deepEqual(match.sets.at(-1), { set: '3', first: '6', second: '1' });
});

test('a terminal match stays finished after it disappears from livescore', () => {
  const finished = [{
    event_key: 8,
    event_date: '2026-07-21',
    event_time: '10:00',
    event_status: 'Finished',
    event_type_type: 'Atp Singles',
    tournament_name: 'Today',
    scores: [{ score_set: '1', score_first: '6', score_second: '4' }]
  }];
  const poller = setup(100, finished.map(item => ({ ...item, event_status: 'Scheduled', scores: [] })));
  poller.rememberTerminalMatches(finished);
  poller.cache.data.live = [];
  poller.snapshot = poller.buildSnapshot();
  assert.equal(poller.snapshot.tournaments[0].venues[0].matches[0].status, 'finished');
});

test('a new provider event id cannot downgrade the same completed pairing', () => {
  const base = {
    event_date: '2026-07-21',
    event_time: '12:00',
    event_type_type: 'Wta Singles',
    tournament_name: 'WTA Hamburg',
    event_first_player: 'A. Player',
    first_player_key: '100',
    event_second_player: 'B. Player',
    second_player_key: '200'
  };
  const poller = setup(100, [{ ...base, event_key: 31, event_status: 'Scheduled' }]);
  poller.rememberTerminalMatches([{
    ...base,
    event_key: 30,
    event_status: 'Finished',
    event_winner: 'First Player',
    scores: [{ score_set: '1', score_first: '6', score_second: '3' }]
  }]);
  poller.snapshot = poller.buildSnapshot();
  const matches = poller.snapshot.tournaments.flatMap(tour => tour.venues.flatMap(venue => venue.matches));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, '31');
  assert.equal(matches[0].status, 'finished');
});

test('keeps the previous official schedule date after Beijing midnight while a match is unfinished', () => {
  const poller = setup(100, [{
    event_key: 9,
    event_date: '2026-07-22',
    event_time: '01:30',
    event_type_type: 'Atp Singles',
    tournament_name: 'Estoril'
  }], { calendarDate: '2026-07-23', activeScheduleDate: '2026-07-22' });
  assert.equal(poller.snapshot.date, '2026-07-22');
  assert.equal(poller.advanceScheduleDayIfComplete(), false);
  assert.equal(poller.scheduleDate(), '2026-07-22');
});

test('prefetches the new Beijing calendar day without switching the unfinished active schedule', async () => {
  const poller = setup(100, [{
    event_key: 9,
    event_date: '2026-07-23',
    event_time: '01:30',
    event_type_type: 'Atp Singles',
    tournament_name: 'Estoril'
  }], { calendarDate: '2026-07-23', activeScheduleDate: '2026-07-22' });
  poller.client.fixtures = async date => [{
    event_key: 11,
    event_date: date,
    event_time: '17:00',
    event_type_type: 'Atp Singles',
    tournament_name: 'Kitzbuhel'
  }];
  poller.client.odds = async () => ({});
  assert.equal(await poller.prefetchCalendarDay(), true);
  assert.equal(poller.scheduleDate(), '2026-07-22');
  assert.ok(poller.cache.data.scheduleHistory['2026-07-23']);
  assert.deepEqual(poller.historyDates(), ['2026-07-22', '2026-07-23']);
});

test('advances to the new schedule day only after every match is finished', () => {
  const poller = setup(100, [{
    event_key: 10,
    event_date: '2026-07-23',
    event_time: '01:30',
    event_status: 'Finished',
    event_type_type: 'Atp Singles',
    tournament_name: 'Estoril'
  }], { calendarDate: '2026-07-23', activeScheduleDate: '2026-07-22' });
  assert.equal(poller.advanceScheduleDayIfComplete(), true);
  assert.equal(poller.scheduleDate(), '2026-07-23');
  assert.equal(poller.cache.data.fixtures, null);
  assert.deepEqual(poller.cache.data.live, []);
});

test('stores at most five schedule snapshots and never backfills before July 22', () => {
  const poller = setup(100, [], { calendarDate: '2026-07-27', activeScheduleDate: '2026-07-27' });
  for (let day = 21; day <= 27; day += 1) poller.rememberSnapshot({ date: `2026-07-${day}`, tournaments: [], hasLive: false }, false);
  assert.deepEqual(Object.keys(poller.cache.data.scheduleHistory).sort(), [
    '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27'
  ]);
});

test('invalidates snapshots created by the old competitor-driven pipeline', () => {
  const calendarDate = '2026-07-23';
  const now = Date.parse(`${calendarDate}T12:00:00+08:00`);
  const cache = {
    data: {
      fixtures: { fetchedAt: now, items: [] }, live: [], details: {}, budget: { day: calendarDate, used: 0 },
      pipelineVersion: 2, activeScheduleDate: calendarDate,
      scheduleHistory: { '2026-07-22': { date: '2026-07-22' }, '2026-07-23': { date: '2026-07-23', tournaments: [{ name: 'corrupt' }] } }
    },
    scheduleWrite() {}
  };
  const client = { beijingDate: () => calendarDate, dateAfter: () => '2026-07-24', budgetToday: () => cache.data.budget };
  const config = { timeZone: 'Asia/Shanghai', dailyLimit: 8000, fixturesTtlMs: 6 * 60 * 60_000, observationBeforeMs: 15 * 60_000, observationAfterMs: 6 * 60 * 60_000 };
  new LivePoller({ client, cache, config, now: () => now });
  assert.equal(cache.data.pipelineVersion, 6);
  assert.deepEqual(Object.keys(cache.data.scheduleHistory), [calendarDate]);
  assert.equal(cache.data.scheduleHistory[calendarDate].tournaments.length, 0);
});
