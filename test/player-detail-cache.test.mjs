import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createSWRCache } = require('../core/swr-cache');

function cacheStorageKey(resourceKey) {
  return 'luwang_swr_entry_v1:' + encodeURIComponent(resourceKey);
}

function known(value) {
  return { state: 'known', value, displayText: String(value), reasonCode: null };
}

function profile(overrides = {}) {
  return {
    bffContractVersion: 'player-profile-bff/2',
    projectionVersion: 3,
    dataAsOf: '2026-08-25T01:00:00.000Z',
    delivery: { state: 'current', message: '球员资料已更新' },
    display: {
      displayName: known('伊加·斯瓦泰克'),
      displayNameOriginal: known('Iga Swiatek'),
      countryCode: known('POL'),
      viewerFollowState: { player: { targetId: 'WTA:1001', followed: true } },
      careerPerformance: {
        titleBadges: [],
        serveStats: { metrics: [] },
        technicalStats: { groups: [] },
        levelRecords: [],
        surfaceRecords: [],
        recentEvents: []
      }
    },
    payload: {
      entry: {
        officialRanking: { position: 2 },
        season: {},
        career: {},
        viewerFollowState: { player: { targetId: 'WTA:1001', followed: true } }
      }
    },
    ...overrides
  };
}

function loadPageDefinition() {
  const pagePath = require.resolve('../packages/player/pages/player-detail/index');
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
    getWindowInfo() { return { statusBarHeight: 44 }; },
    showShareMenu() {}
  };
}

function pageContext(definition, wx, http) {
  return {
    ...definition,
    http,
    cache: createSWRCache(wx),
    data: {
      ...structuredClone(definition.data),
      playerId: '1001',
      tour: 'WTA',
      name: '伊加·斯瓦泰克'
    },
    setData(update, callback) {
      Object.assign(this.data, update);
      if (typeof callback === 'function') callback.call(this);
    }
  };
}

test('player detail keeps trusted profile visible when refresh fails', async () => {
  const definition = loadPageDefinition();
  const cachedProfile = profile();
  const wx = wxRuntime({
    [cacheStorageKey('player_profile:WTA:1001')]: {
      resourceKey: 'player_profile:WTA:1001',
      schemaVersion: 'player-profile-bff-cache/3',
      projectionVersion: 3,
      cachedAt: Date.now(),
      dataAsOf: cachedProfile.dataAsOf,
      etag: 'etag-player',
      payload: cachedProfile
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
  assert.equal(requests[0].options.ifNoneMatch, 'etag-player');
  assert.equal(context.data.failed, false);
  assert.equal(context.data.profileAvailable, true);
  assert.equal(context.data.deliveryState, 'stale');
  assert.equal(context.data.name, '伊加·斯瓦泰克');
  assert.equal(context.data.followed, false);
  assert.equal(context.data.followState, 'unknown');
});
