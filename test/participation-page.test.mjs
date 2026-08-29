import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const uploadRoot = resolve(import.meta.dirname, '..');

function loadPageDefinition() {
  const pagePath = require.resolve('../pages/participation/index');
  delete require.cache[pagePath];
  let definition;
  const previousPage = globalThis.Page;
  globalThis.Page = value => { definition = value; };
  try { require(pagePath); } finally {
    if (previousPage === undefined) delete globalThis.Page; else globalThis.Page = previousPage;
  }
  return definition;
}

function context(definition) {
  return { ...definition, data: structuredClone(definition.data), setData(update, callback) {
    Object.assign(this.data, update);
    if (typeof callback === 'function') callback();
  } };
}

test('participation page reads the trusted ENTRY-D1 projection', () => {
  const source = [
    readFileSync(resolve(uploadRoot, 'pages/participation/index.js'), 'utf8'),
    readFileSync(resolve(uploadRoot, 'pages/participation/index.wxml'), 'utf8'),
    readFileSync(resolve(uploadRoot, 'services/entry-service.js'), 'utf8')
  ].join('\n');
  assert.match(source, /\/api\/v1\/bff\/entries/u);
  assert.match(source, /按赛事/u);
  assert.match(source, /按球员/u);
  assert.match(source, /identityCoverage/u);
  assert.doesNotMatch(source, /M7-PARTICIPATION-DEFERRED-BY-OWNER|正在准备|接入真实/u);
});

test('participation page renders trusted tournaments and players with stable links', async () => {
  const priorWx = globalThis.wx;
  const priorGetApp = globalThis.getApp;
  let navigated = '';
  globalThis.wx = {
    stopPullDownRefresh() {},
    navigateTo({ url }) { navigated = url; },
    redirectTo() {},
    getStorageSync() { return ''; }, setStorageSync() {}
  };
  globalThis.getApp = () => ({ services: { entries: {
    cachedIndex() { return null; },
    cachedTournament() { return null; },
    async tournament() { return { payload: {
      tournamentId: 'ATP:USO:2026', tournamentName: '美网', tour: 'ATP',
      weekStart: '2026-08-24', competitionLevel: 'grand_slam', entryCount: 3,
      entries: [
        { playerId: 'ATP:A0E2', playerName: '卡洛斯·阿尔卡拉斯', worldRanking: 3, status: 'main_draw' },
        { playerId: 'ATP:UNRANKED', playerName: '未排名球员', status: 'qualifying' },
        { playerId: 'ATP:S0AG', playerName: '扬尼克·辛纳', worldRanking: 1, status: 'main_draw' }
      ]
    } }; },
    async index() {
    return { delivery: { state: 'current' }, payload: {
      dataAsOf: '2026-08-28T02:00:00Z', quality: { identityCoverage: 0.987 },
      tournaments: [{ tour: 'ATP', weekStart: '2026-08-24', competitionLevel: 'grand_slam', tournamentId: 'ATP:USO:2026', tournamentName: '美网', surface: 'Hard', startsOn: '2026-08-24', endsOn: '2026-09-06', entryCount: 3 }],
      players: [{ playerId: 'ATP:S0AG', playerName: '扬尼克·辛纳', nextAppearance: { tournamentId: 'ATP:USO:2026', tournamentName: '美网', startsOn: '2026-08-24', endsOn: '2026-09-06', surface: 'Hard', status: 'main_draw', entryListScope: 'main_draw' }, appearances: [
        { tournamentId: 'ATP:USO:2026', tournamentName: '美网', startsOn: '2026-08-24', endsOn: '2026-09-06', surface: 'Hard', status: 'main_draw', entryListScope: 'main_draw' },
        { tournamentId: 'ATP:BEIJING:2026', tournamentName: '中国网球公开赛', startsOn: '2026-09-28', endsOn: '2026-10-04', surface: 'Hard', status: 'entered', entryListScope: 'main_draw' },
        { tournamentId: 'ATP:SHANGHAI:2026', tournamentName: '上海大师赛', startsOn: '2026-10-05', endsOn: '2026-10-11', surface: 'Hard', status: 'qualifying', entryListScope: 'qualifying' }
      ], previewEntries: [] }]
    } };
  } } } });
  try {
    const definition = loadPageDefinition();
    const page = context(definition);
    await definition.load.call(page);
    await definition.prefetchVisibleTournaments.call(page);
    assert.equal(page.data.tournaments[0].tournamentId, 'ATP:USO:2026');
    assert.equal(page.data.players[0].playerId, 'ATP:S0AG');
    assert.equal(page.data.qualityLabel, '身份匹配 98.7%');
    assert.equal(page.data.tournaments[0].surfaceLabel, '硬地');
    assert.deepEqual(
      page.data.tournaments[0].entries.map(entry => entry.playerId),
      ['ATP:S0AG', 'ATP:A0E2', 'ATP:UNRANKED']
    );
    assert.deepEqual(
      page.data.tournamentGroups[0].items[0].entries.map(entry => entry.playerId),
      ['ATP:S0AG', 'ATP:A0E2', 'ATP:UNRANKED']
    );
    assert.equal(page.data.tournaments[0].entries[0].statusLabel, '正赛');
    assert.equal(page.data.players[0].nextAppearance.dateRange, '2026-08-24 至 2026-09-06');
    assert.equal(page.data.players[0].displayAppearances.length, 3);
    assert.equal(page.data.players[0].displayAppearances[0].appearanceTitle, '下一站：美网');
    assert.equal(page.data.players[0].displayAppearances[0].appearanceMeta,
      '2026-08-24 至 2026-09-06 · 硬地 · 正赛');
    assert.equal(page.data.players[0].displayAppearances[1].appearanceMeta,
      '2026-09-28 至 2026-10-04 · 硬地 · 正赛');
    assert.equal(page.data.players[0].displayAppearances[2].appearanceMeta,
      '2026-10-05 至 2026-10-11 · 硬地 · 资格赛');
    definition.openPlayer.call(page, { currentTarget: { dataset: { id: 'ATP:S0AG' } } });
    assert.equal(navigated, '/packages/player/pages/player-detail/index?playerId=ATP%3AS0AG');
    definition.openTournament.call(page, { currentTarget: { dataset: { id: 'ATP:USO:2026' } } });
    assert.equal(navigated, '/packages/tournament/pages/tournament-detail/index?tournamentEditionId=ATP%3AUSO%3A2026');
  } finally {
    if (priorWx === undefined) delete globalThis.wx; else globalThis.wx = priorWx;
    if (priorGetApp === undefined) delete globalThis.getApp; else globalThis.getApp = priorGetApp;
  }
});

test('participation page separates tours, source weeks and ranked searchable rosters', () => {
  const script = readFileSync(resolve(uploadRoot, 'pages/participation/index.js'), 'utf8');
  const markup = readFileSync(resolve(uploadRoot, 'pages/participation/index.wxml'), 'utf8');
  for (const expected of ['activeTour', 'weekTabs', 'tournamentGroups', 'visiblePlayers', 'worldRanking']) {
    assert.match(script + markup, new RegExp(expected));
  }
  assert.match(script, /levelRank/u);
  assert.match(script, /rankValue\(a\.worldRanking\) - rankValue\(b\.worldRanking\)/u);
  assert.match(script, /rankValue\(first\.worldRanking\) - rankValue\(second\.worldRanking\)/u);
  assert.match(script, /normalizedSearch/u);
  assert.match(script, /sourceWeeks/u);
  assert.match(script, /setData\(\{ \.\.\.next, \.\.\.displayState/u);
  assert.match(markup, /bindtap="toggleTournament"/u);
  assert.match(markup, /本周暂无可公开赛事/u);
  assert.match(markup, /originalPlayerName/u);
  assert.match(markup, /countryCode/u);
});

test('participation tournament expands an already prefetched complete ranked slice instantly', async () => {
  const definition = loadPageDefinition();
  const page = context(definition);
  page.data.tournaments = [{
    tournamentId: 'ATP:USO:2026', entryCount: 2, entries: [
      { playerId: 'ATP:S0AG', playerName: '扬尼克·辛纳', worldRanking: 1 },
      { playerId: 'ATP:A0E2', playerName: '卡洛斯·阿尔卡拉斯', worldRanking: 3 }
    ]
  }];
  await definition.toggleTournament.call(page, {
    currentTarget: { dataset: { id: 'ATP:USO:2026' } }
  });
  assert.equal(page.data.expandedTournamentId, 'ATP:USO:2026');
  assert.deepEqual(page.data.tournaments[0].entries.map(entry => entry.playerId),
    ['ATP:S0AG', 'ATP:A0E2']);
});
