'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');
const { createSWRCache } = require('../../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../../core/projection-resource');

const SOURCE_BUCKETS = Object.freeze([
  'atp', 'wta', 'atp_challenger', 'wta_125', 'itf'
]);
const CALENDAR_CACHE_SCHEMA = 'calendar-projection-bff/1';

function calendarCacheKey(year) { return 'calendar_projection:' + year; }

const FILTERS = Object.freeze([
  { id: 'all', label: '全部' },
  { id: 'atp', label: 'ATP' },
  { id: 'wta', label: 'WTA' },
  { id: 'challenger', label: '挑战赛' },
  { id: 'itf', label: 'ITF' }
]);
const MONTHS = Object.freeze(Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  label: `${index + 1}月`
})));

function field(candidate, fallback = '') {
  return candidate && candidate.state === 'available' && candidate.value !== null
    ? String(candidate.value) : fallback;
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    + `-${String(now.getDate()).padStart(2, '0')}`;
}

function utcDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

function isoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    + `-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDays(value, amount) {
  const date = utcDate(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDate(date);
}

function weekStart(value) {
  const date = utcDate(value);
  if (!date) return '';
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return isoDate(date);
}

function isoWeekNumber(value) {
  const date = utcDate(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function monthOf(value) {
  const date = utcDate(value);
  return date ? date.getUTCMonth() + 1 : 0;
}

function weekRangeLabel(start) {
  const first = utcDate(start);
  const last = utcDate(addDays(start, 6));
  if (!first || !last) return '';
  const firstLabel = `${first.getUTCMonth() + 1}月${first.getUTCDate()}日`;
  const lastLabel = first.getUTCMonth() === last.getUTCMonth()
    ? `${last.getUTCDate()}日`
    : `${last.getUTCMonth() + 1}月${last.getUTCDate()}日`;
  return `${firstLabel}—${lastLabel}`;
}

function compactDateRange(start, end) {
  const first = utcDate(start);
  const last = utcDate(end || start);
  if (!first) return Object.freeze({ days: '待定', month: '' });
  const firstDay = String(first.getUTCDate()).padStart(2, '0');
  const lastDay = last ? String(last.getUTCDate()).padStart(2, '0') : firstDay;
  return Object.freeze({
    days: last && isoDate(last) !== isoDate(first) ? `${firstDay}—${lastDay}` : firstDay,
    month: `${first.getUTCMonth() + 1}月`
  });
}

function calendarItem(item) {
  const startDate = field(item.dates.currentDateRange?.start)
    || field(item.dates.officialStartLocalDate);
  const endDate = field(item.dates.currentDateRange?.end)
    || field(item.dates.officialEndLocalDate)
    || startDate;
  const compact = compactDateRange(startDate, endDate);
  return Object.freeze({
    id: item.identity.tournamentEditionId,
    title: field(item.summary.headline, '赛事名称待公布'),
    location: field(item.summary.locationSubtitle),
    authority: field(item.summary.authority),
    bucket: String(item.identity.tourBucket || ''),
    requestTour: calendarDrawTour(item),
    level: field(item.summary.tierDisplayName) || field(item.summary.levelCode),
    surface: field(item.summary.surface),
    followTargetId: item.identity.tournamentFollowKey || item.identity.tournamentEditionId,
    followed: item.viewerFollowState?.tournament?.followed === true,
    startDate,
    endDate,
    dateDays: compact.days,
    dateMonth: compact.month,
    lifecycle: item.displayLifecycle.label,
    lifecycleCode: item.displayLifecycle.code,
    drawAvailable: item.capabilities.draws.status === 'available'
      || item.capabilities.draws.status === 'partial'
  });
}

function calendarDrawTour(item) {
  const bucket = String(item?.identity?.tourBucket || '').toLowerCase();
  if (bucket === 'wta' || bucket === 'wta_125') return 'wta';
  if (bucket === 'atp' || bucket === 'atp_challenger') return 'atp';
  const authority = field(item?.summary?.authority).toLowerCase();
  if (authority === 'wta' || authority === 'atp') return authority;
  return '';
}

function tournamentFollowSnapshot(item) {
  if (!item) return null;
  return {
    title: item.title || '',
    location: item.location || '',
    level: item.level || '',
    surface: item.surface || '',
    startsOn: item.startDate || '',
    endsOn: item.endDate || '',
    tourOrgs: item.authority ? String(item.authority).split('/').filter(Boolean) : [],
    calendarEventIds: [item.id].filter(Boolean),
    lifecycle: item.lifecycle || ''
  };
}

function calendarMergeKey(item) {
  return `${item.bucket}:${item.id}`;
}

function inFilter(item, filter) {
  if (filter === 'all') return true;
  if (filter === 'wta') return item.bucket === 'wta' || item.bucket === 'wta_125';
  if (filter === 'challenger') return item.bucket === 'atp_challenger';
  return item.bucket === filter;
}

function calendarProjectionItems(value) {
  if (value?.bffContractVersion === 'calendar-projection-bff/1') {
    return Array.isArray(value.presentation?.items) ? value.presentation.items : [];
  }
  if (value?.bffContractVersion === 'tour-calendar-bff/1') {
    return Array.isArray(value.presentation?.items) ? value.presentation.items : [];
  }
  return [];
}

function projectionDataAsOf(value) {
  return value?.delivery?.dataAsOf || value?.dataAsOf || '';
}

function projectionCurrent(value) {
  return value?.delivery?.state === 'current' || value?.delivery?.state === 'live';
}

function weeksFor(items, filter, month) {
  const byWeek = new Map();
  items.filter(item => inFilter(item, filter)).forEach(item => {
    let key = weekStart(item.startDate);
    const lastKey = weekStart(item.endDate || item.startDate);
    while (key && key <= lastKey) {
      const weekEnd = addDays(key, 6);
      if (monthOf(key) === month || monthOf(weekEnd) === month) {
        if (!byWeek.has(key)) byWeek.set(key, []);
        byWeek.get(key).push(item);
      }
      key = addDays(key, 7);
    }
  });
  return [...byWeek.entries()].sort(([first], [second]) => first.localeCompare(second))
    .map(([key, entries]) => Object.freeze({
      key,
      number: isoWeekNumber(key),
      range: weekRangeLabel(key),
      items: Object.freeze(entries.sort((first, second) =>
        first.startDate.localeCompare(second.startDate)
          || first.title.localeCompare(second.title)))
    }));
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    year: new Date().getFullYear(),
    months: MONTHS,
    activeMonth: new Date().getMonth() + 1,
    loading: true,
    failed: false,
    buckets: FILTERS,
    activeBucket: 'all',
    allItems: [],
    weeks: [],
    activeWeekIndex: 0,
    activeWeek: null,
    items: [],
    drawSelectionMode: false,
    deliveryState: '',
    deliveryMessage: '',
    dataAsOf: ''
  },

  onLoad(options = {}) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.http = getApp().services.http;
    this.cache = createSWRCache(wx);
    this.setData({
      topInset: info.statusBarHeight || 44,
      drawSelectionMode: options.mode === 'draws'
    });
    void this.load();
  },
  onShow() { syncPageTheme(this); },

  onPullDownRefresh() {
    void this.load({ force: true }).finally(() => wx.stopPullDownRefresh());
  },

  async load(options = {}) {
    const cacheKey = calendarCacheKey(this.data.year);
    const cached = options.force
      ? null : readTrustedProjection(this.cache, cacheKey, CALENDAR_CACHE_SCHEMA);
    if (cached?.payload) this.applyCalendarProjection(cached.payload, { fromCache: true });
    else this.setData({ loading: true, failed: false });
    try {
      const projection = await this.fetchAggregateCalendar(options);
      this.applyCalendarProjection(projection, { fromCache: false });
    } catch {
      if (cached?.payload) {
        this.setData({
          loading: false,
          failed: false,
          deliveryState: 'stale',
          deliveryMessage: '赛历更新失败，已显示上次内容'
        });
        return;
      }
      try {
        const projection = await this.fetchBucketCalendarFallback(options);
        this.applyCalendarProjection(projection, { fromCache: false });
      } catch {
        this.setData({ loading: false, failed: true });
      }
    }
  },

  async fetchAggregateCalendar(options = {}) {
    const cacheKey = calendarCacheKey(this.data.year);
    const refreshQuery = options.force ? '?_refresh=' + Date.now() : '';
    const result = await loadProjectionResource({
      http: this.http,
      cache: this.cache,
      resourceKey: cacheKey,
      schemaVersion: CALENDAR_CACHE_SCHEMA,
      path: '/api/v1/bff/calendar/' + this.data.year + refreshQuery,
      force: options.force === true,
      requestOptions: {
        authMode: 'none',
        noCache: options.force === true,
        header: { 'x-luwang-client-contract-version': 'calendar-projection-bff/1' }
      },
      metadata: { dataAsOf: projectionDataAsOf },
      validate(value) {
        if (value?.bffContractVersion !== 'calendar-projection-bff/1'
          || !Array.isArray(value.presentation?.items)) {
          throw new Error('calendar_projection_invalid');
        }
        return value;
      }
    });
    return result.value;
  },

  async fetchBucketCalendarFallback(options = {}) {
    const refreshQuery = options.force ? '?_refresh=' + Date.now() : '';
    const contract = {
      authMode: 'none',
      header: { 'x-luwang-client-contract-version': 'tour-calendar-bff/1' },
      noCache: options.force === true
    };
    const results = await Promise.allSettled(SOURCE_BUCKETS.map(bucket =>
      this.http.request('/api/v1/bff/tour-calendar/' + bucket + '/' + this.data.year + refreshQuery, contract)));
    const projections = results
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value)
      .filter(value => value?.bffContractVersion === 'tour-calendar-bff/1'
        && Array.isArray(value.presentation?.items));
    if (projections.length === 0) throw new Error('calendar_fallback_empty');
    return {
      bffContractVersion: 'calendar-projection-bff/1',
      projectionVersion: Math.max(...projections.map(value => Number(value.projectionVersion) || 0), 0),
      dataAsOf: projections.map(value => projectionDataAsOf(value)).filter(Boolean).sort().slice(-1)[0] || '',
      delivery: { state: projections.some(value => !projectionCurrent(value)) ? 'stale' : 'current' },
      presentation: { items: projections.flatMap(value => value.presentation.items) }
    };
  },

  applyCalendarProjection(projection, options = {}) {
    const items = calendarProjectionItems(projection);
    if (items.length === 0) throw new Error('calendar_projection_empty');
    const byId = new Map();
    items.map(calendarItem).forEach(item => byId.set(calendarMergeKey(item), item));
    const allItems = [...byId.values()].sort((first, second) =>
      first.startDate.localeCompare(second.startDate) || first.title.localeCompare(second.title));
    const delayed = !projectionCurrent(projection);
    this.setData({
      loading: false,
      failed: false,
      allItems,
      deliveryState: delayed ? 'delayed' : 'live',
      deliveryMessage: options.fromCache
        ? '已显示上次赛历，正在更新'
        : delayed ? '部分赛历仍在更新' : '巡回赛历已更新',
      dataAsOf: projectionDataAsOf(projection)
    }, () => this.rebuildTimeline(weekStart(todayIso())));
  },

  rebuildTimeline(preferredWeek = '') {
    const weeks = weeksFor(this.data.allItems, this.data.activeBucket, this.data.activeMonth);
    let activeWeekIndex = weeks.findIndex(week => week.key === preferredWeek);
    if (activeWeekIndex < 0) activeWeekIndex = 0;
    const activeWeek = weeks[activeWeekIndex] || null;
    this.setData({
      weeks,
      activeWeekIndex,
      activeWeek,
      items: activeWeek?.items || []
    });
  },

  selectBucket(event) {
    const activeBucket = String(event.currentTarget.dataset.id || 'all');
    if (!FILTERS.some(item => item.id === activeBucket)) return;
    this.setData({ activeBucket }, () => this.rebuildTimeline(this.data.activeWeek?.key));
  },

  selectMonth(event) {
    const activeMonth = Number(event.currentTarget.dataset.month);
    if (!Number.isInteger(activeMonth) || activeMonth < 1 || activeMonth > 12) return;
    const current = utcDate(todayIso());
    const preferred = this.data.year === current.getUTCFullYear()
      && activeMonth === current.getUTCMonth() + 1 ? weekStart(todayIso()) : '';
    this.setData({ activeMonth }, () => this.rebuildTimeline(preferred));
  },

  previousWeek() {
    if (this.data.activeWeekIndex <= 0) return;
    const activeWeekIndex = this.data.activeWeekIndex - 1;
    const activeWeek = this.data.weeks[activeWeekIndex];
    this.setData({ activeWeekIndex, activeWeek, items: activeWeek.items });
  },

  nextWeek() {
    if (this.data.activeWeekIndex >= this.data.weeks.length - 1) return;
    const activeWeekIndex = this.data.activeWeekIndex + 1;
    const activeWeek = this.data.weeks[activeWeekIndex];
    this.setData({ activeWeekIndex, activeWeek, items: activeWeek.items });
  },

  previousYear() {
    this.setData({ year: this.data.year - 1, activeMonth: 1 }, () => void this.load());
  },
  nextYear() {
    this.setData({ year: this.data.year + 1, activeMonth: 1 }, () => void this.load());
  },
  openScores() { wx.redirectTo({ url: '/pages/scores/index' }); },
  openDraws() { wx.redirectTo({ url: '/pages/draws/index' }); },
  openParticipation() { wx.redirectTo({ url: '/pages/participation/index' }); },
  openTournament(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const requestTour = String(event.currentTarget.dataset.tour || '');
    const item = this.data.allItems.find(candidate =>
      candidate.id === id && (!requestTour || candidate.requestTour === requestTour))
      || this.data.allItems.find(candidate => candidate.id === id);
    if (this.data.drawSelectionMode) {
      if (!item?.drawAvailable) {
        wx.showToast({ title: '该赛事暂无可用签表', icon: 'none' });
        return;
      }
      wx.redirectTo({
        url: `/pages/draws/index?tournamentEditionId=${encodeURIComponent(id)}`
          + `&title=${encodeURIComponent(item.title)}`
          + (item.requestTour ? `&tour=${encodeURIComponent(item.requestTour)}` : '')
      });
      return;
    }
    const title = event.currentTarget.dataset.title || '';
    wx.navigateTo({
      url: `/pages/tournament-detail/index?tournamentEditionId=${encodeURIComponent(id)}`
      + `&title=${encodeURIComponent(title)}`
      + (item?.requestTour ? `&tour=${encodeURIComponent(item.requestTour)}` : '')
    });
  },
  async toggleTournamentFollow(event) {
    const id = String(event.currentTarget.dataset.id || '').trim();
    const next = event.currentTarget.dataset.followed === true
      || event.currentTarget.dataset.followed === 'true';
    if (!id) return;
    const item = this.data.allItems.find(candidate => candidate.followTargetId === id);
    const updateItems = items => items.map(item =>
      item.followTargetId === id ? Object.freeze({ ...item, followed: next }) : item);
    const previous = this.data.allItems;
    const previousItems = this.data.items;
    this.setData({
      allItems: updateItems(this.data.allItems),
      items: updateItems(this.data.items)
    });
    try {
      await getApp().services.follow.setFollow(
        'tournament',
        id,
        next,
        'calendar',
        tournamentFollowSnapshot(item)
      );
    } catch (err) {
      this.setData({ allItems: previous, items: previousItems });
      if (String(err?.message || '') !== 'follow_login_cancelled') {
        wx.showToast({ title: '关注状态暂未保存', icon: 'none' });
      }
    }
  }
});
