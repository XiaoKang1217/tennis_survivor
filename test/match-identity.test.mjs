import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { presentation, todayProjection } from './support.mjs';

const require = createRequire(import.meta.url);
const { groupedMatches, matchView } = require('../miniprogram/core/view-model');

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
});

test('client display layer does not contain alias collapse or Mega reconcile code', () => {
  const viewModel = readFileSync(
    new URL('../miniprogram/core/view-model.js', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(viewModel, /collapsedAliases|aliasKeys|preferredAlias/u);
  assert.doesNotMatch(viewModel, /canonical_players|exact_names/u);
  assert.doesNotMatch(viewModel, /mega\s*reconcile|Mega\s*reconcile|reconcileMatch/u);
});
