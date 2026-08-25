'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');
const { createSWRCache } = require('../../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../../core/projection-resource');

const PARTICIPATION_CACHE_SCHEMA = 'participation-projection-bff/1';
const PARTICIPATION_CACHE_KEY = 'participation_projection:latest';

const SUMMARY_DEFS = Object.freeze([
  Object.freeze({ id: 'added', label: '新增' }),
  Object.freeze({ id: 'withdrawal', label: '退赛' }),
  Object.freeze({ id: 'alternate', label: '替补' }),
  Object.freeze({ id: 'update', label: '名单更新' })
]);

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'object') return '';
  if (value.state === 'available' || value.state === 'known') {
    return text(value.displayText) || text(value.value);
  }
  return text(value.displayText)
    || text(value.label)
    || text(value.name)
    || text(value.title)
    || text(value.value);
}

function firstText(...values) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return '';
}

function compactDate(value) {
  const raw = text(value);
  if (!raw) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/.exec(raw);
  if (!match) return raw;
  const date = `${Number(match[2])}月${Number(match[3])}日`;
  return match[4] ? `${date} ${match[4]}:${match[5]}` : date;
}

function normalizeKind(value) {
  const raw = firstText(value).toLowerCase();
  if (/withdraw|retire|退赛|退签|退/.test(raw)) return 'withdrawal';
  if (/alternate|replacement|替补|补进|补位/.test(raw)) return 'alternate';
  if (/add|entry|enter|accepted|新增|入围|报名/.test(raw)) return 'added';
  if (/update|change|list|名单|变更|更新/.test(raw)) return 'update';
  return 'update';
}

function sourceEvents(projection) {
  const payload = projection?.payload || {};
  const presentation = projection?.presentation || {};
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.changes)) return payload.changes;
  if (Array.isArray(presentation.events)) return presentation.events;
  if (Array.isArray(presentation.items)) return presentation.items;
  if (Array.isArray(projection?.events)) return projection.events;
  if (Array.isArray(projection?.changes)) return projection.changes;
  return null;
}

function playerTitle(event) {
  return firstText(
    event.summaryZh,
    event.summary,
    event.titleZh,
    event.title,
    event.headline,
    event.playerDisplayName,
    event.playerName,
    event.player?.displayNameZh,
    event.player?.displayNameOriginal,
    event.player?.name,
    event.entry?.displayNameZh,
    event.entry?.name
  );
}

function eventTournament(event) {
  return firstText(
    event.tournament?.displayNameZh,
    event.tournament?.headline,
    event.tournament?.name,
    event.tournamentNameZh,
    event.tournamentName,
    event.eventName
  );
}

function eventStage(event) {
  return firstText(
    event.draw?.displayNameZh,
    event.draw?.name,
    event.drawNameZh,
    event.drawName,
    event.stageLabel,
    event.stage,
    event.roundLabel,
    event.round,
    event.disciplineLabel,
    event.discipline
  );
}

function participationEvent(event, index) {
  const kind = normalizeKind(firstText(
    event.kind,
    event.type,
    event.changeType,
    event.action,
    event.statusCode
  ));
  const definition = SUMMARY_DEFS.find(item => item.id === kind) || SUMMARY_DEFS[3];
  const tournament = eventTournament(event);
  const stage = eventStage(event);
  const tour = firstText(event.tourOrg, event.tour, event.authority);
  const subtitle = [tournament, stage, tour].filter(Boolean).join(' · ');
  return Object.freeze({
    id: firstText(event.id, event.changeId, event.eventId, event.sourceId) || `participation-${index}`,
    kind,
    kindLabel: definition.label,
    title: playerTitle(event) || definition.label,
    subtitle,
    tournament,
    dateLabel: compactDate(firstText(
      event.displayDate,
      event.dateLabel,
      event.occurredAt,
      event.effectiveAt,
      event.effectiveDate,
      event.updatedAt,
      event.localDate
    )),
    reason: firstText(event.reasonLabel, event.reason, event.note),
    status: firstText(event.statusLabel, event.status)
  });
}

function eventItems(projection) {
  const events = sourceEvents(projection);
  if (!Array.isArray(events)) return Object.freeze([]);
  return Object.freeze(events
    .filter(item => item && typeof item === 'object')
    .map(participationEvent));
}

function summaryItems(events) {
  const counts = new Map(SUMMARY_DEFS.map(item => [item.id, 0]));
  for (const item of events) counts.set(item.kind, (counts.get(item.kind) || 0) + 1);
  return Object.freeze(SUMMARY_DEFS.map(item => Object.freeze({
    id: item.id,
    label: item.label,
    count: String(counts.get(item.id) || 0)
  })));
}

function projectionDataAsOf(value) {
  return value?.delivery?.dataAsOf || value?.dataAsOf || value?.projectionGeneratedAt || '';
}

function deliveryState(value) {
  const state = String(value?.delivery?.state || '').toLowerCase();
  if (state === 'live' || state === 'current') return 'live';
  if (state === 'stale') return 'stale';
  if (state === 'unavailable') return 'unavailable';
  return 'delayed';
}

function validateProjection(value) {
  if (value?.bffContractVersion !== PARTICIPATION_CACHE_SCHEMA) {
    throw new Error('participation_projection_contract_mismatch');
  }
  if (!Array.isArray(sourceEvents(value))) {
    throw new Error('participation_projection_events_missing');
  }
  return value;
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    loading: true,
    failed: false,
    eventItems: [],
    summaryItems: summaryItems([]),
    hasEvents: false,
    deliveryState: '',
    deliveryMessage: '',
    dataAsOf: ''
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.http = getApp().services.http;
    this.cache = createSWRCache(wx);
    this.setData({ topInset: info.statusBarHeight || 44 });
    void this.load();
  },

  onShow() { syncPageTheme(this); },

  onPullDownRefresh() {
    void this.load({ force: true }).finally(() => wx.stopPullDownRefresh());
  },

  async load(options = {}) {
    const cached = options.force
      ? null
      : readTrustedProjection(this.cache, PARTICIPATION_CACHE_KEY, PARTICIPATION_CACHE_SCHEMA);
    if (cached?.payload) this.applyProjection(cached.payload, { fromCache: true });
    else this.setData({ loading: true, failed: false });
    try {
      const result = await loadProjectionResource({
        http: this.http,
        cache: this.cache,
        resourceKey: PARTICIPATION_CACHE_KEY,
        schemaVersion: PARTICIPATION_CACHE_SCHEMA,
        path: '/api/v1/bff/participation?limit=30',
        force: options.force === true,
        requestOptions: {
          authMode: 'none',
          noCache: options.force === true,
          header: { 'x-luwang-client-contract-version': PARTICIPATION_CACHE_SCHEMA }
        },
        metadata: { dataAsOf: projectionDataAsOf },
        validate: validateProjection
      });
      this.applyProjection(result.value, { fromCache: result.source !== 'network' });
    } catch (_error) {
      if (cached?.payload) {
        this.setData({
          loading: false,
          failed: false,
          deliveryState: 'stale',
          deliveryMessage: '已显示上次参赛动态',
          dataAsOf: cached.dataAsOf || projectionDataAsOf(cached.payload)
        });
        return;
      }
      this.setData({
        loading: false,
        failed: true,
        deliveryState: 'unavailable',
        deliveryMessage: '参赛动态暂不可用'
      });
    }
  },

  applyProjection(projection, options = {}) {
    const items = eventItems(projection);
    const state = options.fromCache ? 'stale' : deliveryState(projection);
    const empty = items.length === 0;
    const message = options.fromCache
      ? '已显示上次参赛动态'
      : empty ? '当前暂无参赛动态'
        : firstText(projection?.delivery?.message, '参赛动态已更新');
    this.setData({
      loading: false,
      failed: false,
      eventItems: items,
      summaryItems: summaryItems(items),
      hasEvents: items.length > 0,
      deliveryState: state,
      deliveryMessage: message,
      dataAsOf: projectionDataAsOf(projection)
    });
  },

  openScores() { wx.redirectTo({ url: '/pages/scores/index' }); },
  openDraws() { wx.redirectTo({ url: '/pages/draws/index' }); },
  openCalendar() { wx.redirectTo({ url: '/pages/calendar/index' }); }
});
