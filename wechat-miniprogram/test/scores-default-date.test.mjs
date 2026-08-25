import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { presentation, todayProjection } from './support.mjs';

const require = createRequire(import.meta.url);
const { ScoreStore } = require('../core/score-store');
const { beijingDate, moveDate } = require('../core/schedule-date');
const { createSWRCache } = require('../core/swr-cache');

const SCORE_CACHE_SCHEMA = 'scores-today-projection/1';
const DEFAULT_DATE_CACHE_SCHEMA = 'scores-default-date-selection/1';
const entryKey = resourceKey => `luwang_swr_entry_v1:${encodeURIComponent(resourceKey)}`;
const scoreCacheKey = date => `scores_today:${date}`;
const defaultDateCacheKey = date => `scores_default_date:${date}`;

function scheduleForDate(date) {
  const base = presentation().schedule;
  return {
    ...base,
    officialScheduleDate: date,
    scheduleGroupDate: date
  };
}

function projectionForDate(date, version = 7) {
  const projection = todayProjection(version, presentation({
    schedule: scheduleForDate(date)
  }));
  projection.payload.scheduleGroupDate = date;
  projection.payload.officialDate = date;
  projection.dataAsOf = `2026-08-25T0${version}:00:00.000Z`;
  projection.projectionGeneratedAt = `2026-08-25T0${version}:00:01.000Z`;
  return projection;
}

function swrEntry(resourceKey, schemaVersion, projectionVersion, payload) {
  return {
    resourceKey,
    schemaVersion,
    projectionVersion,
    cachedAt: Date.now(),
    dataAsOf: payload.projectionGeneratedAt || payload.dataAsOf,
    etag: `etag-${projectionVersion}`,
    payload
  };
}

function loadPageDefinition() {
  const pagePath = require.resolve('../pages/scores/index');
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
    storage,
    getWindowInfo() { return { statusBarHeight: 24 }; },
    getSystemInfoSync() { return { statusBarHeight: 24 }; },
    getMenuButtonBoundingClientRect() { return { top: 28, height: 32 }; },
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    setStorage({ key, data }) { storage.set(key, data); },
    removeStorageSync(key) { storage.delete(key); },
    removeStorage({ key }) { storage.delete(key); }
  };
}

function pageContext(definition) {
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(update, callback) {
      Object.assign(this.data, update);
      if (typeof callback === 'function') callback.call(this);
    }
  };
}

async function runScoresPage({ wx, scoreClient }) {
  const definition = loadPageDefinition();
  const context = pageContext(definition);
  const scoreStore = new ScoreStore();
  const services = {
    auth: { subscribe(listener) { listener('ready'); return () => {}; } },
    scoreStore,
    scoreClient: {
      subscribeTransport(listener) { listener('connecting'); return () => {}; },
      stop() {},
      markTransportFailure() {},
      scheduleSnapshotRecovery() {},
      ensure() { return Promise.resolve(scoreStore.projection); },
      ...scoreClient
    }
  };
  const previousWx = globalThis.wx;
  const previousGetApp = globalThis.getApp;
  globalThis.wx = wx;
  globalThis.getApp = () => ({ services });
  try {
    definition.onLoad.call(context, {});
    await context.initialStartPromise;
    createSWRCache(wx).flush?.();
  } finally {
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
    if (previousGetApp === undefined) delete globalThis.getApp;
    else globalThis.getApp = previousGetApp;
  }
  return { context, scoreStore };
}

test('scores page starts from cached server default date selection while offline', async () => {
  const preferredDate = beijingDate();
  const selectedDate = moveDate(preferredDate, -1);
  const projection = projectionForDate(selectedDate, 7);
  const starts = [];
  const wx = wxRuntime({
    [entryKey(defaultDateCacheKey(preferredDate))]: swrEntry(
      defaultDateCacheKey(preferredDate),
      DEFAULT_DATE_CACHE_SCHEMA,
      7,
      { preferredDate, selectedDate, projection }
    )
  });

  const { context } = await runScoresPage({
    wx,
    scoreClient: {
      async fetchProjectionForDate() { throw new Error('offline'); },
      async start(date, options) {
        starts.push({ date, options });
        return options.initialProjection;
      }
    }
  });

  assert.equal(context.data.selectedDate, selectedDate);
  assert.equal(context.data.hasProjection, true);
  assert.equal(starts[0].date, selectedDate);
  assert.equal(starts[0].options.initialProjection.payload.scheduleGroupDate, selectedDate);
});

test('scores page writes the server default date pointer and matching projection online', async () => {
  const preferredDate = beijingDate();
  const selectedDate = moveDate(preferredDate, -1);
  const projection = projectionForDate(selectedDate, 8);
  const wx = wxRuntime();

  const { context } = await runScoresPage({
    wx,
    scoreClient: {
      async fetchProjectionForDate(date, options) {
        assert.equal(date, preferredDate);
        assert.equal(options.resolveDefault, true);
        return projection;
      },
      async start(date, options) {
        assert.equal(date, selectedDate);
        assert.equal(options.initialProjection, projection);
        return projection;
      }
    }
  });

  const defaultEntry = wx.storage.get(entryKey(defaultDateCacheKey(preferredDate)));
  const scoreEntry = wx.storage.get(entryKey(scoreCacheKey(selectedDate)));
  assert.equal(context.data.selectedDate, selectedDate);
  assert.equal(defaultEntry.schemaVersion, DEFAULT_DATE_CACHE_SCHEMA);
  assert.equal(defaultEntry.payload.selectedDate, selectedDate);
  assert.equal(scoreEntry.schemaVersion, SCORE_CACHE_SCHEMA);
  assert.equal(scoreEntry.payload.payload.scheduleGroupDate, selectedDate);
});
