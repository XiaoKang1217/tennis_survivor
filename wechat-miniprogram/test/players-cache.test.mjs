import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createSWRCache } = require('../core/swr-cache');

function cacheStorageKey(resourceKey) {
  return 'luwang_swr_entry_v1:' + encodeURIComponent(resourceKey);
}

function available(value) {
  return { state: 'available', value, reasonCode: null, message: null };
}

function rankingProjection() {
  return {
    bffContractVersion: 'official-ranking-bff/2',
    projectionVersion: 22,
    dataAsOf: '2026-08-25T01:10:00.000Z',
    delivery: { state: 'current', message: '官方排名已更新' },
    payload: {
      snapshot: {
        hasMore: false,
        nextOffset: 1,
        entries: [{
          playerId: '1001',
          displayNameZh: available('扬尼克·辛纳'),
          displayNameOriginal: available('Jannik Sinner'),
          countryCode: available('ITA'),
          movement: available(0),
          position: 1,
          points: 12000,
          viewerFollowState: { player: { targetId: 'ATP:1001', followed: false } },
          followCount: 18
        }]
      }
    }
  };
}

function h2hProjection() {
  return {
    bffContractVersion: 'player-h2h-bff/1',
    projectionVersion: 5,
    dataAsOf: '2026-08-25T01:30:00.000Z',
    payload: {
      authority: 'ATP',
      players: [
        { playerId: '1001', displayNameZh: '扬尼克·辛纳', countryCode: 'ITA' },
        { playerId: '1002', displayNameZh: '卡洛斯·阿尔卡拉斯', countryCode: 'ESP' }
      ],
      aggregate: { player1Wins: 6, player2Wins: 4, matchCount: 10 },
      summary: { hasMeetings: true },
      displaySections: [],
      history: [{
        sourceMatchId: 'h2h-1',
        occurredOn: '2026-08-10',
        tournamentNameZh: '辛辛那提公开赛',
        levelLabelZh: '大师赛',
        surfaceLabelZh: '硬地',
        roundLabelZh: '决赛',
        result: '6-4 7-6',
        winnerSide: 1,
        winnerNameZh: '扬尼克·辛纳'
      }]
    }
  };
}

function loadPageDefinition() {
  const pagePath = require.resolve('../packages/player/pages/players/index');
  delete require.cache[pagePath];
  let definition;
  const previousPage = globalThis.Page;
  globalThis.Page = value => { definition = value; };
  try {
    require(pagePath);
  } finally {
    if (previousPage === undefined) delete globalThis.Page;
    else globalThis.Page = previousPage;
  }
  return definition;
}

function wxRuntime(seed = {}) {
  const storage = new Map(Object.entries(seed));
  return {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    setStorage({ key, data }) { storage.set(key, data); },
    removeStorageSync(key) { storage.delete(key); },
    removeStorage({ key }) { storage.delete(key); },
    getWindowInfo() { return { statusBarHeight: 44 }; }
  };
}

function pageContext(definition, wx, http) {
  return {
    ...definition,
    http,
    followService: {},
    cache: createSWRCache(wx),
    data: {
      ...structuredClone(definition.data),
      section: 'ranking',
      rankingKind: 'official',
      authority: 'ATP',
      query: '',
      pageSize: 50,
      offset: 0
    },
    filter() {
      definition.filter.call(this);
    },
    setData(update, callback) {
      Object.assign(this.data, update);
      if (typeof callback === 'function') callback.call(this);
    }
  };
}

test('players ranking keeps trusted list visible when refresh fails', async () => {
  const definition = loadPageDefinition();
  const projection = rankingProjection();
  const wx = wxRuntime({
    [cacheStorageKey('player_list:ATP:official:50:0:')]: {
      resourceKey: 'player_list:ATP:official:50:0:',
      schemaVersion: 'player-list-projection/2',
      projectionVersion: projection.projectionVersion,
      cachedAt: Date.now(),
      dataAsOf: projection.dataAsOf,
      etag: 'etag-ranking',
      payload: projection
    }
  });
  const requests = [];
  const context = pageContext(definition, wx, {
    async request(path, options) {
      requests.push({ path, options });
      throw new Error('network_down');
    }
  });

  await definition.load.call(context);

  assert.equal(requests.length, 1);
  assert.match(requests[0].path, /\/api\/v2\/bff\/rankings\/current/u);
  assert.equal(requests[0].options.ifNoneMatch, 'etag-ranking');
  assert.equal(context.data.failed, false);
  assert.equal(context.data.deliveryState, 'stale');
  assert.equal(context.data.players[0].name, '扬尼克·辛纳');
  assert.equal(context.data.visiblePlayers[0].followCountLabel, '18人关注');
});

test('players h2h keeps trusted result visible when refresh fails', async () => {
  const definition = loadPageDefinition();
  const projection = h2hProjection();
  const wx = wxRuntime({
    [cacheStorageKey('player_h2h:ATP:1001:1002')]: {
      resourceKey: 'player_h2h:ATP:1001:1002',
      schemaVersion: 'player-h2h-bff/1',
      projectionVersion: projection.projectionVersion,
      cachedAt: Date.now(),
      dataAsOf: projection.dataAsOf,
      etag: 'etag-h2h',
      payload: projection
    }
  });
  const requests = [];
  const context = pageContext(definition, wx, {
    async request(path, options) {
      requests.push({ path, options });
      throw new Error('network_down');
    }
  });
  Object.assign(context.data, {
    section: 'h2h',
    authority: 'ATP',
    h2hPlayer1: '扬尼克·辛纳',
    h2hPlayer2: '卡洛斯·阿尔卡拉斯',
    h2hSelected1: { playerId: '1001', name: '扬尼克·辛纳' },
    h2hSelected2: { playerId: '1002', name: '卡洛斯·阿尔卡拉斯' }
  });

  await definition.searchH2h.call(context);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.ifNoneMatch, 'etag-h2h');
  assert.equal(context.data.h2hFailed, false);
  assert.equal(context.data.h2hResult.totalMatches, 10);
  assert.equal(context.data.h2hMessage, '刷新暂未成功，已保留上次交手记录');
});
