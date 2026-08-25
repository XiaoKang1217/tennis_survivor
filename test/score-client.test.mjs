import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { presentation, todayProjection } from './support.mjs';

const require = createRequire(import.meta.url);
const {
  ScoreClient,
  MANUAL_REFRESH_REQUEST_TIMEOUT_MS,
  SCORE_CACHE_SCHEMA,
  scoreCacheKey
} = require('../miniprogram/services/score-client');
const { ScoreStore } = require('../miniprogram/core/score-store');
const config = require('../miniprogram/config');

function cacheStorageKey(resourceKey) {
  return 'luwang_swr_entry_v1:' + encodeURIComponent(resourceKey);
}

function inertTimers() {
  return {
    setTimeout(callback, delay) { return { callback, delay }; },
    clearTimeout() {},
    setInterval(callback, delay) { return { callback, delay }; },
    clearInterval() {}
  };
}

function wxRuntime() {
  return {
    getStorageSync() { return undefined; },
    setStorageSync() {},
    request() {
      return {
        abort() {},
        onHeadersReceived() {},
        onChunkReceived() {}
      };
    }
  };
}

const auth = {
  async ensure() { return 'a'.repeat(64); }
};

test('manual score refresh falls back to a normal snapshot when forced refresh fails', async () => {
  const store = new ScoreStore();
  store.snapshot(todayProjection(1));
  const requests = [];
  const http = {
    async request(path, options) {
      requests.push({ path, options });
      if (path.includes('_refresh=')) throw new Error('forced_refresh_failed');
      return todayProjection(2);
    }
  };
  const client = new ScoreClient(wxRuntime(), auth, http, store, inertTimers());
  client.active = true;
  client.date = '2026-08-06';

  const projection = await client.refreshNow('manual_refresh');

  assert.equal(projection.projectionVersion, 2);
  assert.equal(store.currentVersion(), 2);
  assert.equal(requests.length, 2);
  assert.match(requests[0].path, /_refresh=/);
  assert.equal(requests[0].options.noCache, true);
  assert.equal(requests[0].options.timeout, MANUAL_REFRESH_REQUEST_TIMEOUT_MS);
  assert.doesNotMatch(requests[1].path, /_refresh=/);
  assert.equal(requests[1].options.noCache, false);
  assert.equal(requests[1].options.timeout, MANUAL_REFRESH_REQUEST_TIMEOUT_MS);
});

test('score snapshot reuses trusted local projection when HTTP returns 304', async () => {
  const cachedProjection = todayProjection(7);
  const resourceKey = scoreCacheKey('2026-08-06');
  const storage = new Map([[cacheStorageKey(resourceKey), {
    resourceKey,
    schemaVersion: SCORE_CACHE_SCHEMA,
    projectionVersion: cachedProjection.projectionVersion,
    cachedAt: Date.now(),
    dataAsOf: cachedProjection.dataAsOf,
    etag: 'etag-score',
    payload: cachedProjection
  }]]);
  const wx = {
    getStorageSync(key) { return storage.get(key); },
    setStorage({ key, data }) { storage.set(key, data); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
    removeStorage({ key }) { storage.delete(key); },
    request() {
      return {
        abort() {},
        onHeadersReceived() {},
        onChunkReceived() {}
      };
    }
  };
  const requests = [];
  const http = {
    async request(path, options) {
      requests.push({ path, options });
      return { notModified: true, etag: 'etag-score', data: null };
    }
  };
  const client = new ScoreClient(wx, auth, http, new ScoreStore(), inertTimers());

  const projection = await client.fetchProjectionForDate('2026-08-06');

  assert.equal(projection.projectionVersion, 7);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.ifNoneMatch, 'etag-score');
  assert.equal(requests[0].options.allowNotModified, true);
});

test('score store does not let an older snapshot overwrite newer match delivery', () => {
  const store = new ScoreStore();
  const newer = presentation({
    delivery: {
      state: 'live',
      dataNotice: '比分实时更新中',
      dataAsOf: '2026-08-06T23:55:00.000Z',
      showLivePulse: true
    },
    score: {
      displayMode: 'live',
      sets: [
        { setNumber: 1, kind: 'standard', firstSideGames: 6, secondSideGames: 4,
          firstSideTiebreakPoints: null, secondSideTiebreakPoints: null, state: 'complete' },
        { setNumber: 2, kind: 'standard', firstSideGames: 5, secondSideGames: 4,
          firstSideTiebreakPoints: null, secondSideTiebreakPoints: null, state: 'in_progress' }
      ],
      currentGame: { kind: 'standard', firstSidePoints: 40, secondSidePoints: 30 },
      annotation: null
    }
  });
  store.snapshot(todayProjection(1, newer));

  const older = presentation({
    delivery: {
      state: 'live',
      dataNotice: '比分实时更新中',
      dataAsOf: '2026-08-06T23:47:00.000Z',
      showLivePulse: true
    },
    score: {
      displayMode: 'live',
      sets: [
        { setNumber: 1, kind: 'standard', firstSideGames: 6, secondSideGames: 4,
          firstSideTiebreakPoints: null, secondSideTiebreakPoints: null, state: 'complete' },
        { setNumber: 2, kind: 'standard', firstSideGames: 4, secondSideGames: 4,
          firstSideTiebreakPoints: null, secondSideTiebreakPoints: null, state: 'in_progress' }
      ],
      currentGame: { kind: 'standard', firstSidePoints: 15, secondSidePoints: 15 },
      annotation: null
    }
  });
  store.snapshot(todayProjection(2, older));

  assert.equal(store.currentVersion(), 2);
  assert.equal(
    store.projection.payload.matches[0].delivery.dataAsOf,
    '2026-08-06T23:55:00.000Z'
  );
  assert.equal(store.projection.payload.matches[0].score.sets[1].firstSideGames, 5);
});

test('public score SSE uses the stream host without waiting for user auth', async () => {
  const store = new ScoreStore();
  store.snapshot(todayProjection(1));
  let ensureCalls = 0;
  let requestOptions;
  const client = new ScoreClient({
    getStorageSync() { return 'mp-test-client'; },
    setStorageSync() {},
    request(options) {
      requestOptions = options;
      return {
        abort() {},
        onHeadersReceived() {},
        onChunkReceived() {}
      };
    }
  }, {
    async ensure() {
      ensureCalls += 1;
      throw new Error('public SSE must not authenticate');
    }
  }, {}, store, inertTimers());
  client.active = true;
  client.date = '2026-08-06';

  await client.openRealtime();

  assert.equal(ensureCalls, 0);
  assert.match(requestOptions.url, new RegExp(`^${config.streamBaseUrl}`));
  assert.doesNotMatch(JSON.stringify(requestOptions.header), /authorization/i);
  assert.match(requestOptions.url, /deviceId=mp-test-client/u);
});

test('score store applies compact realtime delta to exactly one match card', () => {
  const store = new ScoreStore();
  store.snapshot(todayProjection(1));
  const firstMatchId = store.projection.payload.matches[0].matchId;
  const result = store.frame({
    contractVersion: 'score-realtime/3',
    kind: 'score_delta',
    baseVersion: 1,
    version: 2,
    snapshotVersion: 2,
    projectionGeneratedAt: '2026-08-06T23:31:00.000Z',
    dataAsOf: '2026-08-06T23:31:00.000Z',
    sseBroadcastAt: new Date().toISOString(),
    timings: {
      sourceReceivedAt: '2026-08-06T23:30:59.000Z',
      sgAcceptedAt: '2026-08-06T23:30:59.050Z',
      sgSentAt: '2026-08-06T23:30:59.100Z',
      shReceivedAt: '2026-08-06T23:30:59.200Z'
    },
    changes: [{
      matchId: firstMatchId,
      changes: {
        score: {
          displayMode: 'live',
          sets: [
            { setNumber: 1, kind: 'standard', firstSideGames: 1, secondSideGames: 0,
              firstSideTiebreakPoints: null, secondSideTiebreakPoints: null, state: 'in_progress' }
          ],
          currentGame: null,
          annotation: null
        }
      }
    }]
  });

  assert.equal(result.action, 'compact_delta_applied');
  assert.equal(store.currentVersion(), 2);
  assert.equal(store.projection.payload.matches[0].score.sets[0].firstSideGames, 1);
  const metric = store.latestRealtimeMetric();
  assert.equal(metric.contractVersion, 'score-realtime-client-render/1');
  assert.equal(metric.version, 2);
  assert.deepEqual(metric.matchIds, [firstMatchId]);
  assert.equal(metric.sourceReceivedAt, '2026-08-06T23:30:59.000Z');
  assert.match(metric.clientReceivedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.match(metric.clientRenderedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(typeof metric.sourceToClientReceivedMs, 'number');
  assert.equal(typeof metric.sourceToClientRenderedMs, 'number');
});

test('score store accepts compact replay delta derived before current snapshot', () => {
  const store = new ScoreStore();
  store.snapshot(todayProjection(5));
  const firstMatchId = store.projection.payload.matches[0].matchId;
  const result = store.frame({
    contractVersion: 'score-realtime/3',
    kind: 'score_delta',
    baseVersion: 3,
    version: 6,
    snapshotVersion: 6,
    projectionGeneratedAt: '2026-08-06T23:32:00.000Z',
    dataAsOf: '2026-08-06T23:32:00.000Z',
    changes: [{
      matchId: firstMatchId,
      changes: {
        delivery: {
          state: 'live',
          dataNotice: '比分实时更新中',
          dataAsOf: '2026-08-06T23:32:00.000Z',
          showLivePulse: true
        }
      }
    }]
  });

  assert.equal(result.action, 'compact_delta_applied');
  assert.equal(store.currentVersion(), 6);
  assert.equal(
    store.projection.payload.matches[0].delivery.dataAsOf,
    '2026-08-06T23:32:00.000Z'
  );
});

test('score store accepts bounded compact replay gap from current snapshot', () => {
  const store = new ScoreStore();
  store.snapshot(todayProjection(1000));
  const firstMatchId = store.projection.payload.matches[0].matchId;
  const result = store.frame({
    contractVersion: 'score-realtime/3',
    kind: 'score_delta',
    baseVersion: 30_000,
    version: 30_001,
    snapshotVersion: 30_001,
    projectionGeneratedAt: '2026-08-06T23:33:00.000Z',
    dataAsOf: '2026-08-06T23:33:00.000Z',
    changes: [{
      matchId: firstMatchId,
      changes: {
        status: {
          group: { code: 'in_progress', label: '进行中' },
          code: 'live',
          label: '进行中'
        }
      }
    }]
  });

  assert.equal(result.action, 'compact_delta_applied');
  assert.equal(store.currentVersion(), 30_001);
});

test('score store rejects large compact replay gap', () => {
  const store = new ScoreStore();
  store.snapshot(todayProjection(1000));
  const firstMatchId = store.projection.payload.matches[0].matchId;
  const result = store.frame({
    contractVersion: 'score-realtime/3',
    kind: 'score_delta',
    baseVersion: 1000 + 60 * 1000 + 1,
    version: 1000 + 60 * 1000 + 2,
    snapshotVersion: 1000 + 60 * 1000 + 2,
    projectionGeneratedAt: '2026-08-06T23:34:00.000Z',
    dataAsOf: '2026-08-06T23:34:00.000Z',
    changes: [{
      matchId: firstMatchId,
      changes: {
        delivery: {
          state: 'live',
          dataNotice: '比分实时更新中',
          dataAsOf: '2026-08-06T23:34:00.000Z',
          showLivePulse: true
        }
      }
    }]
  });

  assert.equal(result.action, 'resync_required');
  assert.equal(result.reason, 'version_gap');
});

test('fallback snapshot recovery is jittered between 60 and 120 seconds', () => {
  const timers = {
    scheduled: [],
    setTimeout(callback, delay) {
      this.scheduled.push({ callback, delay });
      return { callback, delay };
    },
    clearTimeout() {},
    setInterval(callback, delay) { return { callback, delay }; },
    clearInterval() {}
  };
  const client = new ScoreClient(wxRuntime(), auth, {}, new ScoreStore(), timers);
  client.active = true;
  client.date = '2026-08-06';

  client.scheduleSnapshotRecovery('sse_error');

  assert.equal(timers.scheduled.length, 1);
  assert.ok(timers.scheduled[0].delay >= config.fallbackCalibrationMinMilliseconds);
  assert.ok(timers.scheduled[0].delay <= config.fallbackCalibrationMaxMilliseconds);
});

test('version gap resync is single-flight and reopens SSE only after snapshot catches up', async () => {
  const store = new ScoreStore();
  store.snapshot(todayProjection(1));
  let resolveSnapshot;
  let httpRequests = 0;
  let streamRequests = 0;
  const client = new ScoreClient({
    getStorageSync() { return 'mp-test-client'; },
    setStorageSync() {},
    request() {
      streamRequests += 1;
      return {
        abort() {},
        onHeadersReceived() {},
        onChunkReceived() {}
      };
    }
  }, auth, {
    async request() {
      httpRequests += 1;
      return await new Promise(resolve => { resolveSnapshot = resolve; });
    }
  }, store, inertTimers());
  client.active = true;
  client.date = '2026-08-06';

  const first = client.resync('version_gap', 5);
  const second = client.resync('version_gap', 6);
  assert.equal(httpRequests, 1);

  resolveSnapshot(todayProjection(6));
  await Promise.all([first, second]);

  assert.equal(httpRequests, 1);
  assert.equal(store.currentVersion(), 6);
  assert.equal(streamRequests, 1);
});

test('version gap waits with jittered backoff when HTTP snapshot is still behind', async () => {
  const store = new ScoreStore();
  store.snapshot(todayProjection(1));
  const timers = {
    scheduled: [],
    setTimeout(callback, delay) {
      this.scheduled.push({ callback, delay });
      return { callback, delay };
    },
    clearTimeout() {},
    setInterval(callback, delay) { return { callback, delay }; },
    clearInterval() {}
  };
  let streamRequests = 0;
  const client = new ScoreClient({
    getStorageSync() { return 'mp-test-client'; },
    setStorageSync() {},
    request() {
      streamRequests += 1;
      return {
        abort() {},
        onHeadersReceived() {},
        onChunkReceived() {}
      };
    }
  }, auth, {
    async request() {
      return todayProjection(1);
    }
  }, store, timers);
  client.active = true;
  client.date = '2026-08-06';

  await client.resync('version_gap', 2);

  assert.equal(store.currentVersion(), 1);
  assert.equal(streamRequests, 0);
  assert.ok(timers.scheduled.length >= 1);
  const retry = timers.scheduled.at(-1);
  assert.ok(retry.delay >= 1_500);
  assert.ok(retry.delay <= 2_500);
});
