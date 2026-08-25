'use strict';

const contracts = require('./contracts');
const { stable } = require('./score-store');

const PATCH_PATH = /^(display\.sides\.[01]\.(aces|doubleFaults|firstServesIn|firstServePointsWon|secondServePointsWon|breakPointsConverted|breakPointsSaved|serviceGames|returnGames|returnPointsWon|totalPointsWon|winners|unforcedErrors|netPointsWon|fastestServe|averageFirstServe|averageSecondServe)|display\.duration|payload\.statistics\.sets|delivery)$/;

function patch(root, path, value) {
  if (!PATCH_PATH.test(path)) throw new Error('statistics patch path invalid');
  const segments = path.split('.');
  const apply = (candidate, index) => {
    if (index === segments.length) return value;
    const key = segments[index];
    if (Array.isArray(candidate)) {
      const offset = Number(key);
      if (!Number.isInteger(offset) || offset < 0 || offset >= candidate.length) {
        throw new Error('statistics array patch invalid');
      }
      const next = candidate.slice();
      next[offset] = apply(candidate[offset], index + 1);
      return Object.freeze(next);
    }
    if (!candidate || typeof candidate !== 'object'
      || !Object.prototype.hasOwnProperty.call(candidate, key)) {
      throw new Error('statistics object patch invalid');
    }
    return Object.freeze({ ...candidate, [key]: apply(candidate[key], index + 1) });
  };
  return apply(root, 0);
}

class StatisticsStore {
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
    const next = contracts.statisticsProjection(value);
    if (next.payload.statistics.matchId !== this.matchId) {
      throw new Error('statistics match identity conflict');
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
    const frame = contracts.statisticsRealtimeFrame(value);
    if (frame.matchId !== this.matchId) {
      return Object.freeze({ action: 'resync_required', reason: 'identity_conflict' });
    }
    if (frame.kind === 'snapshot') return this.snapshot(frame.projection);
    if (frame.kind === 'unavailable') {
      return Object.freeze({ action: 'unavailable' });
    }
    if (frame.kind === 'up_to_date') return Object.freeze({ action: 'connection_confirmed' });
    if (frame.kind === 'deltas') {
      for (const item of frame.frames) {
        const result = this.applyDelta(item);
        if (result.action === 'resync_required') return result;
      }
      return Object.freeze({ action: 'delta_batch_applied', version: this.currentVersion() });
    }
    return this.applyDelta(frame);
  }

  applyDelta(frame) {
    if (this.projection === null) {
      return Object.freeze({ action: 'resync_required', reason: 'missing_snapshot' });
    }
    const current = this.currentVersion();
    const fingerprint = stable(frame);
    if (frame.version <= current) {
      const prior = this.fingerprints.get(frame.version);
      if (frame.version === current && prior !== undefined && prior !== fingerprint) {
        return Object.freeze({ action: 'resync_required', reason: 'version_conflict' });
      }
      return Object.freeze({ action: frame.version === current
        ? 'duplicate_ignored' : 'old_delta_ignored' });
    }
    if (frame.baseVersion !== current || frame.version !== current + 1) {
      return Object.freeze({ action: 'resync_required', reason: 'version_gap' });
    }
    let next = this.projection;
    for (const item of frame.patches) next = patch(next, item.path, item.value);
    next = Object.freeze({
      ...next,
      projectionVersion: frame.version,
      statisticsVersion: frame.statisticsVersion,
      dataAsOf: frame.dataAsOf
    });
    contracts.statisticsProjection(next);
    this.projection = next;
    this.fingerprints.set(frame.version, fingerprint);
    this.notify();
    return Object.freeze({ action: 'delta_applied', version: frame.version });
  }
}

module.exports = Object.freeze({ StatisticsStore, patch, PATCH_PATH });
