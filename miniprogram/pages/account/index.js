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

function checkinsView(value = {}) {
  return {
    ...value,
    recentSevenDays: (value.recentSevenDays || []).map(item => ({
      ...item,
      dayLabel: String(item.date || '').slice(8)
    }))
  };
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    profile: profileView(),
    socialReady: false,
    wallet: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
    checkins: { checkedInToday: false, totalDays: 0, currentStreak: 0, recentSevenDays: [] },
    themeSheetOpen: false,
    themeOptions: THEMES
  },
  onLoad() {
    syncPageTheme(this);
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ topInset: info.statusBarHeight || 44 });
    const account = getApp().services.account;
    this.unsubscribeProfile = account.subscribe(profile => {
      this.setData({ profile: profileView(profile) });
    });
    void this.loadSocial();
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
  async loadSocial() {
    try {
      const value = await getApp().services.social.bootstrap();
      if (value?.profile) getApp().services.account.writeStored(value.profile);
      this.setData({
        socialReady: true,
        wallet: value.wallet || this.data.wallet,
        checkins: checkinsView(value.checkins || this.data.checkins)
      });
    } catch {
      this.setData({ socialReady: false });
    }
  },
  async checkin() {
    try {
      const value = await getApp().services.social.checkin();
      this.setData({
        socialReady: true,
        wallet: { ...this.data.wallet, balance: value.balance ?? this.data.wallet.balance },
        checkins: checkinsView(value.summary || this.data.checkins)
      });
      wx.showToast({ title: value.alreadyCheckedIn ? '今天已经签过啦' : '签到成功，花朵 +1', icon: 'none' });
    } catch (error) {
      if (!/profile_gate_cancelled/u.test(String(error?.message || ''))) {
        wx.showToast({ title: '签到暂未完成', icon: 'none' });
      }
    }
  },
  openSocialCenter() { wx.navigateTo({ url: '/pages/social-center/index' }); },
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
