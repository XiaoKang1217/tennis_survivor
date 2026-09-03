import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { presentation, todayProjection } from './support.mjs';

const require = createRequire(import.meta.url);
const { groupedMatches, matchView } = require('../core/view-model');

test('score grouping preserves two server matchIds for same event date discipline and players', () => {
  const firstMatchId = '019c13ac-7b00-7005-8000-000000000901';
  const secondMatchId = '019c13ac-7b00-7005-8000-000000000902';
  const first = presentation({ matchId: firstMatchId, followCount: 7 });
  const second = presentation({
    matchId: secondMatchId,
    followCount: 2,
    delivery: {
      ...first.delivery,
      dataAsOf: '2026-08-06T23:32:00.000Z'
    },
    status: {
      code: 'finished',
      label: '已结束',
      group: { code: 'ended', label: '已完成' },
      uiTemplate: 'finished',
      statusTone: 'finished'
    },
    ui: { templateId: 'finished', showWinStamp: false, winStampSideId: null }
  });
  const projection = todayProjection(3, first);
  projection.payload.matches = [first, second];

  const groups = groupedMatches(projection, 'all', new Set());
  const cards = groups.flatMap(tournament =>
    tournament.courts.flatMap(court => court.matches));

  assert.deepEqual(cards.map(card => card.id), [firstMatchId, secondMatchId]);
  assert.deepEqual(cards.map(card => card.followTargetId), [firstMatchId, secondMatchId]);
  assert.deepEqual(cards.map(card => card.followCount), [7, 2]);
});

test('match view keeps the production matchId as the only display identity', () => {
  const stableMatchId = '019c13ac-7b00-7005-8000-000000000501';
  const card = matchView(presentation({ matchId: stableMatchId }));

  assert.equal(card.id, stableMatchId);
  assert.equal(card.followTargetId, stableMatchId);
  assert.equal(card.officialScheduleDate, '2026-08-06');
});

test('schedule match cards preserve projection round codes as Chinese labels', () => {
  const qualifying = matchView(presentation({
    competitionContext: { stage: 'qualifying', round: 'Q1', isQualifying: true }
  }));
  const mainDraw = matchView(presentation({
    competitionContext: { stage: 'main_draw', round: 'ROUND_3', isQualifying: false }
  }));

  assert.equal(qualifying.roundLabel, '资格赛第一轮');
  assert.equal(mainDraw.roundLabel, '第三轮');
});

test('match detail date accepts the deployed projection official-day field', () => {
  const deployed = presentation();
  delete deployed.schedule.officialScheduleDate;
  deployed.schedule.scheduleGroupDate = '2026-08-07';

  assert.equal(matchView(deployed).officialScheduleDate, '2026-08-07');
});

test('score cards show only real tie-break mini scores and keep the current game separate', () => {
  const match = presentation();
  match.score.sets = [
    { setNumber: 1, kind: 'standard', firstSideGames: 6, secondSideGames: 3,
      firstSideTiebreakPoints: 0, secondSideTiebreakPoints: 0, state: 'complete' },
    { setNumber: 2, kind: 'standard', firstSideGames: 7, secondSideGames: 6,
      firstSideTiebreakPoints: 7, secondSideTiebreakPoints: 5, state: 'complete' },
    { setNumber: 3, kind: 'standard', firstSideGames: 5, secondSideGames: 1,
      firstSideTiebreakPoints: 0, secondSideTiebreakPoints: 0, state: 'in_progress' }
  ];
  match.score.currentGame = {
    kind: 'standard', firstSidePoints: 'Ad', secondSidePoints: '40'
  };
  const card = matchView(match);
  assert.deepEqual(card.sides[0].setScores.map(set => set.tiebreak), ['', '7', '']);
  assert.deepEqual(card.sides[1].setScores.map(set => set.tiebreak), ['', '5', '']);
  assert.equal(card.sides[0].currentPoint, 'Ad');
  assert.equal(card.sides[1].currentPoint, '40');
});

test('client display layer does not contain alias collapse or Mega reconcile code', () => {
  const viewModel = readFileSync(
    new URL('../core/view-model.js', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(viewModel, /collapsedAliases|aliasKeys|preferredAlias/u);
  assert.doesNotMatch(viewModel, /canonical_players|exact_names/u);
  assert.doesNotMatch(viewModel, /mega\s*reconcile|Mega\s*reconcile|reconcileMatch/u);
});

test('scores hide missing courts and deterministically sort courts and match times', () => {
  const unknown = { state: 'unknown', value: null, message: '待确认', reasonCode: 'not_observed' };
  const field = value => ({ state: 'available', value, message: null, reasonCode: null });
  const base = presentation();
  const make = (id, court, time) => presentation({
    matchId: id,
    stableMatchId: id,
    court: { id: field(`court:${court}`), displayNameZh: court ? field(court) : unknown,
      sortOrder: unknown, availability: court ? 'available' : 'unknown' },
    schedule: { ...base.schedule, venueLocalDateTime: field(time) },
    grouping: { ...base.grouping, courtKey: court ? field(`court:${court}`) : unknown }
  });
  const projection = todayProjection(3, base);
  projection.payload.matches = [
    make('sc_00000000000000000000000000000010', '10号球场', '2026-09-03T05:00:00Z'),
    make('sc_00000000000000000000000000000002', '2号球场', '2026-09-03T04:00:00Z'),
    make('sc_00000000000000000000000000000003', '中心球场', '2026-09-03T06:00:00Z'),
    make('sc_00000000000000000000000000000004', '中心球场', '2026-09-03T03:00:00Z'),
    make('sc_00000000000000000000000000000005', '', '2026-09-03T02:00:00Z')
  ];
  const groups = groupedMatches(projection, 'all', new Set());
  assert.deepEqual(groups[0].courts.map(court => court.name), ['中心球场', '2号球场', '10号球场']);
  assert.deepEqual(groups[0].courts[0].matches.map(match => match.id), [
    'sc_00000000000000000000000000000004',
    'sc_00000000000000000000000000000003'
  ]);
});
