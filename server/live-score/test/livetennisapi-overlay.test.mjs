import test from 'node:test';
import assert from 'node:assert/strict';
import { indexSchedule, toCurrentPoints, toOverlayUpdates, toScheduleSets } from '../src/livetennisapi-overlay.mjs';
import { overlayLiveScores } from '../src/normalizer.mjs';
import { LiveTennisApiClient } from '../src/livetennisapi-client.mjs';

function scheduled(overrides = {}) {
  return {
    id: '900',
    date: '2026-08-03',
    scheduleDate: '2026-08-03',
    time: '12:00',
    status: 'scheduled',
    statusText: 'Scheduled',
    type: 'Atp Singles',
    round: '1/4',
    tournament: { id: '5', name: '多伦多', nameEn: 'Toronto', surface: 'Hard', tour: 'ATP' },
    court: 'Centre Court',
    first: { id: '11', name: '辛纳', nameEn: 'Jannik Sinner', country: 'ITA', rank: '1', odds: '', seed: '1' },
    second: { id: '22', name: '德约科维奇', nameEn: 'Novak Djokovic', country: 'SRB', rank: '5', odds: '', seed: '4' },
    winner: '',
    serve: '',
    lastPoint: '',
    current: { first: '', second: '' },
    sets: [],
    dayOffset: 0,
    ...overrides
  };
}

function providerMatch(overrides = {}) {
  return {
    id: 45678,
    tournament: 'Toronto Masters',
    surface: 'hard',
    status: 'live',
    is_doubles: false,
    players: {
      p1: { id: 1, name: 'Jannik Sinner', country: 'ITA', is_doubles_team: false },
      p2: { id: 2, name: 'Novak Djokovic', country: 'SRB', is_doubles_team: false }
    },
    score: {
      sets: [1, 0],
      games: [[6, 3], [4, 2]],
      points: ['40', '30'],
      server: 1,
      is_tiebreak: false
    },
    winner: null,
    ...overrides
  };
}

test('fills live score state onto the scheduled match', () => {
  const schedule = [scheduled()];
  const updates = toOverlayUpdates([providerMatch()], schedule, 1000);
  assert.equal(updates.length, 1);

  const [match] = overlayLiveScores(schedule, updates);
  assert.equal(match.status, 'live');
  assert.deepEqual(match.sets, [
    { set: 1, first: '6', second: '4' },
    { set: 2, first: '3', second: '2' }
  ]);
  assert.deepEqual(match.current, { first: '40', second: '30' });
  assert.equal(match.serve, 'first');
});

test('resolves orientation by name, not by position', () => {
  const schedule = [scheduled()];
  const swapped = providerMatch({
    players: {
      p1: { id: 2, name: 'Novak Djokovic' },
      p2: { id: 1, name: 'Jannik Sinner' }
    }
  });
  const [match] = overlayLiveScores(schedule, toOverlayUpdates([swapped], schedule));
  assert.deepEqual(match.sets, [
    { set: 1, first: '4', second: '6' },
    { set: 2, first: '2', second: '3' }
  ]);
  assert.deepEqual(match.current, { first: '30', second: '40' });
  // server 1 is the provider's p1, who is the schedule's second player here.
  assert.equal(match.serve, 'second');
});

test('never creates a match the official schedule does not contain', () => {
  const schedule = [scheduled()];
  const stranger = providerMatch({
    players: { p1: { name: 'Carlos Alcaraz' }, p2: { name: 'Daniil Medvedev' } }
  });
  assert.deepEqual(toOverlayUpdates([stranger], schedule), []);
  assert.equal(overlayLiveScores(schedule, toOverlayUpdates([stranger], schedule)).length, 1);
});

test('cannot move tournament, date, court or player identity', () => {
  const schedule = [scheduled()];
  const hostile = providerMatch({
    tournament: 'Somewhere Else',
    surface: 'clay',
    scheduled_time: '2030-01-01T00:00:00Z',
    players: {
      p1: { id: 999, name: 'Jannik Sinner', country: 'XXX' },
      p2: { id: 998, name: 'Novak Djokovic', country: 'XXX' }
    }
  });
  const before = scheduled();
  const [match] = overlayLiveScores(schedule, toOverlayUpdates([hostile], schedule));
  assert.deepEqual(match.tournament, before.tournament);
  assert.equal(match.date, before.date);
  assert.equal(match.time, before.time);
  assert.equal(match.court, before.court);
  assert.equal(match.id, before.id);
  assert.equal(match.first.id, '11');
  assert.equal(match.first.country, 'ITA');
  assert.equal(match.second.id, '22');
  // No provider id is written into the schedule's id space.
  assert.equal(match.providerId, undefined);
});

test('emits no terminal state, so it can never lock or hide a match', () => {
  const schedule = [scheduled()];
  for (const status of ['completed', 'cancelled', 'upcoming']) {
    assert.deepEqual(toOverlayUpdates([providerMatch({ status, winner: 1 })], schedule), []);
  }
});

test('a finished match cannot be dragged back to live', () => {
  const schedule = [scheduled({ status: 'finished', statusText: 'Finished', winner: 'first', sets: [{ set: 1, first: '6', second: '4' }] })];
  const [match] = overlayLiveScores(schedule, toOverlayUpdates([providerMatch()], schedule));
  assert.equal(match.status, 'finished');
  assert.equal(match.winner, 'first');
  assert.deepEqual(match.sets, [{ set: 1, first: '6', second: '4' }]);
});

test('an ambiguous pairing is dropped on either side', () => {
  const duplicateSchedule = [scheduled(), scheduled({ id: '901', court: 'Court 2' })];
  assert.deepEqual(toOverlayUpdates([providerMatch()], duplicateSchedule), []);

  const schedule = [scheduled()];
  const duplicateProvider = [providerMatch(), providerMatch({ id: 45679 })];
  assert.deepEqual(toOverlayUpdates(duplicateProvider, schedule), []);
});

test('doubles are left to the primary source on both sides', () => {
  const schedule = [scheduled({ type: 'Atp Doubles' })];
  assert.deepEqual(toOverlayUpdates([providerMatch()], schedule), []);
  assert.deepEqual(toOverlayUpdates([providerMatch({ is_doubles: true })], [scheduled()]), []);
});

test('an empty games array yields no synthesised score', () => {
  const schedule = [scheduled({ sets: [{ set: 1, first: '6', second: '4' }] })];
  const updates = toOverlayUpdates([providerMatch({ score: { games: [], points: [null, null], server: null } })], schedule);
  assert.deepEqual(updates[0].sets, []);
  const [match] = overlayLiveScores(schedule, updates);
  // overlayLiveScores only replaces a non-empty set list, so the existing
  // scoreline survives rather than being blanked.
  assert.deepEqual(match.sets, [{ set: 1, first: '6', second: '4' }]);
});

test('null point entries are not decoded into a score', () => {
  assert.equal(toCurrentPoints({ points: [null, null] }), null);
  assert.equal(toCurrentPoints({ points: ['40'] }), null);
  assert.equal(toCurrentPoints({}), null);
  assert.deepEqual(toCurrentPoints({ points: ['0', 'AD'] }), { first: '0', second: 'AD' });
});

test('set mapping stops at the first set the provider did not report as a pair', () => {
  assert.deepEqual(toScheduleSets({ games: [[6, 3, 2], [4, 6]] }), [
    { set: 1, first: '6', second: '4' },
    { set: 2, first: '3', second: '6' }
  ]);
  assert.deepEqual(toScheduleSets({ games: [[6, null], [4, 2]] }), [{ set: 1, first: '6', second: '4' }]);
  assert.deepEqual(toScheduleSets({}), []);
});

test('placeholder and unnamed schedule entries are never matched', () => {
  const index = indexSchedule([scheduled({ first: { name: '待定' }, second: { name: '待定' } })]);
  assert.equal(index.size, 0);
});

test('accents and punctuation do not prevent a match', () => {
  const schedule = [scheduled({ second: { id: '22', name: '穆勒', nameEn: 'Alexandre Muller' } })];
  const updates = toOverlayUpdates([providerMatch({
    players: { p1: { name: 'Jannik Sinner' }, p2: { name: 'Alexandre  Müller' } }
  })], schedule);
  assert.equal(updates.length, 1);
});

test('client sends the bearer key and follows has_more paging', () => {
  const seen = [];
  const client = new LiveTennisApiClient({
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      seen.push({ url: String(url), auth: options.headers.authorization });
      const offset = Number(new URL(url).searchParams.get('offset'));
      return {
        ok: true,
        status: 200,
        json: async () => (offset === 0
          ? { data: [providerMatch()], meta: { has_more: true } }
          : { data: [providerMatch({ id: 2 })], meta: { has_more: false } })
      };
    }
  });
  return client.liveMatches().then(matches => {
    assert.equal(matches.length, 2);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].auth, 'Bearer test-key');
    assert.match(seen[0].url, /\/matches\?status=live/);
  });
});

test('client backs off after a rate limit instead of retrying into it', async () => {
  let calls = 0;
  let clock = 0;
  const client = new LiveTennisApiClient({
    apiKey: 'test-key',
    now: () => clock,
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 429, headers: { get: () => '30' }, json: async () => ({}) };
    }
  });
  await assert.rejects(() => client.liveMatches());
  assert.equal(calls, 1);
  clock = 1000;
  assert.deepEqual(await client.liveMatches(), []);
  assert.equal(calls, 1);
});
