'use strict';

const config = require('../config');
const contracts = require('../core/contracts');
const {
  isEventStreamHandshake,
  isSuccessfulResponse,
  statusCode
} = require('./stream-response');
const { SseParser } = require('../core/sse-parser');
const safeEvents = require('../core/safe-events');

const TRANSPORT_STATES = Object.freeze([
  'connecting', 'connected', 'reconnecting', 'offline'
]);

const SYSTEM_TIMERS = Object.freeze({
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: handle => clearTimeout(handle),
  setInterval: (callback, delay) => setInterval(callback, delay),
  clearInterval: handle => clearInterval(handle)
});

class StatisticsClient {
  constructor(wxRuntime, auth, http, store, timers = SYSTEM_TIMERS) {
    this.wx = wxRuntime;
    this.auth = auth;
    this.http = http;
    this.store = store;
    this.timers = timers;
    this.matchId = store.matchId;
    this.active = false;
    this.hidden = false;
    this.task = null;
    this.calibrationTimer = null;
    this.reconnectTimer = null;
    this.snapshotPending = null;
    this.generation = 0;
    this.attempt = 0;
    this.transportState = 'connecting';
    this.listeners = new Set();
  }

  subscribeTransport(listener) {
    this.listeners.add(listener);
    listener(this.transportState);
    return () => this.listeners.delete(listener);
  }

  setTransportState(value) {
    if (!TRANSPORT_STATES.includes(value)) {
      throw new Error('statistics transport state invalid');
    }
    this.transportState = value;
    for (const listener of [...this.listeners]) listener(value);
  }

  async start() {
    this.stop();
    this.active = true;
    this.hidden = false;
    this.setTransportState('connecting');
    try {
      await this.fetchSnapshot();
    } catch (error) {
      this.markTransportFailure();
      this.scheduleReconnect();
      throw error;
    }
    this.openRealtime();
    this.scheduleCalibration();
  }

  scheduleCalibration() {
    if (!this.active || this.hidden || this.calibrationTimer !== null) return;
    this.calibrationTimer = this.timers.setInterval(() => {
      void this.fetchSnapshot().catch(() => this.markTransportFailure());
    }, config.statisticsCalibrationMilliseconds);
  }

  stop() {
    this.active = false;
    this.generation += 1;
    if (this.task) this.task.abort();
    if (this.calibrationTimer !== null) this.timers.clearInterval(this.calibrationTimer);
    if (this.reconnectTimer !== null) this.timers.clearTimeout(this.reconnectTimer);
    this.task = null;
    this.calibrationTimer = null;
    this.reconnectTimer = null;
  }

  onHide() {
    this.hidden = true;
    this.generation += 1;
    if (this.calibrationTimer !== null) this.timers.clearInterval(this.calibrationTimer);
    if (this.reconnectTimer !== null) this.timers.clearTimeout(this.reconnectTimer);
    this.calibrationTimer = null;
    this.reconnectTimer = null;
    if (this.task) this.task.abort();
    this.task = null;
  }

  onShow() {
    if (!this.active || !this.hidden) return;
    this.hidden = false;
    void this.fetchSnapshot().then(() => {
      this.openRealtime();
      this.scheduleCalibration();
    })
      .catch(() => {
        this.markTransportFailure();
        this.scheduleReconnect();
      });
  }

  async fetchSnapshot(options = {}) {
    if (!this.active) return null;
    const force = options.force === true;
    if (!force && this.snapshotPending) return this.snapshotPending;
    const refreshQuery = force ? `?_refresh=${Date.now()}` : '';
    const request = this.http.request(
      `/api/v1/bff/matches/${encodeURIComponent(this.matchId)}/statistics${refreshQuery}`,
      { noCache: force }
    ).then(value => {
      const projection = contracts.statisticsProjection(value);
      const result = this.store.snapshot(projection);
      if (result.action === 'resync_required') throw new Error('statistics_conflict');
      safeEvents.emit('statistics_snapshot_received');
      return projection;
    }).catch(error => {
      if (error.statusCode === 404 && this.store.projection === null) {
        return null;
      }
      throw error;
    }).finally(() => { if (!force) this.snapshotPending = null; });
    if (!force) this.snapshotPending = request;
    return request;
  }

  reconnectRealtime() {
    if (!this.active || this.hidden) return;
    this.generation += 1;
    if (this.task) this.task.abort();
    if (this.reconnectTimer !== null) this.timers.clearTimeout(this.reconnectTimer);
    this.task = null;
    this.reconnectTimer = null;
    this.openRealtime();
    this.scheduleCalibration();
  }

  async refreshNow() {
    const projection = await this.fetchSnapshot({ force: true });
    this.attempt = 0;
    this.reconnectRealtime();
    return projection;
  }

  async openRealtime() {
    if (!this.active || this.hidden || this.task) return;
    const generation = ++this.generation;
    let token;
    try { token = await this.auth.ensure(); } catch {
      this.setTransportState(this.store.projection ? 'reconnecting' : 'offline');
      this.scheduleReconnect();
      return;
    }
    if (!this.active || this.hidden || generation !== this.generation) return;
    const parser = new SseParser(event => {
      if (generation !== this.generation || !this.active) return;
      try {
        const frame = contracts.statisticsRealtimeFrame(JSON.parse(event.data));
        const result = this.store.frame(frame);
        if (result.action === 'resync_required') {
          void this.resync();
        } else if (result.action === 'unavailable') {
          this.setTransportState('connected');
        } else if (frame.kind !== 'up_to_date') {
          this.attempt = 0;
          this.setTransportState('connected');
        }
      } catch { void this.resync(); }
    });
    const query = `afterVersion=${this.store.currentVersion()}`;
    let accepted = false;
    const task = this.wx.request({
      url: `${config.bffBaseUrl}/api/v1/bff/matches/${encodeURIComponent(this.matchId)}`
        + `/statistics/realtime?${query}`,
      method: 'GET',
      enableChunked: true,
      responseType: 'arraybuffer',
      timeout: 60_000,
      header: {
        accept: 'text/event-stream',
        authorization: `Bearer ${token}`,
        'x-luwang-client-contract-version': config.clientContractVersion
      },
      success: response => {
        if (generation !== this.generation) return;
        this.task = null;
        parser.finish();
        if (statusCode(response) === 401) this.auth.invalidate();
        if (!isSuccessfulResponse(response)) {
          this.markTransportFailure();
          this.scheduleReconnect();
          return;
        }
        this.setTransportState(this.store.projection ? 'connected' : 'connecting');
        this.scheduleReconnect(0);
      },
      fail: () => {
        if (generation !== this.generation) return;
        this.task = null;
        this.markTransportFailure();
        this.scheduleReconnect();
      }
    });
    this.task = task;
    task.onHeadersReceived?.(headers => {
      if (generation !== this.generation) return;
      if (isEventStreamHandshake(headers)) {
        accepted = true;
        this.setTransportState('connected');
        return;
      }
      task.abort();
      this.task = null;
      if (statusCode(headers) === 401) this.auth.invalidate();
      this.markTransportFailure();
      this.scheduleReconnect();
    });
    task.onChunkReceived?.(chunk => {
      if (generation !== this.generation) return;
      if (!accepted) accepted = true;
      parser.feed(chunk.data);
    });
  }

  async resync() {
    this.generation += 1;
    if (this.task) this.task.abort();
    this.task = null;
    try {
      await this.fetchSnapshot();
      this.openRealtime();
    } catch {
      this.markTransportFailure();
      this.scheduleReconnect();
    }
  }

  markTransportFailure() {
    this.setTransportState(this.store.projection ? 'reconnecting' : 'offline');
  }

  scheduleReconnect(delay) {
    if (!this.active || this.hidden || this.reconnectTimer !== null) return;
    const wait = delay ?? Math.min(10_000, 1_000 * (2 ** Math.min(this.attempt, 3)));
    this.attempt += 1;
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      void this.fetchSnapshot().catch(() => undefined).finally(() => {
        this.openRealtime();
        this.scheduleCalibration();
      });
    }, wait);
  }
}

module.exports = Object.freeze({ StatisticsClient, TRANSPORT_STATES, SYSTEM_TIMERS });
