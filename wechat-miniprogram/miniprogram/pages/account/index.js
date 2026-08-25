'use strict';

const { THEMES, buildThemeData, syncPageTheme, writeTheme } = require('../../core/theme');

function profileView(profile = {}) {
  const completed = Boolean(profile.completed || (profile.nickname && profile.avatarUrl));
  return {
    nickname: completed ? (profile.nickname || '微信用户') : '未登录',
    avatarUrl: completed ? (profile.avatarUrl || '') : '',
    completed,
    actionLabel: completed ? '编辑资料' : '登录',
    authActionLabel: completed ? '退出登录' : '登录'
  };
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    profile: profileView(),
    themeSheetOpen: false,
    themeOptions: THEMES
  },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ topInset: info.statusBarHeight || 44 });
    const account = getApp().services.account;
    this.unsubscribeProfile = account.subscribe(profile => {
      this.setData({ profile: profileView(profile) });
    });
    if (account.isComplete?.()) void account.refresh().catch(() => undefined);
  },
  onShow() { syncPageTheme(this); },
  async openProfileGate() {
    const gate = this.selectComponent('#profileGate');
    if (gate?.collect) {
      await gate.collect({
        sourceEntry: 'account',
        mode: this.data.profile.completed ? 'edit' : 'login'
      });
    }
  },
  async toggleLogin() {
    if (this.data.profile.completed) {
      getApp().services.account.logout?.();
      wx.showToast({ title: '已退出登录', icon: 'none' });
      return;
    }
    await this.openProfileGate();
  },
  openPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/legal/index?type=privacy' });
  },
  openTerms() {
    wx.navigateTo({ url: '/pages/legal/index?type=terms' });
  },
  openThemeSheet() { this.setData({ themeSheetOpen: true }); },
  closeThemeSheet() { this.setData({ themeSheetOpen: false }); },
  noop() {},
  chooseTheme(event) {
    const uiTheme = writeTheme(event.currentTarget.dataset.theme);
    syncPageTheme(this, uiTheme);
    this.setData({ themeSheetOpen: false });
  },
  onUnload() {
    this.unsubscribeProfile?.();
  }
});
