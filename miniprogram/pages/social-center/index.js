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
    calendarCells: [], wallet: {}, checkins: {}, ledger: [], badges: []
  },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ topInset: info.statusBarHeight || 44 });
    void this.load();
  },
  onShow() { syncPageTheme(this); },
  onPullDownRefresh() { void this.load().finally(() => wx.stopPullDownRefresh()); },
  back() { wx.navigateBack(); },
  previousMonth() { this.setData({ month: monthShift(this.data.month, -1) }, () => void this.loadCalendar()); },
  nextMonth() { this.setData({ month: monthShift(this.data.month, 1) }, () => void this.loadCalendar()); },
  today() { this.setData({ month: monthNow() }, () => void this.loadCalendar()); },
  async load() {
    this.setData({ loading: true, failed: false });
    try {
      const [bootstrap, calendar, ledger, badgeResult] = await Promise.all([
        getApp().services.social.bootstrap(),
        getApp().services.social.checkinCalendar(this.data.month),
        getApp().services.social.ledger({ limit: 5, offset: 0 }),
        getApp().services.social.badges()
      ]);
      this.setData({
        loading: false,
        wallet: bootstrap.wallet || {},
        checkins: bootstrap.checkins || {},
        calendarCells: calendarCells(this.data.month, calendar.calendar?.checkedDates),
        ledger: (ledger.ledger?.entries || []).map(item => ({
          ...item, dateLabel: String(item.occurredAt || '').slice(0, 10)
        })),
        badges: badgeResult.badges || []
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
      wx.showToast({ title: value.alreadyCheckedIn ? '今天已经签过啦' : '签到成功，花朵 +1', icon: 'none' });
      await this.load();
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
