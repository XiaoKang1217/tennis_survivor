'use strict';

const { buildThemeData, syncPageTheme } = require('../../../../core/theme');
const { createSWRCache } = require('../../../../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../../../../core/projection-resource');
const { directMediaUrl, mediaUrl } = require('../../../../core/media');

const IOC_TO_ISO = Object.freeze({
  ARG: 'AR', AUS: 'AU', AUT: 'AT', BEL: 'BE', BLR: 'BY', BRA: 'BR',
  BUL: 'BG', CAN: 'CA', CHI: 'CL', CHN: 'CN', COL: 'CO', CRO: 'HR',
  CZE: 'CZ', DEN: 'DK', ESP: 'ES', FRA: 'FR', GBR: 'GB', GER: 'DE',
  GRE: 'GR', HUN: 'HU', ITA: 'IT', JPN: 'JP', KAZ: 'KZ', NED: 'NL',
  NOR: 'NO', POL: 'PL', POR: 'PT', ROU: 'RO', SRB: 'RS', SUI: 'CH',
  SVK: 'SK', SWE: 'SE', TUN: 'TN', UKR: 'UA', USA: 'US'
});

const FOLLOW_TABS = Object.freeze([
  { id: 'all', label: '全部' },
  { id: 'ATP', label: 'ATP' },
  { id: 'WTA', label: 'WTA' }
]);
const PLAYER_LIST_CACHE_SCHEMA = 'player-list-projection/2';
const PLAYER_SEARCH_CONTRACT = 'player-basic-profiles-bff/1';
const PLAYER_SEARCH_CACHE_SCHEMA = 'player-basic-profiles-bff-cache/2';
const PLAYER_H2H_CACHE_SCHEMA = 'player-h2h-bff/1';

function playerListCacheKey(options) {
  const authority = String(options?.authority || 'ATP').toUpperCase();
  const rankingKind = String(options?.rankingKind || 'official');
  const query = encodeURIComponent(String(options?.query || '').trim());
  const pageSize = Number(options?.pageSize) || 50;
  const offset = Number(options?.offset) || 0;
  return `player_list:${authority}:${rankingKind}:${pageSize}:${offset}:${query}`;
}

function playerSearchCacheKey(authority, query, limit = 8) {
  return `player_search:${String(authority || 'ATP').toUpperCase()}`
    + `:${Number(limit) || 8}:${encodeURIComponent(String(query || '').trim())}`;
}

function playerH2hCacheKey(authority, firstPlayerId, secondPlayerId) {
  return `player_h2h:${String(authority || 'ATP').toUpperCase()}`
    + `:${String(firstPlayerId || '')}:${String(secondPlayerId || '')}`;
}

function fact(candidate) {
  return candidate && ['available', 'known'].includes(candidate.state)
    ? candidate.value : null;
}

function flag(code) {
  const value = String(code || '').toUpperCase();
  const normalized = value.length === 2 ? value : IOC_TO_ISO[value];
  if (!normalized) return '';
  return String.fromCodePoint(...[...normalized].map(letter =>
    127397 + letter.charCodeAt(0)));
}

function portrait(candidate, size = '96', fallback = '', authority = '') {
  const value = fact(candidate);
  const source = value ?? candidate;
  if (String(authority || '').trim().toUpperCase() === 'ATP') {
    return directMediaUrl(source, { fallback, authority });
  }
  return mediaUrl(source, { size, fallback, authority });
}

function playerDisplayName(entry, fallback = '球员姓名暂缺') {
  return fact(entry?.displayNameZh)
    || fact(entry?.displayName)
    || fact(entry?.displayNameOriginal)
    || fallback;
}

function playerOriginalName(entry, displayName = '') {
  const original = fact(entry?.displayNameOriginal) || '';
  return original && original !== displayName ? original : '';
}

function h2hSearchOptions(value) {
  const entries = value?.payload?.entries;
  if (value?.bffContractVersion !== PLAYER_SEARCH_CONTRACT
    || !Array.isArray(entries)) return [];
  return entries.map(entry => {
    const countryCode = fact(entry.countryCode) || '';
    const name = playerDisplayName(entry, fact(entry.displayNameOriginal) || '球员姓名暂缺');
    return Object.freeze({
      playerId: String(entry.playerId || entry.sourcePlayerId || ''),
      name,
      originalName: playerOriginalName(entry, name),
      countryCode,
      countryMark: flag(countryCode),
      position: entry.position
    });
  }).filter(option => option.playerId && option.name);
}

function h2hKeys(side) {
  const suffix = side === 'second' ? '2' : '1';
  return Object.freeze({
    input: `h2hPlayer${suffix}`,
    playerId: `h2hPlayer${suffix}Id`,
    selected: `h2hSelected${suffix}`,
    options: `h2hOptions${suffix}`,
    searching: `h2hSearching${suffix}`,
    searchMessage: `h2hSearchMessage${suffix}`
  });
}

function samePlayerOption(first, second) {
  return first?.playerId && second?.playerId
    && String(first.playerId) === String(second.playerId);
}

function matchesTypedPlayer(option, query) {
  const source = String(query || '').trim().toLocaleLowerCase('zh-CN');
  if (!source) return false;
  return [
    option.playerId,
    option.name,
    option.originalName
  ].some(value => String(value || '').trim().toLocaleLowerCase('zh-CN') === source);
}

function moneyText(candidate) {
  const value = fact(candidate);
  return value?.displayText || '';
}

function movementView(value) {
  if (!Number.isFinite(Number(value))) {
    return Object.freeze({ value: null, text: '-', tone: 'none' });
  }
  const number = Number(value);
  return Object.freeze({
    value: number,
    text: number > 0 ? `+${number}` : number < 0 ? String(number) : '-',
    tone: number > 0 ? 'up' : number < 0 ? 'down' : 'same'
  });
}

function followCountValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function followCountText(value) {
  return `${followCountValue(value)}人关注`;
}

function rankingText(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `世界排名 ${number}` : '暂无排名';
}

function profileEntries(value, authority, rankingKind = 'official') {
  const entries = value?.payload?.entries;
  if (value?.bffContractVersion !== PLAYER_SEARCH_CONTRACT
    || !Array.isArray(entries)) return [];
  return entries.map(entry => {
    const countryCode = fact(entry.countryCode) || '';
    const movement = movementView(fact(entry.movement));
    const seasonPrize = moneyText(entry.season?.prizeMoney);
    const careerPrize = moneyText(entry.career?.prizeMoney);
    const displayName = playerDisplayName(entry);
    const preferredRanking = rankingKind === 'race' ? entry.raceRanking : entry.officialRanking;
    const position = preferredRanking?.position ?? entry.position;
    const points = preferredRanking?.points ?? entry.points;
    return Object.freeze({
      id: entry.playerId,
      name: displayName,
      originalName: playerOriginalName(entry, displayName),
      countryCode,
      countryMark: flag(countryCode),
      position,
      points,
      movementText: movement.text,
      movementTone: movement.tone,
      portraitUrl: portrait(entry.portrait, '96', '', authority),
      heroImageUrl: portrait(entry.heroImage, '720', '', authority) || portrait(entry.portrait, '720', '', authority),
      followTargetId: entry.viewerFollowState?.player?.targetId || `${authority}:${entry.playerId}`,
      followed: entry.viewerFollowState?.player?.followed === true,
      followCount: followCountValue(entry.followCount),
      followCountLabel: followCountText(entry.followCount),
      tour: authority,
      source: followCountText(entry.followCount),
      extraMeta: seasonPrize ? `年度奖金 ${seasonPrize}`
        : careerPrize ? `生涯奖金 ${careerPrize}` : '',
      profileAvailable: true
    });
  });
}

function officialEntries(value, authority) {
  const snapshot = value?.payload?.snapshot;
  if (value?.bffContractVersion !== 'official-ranking-bff/2'
    || !Array.isArray(snapshot?.entries)) return [];
  return snapshot.entries.map(entry => {
    const countryCode = fact(entry.countryCode) || '';
    const movement = movementView(fact(entry.movement));
    const displayName = playerDisplayName(entry);
    return Object.freeze({
      id: entry.playerId,
      name: displayName,
      originalName: playerOriginalName(entry, displayName),
      countryCode,
      countryMark: flag(countryCode),
      position: entry.position,
      points: entry.points,
      movementText: movement.text,
      movementTone: movement.tone,
      portraitUrl: portrait(entry.portraitUrl || entry.portrait, '96', '', authority),
      followTargetId: entry.viewerFollowState?.player?.targetId || `${authority}:${entry.playerId}`,
      followed: entry.viewerFollowState?.player?.followed === true,
      followCount: followCountValue(entry.followCount),
      followCountLabel: followCountText(entry.followCount),
      tour: authority,
      source: followCountText(entry.followCount),
      profileAvailable: true
    });
  });
}

function raceEntries(value, authority) {
  const entries = value?.payload?.ranking?.entries;
  if (value?.bffContractVersion !== 'race-ranking-bff/2'
    || !Array.isArray(entries)) return [];
  return entries.map(entry => {
    const participant = entry.participant || {};
    const member = participant.members?.length === 1 ? participant.members[0] : null;
    const countryCode = member ? fact(member.countryCode) || '' : '';
    const movement = movementView(fact(entry.movement));
    const fallbackName = (participant.members || [])
      .map(item => playerDisplayName(item, ''))
      .filter(Boolean)
      .join(' / ') || '参赛方暂缺';
    const displayName = playerDisplayName(participant, fallbackName);
    return Object.freeze({
      id: member?.playerId || participant.participantId,
      name: displayName,
      originalName: playerOriginalName(participant, displayName),
      countryCode,
      countryMark: flag(countryCode),
      position: entry.position,
      points: entry.points,
      movementText: movement.text,
      movementTone: movement.tone,
      portraitUrl: portrait(member?.portraitUrl || member?.portrait, '96', '', authority),
      followTargetId: entry.viewerFollowState?.player?.targetId
        || (member?.playerId ? `${authority}:${member.playerId}` : ''),
      followed: entry.viewerFollowState?.player?.followed === true,
      followCount: followCountValue(entry.followCount ?? member?.followCount),
      followCountLabel: followCountText(entry.followCount ?? member?.followCount),
      tour: authority,
      source: followCountText(entry.followCount ?? member?.followCount),
      profileAvailable: Boolean(member?.playerId)
    });
  });
}

function leaderboardEntries(value) {
  const entries = value?.payload?.entries;
  if (value?.bffContractVersion !== 'follow-leaderboard-bff/1'
    || !Array.isArray(entries)) return [];
  return entries.map(entry => {
    const countryCode = fact(entry.countryCode) || '';
    const displayName = playerDisplayName(entry);
    const age = fact(entry.personal?.age);
    const position = fact(entry.officialRanking?.position) ?? fact(entry.position);
    const authority = entry.authority || '';
    const cardImageUrl = portrait(entry.heroImage, '720', '', authority) || portrait(entry.portrait, '720', '', authority);
    return Object.freeze({
      id: entry.playerId,
      leaderboardPosition: entry.leaderboardPosition,
      name: displayName,
      originalName: playerOriginalName(entry, displayName),
      countryCode,
      countryMark: flag(countryCode),
      ageLabel: Number.isFinite(Number(age)) ? `${Number(age)}岁` : '年龄暂缺',
      position,
      rankingLabel: rankingText(position),
      followCount: followCountValue(entry.followCount),
      followCountLabel: followCountText(entry.followCount),
      portraitUrl: portrait(entry.portrait, '96', '', authority),
      heroImageUrl: portrait(entry.heroImage, '720', '', authority) || portrait(entry.portrait, '720', '', authority),
      cardImageUrl,
      followTargetId: entry.viewerFollowState?.player?.targetId
        || entry.targetId
        || `${entry.authority}:${entry.playerId}`,
      followed: entry.viewerFollowState?.player?.followed === true,
      tour: entry.authority || '',
      source: followCountText(entry.followCount),
      profileAvailable: true
    });
  });
}

function h2hDateKey(match) {
  return String(match?.occurredOn || match?.dateText || match?.date || '').slice(0, 10);
}

function h2hResult(value, selected = {}) {
  if (value?.bffContractVersion !== 'player-h2h-bff/1') return null;
  const payload = value.payload || {};
  const players = Array.isArray(payload.players) ? payload.players : [];
  const first = players[0] || {};
  const second = players[1] || {};
  const summary = payload.summary || {};
  const aggregate = payload.aggregate || {};
  const player1Name = selected.firstName || first.displayNameZh || first.displayName || '球员一';
  const player2Name = selected.secondName || second.displayNameZh || second.displayName || '球员二';
  const sections = Array.isArray(payload.displaySections)
    ? payload.displaySections.map(section => ({
      id: section.id,
      title: section.titleZh || section.title,
      rows: Array.isArray(section.rows) ? section.rows : []
    })).filter(section => section.rows.length) : [];
  const history = Array.isArray(payload.history) ? payload.history
    .map(match => {
      const winnerName = match.winnerNameZh
        || (match.winnerSide === 1 ? player1Name : match.winnerSide === 2 ? player2Name : '');
      const levelLabel = match.levelLabelZh || match.levelLabel || '';
      const surfaceLabel = match.surfaceLabelZh || match.surfaceLabel || '';
      const roundLabel = match.roundLabelZh || match.roundLabel || match.roundId || '';
      const result = String(match.result || '').trim();
      const dateText = h2hDateKey(match);
      return {
        sourceMatchId: match.sourceMatchId || `${dateText}:${match.tournamentName || ''}`,
        occurredOn: dateText,
        dateText,
        tournamentName: match.tournamentNameZh || match.tournamentName || '赛事暂缺',
        levelLabel,
        surfaceLabel,
        roundLabel,
        metaText: [levelLabel, surfaceLabel, roundLabel].filter(Boolean).join(' · '),
        result,
        resultLabel: result ? `比分 ${result}` : '',
        winnerSide: match.winnerSide,
        winnerName,
        winnerLabel: winnerName ? `${winnerName}胜` : ''
      };
    })
    .sort((left, right) => String(right.occurredOn || '').localeCompare(
      String(left.occurredOn || '')
    )) : [];
  return Object.freeze({
    authority: payload.authority || '',
    dataAsOf: value.dataAsOf || '',
    player1Name,
    player2Name,
    player1Country: first.countryCode || '',
    player2Country: second.countryCode || '',
    player1Wins: Number(aggregate.player1Wins ?? summary.player1Wins ?? 0),
    player2Wins: Number(aggregate.player2Wins ?? summary.player2Wins ?? 0),
    totalMatches: Number(aggregate.matchCount ?? summary.totalMatches ?? history.length),
    hasMeetings: summary.hasMeetings !== false && history.length > 0,
    sections,
    history
  });
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    sections: [
      { id: 'ranking', label: '排名与资料' },
      { id: 'h2h', label: '交手' },
      { id: 'flowers', label: '送花榜' },
      { id: 'follows', label: '关注榜' }
    ],
    rankTabs: [
      { id: 'ATP', label: 'ATP' },
      { id: 'WTA', label: 'WTA' }
    ],
    followTabs: FOLLOW_TABS,
    flowerKinds: [
      { id: 'players', label: '球员收花榜' },
      { id: 'fans', label: '粉丝送花榜' }
    ],
    rankingKinds: [
      { id: 'official', label: '官方排名' },
      { id: 'race', label: '冠军积分' }
    ],
    section: 'ranking',
    rankingKind: 'official',
    authority: 'ATP',
    followTour: 'all',
    flowerKind: 'players',
    query: '',
    loading: true,
    failed: false,
    players: [],
    visiblePlayers: [],
    pageSize: 50,
    offset: 0,
    hasMore: false,
    loadingMore: false,
    deliveryState: '',
    deliveryMessage: '',
    dataAsOf: '',
    h2hPlayer1: '',
    h2hPlayer2: '',
    h2hPlayer1Id: '',
    h2hPlayer2Id: '',
    h2hSelected1: null,
    h2hSelected2: null,
    h2hOptions1: [],
    h2hOptions2: [],
    h2hSearching1: false,
    h2hSearching2: false,
    h2hSearchMessage1: '',
    h2hSearchMessage2: '',
    h2hLoading: false,
    h2hEmpty: false,
    h2hFailed: false,
    h2hMessage: '',
    h2hResult: null
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.http = getApp().services.http;
    this.cache = createSWRCache(wx);
    this.followService = getApp().services.follow;
    this.socialService = getApp().services.social;
    this.h2hSearchTimers = {};
    this.h2hSearchSeq = {};
    this.setData({ topInset: info.statusBarHeight || 44 });
    void this.load();
  },
  onShow() { syncPageTheme(this); },

  onPullDownRefresh() {
    void this.load().finally(() => wx.stopPullDownRefresh());
  },

  selectSection(event) {
    const section = event.currentTarget.dataset.section;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({
      section,
      query: '',
      offset: 0,
      hasMore: false,
      h2hFailed: false,
      h2hMessage: ''
    }, () => void this.load());
  },

  selectAuthority(event) {
    const authority = event.currentTarget.dataset.authority === 'WTA' ? 'WTA' : 'ATP';
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({
      authority,
      offset: 0,
      hasMore: false,
      h2hPlayer1: '',
      h2hPlayer2: '',
      h2hPlayer1Id: '',
      h2hPlayer2Id: '',
      h2hSelected1: null,
      h2hSelected2: null,
      h2hOptions1: [],
      h2hOptions2: [],
      h2hSearching1: false,
      h2hSearching2: false,
      h2hSearchMessage1: '',
      h2hSearchMessage2: '',
      h2hEmpty: false,
      h2hFailed: false,
      h2hMessage: '',
      h2hResult: null
    }, () => {
      if (this.data.section === 'ranking') void this.load();
    });
  },

  selectFollowTour(event) {
    const followTour = event.currentTarget.dataset.tour === 'ATP'
      ? 'ATP'
      : event.currentTarget.dataset.tour === 'WTA' ? 'WTA' : 'all';
    this.setData({
      followTour,
      offset: 0,
      hasMore: false
    }, () => void this.load());
  },

  selectFlowerKind(event) {
    const flowerKind = event.currentTarget.dataset.kind === 'fans' ? 'fans' : 'players';
    this.setData({ flowerKind }, () => void this.load());
  },

  selectRankingKind(event) {
    const rankingKind = event.currentTarget.dataset.kind === 'race' ? 'race' : 'official';
    this.setData({ rankingKind, offset: 0, hasMore: false }, () => void this.load());
  },

  onSearch(event) {
    const query = event.detail.value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ query }, () => {
      if (this.data.section === 'ranking') {
        this.setData({ offset: 0, hasMore: false });
        this.searchTimer = setTimeout(() => void this.load(), 220);
        return;
      }
      this.filter();
    });
  },

  filter() {
    const query = String(this.data.query || '').trim().toLocaleLowerCase('zh-CN');
    const visiblePlayers = query
      ? this.data.players.filter(player => [
          player.name,
          player.originalName,
          player.countryCode
        ].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(query)))
      : this.data.players;
    this.setData({ visiblePlayers });
  },

  onReachBottom() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    const hasRankingSearch = this.data.section === 'ranking'
      && String(this.data.query || '').trim();
    if (this.data.section !== 'follows'
      && (this.data.section !== 'ranking'
        || (this.data.rankingKind !== 'official' && !hasRankingSearch))) return;
    void this.load({ append: true });
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    const hasRankingSearch = this.data.section === 'ranking'
      && String(this.data.query || '').trim();
    if (this.data.section !== 'follows'
      && (this.data.section !== 'ranking'
        || (this.data.rankingKind !== 'official' && !hasRankingSearch))) return;
    void this.load({ append: true });
  },

  async load(options = {}) {
    const append = Boolean(options.append);
    if (this.data.section === 'follows') {
      await this.loadFollowLeaderboard(options);
      return;
    }
    if (this.data.section === 'flowers') {
      await this.loadFlowerLeaderboard();
      return;
    }
    if (this.data.section !== 'ranking') {
      this.setData({
        loading: false,
        loadingMore: false,
        failed: false,
        players: [],
        visiblePlayers: [],
        offset: 0,
        hasMore: false,
        deliveryState: '',
        deliveryMessage: '',
        dataAsOf: ''
      });
      return;
    }
    this.setData(append ? { loadingMore: true, failed: false } : { loading: true, failed: false });
    const isRace = this.data.rankingKind === 'race';
    const authority = this.data.authority;
    const rankingKind = this.data.rankingKind;
    const pageSize = this.data.pageSize;
    const offset = append ? this.data.offset : 0;
    const searchQuery = String(this.data.query || '').trim();
    const useProfileSearch = Boolean(searchQuery);
    const contract = useProfileSearch ? PLAYER_SEARCH_CONTRACT
      : isRace ? 'race-ranking-bff/2' : 'official-ranking-bff/2';
    const year = new Date().getFullYear();
    const sequence = (this.loadSequence || 0) + 1;
    this.loadSequence = sequence;
    const requestPath = useProfileSearch
      ? `/api/v2/bff/player-basic-profiles/${encodeURIComponent(authority)}`
        + `?q=${encodeURIComponent(searchQuery)}&limit=${pageSize}&offset=${offset}`
      : isRace
      ? `/api/v2/bff/race-ranking/${authority}/singles/${year}`
      : `/api/v2/bff/rankings/current?authority=${authority}&discipline=singles`
        + `&limit=${pageSize}&offset=${offset}`;
    const cacheKey = playerListCacheKey({
      authority,
      rankingKind,
      query: searchQuery,
      pageSize,
      offset
    });
    const cached = append ? null : readTrustedProjection(
      this.cache,
      cacheKey,
      PLAYER_LIST_CACHE_SCHEMA
    );
    if (cached?.payload) {
      this.applyRankingValue(cached.payload, {
        append: false,
        offset,
        authority,
        rankingKind,
        useProfileSearch,
        isRace,
        fromCache: true
      });
    }
    try {
      const result = await loadProjectionResource({
        http: this.http,
        cache: this.cache,
        resourceKey: append ? '' : cacheKey,
        schemaVersion: PLAYER_LIST_CACHE_SCHEMA,
        path: requestPath,
        requestOptions: {
          authMode: 'none',
          header: { 'x-luwang-client-contract-version': contract }
        },
        metadata: { dataAsOf: value => value?.dataAsOf || value?.delivery?.dataAsOf || '' },
        validate(value) {
          if (value?.bffContractVersion !== contract) {
            throw new Error('player_list_projection_invalid');
          }
          return value;
        }
      });
      if (this.loadSequence !== sequence
        || this.data.section !== 'ranking'
        || this.data.authority !== authority
        || this.data.rankingKind !== rankingKind
        || String(this.data.query || '').trim() !== searchQuery) return;
      this.applyRankingValue(result.value, {
        append,
        offset,
        authority,
        rankingKind,
        useProfileSearch,
        isRace,
        fromCache: false
      });
    } catch {
      if (this.loadSequence !== sequence
        || this.data.section !== 'ranking'
        || this.data.authority !== authority
        || this.data.rankingKind !== rankingKind
        || String(this.data.query || '').trim() !== searchQuery) return;
      if (cached?.payload) {
        this.setData({
          loading: false,
          loadingMore: false,
          failed: false,
          deliveryState: 'stale',
          deliveryMessage: '刷新暂未成功，已保留上次球员列表'
        });
        return;
      }
      this.setData({
        loading: false,
        loadingMore: false,
        failed: true,
        players: append ? this.data.players : [],
        visiblePlayers: append ? this.data.visiblePlayers : [],
        deliveryState: '',
        deliveryMessage: '',
        dataAsOf: ''
      });
    }
  },

  applyRankingValue(value, context) {
    const {
      append,
      offset,
      authority,
      rankingKind,
      useProfileSearch,
      isRace,
      fromCache
    } = context;
    const players = useProfileSearch
      ? profileEntries(value, authority, rankingKind)
      : isRace ? raceEntries(value, authority) : officialEntries(value, authority);
    const hasMore = useProfileSearch
      ? Boolean(value?.payload?.hasMore)
      : isRace ? false : Boolean(value?.payload?.snapshot?.hasMore);
    const nextOffset = useProfileSearch
      ? value?.payload?.nextOffset
      : isRace ? null : value?.payload?.snapshot?.nextOffset;
    const mergedPlayers = append ? this.data.players.concat(players) : players;
    const dataAsOf = value?.dataAsOf || value?.delivery?.dataAsOf || '';
    this.setData({
      loading: false,
      loadingMore: false,
      failed: mergedPlayers.length === 0,
      players: mergedPlayers,
      offset: Number.isSafeInteger(Number(nextOffset)) ? Number(nextOffset)
        : offset + players.length,
      hasMore,
      deliveryState: players.length ? (
        fromCache ? 'stale' : value.delivery?.state === 'current' ? 'live' : 'delayed'
      ) : '',
      deliveryMessage: players.length
        ? fromCache ? '已显示上次球员列表，正在刷新'
          : (useProfileSearch ? '球员资料已更新' : isRace ? '冠军积分已更新' : '官方排名已更新')
        : '',
      dataAsOf,
      visiblePlayers: useProfileSearch ? mergedPlayers : this.data.visiblePlayers
    }, () => {
      if (!useProfileSearch) this.filter();
    });
  },

  async loadFlowerLeaderboard() {
    this.setData({ loading: true, failed: false });
    try {
      const value = await this.socialService.flowerLeaderboard(
        this.data.flowerKind,
        this.data.followTour
      );
      const entries = Array.isArray(value?.payload?.entries) ? value.payload.entries : [];
      const players = entries.map(item => this.data.flowerKind === 'players' ? {
        id: String(item.playerId || ''),
        name: String(item.name || '球员'),
        originalName: String(item.originalName || ''),
        countryCode: String(item.countryCode || ''),
        cardImageUrl: String(item.avatarUrl || ''),
        tour: String(item.authority || '').toUpperCase(),
        leaderboardPosition: Number(item.rank || 0),
        flowerTotal: Number(item.flowerTotal || 0),
        flowerMeta: `${Number(item.fanCount || 0)}位送花粉丝`,
        isFan: false
      } : {
        id: `fan-${item.rank}`,
        name: String(item.nickname || '一位炉网友'),
        originalName: String(item.equippedBadge?.label || ''),
        cardImageUrl: String(item.avatarUrl || ''),
        leaderboardPosition: Number(item.rank || 0),
        flowerTotal: Number(item.flowerTotal || 0),
        flowerMeta: item.topGiftedPlayer
          ? `最支持 ${item.topGiftedPlayer.name}·花${item.topGiftedPlayer.flowerTotal}` : '',
        isFan: true
      });
      this.setData({
        loading: false,
        failed: false,
        players,
        visiblePlayers: players,
        hasMore: false,
        deliveryState: entries.length ? (value.delivery?.state === 'current' ? 'live' : 'delayed') : '',
        deliveryMessage: entries.length ? '送花榜已更新' : '',
        dataAsOf: value?.dataAsOf || ''
      });
    } catch {
      this.setData({ loading: false, failed: true, players: [], visiblePlayers: [] });
    }
  },

  openFlowerEntry(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = Number.isSafeInteger(index) ? this.data.visiblePlayers[index] : null;
    if (!item || item.isFan) return;
    this.openPlayer(event);
  },

  async loadFollowLeaderboard(options = {}) {
    const append = Boolean(options.append);
    this.setData(append ? { loadingMore: true, failed: false } : { loading: true, failed: false });
    const pageSize = this.data.pageSize;
    const offset = append ? this.data.offset : 0;
    try {
      const value = await this.followService.leaderboard({
        tour: this.data.followTour,
        limit: pageSize,
        offset
      });
      const players = leaderboardEntries(value);
      const mergedPlayers = append ? this.data.players.concat(players) : players;
      const nextOffset = value?.payload?.nextOffset;
      this.setData({
        loading: false,
        loadingMore: false,
        failed: mergedPlayers.length === 0,
        players: mergedPlayers,
        offset: Number.isSafeInteger(Number(nextOffset)) ? Number(nextOffset)
          : offset + players.length,
        hasMore: Boolean(value?.payload?.hasMore),
        deliveryState: players.length ? (
          value.delivery?.state === 'current' ? 'live' : 'delayed'
        ) : '',
        deliveryMessage: players.length ? '关注榜已更新' : '',
        dataAsOf: value?.dataAsOf || ''
      }, () => this.filter());
    } catch {
      this.setData({
        loading: false,
        loadingMore: false,
        failed: true,
        players: append ? this.data.players : [],
        visiblePlayers: append ? this.data.visiblePlayers : [],
        deliveryState: '',
        deliveryMessage: '',
        dataAsOf: ''
      });
    }
  },

  onH2hInput(event) {
    const side = event.currentTarget.dataset.side === 'second' ? 'second' : 'first';
    const keys = h2hKeys(side);
    const query = String(event.detail.value || '');
    if (this.h2hSearchTimers?.[side]) clearTimeout(this.h2hSearchTimers[side]);
    this.setData({
      [keys.input]: query,
      [keys.playerId]: '',
      [keys.selected]: null,
      [keys.options]: [],
      [keys.searchMessage]: '',
      h2hEmpty: false,
      h2hFailed: false,
      h2hMessage: '',
      h2hResult: null
    });
    const trimmed = query.trim();
    if (!trimmed) {
      this.setData({ [keys.searching]: false });
      return;
    }
    const sequence = (this.h2hSearchSeq[side] || 0) + 1;
    this.h2hSearchSeq[side] = sequence;
    this.h2hSearchTimers[side] = setTimeout(() => {
      void this.loadH2hOptions(side, trimmed, sequence);
    }, 220);
  },

  async loadH2hOptions(side, query, sequence) {
    const keys = h2hKeys(side);
    this.setData({ [keys.searching]: true, [keys.searchMessage]: '' });
    const cacheKey = playerSearchCacheKey(this.data.authority, query, 8);
    const cached = readTrustedProjection(this.cache, cacheKey, PLAYER_SEARCH_CACHE_SCHEMA);
    if (cached?.payload) {
      const options = h2hSearchOptions(cached.payload);
      this.setData({
        [keys.searching]: false,
        [keys.options]: options,
        [keys.searchMessage]: options.length ? '' : '没有找到这个球员'
      });
    }
    try {
      const result = await loadProjectionResource({
        http: this.http,
        cache: this.cache,
        resourceKey: cacheKey,
        schemaVersion: PLAYER_SEARCH_CACHE_SCHEMA,
        path: `/api/v2/bff/player-basic-profiles/${encodeURIComponent(this.data.authority)}`
          + `?q=${encodeURIComponent(query)}&limit=8`,
        requestOptions: {
          authMode: 'none',
          header: { 'x-luwang-client-contract-version': PLAYER_SEARCH_CONTRACT }
        },
        metadata: { dataAsOf: value => value?.dataAsOf || value?.delivery?.dataAsOf || '' },
        validate(value) {
          if (value?.bffContractVersion !== PLAYER_SEARCH_CONTRACT) {
            throw new Error('player_search_projection_invalid');
          }
          return value;
        }
      });
      if (this.h2hSearchSeq?.[side] !== sequence
        || String(this.data[keys.input] || '').trim() !== query) return;
      const options = h2hSearchOptions(result.value);
      this.setData({
        [keys.searching]: false,
        [keys.options]: options,
        [keys.searchMessage]: options.length ? '' : '没有找到这个球员'
      });
    } catch {
      if (this.h2hSearchSeq?.[side] !== sequence) return;
      if (cached?.payload) {
        this.setData({
          [keys.searching]: false,
          [keys.searchMessage]: ''
        });
        return;
      }
      this.setData({
        [keys.searching]: false,
        [keys.options]: [],
        [keys.searchMessage]: '球员搜索暂不可用'
      });
    }
  },

  selectH2hPlayer(event) {
    const side = event.currentTarget.dataset.side === 'second' ? 'second' : 'first';
    const index = Number(event.currentTarget.dataset.index);
    const keys = h2hKeys(side);
    const option = Number.isSafeInteger(index) ? this.data[keys.options][index] : null;
    if (!option) return;
    if (this.h2hSearchTimers?.[side]) clearTimeout(this.h2hSearchTimers[side]);
    this.setData({
      [keys.input]: option.name,
      [keys.playerId]: option.playerId,
      [keys.selected]: option,
      [keys.options]: [],
      [keys.searching]: false,
      [keys.searchMessage]: '',
      h2hEmpty: false,
      h2hFailed: false,
      h2hMessage: ''
    });
  },

  async resolveH2hSelection(side) {
    const keys = h2hKeys(side);
    const existing = this.data[keys.selected];
    if (existing?.playerId && String(existing.name || '') === String(this.data[keys.input] || '')) {
      return existing;
    }
    if (this.data[keys.playerId]) {
      return {
        playerId: this.data[keys.playerId],
        name: this.data[keys.input],
        originalName: ''
      };
    }
    const query = String(this.data[keys.input] || '').trim();
    if (!query) return null;
    const result = await loadProjectionResource({
      http: this.http,
      cache: this.cache,
      resourceKey: playerSearchCacheKey(this.data.authority, query, 8),
      schemaVersion: PLAYER_SEARCH_CACHE_SCHEMA,
      path: `/api/v2/bff/player-basic-profiles/${encodeURIComponent(this.data.authority)}`
        + `?q=${encodeURIComponent(query)}&limit=8`,
      requestOptions: {
        authMode: 'none',
        header: { 'x-luwang-client-contract-version': PLAYER_SEARCH_CONTRACT }
      },
      metadata: { dataAsOf: value => value?.dataAsOf || value?.delivery?.dataAsOf || '' },
      validate(value) {
        if (value?.bffContractVersion !== PLAYER_SEARCH_CONTRACT) {
          throw new Error('player_search_projection_invalid');
        }
        return value;
      }
    });
    const options = h2hSearchOptions(result.value);
    const exact = options.find(option => matchesTypedPlayer(option, query));
    const selected = exact || (options.length === 1 ? options[0] : null);
    if (!selected) {
      this.setData({
        [keys.options]: options,
        [keys.searchMessage]: options.length ? '请选择下拉结果中的球员' : '没有找到这个球员'
      });
      return null;
    }
    this.setData({
      [keys.input]: selected.name,
      [keys.playerId]: selected.playerId,
      [keys.selected]: selected,
      [keys.options]: [],
      [keys.searchMessage]: ''
    });
    return selected;
  },

  async searchH2h() {
    const first = String(this.data.h2hPlayer1 || '').trim();
    const second = String(this.data.h2hPlayer2 || '').trim();
    if (!first || !second) {
      this.setData({ h2hEmpty: false, h2hFailed: true, h2hMessage: '请输入两位球员姓名' });
      return;
    }
    if (first === second) {
      this.setData({ h2hEmpty: false, h2hFailed: true, h2hMessage: '请选择两位不同球员' });
      return;
    }
    this.setData({ h2hLoading: true, h2hEmpty: false, h2hFailed: false, h2hMessage: '' });
    try {
      const firstSelection = await this.resolveH2hSelection('first');
      const secondSelection = await this.resolveH2hSelection('second');
      if (!firstSelection || !secondSelection) {
        this.setData({
          h2hLoading: false,
          h2hEmpty: true,
          h2hFailed: false,
          h2hMessage: '请从下拉结果选择两位球员'
        });
        return;
      }
      if (samePlayerOption(firstSelection, secondSelection)) {
        this.setData({
          h2hLoading: false,
          h2hEmpty: false,
          h2hFailed: true,
          h2hMessage: '请选择两位不同球员'
        });
        return;
      }
      const cacheKey = playerH2hCacheKey(
        this.data.authority,
        firstSelection.playerId,
        secondSelection.playerId
      );
      const cached = readTrustedProjection(this.cache, cacheKey, PLAYER_H2H_CACHE_SCHEMA);
      if (cached?.payload) {
        const cachedResult = h2hResult(cached.payload, {
          firstName: firstSelection.name,
          secondName: secondSelection.name
        });
        this.setData({
          h2hLoading: false,
          h2hEmpty: !cachedResult,
          h2hFailed: false,
          h2hMessage: cachedResult ? '已显示上次交手记录，正在刷新' : '暂无交手记录',
          h2hResult: cachedResult
        });
      }
      const response = await loadProjectionResource({
        http: this.http,
        cache: this.cache,
        resourceKey: cacheKey,
        schemaVersion: PLAYER_H2H_CACHE_SCHEMA,
        path: `/api/v2/bff/player-h2h?authority=${encodeURIComponent(this.data.authority)}`
          + `&player1=${encodeURIComponent(firstSelection.playerId)}`
          + `&player2=${encodeURIComponent(secondSelection.playerId)}`,
        requestOptions: {
          authMode: 'none',
          header: { 'x-luwang-client-contract-version': PLAYER_H2H_CACHE_SCHEMA }
        },
        metadata: { dataAsOf: value => value?.dataAsOf || value?.delivery?.dataAsOf || '' },
        validate(value) {
          if (value?.bffContractVersion !== PLAYER_H2H_CACHE_SCHEMA) {
            throw new Error('player_h2h_projection_invalid');
          }
          return value;
        }
      });
      const result = h2hResult(response.value, {
        firstName: firstSelection.name,
        secondName: secondSelection.name
      });
      this.setData({
        h2hLoading: false,
        h2hEmpty: !result,
        h2hFailed: false,
        h2hMessage: result ? '' : '暂无交手记录',
        h2hResult: result
      });
    } catch (err) {
      const statusCode = Number(err?.statusCode);
      const code = String(err?.code || err?.message || '');
      const notFound = statusCode === 404 || code === 'player_h2h_not_found';
      if (this.data.h2hResult && !notFound) {
        this.setData({
          h2hLoading: false,
          h2hEmpty: false,
          h2hFailed: false,
          h2hMessage: '刷新暂未成功，已保留上次交手记录'
        });
        return;
      }
      this.setData({
        h2hLoading: false,
        h2hEmpty: notFound,
        h2hFailed: !notFound,
        h2hMessage: notFound ? '暂无交手记录' : '交手记录暂不可用',
        h2hResult: null
      });
    }
  },

  openPlayer(event) {
    const index = Number(event.currentTarget.dataset.index);
    const visiblePlayer = Number.isSafeInteger(index) ? this.data.visiblePlayers[index] : null;
    const player = visiblePlayer
      || this.data.players.find(item => String(item.id) === String(event.currentTarget.dataset.id));
    if (!player || player.profileAvailable === false) {
      wx.showToast({ title: '球员资料稍后补齐', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/packages/player/pages/player-detail/index?playerId=${encodeURIComponent(player.id)}`
        + `&name=${encodeURIComponent(player.name)}`
        + `&originalName=${encodeURIComponent(player.originalName || '')}`
        + `&countryCode=${encodeURIComponent(player.countryCode)}`
        + `&tour=${encodeURIComponent(player.tour)}`
        + `&position=${encodeURIComponent(player.position || '')}`
        + `&points=${encodeURIComponent(player.points || '')}`
        + `&heroImageUrl=${encodeURIComponent(player.heroImageUrl || '')}`
        + `&portraitUrl=${encodeURIComponent(player.portraitUrl || '')}`
        + `&section=${encodeURIComponent(this.data.section)}`
    });
  },

  async togglePlayerFollow(event) {
    const targetId = String(event.currentTarget.dataset.id || '').trim();
    const next = event.currentTarget.dataset.followed === true
      || event.currentTarget.dataset.followed === 'true';
    if (!targetId) return;
    const update = (list, overrideCount = null) => list.map(player => {
      if (player.followTargetId !== targetId) return player;
      const nextCount = overrideCount === null
        ? Math.max(0, followCountValue(player.followCount) + (next ? 1 : -1))
        : followCountValue(overrideCount);
      return {
        ...player,
        followed: next,
        followCount: nextCount,
        followCountLabel: followCountText(nextCount),
        source: followCountText(nextCount)
      };
    });
    const previousPlayers = this.data.players;
    const previousVisible = this.data.visiblePlayers;
    this.setData({
      players: update(this.data.players),
      visiblePlayers: update(this.data.visiblePlayers)
    });
    try {
      const result = await getApp().services.follow.setFollow(
        'player',
        targetId,
        next,
        this.data.section === 'follows' ? 'player_follow_leaderboard' : 'player_ranking'
      );
      if (Number.isFinite(Number(result?.followCount))) {
        this.setData({
          players: update(this.data.players, result.followCount),
          visiblePlayers: update(this.data.visiblePlayers, result.followCount)
        });
      }
    } catch (err) {
      this.setData({ players: previousPlayers, visiblePlayers: previousVisible });
      if (String(err?.message || '') !== 'follow_login_cancelled') {
        wx.showToast({ title: '关注状态暂未保存', icon: 'none' });
      }
    }
  }
});
