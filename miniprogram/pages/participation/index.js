'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');

Page({
  data: { ...buildThemeData(), topInset: 44 },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ topInset: info.statusBarHeight || 44 });
  },
  onShow() { syncPageTheme(this); },
  openScores() { wx.redirectTo({ url: '/pages/scores/index' }); },
  openDraws() { wx.redirectTo({ url: '/pages/draws/index' }); },
  openCalendar() { wx.redirectTo({ url: '/pages/calendar/index' }); }
});
