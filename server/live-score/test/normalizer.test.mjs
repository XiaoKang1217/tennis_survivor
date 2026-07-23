import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPrematchOdds, groupSchedule, isMainTour, isObservationWindow, normalizeMatch, selectPrematchOdds } from '../src/normalizer.mjs';

test('normalizes missing court and surface as 未标注', () => {
  const match = normalizeMatch({ event_key: 1, event_date: '2026-07-21', event_time: '12:00', tournament_name: 'Test', event_first_player: 'A', event_second_player: 'B' });
  assert.equal(match.court, '未标注');
  assert.equal(match.tournament.surface, '未标注');
});

test('groups matches by tournament and court', () => {
  const one = normalizeMatch({ event_key: 1, tournament_key: 9, tournament_name: 'Test', event_stadium: 'Centre' });
  const two = normalizeMatch({ event_key: 2, tournament_key: 9, tournament_name: 'Test', event_stadium: 'Court 1' });
  const grouped = groupSchedule([one, two]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].venues.length, 2);
});

test('sorts tournament levels from high to low and identifies main-tour matches', () => {
  const low = normalizeMatch({ event_key: 1, event_type_type: 'Atp Singles', tournament_key: 1, tournament_name: 'ATP 250 Test' });
  const high = normalizeMatch({ event_key: 2, event_type_type: 'Wta Singles', tournament_key: 2, tournament_name: 'WTA 1000 Test' });
  assert.deepEqual(groupSchedule([low, high]).map(item => item.name), ['WTA 1000 Test', 'ATP 250 Test']);
  assert.equal(isMainTour(low), true);
  assert.equal(isMainTour(normalizeMatch({ event_type_type: 'Challenger Men Singles' })), false);
});

test('observes only around scheduled Beijing start', () => {
  const match = normalizeMatch({ event_key: 1, event_date: '2026-07-21', event_time: '12:00' });
  assert.equal(isObservationWindow(match, Date.parse('2026-07-21T11:45:00+08:00')), true);
  assert.equal(isObservationWindow(match, Date.parse('2026-07-21T09:00:00+08:00')), false);
});

test('applies next-day offset when deciding whether a scheduled match has started', () => {
  const match = normalizeMatch({ event_key: 1, event_date: '2026-07-22', event_time: '00:30' });
  match.scheduleDate = '2026-07-22';
  match.dayOffset = 1;
  assert.equal(isObservationWindow(match, Date.parse('2026-07-22T00:35:00+08:00'), 0), false);
  assert.equal(isObservationWindow(match, Date.parse('2026-07-23T00:35:00+08:00'), 0), true);
});

test('splits provider current game score and treats interrupted match as live', () => {
  const match = normalizeMatch({ event_key: 1, event_status: 'Interrupted', event_game_result: '30 - 40' });
  assert.equal(match.status, 'live');
  assert.deepEqual(match.current, { first: '30', second: '40' });
});

test('keeps cancelled matches distinct from completed matches and hides them from the schedule', () => {
  const cancelled = normalizeMatch({
    event_key: 99,
    event_status: 'Cancelled',
    event_first_player: 'A',
    event_second_player: 'B'
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(groupSchedule([cancelled]), []);
});

test('infers the latest point winner from point-by-point score transitions', () => {
  const first = normalizeMatch({ pointbypoint: [{ points: [{ score: '15 - 0' }, { score: '30 - 0' }] }] });
  const secondAtDeuce = normalizeMatch({ pointbypoint: [{ points: [{ score: '40 - A' }, { score: '40 - 40' }] }] });
  assert.equal(first.lastPoint, 'first');
  assert.equal(secondAtDeuce.lastPoint, 'first');
});

test('keeps scheduled time and venue when live feed omits them', async () => {
  const { mergeMatches } = await import('../src/normalizer.mjs');
  const merged = mergeMatches(
    [{ event_key: 9, event_date: '2026-07-22', event_time: '17:00', event_stadium: 'Centre Court', tournament_surface: 'Clay' }],
    [{ event_key: 9, event_date: '2026-07-22', event_time: '00:00', event_status: 'Finished' }]
  );
  assert.equal(merged[0].time, '17:00');
  assert.equal(merged[0].court, 'Centre Court');
  assert.equal(merged[0].tournament.surface, 'Clay');
});

test('keeps a freshly confirmed finished fixture over a stale live row', async () => {
  const { mergeMatches } = await import('../src/normalizer.mjs');
  const merged = mergeMatches(
    [{
      event_key: 9,
      event_date: '2026-07-22',
      event_time: '17:00',
      event_status: 'Finished',
      event_final_result: '2 - 1',
      scores: [
        { score_set: '1', score_first: '7', score_second: '6' },
        { score_set: '2', score_first: '2', score_second: '6' },
        { score_set: '3', score_first: '6', score_second: '4' }
      ]
    }],
    [{
      event_key: 9,
      event_status: 'Set 3',
      event_live: '1',
      event_game_result: '15 - 0',
      scores: [{ score_set: '3', score_first: '3', score_second: '3' }]
    }]
  );
  assert.equal(merged[0].status, 'finished');
  assert.equal(merged[0].statusText, 'Finished');
  assert.deepEqual(merged[0].current, { first: '', second: '' });
  assert.deepEqual(merged[0].sets.at(-1), { set: '3', first: '6', second: '4' });
});

test('selects a stable bookmaker priority from API Tennis Home/Away odds', () => {
  const selected = selectPrematchOdds({
    'Home/Away': {
      Home: { bwin: '1.80', bet365: '1.75' },
      Away: { bwin: '2.00', bet365: '2.10' }
    }
  });
  assert.deepEqual(selected, { first: '1.75', second: '2.10', bookmaker: 'bet365' });
});

test('applies API Tennis prematch odds by event key', () => {
  const match = normalizeMatch({ event_key: 42, event_first_player: 'A', event_second_player: 'B' });
  applyPrematchOdds([match], { 42: { 'Home/Away': { Home: { '1xBet': '1.91' }, Away: { '1xBet': '1.95' } } } });
  assert.equal(match.first.odds, '1.91');
  assert.equal(match.second.odds, '1.95');
  assert.equal(match.oddsBookmaker, '1xBet');
});
