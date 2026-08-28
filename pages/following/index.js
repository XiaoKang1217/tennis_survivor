'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');
const { createSWRCache } = require('../../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../../core/projection-resource');
const { matchView } = require('../../core/view-model');
const { beijingDate } = require('../../core/schedule-date');
const { followingPath } = require('../../services/follow-service');
const { directMediaUrl, mediaUrl } = require('../../core/media');

const API_PAGE_SIZE = 10;
const FOLLOWING_CONTRACT = 'follow-context-bff/1';
const FOLLOWING_CACHE_SCHEMA = 'follow-context-bff-cache/2';
const FOLLOW_TABS = Object.freeze([
  { id: 'match', label: '比赛', countKey: 'matches' },
  { id: 'player', label: '球员', countKey: 'players' }
]);
const MATCH_STATUS_TABS = Object.freeze([
  { id: 'upcoming', label: '未开始' },
  { id: 'live', label: '进行中' },
  { id: 'ended', label: '已完赛' }
]);
const MATCH_STATUS_STORAGE_KEY = 'luwang_following_match_status_v1';

function currentCacheScope(services) {
  return String(services?.account?.currentProfile?.()?.accountScope
    || services?.auth?.currentAccountScope?.() || '').trim();
}

function followingCacheKey(scope, kind, status, date, limit, offset) {
  return `following:${scope}:${kind}:${status || 'all'}:${date || 'all'}:${limit}:${offset}`;
}

function followingRequestSignature({ scope, kind, status, date, limit, offset }) {
  return [scope, kind, status || 'all', date || 'all', limit, offset].join('|');
}

const IOC_TO_ISO = Object.freeze({
  ARG: 'AR', AUS: 'AU', AUT: 'AT', BEL: 'BE', BLR: 'BY', BRA: 'BR',
  BUL: 'BG', CAN: 'CA', CHI: 'CL', CHN: 'CN', COL: 'CO', CRO: 'HR',
  CZE: 'CZ', DEN: 'DK', ECU: 'EC', EGY: 'EG', ESP: 'ES', EST: 'EE',
  FIN: 'FI', FRA: 'FR', GBR: 'GB', GEO: 'GE', GER: 'DE', GRE: 'GR',
  HUN: 'HU', IND: 'IN', IRL: 'IE', ISR: 'IL', ITA: 'IT', JPN: 'JP',
  KAZ: 'KZ', KOR: 'KR', LAT: 'LV', LTU: 'LT', MEX: 'MX', NED: 'NL',
  NOR: 'NO', NZL: 'NZ', POL: 'PL', POR: 'PT', ROU: 'RO', RSA: 'ZA',
  SRB: 'RS', SUI: 'CH', SVK: 'SK', SWE: 'SE', TPE: 'TW', TUN: 'TN',
  TUR: 'TR', UKR: 'UA', URU: 'UY', USA: 'US'
});

function fact(candidate) {
  return candidate && ['available', 'known'].includes(candidate.state)
    ? candidate.value : null;
}

function fieldText(candidate, fallback = '') {
  const value = fact(candidate);
  return value === null || value === undefined || value === ''
    ? fallback : String(value);
}

function portrait(candidate, size = '96', authority = '') {
  const value = fact(candidate);
  const source = value ?? candidate;
  if (String(authority || '').trim().toUpperCase() === 'ATP') {
    return directMediaUrl(source, { authority });
  }
  return mediaUrl(source, { size, authority });
}

function countryFlag(value) {
  const source = String(value || '').trim().toUpperCase();
  const code = source.length === 2 ? source : IOC_TO_ISO[source];
  if (!code || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map(letter =>
    127397 + letter.charCodeAt(0)));
}

function datePart(value) {
  const source = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(source);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function dateLabel(value) {
  const date = datePart(value);
  if (!date) return '日期暂缺';
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date) || [];
  return year && month && day
    ? `${year}年${Number(month)}月${Number(day)}日`
    : date;
}

function countsView(counts = {}) {
  return FOLLOW_TABS.map(tab => Object.freeze({
    ...tab,
    count: Number(counts[tab.countKey] || 0)
  }));
}

function movementTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'same';
  return number > 0 ? 'up' : 'down';
}

function movementText(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return '-';
  return number > 0 ? `+${number}` : String(number);
}

function rankText(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(number) : '-';
}

function countText(value, unit) {
  const number = Number(value);
  return `${Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0}${unit}`;
}

function numericFact(candidate) {
  const value = fact(candidate);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function eventResultTone(event) {
  const source = [
    event?.resultTone,
    event?.resultLabelZh,
    event?.summaryZh,
    event?.summary,
    event?.payload?.resultTone,
    event?.payload?.resultLabelZh,
    event?.payload?.summaryZh,
    event?.payload?.summary
  ].map(value => String(value || '').trim()).filter(Boolean).join(' ').toLowerCase();
  if (/win|won|胜/u.test(source)) return 'win';
  if (/loss|lost|负/u.test(source)) return 'loss';
  return '';
}

function recentRecordLabel(item) {
  const events = Array.isArray(item?.careerPerformance?.recentEvents)
    ? item.careerPerformance.recentEvents
    : Array.isArray(item?.recentEvents) ? item.recentEvents : [];
  const tones = events
    .map(eventResultTone)
    .filter(Boolean)
    .slice(0, 10);
  if (!tones.length) return '近期暂无';
  const wins = tones.filter(tone => tone === 'win').length;
  return `近${tones.length}场 ${wins}胜${tones.length - wins}负`;
}

function tournamentView(item) {
  const lifecycle = item.lifecycle?.label || item.lifecycle || '';
  const groupDate = item.sortDate || item.startsOn || datePart(item.followedAt);
  return Object.freeze({
    id: Array.isArray(item.calendarEventIds) && item.calendarEventIds[0]
      ? item.calendarEventIds[0] : item.targetId,
    followTargetId: item.targetId,
    title: item.title || '赛事名称暂缺',
    subtitle: [
      item.location,
      item.level,
      item.surface
    ].filter(Boolean).join(' · '),
    startsOn: item.startsOn || '',
    endsOn: item.endsOn || '',
    dates: [item.startsOn, item.endsOn].filter(Boolean).join(' - '),
    lifecycle,
    tourOrgs: Array.isArray(item.tourOrgs) ? item.tourOrgs : [],
    groupDate,
    followedAt: item.followedAt || '',
    snapshot: {
      title: item.title || '',
      location: item.location || '',
      level: item.level || '',
      surface: item.surface || '',
      startsOn: item.startsOn || '',
      endsOn: item.endsOn || '',
      tourOrgs: Array.isArray(item.tourOrgs) ? item.tourOrgs : [],
      calendarEventIds: Array.isArray(item.calendarEventIds) ? item.calendarEventIds : [],
      lifecycle: item.lifecycle || lifecycle
    }
  });
}

function playerView(item) {
  const targetId = String(item.targetId || '');
  const [authorityValue, sourcePlayerId] = targetId.includes(':')
    ? targetId.split(/:(.*)/u) : [item.authority || '', item.sourcePlayerId || ''];
  const authority = String(item.authority || authorityValue || '').toUpperCase();
  const displayName = fieldText(item.displayName, '球员姓名暂缺');
  const originalName = fieldText(item.displayNameOriginal);
  const countryCode = fieldText(item.countryCode);
  const officialPosition = item.officialRanking?.position ?? item.position;
  const racePosition = item.raceRanking?.position;
  const age = fact(item.personal?.age);
  const movement = fact(item.movement);
  const activities = Array.isArray(item.recentActivities) ? item.recentActivities : [];
  const latestActivity = activities.find(activity => activity?.title || activity?.summary) || null;
  const seasonTitles = numericFact(item.season?.titles);
  const followCount = Number(item.followCount || 0);
  const groupDate = item.sortDate
    || datePart(latestActivity?.occurredAt)
    || datePart(item.followedAt);
  return Object.freeze({
    id: targetId,
    sourcePlayerId: String(sourcePlayerId || item.sourcePlayerId || ''),
    followTargetId: targetId,
    name: displayName,
    originalName: originalName && originalName !== displayName ? originalName : '',
    countryCode,
    countryMark: countryFlag(countryCode),
    authority,
    authorityClass: authority.toLowerCase(),
    portraitUrl: portrait(item.heroImage, '96', authority)
      || portrait(item.portrait, '96', authority),
    rankBadge: rankText(officialPosition),
    rankingLabel: rankText(officialPosition),
    raceLabel: rankText(racePosition),
    ageLabel: rankText(age),
    movementText: movementText(movement),
    movementTone: movementTone(movement),
    seasonTitlesLabel: `今年 ${Number.isFinite(seasonTitles) ? seasonTitles : 0} 冠`,
    recentRecordLabel: recentRecordLabel(item),
    followCount,
    followCountLabel: countText(followCount, '人关注'),
    groupDate,
    followedAt: item.followedAt || ''
  });
}

function matchItems(payload) {
  const matches = payload?.matchesProjection?.payload?.matches;
  return Array.isArray(matches)
    ? matches.map(match => matchView(match, { includeModules: false }))
    : [];
}

function orderedItems(value) {
  const payload = value?.payload || {};
  const matches = matchItems(payload);
  const tournaments = (payload.tournaments || []).map(tournamentView);
  const players = (payload.players || []).map(playerView);
  const matchMap = new Map(matches.flatMap(match => [
    [match.id, match],
    [match.followTargetId, match]
  ]));
  const tournamentMap = new Map(tournaments.flatMap(tournament => [
    [tournament.followTargetId, tournament],
    [tournament.id, tournament]
  ]));
  const playerMap = new Map(players.map(player => [player.followTargetId, player]));
  const entries = Array.isArray(payload.pageEntries) ? payload.pageEntries : [];
  const fromEntries = entries.map(entry => {
    if (entry.targetKind === 'match') {
      const match = matchMap.get(entry.targetId);
      return match ? {
        type: 'match',
        key: `match:${match.id}`,
        groupDate: entry.sortDate || match.scheduleGroupDate || datePart(entry.followedAt),
        followedAt: entry.followedAt || '',
        match
      } : null;
    }
    if (entry.targetKind === 'tournament') {
      const tournament = tournamentMap.get(entry.targetId);
      return tournament ? {
        type: 'tournament',
        key: `tournament:${tournament.followTargetId}`,
        groupDate: entry.sortDate || tournament.groupDate,
        followedAt: entry.followedAt || '',
        tournament
      } : null;
    }
    if (entry.targetKind === 'player') {
      const player = playerMap.get(entry.targetId);
      return player ? {
        type: 'player',
        key: `player:${player.followTargetId}`,
        groupDate: entry.sortDate || player.groupDate,
        followedAt: entry.followedAt || '',
        player
      } : null;
    }
    return null;
  }).filter(Boolean);
  if (fromEntries.length) return fromEntries;
  return [
    ...players.map(player => ({
      type: 'player',
      key: `player:${player.followTargetId}`,
      groupDate: player.groupDate,
      followedAt: player.followedAt,
      player
    })),
    ...matches.map(match => ({
      type: 'match',
      key: `match:${match.id}`,
      groupDate: match.scheduleGroupDate,
      followedAt: '',
      match
    })),
    ...tournaments.map(tournament => ({
      type: 'tournament',
      key: `tournament:${tournament.followTargetId}`,
      groupDate: tournament.groupDate,
      followedAt: tournament.followedAt,
      tournament
    }))
  ];
}

function mergeItems(existing, incoming) {
  const seen = new Set(existing.map(item => item.key));
  return existing.concat(incoming.filter(item => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  }));
}

function dateGroups(items, withDateHeaders = true) {
  const ordered = [...items].sort((first, second) => {
    const firstDate = datePart(first.groupDate);
    const secondDate = datePart(second.groupDate);
    if (firstDate !== secondDate) return secondDate.localeCompare(firstDate);
    return String(second.followedAt || '').localeCompare(String(first.followedAt || ''));
  });
  if (!withDateHeaders) {
    return ordered.length ? [Object.freeze({
      id: 'all',
      label: '',
      countLabel: '',
      items: Object.freeze(ordered)
    })] : [];
  }
  const byDate = new Map();
  for (const item of ordered) {
    const key = datePart(item.groupDate) || 'unknown';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(item);
  }
  return [...byDate.entries()].map(([id, groupItems]) => Object.freeze({
    id,
    label: dateLabel(id),
    countLabel: `${groupItems.length} 项`,
    items: Object.freeze(groupItems)
  }));
}

function selectedCount(counts, selectedKind) {
  if (selectedKind === 'match') return Number(counts.matches || 0);
  if (selectedKind === 'tournament') return Number(counts.tournaments || 0);
  if (selectedKind === 'player') return Number(counts.players || 0);
  return Number(counts.total || 0);
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    tabs: countsView(),
    selectedKind: 'match',
    matchStatusTabs: MATCH_STATUS_TABS,
    selectedMatchStatus: 'upcoming',
    selectedDate: '',
    selectedDateLabel: '选择年月日',
    authPrompt: false,
    accountRestoring: true,
    loading: false,
    loadingMore: false,
    failed: false,
    items: [],
    dateGroups: [],
    count: 0,
    matchCount: 0,
    tournamentCount: 0,
    playerCount: 0,
    offset: 0,
    hasMore: false,
    pageNumber: 1,
    pageCount: 1,
    canPrev: false,
    canNext: false,
    deliveryState: '',
    deliveryMessage: '',
    dataAsOf: ''
  },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.services = getApp().services;
    this.cache = createSWRCache(wx);
    this.matchDates = new Map();
    this.followingRequestId = 0;
    this.activeFollowingSignature = '';
    this.activeAccountScope = '';
    this.setData({ topInset: info.statusBarHeight || 44 });
    void this.restoreAccountAndLoad();
  },
  onShow() {
    syncPageTheme(this);
    if (!this.services || this.data.accountRestoring) return;
    const scope = currentCacheScope(this.services);
    if (scope !== this.activeAccountScope) this.resetForAccountScope(scope);
    if (!this.data.authPrompt && this.services.account.isComplete()) void this.load();
  },
  onUnload() { this.invalidateFollowingRequests(); },
  invalidateFollowingRequests() {
    this.followingRequestId = Number(this.followingRequestId || 0) + 1;
    this.activeFollowingSignature = '';
  },
  resetForAccountScope(scope) {
    this.invalidateFollowingRequests();
    this.activeAccountScope = String(scope || '');
    this.matchDates = new Map();
    this.setData({
      items: [], dateGroups: [], count: 0, matchCount: 0, tournamentCount: 0,
      playerCount: 0, offset: 0, hasMore: false, pageNumber: 1, pageCount: 1,
      canPrev: false, canNext: false, deliveryState: '', deliveryMessage: '', dataAsOf: ''
    });
  },
  beginFollowingRequest(signature) {
    const requestId = Number(this.followingRequestId || 0) + 1;
    this.followingRequestId = requestId;
    this.activeFollowingSignature = signature;
    return requestId;
  },
  isCurrentFollowingRequest(requestId, signature) {
    return this.followingRequestId === requestId
      && this.activeFollowingSignature === signature
      && currentCacheScope(this.services) === this.activeAccountScope;
  },
  async restoreAccountAndLoad() {
    try { await getApp().accountReady; } catch { /* the profile gate handles a real failure */ }
    if (this.services.account.isComplete()) {
      this.setData({ authPrompt: false, accountRestoring: false }, () => void this.load());
      return;
    }
    this.setData({ authPrompt: true, accountRestoring: false, loading: false });
    if (typeof wx.nextTick === 'function') wx.nextTick(() => void this.promptForProfile());
    else void this.promptForProfile();
  },
  onPullDownRefresh() {
    void this.load().finally(() => wx.stopPullDownRefresh());
  },
  selectKind(event) {
    const selectedKind = String(event.currentTarget.dataset.kind || 'match');
    if (selectedKind === this.data.selectedKind) return;
    this.setData({
      selectedKind,
      items: [],
      dateGroups: [],
      offset: 0,
      hasMore: false,
      pageNumber: 1
    }, () => void this.load());
  },
  selectMatchStatus(event) {
    const selectedMatchStatus = String(event.currentTarget.dataset.status || 'upcoming');
    try { wx.setStorageSync(MATCH_STATUS_STORAGE_KEY, selectedMatchStatus); } catch { /* session hint only */ }
    this.setData({ selectedMatchStatus, pageNumber: 1, offset: 0 }, () => void this.load());
  },
  selectMatchDate(event) {
    const selectedDate = datePart(event.detail.value);
    this.setData({
      selectedDate,
      selectedDateLabel: selectedDate ? dateLabel(selectedDate) : '选择年月日',
      pageNumber: 1
    }, () => void this.load());
  },
  clearMatchDate() {
    if (!this.data.selectedDate) return;
    this.setData({ selectedDate: '', selectedDateLabel: '选择年月日', pageNumber: 1 },
      () => void this.load());
  },
  previousPage() {
    if (!this.data.canPrev) return;
    this.setData({ pageNumber: this.data.pageNumber - 1 }, () => void this.load());
  },
  nextPage() {
    if (!this.data.canNext) return;
    this.setData({ pageNumber: this.data.pageNumber + 1 }, () => void this.load());
  },
  async promptForProfile() {
    try {
      await this.services.auth.ensure();
      const gate = this.selectComponent('#profileGate');
      const completed = await gate?.collect?.({ sourceEntry: 'following_page', mode: 'login' });
      if (!completed) return;
      this.setData({ authPrompt: false }, () => void this.load());
    } catch { /* first frame stays a bounded login prompt; no retry loop */ }
  },
  async load(options = {}) {
    if (!this.services.account.isComplete()) {
      this.resetForAccountScope('');
      this.setData({ authPrompt: true, loading: false, failed: false, items: [], dateGroups: [] });
      return;
    }
    const append = false;
    const selectedKind = this.data.selectedKind;
    const limit = API_PAGE_SIZE;
    const selectedStatus = selectedKind === 'match' ? this.data.selectedMatchStatus : '';
    const selectedDate = selectedKind === 'match' ? this.data.selectedDate : '';
    const pageNumber = Math.max(1, Number(this.data.pageNumber) || 1);
    const offset = (pageNumber - 1) * limit;
    let scope = currentCacheScope(this.services);
    if (!scope) {
      try { await this.services.auth.ensure(); } catch { /* handled by the bounded empty state below */ }
      scope = currentCacheScope(this.services);
    }
    if (!scope || !this.services.account.isComplete()) {
      this.resetForAccountScope('');
      this.setData({ authPrompt: true, loading: false, failed: false });
      return;
    }
    if (scope !== this.activeAccountScope) this.resetForAccountScope(scope);
    const signature = followingRequestSignature({
      scope, kind: selectedKind, status: selectedStatus, date: selectedDate, limit, offset
    });
    const requestId = this.beginFollowingRequest(signature);
    let cacheKey = scope
      ? followingCacheKey(scope, selectedKind, selectedStatus, selectedDate, limit, offset) : '';
    const cached = cacheKey
      ? readTrustedProjection(this.cache, cacheKey, FOLLOWING_CACHE_SCHEMA) : null;
    this.setData(append
      ? { loadingMore: true, failed: false }
      : { loading: true, loadingMore: false, failed: false });
    if (cached?.payload && this.isCurrentFollowingRequest(requestId, signature)) {
      this.applyFollowingValue(cached.payload, {
        append: false,
        selectedKind,
        fromCache: true
      });
    }
    try {
      const result = await loadProjectionResource({
        http: this.services.http,
        cache: this.cache,
        resourceKey: append ? '' : cacheKey,
        schemaVersion: FOLLOWING_CACHE_SCHEMA,
        path: followingPath({
          kind: selectedKind,
          status: selectedStatus,
          date: selectedDate,
          limit,
          offset
        }),
        requestOptions: {
          authRequired: true,
          header: { 'x-luwang-client-contract-version': FOLLOWING_CONTRACT }
        },
        metadata: { dataAsOf: value => value?.dataAsOf || value?.delivery?.dataAsOf || '' },
        validate(value) {
          if (!value || typeof value !== 'object'
            || !value.payload || typeof value.payload !== 'object') {
            throw new Error('following_projection_invalid');
          }
          if (value.bffContractVersion
            && value.bffContractVersion !== FOLLOWING_CONTRACT) {
            throw new Error('following_projection_contract_invalid');
          }
          return value;
        }
      });
      if (!this.isCurrentFollowingRequest(requestId, signature)) return;
      this.applyFollowingValue(result.value, {
        append,
        selectedKind,
        fromCache: false
      });
    } catch {
      if (!this.isCurrentFollowingRequest(requestId, signature)) return;
      if (cached?.payload) {
        this.setData({
          loading: false,
          loadingMore: false,
          failed: false,
          deliveryState: 'stale',
          deliveryMessage: '刷新暂未成功，已保留上次关注'
        });
        return;
      }
      this.setData({
        loading: false,
        loadingMore: false,
        failed: !append,
        dateGroups: append ? this.data.dateGroups : [],
        count: append ? this.data.count : 0,
        hasMore: append ? this.data.hasMore : false,
        deliveryState: '',
        deliveryMessage: '',
        dataAsOf: append ? this.data.dataAsOf : ''
      });
    }
  },
  applyFollowingValue(value, options = {}) {
    const append = Boolean(options.append);
    const selectedKind = options.selectedKind || this.data.selectedKind;
    const incoming = orderedItems(value);
    const items = append ? mergeItems(this.data.items, incoming) : incoming;
    const counts = value?.payload?.counts || {};
    const page = value?.payload?.page || {};
    const pageNumber = Math.floor(Number(page.offset || 0) / API_PAGE_SIZE) + 1;
    const hasMore = page.hasMore === true;
    const groups = dateGroups(items, selectedKind === 'match');
    const dataAsOf = value?.dataAsOf || value?.delivery?.dataAsOf || '';
    this.matchDates = new Map(items
      .filter(item => item.type === 'match')
      .map(item => [item.match.id, item.match.scheduleGroupDate || beijingDate()]));
    this.setData({
      loading: false,
      loadingMore: false,
      failed: false,
      tabs: countsView(counts),
      items,
      dateGroups: groups,
      count: Number(counts.filtered ?? selectedCount(counts, selectedKind)),
      selectedMatchStatus: this.data.selectedMatchStatus,
      matchCount: Number(counts.matches || 0),
      tournamentCount: Number(counts.tournaments || 0),
      playerCount: Number(counts.players || 0),
      offset: Number(value?.payload?.page?.nextOffset ?? page.offset ?? 0),
      hasMore,
      pageNumber,
      pageCount: pageNumber + (hasMore ? 1 : 0),
      canPrev: pageNumber > 1,
      canNext: hasMore,
      deliveryState: options.fromCache ? 'stale'
        : value?.delivery?.state === 'current' ? 'live' : value?.delivery?.state || '',
      deliveryMessage: options.fromCache
        ? '已显示上次关注，正在刷新'
        : '',
      dataAsOf
    });
  },
  openMatch(event) {
    const matchId = event.detail.matchId;
    const date = this.matchDates.get(matchId) || beijingDate();
    wx.navigateTo({
      url: `/pages/match-detail/index?matchId=${encodeURIComponent(matchId)}`
        + `&date=${encodeURIComponent(date)}`
    });
  },
  openTournament(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/packages/tournament/pages/tournament-detail/index?tournamentEditionId=${encodeURIComponent(id)}`
    });
  },
  openPlayer(event) {
    const [tour, playerId] = String(event.currentTarget.dataset.id || '').split(/:(.*)/u);
    if (!tour || !playerId) return;
    wx.navigateTo({
      url: `/packages/player/pages/player-detail/index?playerId=${encodeURIComponent(playerId)}`
        + `&tour=${encodeURIComponent(tour)}`
    });
  },
  tournamentSnapshot(targetId) {
    const item = this.data.items.find(candidate =>
      candidate.type === 'tournament'
      && candidate.tournament.followTargetId === targetId);
    return item?.tournament?.snapshot || null;
  },
  async toggleFollow(event) {
    const { matchId, followed } = event.detail;
    try {
      await this.services.follow.setFollow('match', matchId, followed, 'following_page');
      await this.load();
    } catch (err) {
      if (String(err?.message || '') !== 'follow_login_cancelled') {
        wx.showToast({ title: '关注状态暂未保存', icon: 'none' });
      }
    }
  },
  async togglePlayerFollow(event) {
    const targetId = String(event.currentTarget.dataset.id || '').trim();
    if (!targetId) return;
    try {
      await this.services.follow.setFollow('player', targetId, false, 'following_page_player');
      await this.load();
    } catch (err) {
      if (String(err?.message || '') !== 'follow_login_cancelled') {
        wx.showToast({ title: '关注状态暂未保存', icon: 'none' });
      }
    }
  },
  async toggleTournamentFollow(event) {
    const targetId = String(event.currentTarget.dataset.id || '').trim();
    if (!targetId) return;
    try {
      await this.services.follow.setFollow(
        'tournament',
        targetId,
        false,
        'following_page_tournament',
        this.tournamentSnapshot(targetId)
      );
      await this.load();
    } catch (err) {
      if (String(err?.message || '') !== 'follow_login_cancelled') {
        wx.showToast({ title: '关注状态暂未保存', icon: 'none' });
      }
    }
  }
});
