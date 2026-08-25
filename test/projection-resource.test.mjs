import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  loadProjectionResource,
  normalizeProjectionResponse,
  readTrustedProjection
} = require('../miniprogram/core/projection-resource');

function cache(seed = null) {
  const writes = [];
  return {
    writes,
    read() { return seed; },
    write(resourceKey, value) { writes.push({ resourceKey, value }); return true; }
  };
}

test('projection resource reuses trusted cache on 304 without rewriting', async () => {
  const cached = {
    resourceKey: 'draw_index:UO:wta',
    schemaVersion: 'draw-index-projection/1',
    cachedAt: Date.now(),
    etag: 'etag-wta',
    payload: {
      bffContractVersion: 'draw-player-entry-bff/1',
      projectionVersion: 12,
      items: []
    }
  };
  const backingCache = cache(cached);
  const requests = [];
  const result = await loadProjectionResource({
    http: {
      async request(path, options) {
        requests.push({ path, options });
        return { notModified: true, etag: 'etag-wta', data: null };
      }
    },
    cache: backingCache,
    resourceKey: cached.resourceKey,
    schemaVersion: cached.schemaVersion,
    path: '/api/v1/bff/draws?tournamentEditionId=UO&tour=wta',
    validate(value) { return value; }
  });

  assert.equal(requests[0].options.ifNoneMatch, 'etag-wta');
  assert.equal(result.value, cached.payload);
  assert.equal(result.source, 'cache-not-modified');
  assert.equal(backingCache.writes.length, 0);
});

test('projection resource writes fresh 200 payload with response etag', async () => {
  const backingCache = cache(null);
  const result = await loadProjectionResource({
    http: {
      async request() {
        return {
          notModified: false,
          etag: 'etag-new',
          data: { projectionVersion: 2, dataAsOf: '2026-08-25T01:00:00.000Z' }
        };
      }
    },
    cache: backingCache,
    resourceKey: 'calendar_projection:2026',
    schemaVersion: 'calendar-projection-bff/1',
    path: '/api/v1/bff/calendar/2026',
    validate(value) { return value; }
  });

  assert.equal(result.source, 'network');
  assert.equal(backingCache.writes.length, 1);
  assert.equal(backingCache.writes[0].value.etag, 'etag-new');
  assert.equal(backingCache.writes[0].value.projectionVersion, 2);
});

test('projection resource helpers are fail-closed on corrupt local cache', () => {
  assert.equal(normalizeProjectionResponse({ notModified: true }, { ok: true }).value.ok, true);
  assert.equal(readTrustedProjection({ read() { throw new Error('bad_storage'); } }, 'x', 's'), null);
});
