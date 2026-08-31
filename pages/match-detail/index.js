'use strict';

const { buildThemeData, syncPageTheme } = require('../../core/theme');
const { createSWRCache } = require('../../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../../core/projection-resource');

const contracts = require('../../core/contracts');
const { enablePageShare, matchShare } = require('../../core/share');
const { goBackOrHome } = require('../../core/back-navigation');
const { matchView } = require('../../core/view-model');
const { beijingClock, beijingDateTime } = require('../../core/schedule-date');
const { StatisticsStore } = require('../../core/statistics-store');
const { StatisticsClient } = require('../../services/statistics-client');
const {
  statisticsModuleState,
  statisticsView
} = require('../../core/statistics-view-model');
const {
  PointByPointStore
} = require('../../core/point-by-point-store');
const {
  PointByPointClient
} = require('../../services/point-by-point-client');
const { pointByPointView } = require('../../core/point-by-point-view-model');
const { fallbackModule, modulesView, moduleView } = require('../../core/detail-modules');
const config = require('../../config');

function known(candidate) {
  return candidate?.state === 'known' ? candidate.value : null;
}

const TERMINAL_STATUS_CODES = Object.freeze(new Set([
  'finished', 'retired', 'walkover', 'defaulted', 'disqualified',
  'no_show', 'cancelled', 'abandoned'
]));
const MATCH_DETAIL_CACHE_SCHEMA = 'match-detail-bff/1';
const MATCH_ODDS_CACHE_SCHEMA = 'match-odds-bff/1';
const MATCH_H2H_CACHE_SCHEMA = 'match-h2h-bff/1';
const MATCH_PROGRESSION_CACHE_SCHEMA = 'match-progression-path-bff/1';

function matchDetailCacheKey(matchId) {
  return `match_detail:${String(matchId || '')}`;
}

function matchOddsCacheKey(matchId) {
  return `match_odds:${String(matchId || '')}`;
}

function matchH2hCacheKey(pairKey) {
  return `match_h2h:${String(pairKey || '')}`;
}

function matchProgressionCacheKey(matchId) {
  return `match_progression:${String(matchId || '')}`;
}

function instantMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function rawStatusPriority(presentation) {
  const code = presentation?.status?.code;
  const group = presentation?.status?.group?.code;
  if (TERMINAL_STATUS_CODES.has(code) || group === 'ended') return 4;
  if (['live', 'interrupted', 'suspended'].includes(code) || group === 'in_progress') return 3;
  if (['delayed', 'postponed'].includes(code)) return 2;
  if (group === 'upcoming' || code === 'scheduled') return 1;
  return 0;
}

function viewStatusPriority(match) {
  const code = match?.statusCode;
  if (TERMINAL_STATUS_CODES.has(code) || match?.group === 'ended') return 4;
  if (['live', 'interrupted', 'suspended'].includes(code) || match?.group === 'in_progress') {
    return 3;
  }
  if (['delayed', 'postponed'].includes(code)) return 2;
  if (match?.group === 'upcoming' || code === 'scheduled') return 1;
  return 0;
}

function staleComparedToCurrent(presentation, current) {
  if (!current || presentation?.matchId !== current.id) return false;
  const incomingAt = instantMs(presentation.delivery?.dataAsOf ?? presentation.score?.observedAt);
  const currentAt = instantMs(current.dataAsOf);
  return Number.isFinite(incomingAt)
    && Number.isFinite(currentAt)
    && incomingAt < currentAt
    && rawStatusPriority(presentation) <= viewStatusPriority(current);
}

function displayDateTime(value) {
  const source = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(source)) return source;
  const parsed = Date.parse(source);
  if (!Number.isFinite(parsed)) return source;
  const hasClock = /T|\d{1,2}:\d{2}/u.test(source);
  return hasClock ? beijingDateTime(parsed) : beijingDateTime(parsed).slice(0, 10);
}

function h2hView(value, match) {
  const payload = value?.payload?.h2h;
  if (value?.bffContractVersion !== 'h2h-bff/1'
    || !Array.isArray(payload?.playerIds)
    || payload.playerIds.length !== 2) return null;
  const aggregate = known(payload.observedAggregate);
  const sideNames = Array.isArray(payload.sideNames) && payload.sideNames.length === 2
    ? payload.sideNames
    : match.sides.map(side => side.names);
  return Object.freeze({
    names: Object.freeze(sideNames),
    firstWins: aggregate === null ? null : aggregate.player1Wins,
    secondWins: aggregate === null ? null : aggregate.player2Wins,
    total: aggregate?.countedEncounterCount ?? 0,
    complete: payload.completeness === 'complete',
    encounters: Object.freeze((payload.encounters || []).map(encounter => Object.freeze({
      id: encounter.matchId,
      date: displayDateTime(known(encounter.occurredOn) || ''),
      tournament: known(encounter.tournamentDisplayNameZh)
        || known(encounter.tournamentDisplayName) || '',
      round: known(encounter.roundDisplayNameZh) || known(encounter.roundDisplayName) || '',
      level: known(encounter.levelDisplayNameZh) || known(encounter.level) || '',
      surface: known(encounter.surfaceDisplayNameZh) || known(encounter.surface) || '',
      result: known(encounter.resultDisplay) || '',
      winner: known(encounter.winnerNameZh)
        || (known(encounter.winnerSide) === 1
          ? sideNames[0]
          : known(encounter.winnerSide) === 2
            ? sideNames[1] : '')
    }))),
    deliveryState: value.delivery?.state || 'checking',
    deliveryMessage: value.delivery?.message || '',
    dataAsOf: value.dataAsOf || ''
  });
}

function emptyH2hView(match) {
  return Object.freeze({
    names: Object.freeze(match.sides.map(side => side.names)),
    firstWins: 0,
    secondWins: 0,
    total: 0,
    complete: false,
    encounters: Object.freeze([]),
    deliveryState: 'delayed',
    deliveryMessage: '暂无已收录的正式比赛交手',
    dataAsOf: ''
  });
}

function pointByPointWithActive(view, activeSetNumber) {
  if (!view || !Array.isArray(view.sets) || view.sets.length === 0) return view;
  const fallback = view.sets.find(set => set.isCurrent)?.setNumber
    ?? view.sets[view.sets.length - 1].setNumber;
  const active = view.sets.some(set => set.setNumber === activeSetNumber)
    ? activeSetNumber : fallback;
  const sets = view.sets.map(set => Object.freeze({
    ...set,
    isActive: set.setNumber === active
  }));
  return Object.freeze({
    ...view,
    activeSetNumber: active,
    sets: Object.freeze(sets),
    activeSet: sets.find(set => set.setNumber === active) || sets[0]
  });
}

function h2hPairKey(match) {
  if (match?.discipline === 'singles' && scorecardMatchId(match.id)) {
    return `match:${match.id}:${match.sides.map(side => side.names).join(':')}`;
  }
  const ids = match?.sides?.map(side => side.members?.[0]?.playerId || '') || [];
  return match?.discipline === 'singles'
    && ids.length === 2
    && ids.every(id => /^[A-Za-z0-9_-]{1,80}$/.test(id))
    ? ids.join(':') : '';
}

function h2hNeedsFetch(view) {
  if (!view) return true;
  if (Array.isArray(view.encounters) && view.encounters.length > 0) return false;
  return Number(view.total || 0) === 0;
}

function scorecardMatchId(value) {
  return /^[0-9a-f-]{36}$/.test(value)
    || /^sc_[0-9a-f]{32}$/i.test(value);
}

function followCountValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function matchFollowCountText(value) {
  return `${followCountValue(value)}人已关注`;
}

function followablePlayers(match) {
  const tour = String(match?.tournamentTourOrg || '').toUpperCase();
  if (tour !== 'ATP' && tour !== 'WTA') return [];
  return (match?.sides || []).flatMap(side => (side.members || []).map(member => {
    const targetId = member.followTargetId || (member.playerId ? `${tour}:${member.playerId}` : '');
    return {
      targetId,
      name: member.name || member.originalName || '球员',
      originalName: member.originalName || '',
      followed: member.followed === true,
      followState: member.followState || 'unknown'
    };
  })).filter(item => item.targetId);
}

function matchWithPlayerFollowState(match) {
  const states = new Map((match?.playerFollowStates || [])
    .map(item => [String(item.sourcePlayerId || ''), item]));
  const tour = String(match?.tournamentTourOrg || '').toUpperCase();
  if (tour !== 'ATP' && tour !== 'WTA') return match;
  const sides = (match?.sides || []).map(side => {
    const members = (side.members || []).map(member => {
      const state = states.get(member.playerId) || {};
      const targetId = state.targetId || (member.playerId ? `${tour}:${member.playerId}` : '');
      return {
        ...member,
        followTargetId: targetId,
        followed: false,
        followState: 'unknown'
      };
    });
    const primary = members.length === 1 && members[0].followTargetId ? members[0] : null;
    return {
      ...side,
      members,
      primaryFollowTargetId: primary?.followTargetId || '',
      primaryFollowed: primary?.followed === true,
      primaryFollowState: primary?.followState || 'unknown'
    };
  });
  return { ...match, sides };
}

function matchWithUpdatedPlayerFollow(match, targetId, followed, followState = '') {
  if (!match) return match;
  const sides = (match.sides || []).map(side => {
    const members = (side.members || []).map(member =>
      member.followTargetId === targetId
        ? { ...member, followed, followState: followState || (followed ? 'followed' : 'not_followed') }
        : member);
    const primary = members.length === 1 && members[0].followTargetId ? members[0] : null;
    return {
      ...side,
      members,
      primaryFollowed: primary?.followed === true,
      primaryFollowState: primary?.followState || 'unknown'
    };
  });
  return { ...match, sides };
}

function matchWithResolvedFollowStates(match, states) {
  if (!match || !(states instanceof Map)) return match;
  const matchKey = `match:${match.id}`;
  let next = states.has(matchKey)
    ? {
        ...match,
        followed: states.get(matchKey) === true,
        followState: states.get(matchKey) === true ? 'followed' : 'not_followed'
      }
    : { ...match, followState: match.followState || 'unknown' };
  for (const player of followablePlayers(next)) {
    const key = `player:${player.targetId}`;
    if (states.has(key)) next = matchWithUpdatedPlayerFollow(next, player.targetId, states.get(key) === true);
  }
  return next;
}

function oddsLabel(value, sideIndex) {
  if (!value || value.state !== 'available') return '';
  const number = Number(sideIndex === 0
    ? value.firstSideDecimal : value.secondSideDecimal);
  return Number.isFinite(number) && number > 0 ? number.toFixed(2) : '';
}

function oddsLine(value) {
  return value && value.state === 'available'
    && Number.isFinite(value.firstSideDecimal)
    && Number.isFinite(value.secondSideDecimal)
    && value.firstSideDecimal > 0
    && value.secondSideDecimal > 0
    ? Object.freeze({
        first: Number(value.firstSideDecimal).toFixed(2),
        second: Number(value.secondSideDecimal).toFixed(2),
        updatedAt: value.updatedAt || value.dataAsOf || ''
      })
    : null;
}

function matchWithOddsProjection(match, projection) {
  if (!match || projection?.matchId !== match.id) return match;
  const odds = projection.payload?.odds || projection.display?.odds;
  if (!odds) return match;
  const preMatch = odds.preMatch || odds;
  const live = odds.live || odds.preMatch || odds;
  return Object.freeze({
    ...match,
    odds: oddsLine(live),
    preMatchOdds: oddsLine(preMatch),
    liveOdds: oddsLine(live),
    sides: Object.freeze((match.sides || []).map((side, index) => Object.freeze({
      ...side,
      oddsLabel: oddsLabel(live, index),
      preOddsLabel: oddsLabel(preMatch, index),
      liveOddsLabel: oddsLabel(live, index)
    })))
  });
}

function available(candidate) {
  return candidate?.state === 'available' && candidate.value !== null
    ? candidate.value : null;
}

function participantName(slot) {
  const participant = slot?.participant;
  return available(participant?.displayNameZh)
    || available(participant?.displayNameOriginal)
    || (slot?.state === 'bye' ? '轮空' : '对手待确定');
}

function progressionView(presentation, match) {
  const rounds = new Map((presentation.rounds || []).map(round => [round.roundId, round]));
  const slots = new Map((presentation.slots || []).map(slot => [slot.slotId, slot]));
  const sideKeys = match.sides.map(side => Object.freeze({
    name: side.names,
    sideId: side.sideId,
    playerIds: side.members.map(member => member.playerId).filter(Boolean)
  }));
  const paths = sideKeys.map(side => {
    const entries = [];
    for (const node of presentation.matches || []) {
      const pair = node.slotIds.map(id => slots.get(id));
      const ownIndex = pair.findIndex(slot => {
        const participant = slot?.participant;
        return participant?.participantSideId === side.sideId
          || (participant?.playerIds || []).some(id => side.playerIds.includes(id));
      });
      if (ownIndex < 0) continue;
      const round = rounds.get(node.roundId);
      entries.push(Object.freeze({
        id: node.nodeId,
        sequence: round?.sequence || 999,
        round: round?.displayNameZh || '比赛轮次',
        opponent: participantName(pair[ownIndex === 0 ? 1 : 0]),
        scoreText: String(node.scoreText || '').trim(),
        status: node.statusLabel || '赛况暂缺',
        current: available(node.matchId) === match.id,
        advanced: available(node.advancingSideId) === side.sideId
          || available(node.winnerSideId) === side.sideId
      }));
    }
    entries.sort((first, second) => first.sequence - second.sequence);
    return Object.freeze({ name: side.name, entries: Object.freeze(entries) });
  });
  return paths.some(path => path.entries.length)
    ? Object.freeze({ sourceKind: 'draw_presentation', paths: Object.freeze(paths) }) : null;
}

function readyProgression(value, match) {
  const presentationProgression = value?.presentation
    ? progressionView(value.presentation, match)
    : null;
  const source = value?.progression || value;
  let pathsProgression = null;
  if (Array.isArray(source?.paths)) {
    const paths = source.paths.map(path => Object.freeze({
      name: String(path.name || ''),
      entries: Object.freeze((path.entries || []).map(entry => Object.freeze({
        id: String(entry.id || ''),
        round: String(entry.round || '比赛轮次'),
        opponent: String(entry.opponent || '对手待确定'),
        scoreText: String(entry.scoreText || entry.result || '').trim(),
        status: String(entry.status || '赛况暂缺'),
        current: Boolean(entry.current),
        advanced: Boolean(entry.advanced)
      })))
    }));
    pathsProgression = paths.some(path => path.entries.length)
      ? Object.freeze({ sourceKind: 'server_paths', paths: Object.freeze(paths) }) : null;
  }
  return preferProgression(pathsProgression, presentationProgression);
}

function progressionEntryCount(value) {
  return (value?.paths || []).reduce(
    (total, path) => total + (path.entries || []).length,
    0
  );
}

function preferProgression(current, candidate, matchChanged = false) {
  if (matchChanged) return candidate || null;
  if (!candidate) return current || null;
  if (!current) return candidate;
  const currentCount = progressionEntryCount(current);
  const candidateCount = progressionEntryCount(candidate);
  if (candidateCount !== currentCount) return candidateCount > currentCount ? candidate : current;
  if (current.sourceKind === 'draw_presentation' && candidate.sourceKind !== 'draw_presentation') return current;
  if (candidate.sourceKind === 'draw_presentation' && current.sourceKind !== 'draw_presentation') return candidate;
  return candidate;
}

function progressionNeedsFullDraw(value) {
  return value?.sourceKind !== 'draw_presentation';
}

Page({
  data: {
    ...buildThemeData(),
    topInset: 44,
    loading: true,
    failed: false,
    match: null,
    tabs: [],
    activeTab: 'statistics',
    moduleState: null,
    moduleUpdatedTime: '',
    statistics: null,
    activeStatisticsPeriod: 'ALL',
    statisticsTransportState: 'connecting',
    statisticsTransportMessage: '正在建立统计实时连接',
    pointByPoint: null,
    activePointSetNumber: null,
    pointByPointTransportState: 'connecting',
    pointByPointTransportMessage: '正在建立逐分实时连接',
    h2h: null,
    h2hLoadState: 'idle',
    oddsLoadState: 'idle',
    progression: null,
    progressionLoadState: 'idle',
    followablePlayers: [],
    giftOpen: false,
    giftAmount: '1',
    giftSubmitting: false,
    giftPlayer: null,
    giftResult: null,
  },

  onLoad(options) {
    syncPageTheme(this);
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.matchId = options.matchId || '';
    this.requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(options.date || '')
      ? options.date : '';
    this.setData({ topInset: info.statusBarHeight || 44 });
    this.services = getApp().services;
    this.viewerFollowStates = new Map();
    this.unsubscribeFollow = this.services.follow.subscribe?.(change => {
      if (change?.batch) return;
      if (!change?.key || !this.data.match) return;
      const targets = new Set([
        `match:${this.data.match.id}`,
        ...followablePlayers(this.data.match).map(player => `player:${player.targetId}`)
      ]);
      if (!targets.has(change.key)) return;
      if (change.value === 'followed' || change.value === 'not_followed') {
        this.viewerFollowStates.set(change.key, change.value === 'followed');
      } else {
        this.viewerFollowStates.delete(change.key);
      }
      const resolved = matchWithResolvedFollowStates(this.data.match, this.viewerFollowStates);
      this.setData({ match: resolved, followablePlayers: followablePlayers(resolved) });
    });
    this.cache = createSWRCache(wx);
    this.unsubscribeScore = this.services.scoreStore.subscribe(projection => {
      const value = projection?.payload.matches.find(item => item.matchId === this.matchId);
      if (value) this.applyMatch(value, { socialAuthority: false });
    });
    void this.loadMatch();
  },

  onShow() {
    this.matchDetailVisible = true;
    syncPageTheme(this);
    enablePageShare();
    this.ensureScoreStream(this.data.match);
    this.scheduleMatchDetailCalibration();
    this.statisticsClient?.onShow();
    this.completionClient?.onShow();
    if (this.data.match) void this.refreshViewerFollowStates(this.data.match);
  },
  onHide() {
    this.matchDetailVisible = false;
    this.clearMatchDetailCalibration();
    this.statisticsClient?.onHide();
    this.completionClient?.onHide();
  },

  onUnload() {
    this.matchDetailVisible = false;
    this.clearMatchDetailCalibration();
    this.unsubscribeScore?.();
    this.unsubscribeStatistics?.();
    this.unsubscribeStatisticsState?.();
    this.statisticsClient?.stop();
    this.unsubscribeCompletion?.();
    this.unsubscribeCompletionState?.();
    this.unsubscribeFollow?.();
    this.completionClient?.stop();
  },

  onShareAppMessage() {
    if (this.data.giftResult?.gift) {
      const gift = this.data.giftResult.gift;
      const badge = this.data.giftResult.awardedBadge;
      return {
        title: badge ? `我获得了「${badge.label}」` : `我在炉网送给${gift.playerName} ${gift.amount} 朵花`,
        path: `/packages/player/pages/player-detail/index?playerId=${encodeURIComponent(this.data.giftPlayer.sourcePlayerId)}&tour=${encodeURIComponent(this.data.match.tournamentTourOrg)}&name=${encodeURIComponent(gift.playerName)}`,
      };
    }
    return matchShare(this.data.match, {
      matchId: this.matchId,
      date: this.requestedDate,
    }).appMessage;
  },

  onShareTimeline() {
    if (this.data.giftResult?.gift) {
      const gift = this.data.giftResult.gift;
      return {
        title: `我在炉网支持${gift.playerName}·花${gift.amount}`,
        query: `matchId=${encodeURIComponent(this.matchId)}&date=${encodeURIComponent(this.requestedDate || '')}`,
      };
    }
    return matchShare(this.data.match, {
      matchId: this.matchId,
      date: this.requestedDate,
    }).timeline;
  },

  onPullDownRefresh() {
    void this.refreshLatest()
      .catch(() => wx.showToast({ title: '刷新失败，已保留当前详情', icon: 'none' }))
      .finally(() => wx.stopPullDownRefresh());
  },

  async refreshLatest() {
    const match = this.data.match;
    const jobs = [
      this.loadMatch({ force: true, showLoading: false }),
      this.refreshScoreStream(),
      this.statisticsClient?.refreshNow?.(),
      this.completionClient?.refreshNow?.(),
      match ? this.loadOdds(match, { force: true }) : null,
      match && match.discipline === 'singles' ? this.loadH2h(match, { force: true }) : null,
      match ? this.loadProgression(match, { force: true }) : null
    ].filter(Boolean);
    const results = await Promise.allSettled(jobs);
    if (results.length && results.every(result => result.status === 'rejected')) {
      throw new Error('match_detail_refresh_failed');
    }
  },

  clearMatchDetailCalibration() {
    if (this.matchDetailCalibrationTimer !== undefined
      && this.matchDetailCalibrationTimer !== null) {
      clearTimeout(this.matchDetailCalibrationTimer);
    }
    this.matchDetailCalibrationTimer = null;
  },

  scheduleMatchDetailCalibration() {
    this.clearMatchDetailCalibration();
    if (this.matchDetailVisible !== true) return;
    const delay = Number(config.matchDetailCalibrationMilliseconds) || 20_000;
    this.matchDetailCalibrationTimer = setTimeout(() => {
      this.matchDetailCalibrationTimer = null;
      if (this.matchDetailVisible !== true) return;
      void this.loadMatch({ force: true, showLoading: false })
        .finally(() => this.scheduleMatchDetailCalibration());
    }, delay);
  },

  async refreshScoreStream() {
    const match = this.data.match;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(match?.scheduleGroupDate || '')
      ? match.scheduleGroupDate
      : this.requestedDate;
    if (!date) return null;
    await this.services.scoreClient.ensure(date);
    return this.services.scoreClient.refreshNow('match_detail_manual_refresh');
  },

  async loadMatch(options = {}) {
    if (!scorecardMatchId(this.matchId)) {
      this.setData({ loading: false, failed: true });
      return;
    }
    const cacheKey = matchDetailCacheKey(this.matchId);
    const cached = options.force === true
      ? null : readTrustedProjection(this.cache, cacheKey, MATCH_DETAIL_CACHE_SCHEMA);
    if (cached?.payload) {
      try {
        this.applyMatch(contracts.matchProjection(cached.payload).payload, { socialAuthority: true });
        this.setData({ loading: false, failed: false });
      } catch { /* corrupt trusted cache is ignored and replaced by network */ }
    } else if (options.showLoading !== false) {
      this.setData({ loading: true, failed: false });
    } else {
      this.setData({ failed: false });
    }
    try {
      const refreshQuery = options.force ? `?_refresh=${Date.now()}` : '';
      const result = await loadProjectionResource({
        http: this.services.http,
        cache: this.cache,
        resourceKey: cacheKey,
        schemaVersion: MATCH_DETAIL_CACHE_SCHEMA,
        path: `/api/v1/bff/matches/${encodeURIComponent(this.matchId)}${refreshQuery}`,
        requestOptions: { authMode: 'none', noCache: options.force === true },
        force: options.force === true,
        metadata: { dataAsOf: value => value?.dataAsOf || value?.delivery?.dataAsOf || '' },
        validate: value => contracts.matchProjection(value)
      });
      const envelope = result.value;
      this.applyMatch(envelope.payload, { socialAuthority: true });
      this.setData({ loading: false, failed: false });
    } catch (error) {
      this.setData({ loading: false, failed: this.data.match === null });
      if (options.throwOnError) throw error;
    }
  },

  applyMatch(presentation, options = {}) {
    if (staleComparedToCurrent(presentation, this.data.match)) {
      if (options.socialAuthority === true) {
        const incoming = matchView(presentation);
        const followCount = followCountValue(incoming.followCount);
        this.services.scoreStore.updateSocial(incoming.id, { followCount });
        if (followCount !== followCountValue(this.data.match?.followCount)) {
          this.setData({
            match: {
              ...this.data.match,
              followCount,
              followCountLabel: matchFollowCountText(followCount)
            }
          });
        }
      }
      return;
    }
    const baseMatch = matchWithPlayerFollowState(matchView(presentation));
    if (options.socialAuthority === true) {
      this.services.scoreStore.updateSocial(baseMatch.id, {
        followCount: followCountValue(baseMatch.followCount)
      });
    }
    const targets = [
      { kind: 'match', targetId: baseMatch.id },
      ...followablePlayers(baseMatch).map(player => ({ kind: 'player', targetId: player.targetId }))
    ];
    const cachedStates = this.services.follow.cachedStates?.(targets) || new Map();
    for (const [key, state] of cachedStates) {
      if (state === 'followed' || state === 'not_followed') {
        this.viewerFollowStates.set(key, state === 'followed');
      }
    }
    const match = this.decorateMatchFlowers(matchWithResolvedFollowStates(
      baseMatch, this.viewerFollowStates
    ));
    const matchChanged = this.currentMatchId !== match.id;
    if (matchChanged) {
      this.currentMatchId = match.id;
      this.progressionRequested = false;
      this.oddsRequested = false;
    }
    const tabs = modulesView(presentation.modules).filter(tab =>
      match.discipline === 'singles' || tab.id !== 'h2h');
    const h2hContent = presentation.modules?.h2h?.content;
    const h2h = h2hContent
      ? h2hView(h2hContent, match)
      : matchChanged ? null : this.data.h2h;
    const progressionContent = presentation.modules?.progression_path?.content;
    const progressionCandidate = progressionContent
      ? readyProgression(progressionContent, match)
      : matchChanged ? null : this.data.progression;
    const progression = progressionContent
      ? preferProgression(this.data.progression, progressionCandidate, matchChanged)
      : progressionCandidate;
    const nextH2hPairKey = h2hPairKey(match);
    const h2hReset = nextH2hPairKey !== this.h2hPairKey
      ? { h2hLoadState: h2h ? 'content' : 'empty' }
      : {};
    if (nextH2hPairKey !== this.h2hPairKey) {
      this.h2hPairKey = nextH2hPairKey;
      this.h2hRequested = false;
    }
    this.setData({
      match,
      followablePlayers: followablePlayers(match),
      tabs,
      failed: false,
      h2h,
      progression,
      progressionLoadState: progression ? 'content' : 'empty',
      ...h2hReset
    }, () => {
      this.updateModuleState();
      void this.loadOdds(match);
      if (match.discipline === 'singles' && h2hNeedsFetch(this.data.h2h) && !this.h2hRequested) {
        void this.loadH2h(match, { background: true });
      }
      if (progressionNeedsFullDraw(this.data.progression) && !this.progressionRequested) {
        void this.loadProgression(match, { background: true });
      }
      void this.loadPlayerFlowers(match);
      if (matchChanged) void this.refreshViewerFollowStates(match);
    });
    this.ensureScoreStream(match);
    if (!this.statisticsClient) this.startStatistics(match);
    if (!this.completionClient) this.startPointByPoint(match);
  },

  ensureScoreStream(match) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(match?.scheduleGroupDate || '')
      ? match.scheduleGroupDate
      : this.requestedDate;
    if (!date || this.scoreStreamDate === date) return;
    this.scoreStreamDate = date;
    void this.services.scoreClient.ensure(date).catch(() => {
      if (this.scoreStreamDate === date) this.scoreStreamDate = '';
    });
  },

  async loadOdds(match, options = {}) {
    if (!match?.id) return null;
    if (this.oddsPending && options.force !== true) return this.oddsPending;
    this.oddsRequested = true;
    const cacheKey = matchOddsCacheKey(match.id);
    const cached = options.force === true
      ? null : readTrustedProjection(this.cache, cacheKey, MATCH_ODDS_CACHE_SCHEMA);
    if (cached?.payload) {
      try {
        const projection = contracts.oddsProjection(cached.payload);
        this.setData({
          match: matchWithOddsProjection(this.data.match, projection),
          oddsLoadState: 'content'
        });
      } catch { /* ignore corrupt local odds cache */ }
    } else {
      this.setData({ oddsLoadState: 'loading' });
    }
    const refreshQuery = options.force ? `?_refresh=${Date.now()}` : '';
    const request = loadProjectionResource({
      http: this.services.http,
      cache: this.cache,
      resourceKey: cacheKey,
      schemaVersion: MATCH_ODDS_CACHE_SCHEMA,
      path: `/api/v1/bff/matches/${encodeURIComponent(match.id)}/odds${refreshQuery}`,
      requestOptions: {
        authMode: 'none',
        noCache: options.force === true,
        header: { 'x-luwang-client-contract-version': 'match-odds-bff/1' }
      },
      force: options.force === true,
      metadata: { dataAsOf: value => value?.dataAsOf || value?.delivery?.dataAsOf || '' },
      validate: value => contracts.oddsProjection(value)
    }).then(result => {
      const projection = result.value;
      if (this.currentMatchId !== match.id) return null;
      this.setData({
        match: matchWithOddsProjection(this.data.match, projection),
        oddsLoadState: 'content'
      });
      return projection;
    }).catch(error => {
      if (String(error?.code || error?.message || '') !== 'odds_not_found') {
        this.setData({ oddsLoadState: this.data.match ? 'idle' : 'failed' });
      } else {
        this.setData({ oddsLoadState: 'empty' });
      }
      return null;
    }).finally(() => {
      if (this.oddsPending === request) this.oddsPending = null;
    });
    this.oddsPending = request;
    return request;
  },

  async loadProgression(match, options = {}) {
    this.progressionRequested = true;
    if (!match?.id) {
      this.setData({ progressionLoadState: 'empty' }, () => this.updateModuleState());
      return null;
    }
    if (this.progressionPending && options.force !== true) return this.progressionPending;
    const cacheKey = matchProgressionCacheKey(match.id);
    const cached = options.force === true
      ? null : readTrustedProjection(this.cache, cacheKey, MATCH_PROGRESSION_CACHE_SCHEMA);
    if (cached?.payload) {
      try {
        const projection = contracts.progressionProjection(cached.payload);
        const next = readyProgression(projection, match);
        this.setData({
          progression: preferProgression(this.data.progression, next),
          progressionLoadState: next ? 'content' : 'empty'
        }, () => this.updateModuleState());
      } catch { /* ignore corrupt local progression cache */ }
    } else {
      this.setData({
        progressionLoadState: this.data.progression ? 'content' : 'loading'
      }, () => this.updateModuleState());
    }
    const refreshQuery = options.force ? `?_refresh=${Date.now()}` : '';
    const request = loadProjectionResource({
      http: this.services.http,
      cache: this.cache,
      resourceKey: cacheKey,
      schemaVersion: MATCH_PROGRESSION_CACHE_SCHEMA,
      path: `/api/v1/bff/matches/${encodeURIComponent(match.id)}/progression-path${refreshQuery}`,
      requestOptions: {
        authMode: 'none',
        noCache: options.force === true,
        header: { 'x-luwang-client-contract-version': 'match-progression-path-bff/1' }
      },
      force: options.force === true,
      metadata: { dataAsOf: value => value?.dataAsOf || value?.delivery?.dataAsOf || '' },
      validate: value => contracts.progressionProjection(value)
    }).then(result => {
      const projection = result.value;
      if (this.currentMatchId !== match.id) return null;
      const next = readyProgression(projection, match);
      this.setData({
        progression: preferProgression(this.data.progression, next),
        progressionLoadState: next ? 'content' : 'empty'
      }, () => this.updateModuleState());
      return projection;
    }).catch(() => {
      if (this.currentMatchId !== match.id) return null;
      this.setData({
        progressionLoadState: this.data.progression ? 'content' : 'failed'
      }, () => this.updateModuleState());
      return null;
    }).finally(() => {
      if (this.progressionPending === request) this.progressionPending = null;
    });
    this.progressionPending = request;
    return request;
  },

  async loadH2h(match, options = {}) {
    const pairKey = h2hPairKey(match);
    this.h2hRequested = true;
    if (!pairKey) {
      this.setData({ h2hLoadState: 'empty' }, () => this.updateModuleState());
      return;
    }
    const cacheKey = matchH2hCacheKey(pairKey);
    const cached = options.force === true
      ? null : readTrustedProjection(this.cache, cacheKey, MATCH_H2H_CACHE_SCHEMA);
    if (cached?.payload) {
      const cachedH2h = h2hView(cached.payload, match);
      if (cachedH2h !== null) {
        this.setData({ h2h: cachedH2h, h2hLoadState: 'content' }, () => this.updateModuleState());
      }
    } else if (options.background !== true || this.data.activeTab === 'h2h') {
      this.setData({ h2hLoadState: 'loading' }, () => this.updateModuleState());
    }
    try {
      const requestOptions = {
        authMode: 'none',
        noCache: options.force === true,
        header: { 'x-luwang-client-contract-version': 'h2h-bff/1' }
      };
      const result = await loadProjectionResource({
        http: this.services.http,
        cache: this.cache,
        resourceKey: cacheKey,
        schemaVersion: MATCH_H2H_CACHE_SCHEMA,
        path: `/api/v1/bff/matches/${encodeURIComponent(match.id)}/h2h`,
        requestOptions,
        force: options.force === true,
        metadata: { dataAsOf: value => value?.dataAsOf || value?.delivery?.dataAsOf || '' },
        validate(value) {
          if (h2hView(value, match) === null) throw new Error('h2h_projection_invalid');
          return value;
        }
      });
      const h2h = h2hView(result.value, match);
      if (h2h === null) throw new Error('h2h_projection_invalid');
      if (this.h2hPairKey !== pairKey) return;
      this.setData({ h2h, h2hLoadState: 'content' }, () => this.updateModuleState());
    } catch {
      if (this.h2hPairKey !== pairKey) return;
      this.setData({
        h2h: this.data.h2h || emptyH2hView(match),
        h2hLoadState: 'content'
      }, () => this.updateModuleState());
    }
  },

  startPointByPoint(match) {
    const store = new PointByPointStore(this.matchId);
    const client = new PointByPointClient(
      wx,
      this.services.auth,
      this.services.http,
      store
    );
    this.completionStore = store;
    this.completionClient = client;
    this.unsubscribeCompletion = store.subscribe(projection => {
      const participantNames = match.sides.map(side => side.names);
      const nextPointByPoint = pointByPointWithActive(
        pointByPointView(projection, participantNames, match.scoringRules),
        this.data.activePointSetNumber
      );
      const changes = {
        pointByPoint: nextPointByPoint,
        activePointSetNumber: nextPointByPoint?.activeSetNumber ?? null
      };
      // The completion product already carries the server's latest trusted
      // live/final statistics. Use it immediately while the richer V2
      // post-match projection is absent or still loading; once V2 arrives it
      // remains authoritative and is not overwritten by this fallback.
      if (!this.v2StatisticsAvailable) {
        const fallback = statisticsView(projection, participantNames);
        if (fallback) changes.statistics = fallback;
      }
      this.setData(changes, () => this.updateModuleState());
    });
    this.unsubscribeCompletionState = client.subscribeTransport(state => {
      const messages = {
        connecting: '正在建立逐分实时连接',
        connected: '',
        reconnecting: '逐分正在重新连接，已有记录保持显示',
        offline: '逐分网络暂时不可用，已有记录保持显示'
      };
      this.setData({
        pointByPointTransportState: state,
        pointByPointTransportMessage: messages[state]
      });
    });
    void client.start().catch(() => this.updateModuleState());
  },

  startStatistics(match) {
    const store = new StatisticsStore(this.matchId);
    const client = new StatisticsClient(
      wx,
      this.services.auth,
      this.services.http,
      store
    );
    this.statisticsStore = store;
    this.statisticsClient = client;
    this.unsubscribeStatistics = store.subscribe(projection => {
      this.v2StatisticsAvailable = true;
      this.setData({
        statistics: statisticsView(projection, match.sides.map(side => side.names),
          this.data.activeStatisticsPeriod)
      }, () => this.updateModuleState());
    });
    this.unsubscribeStatisticsState = client.subscribeTransport(state => {
      const messages = {
        connecting: '正在建立统计实时连接',
        connected: '',
        reconnecting: '统计正在重新连接，已有内容保持显示',
        offline: '统计网络暂时不可用，已有内容保持显示'
      };
      this.setData({
        statisticsTransportState: state,
        statisticsTransportMessage: messages[state]
      }, () => this.updateModuleState());
    });
    void client.start().catch(() => this.updateModuleState());
  },

  updateModuleState() {
    const id = this.data.activeTab;
    const candidate = this.data.match?.modules?.[id];
    let declared = candidate?.id === id ? candidate : fallbackModule(id);
    if (id === 'statistics') {
      declared = statisticsModuleState(
        declared,
        this.data.statistics,
        this.data.statisticsTransportState
      );
    }
    if (id === 'point_by_point' && this.data.pointByPoint) {
      const delayed = this.data.pointByPoint.deliveryState !== 'live';
      declared = Object.freeze({
        id,
        label: '逐分',
        state: delayed ? 'delayed' : 'content',
        dataAsOf: this.data.pointByPoint.dataAsOf,
        message: delayed
          ? this.data.pointByPoint.deliveryMessage : '',
        retryable: false,
        hasTrustedContent: true,
        preservesLastTrustedContent: delayed
      });
    }
    if (id === 'h2h') {
      if (this.data.h2h) {
        const delayed = this.data.h2h.deliveryState !== 'current';
        declared = Object.freeze({
          id,
          label: '交手记录',
          state: delayed ? 'delayed' : 'content',
          dataAsOf: this.data.h2h.dataAsOf,
          message: delayed ? this.data.h2h.deliveryMessage : '',
          retryable: false,
          hasTrustedContent: true,
          preservesLastTrustedContent: delayed
        });
      } else if (this.data.h2hLoadState === 'loading') {
        declared = Object.freeze({ ...declared, state: 'loading', message: '交手记录加载中' });
      } else if (this.data.h2hLoadState === 'empty') {
        declared = Object.freeze({ ...declared, state: 'empty', message: '暂无可用交手记录' });
      } else {
        declared = Object.freeze({ ...declared, state: 'loading', message: '交手记录加载中' });
      }
    }
    if (id === 'progression_path') {
      if (this.data.progression) {
        declared = Object.freeze({
          id,
          label: '晋级之路',
          state: 'content',
          dataAsOf: null,
          message: null,
          retryable: false,
          hasTrustedContent: true,
          preservesLastTrustedContent: false
        });
      } else if (this.data.progressionLoadState === 'loading') {
        declared = Object.freeze({ ...declared, state: 'loading', message: '赛事签表加载中' });
      } else if (this.data.progressionLoadState === 'failed') {
        declared = Object.freeze({ ...declared, state: 'failed', message: '晋级路径加载失败', retryable: true });
      } else if (this.data.progressionLoadState === 'empty') {
        declared = Object.freeze({ ...declared, state: 'empty', message: '暂无晋级路径' });
      } else {
        declared = Object.freeze({ ...declared, state: 'loading', message: '赛事签表加载中' });
      }
    }
    this.setData({
      moduleState: moduleView(declared, id),
      moduleUpdatedTime: beijingClock(declared.dataAsOf)
    });
  },

  selectTab(event) {
    const activeTab = event.currentTarget.dataset.id;
    this.setData({ activeTab }, () => {
      this.updateModuleState();
      if (activeTab === 'h2h' && this.data.match
        && this.data.match.discipline === 'singles'
        && h2hNeedsFetch(this.data.h2h) && !this.h2hRequested) {
        void this.loadH2h(this.data.match);
      }
      if (activeTab === 'progression_path' && this.data.match
        && progressionNeedsFullDraw(this.data.progression) && !this.progressionRequested) {
        void this.loadProgression(this.data.match);
      }
    });
  },

  selectPointSet(event) {
    const setNumber = Number(event.currentTarget.dataset.set);
    if (!Number.isSafeInteger(setNumber) || !this.data.pointByPoint) return;
    this.setData({
      activePointSetNumber: setNumber,
      pointByPoint: pointByPointWithActive(this.data.pointByPoint, setNumber)
    });
  },

  selectStatisticsPeriod(event) {
    const period = String(event.currentTarget.dataset.period || 'ALL');
    if (!this.statisticsStore?.projection) return;
    this.setData({
      activeStatisticsPeriod: period,
      statistics: statisticsView(this.statisticsStore.projection,
        this.data.match.sides.map(side => side.names), period)
    });
  },

  retryModule() {
    if (this.data.activeTab === 'statistics') {
      void this.statisticsClient.fetchSnapshot()
        .then(() => this.statisticsClient.openRealtime())
        .catch(() => undefined);
    } else if (this.data.activeTab === 'point_by_point') {
      void this.completionClient.fetchSnapshot()
        .then(() => this.completionClient.openRealtime())
        .catch(() => undefined);
    } else if (this.data.activeTab === 'h2h') {
      void (this.data.match ? this.loadH2h(this.data.match) : this.loadMatch());
    } else if (this.data.activeTab === 'progression_path') {
      if (this.data.match) void this.loadProgression(this.data.match, { force: true });
    } else {
      void this.loadMatch();
    }
  },

  async toggleMatchFollow() {
    const match = this.data.match;
    if (!match?.id || match.followState === 'unknown') return;
    const next = !match.followed;
    this.viewerFollowStates?.set(`match:${match.id}`, next);
    const nextCount = Math.max(0, followCountValue(match.followCount) + (next ? 1 : -1));
    this.setData({
      match: {
        ...match,
        followed: next,
        followState: next ? 'followed' : 'not_followed',
        followCount: nextCount,
        followCountLabel: matchFollowCountText(nextCount)
      }
    });
    try {
      const result = await this.services.follow.setFollow('match', match.id, next, 'match_detail');
      if (Number.isFinite(Number(result?.followCount))) {
        const followCount = followCountValue(result.followCount);
        this.services.scoreStore.updateSocial(match.id, {
          followCount,
          followed: next
        });
        this.setData({
          match: {
            ...this.data.match,
            followCount,
            followCountLabel: matchFollowCountText(followCount)
          }
        });
      }
    } catch (err) {
      this.viewerFollowStates?.set(`match:${match.id}`, match.followed === true);
      this.setData({ match });
      if (String(err?.message || '') !== 'follow_login_cancelled') {
        wx.showToast({ title: '关注状态暂未保存', icon: 'none' });
      }
    }
  },

  async togglePlayerFollow(event) {
    const targetId = String(event.currentTarget.dataset.id || '').trim();
    const next = event.currentTarget.dataset.followed === true
      || event.currentTarget.dataset.followed === 'true';
    const current = this.data.followablePlayers.find(item => item.targetId === targetId);
    if (!targetId || current?.followState === 'unknown') return;
    this.viewerFollowStates?.set(`player:${targetId}`, next);
    const previousMatch = this.data.match;
    const previous = this.data.followablePlayers;
    this.setData({
      match: matchWithUpdatedPlayerFollow(previousMatch, targetId, next),
      followablePlayers: previous.map(item =>
        item.targetId === targetId
          ? { ...item, followed: next, followState: next ? 'followed' : 'not_followed' }
          : item)
    });
    try {
      await this.services.follow.setFollow('player', targetId, next, 'match_detail_player');
    } catch (err) {
      this.viewerFollowStates?.set(`player:${targetId}`, previous.some(item => item.targetId === targetId && item.followed));
      this.setData({ match: previousMatch, followablePlayers: previous });
      if (String(err?.message || '') !== 'follow_login_cancelled') {
        wx.showToast({ title: '关注状态暂未保存', icon: 'none' });
      }
    }
  },

  async refreshViewerFollowStates(match) {
    const follow = this.services?.follow;
    if (!match?.id || typeof follow?.followedTargets !== 'function') return;
    const players = followablePlayers(match);
    const targets = [
      { kind: 'match', targetId: match.id },
      ...players.map(player => ({ kind: 'player', targetId: player.targetId }))
    ];
    const requestId = Number(this.followStateRequestId || 0) + 1;
    this.followStateRequestId = requestId;
    try {
      const followed = await follow.followedTargets(targets);
      if (this.followStateRequestId !== requestId || this.data.match?.id !== match.id) return;
      for (const target of targets) {
        const key = `${target.kind}:${target.targetId}`;
        this.viewerFollowStates.set(key, followed.has(key));
      }
      const resolved = matchWithResolvedFollowStates(this.data.match, this.viewerFollowStates);
      this.setData({ match: resolved, followablePlayers: followablePlayers(resolved) });
    } catch { /* keep the last trusted local state while account status is unavailable */ }
  },

  decorateMatchFlowers(match) {
    const totals = this.playerFlowerTotals || {};
    return {
      ...match,
      sides: match.sides.map(side => ({
        ...side,
        members: side.members.map(member => ({
          ...member,
          flowerTotal: Number(totals[`${match.tournamentTourOrg}:${member.playerId}`] || 0)
        }))
      }))
    };
  },

  async loadPlayerFlowers(match) {
    if (!match || !['ATP', 'WTA'].includes(match.tournamentTourOrg)) return;
    const targets = match.sides.flatMap(side => side.members)
      .filter(member => member.playerId)
      .map(member => `${match.tournamentTourOrg}:${member.playerId}`);
    if (!targets.length) return;
    const signature = targets.slice().sort().join('|');
    if (this.playerFlowerSignature === signature) return;
    this.playerFlowerSignature = signature;
    let response;
    try {
      response = await this.services.social.matchPlayerSummaries(match.id);
    } catch {
      this.playerFlowerSignature = '';
      return;
    }
    const totals = { ...(this.playerFlowerTotals || {}) };
    (Array.isArray(response?.players) ? response.players : []).forEach(player => {
      const playerId = String(player?.playerId || '').trim();
      if (playerId) totals[playerId] = Number(player?.lifetimeFlowerTotal || 0);
    });
    this.playerFlowerTotals = totals;
    if (this.data.match?.id === match.id) {
      this.setData({ match: this.decorateMatchFlowers(this.data.match) });
    }
  },

  openGift(event) {
    const playerId = String(event.currentTarget.dataset.playerId || '').trim();
    const name = String(event.currentTarget.dataset.name || '球员').trim();
    const tour = String(this.data.match?.tournamentTourOrg || '').toUpperCase();
    if (!playerId || !['ATP', 'WTA'].includes(tour)) return;
    this.setData({
      giftOpen: true,
      giftAmount: '1',
      giftPlayer: { playerId: `${tour}:${playerId}`, sourcePlayerId: playerId, name },
      giftResult: null
    });
  },

  closeGift() {
    if (!this.data.giftSubmitting) this.setData({ giftOpen: false });
  },

  noop() {},

  onGiftAmount(event) {
    this.setData({ giftAmount: String(event.detail.value || '').replace(/\D/gu, '').slice(0, 6) });
  },

  async submitGift() {
    const amount = Number(this.data.giftAmount);
    const target = this.data.giftPlayer;
    if (!target || !Number.isSafeInteger(amount) || amount <= 0) {
      wx.showToast({ title: '请输入正整数', icon: 'none' });
      return;
    }
    this.setData({ giftSubmitting: true });
    try {
      const result = await this.services.social.gift(target.playerId, amount, 'match_detail');
      this.playerFlowerTotals = {
        ...(this.playerFlowerTotals || {}),
        [target.playerId]: Number(result.playerFlowerTotal || 0)
      };
      this.setData({
        giftSubmitting: false,
        giftResult: result,
        match: this.decorateMatchFlowers(this.data.match)
      });
    } catch (error) {
      this.setData({ giftSubmitting: false });
      if (!String(error?.message || '').includes('cancelled')) {
        wx.showToast({
          title: String(error?.message || '').includes('insufficient') ? '花朵余额不足' : '送花暂未成功',
          icon: 'none'
        });
      }
    }
  },

  openPlayerFromPortrait(event) {
    const playerId = String(event.currentTarget.dataset.playerId || '').trim();
    const tour = String(event.currentTarget.dataset.tour || this.data.match?.tournamentTourOrg || '')
      .trim()
      .toUpperCase();
    if (!playerId || (tour !== 'ATP' && tour !== 'WTA')) {
      wx.showToast({ title: '球员资料稍后补齐', icon: 'none' });
      return;
    }
    const name = String(event.currentTarget.dataset.name || '球员资料');
    const originalName = String(event.currentTarget.dataset.originalName || '');
    const countryCode = String(event.currentTarget.dataset.countryCode || '');
    const portraitUrl = String(event.currentTarget.dataset.portraitUrl || '');
    wx.navigateTo({
      url: `/packages/player/pages/player-detail/index?playerId=${encodeURIComponent(playerId)}`
        + `&name=${encodeURIComponent(name)}`
        + `&originalName=${encodeURIComponent(originalName)}`
        + `&countryCode=${encodeURIComponent(countryCode)}`
        + `&tour=${encodeURIComponent(tour)}`
        + `&portraitUrl=${encodeURIComponent(portraitUrl)}`
    });
  },

  back() { goBackOrHome(); }
});
