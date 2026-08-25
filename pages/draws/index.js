'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');
const { createSWRCache } = require('../../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../../core/projection-resource');
const { drawShare, enablePageShare } = require('../../core/share');
const { updatePageShareImages } = require('../../core/share-poster');
const { normalizeLevelCode, levelLabel } = require('../../core/localization');

const {
  drawGroupLabel,
  drawRoundView,
  drawSelectionView,
  field,
  officialMetadataView
} = require('../../core/draw-view');

const DRAW_INDEX_SCHEMA = 'draw-index-projection/1';
const DRAW_BODY_SCHEMA = 'draw-body-projection/1';

function drawIndexCacheKey(tournamentEditionId, tour = '') {
  const normalized = normalizeDrawTour(tour);
  return 'draw_index:' + tournamentEditionId + (normalized ? ':' + normalized : '');
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

const LEVEL_PRIORITY = Object.freeze({
  grand_slam: 10000,
  masters_1000: 9000,
  wta_1000: 9000,
  tour_500: 8000,
  wta_500: 8000,
  tour_250: 7000,
  wta_250: 7000,
  challenger_175: 6175,
  challenger_125: 6125,
  wta_125: 6125,
  challenger_100: 6100,
  challenger_75: 6075,
  challenger_50: 6050,
  itf_w100: 5100,
  itf_w75: 5075,
  itf_w50: 5050,
  itf_w35: 5035,
  itf_m25: 5025,
  itf_m15: 5015,
  itf_w15: 5015
});

const TOUR_PRIORITY = Object.freeze({ ATP: 3, WTA: 2, ITF: 1, UNKNOWN: 0 });
const CONTENT_TABS = Object.freeze([
  Object.freeze({ id: 'draw', label: '签表' }),
  Object.freeze({ id: 'awards', label: '奖金积分' }),
  Object.freeze({ id: 'withdrawals', label: '退赛' }),
  Object.freeze({ id: 'changes', label: '签表变动' })
]);

function currentWeekRange(value = '') {
  const now = new Date();
  const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    + `-${String(now.getDate()).padStart(2, '0')}`;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || fallback);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() + 6);
  const startLabel = `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  const endLabel = date.getUTCMonth() === end.getUTCMonth()
    ? `${end.getUTCDate()}日` : `${end.getUTCMonth() + 1}月${end.getUTCDate()}日`;
  return `${startLabel}—${endLabel}`;
}

function tournamentOptions(projection) {
  const values = new Map();
  for (const match of projection?.payload?.matches || []) {
    const id = match.tournament?.id;
    if (!id) continue;
    const players = projection.payload.matches
      .filter(item => item.tournament?.id === id)
      .flatMap(item => item.participants || [])
      .flatMap(side => side.members || [])
      .flatMap(member => [
        field(member.displayNameZh),
        field(member.displayNameOriginal)
      ])
      .filter(Boolean);
    const level = match.tournament?.levelCode
      || match.tournament?.level
      || match.competitionLevel
      || '';
    const levelCode = normalizeLevelCode(field(level) || String(level || ''));
    const tourOrg = match.tournament?.tourOrg || 'UNKNOWN';
    const tourFilter = /^challenger_/u.test(levelCode) ? 'CHALLENGER'
      : levelCode === 'wta_125' ? 'WTA'
        : tourOrg;
    const existing = values.get(id);
    const tourFilters = new Set(existing?.tourFilters || []);
    if (tourFilter) tourFilters.add(tourFilter);
    const requestTour = existing?.requestTour || normalizeDrawTour(tourOrg);
    const title = existing?.title || field(match.tournament.displayNameZh, '赛事');
    const location = existing?.location || field(match.tournament.locationNameZh);
    const levelDisplay = existing?.levelDisplay || levelLabel(levelCode) || String(tourOrg || '赛事');
    const surface = existing?.surface || field(match.surface?.displayNameZh, match.surface?.code || '');
    const tournamentMeta = [tourOrg, levelDisplay, location].filter(Boolean).join(' · ');
    values.set(id, Object.freeze({
      id,
      title,
      location,
      surface,
      tourOrg: existing && existing.tourOrg !== tourOrg ? 'ATP/WTA' : tourOrg,
      tourFilters: Object.freeze([...tourFilters]),
      requestTour,
      levelCode: existing?.levelCode || levelCode,
      levelDisplay,
      meta: tournamentMeta,
      status: field(match.tournament?.statusLabel, ''),
      searchText: [
        existing?.searchText || '',
        title,
        location,
        levelDisplay,
        ...players
      ].join(' ').toLocaleLowerCase('zh-CN')
    }));
  }
  return [...values.values()].sort((first, second) => {
    const firstLevel = LEVEL_PRIORITY[first.levelCode] || 0;
    const secondLevel = LEVEL_PRIORITY[second.levelCode] || 0;
    if (firstLevel !== secondLevel) return secondLevel - firstLevel;
    const firstTour = TOUR_PRIORITY[first.tourOrg] || 0;
    const secondTour = TOUR_PRIORITY[second.tourOrg] || 0;
    if (firstTour !== secondTour) return secondTour - firstTour;
    return first.title.localeCompare(second.title, 'zh-CN');
  });
}

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
    meta: item?.meta || '',
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
    weekRange: currentWeekRange(),
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
      weekRange: currentWeekRange(options.date || ''),
      selectedTournamentId: optionValue(options.tournamentEditionId),
      selectedTitle: optionValue(options.title),
      selectedTour: this.initialTour,
      tourFilter: tourFilterFromQuery(this.initialTour),
      selectedTournamentSummary: tournamentSummary([], optionValue(options.tournamentEditionId), optionValue(options.title))
    });
    let selectedDuringSubscribe = false;
    this.unsubscribe = getApp().services.scoreStore.subscribe(projection => {
      const tournaments = tournamentOptions(projection);
      const filtered = filteredTournaments(
        tournaments,
        this.data.tourFilter,
        this.data.query
      );
      this.setData({
        tournaments,
        filteredTournaments: filtered,
        selectedTournamentSummary: tournamentSummary(
          tournaments,
          this.data.selectedTournamentId,
          this.data.selectedTitle
        ),
        weekRange: currentWeekRange(projection?.payload?.scheduleGroupDate || this.matchDate)
      });
      if (!this.data.selectedTournamentId && filtered[0]) {
        selectedDuringSubscribe = true;
        this.selectTournamentById(filtered[0].id, filtered[0].title, filtered[0].requestTour);
      }
    });
    if (this.data.selectedTournamentId && !selectedDuringSubscribe) void this.loadIndex();
  },

  onShow() {
    syncPageTheme(this);
    enablePageShare();
  },

  onUnload() { this.unsubscribe?.(); },
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
        focusedPlayerName: ''
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
