import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  drawShare,
  matchShare,
  playerShare,
  tournamentShare
} = require('../core/share');

test('match sharing builds a full page path and timeline query', () => {
  const share = matchShare({
    id: 'sc_1234567890abcdef1234567890abcdef',
    scheduleGroupDate: '2026-08-19',
    group: 'ended',
    tournamentName: '辛辛那提',
    roundLabel: '第三轮',
    sides: [{ names: '辛纳' }, { names: '阿尔卡拉斯' }],
    leftScoreCells: [{ value: 6 }, { value: 7, tiebreak: 5 }],
    rightScoreCells: [{ value: 4 }, { value: 6, tiebreak: 3 }]
  });
  assert.match(share.appMessage.title, /^炉网赛果｜辛纳 vs 阿尔卡拉斯/u);
  assert.match(share.appMessage.path, /^\/pages\/match-detail\/index\?/u);
  assert.match(share.appMessage.path, /matchId=sc_1234567890abcdef1234567890abcdef/u);
  assert.equal(Object.hasOwn(share.appMessage, 'imageUrl'), false);
  assert.equal(Object.hasOwn(share.timeline, 'imageUrl'), false);
  assert.doesNotMatch(share.timeline.query, /^\/pages\//u);
});

test('tournament sharing keeps edition identity and title fallback', () => {
  const share = tournamentShare(null, {
    tournamentEditionId: 'tour-2026-cincy',
    title: '辛辛那提公开赛',
    tour: 'wta'
  });
  assert.match(share.appMessage.title, /辛辛那提公开赛/u);
  assert.match(share.appMessage.path, /^\/packages\/tournament\/pages\/tournament-detail\/index\?/u);
  assert.match(share.appMessage.path, /tournamentEditionId=tour-2026-cincy/u);
  assert.match(share.appMessage.path, /tour=wta/u);
  assert.match(share.timeline.query, /shared=tournament/u);
  assert.match(share.timeline.query, /tour=wta/u);
});

test('player sharing uses compact identity parameters only', () => {
  const share = playerShare({
    playerId: 'sinner-jan',
    tour: 'ATP',
    name: '扬尼克·辛纳',
    originalName: 'Jannik Sinner',
    countryCode: 'ITA',
    position: '1',
    points: '12000',
    portraitUrl: 'https://example.invalid/portrait.png'
  });
  assert.match(share.appMessage.title, /世界排名 1/u);
  assert.match(share.appMessage.path, /^\/packages\/player\/pages\/player-detail\/index\?/u);
  assert.match(share.appMessage.path, /playerId=sinner-jan/u);
  assert.doesNotMatch(share.appMessage.path, /portraitUrl/u);
});

test('draw sharing restores the selected draw instead of only the tournament', () => {
  const share = drawShare({
    selectedTournamentId: 'tour-2026-cincy',
    selectedTitle: '辛辛那提公开赛',
    selectedTour: 'wta',
    selectedDrawId: 'cincy-ms-main',
    draws: [
      { drawId: 'cincy-ws-main', label: '女单' },
      { drawId: 'cincy-ms-main', label: '男单' }
    ]
  }, { date: '2026-08-19' });
  assert.match(share.appMessage.title, /男单/u);
  assert.match(share.appMessage.path, /^\/pages\/draws\/index\?/u);
  assert.match(share.appMessage.path, /drawId=cincy-ms-main/u);
  assert.match(share.appMessage.path, /tour=wta/u);
  assert.match(share.timeline.query, /drawId=cincy-ms-main/u);
  assert.match(share.timeline.query, /tour=wta/u);
});
