'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');

const PARTICIPATION_DEFERRED_MARKER = 'M7-PARTICIPATION-DEFERRED-BY-OWNER';

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    participationDeferredMarker: PARTICIPATION_DEFERRED_MARKER,
    emptyLabel: '暂无参赛动态',
    emptyMessage: '退赛、替补和名单变化会显示在这里'
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ topInset: info.statusBarHeight || 44 });
  },

  onShow() { syncPageTheme(this); },

  onPullDownRefresh() { wx.stopPullDownRefresh(); },

  openScores() { wx.redirectTo({ url: '/pages/scores/index' }); },
  openDraws() { wx.redirectTo({ url: '/pages/draws/index' }); },
  openCalendar() { wx.redirectTo({ url: '/pages/calendar/index' }); }
});
