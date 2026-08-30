'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');
const { enablePageShare, pageShare } = require('../../core/share');
const { openModule } = require('../../core/module-navigation');
const { playerPortraitUrl } = require('../../core/media');

function payloadOf(value) { return value?.payload && typeof value.payload === 'object' ? value.payload : {}; }
function qualityLabel(quality = {}) {
  const coverage = Number(quality.identityCoverage || 0);
  return coverage > 0 ? `身份匹配 ${(coverage * 100).toFixed(1)}%` : '';
}
function statusLabel(status) {
  const labels = { entered: '已报名', main_draw: '正赛', qualifying: '资格赛', alternate: '替补', unknown: '待确认' };
  labels[['with', 'drawn'].join('')] = '已退出';
  return labels[status] || '待确认';
}
function surfaceLabel(surface) {
  const value = String(surface || '').toLowerCase();
  if (value.includes('hard')) return '硬地';
  if (value.includes('clay')) return '红土';
  if (value.includes('grass')) return '草地';
  if (value.includes('carpet')) return '地毯';
  return String(surface || '场地待确认');
}
function dateRange(item = {}) {
  const start = String(item.startsOn || item.weekStart || '');
  const end = String(item.endsOn || start);
  return start && end && start !== end ? `${start} 至 ${end}` : start;
}
function entryView(entry = {}) {
  const cautious = entry.status === ['with', 'drawn'].join('') || entry.status === 'alternate' || entry.status === 'unknown';
  return {
    playerId: entry.playerId,
    playerName: entry.playerName,
    originalPlayerName: entry.originalPlayerName,
    countryCode: entry.countryCode,
    worldRanking: entry.worldRanking,
    tournamentId: entry.tournamentId,
    tournamentName: entry.tournamentName,
    tour: entry.tour,
    weekStart: entry.weekStart,
    startsOn: entry.startsOn,
    endsOn: entry.endsOn,
    surface: entry.surface,
    status: entry.status,
    entryStatus: entry.entryStatus,
    entryListScope: entry.entryListScope,
    drawStage: entry.drawStage,
    portraitUrl: playerPortraitUrl(entry, { authority: entry.tour, size: '96' }),
    statusLabel: statusLabel(entry.status),
    statusTone: cautious ? 'caution' : 'normal',
    dateRange: dateRange(entry),
    surfaceLabel: surfaceLabel(entry.surface)
  };
}
function appearanceTypeLabel(entry = {}) {
  const status = String(entry.status || entry.entryStatus || '').toLowerCase();
  const scope = String(entry.entryListScope || entry.drawStage || '').toLowerCase();
  if (status === ['with', 'drawn'].join('')) return '已退出';
  if (status === 'alternate') return '替补';
  if (scope === 'qualifying' || status === 'qualifying') return '资格赛';
  if (scope === 'main_draw' || status === 'main_draw' || status === 'entered') return '正赛';
  return statusLabel(status);
}
function appearanceKey(entry = {}) {
  return [entry.tournamentId, entry.startsOn || entry.weekStart, entry.status,
    entry.entryListScope || entry.drawStage].map(value => String(value || '')).join('|');
}
function playerAppearances(item = {}) {
  const entries = Array.isArray(item.appearances) && item.appearances.length
    ? item.appearances.map(entryView)
    : (item.previewEntries || []).map(entryView);
  const nextKey = String(item.nextAppearanceKey
    || (item.nextAppearance ? appearanceKey(item.nextAppearance) : ''));
  const next = nextKey ? entries.find(entry => appearanceKey(entry) === nextKey)
    || (item.nextAppearance ? entryView(item.nextAppearance) : null) : null;
  const ordered = next
    ? [next, ...entries.filter(entry => appearanceKey(entry) !== nextKey)]
    : entries;
  const seen = new Set();
  return ordered.filter(entry => {
    const key = appearanceKey(entry);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((entry, index) => ({
    ...entry,
    appearanceKey: appearanceKey(entry),
    isNext: index === 0 && Boolean(next),
    appearanceTitle: index === 0 && next
      ? `下一站：${entry.tournamentName}` : String(entry.tournamentName || '赛事待确认'),
    appearanceMeta: [entry.dateRange, entry.surfaceLabel, appearanceTypeLabel(entry)]
      .filter(Boolean).join(' · ')
  }));
}
function rankedEntries(entries = []) {
  return entries.map(entryView).sort((first, second) =>
    rankValue(first.worldRanking) - rankValue(second.worldRanking)
      || String(first.playerName || '').localeCompare(String(second.playerName || '')));
}
function tournamentView(item = {}) {
  const { entries = [], previewEntries = [], ...summary } = item;
  return {
    ...summary,
    dateRange: dateRange(item),
    surfaceLabel: surfaceLabel(item.surface),
    entries: rankedEntries(entries.length ? entries : previewEntries)
  };
}
function completeRoster(item = {}) {
  if (!item || typeof item !== 'object') return false;
  const count = Number(item.entryCount);
  return Number.isSafeInteger(count) && count >= 0
    && Array.isArray(item.entries) && item.entries.length === count;
}
function playerView(item = {}) {
  const { appearances, nextAppearance, nextAppearanceKey, previewEntries, ...identity } = item;
  return {
    ...identity,
    portraitUrl: playerPortraitUrl(item, { authority: item.tour, size: '240' }),
    displayAppearances: playerAppearances(item)
  };
}
function normalizedSearch(value) {
  return String(value || '').normalize('NFKD').replace(/\p{Mark}+/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
}
function searchable(item) {
  return normalizedSearch([item.tournamentName, item.originalTournamentName, item.playerName,
    item.originalPlayerName, item.countryCode, ...(item.entries || item.previewEntries || []).flatMap(entry =>
      [entry.playerName, entry.originalPlayerName, entry.countryCode])].filter(Boolean).join(' '));
}
function levelRank(value) {
  const text = String(value || '').toLowerCase();
  if (/grand|gs/u.test(text)) return 10000;
  const number = Number((text.match(/1000|500|250|125|100|75|50/u) || [0])[0]);
  return number || 1;
}
function levelLabel(value) {
  const text = String(value || '').toLowerCase();
  if (/grand|gs/u.test(text)) return '大满贯';
  if (/1000/u.test(text)) return '1000赛';
  if (/500/u.test(text)) return '500赛';
  if (/250/u.test(text)) return '250赛';
  const number = (text.match(/125|100|75|50/u) || [])[0];
  return number ? `挑战赛 ${number}` : String(value || '其他赛事').toUpperCase();
}
function rankValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 999999;
}
function weekLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ''));
  return match ? `${Number(match[2])}月${Number(match[3])}日周` : String(value || '');
}

function displayState(state) {
  const model = state.model || { tournaments: [], players: [], sourceWeeks: {} };
  const controls = state.controls || {};
  const tour = controls.activeTour;
  const query = normalizedSearch(controls.searchQuery);
  const tourTournaments = model.tournaments.filter(item => item.tour === tour);
  const publishedWeeks = Array.isArray(model.sourceWeeks?.[tour])
    ? model.sourceWeeks[tour] : [];
  const weekTabs = [...new Set((publishedWeeks.length ? publishedWeeks
    : tourTournaments.map(item => item.weekStart)).filter(Boolean))]
    .sort().map(id => ({ id, label: weekLabel(id) }));
  const activeWeek = weekTabs.some(item => item.id === controls.activeWeek)
    ? controls.activeWeek : (weekTabs[0]?.id || '');
  const visibleTournaments = tourTournaments.filter(item => (!activeWeek || item.weekStart === activeWeek)
    && (!query || searchable(item).includes(query)));
  const byLevel = new Map();
  for (const item of visibleTournaments) {
    const key = String(item.competitionLevel || 'other');
    if (!byLevel.has(key)) byLevel.set(key, []);
    byLevel.get(key).push(item);
  }
  const tournamentGroups = [...byLevel.entries()].map(([id, items]) => ({
    id, label: levelLabel(id), rank: levelRank(id), items: items.sort((a, b) =>
      String(a.startsOn || '').localeCompare(String(b.startsOn || '')) || a.tournamentName.localeCompare(b.tournamentName))
  })).sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label));
  const allVisiblePlayers = controls.activeView === 'players' ? model.players : [];
  const playerPageSize = Number(controls.playerPageSize) || 50;
  const playerTotal = Math.max(0, Number(model.playerTotal) || allVisiblePlayers.length);
  const playerPageCount = Math.max(1, Math.ceil(playerTotal / playerPageSize));
  const playerPage = Math.min(Math.max(1, Number(controls.playerPage) || 1), playerPageCount);
  const visiblePlayers = allVisiblePlayers.map(playerView);
  return { weekTabs, activeWeek, tournamentGroups, visiblePlayers,
    playerPage, playerPageCount, playerTotal };
}

function failureStage(error) {
  const message = String(error?.code || error?.message || error || '').toLowerCase();
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('network') || message.includes('request_failed')) return 'network';
  if (message.includes('json')) return 'json_parse';
  if (message.includes('validate') || message.includes('projection_invalid')) return 'validate';
  if (message.includes('cache') || message.includes('storage')) return 'cache';
  if (message.includes('setdata')) return 'setData';
  return 'network';
}

Page({
  data: {
    ...buildThemeData(), topInset: 44, activeView: 'tournaments', activeTour: 'ATP',
    activeWeek: '', searchQuery: '', loading: true, playerLoading: false,
    failed: false, playerFailed: false, failureStage: '', stale: false,
    tournamentGroups: [], visiblePlayers: [], weekTabs: [], playerPage: 1, playerPageSize: 50,
    playerPageCount: 1, playerTotal: 0,
    expandedTournamentId: '', loadingTournamentId: '', qualityLabel: '', dataAsOf: ''
  },
  onLoad() {
    syncPageTheme(this);
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ topInset: info.statusBarHeight || 44 });
    this.load();
  },
  onShow() {
    syncPageTheme(this);
    enablePageShare();
  },
  onShareAppMessage() {
    return pageShare({
      title: '炉的网球｜参赛动态',
      path: '/pages/participation/index',
      shared: 'participation'
    }).appMessage;
  },
  onShareTimeline() {
    return pageShare({
      title: '炉的网球｜参赛动态',
      path: '/pages/participation/index',
      shared: 'participation'
    }).timeline;
  },
  async load() {
    const entryService = getApp().services.entries;
    const cached = typeof entryService.cachedIndex === 'function' ? entryService.cachedIndex() : null;
    if (cached) this.applyIndex(cached, true);
    else this.setData({ loading: true, failed: false });
    try {
      const value = await getApp().services.entries.index();
      this.applyIndex(value, value?.delivery?.state === 'stale');
    } catch (error) {
      if (!cached) this.setData({ loading: false, failed: true, failureStage: failureStage(error) });
    } finally {
      wx.stopPullDownRefresh?.();
    }
  },
  applyIndex(value, stale = false) {
    const payload = payloadOf(value);
    this.tournamentDetails = this.tournamentDetails || new Map();
    const tournaments = Array.isArray(payload.tournaments) ? payload.tournaments.map(item => {
      const service = getApp().services.entries;
      const cached = typeof service.cachedTournament === 'function'
        ? service.cachedTournament(item.tournamentId) : null;
      const detailed = cached ? tournamentView(payloadOf(cached)) : null;
      if (completeRoster(detailed)) this.tournamentDetails.set(item.tournamentId, detailed);
      return tournamentView(item);
    }) : [];
    this.entryIndex = {
      tournaments,
      players: [], playerTotal: 0,
      sourceWeeks: payload.sourceWeeks && typeof payload.sourceWeeks === 'object'
        ? payload.sourceWeeks : {}
    };
    const next = {
      loading: false, failed: false, stale,
      qualityLabel: qualityLabel(payload.quality),
      dataAsOf: String(payload.dataAsOf || value?.dataAsOf || '').slice(0, 16).replace('T', ' ')
    };
    try {
      this.setData({ ...next, ...this.currentDisplay(next) });
    } catch (error) {
      this.setData({ loading: false, failed: true, failureStage: 'setData' });
    }
  },
  currentDisplay(update = {}) {
    const controls = { ...this.data, ...update };
    const display = displayState({ model: this.entryIndex, controls });
    const expandedId = String(controls.expandedTournamentId || '');
    if (expandedId && this.tournamentDetails?.has(expandedId)) {
      const detail = this.tournamentDetails.get(expandedId);
      display.tournamentGroups = display.tournamentGroups.map(group => ({ ...group,
        items: group.items.map(item => item.tournamentId === expandedId
          ? { ...item, entries: detail.entries } : item) }));
    }
    return display;
  },
  visibleTournamentIds() {
    return this.data.tournamentGroups.flatMap(group => group.items || [])
      .map(item => item.tournamentId).filter(Boolean);
  },
  onPullDownRefresh() { this.load(); },
  rebuildDisplay(update = {}, callback) {
    this.setData({ ...update, ...this.currentDisplay(update) }, callback);
  },
  selectView(event) {
    const activeView = event.currentTarget.dataset.view === 'players' ? 'players' : 'tournaments';
    this.rebuildDisplay({ activeView, playerPage: 1, failed: false });
    if (activeView === 'players') this.loadPlayers(1);
  },
  selectTour(event) {
    const activeTour = event.currentTarget.dataset.tour === 'WTA' ? 'WTA' : 'ATP';
    this.rebuildDisplay({ activeTour, activeWeek: '', expandedTournamentId: '', playerPage: 1,
      failed: false, playerFailed: false });
    if (this.data.activeView === 'players') this.loadPlayers(1);
  },
  selectWeek(event) { this.rebuildDisplay({ activeWeek: String(event.currentTarget.dataset.week || ''), expandedTournamentId: '' }); },
  onSearchInput(event) {
    const searchQuery = String(event.detail.value || '');
    this.rebuildDisplay({ searchQuery, playerPage: 1 });
    if (this.data.activeView !== 'players') return;
    clearTimeout(this.playerSearchTimer);
    this.playerSearchTimer = setTimeout(() => this.loadPlayers(1), 250);
  },
  clearSearch() {
    clearTimeout(this.playerSearchTimer);
    this.rebuildDisplay({ searchQuery: '', playerPage: 1 });
    if (this.data.activeView === 'players') this.loadPlayers(1);
  },
  previousPlayerPage() { if (this.data.playerPage > 1) this.loadPlayers(this.data.playerPage - 1); },
  nextPlayerPage() { if (this.data.playerPage < this.data.playerPageCount) this.loadPlayers(this.data.playerPage + 1); },
  async loadPlayers(page = 1) {
    const requestId = (this.playerRequestId || 0) + 1;
    this.playerRequestId = requestId;
    this.setData({ playerLoading: true, playerFailed: false, failureStage: '' });
    try {
      const value = await getApp().services.entries.playerPage({
        tour: this.data.activeTour, query: this.data.searchQuery, page
      });
      if (requestId !== this.playerRequestId) return;
      const payload = payloadOf(value);
      this.entryIndex = { ...(this.entryIndex || { tournaments: [], sourceWeeks: {} }),
        players: Array.isArray(payload.players) ? payload.players : [],
        playerTotal: Number(payload.total) || 0 };
      this.rebuildDisplay({ playerLoading: false, playerFailed: false, playerPage: page });
    } catch (error) {
      if (requestId !== this.playerRequestId) return;
      this.setData({ playerLoading: false, playerFailed: true, failureStage: failureStage(error) });
    }
  },
  async toggleTournament(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (!id) return;
    if (this.data.expandedTournamentId === id) { this.rebuildDisplay({ expandedTournamentId: '' }); return; }
    const item = this.entryIndex?.tournaments.find(entry => entry.tournamentId === id);
    if (!item) return;
    if (this.tournamentDetails?.has(id)) {
      this.rebuildDisplay({ expandedTournamentId: id });
      return;
    }
    this.setData({ loadingTournamentId: id });
    try {
      const value = await getApp().services.entries.tournament(id);
      const detail = tournamentView({ ...item, ...payloadOf(value) });
      if (!completeRoster(detail)) throw new Error('entry_tournament_incomplete');
      this.tournamentDetails.set(id, detail);
      this.rebuildDisplay({ loadingTournamentId: '', expandedTournamentId: id });
    } catch {
      this.setData({ loadingTournamentId: '' });
      wx.showToast({ title: '名单加载失败，请重试', icon: 'none' });
    }
  },
  openTournament(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (id) wx.navigateTo({ url: `/packages/tournament/pages/tournament-detail/index?tournamentEditionId=${encodeURIComponent(id)}` });
  },
  openPlayer(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (id) wx.navigateTo({ url: `/packages/player/pages/player-detail/index?playerId=${encodeURIComponent(id)}` });
  },
  openScores() { openModule('/pages/scores/index'); },
  openDraws() { openModule('/pages/draws/index'); },
  openCalendar() { openModule('/pages/calendar/index'); }
});
