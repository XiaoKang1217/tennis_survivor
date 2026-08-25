import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  drawColumns,
  officialMetadataView,
  localizedOutcomeText,
  tournamentDrawFacts
} = require('../miniprogram/core/draw-view');
const miniRoot = resolve(import.meta.dirname, '../miniprogram');

const available = value => ({
  state: 'available', value, reasonCode: null, message: null
});

test('draw view keeps Q/WC, winner, every-set score and tiebreak mini points', () => {
  const firstId = 'side-1';
  const presentation = {
    rounds: [{ roundId: 'round-1', displayNameZh: '决赛' }],
    slots: [
      {
        slotId: 'slot-1', state: 'resolved',
        participantSideId: available(firstId),
        participant: {
          participantSideId: firstId,
          displayNameZh: available('萨巴伦卡'),
          displayNameOriginal: available('Aryna Sabalenka')
        },
        seedNumber: available(1), entryLabelZh: 'Q'
      },
      {
        slotId: 'slot-2', state: 'resolved',
        participantSideId: available('side-2'),
        participant: {
          participantSideId: 'side-2',
          displayNameZh: available('斯瓦泰克'),
          displayNameOriginal: available('Iga Swiatek')
        },
        seedNumber: available(2), entryLabelZh: 'WC'
      }
    ],
    matches: [{
      nodeId: 'node-1', roundId: 'round-1', slotIds: ['slot-1', 'slot-2'],
      matchId: available('match-1'), canOpenMatch: true,
      statusLabel: '中途退赛 · RET', scoreText: '7-6(5) 2-1 RET',
      winnerSideId: available(firstId),
      score: {
        sets: [
          {
            firstSideGames: 7, secondSideGames: 6,
            firstSideTiebreakPoints: 7, secondSideTiebreakPoints: 5
          },
          {
            firstSideGames: 2, secondSideGames: 1,
            firstSideTiebreakPoints: null, secondSideTiebreakPoints: null
          }
        ]
      }
    }]
  };
  const [column] = drawColumns(presentation);
  assert.equal(column.title, '决赛');
  assert.equal(column.matches[0].firstEntry, 'Q');
  assert.equal(column.matches[0].secondEntry, 'WC');
  assert.equal(column.matches[0].hasFirstScores, true);
  assert.equal(column.matches[0].hasSecondScores, true);
  assert.equal(column.matches[0].firstWon, true);
  assert.deepEqual(column.matches[0].secondScores, [
    { games: '6', tiebreak: '5' },
    { games: '1', tiebreak: '' }
  ]);
  assert.equal(column.matches[0].scoreText, '7-6(5) 2-1 中途退赛');
});

test('draw outcome labels use Chinese display text for special results', () => {
  assert.equal(localizedOutcomeText('RET'), '中途退赛');
  assert.equal(localizedOutcomeText('W/O'), '赛前退赛');
  assert.equal(localizedOutcomeText('6-4 2-1 RET'), '6-4 2-1 中途退赛');
});

test('draw metadata presents all awards through champion and honest incidents', () => {
  const result = officialMetadataView({
    roundAwards: [
      {
        roundKey: 'r128', roundLabel: 'R128',
        prizeMoney: { raw: '$10,000' }, rankingPoints: { value: 10 }
      },
      {
        roundKey: 'champion', roundLabel: 'Champion',
        prizeMoney: { raw: '$1,000,000' }, rankingPoints: { value: 1000 }
      }
    ],
    incidents: [{
      kind: 'retirement_or_walkover', displayName: 'Player One',
      reason: null, rawReason: '(Illness)'
    }]
  });
  assert.deepEqual(result.roundAwards.map(value => value.round), ['128强', '冠军']);
  assert.equal(result.roundAwards[1].points, '1000 分');
  assert.equal(result.incidents[0].kind, '退赛 / 赛前晋级');
  assert.equal(result.incidents[0].reason, '(Illness)');
});

test('draw view does not invent champion node before official winner exists', () => {
  const presentation = {
    rounds: [{ roundId: 'round-final', displayNameZh: '决赛' }],
    slots: [
      {
        slotId: 'slot-1',
        participantSideId: available('side-1'),
        participant: {
          participantSideId: 'side-1',
          displayNameZh: available('球员一')
        }
      },
      {
        slotId: 'slot-2',
        participantSideId: available('side-2'),
        participant: {
          participantSideId: 'side-2',
          displayNameZh: available('球员二')
        }
      }
    ],
    matches: [{
      nodeId: 'node-final',
      roundId: 'round-final',
      slotIds: ['slot-1', 'slot-2'],
      matchId: available('match-final'),
      canOpenMatch: true,
      statusLabel: '待赛',
      score: { sets: [] }
    }]
  };
  const columns = drawColumns(presentation);
  assert.equal(columns.length, 1);
  assert.equal(columns[0].title, '决赛');
});

test('draw view labels unresolved advancement slots as winner pending', () => {
  const presentation = {
    rounds: [{ roundId: 'round-2', displayNameZh: '第二轮' }],
    slots: [
      {
        slotId: 'slot-1',
        participantSideId: available('side-1'),
        participant: {
          participantSideId: 'side-1',
          displayNameZh: available('萨巴伦卡')
        }
      },
      {
        slotId: 'slot-2',
        state: 'pending',
        participantSideId: { state: 'unavailable', value: null }
      }
    ],
    matches: [{
      nodeId: 'node-1',
      roundId: 'round-2',
      slotIds: ['slot-1', 'slot-2'],
      matchId: { state: 'unavailable', value: null },
      canOpenMatch: false,
      statusLabel: '待赛',
      score: { sets: [] }
    }]
  };
  const [column] = drawColumns(presentation);
  assert.equal(column.matches[0].second, '胜者待定');
  assert.equal(column.matches[0].hasFirstScores, false);
  assert.equal(column.matches[0].hasSecondScores, false);
});

test('draw facts keep main, qualifying and doubles awards separated', () => {
  const mixedAwards = [
    {
      discipline: 'singles', stage: 'main_draw', roundKey: 'winner',
      roundLabel: 'Winner',
      prizeMoney: { raw: 'USD 1,085,220' },
      rankingPoints: { value: 1000 }
    },
    {
      discipline: 'doubles', stage: 'main_draw', roundKey: 'winner',
      roundLabel: 'Winner',
      prizeMoney: { raw: 'USD 379,080' },
      rankingPoints: { value: 1000 }
    },
    {
      discipline: 'singles', stage: 'qualifying', roundKey: 'q1',
      roundLabel: 'Q1',
      prizeMoney: { raw: 'USD 15,800' },
      rankingPoints: { value: 10 }
    }
  ];
  const result = tournamentDrawFacts([
    {
      drawId: 'singles-main',
      tourOrg: 'WTA',
      stage: 'main_draw',
      discipline: 'singles',
      officialMetadata: { roundAwards: mixedAwards, incidents: [] }
    },
    {
      drawId: 'doubles-main',
      tourOrg: 'WTA',
      stage: 'main_draw',
      discipline: 'doubles',
      officialMetadata: { roundAwards: mixedAwards, incidents: [] }
    },
    {
      drawId: 'singles-qualifying',
      tourOrg: 'WTA',
      stage: 'qualifying',
      discipline: 'singles',
      officialMetadata: { roundAwards: mixedAwards, incidents: [] }
    }
  ]);
  assert.deepEqual(result.awardGroups.map(group => group.label), [
    '正赛 · 女单',
    '正赛 · 女双',
    '资格赛 · 女单'
  ]);
  assert.deepEqual(
    result.awardGroups.map(group => group.rows.map(row => row.prize)),
    [['USD 1,085,220'], ['USD 379,080'], ['USD 15,800']]
  );
});

test('draw page exposes award, incident and side-score UI', () => {
  const wxml = readFileSync(
    resolve(miniRoot, 'pages/draws/index.wxml'),
    'utf8'
  );
  assert.match(wxml, /每轮奖金与积分/);
  assert.match(wxml, /签表变动与退赛/);
  assert.match(wxml, /match\.firstScores/);
  assert.match(wxml, /match\.hasFirstScores \? 'has-score' : 'no-score'/);
  assert.match(wxml, /wx:if="\{\{match\.hasFirstScores\}\}"/);
  assert.match(wxml, /item\.tiebreak/);
  const wxss = readFileSync(
    resolve(miniRoot, 'pages/draws/index.wxss'),
    'utf8'
  );
  assert.match(wxss, /-webkit-line-clamp:2/);
  assert.match(wxss, /\.side-row\.no-score/u);
  assert.match(wxss, /\.participant\{[^}]*font-size:19rpx/u);
});
