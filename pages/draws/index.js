'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');
const { createSWRCache } = require('../../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../../core/projection-resource');
const { drawShare, enablePageShare } = require('../../core/share');
const { updatePageShareImages } = require('../../core/share-poster');
const {
  CALENDAR_CACHE_SCHEMA,
  calendarCacheKey,
  tournamentOptionsFromCalendarProjection,
  weekRangeLabel,
  yearOf
} = require('../../core/draw-week-index');

const {
  drawGroupLabel,
  drawRoundView,
  drawSelectionView,
  officialMetadataView
} = require('../../core/draw-view');

const DRAW_INDEX_SCHEMA = 'draw-index-projection/1';
const DRAW_BODY_SCHEMA = 'draw-body-projection/1';

function drawIndexCacheKey(tournamentEditionId, tour = '') {
  return 'draw_index:' + tournamentEditionId + ':' + (normalizeDrawTour(tour) || 'all');
}
function drawBodyCacheKey(drawId) { return 'draw_body:' + drawId; }

function normalizeDrawTour(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'atp' || normalized === 'wta') return normalized;
  return '';
}

function tourFilterFromQuery(value) {
  const normalized = normalizeDrawTour(value);
  return normalized ? normalized.toUpperCase() : 'all';
}

function filterTourQuery(value) {
  const text = String(value || '').trim().toUpperCase();
  return text === 'ATP' || text === 'WTA' ? text.toLowerCase() : '';
}

const CONTENT_TABS = Object.freeze([
  Object.freeze({ id: 'draw', label: '签表' }),
  Object.freeze({ id: 'awards', label: '奖金积分' }),
  Object.freeze({ id: 'withdrawals', label: '退赛' }),
  Object.freeze({ id: 'changes', label: '签表变动' })
]);

function filteredTournaments(tournaments, tourFilter, query) {
  const search = String(query || '').trim().toLocaleLowerCase('zh-CN');
  const requestedTour = filterTourQuery(tourFilter);
  return tournaments.filter(item =>
    (tourFilter === 'all' || item.tourFilters?.includes(tourFilter))
    && (!search || item.searchText.includes(search)))
    .map(item => requestedTour
      ? Object.freeze({ ...item, requestTour: requestedTour })
      : item);
}

function optionValue(value, fallback = '') {
  const text = String(value || '');
  if (!text) return fallback;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function emptyDrawData() {
  return {
    drawOptions: [],
    projectOptions: [],
    stageOptions: [],
    selectedDrawId: '',
    selectedDrawLabel: '',
    rounds: [],
    roundTabs: [],
    selectedRoundId: '',
    selectedRoundTitle: '',
    selectedRoundMatchCount: 0,
    roundMatches: [],
    roundAwards: [],
    withdrawals: [],
    drawChanges: [],
    playerQuery: '',
    playerResults: [],
    focusedPlayerId: '',
    focusedPlayerName: '',
    shareCardImageUrl: '',
    shareTimelineImageUrl: ''
  };
}

function activeTabs(active) {
  return CONTENT_TABS.map(item => Object.freeze({
    ...item,
    selected: item.id === active
  }));
}

function tournamentSummary(tournaments, id, title) {
  const item = tournaments.find(value => value.id === id);
  return Object.freeze({
    title: item?.title || title || '选择赛事',
    level: item?.levelDisplay || '',
    meta: item?.summaryMeta || item?.meta || '',
    location: item?.location || '',
    surface: item?.surface || '',
    status: item?.status || ''
  });
}

function playerSearchResults(rounds, query) {
  const search = String(query || '').trim().toLocaleLowerCase('zh-CN');
  if (!search) return [];
  const values = new Map();
  for (const round of rounds || []) {
    for (const match of round.matches || []) {
      for (const side of match.sides || []) {
        for (const member of side.members || []) {
          if (!member.name || !member.name.toLocaleLowerCase('zh-CN').includes(search)) continue;
          const id = member.id || member.name;
          if (!values.has(id)) {
            values.set(id, Object.freeze({
              id,
              name: member.name,
              roundId: round.id,
              roundTitle: round.title,
              matchId: match.matchId
            }));
          }
        }
      }
    }
  }
  return [...values.values()].slice(0, 8);
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    loading: false,
    failed: false,
    tournaments: [],
    filteredTournaments: [],
    tourFilters: [
      { id: 'all', label: '全部' },
      { id: 'ATP', label: 'ATP' },
      { id: 'WTA', label: 'WTA' },
      { id: 'CHALLENGER', label: '挑战赛' },
      { id: 'ITF', label: 'ITF' }
    ],
    tourFilter: 'all',
    weekRange: weekRangeLabel(),
    query: '',
    selectorOpen: false,
    selectedTournamentId: '',
    selectedTitle: '',
    selectedTour: '',
    selectedTournamentSummary: tournamentSummary([], '', ''),
    draws: [],
    activeContentTab: 'draw',
    contentTabs: activeTabs('draw'),
    drawOptions: [],
    projectOptions: [],
    stageOptions: [],
    selectedDrawId: '',
    selectedDrawLabel: '',
    rounds: [],
    roundTabs: [],
    selectedRoundId: '',
    selectedRoundTitle: '',
    selectedRoundMatchCount: 0,
    roundMatches: [],
    roundAwards: [],
    withdrawals: [],
    drawChanges: [],
    playerQuery: '',
    playerResults: [],
    focusedPlayerId: '',
    focusedPlayerName: '',
    deliveryState: '',
    deliveryMessage: '',
    dataAsOf: '',
    shareCardImageUrl: '',
    shareTimelineImageUrl: ''
  },

  onLoad(options) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.http = getApp().services.http;
    this.cache = createSWRCache(wx);
    this.matchDate = options.date || '';
    this.initialDrawId = optionValue(options.drawId);
    this.initialTour = normalizeDrawTour(optionValue(options.tour));
    this.currentPresentation = null;
    this.setData({
      topInset: info.statusBarHeight || 44,
      weekRange: weekRangeLabel(options.date || ''),
      selectedTournamentId: optionValue(options.tournamentEditionId),
      selectedTitle: optionValue(options.title),
      selectedTour: this.initialTour,
      tourFilter: tourFilterFromQuery(this.initialTour),
      selectedTournamentSummary: tournamentSummary([], optionValue(options.tournamentEditionId), optionValue(options.title))
    });
    void this.loadDrawWeekIndex();
    if (this.data.selectedTournamentId) void this.loadIndex();
  },

  onShow() {
    syncPageTheme(this);
    enablePageShare();
  },

  onUnload() {},
  onShareAppMessage() {
    return drawShare(this.data, { date: this.matchDate }).appMessage;
  },

  onShareTimeline() {
    return drawShare(this.data, { date: this.matchDate }).timeline;
  },

  onPullDownRefresh() { void this.loadIndex().finally(() => wx.stopPullDownRefresh()); },
  openScores() { wx.redirectTo({ url: '/pages/scores/index' }); },
  openCalendar() { wx.redirectTo({ url: '/pages/calendar/index' }); },
  openPastDraws() { wx.redirectTo({ url: '/pages/calendar/index?mode=draws' }); },
  openParticipation() { wx.redirectTo({ url: '/pages/participation/index' }); },
  openTournamentDetail() {
    if (!this.data.selectedTournamentId) return;
    wx.navigateTo({
      url: '/packages/tournament/pages/tournament-detail/index?tournamentEditionId='
        + encodeURIComponent(this.data.selectedTournamentId)
    });
  },

  openTournamentSelector() { this.setData({ selectorOpen: true }); },
  closeTournamentSelector() { this.setData({ selectorOpen: false }); },
  stopTap() {},

  async loadDrawWeekIndex() {
    const year = yearOf(this.matchDate);
    const cacheKey = calendarCacheKey(year);
    const cached = readTrustedProjection(this.cache, cacheKey, CALENDAR_CACHE_SCHEMA);
    if (cached?.payload) this.applyDrawWeekProjection(cached.payload);
    else if (!this.data.selectedTournamentId) this.setData({ loading: true, failed: false });
    try {
      const result = await loadProjectionResource({
        http: this.http,
        cache: this.cache,
        resourceKey: cacheKey,
        schemaVersion: CALENDAR_CACHE_SCHEMA,
        path: '/api/v1/bff/calendar/' + year,
        requestOptions: {
          authMode: 'none',
          header: { 'x-luwang-client-contract-version': CALENDAR_CACHE_SCHEMA }
        },
        validate(value) {
          if (value?.bffContractVersion !== CALENDAR_CACHE_SCHEMA
            || !Array.isArray(value.presentation?.items)) {
            throw new Error('calendar_projection_invalid');
          }
          return value;
        }
      });
      this.applyDrawWeekProjection(result.value);
    } catch {
      if (!this.data.selectedTournamentId && !cached?.payload) {
        this.setData({ loading: false, failed: true });
      }
    }
  },

  applyDrawWeekProjection(projection) {
    const tournaments = tournamentOptionsFromCalendarProjection(projection, this.matchDate);
    const filtered = filteredTournaments(tournaments, this.data.tourFilter, this.data.query);
    this.setData({
      tournaments,
      filteredTournaments: filtered,
      selectedTournamentSummary: tournamentSummary(
        tournaments,
        this.data.selectedTournamentId,
        this.data.selectedTitle
      ),
      weekRange: weekRangeLabel(this.matchDate),
      loading: this.data.selectedTournamentId ? this.data.loading : false,
      failed: this.data.selectedTournamentId ? this.data.failed : false
    });
    if (!this.data.selectedTournamentId && filtered[0]) {
      this.selectTournamentById(filtered[0].id, filtered[0].title, filtered[0].requestTour);
    }
  },

  chooseTournament(event) {
    this.selectTournamentById(
      event.currentTarget.dataset.id,
      event.currentTarget.dataset.title,
      filterTourQuery(this.data.tourFilter) || event.currentTarget.dataset.tour
    );
  },

  chooseTour(event) {
    const tourFilter = event.currentTarget.dataset.id || 'all';
    const filtered = filteredTournaments(this.data.tournaments, tourFilter, this.data.query);
    this.initialDrawId = '';
    this.currentPresentation = null;
    this.setData({
      tourFilter,
      filteredTournaments: filtered,
      selectedTournamentId: '',
      selectedTitle: '',
      selectedTour: '',
      selectedTournamentSummary: tournamentSummary([], '', ''),
      draws: [],
      ...emptyDrawData(),
      failed: false,
      deliveryState: '',
      deliveryMessage: '',
      dataAsOf: ''
    });
  },

  updateQuery(event) {
    const query = event.detail.value || '';
    const filtered = filteredTournaments(this.data.tournaments, this.data.tourFilter, query);
    this.setData({ query, filteredTournaments: filtered });
  },

  selectTournamentById(id, title, tour = '') {
    this.initialDrawId = '';
    this.currentPresentation = null;
    this.setData({
      selectedTournamentId: id,
      selectedTitle: title,
      selectedTour: normalizeDrawTour(tour),
      selectedTournamentSummary: tournamentSummary(this.data.tournaments, id, title),
      selectorOpen: false,
      draws: [],
      ...emptyDrawData(),
      failed: false,
      deliveryState: '',
      deliveryMessage: '',
      dataAsOf: ''
    }, () => void this.loadIndex());
  },

  async loadIndex() {
    if (!this.data.selectedTournamentId) return;
    const cacheKey = drawIndexCacheKey(this.data.selectedTournamentId, this.data.selectedTour);
    const cached = readTrustedProjection(this.cache, cacheKey, DRAW_INDEX_SCHEMA);
    if (cached?.payload) await this.applyDrawIndex(cached.payload, { fromCache: true });
    else this.setData({ loading: true, failed: false });
    try {
      const result = await loadProjectionResource({
        http: this.http,
        cache: this.cache,
        resourceKey: cacheKey,
        schemaVersion: DRAW_INDEX_SCHEMA,
        path: '/api/v1/bff/draws?tournamentEditionId='
          + encodeURIComponent(this.data.selectedTournamentId) + '&includeDefault=1'
          + (this.data.selectedTour ? '&tour=' + encodeURIComponent(this.data.selectedTour) : ''),
        requestOptions: {
          authMode: 'none',
          header: { 'x-luwang-client-contract-version': 'draw-player-entry-bff/1' }
        },
        validate(value) {
          if (value?.bffContractVersion !== 'draw-player-entry-bff/1'
            || !Array.isArray(value.items)) throw new Error('draw_index_invalid');
          return value;
        }
      });
      await this.applyDrawIndex(result.value, { fromCache: false });
    } catch {
      if (!cached?.payload) this.setData({ loading: false, failed: true });
      else this.setData({ loading: false, failed: false, deliveryState: 'stale' });
    }
  },

  async applyDrawIndex(value, options = {}) {
    if (value?.bffContractVersion !== 'draw-player-entry-bff/1'
      || !Array.isArray(value.items)) throw new Error('draw_index_invalid');
    const draws = value.items.map(item => Object.freeze({
      ...item,
      label: drawGroupLabel(item)
    }));
    const selection = drawSelectionView(draws, this.initialDrawId);
    this.setData({
      draws,
      drawOptions: selection.drawOptions,
      projectOptions: selection.projectOptions,
      stageOptions: selection.stageOptions,
      selectedDrawLabel: selection.selectedDrawLabel,
      loading: false,
      failed: false,
      roundAwards: [],
      withdrawals: [],
      drawChanges: [],
      deliveryState: options.fromCache ? 'stale' : '',
      deliveryMessage: options.fromCache ? '已显示上次签表' : '',
      dataAsOf: value.dataAsOf || this.data.dataAsOf
    });
    const requestedDrawId = this.initialDrawId
      && draws.some(item => item.drawId === this.initialDrawId)
      ? this.initialDrawId : '';
    this.initialDrawId = '';
    const nextDrawId = requestedDrawId || value.defaultDrawId || draws[0]?.drawId;
    if (!nextDrawId) return;
    if (value.defaultDraw?.bffContractVersion === 'draw-player-entry-bff/1'
      && value.defaultDraw.drawId === nextDrawId) {
      this.cache.write(drawBodyCacheKey(nextDrawId), {
        schemaVersion: DRAW_BODY_SCHEMA,
        projectionVersion: value.defaultDraw.projectionVersion,
        dataAsOf: value.defaultDraw.dataAsOf || '',
        etag: '',
        payload: value.defaultDraw
      });
      this.applyDrawProjection(value.defaultDraw, nextDrawId);
      return;
    }
    await this.loadDraw(nextDrawId);
  },

  chooseDraw(event) { void this.loadDraw(event.currentTarget.dataset.id); },
  chooseProject(event) { void this.loadDraw(event.currentTarget.dataset.drawId); },
  chooseStage(event) { void this.loadDraw(event.currentTarget.dataset.drawId); },

  chooseContentTab(event) {
    const activeContentTab = event.currentTarget.dataset.id || 'draw';
    this.setData({ activeContentTab, contentTabs: activeTabs(activeContentTab) });
  },

  async loadDraw(drawId) {
    if (!drawId) return;
    const switching = this.data.selectedDrawId !== drawId;
    const cacheKey = drawBodyCacheKey(drawId);
    const cached = readTrustedProjection(this.cache, cacheKey, DRAW_BODY_SCHEMA);
    const selection = drawSelectionView(this.data.draws, drawId);
    this.setData({
      loading: !cached?.payload,
      selectedDrawId: drawId,
      selectedDrawLabel: selection.selectedDrawLabel,
      drawOptions: selection.drawOptions,
      projectOptions: selection.projectOptions,
      stageOptions: selection.stageOptions,
      failed: false,
      ...(switching ? {
        rounds: [],
        roundTabs: [],
        selectedRoundId: '',
        selectedRoundTitle: '',
        selectedRoundMatchCount: 0,
        roundMatches: [],
        roundAwards: [],
        withdrawals: [],
        drawChanges: [],
        playerQuery: '',
        playerResults: [],
        focusedPlayerId: '',
        focusedPlayerName: '',
        shareCardImageUrl: '',
        shareTimelineImageUrl: ''
      } : {})
    });
    if (cached?.payload) this.applyDrawProjection(cached.payload, drawId, { fromCache: true });
    try {
      const result = await loadProjectionResource({
        http: this.http,
        cache: this.cache,
        resourceKey: cacheKey,
        schemaVersion: DRAW_BODY_SCHEMA,
        path: '/api/v1/bff/draws/' + encodeURIComponent(drawId),
        requestOptions: {
          authMode: 'none',
          header: { 'x-luwang-client-contract-version': 'draw-player-entry-bff/1' }
        },
        validate(value) {
          if (value?.bffContractVersion !== 'draw-player-entry-bff/1'
            || !Array.isArray(value.presentation?.rounds)) {
            throw new Error('draw_projection_invalid');
          }
          return value;
        }
      });
      this.applyDrawProjection(result.value, drawId);
    } catch {
      this.setData({ loading: false, failed: !cached?.payload });
    }
  },

  applyDrawProjection(value, drawId, options = {}) {
    if (value?.bffContractVersion !== 'draw-player-entry-bff/1'
      || !Array.isArray(value.presentation?.rounds)) {
      throw new Error('draw_projection_invalid');
    }
    this.currentPresentation = value.presentation;
    const metadata = officialMetadataView(value.presentation.officialMetadata, { ...value, drawId });
    const selection = drawSelectionView(this.data.draws.length ? this.data.draws : [value], drawId);
    const roundView = drawRoundView(
      value.presentation,
      this.data.selectedRoundId,
      this.data.focusedPlayerId
    );
    this.setData({
      loading: false,
      failed: false,
      selectedDrawId: drawId,
      selectedDrawLabel: selection.selectedDrawLabel,
      drawOptions: selection.drawOptions,
      projectOptions: selection.projectOptions,
      stageOptions: selection.stageOptions,
      rounds: roundView.rounds,
      roundTabs: roundView.roundTabs,
      selectedRoundId: roundView.selectedRoundId,
      selectedRoundTitle: roundView.selectedRoundTitle,
      selectedRoundMatchCount: roundView.selectedRoundMatchCount,
      roundMatches: roundView.roundMatches,
      roundAwards: metadata.roundAwards,
      withdrawals: metadata.withdrawals,
      drawChanges: metadata.drawChanges,
      deliveryState: options.fromCache ? 'stale'
        : value.delivery?.state === 'current' ? 'live' : 'delayed',
      deliveryMessage: options.fromCache ? '已显示上次签表' : '签表已更新',
      dataAsOf: value.dataAsOf || value.delivery?.dataAsOf || ''
    }, () => {
      void updatePageShareImages(this, 'draw', this.data);
    });
  },

  chooseRound(event) {
    this.refreshRoundView(event.currentTarget.dataset.id || '');
  },

  refreshRoundView(roundId = this.data.selectedRoundId) {
    if (!this.currentPresentation) return;
    const roundView = drawRoundView(
      this.currentPresentation,
      roundId,
      this.data.focusedPlayerId
    );
    this.setData({
      rounds: roundView.rounds,
      roundTabs: roundView.roundTabs,
      selectedRoundId: roundView.selectedRoundId,
      selectedRoundTitle: roundView.selectedRoundTitle,
      selectedRoundMatchCount: roundView.selectedRoundMatchCount,
      roundMatches: roundView.roundMatches
    });
  },

  updatePlayerQuery(event) {
    const playerQuery = event.detail.value || '';
    this.setData({
      playerQuery,
      playerResults: playerSearchResults(this.data.rounds, playerQuery)
    });
  },

  focusPlayer(event) {
    const focusedPlayerId = event.currentTarget.dataset.id || '';
    const focusedPlayerName = event.currentTarget.dataset.name || '';
    const roundId = event.currentTarget.dataset.roundId || this.data.selectedRoundId;
    this.setData({ focusedPlayerId, focusedPlayerName, playerResults: [] }, () => {
      this.refreshRoundView(roundId);
    });
  },

  clearPlayerFocus() {
    this.setData({
      focusedPlayerId: '',
      focusedPlayerName: '',
      playerQuery: '',
      playerResults: []
    }, () => this.refreshRoundView(this.data.selectedRoundId));
  },

  openLandscapeDraw() {
    if (!this.data.selectedDrawId) return;
    const params = [
      ['drawId', this.data.selectedDrawId],
      ['tournamentEditionId', this.data.selectedTournamentId],
      ['title', this.data.selectedTournamentSummary.title],
      ['drawLabel', this.data.selectedDrawLabel],
      ['tour', this.data.selectedTour],
      ['roundId', this.data.selectedRoundId],
      ['date', this.matchDate || '']
    ]
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    wx.navigateTo({ url: `/packages/tournament/pages/draw-landscape/index?${params}` });
  },

  openMatch(event) {
    const matchId = event.currentTarget.dataset.matchId;
    if (!matchId) return;
    wx.navigateTo({
      url: `/pages/match-detail/index?matchId=${encodeURIComponent(matchId)}`
        + (this.matchDate ? `&date=${encodeURIComponent(this.matchDate)}` : '')
    });
  }
});
