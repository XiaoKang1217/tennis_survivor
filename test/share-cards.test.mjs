import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const miniRoot = resolve(import.meta.dirname, '..');
const read = relative => readFileSync(resolve(miniRoot, relative), 'utf8');
const {
  drawShare,
  matchShare,
  pageShare,
  playerShare,
  tournamentShare
} = require('../core/share');

test('every share type omits imageUrl so WeChat uses the current page screenshot', () => {
  const match = matchShare(
    { id: 'm1', sides: [{ names: 'A' }, { names: 'B' }] },
    { date: '2026-08-25', cardImageUrl: '/tmp/match-card.jpg', timelineImageUrl: '/tmp/match-square.jpg' }
  );
  assert.equal(Object.hasOwn(match.appMessage, 'imageUrl'), false);
  assert.equal(Object.hasOwn(match.timeline, 'imageUrl'), false);
  assert.match(match.appMessage.path, /shared=match/u);

  const player = playerShare({
    playerId: 'p1',
    name: 'Zheng Qinwen',
    shareCardImageUrl: '/tmp/player-card.jpg',
    shareTimelineImageUrl: '/tmp/player-square.jpg'
  });
  assert.equal(Object.hasOwn(player.appMessage, 'imageUrl'), false);
  assert.equal(Object.hasOwn(player.timeline, 'imageUrl'), false);
  assert.match(player.timeline.query, /shared=player/u);

  const draw = drawShare({
    selectedTournamentId: 't1',
    selectedTitle: '美国网球公开赛',
    selectedDrawId: 'd1',
    draws: [{ drawId: 'd1', label: '女单资格赛' }],
    shareCardImageUrl: '/tmp/draw-card.jpg',
    shareTimelineImageUrl: '/tmp/draw-square.jpg'
  });
  assert.equal(Object.hasOwn(draw.appMessage, 'imageUrl'), false);
  assert.equal(Object.hasOwn(draw.timeline, 'imageUrl'), false);
  assert.match(draw.appMessage.path, /shared=draw/u);

  const tournament = tournamentShare(
    { tournamentEditionId: 't1', name: { value: '美国网球公开赛' } },
    { cardImageUrl: '/tmp/tournament-card.jpg', timelineImageUrl: '/tmp/tournament-square.jpg' }
  );
  assert.equal(Object.hasOwn(tournament.appMessage, 'imageUrl'), false);
  assert.equal(Object.hasOwn(tournament.timeline, 'imageUrl'), false);
  assert.match(tournament.timeline.query, /shared=tournament/u);

  const modulePage = pageShare({
    title: '炉的网球｜实时比分',
    path: '/pages/scores/index',
    query: { date: '2026-08-28' },
    shared: 'scores'
  });
  assert.equal(Object.hasOwn(modulePage.appMessage, 'imageUrl'), false);
  assert.equal(Object.hasOwn(modulePage.timeline, 'imageUrl'), false);
  assert.match(modulePage.appMessage.path, /date=2026-08-28/u);
});

test('all requested modules enable sharing and generated poster canvases stay detached', () => {
  for (const page of [
    'pages/scores',
    'pages/calendar',
    'pages/participation',
    'pages/following',
    'packages/player/pages/players',
    'pages/match-detail',
    'packages/player/pages/player-detail',
    'pages/draws',
    'packages/tournament/pages/tournament-detail'
  ]) {
    const script = read(`${page}/index.js`);
    const markup = read(`${page}/index.wxml`);
    assert.match(script, /enablePageShare/u, page);
    assert.match(script, /onShareAppMessage/u, page);
    assert.match(script, /onShareTimeline/u, page);
    assert.doesNotMatch(script, /updatePageShareImages|shareCardImageUrl|shareTimelineImageUrl/u, page);
    assert.doesNotMatch(markup, /share-card-canvas/u, page);
  }
});
