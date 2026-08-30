import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const uploadRoot = resolve(import.meta.dirname, '..');
const { compactEntryIndex, jsonByteSize } = require('../core/entry-index');
const { EntryService } = require('../services/entry-service');

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

function largeEntryProjection(version = 100) {
  const weeks = ['2026-08-30', '2026-09-07', '2026-09-14', '2026-09-21'];
  const tournaments = Array.from({ length: 27 }, (_, index) => ({
    tournamentId: `T:${index}`,
    tournamentName: `赛事${index}`,
    originalTournamentName: `Tournament ${index}`,
    tour: index < 14 ? 'ATP' : 'WTA',
    weekStart: weeks[index % weeks.length],
    competitionLevel: index % 3 ? '250' : 'grand_slam',
    surface: 'Hard', startsOn: weeks[index % weeks.length], endsOn: '2026-09-30',
    entryCount: 80, debugBlob: 'x'.repeat(1800)
  }));
  const players = Array.from({ length: 710 }, (_, index) => {
    const tour = index < 439 ? 'ATP' : 'WTA';
    const appearances = Array.from({ length: 3 }, (__, appearanceIndex) => ({
      tournamentId: `T:${(index + appearanceIndex) % 27}`,
      tournamentName: `赛事${(index + appearanceIndex) % 27}`,
      tour, weekStart: weeks[appearanceIndex], startsOn: weeks[appearanceIndex],
      endsOn: '2026-09-30', surface: 'Hard', status: appearanceIndex ? 'entered' : 'main_draw',
      entryListScope: 'main_draw', debugBlob: 'y'.repeat(280)
    }));
    return {
      playerId: `${tour}:P${index}`, playerName: `球员${index}`,
      originalPlayerName: `Player ${index}`, countryCode: index % 2 ? 'CHN' : 'USA',
      tour, worldRanking: index + 1, portraitUrl: `https://media.example/${index}.jpg`,
      entryCount: 3, nextAppearance: appearances[0], appearances,
      debugBlob: 'z'.repeat(900)
    };
  });
  return {
    contractVersion: 'entry-index/2', schemaVersion: 'entry-index/2',
    projectionVersion: version, dataAsOf: `2026-08-30T08:00:${version % 60}Z`,
    delivery: { state: 'current' },
    payload: { dataAsOf: '2026-08-30T08:00:00Z', quality: { identityCoverage: 0.99 },
      sourceWeeks: { ATP: weeks, WTA: weeks }, tournaments, players }
  };
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
      players: [{ playerId: 'ATP:S0AG', playerName: '扬尼克·辛纳', tour: 'ATP', nextAppearance: { tournamentId: 'ATP:USO:2026', tournamentName: '美网', startsOn: '2026-08-24', endsOn: '2026-09-06', surface: 'Hard', status: 'main_draw', entryListScope: 'main_draw' }, appearances: [
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
    await definition.toggleTournament.call(page, {
      currentTarget: { dataset: { id: 'ATP:USO:2026' } }
    });
    definition.selectView.call(page, { currentTarget: { dataset: { view: 'players' } } });
    assert.equal(page.entryIndex.tournaments[0].tournamentId, 'ATP:USO:2026');
    assert.equal(page.data.visiblePlayers[0].playerId, 'ATP:S0AG');
    assert.equal(page.data.qualityLabel, '身份匹配 98.7%');
    assert.equal(page.entryIndex.tournaments[0].surfaceLabel, '硬地');
    assert.deepEqual(
      page.tournamentDetails.get('ATP:USO:2026').entries.map(entry => entry.playerId),
      ['ATP:S0AG', 'ATP:A0E2', 'ATP:UNRANKED']
    );
    assert.deepEqual(
      page.currentDisplay({ activeView: 'tournaments' }).tournamentGroups[0].items[0].entries.map(entry => entry.playerId),
      ['ATP:S0AG', 'ATP:A0E2', 'ATP:UNRANKED']
    );
    assert.equal(page.tournamentDetails.get('ATP:USO:2026').entries[0].statusLabel, '正赛');
    assert.equal(page.data.visiblePlayers[0].displayAppearances.length, 3);
    assert.equal(page.data.visiblePlayers[0].displayAppearances[0].appearanceTitle, '下一站：美网');
    assert.equal(page.data.visiblePlayers[0].displayAppearances[0].appearanceMeta,
      '2026-08-24 至 2026-09-06 · 硬地 · 正赛');
    assert.equal(page.data.visiblePlayers[0].displayAppearances[1].appearanceMeta,
      '2026-09-28 至 2026-10-04 · 硬地 · 正赛');
    assert.equal(page.data.visiblePlayers[0].displayAppearances[2].appearanceMeta,
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
  assert.match(script, /this\.entryIndex =/u);
  assert.doesNotMatch(script, /data:\s*\{[^}]*tournaments:\s*\[\][^}]*players:\s*\[\]/su);
  assert.match(script, /playerPageSize:\s*50/u);
  assert.match(markup, /bindtap="toggleTournament"/u);
  assert.match(markup, /本周暂无可公开赛事/u);
  assert.match(markup, /originalPlayerName/u);
  assert.match(markup, /countryCode/u);
});

test('participation tournament expands an already prefetched complete ranked slice instantly', async () => {
  const definition = loadPageDefinition();
  const page = context(definition);
  const detail = {
    tournamentId: 'ATP:USO:2026', tournamentName: '美网', tour: 'ATP',
    weekStart: '2026-08-24', competitionLevel: 'grand_slam', entryCount: 2, entries: [
      { playerId: 'ATP:S0AG', playerName: '扬尼克·辛纳', worldRanking: 1 },
      { playerId: 'ATP:A0E2', playerName: '卡洛斯·阿尔卡拉斯', worldRanking: 3 }
    ]
  };
  page.entryIndex = { tournaments: [detail], players: [], sourceWeeks: {} };
  page.tournamentDetails = new Map([['ATP:USO:2026', detail]]);
  await definition.toggleTournament.call(page, {
    currentTarget: { dataset: { id: 'ATP:USO:2026' } }
  });
  assert.equal(page.data.expandedTournamentId, 'ATP:USO:2026');
  assert.deepEqual(page.data.tournamentGroups[0].items[0].entries.map(entry => entry.playerId),
    ['ATP:S0AG', 'ATP:A0E2']);
});

test('a 1.4MB entry projection is compacted before trusted SWR caching', async () => {
  const raw = largeEntryProjection();
  assert.ok(jsonByteSize(raw) > 1_400_000);
  const lite = compactEntryIndex(raw);
  assert.ok(jsonByteSize(lite) < 900 * 1024);
  assert.equal(lite.payload.players.length, 710);
  assert.equal(lite.payload.tournaments.length, 27);
  assert.equal(Object.hasOwn(lite.payload.players[0], 'debugBlob'), false);

  const stored = new Map();
  const wxRuntime = {
    getStorageSync(key) { return stored.get(key); },
    setStorageSync(key, value) { stored.set(key, value); },
    setStorage({ key, data }) { stored.set(key, data); },
    removeStorageSync(key) { stored.delete(key); }
  };
  let requests = 0;
  const service = new EntryService(wxRuntime, { async request() {
    requests += 1;
    return requests === 1
      ? { statusCode: 200, data: raw, etag: 'entry-etag-100' }
      : { statusCode: 304, notModified: true, data: null, etag: 'entry-etag-100' };
  } });
  const first = await service.index();
  assert.equal(first.schemaVersion, 'entry-index-lite/1');
  assert.ok(service.cachedIndex());
  const second = await service.index();
  assert.equal(second.projectionVersion, first.projectionVersion);
  assert.equal(requests, 2);
});

test('participation keeps full data off setData and pages every player without identity loss', () => {
  const priorGetApp = globalThis.getApp;
  globalThis.getApp = () => ({ services: { entries: {
    cachedTournament() { return null; },
    async tournament() { throw new Error('not_prefetched_in_test'); }
  } } });
  try {
    const definition = loadPageDefinition();
    const updates = [];
    const page = { ...definition, data: structuredClone(definition.data), setData(update, callback) {
      updates.push({ bytes: jsonByteSize(update), update });
      Object.assign(this.data, update);
      if (typeof callback === 'function') callback();
    } };
    const lite = compactEntryIndex(largeEntryProjection());
    definition.applyIndex.call(page, lite, false);
    assert.ok(updates[0].bytes < 200 * 1024);
    assert.equal(Object.hasOwn(page.data, 'tournaments'), false);
    assert.equal(Object.hasOwn(page.data, 'players'), false);

    definition.selectView.call(page, { currentTarget: { dataset: { view: 'players' } } });
    assert.equal(page.data.visiblePlayers.length, 50);
    assert.equal(page.data.playerTotal, 439);
    assert.equal(page.data.visiblePlayers[0].playerId, 'ATP:P0');
    definition.nextPlayerPage.call(page);
    assert.equal(page.data.visiblePlayers[0].playerId, 'ATP:P50');
    definition.selectTour.call(page, { currentTarget: { dataset: { tour: 'WTA' } } });
    assert.equal(page.data.playerTotal, 271);
    assert.equal(page.data.visiblePlayers[0].playerId, 'WTA:P439');
    assert.ok(Math.max(...updates.slice(1).map(item => item.bytes)) < 100 * 1024);
  } finally {
    if (priorGetApp === undefined) delete globalThis.getApp; else globalThis.getApp = priorGetApp;
  }
});

test('trusted cache renders before refresh and an uncached failure exits loading', async () => {
  const priorWx = globalThis.wx;
  const priorGetApp = globalThis.getApp;
  globalThis.wx = { stopPullDownRefresh() {} };
  const cached = compactEntryIndex(largeEntryProjection(101));
  const fresh = compactEntryIndex(largeEntryProjection(102));
  const states = [];
  try {
    globalThis.getApp = () => ({ services: { entries: {
      cachedIndex() { return cached; }, cachedTournament() { return null; },
      async index() { return fresh; }, async tournament() { throw new Error('unused'); }
    } } });
    const definition = loadPageDefinition();
    const page = { ...definition, data: structuredClone(definition.data), setData(update, callback) {
      Object.assign(this.data, update);
      if ('stale' in update) states.push(update.stale);
      if (typeof callback === 'function') callback();
    } };
    await definition.load.call(page);
    assert.deepEqual(states, [true, false]);

    globalThis.getApp = () => ({ services: { entries: {
      cachedIndex() { return null; }, async index() { throw new Error('parse_failed'); }
    } } });
    const failed = context(definition);
    await definition.load.call(failed);
    assert.equal(failed.data.loading, false);
    assert.equal(failed.data.failed, true);
  } finally {
    if (priorWx === undefined) delete globalThis.wx; else globalThis.wx = priorWx;
    if (priorGetApp === undefined) delete globalThis.getApp; else globalThis.getApp = priorGetApp;
  }
});
