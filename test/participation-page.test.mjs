import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const miniRoot = resolve(import.meta.dirname, '../miniprogram');
const { createSWRCache } = require('../miniprogram/core/swr-cache');

function cacheStorageKey(resourceKey) {
  return 'luwang_swr_entry_v1:' + encodeURIComponent(resourceKey);
}

function participationProjection(events = [], overrides = {}) {
  return {
    bffContractVersion: 'participation-projection-bff/1',
    projectionVersion: 4,
    dataAsOf: '2026-08-25T12:00:00.000Z',
    delivery: {
      state: 'current',
      message: '参赛动态已更新',
      dataAsOf: '2026-08-25T12:00:00.000Z'
    },
    payload: { events },
    ...overrides
  };
}

function loadPageDefinition() {
  const pagePath = require.resolve('../miniprogram/pages/participation/index');
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
    redirected: '',
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    setStorage({ key, data }) { storage.set(key, data); },
    removeStorageSync(key) { storage.delete(key); },
    removeStorage({ key }) { storage.delete(key); },
    redirectTo(options) { this.redirected = options.url; },
    showShareMenu() {}
  };
}

function pageContext(definition, wx, http, data = {}) {
  return {
    ...definition,
    http,
    cache: createSWRCache(wx),
    data: { ...structuredClone(definition.data), ...data },
    setData(update, callback) {
      Object.assign(this.data, update);
      if (typeof callback === 'function') callback.call(this);
    }
  };
}

test('participation page is no longer an engineering placeholder', () => {
  const source = [
    readFileSync(resolve(miniRoot, 'pages/participation/index.js'), 'utf8'),
    readFileSync(resolve(miniRoot, 'pages/participation/index.wxml'), 'utf8'),
    readFileSync(resolve(miniRoot, 'pages/participation/index.wxss'), 'utf8')
  ].join('\n');
  assert.doesNotMatch(source, /TOUR WATCH|正在准备|当前接口|接入真实|尚未返回可信/u);
  assert.match(source, /loadProjectionResource/u);
  assert.match(source, /readTrustedProjection/u);
  assert.match(source, /authMode: 'none'/u);
});

test('participation page reads the public projection and renders an empty state', async () => {
  const definition = loadPageDefinition();
  const wx = wxRuntime();
  const requests = [];
  const context = pageContext(definition, wx, {
    async request(path, options) {
      requests.push({ path, options });
      return { statusCode: 200, data: participationProjection([]), etag: 'entry-v4' };
    }
  });

  await definition.load.call(context);
  context.cache.flush?.();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/api/v1/bff/participation?limit=30');
  assert.equal(requests[0].options.authMode, 'none');
  assert.equal(requests[0].options.ifNoneMatch, undefined);
  assert.equal(context.data.failed, false);
  assert.equal(context.data.hasEvents, false);
  assert.equal(context.data.deliveryMessage, '当前暂无参赛动态');
  assert.deepEqual(context.data.summaryItems.map(item => item.count), ['0', '0', '0', '0']);
});

test('participation page preserves cached content when refresh fails', async () => {
  const cachedPayload = participationProjection([{
    id: 'change-1',
    kind: 'withdrawal',
    playerName: 'Jessica Pegula',
    tournamentName: '美国网球公开赛',
    drawName: '女单资格赛',
    occurredAt: '2026-08-25T10:30:00.000Z',
    reason: '赛前退赛'
  }]);
  const wx = wxRuntime({
    [cacheStorageKey('participation_projection:latest')]: {
      resourceKey: 'participation_projection:latest',
      schemaVersion: 'participation-projection-bff/1',
      projectionVersion: 4,
      cachedAt: Date.now(),
      dataAsOf: cachedPayload.dataAsOf,
      etag: 'cached-entry',
      payload: cachedPayload
    }
  });
  const definition = loadPageDefinition();
  const requests = [];
  const context = pageContext(definition, wx, {
    async request(path, options) {
      requests.push({ path, options });
      throw new Error('network_down');
    }
  });

  await definition.load.call(context);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.ifNoneMatch, 'cached-entry');
  assert.equal(context.data.failed, false);
  assert.equal(context.data.deliveryState, 'stale');
  assert.equal(context.data.hasEvents, true);
  assert.equal(context.data.eventItems[0].kindLabel, '退赛');
  assert.equal(context.data.eventItems[0].title, 'Jessica Pegula');
  assert.match(context.data.eventItems[0].subtitle, /美国网球公开赛/u);
});

test('participation page maps server event kinds without invented totals', async () => {
  const definition = loadPageDefinition();
  const wx = wxRuntime();
  const context = pageContext(definition, wx, {
    async request() {
      return {
        statusCode: 200,
        data: participationProjection([
          { id: 'a', type: 'entry_added', playerName: 'Aryna Sabalenka', tournamentName: '美国网球公开赛' },
          { id: 'b', type: 'withdrawal', playerName: 'Iga Swiatek', tournamentName: '美国网球公开赛' },
          { id: 'c', type: 'alternate_in', playerName: 'Emma Navarro', tournamentName: '美国网球公开赛' },
          { id: 'd', type: 'list_update', title: '女单资格赛名单更新', tournamentName: '美国网球公开赛' }
        ]),
        etag: 'entry-v5'
      };
    }
  });

  await definition.load.call(context);
  context.cache.flush?.();

  assert.deepEqual(
    context.data.summaryItems.map(item => [item.label, item.count]),
    [['新增', '1'], ['退赛', '1'], ['替补', '1'], ['名单更新', '1']]
  );
  assert.deepEqual(context.data.eventItems.map(item => item.kindLabel), [
    '新增', '退赛', '替补', '名单更新'
  ]);
  assert.equal(context.data.eventItems[3].title, '女单资格赛名单更新');
});
