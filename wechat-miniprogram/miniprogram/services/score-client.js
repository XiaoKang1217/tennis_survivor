'use strict';

const config = require('../config');
const { SseParser } = require('../core/sse-parser');
const contracts = require('../core/contracts');
const { createSWRCache } = require('../core/swr-cache');
const { loadProjectionResource } = require('../core/projection-resource');
const safeEvents = require('../core/safe-events');
const {
  isEventStreamHandshake,
  isSuccessfulResponse,
  statusCode
} = require('./stream-response');

const TRANSPORT_STATES = Object.freeze([
  'connecting', 'connected', 'reconnecting', 'offline'
]);

const SYSTEM_TIMERS = Object.freeze({
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: handle => clearTimeout(handle),
  setInterval: (callback, delay) => setInterval(callback, delay),
  clearInterval: handle => clearInterval(handle)
});
const SNAPSHOT_TIMEOUT_MS = 8_000;
const MANUAL_REFRESH_SNAPSHOT_TIMEOUT_MS = 20_000;
const MANUAL_REFRESH_REQUEST_TIMEOUT_MS = 22_000;
const RESYNC_BACKOFF_BASE_MS = 2_000;
const RESYNC_BACKOFF_MAX_MS = 60_000;
const STREAM_CLIENT_ID_KEY = 'luwang_v2_score_stream_client_id';
const SCORE_CACHE_SCHEMA = 'scores-today-projection/1';

function scoreCacheKey(date) {
  return 'scores_today:' + String(date || '');
}

function timeoutAfter(timers, delay) {
  let handle;
  const promise = new Promise((_, reject) => {
    handle = timers.setTimeout(() => reject(new Error('score_snapshot_timeout')), delay);
  });
  return Object.freeze({
    promise,
    clear() { if (handle !== undefined) timers.clearTimeout(handle); }
  });
}

function randomBetween(minimum, maximum) {
  const min = Math.max(0, Number(minimum) || 0);
  const max = Math.max(min, Number(maximum) || min);
  return min + Math.floor(Math.random() * (max - min + 1));
}

class ScoreClient {
  constructor(wxRuntime, auth, http, store, timers = SYSTEM_TIMERS) {
    this.wx = wxRuntime;
    this.auth = auth;
    this.http = http;
    this.store = store;
    this.timers = timers;
    this.date = null;
    this.active = false;
    this.hidden = false;
    this.task = null;
    this.reconnectTimer = null;
    this.calibrationTimer = null;
    this.snapshotPending = null;
    this.resyncPending = null;
    this.resyncRetryTimer = null;
    this.reconnectAttempt = 0;
    this.resyncAttempt = 0;
    this.resyncTargetVersion = 0;
    this.transportState = 'connecting';
    this.transportListeners = new Set();
    this.streamGeneration = 0;
  }

  subscribeTransport(listener) {
    this.transportListeners.add(listener);
    listener(this.transportState);
    return () => this.transportListeners.delete(listener);
  }

  setTransportState(value) {
    if (!TRANSPORT_STATES.includes(value)) throw new Error('transport state invalid');
    this.transportState = value;
    for (const listener of [...this.transportListeners]) listener(value);
  }

  async start(officialScheduleDate, options = {}) {
    this.stop();
    this.date = officialScheduleDate;
    this.active = true;
    this.hidden = false;
    this.setTransportState('connecting');
    const currentDate = this.store.projection?.payload?.scheduleGroupDate;
    if (!options.preserveSnapshot || currentDate !== officialScheduleDate) {
      this.store.reset();
    }
    try {
      const initialProjection = options.initialProjection;
      if (initialProjection?.payload?.scheduleGroupDate === officialScheduleDate) {
        const result = this.store.snapshot(initialProjection);
        if (result.action === 'resync_required') {
          throw new Error('snapshot_version_conflict');
        }
        safeEvents.emit('score_snapshot_initial');
      } else {
        await this.fetchSnapshot('initial');
      }
    } catch (error) {
      this.markTransportFailure();
      this.scheduleSnapshotRecovery('initial_retry');
      throw error;
    }
    this.openRealtime();
    this.scheduleCalibration();
  }

  async ensure(officialScheduleDate) {
    if (this.active && !this.hidden && this.date === officialScheduleDate) {
      this.openRealtime();
      this.scheduleCalibration();
      return this.store.projection;
    }
    return this.start(officialScheduleDate);
  }

  scheduleCalibration() {
    // M3 removes the normal 5s full-snapshot loop. Full snapshots are only
    // scheduled by scheduleSnapshotRecovery on cache miss, version gap,
    // foreground restore, or an SSE error.
  }

  clearFallbackCalibration() {
    if (this.calibrationTimer !== null) this.timers.clearTimeout(this.calibrationTimer);
    this.calibrationTimer = null;
  }

  clearResyncRetry() {
    if (this.resyncRetryTimer !== null) this.timers.clearTimeout(this.resyncRetryTimer);
    this.resyncRetryTimer = null;
  }

  stop() {
    this.active = false;
    this.streamGeneration += 1;
    if (this.reconnectTimer !== null) this.timers.clearTimeout(this.reconnectTimer);
    this.clearFallbackCalibration();
    this.clearResyncRetry();
    this.reconnectTimer = null;
    this.resyncPending = null;
    this.resyncTargetVersion = 0;
    this.resyncAttempt = 0;
    if (this.task !== null) this.task.abort();
    this.task = null;
  }

  onHide() {
    this.hidden = true;
    this.streamGeneration += 1;
    if (this.reconnectTimer !== null) this.timers.clearTimeout(this.reconnectTimer);
    this.clearFallbackCalibration();
    this.clearResyncRetry();
    this.reconnectTimer = null;
    this.resyncPending = null;
    this.resyncTargetVersion = 0;
    if (this.task !== null) this.task.abort();
    this.task = null;
  }

  onShow() {
    if (!this.active || !this.hidden) return;
    this.hidden = false;
    this.setTransportState('reconnecting');
    void this.fetchSnapshot('foreground_restore')
      .then(() => {
        this.openRealtime();
      })
      .catch(() => {
        this.markTransportFailure();
        this.scheduleSnapshotRecovery('foreground_restore_retry');
      });
  }

  async fetchSnapshot(reason, options = {}) {
    if (!this.active || this.date === null) return null;
    const force = options.force === true;
    if (!force && this.snapshotPending !== null) return this.snapshotPending;
    const requestedDate = this.date;
    const snapshotTimeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : SNAPSHOT_TIMEOUT_MS;
    const snapshotTimeout = timeoutAfter(this.timers, snapshotTimeoutMs);
    const request = Promise.race([
      this.fetchProjectionForDate(requestedDate, {
        bypassCache: force,
        resolveDefault: options.resolveDefault === true,
        timeoutMs: options.requestTimeoutMs
      }),
      snapshotTimeout.promise
    ]).then(projection => {
      if (!this.active || this.date !== requestedDate) return projection;
      const result = this.store.snapshot(projection);
      if (result.action === 'resync_required') {
        throw new Error('snapshot_version_conflict');
      }
      safeEvents.emit(`score_snapshot_${reason}`);
      return projection;
    }).finally(() => {
      snapshotTimeout.clear();
      if (!force) this.snapshotPending = null;
    });
    if (!force) this.snapshotPending = request;
    return request;
  }

  async fetchProjectionForDate(officialScheduleDate, options = {}) {
    const resolveDefault = options.resolveDefault ? '&resolveDefault=1' : '';
    const bypassCache = options.bypassCache ? `&_refresh=${Date.now()}` : '';
    const requestOptions = {
      authMode: 'none',
      noCache: options.bypassCache === true
    };
    if (Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
      requestOptions.timeout = options.timeoutMs;
    }
    const path = `/api/v1/bff/scores/today?date=${encodeURIComponent(officialScheduleDate)}`
      + `&displayTimezone=${encodeURIComponent(config.displayTimezone)}`
      + resolveDefault
      + bypassCache;
    if (options.resolveDefault === true) {
      return contracts.todayProjection(await this.http.request(path, requestOptions));
    }
    const result = await loadProjectionResource({
      http: this.http,
      cache: createSWRCache(this.wx),
      resourceKey: scoreCacheKey(officialScheduleDate),
      schemaVersion: SCORE_CACHE_SCHEMA,
      path,
      requestOptions,
      force: options.bypassCache === true,
      metadata: { dataAsOf: value => value?.dataAsOf || value?.delivery?.dataAsOf || '' },
      validate: value => contracts.todayProjection(value)
    });
    return result.value;
  }

  reconnectRealtime() {
    if (!this.active || this.hidden) return;
    this.streamGeneration += 1;
    if (this.reconnectTimer !== null) this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.task !== null) this.task.abort();
    this.task = null;
    this.openRealtime();
  }

  async refreshNow(reason = 'manual_refresh') {
    try {
      const projection = await this.fetchSnapshot(reason, {
        force: true,
        timeoutMs: MANUAL_REFRESH_SNAPSHOT_TIMEOUT_MS,
        requestTimeoutMs: MANUAL_REFRESH_REQUEST_TIMEOUT_MS
      });
      this.reconnectAttempt = 0;
      this.resyncAttempt = 0;
      this.resyncTargetVersion = 0;
      this.clearResyncRetry();
      this.reconnectRealtime();
      return projection;
    } catch (error) {
      if (!this.store.projection) throw error;
      try {
        const projection = await this.fetchSnapshot(`${reason}_fallback`, {
          timeoutMs: MANUAL_REFRESH_SNAPSHOT_TIMEOUT_MS,
          requestTimeoutMs: MANUAL_REFRESH_REQUEST_TIMEOUT_MS
        });
        this.reconnectAttempt = 0;
        this.resyncAttempt = 0;
        this.resyncTargetVersion = 0;
        this.clearResyncRetry();
        this.reconnectRealtime();
        return projection;
      } catch (fallbackError) {
        this.markTransportFailure();
        this.scheduleSnapshotRecovery(`${reason}_retry`);
        throw fallbackError;
      }
    }
  }

  async openRealtime() {
    if (!this.active
      || this.hidden
      || this.date === null
      || this.task !== null
      || this.resyncPending !== null
      || this.resyncRetryTimer !== null) return;
    const generation = ++this.streamGeneration;
    if (!this.active || this.hidden || generation !== this.streamGeneration) return;
    const parser = new SseParser(event => {
      if (generation !== this.streamGeneration || !this.active) return;
      try {
        const frame = contracts.realtimeFrame(JSON.parse(event.data));
        const result = this.store.frame(frame);
        if (result.action === 'resync_required') {
          void this.resync(result.reason, result.targetVersion);
          return;
        }
        if (frame.kind !== 'heartbeat') {
          this.reconnectAttempt = 0;
          this.clearFallbackCalibration();
          this.setTransportState('connected');
          safeEvents.emit('score_realtime_client_received');
        }
      } catch {
        void this.resync('invalid_realtime_frame');
      }
    });
    const query = `date=${encodeURIComponent(this.date)}`
      + `&displayTimezone=${encodeURIComponent(config.displayTimezone)}`
      + `&afterVersion=${this.store.currentVersion()}`
      + `&deviceId=${encodeURIComponent(this.streamClientId())}`;
    let accepted = false;
    const task = this.wx.request({
      url: `${config.streamBaseUrl || config.bffBaseUrl}/api/v1/bff/scores/realtime?${query}`,
      method: 'GET',
      enableChunked: true,
      responseType: 'arraybuffer',
      // WeChat applies timeout to the initial request handshake. The server
      // sends bounded heartbeats; completed requests reconnect with afterVersion.
      timeout: 60_000,
      header: {
        accept: 'text/event-stream',
        'x-luwang-client-contract-version': config.clientContractVersion
      },
      success: response => {
        if (generation !== this.streamGeneration) return;
        this.task = null;
        parser.finish();
        if (!isSuccessfulResponse(response)) {
          this.markTransportFailure();
          this.scheduleReconnect();
          this.scheduleSnapshotRecovery('sse_http_error');
          return;
        }
        // wx.request streams are periodically rotated by the client runtime.
        // afterVersion makes the hand-off lossless, so a normal completion is
        // not a user-visible disconnect and should reattach immediately.
        this.setTransportState(this.store.projection ? 'connected' : 'connecting');
        this.scheduleReconnect(0);
      },
      fail: () => {
        if (generation !== this.streamGeneration) return;
        this.task = null;
        this.markTransportFailure();
        this.scheduleReconnect();
        this.scheduleSnapshotRecovery('sse_network_error');
      }
    });
    this.task = task;
    task.onHeadersReceived?.(headers => {
      if (generation !== this.streamGeneration) return;
      if (isEventStreamHandshake(headers)) {
        accepted = true;
        this.setTransportState('connected');
        return;
      }
      task.abort();
      this.task = null;
      this.markTransportFailure();
      this.scheduleReconnect();
      this.scheduleSnapshotRecovery(`sse_handshake_${statusCode(headers) || 'failed'}`);
    });
    task.onChunkReceived?.(chunk => {
      if (generation !== this.streamGeneration) return;
      // Some base-library/device combinations can deliver the first chunk
      // before a useful header callback. A valid SSE parser is the final guard;
      // the completion callback still rejects non-2xx responses.
      if (!accepted) accepted = true;
      parser.feed(chunk.data);
    });
  }

  async resync(reason, targetVersion = 0) {
    if (!this.active || this.hidden) return null;
    const requiredVersion = Number(targetVersion);
    if (Number.isSafeInteger(requiredVersion) && requiredVersion > this.resyncTargetVersion) {
      this.resyncTargetVersion = requiredVersion;
    }
    if (this.resyncPending !== null) return this.resyncPending;
    this.clearResyncRetry();
    this.streamGeneration += 1;
    if (this.task !== null) this.task.abort();
    this.task = null;
    this.setTransportState('reconnecting');
    safeEvents.emit('score_realtime_resync');
    let request;
    request = this.fetchSnapshot('realtime_resync', { force: true })
      .then(projection => {
        const snapshotVersion = Number(projection?.projectionVersion || 0);
        if (this.resyncTargetVersion > 0 && snapshotVersion < this.resyncTargetVersion) {
          throw new Error('score_snapshot_still_behind');
        }
        this.resyncAttempt = 0;
        this.resyncTargetVersion = 0;
        if (this.resyncPending === request) this.resyncPending = null;
        this.openRealtime();
        return projection;
      })
      .catch(() => {
        if (this.resyncPending === request) this.resyncPending = null;
        this.markTransportFailure();
        this.scheduleResyncRetry(reason);
        return null;
      })
      .finally(() => {
        if (this.resyncPending === request) this.resyncPending = null;
      });
    this.resyncPending = request;
    return request;
  }

  markTransportFailure() {
    this.setTransportState(this.store.projection ? 'reconnecting' : 'offline');
  }

  scheduleReconnect(delay) {
    if (!this.active
      || this.hidden
      || this.reconnectTimer !== null
      || this.resyncPending !== null
      || this.resyncRetryTimer !== null) return;
    const base = Math.min(60_000, 1_000 * (2 ** Math.min(this.reconnectAttempt, 5)));
    const jitter = randomBetween(Math.floor(base * 0.25), Math.floor(base * 1.25));
    const wait = delay === undefined ? jitter : delay;
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      this.openRealtime();
    }, wait);
  }

  scheduleResyncRetry(reason) {
    if (!this.active
      || this.hidden
      || this.resyncPending !== null
      || this.resyncRetryTimer !== null) return;
    const base = Math.min(
      RESYNC_BACKOFF_MAX_MS,
      RESYNC_BACKOFF_BASE_MS * (2 ** Math.min(this.resyncAttempt, 5))
    );
    const wait = randomBetween(Math.floor(base * 0.75), Math.floor(base * 1.25));
    this.resyncAttempt += 1;
    this.resyncRetryTimer = this.timers.setTimeout(() => {
      this.resyncRetryTimer = null;
      void this.resync(`${reason || 'version_gap'}_retry`, this.resyncTargetVersion);
    }, wait);
  }

  scheduleSnapshotRecovery(reason) {
    if (!this.active || this.hidden || this.calibrationTimer !== null) return;
    const wait = randomBetween(
      config.fallbackCalibrationMinMilliseconds,
      config.fallbackCalibrationMaxMilliseconds
    );
    this.calibrationTimer = this.timers.setTimeout(() => {
      this.calibrationTimer = null;
      void this.fetchSnapshot(reason).then(() => {
        this.reconnectAttempt = 0;
        if (this.resyncPending === null && this.resyncRetryTimer === null) {
          this.openRealtime();
        }
      }).catch(() => {
        this.markTransportFailure();
        this.scheduleSnapshotRecovery(reason);
      });
    }, wait);
  }

  streamClientId() {
    try {
      const existing = String(this.wx.getStorageSync?.(STREAM_CLIENT_ID_KEY) || '').trim();
      if (/^[A-Za-z0-9._:-]{8,128}$/u.test(existing)) return existing;
      const created = `mp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      this.wx.setStorageSync?.(STREAM_CLIENT_ID_KEY, created);
      return created;
    } catch {
      return `mp-volatile-${Math.random().toString(36).slice(2, 12)}`;
    }
  }
}

module.exports = Object.freeze({
  ScoreClient,
  TRANSPORT_STATES,
  MANUAL_REFRESH_SNAPSHOT_TIMEOUT_MS,
  MANUAL_REFRESH_REQUEST_TIMEOUT_MS,
  SCORE_CACHE_SCHEMA,
  scoreCacheKey,
  SYSTEM_TIMERS
});
