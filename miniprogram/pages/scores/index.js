'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');
const { createSWRCache } = require('../../core/swr-cache');
const { enablePageShare, pageShare } = require('../../core/share');

const { FILTERS, groupedMatches } = require('../../core/view-model');
const {
  beijingDate,
  moveDate,
  dateLabel
} = require('../../core/schedule-date');

const SCORE_CACHE_SCHEMA = 'scores-today-projection/1';
const DEFAULT_DATE_CACHE_SCHEMA = 'scores-default-date-selection/1';
const INITIAL_LOADING_GRACE_MS = 8_000;
const TOUR_FILTERS = Object.freeze([
  { id: 'all', label: '全部赛事' },
  { id: 'ATP', label: 'ATP' },
  { id: 'WTA', label: 'WTA' },
  { id: 'ITF', label: 'ITF' }
]);
const DISCIPLINE_FILTERS = Object.freeze([
  { id: 'all', label: '全部项目' },
  { id: 'singles', label: '单打' },
  { id: 'doubles', label: '双打' }
]);
const INITIAL_VISIBLE_MATCH_LIMIT = 48;
const VISIBLE_MATCH_INCREMENT = 48;

function countMatches(groups) {
  return groups.reduce((count, tournament) => count
    + tournament.courts.reduce((sum, court) => sum + court.matches.length, 0), 0);
}

function matchFollowCountInGroups(groups, matchId) {
  const id = String(matchId || '');
  for (const group of groups || []) {
    for (const court of group.courts || []) {
      const match = (court.matches || []).find(item => item.id === id || item.followTargetId === id);
      if (match) return Number(match.followCount || 0);
    }
  }
  return 0;
}

function tournamentPresentation(groups) {
  return Object.freeze(groups.map(group => {
    const levelsByTour = new Map();
    let country = '';
    let surface = '';
    for (const court of group.courts || []) {
      for (const match of court.matches || []) {
        const tourOrg = String(match.tournamentTourOrg || '').toUpperCase();
        const level = String(match.tournamentLevel || '').trim();
        if ((tourOrg === 'ATP' || tourOrg === 'WTA') && level) {
          levelsByTour.set(tourOrg, level);
        }
        if (!country) country = String(match.tournamentCountry || '').trim();
        if (!surface) surface = String(match.surface || '').trim();
      }
    }
    const levelLabels = ['ATP', 'WTA']
      .filter(tourOrg => levelsByTour.has(tourOrg))
      .map(tourOrg => {
        const level = levelsByTour.get(tourOrg);
        return level.toUpperCase().startsWith(tourOrg) ? level : `${tourOrg} ${level}`;
      });
    return Object.freeze({
      ...group,
      displayMeta: [levelLabels.join(' & ') || group.level, surface]
        .filter(Boolean).join(' · '),
      displayCountry: country
    });
  }));
}

function tournamentFollowSnapshot(group) {
  if (!group) return null;
  const firstMatch = (group.courts || [])
    .flatMap(court => court.matches || [])
    .find(match => match.scheduleGroupDate);
  return {
    title: group.title || '',
    location: group.displayCountry || '',
    level: group.displayMeta || group.level || '',
    surface: group.surface || '',
    startsOn: firstMatch?.scheduleGroupDate || '',
    endsOn: firstMatch?.scheduleGroupDate || '',
    tourOrgs: Array.isArray(group.tourOrgs)
      ? group.tourOrgs
      : String(group.tourOrg || '').split('/').filter(Boolean),
    calendarEventIds: []
  };
}

function sliceGroups(groups, limit) {
  let remaining = Math.max(0, Number(limit) || 0);
  const visible = [];
  for (const tournament of groups) {
    if (remaining <= 0) break;
    const courts = [];
    for (const court of tournament.courts) {
      if (remaining <= 0) break;
      const matches = court.matches.slice(0, remaining);
      if (matches.length === 0) continue;
      remaining -= matches.length;
      courts.push(Object.freeze({ ...court, matches: Object.freeze(matches) }));
    }
    if (courts.length > 0) {
      visible.push(Object.freeze({ ...tournament, courts: Object.freeze(courts) }));
    }
  }
  return Object.freeze(visible);
}

function groupStructure(groups) {
  return groups.map(group => [group.id, group.courts.map(court => [
    court.id, court.matches.map(match => match.id)
  ])]);
}

function stableJson(value) { return JSON.stringify(value); }

function scoreCacheKey(date) { return 'scores_today:' + date; }
function defaultDateCacheKey(preferredDate) { return 'scores_default_date:' + preferredDate; }

function scoreMatchTargets(projection) {
  const matches = Array.isArray(projection?.payload?.matches)
    ? projection.payload.matches : [];
  return matches.map(match => ({
    kind: 'match',
    targetId: String(match?.viewerFollowState?.match?.targetId || match?.matchId || '').trim()
  })).filter(target => target.targetId);
}

function cachedProjection(wxRuntime, date) {
  const entry = createSWRCache(wxRuntime).read(scoreCacheKey(date), SCORE_CACHE_SCHEMA);
  const projection = entry?.payload;
  return projection?.payload?.scheduleGroupDate === date ? projection : null;
}

function cachedDefaultSelection(wxRuntime, preferredDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate || '')) return null;
  const entry = createSWRCache(wxRuntime).read(
    defaultDateCacheKey(preferredDate),
    DEFAULT_DATE_CACHE_SCHEMA
  );
  const value = entry?.payload;
  const selectedDate = value?.selectedDate;
  const projection = value?.projection;
  if (value?.preferredDate !== preferredDate
    || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate || '')
    || projection?.payload?.scheduleGroupDate !== selectedDate) return null;
  return { selectedDate, projection };
}

function writeCachedProjection(wxRuntime, projection) {
  const date = projection?.payload?.scheduleGroupDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return;
  createSWRCache(wxRuntime).write(scoreCacheKey(date), {
    schemaVersion: SCORE_CACHE_SCHEMA,
    projectionVersion: projection.projectionVersion,
    dataAsOf: projection.projectionGeneratedAt || projection.dataAsOf || '',
    etag: projection.etag || '',
    payload: projection
  });
}

function writeCachedDefaultSelection(wxRuntime, preferredDate, projection) {
  const selectedDate = projection?.payload?.scheduleGroupDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate || '')) return;
  writeCachedProjection(wxRuntime, projection);
  createSWRCache(wxRuntime).write(defaultDateCacheKey(preferredDate), {
    schemaVersion: DEFAULT_DATE_CACHE_SCHEMA,
    projectionVersion: projection.projectionVersion,
    dataAsOf: projection.projectionGeneratedAt || projection.dataAsOf || '',
    etag: projection.etag || '',
    payload: { preferredDate, selectedDate, projection }
  });
}

function renderedCardValue(match) {
  const {
    dataAsOf: _dataAsOf,
    dataDeliveryState: _dataDeliveryState,
    modules: _modules,
    ...rendered
  } = match;
  return rendered;
}

function incrementalGroupPatch(previous, next) {
  if (stableJson(groupStructure(previous)) !== stableJson(groupStructure(next))) {
    return null;
  }
  const patch = {};
  next.forEach((group, groupIndex) => {
    const previousGroup = previous[groupIndex];
    if (stableJson({ ...previousGroup, courts: undefined })
      !== stableJson({ ...group, courts: undefined })) {
      patch[`groups[${groupIndex}]`] = group;
      return;
    }
    group.courts.forEach((court, courtIndex) => {
      const previousCourt = previousGroup.courts[courtIndex];
      if (stableJson({ ...previousCourt, matches: undefined })
        !== stableJson({ ...court, matches: undefined })) {
        patch[`groups[${groupIndex}].courts[${courtIndex}]`] = court;
        return;
      }
      court.matches.forEach((match, matchIndex) => {
        if (stableJson(renderedCardValue(previousCourt.matches[matchIndex]))
          !== stableJson(renderedCardValue(match))) {
          patch[`groups[${groupIndex}].courts[${courtIndex}].matches[${matchIndex}]`] = match;
        }
      });
    });
  });
  return patch;
}

function updateClock(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}`
    + `:${String(date.getMinutes()).padStart(2, '0')}`
    + `:${String(date.getSeconds()).padStart(2, '0')}`;
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    navigationBarHeight: 44,
    filters: FILTERS,
    tourFilters: TOUR_FILTERS,
    disciplineFilters: DISCIPLINE_FILTERS,
    selectedFilter: 'all',
    selectedTour: 'all',
    selectedDiscipline: 'all',
    activeFilterCount: 0,
    selectedDate: '',
    dateLabel: '',
    query: '',
    searchFocused: false,
    authState: 'authenticating',
    dataDeliveryState: '',
    dataDeliveryMessage: '',
    projectionLoadState: 'idle',
    projectionLoadMessage: '',
    clientTransportState: 'connecting',
    clientTransportMessage: '',
    showTransportNotice: false,
    showDataNotice: false,
    dataAsOf: '',
    dataUpdatedTime: '',
    groups: [],
    matchCount: 0,
    visibleMatchCount: 0,
    hasMoreMatches: false,
    hasProjection: false,
    collapsedTournaments: {},
    collapsedCourts: {},
    filterSheetOpen: false
  },

  onLoad(options) {
    syncPageTheme(this);
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect() : null;
    const statusBarHeight = info.statusBarHeight || 24;
    const navigationBarHeight = menu && menu.height > 0
      ? (menu.top - statusBarHeight) * 2 + menu.height
      : 44;
    const explicitDate = /^\d{4}-\d{2}-\d{2}$/.test(options.date || '');
    const preferredDate = explicitDate ? options.date : beijingDate();
    const defaultSelection = explicitDate ? null : cachedDefaultSelection(wx, preferredDate);
    const selectedDate = defaultSelection?.selectedDate || preferredDate;
    this.followedIds = new Set();
    this.followStateSignature = '';
    this.followStateRequestId = 0;
    this.followOverrides = new Map();
    this.followCountOverrides = new Map();
    this.tournamentFollowOverrides = new Map();
    this.allGroups = [];
    this.fullMatchCount = 0;
    this.visibleMatchLimit = INITIAL_VISIBLE_MATCH_LIMIT;
    this.defaultBeijingDate = preferredDate;
    this.setData({
      topInset: statusBarHeight,
      navigationBarHeight,
      selectedDate,
      dateLabel: dateLabel(selectedDate)
    });
    const services = getApp().services;
    if (!services?.auth || !services?.scoreClient || !services?.scoreStore) {
      this.setData({
        projectionLoadState: 'failed',
        projectionLoadMessage: '小程序初始化失败，请重新打开'
      });
      return;
    }
    this.services = services;
    const followSubscription = services.follow?.subscribe?.(change => {
        if (change?.key?.startsWith('match:')) this.rerender();
        if (change?.reset) {
          this.followedIds = new Set();
          this.rerender();
        }
      }) || (() => undefined);
    this.unsubscribers = [
      services.auth.subscribe(authState => this.setData({ authState })),
      followSubscription,
      services.scoreClient.subscribeTransport(clientTransportState => {
        const messages = {
          connecting: '',
          connected: '',
          reconnecting: '',
          offline: '网络暂时不可用，恢复后会自动更新比分'
        };
        this.setData({
          clientTransportState,
          clientTransportMessage: messages[clientTransportState],
          // Short request rotations are an implementation detail. Existing
          // trusted scores remain a logically continuous realtime session.
          showTransportNotice: clientTransportState === 'offline'
            && !this.data.hasProjection
        });
      }),
      services.scoreStore.subscribe(projection => this.applyProjection(projection))
    ];
    const cached = defaultSelection?.projection || cachedProjection(wx, selectedDate);
    if (cached) this.services.scoreStore.snapshot(cached);
    this.initialStartPromise = this.startInitialDate(preferredDate, {
      resolveCarryover: !explicitDate,
      selectedDate,
      initialProjection: defaultSelection?.projection || null
    }).finally(() => { this.initialStartPromise = null; });
  },

  async startInitialDate(preferredDate, options = {}) {
    let selectedDate = options.selectedDate || preferredDate;
    let initialProjection = options.initialProjection || null;
    if (options.resolveCarryover) {
      try {
        initialProjection = await this.services.scoreClient.fetchProjectionForDate(
          preferredDate,
          { resolveDefault: true }
        );
        const resolvedDate = initialProjection?.payload?.scheduleGroupDate;
        if (/^\d{4}-\d{2}-\d{2}$/.test(resolvedDate || '')) {
          selectedDate = resolvedDate;
          writeCachedDefaultSelection(wx, preferredDate, initialProjection);
        }
      } catch {
        initialProjection = options.initialProjection || null;
      }
    }
    this.defaultBeijingDate = preferredDate;
    if (selectedDate !== this.data.selectedDate) {
      this.setData({
        selectedDate,
        dateLabel: dateLabel(selectedDate)
      });
      const cached = cachedProjection(wx, selectedDate);
      if (cached) this.services.scoreStore.snapshot(cached);
    }
    this.beginInitialLoadingGuard(selectedDate);
    try {
      await this.services.scoreClient.start(selectedDate, {
        preserveSnapshot: this.data.hasProjection,
        initialProjection
      });
    } catch {
      // Keep the requested current date. A missing projection is not
      // permission to silently replace today's schedule with yesterday's.
      const current = this.services.scoreStore.projection;
      if (current?.payload?.scheduleGroupDate === selectedDate) return;
      this.setData({
        hasProjection: false,
        projectionLoadState: 'failed',
        projectionLoadMessage: '今日赛程暂时加载失败，请重试或稍后刷新'
      });
    } finally {
      this.clearInitialLoadingGuard();
    }
  },

  beginInitialLoadingGuard(selectedDate) {
    this.clearInitialLoadingGuard();
    this.initialLoadingTimer = setTimeout(() => {
      if (this.data.hasProjection || this.data.selectedDate !== selectedDate) return;
      this.setData({
        hasProjection: false,
        projectionLoadState: 'failed',
        projectionLoadMessage: '今日赛程加载超时，请重试或稍后刷新'
      });
      this.services?.scoreClient?.markTransportFailure?.();
    }, INITIAL_LOADING_GRACE_MS);
  },

  clearInitialLoadingGuard() {
    clearTimeout(this.initialLoadingTimer);
    this.initialLoadingTimer = null;
  },

  onUnload() {
    clearTimeout(this.searchTimer);
    this.clearInitialLoadingGuard();
    for (const unsubscribe of this.unsubscribers || []) unsubscribe();
    this.services?.scoreClient.stop();
  },

  onShow() {
    syncPageTheme(this);
    enablePageShare();
    if (!this.services || !this.data.selectedDate) return;
    if (this.services.scoreStore.projection) {
      void this.refreshViewerFollowStates(this.services.scoreStore.projection, { force: true });
    }
    if (this.initialStartPromise) return;
    void this.services.scoreClient.ensure(this.data.selectedDate).catch(() => {
      this.services.scoreClient.scheduleSnapshotRecovery?.('page_show_retry');
    });
  },

  onShareAppMessage() {
    return pageShare({
      title: `炉的网球｜${this.data.selectedDate || '实时比分'}`,
      path: '/pages/scores/index',
      query: { date: this.data.selectedDate },
      shared: 'scores'
    }).appMessage;
  },

  onShareTimeline() {
    return pageShare({
      title: `炉的网球｜${this.data.selectedDate || '实时比分'}`,
      path: '/pages/scores/index',
      query: { date: this.data.selectedDate },
      shared: 'scores'
    }).timeline;
  },

  onPullDownRefresh() {
    this.setData({
      projectionLoadState: this.data.hasProjection ? 'ready' : 'loading',
      projectionLoadMessage: ''
    });
    void this.services.scoreClient.refreshNow('manual_refresh')
      .catch(() => {
        this.setData({
          projectionLoadState: this.data.hasProjection ? 'ready' : 'failed',
          projectionLoadMessage: this.data.hasProjection
            ? '' : '赛程刷新失败，请稍后重试'
        });
        wx.showToast({ title: '刷新失败，已保留当前赛程', icon: 'none' });
      })
      .finally(() => wx.stopPullDownRefresh());
  },

  retryScores() {
    this.setData({
      projectionLoadState: 'loading',
      projectionLoadMessage: ''
    });
    void this.services.scoreClient.start(this.data.selectedDate, {
      preserveSnapshot: this.data.hasProjection
    })
      .catch(() => this.setData({
        projectionLoadState: 'failed',
        projectionLoadMessage: '今日赛程暂时加载失败，请重试或稍后刷新'
      }));
  },

  applyProjection(projection) {
    if (!projection) {
      this.allGroups = [];
      this.fullMatchCount = 0;
      this.visibleMatchLimit = INITIAL_VISIBLE_MATCH_LIMIT;
      if (this.data.hasProjection || this.data.groups.length > 0) {
        this.setData({
          groups: [],
          matchCount: 0,
          visibleMatchCount: 0,
          hasMoreMatches: false,
          hasProjection: false,
          dataAsOf: '',
          dataUpdatedTime: '',
          dataDeliveryState: 'checking',
          dataDeliveryMessage: '赛程加载中',
          projectionLoadState: 'loading',
          projectionLoadMessage: '',
          showDataNotice: false
        });
      }
      return;
    }
    if (projection.payload.scheduleGroupDate !== this.data.selectedDate) return;
    this.clearInitialLoadingGuard();
    writeCachedProjection(wx, projection);
    const cachedFollowStates = this.services.follow?.cachedStates?.(
      scoreMatchTargets(projection)
    ) || new Map();
    for (const [key, state] of cachedFollowStates) {
      const matchId = key.slice('match:'.length);
      if (state === 'followed') this.followedIds.add(matchId);
      if (state === 'not_followed') this.followedIds.delete(matchId);
    }
    const groups = this.applyTournamentFollowOverrides(tournamentPresentation(groupedMatches(
      projection, this.data.selectedFilter, this.followedIds, this.data.query, {
        tourOrg: this.data.selectedTour,
        discipline: this.data.selectedDiscipline,
        followOverrides: this.followOverrides,
        followCountOverrides: this.followCountOverrides
      }
    )));
    const matchCount = countMatches(groups);
    this.allGroups = groups;
    this.fullMatchCount = matchCount;
    const visibleGroups = sliceGroups(groups, this.visibleMatchLimit);
    const visibleMatchCount = countMatches(visibleGroups);
    const groupPatch = incrementalGroupPatch(this.data.groups, visibleGroups);
    this.setData({
      ...(groupPatch === null ? { groups: visibleGroups } : groupPatch),
      matchCount,
      visibleMatchCount,
      hasMoreMatches: visibleMatchCount < matchCount,
      hasProjection: true,
      projectionLoadState: 'ready',
      projectionLoadMessage: '',
      dataAsOf: projection.dataAsOf,
      // “更新于” is the moment this complete server projection changed. The
      // provider dataAsOf remains separately available for delivery freshness;
      // displaying an old provider clock after a newly committed score made a
      // healthy realtime path look delayed by minutes.
      dataUpdatedTime: updateClock(
        projection.projectionGeneratedAt || projection.dataAsOf
      ),
      dataDeliveryState: projection.delivery.state,
      dataDeliveryMessage: projection.delivery.message,
      showDataNotice: projection.delivery.state === 'unavailable'
    });
    void this.refreshViewerFollowStates(projection);
  },

  async refreshViewerFollowStates(projection, options = {}) {
    if (!projection || projection.payload?.scheduleGroupDate !== this.data.selectedDate) return;
    if (!this.services?.account?.isComplete?.()
      || !this.services?.auth?.currentAccessToken?.()) {
      if (this.followedIds.size) {
        this.followedIds = new Set();
        this.rerender();
      }
      return;
    }
    const targets = scoreMatchTargets(projection);
    const signature = `${this.data.selectedDate}:${targets.map(target => target.targetId).sort().join('|')}`;
    if (!options.force && signature === this.followStateSignature) return;
    this.followStateSignature = signature;
    const requestId = ++this.followStateRequestId;
    try {
      const followedTargets = await this.services.follow.followedTargets(targets);
      if (requestId !== this.followStateRequestId
        || projection !== this.services.scoreStore.projection
        || projection.payload?.scheduleGroupDate !== this.data.selectedDate) return;
      this.followedIds = new Set([...followedTargets]
        .filter(key => key.startsWith('match:'))
        .map(key => key.slice('match:'.length)));
      this.rerender();
    } catch {
      if (requestId === this.followStateRequestId) this.followStateSignature = '';
    }
  },

  rerender() {
    if (this.services.scoreStore.projection) {
      this.applyProjection(this.services.scoreStore.projection);
    }
  },

  applyTournamentFollowOverrides(groups) {
    if (!(this.tournamentFollowOverrides instanceof Map)
      || this.tournamentFollowOverrides.size === 0) return groups;
    return Object.freeze(groups.map(group => {
      const override = this.tournamentFollowOverrides.get(group.followTargetId);
      return override === undefined ? group : Object.freeze({ ...group, followed: override });
    }));
  },

  resetVisibleWindow() {
    this.visibleMatchLimit = INITIAL_VISIBLE_MATCH_LIMIT;
  },

  loadMoreMatches() {
    if (!this.data.hasMoreMatches) return;
    this.visibleMatchLimit += VISIBLE_MATCH_INCREMENT;
    const visibleGroups = sliceGroups(this.allGroups || [], this.visibleMatchLimit);
    const visibleMatchCount = countMatches(visibleGroups);
    const groupPatch = incrementalGroupPatch(this.data.groups, visibleGroups);
    this.setData({
      ...(groupPatch === null ? { groups: visibleGroups } : groupPatch),
      visibleMatchCount,
      hasMoreMatches: visibleMatchCount < this.fullMatchCount
    });
  },

  onReachBottom() {
    this.loadMoreMatches();
  },

  selectFilter(event) {
    this.resetVisibleWindow();
    const selectedFilter = event.currentTarget.dataset.id;
    this.setData({ selectedFilter }, () => {
      this.rerender();
      if (selectedFilter === 'followed' && this.services.scoreStore.projection) {
        void this.refreshViewerFollowStates(this.services.scoreStore.projection, { force: true });
      }
    });
  },

  selectTour(event) {
    const selectedTour = event.currentTarget.dataset.id;
    this.resetVisibleWindow();
    this.setData({
      selectedTour,
      activeFilterCount: Number(selectedTour !== 'all')
        + Number(this.data.selectedDiscipline !== 'all')
    }, () => this.rerender());
  },

  selectDiscipline(event) {
    const selectedDiscipline = event.currentTarget.dataset.id;
    this.resetVisibleWindow();
    this.setData({
      selectedDiscipline,
      activeFilterCount: Number(this.data.selectedTour !== 'all')
        + Number(selectedDiscipline !== 'all')
    }, () => this.rerender());
  },

  resetFilters() {
    this.resetVisibleWindow();
    this.setData({
      selectedFilter: 'all',
      selectedTour: 'all',
      selectedDiscipline: 'all',
      activeFilterCount: 0
    }, () => this.rerender());
  },

  onSearch(event) {
    this.resetVisibleWindow();
    this.setData({ query: event.detail.value });
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.rerender(), 120);
  },

  focusSearch() { this.setData({ searchFocused: true }); },

  previousDate() { void this.changeDate(moveDate(this.data.selectedDate, -1)); },
  nextDate() { void this.changeDate(moveDate(this.data.selectedDate, 1)); },

  selectDate(event) {
    const selectedDate = event.detail.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
      && selectedDate !== this.data.selectedDate) {
      void this.changeDate(selectedDate);
    }
  },

  async changeDate(selectedDate) {
    this.allGroups = [];
    this.fullMatchCount = 0;
    this.visibleMatchLimit = INITIAL_VISIBLE_MATCH_LIMIT;
    this.followCountOverrides?.clear?.();
    this.followedIds = new Set();
    this.followStateSignature = '';
    this.followStateRequestId += 1;
    this.setData({
      selectedDate,
      dateLabel: dateLabel(selectedDate),
      hasProjection: false,
      groups: [],
      matchCount: 0,
      visibleMatchCount: 0,
      hasMoreMatches: false,
      dataDeliveryState: '',
      dataDeliveryMessage: '',
      showDataNotice: false,
      projectionLoadState: 'loading',
      projectionLoadMessage: '',
      dataAsOf: ''
    });
    const cached = cachedProjection(wx, selectedDate);
    if (cached) this.services.scoreStore.snapshot(cached);
    this.beginInitialLoadingGuard(selectedDate);
    try {
      await this.services.scoreClient.start(selectedDate, {
        preserveSnapshot: this.data.hasProjection
      });
    } catch { /* transport owns this */ }
    finally { this.clearInitialLoadingGuard(); }
  },

  toggleTournament(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ collapsedTournaments: {
      ...this.data.collapsedTournaments,
      [id]: !this.data.collapsedTournaments[id]
    } });
  },

  toggleCourt(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ collapsedCourts: {
      ...this.data.collapsedCourts,
      [id]: !this.data.collapsedCourts[id]
    } });
  },

  async toggleFollow(event) {
    const { matchId, followed: next } = event.detail;
    const hadOverride = this.followOverrides.has(matchId);
    const previousOverride = this.followOverrides.get(matchId);
    const hadCountOverride = this.followCountOverrides.has(matchId);
    const previousCountOverride = this.followCountOverrides.get(matchId);
    const nextCount = Math.max(0, matchFollowCountInGroups(this.allGroups, matchId) + (next ? 1 : -1));
    this.followOverrides.set(matchId, next);
    this.followCountOverrides.set(matchId, nextCount);
    if (this.data.selectedFilter === 'followed') this.resetVisibleWindow();
    this.rerender();
    try {
      const result = await this.services.follow.setFollow('match', matchId, next, 'scores_list');
      if (next) this.followedIds.add(matchId);
      else this.followedIds.delete(matchId);
      if (Number.isFinite(Number(result?.followCount))) {
        this.followCountOverrides.set(matchId, Number(result.followCount));
        this.rerender();
      }
    } catch (err) {
      if (hadOverride) this.followOverrides.set(matchId, previousOverride);
      else this.followOverrides.delete(matchId);
      if (hadCountOverride) this.followCountOverrides.set(matchId, previousCountOverride);
      else this.followCountOverrides.delete(matchId);
      if (this.data.selectedFilter === 'followed') this.resetVisibleWindow();
      this.rerender();
      if (String(err?.message || '') !== 'follow_login_cancelled') {
        wx.showToast({ title: '关注状态暂未保存', icon: 'none' });
      }
    }
  },

  async toggleTournamentFollow(event) {
    const targetId = String(event.currentTarget.dataset.id || '').trim();
    const next = event.currentTarget.dataset.followed === true
      || event.currentTarget.dataset.followed === 'true';
    if (!targetId) return;
    const hadOverride = this.tournamentFollowOverrides.has(targetId);
    const previousOverride = this.tournamentFollowOverrides.get(targetId);
    this.tournamentFollowOverrides.set(targetId, next);
    this.rerender();
    try {
      const group = this.data.groups.find(item => item.followTargetId === targetId);
      await this.services.follow.setFollow(
        'tournament',
        targetId,
        next,
        'scores_tournament_header',
        tournamentFollowSnapshot(group)
      );
    } catch (err) {
      if (hadOverride) this.tournamentFollowOverrides.set(targetId, previousOverride);
      else this.tournamentFollowOverrides.delete(targetId);
      this.rerender();
      if (String(err?.message || '') !== 'follow_login_cancelled') {
        wx.showToast({ title: '关注状态暂未保存', icon: 'none' });
      }
    }
  },

  openMatch(event) {
    wx.navigateTo({
      url: `/pages/match-detail/index?matchId=${encodeURIComponent(event.detail.matchId)}`
        + `&date=${encodeURIComponent(this.data.selectedDate)}`
    });
  },

  openDraws() { wx.redirectTo({ url: '/pages/draws/index' }); },
  openCalendar() { wx.redirectTo({ url: '/pages/calendar/index' }); },
  openPlayers() { wx.navigateTo({ url: '/packages/player/pages/players/index' }); },
  openParticipation() { wx.redirectTo({ url: '/pages/participation/index' }); },

  retryAuth() {
    void this.services.auth.refresh(false)
      .then(() => this.services.scoreClient.start(this.data.selectedDate))
      .catch(() => undefined);
  },

  openFilterSheet() { this.setData({ filterSheetOpen: true }); },
  closeFilterSheet() { this.setData({ filterSheetOpen: false }); },
  noop() {}
});
