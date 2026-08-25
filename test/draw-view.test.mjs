import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  drawColumns,
  drawRoundView,
  drawSelectionView,
  officialMetadataView,
  localizedOutcomeText,
  tournamentDrawFacts
} = require('../core/draw-view');
const miniRoot = resolve(import.meta.dirname, '..');

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
  assert.equal(column.matches[0].firstEntry, '资格赛晋级 · Q');
  assert.equal(column.matches[0].secondEntry, '外卡 · WC');
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

test('draw metadata presents current-draw awards and separates withdrawals from draw changes', () => {
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
    withdrawals: [{
      id: 'w1', displayName: 'Player One', reason: '伤病',
      effectiveAt: '2026-08-25T10:30:00.000Z'
    }],
    drawChanges: [{
      id: 'c1', kind: 'replacement', originalName: 'Player One',
      replacementName: 'Player Two', roundLabel: 'R128', positionLabel: '第 18 位'
    }],
    incidents: [{
      kind: 'retirement_or_walkover', displayName: 'Match Result',
      reason: null, rawReason: 'RET'
    }]
  });
  assert.deepEqual(result.roundAwards.map(value => value.round), ['第一轮', '冠军']);
  assert.equal(result.roundAwards[1].points, '1000 分');
  assert.equal(result.withdrawals[0].kind, '退赛');
  assert.equal(result.withdrawals[0].reason, '伤病');
  assert.equal(result.drawChanges[0].kind, '替补');
  assert.equal(result.drawChanges[0].replacementName, 'Player Two');
  assert.equal(result.incidents.length, 2);
  assert.doesNotMatch(JSON.stringify(result.incidents), /Match Result|RET/u);
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
    '女单 · 正赛',
    '女双 · 正赛',
    '女单 · 资格赛'
  ]);
  assert.deepEqual(
    result.awardGroups.map(group => group.rows.map(row => row.prize)),
    [['USD 1,085,220'], ['USD 379,080'], ['USD 15,800']]
  );
});

test('draw selection and vertical round view bind everything to the selected draw', () => {
  const draws = [
    { drawId: 'ws-main', tourOrg: 'WTA', discipline: 'singles', stage: 'main_draw' },
    { drawId: 'ws-qualifying', tourOrg: 'WTA', discipline: 'singles', stage: 'qualifying' },
    { drawId: 'wd-main', tourOrg: 'WTA', discipline: 'doubles', stage: 'main_draw' }
  ];
  const selection = drawSelectionView(draws, 'ws-qualifying');
  assert.deepEqual(selection.projectOptions.map(item => [item.label, item.selected]), [
    ['女单', true],
    ['女双', false]
  ]);
  assert.deepEqual(selection.stageOptions.map(item => [item.label, item.drawId, item.selected]), [
    ['正赛', 'ws-main', false],
    ['资格赛', 'ws-qualifying', true]
  ]);
  assert.equal(selection.selectedDrawLabel, '女单 · 资格赛');

  const view = drawRoundView({
    currentRoundId: 'q2',
    rounds: [
      { roundId: 'q1', displayNameZh: 'Q1' },
      { roundId: 'q2', displayNameZh: 'Q2' }
    ],
    slots: [
      {
        slotId: 'team-1', participantSideId: available('team-1'),
        participant: {
          members: [
            { playerId: 'p1', displayNameZh: available('球员一'), countryCode: available('CHN') },
            { playerId: 'p2', displayNameOriginal: available('Player Two'), countryCode: available('USA') }
          ]
        }
      },
      { slotId: 'team-2', state: 'pending' }
    ],
    matches: [{
      nodeId: 'm1', roundId: 'q2', slotIds: ['team-1', 'team-2'],
      matchId: available('match-1'), canOpenMatch: true,
      winnerSideId: available('team-1'), statusLabel: 'Completed',
      score: { sets: [{ firstSideGames: 6, secondSideGames: 4 }] }
    }]
  });
  assert.equal(view.selectedRoundTitle, '资格赛第二轮');
  assert.equal(view.roundMatches[0].status, '');
  assert.deepEqual(view.roundMatches[0].sides[0].members.map(member => member.name), [
    '球员一',
    'Player Two'
  ]);
  assert.equal(view.roundMatches[0].sides[0].members[1].country, 'USA');
});

test('draw page exposes final vertical structure and independent landscape route', () => {
  const wxml = readFileSync(
    resolve(miniRoot, 'pages/draws/index.wxml'),
    'utf8'
  );
  assert.match(wxml, /切换赛事/);
  assert.match(wxml, /项目/);
  assert.match(wxml, /阶段/);
  assert.match(wxml, /奖金积分/);
  assert.match(wxml, /本签表暂无退赛记录/);
  assert.match(wxml, /本签表暂无变动/);
  assert.match(wxml, /查找球员/);
  assert.match(wxml, /横屏看全签表/);
  assert.match(wxml, /roundMatches/);
  assert.match(wxml, /side\.members/);
  assert.match(wxml, /side\.scores/);
  assert.doesNotMatch(wxml, /签表顶点|签表变动与退赛|搜索本周赛事或球员|全屏/);
  const app = readFileSync(resolve(miniRoot, 'app.json'), 'utf8');
  assert.match(app, /"root":\s*"packages\/tournament"/u);
  assert.match(app, /pages\/draw-landscape\/index/);
  const landscape = readFileSync(
    resolve(miniRoot, 'packages/tournament/pages/draw-landscape/index.wxml'),
    'utf8'
  );
  assert.match(landscape, /退出横屏/);
  assert.match(landscape, /当前轮次/);
  assert.match(landscape, /总览/);
  assert.match(landscape, /mini-map/);
  const wxss = readFileSync(
    resolve(miniRoot, 'pages/draws/index.wxss'),
    'utf8'
  );
  assert.match(wxss, /\.round-match-card/u);
  assert.match(wxss, /\.member-list/u);
  assert.match(wxss, /\.score-grid/u);
});
