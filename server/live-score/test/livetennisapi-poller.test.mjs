import test from 'node:test';
import assert from 'node:assert/strict';
import { LivePoller } from '../src/poller.mjs';

const CALENDAR_DATE = '2026-07-21';
const NOW = Date.parse(`${CALENDAR_DATE}T12:00:00+08:00`);

const FIXTURE = {
  event_key: 1,
  event_date: CALENDAR_DATE,
  event_time: '12:00',
  event_type_type: 'Atp Singles',
  event_first_player: 'Jannik Sinner',
  first_player_key: '11',
  event_second_player: 'Novak Djokovic',
  second_player_key: '22',
  tournament_name: 'Toronto',
  event_stadium: 'Centre Court'
};

function setup({ secondaryLive = null, liveSecondary = [], live = [] } = {}) {
  const cache = {
    data: {
      fixtures: { fetchedAt: NOW, date: CALENDAR_DATE, items: [FIXTURE] },
      live,
      liveSecondary,
      details: {},
      budget: { day: CALENDAR_DATE, used: 0 },
      pipelineVersion: 7,
      activeScheduleDate: CALENDAR_DATE
    },
    scheduleWrite() {}
  };
  const client = {
    beijingDate: () => CALENDAR_DATE,
    dateAfter: date => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
    budgetToday: () => cache.data.budget
  };
  const config = {
    timeZone: 'Asia/Shanghai',
    dailyLimit: 8000,
    fixturesTtlMs: 6 * 60 * 60_000,
    officialTtlMs: 5 * 60_000,
    observationBeforeMs: 15 * 60_000,
    observationAfterMs: 6 * 60 * 60_000
  };
  return new LivePoller({ client, cache, config, secondaryLive, now: () => NOW });
}

const PROVIDER_LIVE = [{
  id: 7,
  status: 'live',
  is_doubles: false,
  players: { p1: { name: 'Jannik Sinner' }, p2: { name: 'Novak Djokovic' } },
  score: { games: [[5], [3]], points: ['40', '15'], server: 2 }
}];

test('with no key configured the service behaves exactly as before', () => {
  const poller = setup({ liveSecondary: PROVIDER_LIVE });
  const [match] = poller.activeMatches();
  assert.equal(match.status, 'scheduled');
  assert.deepEqual(match.sets, []);
  assert.equal(poller.snapshot.hasLive, false);
  assert.equal(
    poller.snapshot.sourcePolicy.live,
    'API Tennis get_livescore score/status overlay only'
  );
});

test('when configured it fills a match the primary response did not carry', () => {
  const poller = setup({ secondaryLive: {}, liveSecondary: PROVIDER_LIVE });
  const [match] = poller.activeMatches();
  assert.equal(match.status, 'live');
  assert.deepEqual(match.sets, [{ set: 1, first: '5', second: '3' }]);
  assert.deepEqual(match.current, { first: '40', second: '15' });
  assert.equal(match.serve, 'second');
  assert.equal(match.court, 'Centre Court');
  assert.match(poller.snapshot.sourcePolicy.live, /livetennisapi\.com/);
});

test('the primary source still wins on any match it reported', () => {
  const poller = setup({
    secondaryLive: {},
    liveSecondary: PROVIDER_LIVE,
    live: [{
      ...FIXTURE,
      event_status: 'Set 2',
      event_live: '1',
      event_game_result: '0 - 30',
      event_serve: 'First Player',
      scores: [{ score_set: 1, score_first: '6', score_second: '2' }]
    }]
  });
  const [match] = poller.activeMatches();
  assert.deepEqual(match.sets, [{ set: 1, first: '6', second: '2' }]);
  assert.deepEqual(match.current, { first: '0', second: '30' });
  assert.equal(match.serve, 'first');
});

test('a failing optional source contributes nothing and never breaks the tick', async () => {
  const poller = setup({
    secondaryLive: { liveMatches: async () => { throw new Error('boom'); } },
    liveSecondary: PROVIDER_LIVE
  });
  assert.deepEqual(await poller.fetchSecondaryLive(), []);
});
