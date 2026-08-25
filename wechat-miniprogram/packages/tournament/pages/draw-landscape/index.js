'use strict';

const { buildThemeData, syncPageTheme } = require('../../../../core/theme');
const { createSWRCache } = require('../../../../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../../../../core/projection-resource');
const { drawColumns } = require('../../../../core/draw-view');

const DRAW_BODY_SCHEMA = 'draw-body-projection/1';
const NODE_WIDTH = 456;
const COLUMN_GAP = 72;
const BOARD_PADDING_X = 36;
const BOARD_PADDING_BOTTOM = 96;

function drawBodyCacheKey(drawId) { return 'draw_body:' + drawId; }
function landscapeStateKey(drawId) { return 'draw_landscape_state:' + drawId; }

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

function memberMatchesQuery(member, query) {
  if (!query) return false;
  return String(member?.name || '').toLocaleLowerCase('zh-CN').includes(query);
}

function matchMemberIds(match, query) {
  const ids = [];
  for (const member of [...(match.firstMembers || []), ...(match.secondMembers || [])]) {
    if (memberMatchesQuery(member, query)) ids.push(member.id || member.name);
  }
  return ids;
}

function matchIncludesFocusedMember(match, focusedIds) {
  if (!focusedIds.size) return false;
  return [...(match.firstMembers || []), ...(match.secondMembers || [])]
    .some(member => focusedIds.has(member.id || member.name));
}

function matchNames(match) {
  return [
    match.first,
    match.second,
    ...(match.firstMembers || []).map(member => member.name),
    ...(match.secondMembers || []).map(member => member.name)
  ].join(' ').toLocaleLowerCase('zh-CN');
}

function columnsView(presentation, selectedRoundId = '', playerQuery = '') {
  const query = String(playerQuery || '').trim().toLocaleLowerCase('zh-CN');
  const sourceColumns = drawColumns(presentation);
  const focusedIds = new Set();
  for (const column of sourceColumns) {
    for (const match of column.matches) {
      for (const id of matchMemberIds(match, query)) focusedIds.add(id);
    }
  }
  let highlightedMatchId = '';
  const columns = sourceColumns.map((column, index) => Object.freeze({
    ...column,
    viewId: `round-${index}`,
    selected: column.id === selectedRoundId,
    matches: Object.freeze(column.matches.map((match, matchIndex) => {
      const viewId = `match-${index}-${matchIndex}`;
      const highlighted = Boolean(query)
        && (matchIncludesFocusedMember(match, focusedIds) || matchNames(match).includes(query));
      if (highlighted && !highlightedMatchId) highlightedMatchId = viewId;
      return Object.freeze({
        ...match,
        viewId,
        highlighted
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
    scrollIntoView: highlightedMatchId || `round-${target < 0 ? 0 : target}`,
    boardWidth,
    boardHeight
  });
}

function toolbarMetrics(wxRuntime) {
  const info = wxRuntime.getWindowInfo ? wxRuntime.getWindowInfo() : wxRuntime.getSystemInfoSync();
  const menu = wxRuntime.getMenuButtonBoundingClientRect?.();
  const topInset = Math.max(0, safeNumber(info.statusBarHeight));
  const windowWidth = Math.max(1, safeNumber(info.windowWidth, 375));
  const windowHeight = Math.max(1, safeNumber(info.windowHeight, 667));
  const rpxPerPx = 750 / windowWidth;
  const rightInset = menu && info.windowWidth
    ? Math.max(14, safeNumber(info.windowWidth) - safeNumber(menu.left) + 10)
    : 14;
  return Object.freeze({
    topInset,
    toolbarStyle: `padding-top:${topInset}px;padding-right:${rightInset}px;`,
    viewportWidth: 750,
    viewportHeight: Math.max(300, Math.round((windowHeight - topInset - 78) * rpxPerPx))
  });
}

function minimapViewportStyle(scrollLeft, scrollTop, data) {
  const boardWidth = Math.max(1, safeNumber(data.boardWidth) * safeNumber(data.scale, 1));
  const boardHeight = Math.max(1, safeNumber(data.boardHeight) * safeNumber(data.scale, 1));
  const viewportWidth = Math.max(1, safeNumber(data.viewportWidth, 750));
  const viewportHeight = Math.max(1, safeNumber(data.viewportHeight, 360));
  const width = Math.max(18, Math.min(86, viewportWidth / boardWidth * 100));
  const height = Math.max(20, Math.min(86, viewportHeight / boardHeight * 100));
  const left = Math.max(0, Math.min(100 - width, safeNumber(scrollLeft) / boardWidth * 100));
  const top = Math.max(0, Math.min(100 - height, safeNumber(scrollTop) / boardHeight * 100));
  return `left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;width:${width.toFixed(1)}%;height:${height.toFixed(1)}%;`;
}

function readStoredState(wxRuntime, drawId) {
  if (!drawId) return null;
  try {
    const value = wxRuntime.getStorageSync(landscapeStateKey(drawId));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
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
    scrollLeft: 0,
    scrollTop: 0,
    scale: 1,
    boardScaleStyle: 'transform:scale(1);transform-origin:0 0;',
    overview: false,
    playerQuery: '',
    boardWidth: 0,
    boardHeight: 0,
    viewportWidth: 750,
    viewportHeight: 360,
    minimapViewportStyle: 'left:0;top:0;width:40%;height:40%;'
  },

  onLoad(options = {}) {
    const metrics = toolbarMetrics(wx);
    this.http = getApp().services.http;
    this.cache = createSWRCache(wx);
    this.currentPresentation = null;
    const drawId = optionValue(options.drawId);
    const restored = readStoredState(wx, drawId) || {};
    this.lastScroll = {
      scrollLeft: safeNumber(restored.scrollLeft),
      scrollTop: safeNumber(restored.scrollTop)
    };
    const scale = Math.max(.46, Math.min(1.12, safeNumber(restored.scale, 1)));
    this.setData({
      topInset: metrics.topInset,
      toolbarStyle: metrics.toolbarStyle,
      viewportWidth: metrics.viewportWidth,
      viewportHeight: metrics.viewportHeight,
      drawId,
      tournamentEditionId: optionValue(options.tournamentEditionId),
      title: optionValue(options.title, '赛事签表'),
      drawLabel: optionValue(options.drawLabel),
      selectedRoundId: optionValue(restored.selectedRoundId, optionValue(options.roundId)),
      playerQuery: optionValue(restored.playerQuery),
      scale,
      overview: Boolean(restored.overview),
      scrollLeft: this.lastScroll.scrollLeft,
      scrollTop: this.lastScroll.scrollTop,
      boardScaleStyle: `transform:scale(${scale});transform-origin:0 0;`
    }, () => void this.loadDraw());
  },

  onShow() { syncPageTheme(this); },
  onUnload() { this.saveState(); },

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
    const board = columnsView(this.currentPresentation, this.data.selectedRoundId, '');
    this.setData({ scrollIntoView: '' }, () => {
      this.setData({ scrollIntoView: board.scrollIntoView, overview: false });
    });
  },
  showOverview() {
    const fitWidth = this.data.viewportWidth / Math.max(1, this.data.boardWidth);
    const fitHeight = this.data.viewportHeight / Math.max(1, this.data.boardHeight);
    this.setScale(Math.max(.34, Math.min(.64, fitWidth, fitHeight)), true);
  },
  readableSize() { this.setScale(1, false); },
  zoomIn() { this.setScale(Math.min(1.12, this.data.scale + .08), false); },
  zoomOut() { this.setScale(Math.max(.46, this.data.scale - .08), this.data.scale - .08 <= .52); },
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
    this.setData({
      playerQuery,
      columns: board.columns,
      scrollIntoView: board.scrollIntoView || this.data.scrollIntoView,
      boardWidth: board.boardWidth,
      boardHeight: board.boardHeight,
      minimapViewportStyle: minimapViewportStyle(
        this.lastScroll.scrollLeft,
        this.lastScroll.scrollTop,
        { ...this.data, ...board }
      )
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

  saveState() {
    if (!this.data.drawId) return;
    try {
      wx.setStorageSync(landscapeStateKey(this.data.drawId), {
        selectedRoundId: this.data.selectedRoundId,
        playerQuery: this.data.playerQuery,
        scale: this.data.scale,
        overview: this.data.overview,
        scrollLeft: this.lastScroll.scrollLeft,
        scrollTop: this.lastScroll.scrollTop
      });
    } catch {}
  },

  openMatch(event) {
    const matchId = event.currentTarget.dataset.matchId;
    if (!matchId) return;
    wx.navigateTo({
      url: `/pages/match-detail/index?matchId=${encodeURIComponent(matchId)}`
    });
  }
});
