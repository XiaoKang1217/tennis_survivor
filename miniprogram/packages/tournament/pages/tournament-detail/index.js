'use strict';

const { buildThemeData, syncPageTheme } = require('../../../../core/theme');
const { createSWRCache } = require('../../../../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../../../../core/projection-resource');

const { enablePageShare, tournamentShare } = require('../../../../core/share');
const { goBackOrHome } = require('../../../../core/back-navigation');
const {
  noticeState,
  tournamentDetailView
} = require('../../../../core/tournament-detail-view');
const { tournamentDrawFacts } = require('../../../../core/draw-view');

const TOURNAMENT_CACHE_SCHEMA = 'tournament-context-bff/1';
const DRAW_FACTS_CACHE_SCHEMA = 'tournament-draw-facts-bff/1';
function tournamentCacheKey(tournamentEditionId) { return 'tournament:' + tournamentEditionId; }
function drawFactsCacheKey(tournamentEditionId, tour = '') {
  return 'tournament_draw_facts:' + tournamentEditionId + (tour ? ':' + tour : '');
}

function normalizeDrawTour(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'atp' || normalized === 'wta' ? normalized : '';
}

function projection(value, expectedTournamentEditionId) {
  if (value?.bffContractVersion !== 'tournament-context-bff/1'
    || !value.presentation || !value.delivery) {
    throw new Error('tournament_detail_projection_invalid');
  }
  const view = tournamentDetailView(value.presentation);
  if (view.tournamentEditionId !== expectedTournamentEditionId) {
    throw new Error('tournament_detail_identity_conflict');
  }
  return { value, view };
}

function fieldValue(fields, label) {
  const field = (Array.isArray(fields) ? fields : [])
    .find(item => item.label === label && item.available);
  return field?.value || '';
}

function tournamentFollowSnapshot(detail) {
  if (!detail) return null;
  const authority = fieldValue(detail.classification, '赛事体系');
  return {
    title: detail.name || '',
    location: [
      fieldValue(detail.location, '城市'),
      fieldValue(detail.location, '国家或地区')
    ].filter(Boolean).join(' · '),
    level: fieldValue(detail.classification, '赛事级别'),
    surface: fieldValue(detail.location, '场地'),
    startsOn: fieldValue(detail.dates, '开始日期'),
    endsOn: fieldValue(detail.dates, '结束日期'),
    tourOrgs: authority ? String(authority).split('/').filter(Boolean) : [],
    calendarEventIds: [detail.tournamentEditionId].filter(Boolean),
    lifecycle: detail.lifecycle?.value || ''
  };
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    tournamentEditionId: '',
    requestTour: '',
    titleHint: '',
    requestedDrawStage: '',
    loading: true,
    failed: false,
    failureMessage: '',
    refreshFailed: false,
    detailLoaded: false,
    detail: null,
    drawFactsLoading: false,
    drawFactsUnavailable: false,
    awardGroups: [],
    drawIncidents: [],
    deliveryState: '',
    deliveryMessage: '',
    dataAsOf: '',
  },

  onLoad(options) {
    syncPageTheme(this);
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.http = getApp().services.http;
    this.cache = createSWRCache(wx);
    this.setData({
      topInset: info.statusBarHeight || 44,
      tournamentEditionId: options.tournamentEditionId || '',
      requestTour: normalizeDrawTour(options.tour),
      requestedDrawStage: String(options.stage || ''),
      titleHint: options.title || ''
    });
    void this.load();
  },
  onShow() {
    syncPageTheme(this);
    enablePageShare();
  },

  onShareAppMessage() {
    return tournamentShare(this.data.detail, {
      tournamentEditionId: this.data.tournamentEditionId,
      title: this.data.titleHint,
      tour: this.data.requestTour
    }).appMessage;
  },

  onShareTimeline() {
    return tournamentShare(this.data.detail, {
      tournamentEditionId: this.data.tournamentEditionId,
      title: this.data.titleHint,
      tour: this.data.requestTour
    }).timeline;
  },

  onPullDownRefresh() {
    void this.load().finally(() => wx.stopPullDownRefresh());
  },

  back() { goBackOrHome(); },

  async toggleTournamentFollow() {
    const detail = this.data.detail;
    if (!detail?.followTargetId) return;
    const next = !detail.followed;
    this.setData({ detail: { ...detail, followed: next } });
    try {
      await getApp().services.follow.setFollow(
        'tournament',
        detail.followTargetId,
        next,
        'tournament_detail',
        tournamentFollowSnapshot(detail)
      );
    } catch (err) {
      this.setData({ detail });
      if (String(err?.message || '') !== 'follow_login_cancelled') {
        wx.showToast({ title: '关注状态暂未保存', icon: 'none' });
      }
    }
  },

  async load() {
    const tournamentEditionId = this.data.tournamentEditionId;
    if (!tournamentEditionId) {
      this.setData({ loading: false, failed: true, failureMessage: '赛事身份缺失，无法读取赛事资料' });
      return;
    }
    const cache = this.cache || createSWRCache(typeof wx === 'undefined' ? null : wx);
    const cacheKey = tournamentCacheKey(tournamentEditionId);
    const cached = readTrustedProjection(cache, cacheKey, TOURNAMENT_CACHE_SCHEMA);
    if (cached?.payload) this.applyTournamentResponse(cached.payload, { fromCache: true });
    else this.setData({ loading: true, failed: false, failureMessage: '', refreshFailed: false });
    try {
      const result = await loadProjectionResource({
        http: this.http,
        cache,
        resourceKey: cacheKey,
        schemaVersion: TOURNAMENT_CACHE_SCHEMA,
        path: `/api/v1/bff/tournaments/${encodeURIComponent(tournamentEditionId)}`,
        requestOptions: {
          authMode: 'none',
          header: { 'x-luwang-client-contract-version': 'tournament-context-bff/1' }
        },
        metadata: {
          dataAsOf: value => value?.dataAsOf || value?.delivery?.dataAsOf || ''
        },
        validate: value => projection(value, tournamentEditionId).value
      });
      this.applyTournamentResponse(result.value, { fromCache: false });
      await this.loadDrawFacts(tournamentEditionId);
    } catch {
      if (cached?.payload || this.data.detailLoaded) {
        this.setData({
          loading: false,
          failed: false,
          refreshFailed: true,
          deliveryState: 'stale',
          deliveryMessage: '刷新暂未成功，已保留上次赛事资料'
        });
        await this.loadDrawFacts(tournamentEditionId);
        return;
      }
      this.setData({ loading: false, failed: true, failureMessage: '赛事资料暂不可用，请稍后重试' });
    }
  },

  applyTournamentResponse(response, options = {}) {
    const result = projection(response, this.data.tournamentEditionId);
    this.setData({
      loading: false,
      failed: false,
      refreshFailed: false,
      detailLoaded: true,
      detail: result.view,
      deliveryState: options.fromCache ? 'stale' : noticeState(result.value.delivery.state),
      deliveryMessage: options.fromCache
        ? '已显示上次赛事资料，正在刷新'
        : result.value.delivery.message || result.view.dataStatus.notice || '',
      dataAsOf: result.value.delivery.dataAsOf
        || result.value.dataAsOf || result.view.dataStatus.dataAsOf
    }, () => {
    });
  },

  applyDrawFacts(value) {
    if (value?.bffContractVersion !== 'draw-player-entry-bff/1'
      || value.tournamentEditionId !== this.data.tournamentEditionId
      || !Array.isArray(value.items)) {
      throw new Error('tournament_draw_facts_invalid');
    }
    const facts = tournamentDrawFacts(value.items);
    this.setData({
      drawFactsLoading: false,
      drawFactsUnavailable: false,
      awardGroups: facts.awardGroups,
      drawIncidents: facts.incidents
    });
  },

  async loadDrawFacts(tournamentEditionId) {
    const tour = this.data.requestTour;
    const cache = this.cache || createSWRCache(typeof wx === 'undefined' ? null : wx);
    const cacheKey = drawFactsCacheKey(tournamentEditionId, tour);
    const cached = readTrustedProjection(cache, cacheKey, DRAW_FACTS_CACHE_SCHEMA);
    if (cached?.payload) this.applyDrawFacts(cached.payload);
    else this.setData({ drawFactsLoading: true, drawFactsUnavailable: false });
    try {
      const result = await loadProjectionResource({
        http: this.http,
        cache,
        resourceKey: cacheKey,
        schemaVersion: DRAW_FACTS_CACHE_SCHEMA,
        path: `/api/v1/bff/draws?tournamentEditionId=${encodeURIComponent(tournamentEditionId)}&includeDefault=1`
          + (tour ? `&tour=${encodeURIComponent(tour)}` : ''),
        requestOptions: {
          authMode: 'none',
          header: {
            'x-luwang-client-contract-version': 'draw-player-entry-bff/1'
          }
        }
      });
      this.applyDrawFacts(result.value);
    } catch {
      if (cached?.payload) {
        this.setData({
          drawFactsLoading: false,
          drawFactsUnavailable: false
        });
        return;
      }
      this.setData({
        drawFactsLoading: false,
        drawFactsUnavailable: true
      });
    }
  },

  openDraws() {
    if (!this.data.tournamentEditionId) return;
    const detailName = this.data.detail?.name;
    const title = detailName?.available
      ? detailName.value : this.data.titleHint;
    wx.navigateTo({
      url: '/pages/draws/index?tournamentEditionId='
        + encodeURIComponent(this.data.tournamentEditionId)
        + `&title=${encodeURIComponent(title || '')}`
        + (this.data.requestedDrawStage ? `&stage=${encodeURIComponent(this.data.requestedDrawStage)}` : '')
        + (this.data.requestTour ? `&tour=${encodeURIComponent(this.data.requestTour)}` : '')
    });
  }
});

module.exports = Object.freeze({ projection });
