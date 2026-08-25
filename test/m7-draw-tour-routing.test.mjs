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

function drawIndexPayload(overrides = {}) {
  return {
    bffContractVersion: 'draw-player-entry-bff/1',
    tournamentEditionId: 'UO',
    projectionVersion: 7,
    dataAsOf: '2026-08-24T16:00:00.000Z',
    defaultDrawId: '',
    items: [],
    delivery: { state: 'current', message: '签表已更新' },
    ...overrides
  };
}

function loadPageDefinition(path) {
  const pagePath = require.resolve(path);
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
    navigated: '',
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    setStorage({ key, data }) { storage.set(key, data); },
    removeStorageSync(key) { storage.delete(key); },
    removeStorage({ key }) { storage.delete(key); },
    getWindowInfo() { return { statusBarHeight: 44 }; },
    showToast() {},
    redirectTo(options) { this.redirected = options.url; },
    navigateTo(options) { this.navigated = options.url; },
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

test('draw page keeps WTA US Open requests and cache isolated by tour', async () => {
  const definition = loadPageDefinition('../miniprogram/pages/draws/index');
  const cachedPayload = drawIndexPayload();
  const wx = wxRuntime({
    [cacheStorageKey('draw_index:UO:wta')]: {
      resourceKey: 'draw_index:UO:wta',
      schemaVersion: 'draw-index-projection/1',
      projectionVersion: cachedPayload.projectionVersion,
      cachedAt: Date.now(),
      dataAsOf: cachedPayload.dataAsOf,
      etag: 'etag-wta',
      payload: cachedPayload
    }
  });
  const requests = [];
  const context = pageContext(definition, wx, {
    async request(path, options) {
      requests.push({ path, options });
      return { notModified: true, etag: 'etag-wta', data: null };
    }
  }, {
    selectedTournamentId: 'UO',
    selectedTitle: '美国网球公开赛',
    selectedTour: 'wta'
  });

  await definition.loadIndex.call(context);

  assert.equal(requests.length, 1);
  assert.match(requests[0].path, /tournamentEditionId=UO/u);
  assert.match(requests[0].path, /tour=wta/u);
  assert.doesNotMatch(requests[0].path, /_refresh=/u);
  assert.equal(requests[0].options.ifNoneMatch, 'etag-wta');
  assert.equal(context.data.failed, false);
});

test('draw page all-tour requests do not reuse the WTA draw cache', async () => {
  const definition = loadPageDefinition('../miniprogram/pages/draws/index');
  const wx = wxRuntime({
    [cacheStorageKey('draw_index:UO:wta')]: {
      resourceKey: 'draw_index:UO:wta',
      schemaVersion: 'draw-index-projection/1',
      projectionVersion: 7,
      cachedAt: Date.now(),
      dataAsOf: '2026-08-24T16:00:00.000Z',
      etag: 'etag-wta',
      payload: drawIndexPayload()
    }
  });
  const requests = [];
  const context = pageContext(definition, wx, {
    async request(path, options) {
      requests.push({ path, options });
      return { data: drawIndexPayload({ projectionVersion: 8 }), etag: 'etag-all' };
    }
  }, {
    selectedTournamentId: 'UO',
    selectedTitle: '美国网球公开赛',
    selectedTour: ''
  });

  await definition.loadIndex.call(context);

  assert.equal(requests.length, 1);
  assert.match(requests[0].path, /tournamentEditionId=UO/u);
  assert.doesNotMatch(requests[0].path, /tour=/u);
  assert.equal(requests[0].options.ifNoneMatch, undefined);
});

test('calendar draw-selection entries carry tour into the draw page', () => {
  const wxml = readFileSync(resolve(miniRoot, 'pages/calendar/index.wxml'), 'utf8');
  assert.match(wxml, /data-tour="\{\{item\.requestTour\}\}"/u);

  const definition = loadPageDefinition('../miniprogram/pages/calendar/index');
  const wx = wxRuntime();
  const previousWx = globalThis.wx;
  globalThis.wx = wx;
  const item = {
    id: 'UO',
    title: '美国网球公开赛',
    requestTour: 'wta',
    drawAvailable: true
  };
  const context = {
    ...definition,
    data: { ...structuredClone(definition.data), drawSelectionMode: true, allItems: [item] },
    setData(update, callback) {
      Object.assign(this.data, update);
      if (typeof callback === 'function') callback.call(this);
    }
  };
  try {
    definition.openTournament.call(context, {
      currentTarget: { dataset: { id: 'UO', title: item.title, tour: 'wta' } }
    });
  } finally {
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
  }

  assert.match(wx.redirected, /^\/pages\/draws\/index\?/u);
  assert.match(wx.redirected, /tournamentEditionId=UO/u);
  assert.match(wx.redirected, /tour=wta/u);
});
