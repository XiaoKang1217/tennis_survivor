'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');

function payloadOf(value) { return value?.payload && typeof value.payload === 'object' ? value.payload : {}; }
function qualityLabel(quality = {}) {
  const coverage = Number(quality.identityCoverage || 0);
  return coverage > 0 ? `身份匹配 ${(coverage * 100).toFixed(1)}%` : '';
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
        tournaments: Array.isArray(payload.tournaments) ? payload.tournaments : [],
        players: Array.isArray(payload.players) ? payload.players : [],
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
