'use strict';

const { buildThemeData, syncPageTheme } = require('../../../../core/theme');
const { createSWRCache } = require('../../../../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../../../../core/projection-resource');
const { drawColumns } = require('../../../../core/draw-view');

const DRAW_BODY_SCHEMA = 'draw-body-projection/1';
const NODE_WIDTH = 248;
const COLUMN_GAP = 34;
const BOARD_PADDING_X = 38;
const BOARD_PADDING_BOTTOM = 70;

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

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function columnsView(presentation, selectedRoundId = '', playerQuery = '') {
  const query = String(playerQuery || '').trim().toLocaleLowerCase('zh-CN');
  const columns = drawColumns(presentation).map((column, index) => Object.freeze({
    ...column,
    viewId: `round-${index}`,
    selected: column.id === selectedRoundId,
    matches: Object.freeze(column.matches.map(match => {
      const names = [
        match.first,
        match.second,
        ...(match.firstMembers || []).map(member => member.name),
        ...(match.secondMembers || []).map(member => member.name)
      ].join(' ').toLocaleLowerCase('zh-CN');
      return Object.freeze({
        ...match,
        highlighted: Boolean(query) && names.includes(query)
      });
    }))
  }));
  const target = Math.max(0, columns.findIndex(column => column.id === selectedRoundId));
  const boardWidth = BOARD_PADDING_X * 2 + columns.length * NODE_WIDTH
    + Math.max(0, columns.length - 1) * COLUMN_GAP;
  const boardHeight = Math.max(540, ...columns.map(column => safeNumber(column.height)))
    + BOARD_PADDING_BOTTOM;
  return Object.freeze({
    columns: Object.freeze(columns),
    scrollIntoView: `round-${target < 0 ? 0 : target}`,
    boardWidth,
    boardHeight
  });
}

function toolbarMetrics(wxRuntime) {
  const info = wxRuntime.getWindowInfo ? wxRuntime.getWindowInfo() : wxRuntime.getSystemInfoSync();
  const menu = wxRuntime.getMenuButtonBoundingClientRect?.();
  const topInset = Math.max(0, safeNumber(info.statusBarHeight));
  const rightInset = menu && info.windowWidth
    ? Math.max(14, safeNumber(info.windowWidth) - safeNumber(menu.left) + 10)
    : 14;
  return Object.freeze({
    topInset,
    toolbarStyle: `padding-top:${topInset}px;padding-right:${rightInset}px;`
  });
}

function minimapViewportStyle(scrollLeft, scrollTop, data) {
  const boardWidth = Math.max(1, safeNumber(data.boardWidth) * safeNumber(data.scale, 1));
  const boardHeight = Math.max(1, safeNumber(data.boardHeight) * safeNumber(data.scale, 1));
  const viewportWidth = 620;
  const viewportHeight = 320;
  const width = Math.max(18, Math.min(86, viewportWidth / boardWidth * 100));
  const height = Math.max(20, Math.min(86, viewportHeight / boardHeight * 100));
  const left = Math.max(0, Math.min(100 - width, safeNumber(scrollLeft) / boardWidth * 100));
  const top = Math.max(0, Math.min(100 - height, safeNumber(scrollTop) / boardHeight * 100));
  return `left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;width:${width.toFixed(1)}%;height:${height.toFixed(1)}%;`;
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 0,
    toolbarStyle: '',
    loading: true,
    failed: false,
    drawId: '',
    tournamentEditionId: '',
    title: '',
    drawLabel: '',
    selectedRoundId: '',
    columns: [],
    scrollIntoView: '',
    scale: .9,
    boardScaleStyle: 'transform:scale(.9);transform-origin:0 0;',
    overview: false,
    playerQuery: '',
    boardWidth: 0,
    boardHeight: 0,
    minimapViewportStyle: 'left:0;top:0;width:40%;height:40%;'
  },

  onLoad(options = {}) {
    const metrics = toolbarMetrics(wx);
    this.http = getApp().services.http;
    this.cache = createSWRCache(wx);
    this.currentPresentation = null;
    this.lastScroll = { scrollLeft: 0, scrollTop: 0 };
    this.setData({
      topInset: metrics.topInset,
      toolbarStyle: metrics.toolbarStyle,
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
    this.currentPresentation = value.presentation;
    const board = columnsView(value.presentation, this.data.selectedRoundId, this.data.playerQuery);
    this.setData({
      loading: false,
      failed: false,
      columns: board.columns,
      scrollIntoView: board.scrollIntoView,
      boardWidth: board.boardWidth,
      boardHeight: board.boardHeight,
      minimapViewportStyle: minimapViewportStyle(
        this.lastScroll.scrollLeft,
        this.lastScroll.scrollTop,
        { ...this.data, ...board }
      )
    });
  },

  exitLandscape() { wx.navigateBack(); },
  jumpCurrentRound() {
    if (this.data.scrollIntoView) this.setData({ scrollIntoView: this.data.scrollIntoView });
  },
  showOverview() { this.setScale(.58, true); },
  readableSize() { this.setScale(1, false); },
  zoomIn() { this.setScale(Math.min(1.08, this.data.scale + .08), false); },
  zoomOut() { this.setScale(Math.max(.58, this.data.scale - .08), this.data.scale - .08 <= .58); },
  setScale(scale, overview) {
    const rounded = Math.round(scale * 100) / 100;
    const nextData = { ...this.data, scale: rounded };
    this.setData({
      scale: rounded,
      overview,
      boardScaleStyle: `transform:scale(${rounded});transform-origin:0 0;`,
      minimapViewportStyle: minimapViewportStyle(
        this.lastScroll.scrollLeft,
        this.lastScroll.scrollTop,
        nextData
      )
    });
  },

  updatePlayerQuery(event) {
    const playerQuery = event.detail.value || '';
    if (!this.currentPresentation) {
      this.setData({ playerQuery });
      return;
    }
    const board = columnsView(this.currentPresentation, this.data.selectedRoundId, playerQuery);
    const highlightedColumn = board.columns.find(column =>
      column.matches.some(match => match.highlighted));
    this.setData({
      playerQuery,
      columns: board.columns,
      scrollIntoView: highlightedColumn?.viewId || this.data.scrollIntoView
    });
  },

  onBoardScroll(event) {
    this.lastScroll = {
      scrollLeft: safeNumber(event.detail?.scrollLeft),
      scrollTop: safeNumber(event.detail?.scrollTop)
    };
    this.setData({
      minimapViewportStyle: minimapViewportStyle(
        this.lastScroll.scrollLeft,
        this.lastScroll.scrollTop,
        this.data
      )
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
