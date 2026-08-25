'use strict';

const { buildThemeData, syncPageTheme } = require('../../../../core/theme');
const { createSWRCache } = require('../../../../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../../../../core/projection-resource');
const { drawColumns } = require('../../../../core/draw-view');

const DRAW_BODY_SCHEMA = 'draw-body-projection/1';

function drawBodyCacheKey(drawId) { return 'draw_body:' + drawId; }

function optionValue(value, fallback = '') {
  const text = String(value || '');
  if (!text) return fallback;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function columnsView(presentation, selectedRoundId = '') {
  const columns = drawColumns(presentation).map((column, index) => Object.freeze({
    ...column,
    viewId: `round-${index}`,
    selected: column.id === selectedRoundId
  }));
  const target = Math.max(0, columns.findIndex(column => column.id === selectedRoundId));
  return Object.freeze({
    columns: Object.freeze(columns),
    scrollIntoView: `round-${target < 0 ? 0 : target}`
  });
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 0,
    loading: true,
    failed: false,
    drawId: '',
    tournamentEditionId: '',
    title: '',
    drawLabel: '',
    selectedRoundId: '',
    columns: [],
    scrollIntoView: '',
    scale: 1,
    boardScaleStyle: 'transform:scale(1);transform-origin:0 0;',
    overview: false
  },

  onLoad(options = {}) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.http = getApp().services.http;
    this.cache = createSWRCache(wx);
    this.setData({
      topInset: info.statusBarHeight || 0,
      drawId: optionValue(options.drawId),
      tournamentEditionId: optionValue(options.tournamentEditionId),
      title: optionValue(options.title, '赛事签表'),
      drawLabel: optionValue(options.drawLabel),
      selectedRoundId: optionValue(options.roundId)
    }, () => void this.loadDraw());
  },

  onShow() { syncPageTheme(this); },

  async loadDraw() {
    if (!this.data.drawId) {
      this.setData({ loading: false, failed: true });
      return;
    }
    const cacheKey = drawBodyCacheKey(this.data.drawId);
    const cached = readTrustedProjection(this.cache, cacheKey, DRAW_BODY_SCHEMA);
    if (cached?.payload) this.applyDrawProjection(cached.payload, { fromCache: true });
    else this.setData({ loading: true, failed: false });
    try {
      const result = await loadProjectionResource({
        http: this.http,
        cache: this.cache,
        resourceKey: cacheKey,
        schemaVersion: DRAW_BODY_SCHEMA,
        path: '/api/v1/bff/draws/' + encodeURIComponent(this.data.drawId),
        requestOptions: {
          authMode: 'none',
          header: { 'x-luwang-client-contract-version': 'draw-player-entry-bff/1' }
        },
        validate(value) {
          if (value?.bffContractVersion !== 'draw-player-entry-bff/1'
            || !Array.isArray(value.presentation?.rounds)) {
            throw new Error('draw_projection_invalid');
          }
          return value;
        }
      });
      this.applyDrawProjection(result.value);
    } catch {
      this.setData({ loading: false, failed: !cached?.payload });
    }
  },

  applyDrawProjection(value) {
    const board = columnsView(value.presentation, this.data.selectedRoundId);
    this.setData({
      loading: false,
      failed: false,
      columns: board.columns,
      scrollIntoView: board.scrollIntoView
    });
  },

  exitLandscape() { wx.navigateBack(); },
  jumpCurrentRound() {
    if (this.data.scrollIntoView) this.setData({ scrollIntoView: this.data.scrollIntoView });
  },
  showOverview() { this.setScale(.72, true); },
  readableSize() { this.setScale(1, false); },
  zoomIn() { this.setScale(Math.min(1.18, this.data.scale + .08), false); },
  zoomOut() { this.setScale(Math.max(.72, this.data.scale - .08), this.data.scale - .08 <= .72); },
  setScale(scale, overview) {
    const rounded = Math.round(scale * 100) / 100;
    this.setData({
      scale: rounded,
      overview,
      boardScaleStyle: `transform:scale(${rounded});transform-origin:0 0;`
    });
  },

  openMatch(event) {
    const matchId = event.currentTarget.dataset.matchId;
    if (!matchId) return;
    wx.navigateTo({
      url: `/pages/match-detail/index?matchId=${encodeURIComponent(matchId)}`
    });
  }
});
