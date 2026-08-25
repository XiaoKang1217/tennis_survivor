import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const miniRoot = resolve(import.meta.dirname, '../miniprogram');
const read = relative => readFileSync(resolve(miniRoot, relative), 'utf8');
const {
  drawShare,
  matchShare,
  playerShare,
  tournamentShare
} = require('../miniprogram/core/share');

test('four share types prefer generated cards and keep production fallbacks', () => {
  const match = matchShare(
    { id: 'm1', sides: [{ names: 'A' }, { names: 'B' }] },
    { date: '2026-08-25', cardImageUrl: '/tmp/match-card.jpg', timelineImageUrl: '/tmp/match-square.jpg' }
  );
  assert.equal(match.appMessage.imageUrl, '/tmp/match-card.jpg');
  assert.equal(match.timeline.imageUrl, '/tmp/match-square.jpg');
  assert.match(match.appMessage.path, /shared=match/u);

  const player = playerShare({
    playerId: 'p1',
    name: 'Zheng Qinwen',
    shareCardImageUrl: '/tmp/player-card.jpg',
    shareTimelineImageUrl: '/tmp/player-square.jpg'
  });
  assert.equal(player.appMessage.imageUrl, '/tmp/player-card.jpg');
  assert.equal(player.timeline.imageUrl, '/tmp/player-square.jpg');
  assert.match(player.timeline.query, /shared=player/u);

  const draw = drawShare({
    selectedTournamentId: 't1',
    selectedTitle: '美国网球公开赛',
    selectedDrawId: 'd1',
    draws: [{ drawId: 'd1', label: '女单资格赛' }],
    shareCardImageUrl: '/tmp/draw-card.jpg',
    shareTimelineImageUrl: '/tmp/draw-square.jpg'
  });
  assert.equal(draw.appMessage.imageUrl, '/tmp/draw-card.jpg');
  assert.equal(draw.timeline.imageUrl, '/tmp/draw-square.jpg');
  assert.match(draw.appMessage.path, /shared=draw/u);

  const tournament = tournamentShare(
    { tournamentEditionId: 't1', name: { value: '美国网球公开赛' } },
    { cardImageUrl: '/tmp/tournament-card.jpg', timelineImageUrl: '/tmp/tournament-square.jpg' }
  );
  assert.equal(tournament.appMessage.imageUrl, '/tmp/tournament-card.jpg');
  assert.equal(tournament.timeline.imageUrl, '/tmp/tournament-square.jpg');
  assert.match(tournament.timeline.query, /shared=tournament/u);
});

test('share poster canvas covers match player draw and tournament pages', () => {
  const poster = read('core/share-poster.js');
  assert.match(poster, /function drawMatchCard/u);
  assert.match(poster, /function drawPlayerCard/u);
  assert.match(poster, /function drawDrawPoster/u);
  assert.match(poster, /function drawTournamentPoster/u);
  assert.doesNotMatch(poster, /player-share-portrait-sample/u);
  for (const page of ['match-detail', 'player-detail', 'draws', 'tournament-detail']) {
    assert.match(read(`pages/${page}/index.js`), /updatePageShareImages/u, page);
    assert.match(read(`pages/${page}/index.wxml`), /share-card-canvas/u, page);
  }
  assert.equal(
    existsSync(resolve(miniRoot, 'assets/player-share-portrait-sample.png')),
    false
  );
});
