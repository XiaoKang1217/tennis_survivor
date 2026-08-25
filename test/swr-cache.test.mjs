import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SwrCache } = require('../core/swr-cache');

const INDEX_KEY = 'luwang_swr_index_v1';
const entryKey = resourceKey => `luwang_swr_entry_v1:${encodeURIComponent(resourceKey)}`;

function wxRuntime(seed = {}) {
  const storage = new Map(Object.entries(seed));
  return {
    storage,
    removed: [],
    getStorageSync(key) { return storage.get(key); },
    setStorage({ key, data }) { storage.set(key, data); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorage({ key }) { this.removed.push(key); storage.delete(key); },
    removeStorageSync(key) { this.removed.push(key); storage.delete(key); }
  };
}

function payload(version, extra = {}) {
  return { projectionVersion: version, dataAsOf: `2026-08-25T00:0${version}:00.000Z`, ...extra };
}

function storedEntry(resourceKey, schemaVersion, version) {
  return {
    resourceKey,
    schemaVersion,
    projectionVersion: version,
    cachedAt: Date.now(),
    dataAsOf: `2026-08-25T00:0${version}:00.000Z`,
    etag: `etag-${version}`,
    payload: payload(version)
  };
}

test('SWR cache uses the in-memory pending index for LRU eviction before async flush', () => {
  const wx = wxRuntime();
  const cache = new SwrCache(wx, { maxEntries: 2, maxTotalBytes: 10_000, maxEntryBytes: 5_000 });

  assert.equal(cache.write('a', { schemaVersion: 's', projectionVersion: 1, payload: payload(1) }), true);
  assert.equal(cache.write('b', { schemaVersion: 's', projectionVersion: 2, payload: payload(2) }), true);
  assert.equal(cache.write('c', { schemaVersion: 's', projectionVersion: 3, payload: payload(3) }), true);

  assert.deepEqual(cache.getIndex().map(item => item.resourceKey), ['c', 'b']);
  assert.equal(cache.read('a', 's'), null);
  cache.flush();

  assert.equal(wx.storage.has(entryKey('a')), false);
  assert.equal(wx.storage.has(entryKey('b')), true);
  assert.equal(wx.storage.has(entryKey('c')), true);
});

test('SWR cache enforces total capacity and single entry size limits', () => {
  const wx = wxRuntime();
  const cache = new SwrCache(wx, { maxEntries: 10, maxTotalBytes: 540, maxEntryBytes: 360 });

  assert.equal(cache.write('too-large', {
    schemaVersion: 's',
    projectionVersion: 1,
    payload: payload(1, { text: 'x'.repeat(500) })
  }), false);

  assert.equal(cache.write('first', {
    schemaVersion: 's',
    projectionVersion: 1,
    payload: payload(1, { text: 'a'.repeat(120) })
  }), true);
  assert.equal(cache.write('second', {
    schemaVersion: 's',
    projectionVersion: 2,
    payload: payload(2, { text: 'b'.repeat(120) })
  }), true);
  cache.flush();

  assert.deepEqual(cache.getIndex().map(item => item.resourceKey), ['second']);
  assert.equal(wx.storage.has(entryKey('first')), false);
  assert.equal(wx.storage.has(entryKey('second')), true);
});

test('SWR cache cleans corrupt index and schema-mismatched payloads fail closed', () => {
  const old = storedEntry('ranking:ATP', 'schema-old', 1);
  const wx = wxRuntime({
    [INDEX_KEY]: { broken: true },
    [entryKey('ranking:ATP')]: old
  });
  const cache = new SwrCache(wx, { maxEntries: 5 });

  assert.deepEqual(cache.getIndex(), []);
  assert.equal(wx.storage.has(INDEX_KEY), false);
  assert.equal(cache.read('ranking:ATP', 'schema-new'), null);
  assert.equal(wx.storage.has(entryKey('ranking:ATP')), false);
});

test('SWR cache keeps newer trusted projection when concurrent older write arrives', () => {
  const wx = wxRuntime();
  const cache = new SwrCache(wx);

  assert.equal(cache.write('calendar_projection:2026', {
    schemaVersion: 'calendar/1',
    projectionVersion: 8,
    payload: payload(8)
  }), true);
  assert.equal(cache.write('calendar_projection:2026', {
    schemaVersion: 'calendar/1',
    projectionVersion: 7,
    payload: payload(7)
  }), false);
  cache.flush();

  assert.equal(
    wx.storage.get(entryKey('calendar_projection:2026')).projectionVersion,
    8
  );
});
