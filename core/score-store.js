'use strict';

const contracts = require('./contracts');

const COMPACT_DELTA_GAP_TOLERANCE_MS = 60 * 1000;

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function available(field) {
  return field !== null && typeof field === 'object'
    && field.state === 'available';
}

function keepAvailable(incoming, previous) {
  return available(incoming) || !available(previous) ? incoming : previous;
}

function mergeMember(incoming, previous) {
  if (previous === undefined) return incoming;
  return Object.freeze({
    ...incoming,
    displayNameZh: keepAvailable(incoming.displayNameZh, previous.displayNameZh),
    countryCode: keepAvailable(incoming.countryCode, previous.countryCode),
    ranking: keepAvailable(incoming.ranking, previous.ranking),
    rankingDiscipline: keepAvailable(
      incoming.rankingDiscipline,
      previous.rankingDiscipline
    ),
    rankingAsOf: keepAvailable(incoming.rankingAsOf, previous.rankingAsOf),
    portraitAvailability: keepAvailable(
      incoming.portraitAvailability,
      previous.portraitAvailability
    )
  });
}

function mergeSide(incoming, previous) {
  if (previous === undefined || incoming.sideId !== previous.sideId) return incoming;
  const previousMembers = new Map(previous.members.map(member => [
    available(member.playerId) ? member.playerId.value : null,
    member
  ]));
  return Object.freeze({
    ...incoming,
    seed: keepAvailable(incoming.seed, previous.seed),
    members: Object.freeze(incoming.members.map(member => mergeMember(
      member,
      previousMembers.get(available(member.playerId) ? member.playerId.value : null)
    )))
  });
}

function mergeStableEnrichment(incoming, previous) {
  void previous;
  return incoming;
}

function sameDisplayedScore(first, second) {
  return first !== undefined && second !== undefined
    && stable(first.score) === stable(second.score);
}

const TERMINAL_STATUS_CODES = Object.freeze(new Set([
  'finished', 'retired', 'walkover', 'defaulted', 'disqualified',
  'no_show', 'cancelled', 'abandoned'
]));

function instantMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(startIso, endIso) {
  const start = instantMs(startIso);
  const end = instantMs(endIso);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? end - start
    : null;
}

function compactDeltaRenderMetric(frame, clientReceivedAt, clientRenderedAt) {
  const sourceReceivedAt = frame.timings?.sourceReceivedAt ?? null;
  const sseBroadcastAt = frame.sseBroadcastAt ?? null;
  return Object.freeze({
    contractVersion: 'score-realtime-client-render/1',
    kind: frame.kind,
    version: frame.version,
    baseVersion: frame.baseVersion,
    matchIds: Object.freeze(frame.changes.map(change => change.matchId)),
    sourceReceivedAt,
    sgAcceptedAt: frame.timings?.sgAcceptedAt ?? null,
    sgSentAt: frame.timings?.sgSentAt ?? null,
    shReceivedAt: frame.timings?.shReceivedAt ?? null,
    sseBroadcastAt,
    clientReceivedAt,
    clientRenderedAt,
    sourceToClientReceivedMs: elapsedMs(sourceReceivedAt, clientReceivedAt),
    sourceToClientRenderedMs: elapsedMs(sourceReceivedAt, clientRenderedAt),
    sseBroadcastToClientReceivedMs: elapsedMs(sseBroadcastAt, clientReceivedAt),
    sseBroadcastToClientRenderedMs: elapsedMs(sseBroadcastAt, clientRenderedAt)
  });
}

function statusPriority(match) {
  const code = match?.status?.code;
  const group = match?.status?.group?.code;
  if (TERMINAL_STATUS_CODES.has(code) || group === 'ended') return 4;
  if (['live', 'interrupted', 'suspended'].includes(code) || group === 'in_progress') return 3;
  if (['delayed', 'postponed'].includes(code)) return 2;
  if (group === 'upcoming' || code === 'scheduled') return 1;
  return 0;
}

function shouldKeepPreviousMatch(incoming, previous) {
  if (previous === undefined || incoming?.matchId !== previous.matchId) return false;
  const incomingAt = instantMs(incoming.delivery?.dataAsOf ?? incoming.score?.observedAt);
  const previousAt = instantMs(previous.delivery?.dataAsOf ?? previous.score?.observedAt);
  return Number.isFinite(incomingAt)
    && Number.isFinite(previousAt)
    && incomingAt < previousAt
    && statusPriority(incoming) <= statusPriority(previous);
}

function mergeRealtimeOnlyState(incoming, previous) {
  if (previous === undefined || incoming.matchId !== previous.matchId) return incoming;
  if (shouldKeepPreviousMatch(incoming, previous)) return previous;
  const canKeepLastPoint = incoming.lastPoint.availability !== 'available'
    && previous.lastPoint.availability === 'available'
    && sameDisplayedScore(incoming, previous);
  const merged = canKeepLastPoint
    ? { ...incoming, lastPoint: previous.lastPoint }
    : incoming;
  return incoming.viewerFollowState === undefined && previous.viewerFollowState !== undefined
    ? Object.freeze({ ...merged, viewerFollowState: previous.viewerFollowState })
    : merged;
}

function mergeSnapshotRealtimeState(incoming, previousProjection) {
  if (previousProjection === null) return incoming;
  const previousById = new Map(previousProjection.payload.matches.map(match => [
    match.matchId,
    match
  ]));
  return Object.freeze({
    ...incoming,
    payload: Object.freeze({
      ...incoming.payload,
      matches: Object.freeze(incoming.payload.matches.map(match =>
        mergeRealtimeOnlyState(match, previousById.get(match.matchId))))
    })
  });
}

class ScoreStore {
  constructor() {
    this.projection = null;
    this.listeners = new Set();
    this.frameFingerprints = new Map();
    this.matchVersions = new Map();
    this.lastRealtimeMetric = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    if (this.projection !== null) listener(this.projection);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of [...this.listeners]) listener(this.projection);
  }

  currentVersion() {
    return this.projection?.projectionVersion || 0;
  }

  latestRealtimeMetric() {
    return this.lastRealtimeMetric;
  }

  reset() {
    this.projection = null;
    this.frameFingerprints.clear();
    this.matchVersions.clear();
    this.lastRealtimeMetric = null;
    this.notify();
  }

  snapshot(value) {
    const validated = contracts.todayProjection(value);
    let next = mergeSnapshotRealtimeState(validated, this.projection);
    const sameScheduleDate = this.projection?.payload?.scheduleGroupDate
      === next.payload.scheduleGroupDate;
    if (this.projection !== null
      && sameScheduleDate
      && next.projectionVersion < this.projection.projectionVersion) {
      return Object.freeze({ action: 'old_snapshot_ignored' });
    }
    if (sameScheduleDate && this.projection !== null) {
      const previousById = new Map(this.projection.payload.matches.map(match => [
        match.matchId, match
      ]));
      for (const match of next.payload.matches) {
        const acceptedVersion = this.matchVersions.get(match.matchId) || 0;
        const incomingVersion = Number(match.matchVersion || 0);
        if (previousById.has(match.matchId) && acceptedVersion > 0 && incomingVersion <= 0) {
          return Object.freeze({
            action: 'resync_required',
            reason: 'snapshot_match_version_missing',
            targetVersion: next.projectionVersion
          });
        }
      }
      next = Object.freeze({
        ...next,
        payload: Object.freeze({
          ...next.payload,
          matches: Object.freeze(next.payload.matches.map(match => {
            const incomingVersion = Number(match.matchVersion || 0);
            const acceptedVersion = this.matchVersions.get(match.matchId) || 0;
            return incomingVersion > 0 && incomingVersion < acceptedVersion
              ? previousById.get(match.matchId) || match
              : match;
          }))
        })
      });
    }
    // A realtime delta is a deliberately compact frame and does not carry the
    // HTTP projection hash or its transient last-point highlight. Therefore a
    // same-version calibration snapshot is authoritative confirmation, not a
    // conflicting second document. Keep a proven highlight only while the
    // displayed score is identical; a changed score must never inherit it.
    this.projection = next;
    for (const match of next.payload.matches) {
      const incomingVersion = Number(match.matchVersion || 0);
      if (incomingVersion > 0) {
        this.matchVersions.set(match.matchId, Math.max(
          incomingVersion,
          this.matchVersions.get(match.matchId) || 0
        ));
      }
    }
    this.notify();
    return Object.freeze({ action: 'snapshot_applied', version: next.projectionVersion });
  }

  frame(value) {
    const frame = contracts.realtimeFrame(value);
    if (frame.kind === 'heartbeat' || frame.kind === 'up_to_date') {
      return Object.freeze({ action: 'connection_confirmed' });
    }
    if (frame.kind === 'unavailable' || frame.kind === 'resync_required') {
      return Object.freeze({
        action: 'resync_required',
        reason: frame.reason || frame.kind,
        targetVersion: Number(frame.snapshotVersion || frame.version || 0) || undefined
      });
    }
    if (frame.kind === 'deltas') {
      for (const item of frame.frames) {
        const result = this.applyDelta(item);
        if (result.action === 'resync_required') return result;
      }
      return Object.freeze({ action: 'delta_batch_applied', version: this.currentVersion() });
    }
    if (frame.kind === 'score_deltas') {
      for (const item of frame.frames) {
        const result = this.applyCompactDelta(item);
        if (result.action === 'resync_required') return result;
      }
      return Object.freeze({
        action: 'compact_delta_batch_applied',
        version: this.currentVersion()
      });
    }
    if (frame.kind === 'score_delta') return this.applyCompactDelta(frame);
    return this.applyDelta(frame);
  }

  applyCompactDelta(frame) {
    const clientReceivedAt = nowIso();
    if (this.projection === null) {
      return Object.freeze({
        action: 'resync_required',
        reason: 'missing_snapshot',
        targetVersion: Number(frame.version || 0) || undefined
      });
    }
    const current = this.projection.projectionVersion;
    const fingerprint = stable(frame);
    if (frame.version <= current) {
      const prior = this.frameFingerprints.get(frame.version);
      if (frame.version === current && prior !== undefined && prior !== fingerprint) {
        return Object.freeze({
          action: 'resync_required',
          reason: 'version_conflict',
          targetVersion: frame.version
        });
      }
      return Object.freeze({
        action: frame.version === current ? 'duplicate_ignored' : 'old_delta_ignored'
      });
    }
    // Compact score deltas carry final field values for the changed match. A
    // replay frame can safely bridge a small projection/SSE skew, but a large
    // missing window still requires a full trusted snapshot.
    if (frame.baseVersion > current + COMPACT_DELTA_GAP_TOLERANCE_MS
      || frame.version <= current) {
      return Object.freeze({
        action: 'resync_required',
        reason: 'version_gap',
        targetVersion: frame.version
      });
    }
    const existing = this.projection.payload.matches;
    const byId = new Map(existing.map(match => [match.matchId, match]));
    const nextMatchVersions = new Map(this.matchVersions);
    for (const item of frame.changes) {
      const previous = byId.get(item.matchId);
      if (previous === undefined) {
        return Object.freeze({
          action: 'resync_required',
          reason: 'match_missing',
          targetVersion: frame.version
        });
      }
      const acceptedMatchVersion = nextMatchVersions.get(item.matchId) || 0;
      if (item.matchVersion <= acceptedMatchVersion) continue;
      if (acceptedMatchVersion > 0 && item.matchVersion > acceptedMatchVersion + 1) {
        return Object.freeze({
          action: 'resync_required',
          reason: 'match_version_gap',
          targetVersion: frame.version
        });
      }
      byId.set(item.matchId, Object.freeze({
        ...previous,
        ...item.changes,
        matchVersion: item.matchVersion
      }));
      nextMatchVersions.set(item.matchId, item.matchVersion);
    }
    const matches = existing.map(match => byId.get(match.matchId));
    this.projection = Object.freeze({
      ...this.projection,
      projectionVersion: frame.version,
      projectionGeneratedAt: frame.projectionGeneratedAt,
      dataAsOf: frame.dataAsOf,
      delivery: frame.delivery ?? this.projection.delivery,
      payload: Object.freeze({ ...this.projection.payload, matches: Object.freeze(matches) })
    });
    this.matchVersions = nextMatchVersions;
    this.frameFingerprints.set(frame.version, fingerprint);
    for (const version of [...this.frameFingerprints.keys()]) {
      if (version < frame.version - 64) this.frameFingerprints.delete(version);
    }
    this.notify();
    const clientRenderedAt = nowIso();
    this.lastRealtimeMetric = compactDeltaRenderMetric(frame, clientReceivedAt, clientRenderedAt);
    return Object.freeze({ action: 'compact_delta_applied', version: frame.version });
  }

  applyDelta(frame) {
    if (this.projection === null) {
      return Object.freeze({
        action: 'resync_required',
        reason: 'missing_snapshot',
        targetVersion: Number(frame.version || 0) || undefined
      });
    }
    const current = this.projection.projectionVersion;
    const fingerprint = stable(frame);
    if (frame.version <= current) {
      const prior = this.frameFingerprints.get(frame.version);
      if (frame.version === current && prior !== undefined && prior !== fingerprint) {
        return Object.freeze({
          action: 'resync_required',
          reason: 'version_conflict',
          targetVersion: frame.version
        });
      }
      return Object.freeze({ action: frame.version === current
        ? 'duplicate_ignored' : 'old_delta_ignored' });
    }
    // Score versions are replica-wide cursors. A server delta may legally jump
    // over revisions that did not change this date, but it must still name the
    // exact client version it was derived from.
    if (frame.baseVersion !== current || frame.version <= current) {
      return Object.freeze({
        action: 'resync_required',
        reason: 'version_gap',
        targetVersion: frame.version
      });
    }
    const existing = this.projection.payload.matches;
    const byId = new Map(existing.map(match => [match.matchId, match]));
    const nextMatchVersions = new Map(this.matchVersions);
    for (const matchId of frame.removedMatchIds) byId.delete(matchId);
    for (const match of frame.upserts) {
      const acceptedMatchVersion = nextMatchVersions.get(match.matchId) || 0;
      const incomingMatchVersion = Number(match.matchVersion || 0);
      if (incomingMatchVersion > 0 && incomingMatchVersion <= acceptedMatchVersion) continue;
      if (acceptedMatchVersion > 0 && incomingMatchVersion > acceptedMatchVersion + 1) {
        return Object.freeze({
          action: 'resync_required',
          reason: 'match_version_gap',
          targetVersion: frame.version
        });
      }
      byId.set(match.matchId, match);
      if (incomingMatchVersion > 0) {
        nextMatchVersions.set(match.matchId, incomingMatchVersion);
      }
    }
    const order = existing.map(match => match.matchId);
    for (const match of frame.upserts) {
      if (!order.includes(match.matchId)) order.push(match.matchId);
    }
    const matches = order.filter(matchId => byId.has(matchId))
      .map(matchId => byId.get(matchId));
    this.projection = Object.freeze({
      ...this.projection,
      projectionVersion: frame.version,
      projectionGeneratedAt: frame.projectionGeneratedAt,
      dataAsOf: frame.dataAsOf,
      delivery: frame.delivery,
      payload: Object.freeze({ ...this.projection.payload, matches: Object.freeze(matches) })
    });
    this.matchVersions = nextMatchVersions;
    this.frameFingerprints.set(frame.version, fingerprint);
    for (const version of [...this.frameFingerprints.keys()]) {
      if (version < frame.version - 64) this.frameFingerprints.delete(version);
    }
    this.notify();
    return Object.freeze({ action: 'delta_applied', version: frame.version });
  }
}

module.exports = Object.freeze({
  ScoreStore,
  stable,
  mergeStableEnrichment,
  mergeRealtimeOnlyState,
  shouldKeepPreviousMatch
});
