'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');

function monthNow() {
  // Mini-program Intl output is runtime-dependent (some versions return
  // "08/2026" even for en-CA). Build the Shanghai month numerically so the
  // API always receives the required YYYY-MM contract.
  const shanghai = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthShift(month, delta) {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 15));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function calendarCells(month, checkedDates) {
  const [year, value] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, value - 1, 1));
  const days = new Date(Date.UTC(year, value, 0)).getUTCDate();
  const prefix = first.getUTCDay();
  const checked = new Set(checkedDates || []);
  return Array.from({ length: prefix + days }, (_, index) => index < prefix
    ? { key: `blank-${index}`, blank: true }
    : {
      key: `${month}-${String(index - prefix + 1).padStart(2, '0')}`,
      day: index - prefix + 1,
      checked: checked.has(`${month}-${String(index - prefix + 1).padStart(2, '0')}`)
    });
}

Page({
  data: {
    ...buildThemeData(), topInset: 44, loading: true, failed: false,
    month: monthNow(), weekLabels: ['日','一','二','三','四','五','六'],
    calendarCells: [], wallet: {}, checkins: { dailyCheckinReward: 5 }, ledger: [], badges: []
  },
  onLoad() {
    syncPageTheme(this);
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ topInset: info.statusBarHeight || 44 });
    void this.load();
  },
  onShow() { syncPageTheme(this); },
  onShareAppMessage(event) {
    const playerId = String(event?.target?.dataset?.playerId || '').trim();
    const label = String(event?.target?.dataset?.label || '粉丝称号').trim();
    const match = /^(ATP|WTA):(.+)$/u.exec(playerId);
    return {
      title: `我获得了「${label}」`,
      path: match
        ? `/packages/player/pages/player-detail/index?tour=${encodeURIComponent(match[1])}&playerId=${encodeURIComponent(match[2])}`
        : '/pages/account/index'
    };
  },
  onPullDownRefresh() { void this.load().finally(() => wx.stopPullDownRefresh()); },
  back() { wx.navigateBack(); },
  previousMonth() { this.setData({ month: monthShift(this.data.month, -1) }, () => void this.loadCalendar()); },
  nextMonth() { this.setData({ month: monthShift(this.data.month, 1) }, () => void this.loadCalendar()); },
  today() { this.setData({ month: monthNow() }, () => void this.loadCalendar()); },
  async load() {
    this.setData({ loading: true, failed: false });
    try {
      const [bootstrap, calendar] = await Promise.all([
        getApp().services.social.bootstrap(),
        getApp().services.social.checkinCalendar(this.data.month)
      ]);
      this.setData({
        loading: false,
        wallet: bootstrap.wallet || {},
        checkins: bootstrap.checkins || {},
        calendarCells: calendarCells(this.data.month, calendar.calendar?.checkedDates),
        ledger: (bootstrap.recentLedger?.entries || []).map(item => ({
          ...item, dateLabel: item.occurredDate || ''
        })),
        badges: bootstrap.badges || []
      });
    } catch { this.setData({ loading: false, failed: true }); }
  },
  async loadCalendar() {
    try {
      const value = await getApp().services.social.checkinCalendar(this.data.month);
      this.setData({ calendarCells: calendarCells(this.data.month, value.calendar?.checkedDates) });
    } catch { wx.showToast({ title: '日历暂未更新', icon: 'none' }); }
  },
  async checkin() {
    try {
      const value = await getApp().services.social.checkin();
      const reward = Number(value.reward) > 0
        ? Number(value.reward) : Number(this.data.checkins.dailyCheckinReward) || 5;
      wx.showToast({
        title: value.alreadyCheckedIn ? '今天已经签过啦' : `签到成功，花朵 +${reward}`,
        icon: 'none'
      });
      if (value.alreadyCheckedIn) return;
      const ledgerEntry = value.ledgerEntry
        ? { ...value.ledgerEntry, dateLabel: value.ledgerEntry.occurredDate || '' }
        : null;
      this.setData({
        wallet: {
          ...this.data.wallet,
          balance: value.balance,
          lifetimeEarned: Number(this.data.wallet.lifetimeEarned || 0) + reward
        },
        checkins: value.summary || this.data.checkins,
        ledger: ledgerEntry
          ? [ledgerEntry, ...this.data.ledger].slice(0, 5) : this.data.ledger,
        calendarCells: this.data.calendarCells.map(cell =>
          cell.key === ledgerEntry?.dateLabel ? { ...cell, checked: true } : cell)
      });
    } catch { /* profile gate owns cancellation */ }
  },
  async toggleBadge(event) {
    const playerId = event.currentTarget.dataset.playerId;
    const equipped = event.currentTarget.dataset.equipped === true;
    try {
      await (equipped ? getApp().services.social.unequipBadge()
        : getApp().services.social.equipBadge(playerId));
      await this.load();
    } catch { wx.showToast({ title: '勋章状态暂未保存', icon: 'none' }); }
  },
  openLedger() {
    wx.navigateTo({ url: '/pages/flower-ledger/index' });
  }
});
