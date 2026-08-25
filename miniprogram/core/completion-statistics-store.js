'use strict';

const contracts = require('./contracts');
const { stable } = require('./score-store');

class CompletionStatisticsStore {
  constructor(matchId) {
    this.matchId = matchId;
    this.projection = null;
    this.listeners = new Set();
    this.fingerprints = new Map();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    if (this.projection !== null) listener(this.projection);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of [...this.listeners]) listener(this.projection);
  }

  currentVersion() { return this.projection?.projectionVersion || 0; }

  snapshot(value) {
    const next = contracts.completionProjection(value);
    if (next.matchId !== this.matchId) {
      throw new Error('completion statistics match identity conflict');
    }
    if (this.projection && next.projectionVersion < this.currentVersion()) {
      return Object.freeze({ action: 'old_snapshot_ignored' });
    }
    if (this.projection && next.projectionVersion === this.currentVersion()
      && stable(next) !== stable(this.projection)) {
      return Object.freeze({ action: 'resync_required', reason: 'version_conflict' });
    }
    this.projection = next;
    this.notify();
    return Object.freeze({ action: 'snapshot_applied', version: next.projectionVersion });
  }

  frame(value) {
    const frame = contracts.completionRealtimeFrame(value);
    if (frame.matchId !== this.matchId) {
      return Object.freeze({ action: 'resync_required', reason: 'identity_conflict' });
    }
    if (frame.kind === 'snapshot') return this.snapshot(frame.projection);
    if (frame.kind === 'unavailable') return Object.freeze({ action: 'unavailable' });
    if (frame.kind === 'up_to_date') return Object.freeze({ action: 'connection_confirmed' });
    if (frame.kind === 'updates') {
      for (const item of frame.frames) {
        const result = this.applyUpdate(item);
        if (result.action === 'resync_required') return result;
      }
      return Object.freeze({ action: 'update_batch_applied', version: this.currentVersion() });
    }
    return this.applyUpdate(frame);
  }

  applyUpdate(frame) {
    if (this.projection === null) {
      return Object.freeze({ action: 'resync_required', reason: 'missing_snapshot' });
    }
    const current = this.currentVersion();
    const fingerprint = stable(frame);
    if (frame.version < current) {
      return Object.freeze({ action: 'old_update_ignored' });
    }
    if (frame.version === current) {
      const prior = this.fingerprints.get(frame.version);
      if (prior !== undefined && prior !== fingerprint) {
        return Object.freeze({ action: 'resync_required', reason: 'version_conflict' });
      }
      if (frame.kind === 'status') {
        this.projection = Object.freeze({
          ...this.projection,
          dataAsOf: frame.dataAsOf,
          delivery: frame.delivery
        });
        this.notify();
        return Object.freeze({ action: 'status_applied', version: current });
      }
      return Object.freeze({ action: 'duplicate_ignored' });
    }
    // Completion uses a replica-wide cursor. It may jump when other matches
    // change, but every update still names its exact previous match version.
    if (frame.baseVersion !== current) {
      return Object.freeze({ action: 'resync_required', reason: 'version_gap' });
    }
    const changes = frame.kind === 'delta' ? frame.changes : {};
    this.projection = Object.freeze({
      ...this.projection,
      projectionVersion: frame.version,
      dataAsOf: frame.dataAsOf,
      delivery: frame.delivery,
      liveStatistics: Object.prototype.hasOwnProperty.call(changes, 'liveStatistics')
        ? changes.liveStatistics : this.projection.liveStatistics,
      currentResult: Object.prototype.hasOwnProperty.call(changes, 'currentResult')
        ? changes.currentResult : this.projection.currentResult,
      pointByPoint: Object.prototype.hasOwnProperty.call(changes, 'pointByPoint')
        ? changes.pointByPoint : this.projection.pointByPoint
    });
    this.fingerprints.set(frame.version, fingerprint);
    this.notify();
    return Object.freeze({ action: 'update_applied', version: frame.version });
  }
}

module.exports = Object.freeze({ CompletionStatisticsStore });
