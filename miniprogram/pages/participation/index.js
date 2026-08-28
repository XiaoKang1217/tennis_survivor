'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');
const { enablePageShare, pageShare } = require('../../core/share');

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
  return { ...entry, statusLabel: statusLabel(entry.status), statusTone: cautious ? 'caution' : 'normal', dateRange: dateRange(entry), surfaceLabel: surfaceLabel(entry.surface) };
}
function rankedEntries(entries = []) {
  return entries.map(entryView).sort((first, second) =>
    rankValue(first.worldRanking) - rankValue(second.worldRanking)
      || String(first.playerName || '').localeCompare(String(second.playerName || '')));
}
function tournamentView(item = {}) {
  return {
    ...item,
    dateRange: dateRange(item),
    surfaceLabel: surfaceLabel(item.surface),
    entries: rankedEntries(item.entries || []),
    previewEntries: rankedEntries(item.previewEntries || [])
  };
}
function playerView(item = {}) {
  return { ...item, nextAppearance: item.nextAppearance ? entryView(item.nextAppearance) : null, previewEntries: (item.previewEntries || []).map(entryView) };
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

Page({
  data: {
    ...buildThemeData(), topInset: 44, activeView: 'tournaments', activeTour: 'ATP',
    activeWeek: '', searchQuery: '', loading: true, failed: false, stale: false,
    tournaments: [], players: [], sourceWeeks: {}, tournamentGroups: [], visiblePlayers: [], weekTabs: [],
    expandedTournamentId: '', qualityLabel: '', dataAsOf: ''
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
    this.setData({ loading: true, failed: false });
    try {
      const value = await getApp().services.entries.index();
      const payload = payloadOf(value);
      const tournaments = Array.isArray(payload.tournaments) ? payload.tournaments.map(tournamentView) : [];
      const players = Array.isArray(payload.players) ? payload.players.map(playerView) : [];
      this.setData({
        loading: false, stale: value?.delivery?.state === 'stale',
        tournaments, players, sourceWeeks: payload.sourceWeeks && typeof payload.sourceWeeks === 'object'
          ? payload.sourceWeeks : {},
        qualityLabel: qualityLabel(payload.quality),
        dataAsOf: String(payload.dataAsOf || value?.dataAsOf || '').slice(0, 16).replace('T', ' ')
      }, () => this.rebuildDisplay());
    } catch {
      this.setData({ loading: false, failed: true });
    } finally {
      wx.stopPullDownRefresh?.();
    }
  },
  onPullDownRefresh() { this.load(); },
  rebuildDisplay() {
    const tour = this.data.activeTour;
    const query = normalizedSearch(this.data.searchQuery);
    const tourTournaments = this.data.tournaments.filter(item => item.tour === tour);
    const publishedWeeks = Array.isArray(this.data.sourceWeeks?.[tour])
      ? this.data.sourceWeeks[tour] : [];
    const weekTabs = [...new Set((publishedWeeks.length ? publishedWeeks
      : tourTournaments.map(item => item.weekStart)).filter(Boolean))]
      .sort().map(id => ({ id, label: weekLabel(id) }));
    const activeWeek = weekTabs.some(item => item.id === this.data.activeWeek)
      ? this.data.activeWeek : (weekTabs[0]?.id || '');
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
    const visiblePlayers = this.data.players.filter(item => item.tour === tour
      && (!query || searchable(item).includes(query)))
      .sort((a, b) => rankValue(a.worldRanking) - rankValue(b.worldRanking)
        || a.playerName.localeCompare(b.playerName));
    this.setData({ weekTabs, activeWeek, tournamentGroups, visiblePlayers });
  },
  selectView(event) { this.setData({ activeView: event.currentTarget.dataset.view === 'players' ? 'players' : 'tournaments' }); },
  selectTour(event) { this.setData({ activeTour: event.currentTarget.dataset.tour === 'WTA' ? 'WTA' : 'ATP', activeWeek: '', expandedTournamentId: '' }, () => this.rebuildDisplay()); },
  selectWeek(event) { this.setData({ activeWeek: String(event.currentTarget.dataset.week || ''), expandedTournamentId: '' }, () => this.rebuildDisplay()); },
  onSearchInput(event) { this.setData({ searchQuery: String(event.detail.value || '') }, () => this.rebuildDisplay()); },
  clearSearch() { this.setData({ searchQuery: '' }, () => this.rebuildDisplay()); },
  async toggleTournament(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (!id) return;
    if (this.data.expandedTournamentId === id) { this.setData({ expandedTournamentId: '' }); return; }
    this.setData({ expandedTournamentId: id });
    const index = this.data.tournaments.findIndex(item => item.tournamentId === id);
    if (index < 0 || this.data.tournaments[index].entries.length) return;
    try {
      const value = await getApp().services.entries.tournament(id);
      const item = tournamentView(payloadOf(value));
      const tournaments = this.data.tournaments.map(existing => existing.tournamentId === id
        ? { ...existing, ...item } : existing);
      this.setData({ tournaments }, () => this.rebuildDisplay());
    } catch { /* keep the trusted preview and allow a later retry */ }
  },
  openTournament(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (id) wx.navigateTo({ url: `/packages/tournament/pages/tournament-detail/index?tournamentEditionId=${encodeURIComponent(id)}` });
  },
  openPlayer(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (id) wx.navigateTo({ url: `/packages/player/pages/player-detail/index?playerId=${encodeURIComponent(id)}` });
  },
  openScores() { wx.redirectTo({ url: '/pages/scores/index' }); },
  openDraws() { wx.redirectTo({ url: '/pages/draws/index' }); },
  openCalendar() { wx.redirectTo({ url: '/pages/calendar/index' }); }
});
