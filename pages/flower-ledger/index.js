'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');

const PAGE_SIZE = 20;
const DIRECTIONS = Object.freeze([
  { id: 'all', label: '全部' },
  { id: 'income', label: '收入' },
  { id: 'expense', label: '支出' }
]);

function shanghaiDate() {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function occurredLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const shanghai = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const part = number => String(number).padStart(2, '0');
  return `${shanghai.getUTCFullYear()}-${part(shanghai.getUTCMonth() + 1)}-${part(shanghai.getUTCDate())}`
    + ` ${part(shanghai.getUTCHours())}:${part(shanghai.getUTCMinutes())}`;
}

function entriesView(entries) {
  return (Array.isArray(entries) ? entries : []).map(item => Object.freeze({
    ...item,
    occurredLabel: occurredLabel(item.occurredAt)
  }));
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    directions: DIRECTIONS,
    selectedDirection: 'all',
    fromDate: '',
    toDate: '',
    today: shanghaiDate(),
    entries: [],
    offset: 0,
    pageNumber: 1,
    hasPrevious: false,
    hasNext: false,
    nextOffset: null,
    loading: true,
    failed: false
  },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ topInset: info.statusBarHeight || 44 });
    void this.loadPage(0);
  },
  onShow() { syncPageTheme(this); },
  onPullDownRefresh() { void this.loadPage(this.data.offset).finally(() => wx.stopPullDownRefresh()); },
  back() { wx.navigateBack(); },
  selectDirection(event) {
    const direction = String(event.currentTarget.dataset.direction || 'all');
    if (!DIRECTIONS.some(item => item.id === direction) || direction === this.data.selectedDirection) return;
    this.setData({ selectedDirection: direction }, () => void this.loadPage(0));
  },
  chooseFromDate(event) {
    const fromDate = String(event.detail.value || '');
    const toDate = this.data.toDate && this.data.toDate < fromDate ? fromDate : this.data.toDate;
    this.setData({ fromDate, toDate }, () => void this.loadPage(0));
  },
  chooseToDate(event) {
    const toDate = String(event.detail.value || '');
    const fromDate = this.data.fromDate && this.data.fromDate > toDate ? toDate : this.data.fromDate;
    this.setData({ fromDate, toDate }, () => void this.loadPage(0));
  },
  clearDates() {
    if (!this.data.fromDate && !this.data.toDate) return;
    this.setData({ fromDate: '', toDate: '' }, () => void this.loadPage(0));
  },
  previousPage() {
    if (!this.data.hasPrevious || this.data.loading) return;
    void this.loadPage(Math.max(0, this.data.offset - PAGE_SIZE));
  },
  nextPage() {
    if (!this.data.hasNext || this.data.loading) return;
    void this.loadPage(this.data.nextOffset);
  },
  async loadPage(offset) {
    const safeOffset = Math.max(0, Number(offset) || 0);
    this.setData({ loading: true, failed: false });
    try {
      const value = await getApp().services.social.ledger({
        limit: PAGE_SIZE,
        offset: safeOffset,
        direction: this.data.selectedDirection,
        from: this.data.fromDate,
        to: this.data.toDate
      });
      const ledger = value.ledger || {};
      const nextOffset = Number.isFinite(Number(ledger.nextOffset))
        ? Number(ledger.nextOffset) : null;
      this.setData({
        loading: false,
        entries: entriesView(ledger.entries),
        offset: safeOffset,
        pageNumber: Math.floor(safeOffset / PAGE_SIZE) + 1,
        hasPrevious: safeOffset > 0,
        hasNext: nextOffset !== null,
        nextOffset
      });
    } catch {
      this.setData({ loading: false, failed: true, entries: [] });
    }
  }
});
