'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');
const { createSWRCache } = require('../../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../../core/projection-resource');
const { enablePageShare, playerShare } = require('../../core/share');
const { updatePageShareImages } = require('../../core/share-poster');

const PLAYER_PROFILE_CACHE_SCHEMA = 'player-profile-bff/2';
function playerProfileCacheKey(tour, playerId) {
  return `player_profile:${String(tour || '').toUpperCase()}:${playerId}`;
}

function display(candidate, fallback = '暂无') {
  if (!candidate || !['known', 'available'].includes(candidate.state)) return fallback;
  if (candidate.displayText) return candidate.displayText;
  if (candidate.value === null || candidate.value === undefined || candidate.value === '') {
    return fallback;
  }
  return typeof candidate.value === 'object' ? fallback : String(candidate.value);
}

function known(candidate) {
  return candidate && ['known', 'available'].includes(candidate.state) ? candidate.value : null;
}

function moneyDisplay(candidate) {
  const value = known(candidate);
  return value?.displayText || '暂无';
}

function optionValue(value, fallback = '') {
  const text = String(value || '');
  if (!text) return fallback;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function titleBadgeView(item) {
  const count = item?.count === null || item?.count === undefined || item?.count === ''
    ? null : Number.isSafeInteger(Number(item.count)) ? Number(item.count) : null;
  return {
    id: String(item?.id || ''),
    label: String(item?.labelZh || ''),
    assetPath: String(item?.assetPath || ''),
    emblemText: String(item?.emblemText || ''),
    count,
    countText: count && count > 0 ? String(count) : '',
    active: count !== null && count > 0,
    unknown: count === null || item?.status === 'unknown'
  };
}

function serveMetricView(metric) {
  const percent = Number(metric?.percent);
  return {
    id: String(metric?.id || ''),
    label: String(metric?.labelZh || ''),
    value: String(metric?.displayText || ''),
    barPercent: Number.isFinite(percent)
      ? Math.max(0, Math.min(100, Math.round(percent))) : 0,
    hasBar: Number.isFinite(percent)
  };
}

function technicalMetricView(metric) {
  const percent = Number(metric?.percent);
  return {
    id: String(metric?.id || ''),
    label: String(metric?.labelZh || ''),
    value: String(metric?.displayText ?? ''),
    rawValue: metric?.value === null || metric?.value === undefined ? '' : String(metric.value),
    rawCount: metric?.count === null || metric?.count === undefined ? '' : String(metric.count),
    barPercent: Number.isFinite(percent)
      ? Math.max(0, Math.min(100, Math.round(percent))) : 0,
    hasBar: Number.isFinite(percent)
  };
}

function technicalGroupView(group) {
  return {
    id: String(group?.id || ''),
    label: String(group?.labelZh || ''),
    metrics: Array.isArray(group?.metrics)
      ? group.metrics.map(technicalMetricView).filter(item => item.id && item.label)
      : []
  };
}

function recordView(record) {
  return {
    id: String(record?.id || ''),
    label: String(record?.labelZh || ''),
    winLoss: String(record?.winLoss || '')
  };
}

function recentEventView(event) {
  const levelLabel = String(event?.levelLabelZh || event?.levelLabel || '');
  const surfaceLabel = String(event?.surfaceLabelZh || event?.surfaceLabel || '');
  const resultTone = event?.resultTone === 'loss'
    ? 'loss'
    : event?.resultTone === 'win' ? 'win' : '';
  return {
    tournamentName: String(event?.tournamentName || '赛事待更新'),
    resultLabel: String(event?.resultLabelZh || ''),
    summary: String(event?.summaryZh || ''),
    dateText: String(event?.dateText || ''),
    levelLabel,
    surfaceLabel,
    metaText: [levelLabel, surfaceLabel].filter(Boolean).join(' · '),
    resultTone
  };
}

function recentEventScoreKey(item) {
  const match = /((?:\d+\s*-\s*\d+(?:\([^)]+\))?|\d+\s*:\s*\d+|w\/o|ret\.?)(?:\s+(?:\d+\s*-\s*\d+(?:\([^)]+\))?|\d+\s*:\s*\d+|w\/o|ret\.?))*)$/i
    .exec(String(item?.summary || ''));
  return String(match ? match[1] : '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function recentEventIdentity(item) {
  const date = String(item?.dateText || '').trim();
  const result = String(item?.resultLabel || '').trim();
  const summary = String(item?.summary || '').trim().toLowerCase();
  if (date && result && summary) return [date, result, summary].join('|');
  const score = recentEventScoreKey(item);
  if (date && result && score) return [date, result, score].join('|');
  return [
    String(item?.tournamentName || '').trim().toLowerCase(),
    date,
    summary
  ].join('|');
}

function recentEventQuality(item) {
  return ['tournamentName', 'metaText', 'resultLabel', 'summary', 'resultTone']
    .reduce((score, key) => score + (String(item?.[key] || '').trim() ? 1 : 0), 0);
}

function dedupeRecentEventViews(events) {
  const byKey = new Map();
  for (const item of Array.isArray(events) ? events : []) {
    const key = recentEventIdentity(item);
    const previous = byKey.get(key);
    if (!previous || recentEventQuality(item) > recentEventQuality(previous)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()].map((item, index) => ({
    ...item,
    key: `${recentEventIdentity(item)}-${index}`
  }));
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    tabs: [
      { id: 'basic', label: '基本简介' },
      { id: 'career', label: '生涯战绩' },
      { id: 'recent', label: '近期赛事' }
    ],
    activeTab: 'basic',
    playerId: '',
    name: '球员资料',
    originalName: '',
    countryCode: '',
    tour: 'ATP',
    position: '',
    points: '',
    loading: true,
    failed: false,
    profileAvailable: false,
    statsAvailable: false,
    deliveryState: '',
    deliveryMessage: '',
    dataAsOf: '',
    facts: [],
    career: null,
    season: null,
    titleBadges: [],
    levelRecords: [],
    surfaceRecords: [],
    serveMetrics: [],
    recentEvents: [],
    hasTitleBadges: false,
    hasLevelRecords: false,
    hasSurfaceRecords: false,
    hasServeMetrics: false,
    hasTechnicalGroups: false,
    hasRecentEvents: false,
    technicalGroups: [],
    portraitUrl: '',
    heroImageUrl: '',
    followTargetId: '',
    followed: false,
    shareCardImageUrl: '',
    shareTimelineImageUrl: ''
  },

  onLoad(options) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.http = getApp().services.http;
    this.cache = createSWRCache(wx);
    this.setData({
      topInset: info.statusBarHeight || 44,
      playerId: optionValue(options.playerId),
      name: optionValue(options.name, '球员资料'),
      originalName: optionValue(options.originalName),
      countryCode: optionValue(options.countryCode),
      tour: optionValue(options.tour) === 'WTA' ? 'WTA' : 'ATP',
      position: optionValue(options.position),
      points: optionValue(options.points),
      portraitUrl: optionValue(options.portraitUrl),
      heroImageUrl: optionValue(options.heroImageUrl)
    });
    void this.load();
  },
  onShow() {
    syncPageTheme(this);
    enablePageShare();
  },

  onShareAppMessage() {
    return playerShare(this.data).appMessage;
  },

  onShareTimeline() {
    return playerShare(this.data).timeline;
  },

  onPullDownRefresh() { void this.load().finally(() => wx.stopPullDownRefresh()); },
  back() { wx.navigateBack(); },
  async togglePlayerFollow() {
    const targetId = this.data.followTargetId || `${this.data.tour}:${this.data.playerId}`;
    const next = !this.data.followed;
    this.setData({ followed: next, followTargetId: targetId });
    try {
      await getApp().services.follow.setFollow('player', targetId, next, 'player_profile');
    } catch (err) {
      this.setData({ followed: !next });
      if (String(err?.message || '') !== 'follow_login_cancelled') {
        wx.showToast({ title: '关注状态暂未保存', icon: 'none' });
      }
    }
  },
  selectTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (['basic', 'career', 'recent'].includes(tab)) {
      this.setData({ activeTab: tab });
    }
  },

  async load() {
    if (!this.data.playerId) {
      this.setData({ loading: false, failed: true });
      return;
    }
    const id = encodeURIComponent(this.data.playerId);
    const tour = encodeURIComponent(this.data.tour);
    const cacheKey = playerProfileCacheKey(this.data.tour, this.data.playerId);
    const cached = readTrustedProjection(this.cache, cacheKey, PLAYER_PROFILE_CACHE_SCHEMA);
    if (cached?.payload) this.applyProfile(cached.payload, { fromCache: true });
    else this.setData({ loading: true, failed: false });
    let result;
    try {
      result = await loadProjectionResource({
        http: this.http,
        cache: this.cache,
        resourceKey: cacheKey,
        schemaVersion: PLAYER_PROFILE_CACHE_SCHEMA,
        path: `/api/v2/bff/players/${tour}/${id}`,
        requestOptions: {
          authMode: 'none',
          header: { 'x-luwang-client-contract-version': 'player-profile-bff/2' }
        },
        validate(value) {
          if (value?.bffContractVersion !== 'player-profile-bff/2') {
            throw new Error('player_profile_projection_invalid');
          }
          return value;
        }
      });
    } catch {
      this.setData({
        loading: false,
        failed: !cached?.payload,
        deliveryState: cached?.payload ? 'stale' : '',
        deliveryMessage: cached?.payload ? '刷新失败，继续显示本地可信球员资料' : ''
      });
      return;
    }
    this.applyProfile(result.value, { fromCache: false });
  },

  applyProfile(profile, options = {}) {
    const profileAvailable = profile?.bffContractVersion === 'player-profile-bff/2';
    if (profileAvailable) {
      const value = profile.display || {};
      const portrait = value.portrait?.value;
      const hero = value.heroImage?.value;
      const entry = profile.payload?.entry || {};
      const followState = value.viewerFollowState?.player
        || profile.payload?.viewerFollowState?.player
        || {};
      const performance = value.careerPerformance || {};
      const titleBadges = Array.isArray(performance.titleBadges)
        ? performance.titleBadges.map(titleBadgeView).filter(item => item.id && item.label)
        : [];
      const serveMetrics = Array.isArray(performance.serveStats?.metrics)
        ? performance.serveStats.metrics.map(serveMetricView).filter(item => item.id && item.label)
        : [];
      const technicalGroups = Array.isArray(performance.technicalStats?.groups)
        ? performance.technicalStats.groups.map(technicalGroupView)
          .filter(item => item.id && item.label && item.metrics.length)
        : [];
      const levelRecords = Array.isArray(performance.levelRecords)
        ? performance.levelRecords.map(recordView).filter(item => item.id && item.label && item.winLoss)
        : [];
      const surfaceRecords = Array.isArray(performance.surfaceRecords)
        ? performance.surfaceRecords.map(recordView).filter(item => item.id && item.label && item.winLoss)
        : [];
      const recentEvents = dedupeRecentEventViews(Array.isArray(performance.recentEvents)
        ? performance.recentEvents.map(recentEventView) : []);
      const nextName = display(value.displayName, this.data.name);
      const nextOriginalName = display(value.displayNameOriginal, this.data.originalName || '');
      this.setData({
        name: nextName,
        originalName: nextOriginalName && nextOriginalName !== nextName ? nextOriginalName : '',
        countryCode: display(value.countryCode, this.data.countryCode),
        followTargetId: followState.targetId || `${this.data.tour}:${this.data.playerId}`,
        followed: followState.followed === true,
        portraitUrl: portrait?.publicUrl || portrait?.url || this.data.portraitUrl,
        heroImageUrl: hero?.publicUrl || hero?.url || this.data.heroImageUrl,
        facts: [
          { label: '出生日期', value: display(value.birthDate) },
          { label: '身高', value: display(value.height) },
          { label: '体重', value: display(value.weight) },
          { label: '持拍', value: display(value.playingHand) },
          { label: '反拍', value: display(value.backhandStyle) },
          { label: '转职业', value: display(value.turnedProfessionalYear) },
          { label: '出生地', value: display(value.birthplaceDisplayName) },
          { label: '教练', value: display(value.coachDisplayName) }
        ],
        season: {
          rank: entry.officialRanking?.position || this.data.position || '—',
          winLoss: display(entry.season?.winLoss),
          titles: display(entry.season?.titles),
          prizeMoney: moneyDisplay(entry.season?.prizeMoney)
        },
        career: {
          winLoss: display(entry.career?.winLoss),
          titles: display(entry.career?.titles),
          bestRank: display(entry.career?.bestRank),
          bestRankDate: display(entry.career?.bestRankDate, ''),
          prizeMoney: moneyDisplay(entry.career?.prizeMoney)
        },
        titleBadges,
        levelRecords,
        surfaceRecords,
        serveMetrics,
        technicalGroups,
        recentEvents,
        hasTitleBadges: titleBadges.length > 0,
        hasLevelRecords: levelRecords.length > 0,
        hasSurfaceRecords: surfaceRecords.length > 0,
        hasServeMetrics: serveMetrics.length > 0,
        hasTechnicalGroups: technicalGroups.length > 0,
        hasRecentEvents: recentEvents.length > 0
      });
    }
    this.setData({
      loading: false,
      failed: !profileAvailable,
      profileAvailable,
      statsAvailable: profileAvailable,
      deliveryState: options.fromCache ? 'stale' : profileAvailable
        ? (profile.delivery?.state === 'current' ? 'live' : 'delayed') : '',
      deliveryMessage: options.fromCache
        ? '显示本地可信球员资料，正在后台更新'
        : profileAvailable ? '球员资料已更新' : '',
      dataAsOf: profile?.dataAsOf || ''
    }, () => {
      void updatePageShareImages(this, 'player', this.data);
    });
  }
});
