'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');

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
function tournamentView(item = {}) {
  return { ...item, dateRange: dateRange(item), surfaceLabel: surfaceLabel(item.surface), previewEntries: (item.previewEntries || []).map(entryView) };
}
function playerView(item = {}) {
  return { ...item, nextAppearance: item.nextAppearance ? entryView(item.nextAppearance) : null, previewEntries: (item.previewEntries || []).map(entryView) };
}

Page({
  data: {
    ...buildThemeData(), topInset: 44, activeView: 'tournaments', loading: true,
    failed: false, stale: false, tournaments: [], players: [], qualityLabel: '', dataAsOf: ''
  },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ topInset: info.statusBarHeight || 44 });
    this.load();
  },
  onShow() { syncPageTheme(this); },
  async load() {
    this.setData({ loading: true, failed: false });
    try {
      const value = await getApp().services.entries.index();
      const payload = payloadOf(value);
      this.setData({
        loading: false, stale: value?.delivery?.state === 'stale',
        tournaments: Array.isArray(payload.tournaments) ? payload.tournaments.map(tournamentView) : [],
        players: Array.isArray(payload.players) ? payload.players.map(playerView) : [],
        qualityLabel: qualityLabel(payload.quality),
        dataAsOf: String(payload.dataAsOf || value?.dataAsOf || '').slice(0, 16).replace('T', ' ')
      });
    } catch {
      this.setData({ loading: false, failed: true });
    } finally {
      wx.stopPullDownRefresh?.();
    }
  },
  onPullDownRefresh() { this.load(); },
  selectView(event) { this.setData({ activeView: event.currentTarget.dataset.view === 'players' ? 'players' : 'tournaments' }); },
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
