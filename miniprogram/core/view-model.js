'use strict';

const localization = require('./localization');
const { mediaUrl } = require('./media');
const { beijingClock } = require('./schedule-date');

const FILTERS = Object.freeze([
  { id: 'all', label: '全部' },
  { id: 'in_progress', label: '进行中' },
  { id: 'ended', label: '已完成' },
  { id: 'followed', label: '我的关注' }
]);

const LEVEL_PRIORITY = Object.freeze({
  grand_slam: 10000,
  masters_1000: 9000,
  wta_1000: 9000,
  tour_500: 8000,
  wta_500: 8000,
  tour_250: 7000,
  wta_250: 7000,
  challenger_175: 6175,
  challenger_125: 6125,
  wta_125: 6125,
  challenger_100: 6100,
  challenger_75: 6075,
  challenger_50: 6050,
  itf_m25: 5025,
  itf_w100: 5100,
  itf_w75: 5075,
  itf_w50: 5050,
  itf_w35: 5035,
  itf_m15: 5015,
  itf_w15: 5015
});

const TOUR_PRIORITY = Object.freeze({ 'ATP/WTA': 4, ATP: 3, WTA: 2, ITF: 1 });
const IOC_TO_ISO = Object.freeze({
  ARG: 'AR', AUS: 'AU', AUT: 'AT', BEL: 'BE', BLR: 'BY', BRA: 'BR',
  BUL: 'BG', CAN: 'CA', CHI: 'CL', CHN: 'CN', COL: 'CO', CRO: 'HR',
  CZE: 'CZ', DEN: 'DK', ECU: 'EC', EGY: 'EG', ESP: 'ES', EST: 'EE',
  FIN: 'FI', FRA: 'FR', GBR: 'GB', GEO: 'GE', GER: 'DE', GRE: 'GR',
  HUN: 'HU', IND: 'IN', IRL: 'IE', ISR: 'IL', ITA: 'IT', JPN: 'JP',
  KAZ: 'KZ', KOR: 'KR', LAT: 'LV', LTU: 'LT', MEX: 'MX', NED: 'NL',
  NOR: 'NO', NZL: 'NZ', POL: 'PL', POR: 'PT', ROU: 'RO', RSA: 'ZA',
  RUS: 'RU', SLO: 'SI', SRB: 'RS', SUI: 'CH', SVK: 'SK', SWE: 'SE',
  TPE: 'TW', TUN: 'TN', TUR: 'TR', UKR: 'UA', URU: 'UY', USA: 'US'
});

function countryFlag(value) {
  const source = String(value || '').trim().toUpperCase();
  const code = source.length === 2 ? source : IOC_TO_ISO[source];
  if (!code || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map(letter =>
    127397 + letter.charCodeAt(0)));
}

function field(field) {
  return field && field.state === 'available' && field.value !== null
    ? String(field.value)
    : typeof field?.message === 'string' ? field.message : '';
}

function availableField(field) {
  return field && field.state === 'available' && field.value !== null
    ? field.value
    : null;
}

function numberField(field, positive = false) {
  return field && field.state === 'available' && Number.isFinite(field.value)
    && (!positive || Number(field.value) > 0)
    ? Number(field.value)
    : null;
}

function member(member) {
  const chinese = availableField(member.displayNameZh);
  const original = availableField(member.displayNameOriginal);
  const unavailableName = field(member.displayNameZh)
    || field(member.displayNameOriginal);
  const ranking = numberField(member.ranking, true);
  const countryCode = availableField(member.countryCode) === null
    ? '' : String(availableField(member.countryCode));
  const portrait = member.portraitAvailability?.state === 'available'
    ? member.portraitAvailability.value || {} : {};
  const portraitAssetKey = String(portrait.publicAssetKey || '');
  const portraitUrl = mediaUrl(member.portraitAvailability, { size: '96' });
  const portraitDetailUrl = mediaUrl(member.portraitAvailability, { size: '240' });
  const portraitShareUrl = mediaUrl(member.portraitAvailability, { size: '720' });
  return Object.freeze({
    playerId: availableField(member.playerId) === null
      ? '' : String(availableField(member.playerId)),
    name: String(chinese || original || unavailableName || ''),
    originalName: original === null ? '' : String(original),
    countryCode,
    // Unknown rankings are still rendered explicitly so list and detail pages
    // share the same player-fact contract instead of silently hiding data gaps.
    countryLabel: countryCode,
    countryMark: countryFlag(countryCode),
    ranking,
    rankingLabel: ranking === null ? '暂无排名' : `世界排名 ${ranking}`,
    portraitAvailable: member.portraitAvailability?.state === 'available',
    portraitAssetKey,
    portraitUrl,
    portraitDetailUrl,
    portraitShareUrl
  });
}

function displayPoint(value) {
  const source = String(value ?? '').trim();
  const normalized = source.toLocaleLowerCase('en-US');
  if (normalized === 'advantage' || normalized === 'ad' || normalized === 'a') {
    return 'Ad';
  }
  if (normalized === 'love') return '0';
  return source;
}

function tournamentLogo(assetKey, levelCode, tournamentName) {
  const normalizedLevelCode = localization.normalizeLevelCode(levelCode);
  const logos = Object.freeze({
    'tour-logo:atp-1000': ['/assets/atp-1000.png', 'atp-1000'],
    'tour-logo:atp-500': ['/assets/atp-500.png', 'atp-500'],
    'tour-logo:atp-250': ['/assets/atp-250.png', 'atp-250'],
    'tour-logo:atp-challenger': ['/assets/atp-challenger.png', 'atp-challenger'],
    'tour-logo:wta-1000': ['/assets/wta-1000.png', 'wta-1000'],
    'tour-logo:wta-500': ['/assets/wta-500.png', 'wta-500'],
    'tour-logo:wta-250': ['/assets/wta-250.png', 'wta-250'],
    'tour-logo:wta-125': ['/assets/wta-125.png', 'wta-125'],
    'tournament-logo:grand-slam:roland-garros': [
      '/assets/grand-slam-roland-garros.png', 'grand-slam'
    ],
    'tournament-logo:grand-slam:us-open': [
      '/assets/grand-slam-us-open.png', 'grand-slam'
    ],
    'tournament-logo:grand-slam:wimbledon': [
      '/assets/grand-slam-wimbledon.png', 'grand-slam'
    ],
    'tournament-logo:grand-slam:australian-open': [
      '/assets/grand-slam-australian-open.png', 'grand-slam'
    ]
  });
  const levelAssets = Object.freeze({
    masters_1000: 'tour-logo:atp-1000',
    tour_500: 'tour-logo:atp-500',
    tour_250: 'tour-logo:atp-250',
    challenger_175: 'tour-logo:atp-challenger',
    challenger_125: 'tour-logo:atp-challenger',
    challenger_100: 'tour-logo:atp-challenger',
    challenger_75: 'tour-logo:atp-challenger',
    challenger_50: 'tour-logo:atp-challenger',
    wta_1000: 'tour-logo:wta-1000',
    wta_500: 'tour-logo:wta-500',
    wta_250: 'tour-logo:wta-250',
    wta_125: 'tour-logo:wta-125'
  });
  const levelAssetKey = levelAssets[normalizedLevelCode] || '';
  const requestedKey = String(assetKey || '') || levelAssetKey;
  const logo = logos[requestedKey] || logos[levelAssetKey];
  if (logo) return Object.freeze({ path: logo[0], kind: logo[1] });
  if (normalizedLevelCode === 'grand_slam') {
    const name = String(tournamentName || '').toLocaleLowerCase('en-US');
    const slamKey = /roland garros|french open|罗兰加洛斯|法国网球公开赛|法网/u.test(name)
      ? 'tournament-logo:grand-slam:roland-garros'
      : /us open|美国网球公开赛|美网/u.test(name)
        ? 'tournament-logo:grand-slam:us-open'
        : /wimbledon|温布尔登|温网/u.test(name)
          ? 'tournament-logo:grand-slam:wimbledon'
          : /australian open|澳大利亚网球公开赛|澳大利亚公开赛|澳网/u.test(name)
            ? 'tournament-logo:grand-slam:australian-open'
            : '';
    const slamLogo = logos[slamKey];
    if (slamLogo) {
      return Object.freeze({ path: slamLogo[0], kind: slamLogo[1] });
    }
  }
  if (String(assetKey).startsWith('tour-logo:atp')) {
    return Object.freeze({ path: '/assets/atp-logo.svg', kind: 'atp' });
  }
  if (String(assetKey).startsWith('tour-logo:wta')) {
    return Object.freeze({ path: '/assets/wta-logo.svg', kind: 'wta' });
  }
  return Object.freeze({ path: '', kind: 'generic' });
}

function tournamentLogoAssetKeys(tournament) {
  const explicit = Array.isArray(tournament.logoAssetKeys)
    ? tournament.logoAssetKeys.filter(value => typeof value === 'string' && value)
    : [];
  if (explicit.length > 0) return Object.freeze([...new Set(explicit)]);
  const single = availableField(tournament.logoAssetKey);
  return single === null || !single ? Object.freeze([]) : Object.freeze([String(single)]);
}

function tournamentLogos(assetKeys, levelCode, tournamentName) {
  return Object.freeze(assetKeys
    .map(key => tournamentLogo(key, levelCode, tournamentName))
    .filter(logo => logo.path));
}

function disciplineLabel(discipline, tourOrg, levelCode) {
  if (['mixed', 'mixed_doubles'].includes(discipline)) return '混双';
  const normalizedLevelCode = localization.normalizeLevelCode(levelCode);
  const doubles = discipline === 'doubles';
  const women = tourOrg === 'WTA' || /^itf_w/u.test(normalizedLevelCode);
  const men = tourOrg === 'ATP' || /^itf_m/u.test(normalizedLevelCode)
    || /^challenger_/u.test(normalizedLevelCode);
  if (women) return doubles ? '女双' : '女单';
  if (men) return doubles ? '男双' : '男单';
  return localization.disciplineLabel(discipline);
}

function side(value, match, index, scoreSets, currentGame) {
  const members = value.members.map(member);
  const isDoubles = members.length === 2;
  const names = members.map(item => item.name).join(' / ');
  const countryLabels = [...new Set(members
    .map(item => item.countryLabel)
    .filter(Boolean))];
  const countryCodes = [...new Set(members
    .map(item => item.countryCode)
    .filter(Boolean))];
  const rankLabels = [...new Set(members
    .map(item => item.rankingLabel)
    .filter(Boolean))];
  const isWinner = match.ui.showWinStamp && match.ui.winStampSideId === value.sideId;
  const isServer = match.serve.availability === 'available'
    && match.serve.sideId === value.sideId
    && match.serve.displayMode !== 'hidden';
  const isLastPoint = match.lastPoint.availability === 'available'
    && match.lastPoint.highlightSideId === value.sideId;
  return Object.freeze({
    sideId: value.sideId,
    members,
    isDoubles,
    doublesRankingLabel: '',
    names,
    countryLabel: countryLabels.join(' / '),
    countryMark: countryCodes.map(countryFlag).filter(Boolean).join(''),
    rankLabel: rankLabels.join(' / '),
    seedLabel: numberField(value.seed, true) === null
      ? '' : `#${numberField(value.seed, true)}`,
    entryLabel: field(value.entryDesignation).toUpperCase(),
    isWinner,
    isServer,
    serveLabel: isServer
      ? match.serve.granularity === 'team' ? '发球队伍' : '发球方'
      : '',
    isLastPoint,
    setScores: Object.freeze(scoreSets.map(set => Object.freeze({
      value: index === 0 ? set.first : set.second,
      tiebreak: index === 0 ? set.firstTiebreak : set.secondTiebreak,
      current: set.current,
      matchTiebreak: set.kind === 'match_tiebreak'
    }))),
    currentPoint: currentGame === null
      ? '' : index === 0 ? currentGame.first : currentGame.second,
    currentPointHighlighted: currentGame !== null
      && (index === 0
        ? currentGame.firstHighlighted : currentGame.secondHighlighted),
    oddsLabel: match.odds && match.odds.state === 'available'
      ? Number.isFinite(index === 0
        ? match.odds.firstSideDecimal
        : match.odds.secondSideDecimal)
        && Number(index === 0
          ? match.odds.firstSideDecimal
          : match.odds.secondSideDecimal) > 0
        ? Number(index === 0
          ? match.odds.firstSideDecimal
          : match.odds.secondSideDecimal).toFixed(2)
        : ''
      : '',
    preOddsLabel: match.odds?.preMatch && match.odds.preMatch.state === 'available'
      ? Number.isFinite(index === 0
        ? match.odds.preMatch.firstSideDecimal
        : match.odds.preMatch.secondSideDecimal)
        ? Number(index === 0
          ? match.odds.preMatch.firstSideDecimal
          : match.odds.preMatch.secondSideDecimal).toFixed(2)
        : ''
      : '',
    liveOddsLabel: match.odds?.live && match.odds.live.state === 'available'
      ? Number.isFinite(index === 0
        ? match.odds.live.firstSideDecimal
        : match.odds.live.secondSideDecimal)
        ? Number(index === 0
          ? match.odds.live.firstSideDecimal
          : match.odds.live.secondSideDecimal).toFixed(2)
        : ''
      : ''
  });
}

function scoreSet(value) {
  const displayKindLabel = typeof value.displayKindLabel === 'string'
    ? value.displayKindLabel
    : '';
  return Object.freeze({
    setNumber: value.setNumber,
    kind: value.kind,
    first: String(value.firstSideGames),
    second: String(value.secondSideGames),
    firstTiebreak: value.firstSideTiebreakPoints === null
      ? '' : String(value.firstSideTiebreakPoints),
    secondTiebreak: value.secondSideTiebreakPoints === null
      ? '' : String(value.secondSideTiebreakPoints),
    current: value.state === 'in_progress',
    winnerSide: Number.isFinite(value.winnerSide) ? Number(value.winnerSide) : null,
    tiebreakTargetPoints: Number.isFinite(value.tiebreakTargetPoints)
      ? Number(value.tiebreakTargetPoints)
      : null,
    matchTiebreakTargetPoints: Number.isFinite(value.matchTiebreakTargetPoints)
      ? Number(value.matchTiebreakTargetPoints)
      : null,
    kindLabel: displayKindLabel || (value.kind === 'match_tiebreak'
      ? '抢10'
      : value.kind === 'short' ? '短盘' : '')
  });
}

function scoreRulesView(value) {
  const rules = value && typeof value === 'object' ? value : {};
  const bestOfSets = Number(rules.bestOfSets);
  const setsToWin = Number(rules.setsToWin);
  const matchTiebreakTargetPoints = Number(rules.matchTiebreakTargetPoints);
  const finalSetTiebreakTargetPoints = Number(rules.finalSetTiebreakTargetPoints);
  const regularTiebreakTargetPoints = Number(rules.regularTiebreakTargetPoints);
  const gameRule = rules.gameRule === 'no_ad'
    ? 'no_ad'
    : rules.gameRule === 'advantage' ? 'advantage' : '';
  const formatTarget = target => Number.isFinite(target) ? `抢${target}` : '';
  const decidingLabel = rules.decidingSetIsMatchTiebreak === true
    ? Number.isFinite(matchTiebreakTargetPoints)
      ? `决胜盘${formatTarget(matchTiebreakTargetPoints)}`
      : ''
    : Number.isFinite(finalSetTiebreakTargetPoints) && finalSetTiebreakTargetPoints !== 7
      ? `决胜盘${formatTarget(finalSetTiebreakTargetPoints)}`
      : '';
  const setLabel = bestOfSets === 5 && setsToWin === 3
    ? '五盘三胜'
    : bestOfSets === 3 && setsToWin === 2 ? '三盘两胜' : '';
  const gameLabel = gameRule === 'no_ad' ? '无占先' : '';
  const summary = [setLabel, decidingLabel, gameLabel].filter(Boolean).join(' · ');
  return Object.freeze({
    rulesVersion: typeof rules.rulesVersion === 'string' ? rules.rulesVersion : '',
    ruleProfileKey: typeof rules.ruleProfileKey === 'string' ? rules.ruleProfileKey : '',
    frontendDisplayProfile: typeof rules.frontendDisplayProfile === 'string'
      ? rules.frontendDisplayProfile : '',
    bestOfSets: Number.isFinite(bestOfSets) ? bestOfSets : null,
    setsToWin: Number.isFinite(setsToWin) ? setsToWin : null,
    regularTiebreakTargetPoints: Number.isFinite(regularTiebreakTargetPoints)
      ? regularTiebreakTargetPoints : null,
    finalSetTiebreakTargetPoints: Number.isFinite(finalSetTiebreakTargetPoints)
      ? finalSetTiebreakTargetPoints : null,
    decidingSetIsMatchTiebreak: rules.decidingSetIsMatchTiebreak === true,
    matchTiebreakTargetPoints: Number.isFinite(matchTiebreakTargetPoints)
      ? matchTiebreakTargetPoints : null,
    gameRule,
    gameRuleLabel: gameLabel,
    summary
  });
}

function sideScoreCells(sets, sideIndex) {
  return Object.freeze(sets.map(set => Object.freeze({
    setNumber: set.setNumber,
    value: sideIndex === 0 ? set.first : set.second,
    tiebreak: sideIndex === 0 ? set.firstTiebreak : set.secondTiebreak,
    current: set.current,
    matchTiebreak: set.kind === 'match_tiebreak',
    kindLabel: set.kindLabel
  })));
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
        updatedAt: value.updatedAt || ''
      })
    : null;
}

function contextualStatusText(match, preMatch) {
  if (preMatch) return '';
  const statusLabel = String(match.status.label || '').trim();
  const scheduleLabel = String(
    match.schedule.displayText || match.schedule.displayTimeLabel || ''
  ).trim();
  if (!scheduleLabel) return statusLabel;
  const scheduleText = /[0-9]/u.test(scheduleLabel)
    && !/开赛$/u.test(scheduleLabel)
    ? `${scheduleLabel}开赛`
    : scheduleLabel;
  return [statusLabel, scheduleText].filter(Boolean).join(' ');
}

function followCountText(value, unit = '人已关注') {
  const number = Number(value);
  return `${Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0}${unit}`;
}

function matchView(match, options = {}) {
  const includeModules = options.includeModules !== false;
  const scoreVisible = !['hidden', 'not_played'].includes(match.score.displayMode);
  const currentGame = match.score.currentGame;
  const stage = match.competitionContext?.stage || 'unknown';
  const round = match.competitionContext?.round || 'unknown';
  const stageText = localization.stageLabel(stage);
  const roundText = localization.roundLabel(round);
  const tournamentName = field(match.tournament.displayNameZh);
  const tournamentLocationValue = availableField(match.tournament.locationNameZh);
  const tournamentLocation = tournamentLocationValue === null
    ? '' : String(tournamentLocationValue);
  const tournamentCountry = availableField(match.tournament.countryNameZh);
  const tournamentLogoAssetKey = availableField(match.tournament.logoAssetKey);
  const tournamentLogoAssetKeyList = tournamentLogoAssetKeys(match.tournament);
  const courtValue = availableField(match.court.displayNameZh);
  const venueValue = availableField(match.venue.displayNameZh);
  const court = courtValue === null ? '其他场次' : String(courtValue);
  const venue = venueValue === null ? '' : String(venueValue);
  const groupingCourt = availableField(match.grouping.courtKey);
  const sets = Object.freeze(match.score.sets.map(scoreSet));
  const scoringRules = scoreRulesView(match.score.rules);
  const game = currentGame === null ? null : Object.freeze({
    kind: currentGame.kind,
    first: displayPoint(currentGame.firstSidePoints),
    second: displayPoint(currentGame.secondSidePoints),
    firstHighlighted: match.lastPoint.availability === 'available'
      && match.lastPoint.highlightSideId === match.participants[0].sideId,
    secondHighlighted: match.lastPoint.availability === 'available'
      && match.lastPoint.highlightSideId === match.participants[1].sideId,
    decidingPointLabel: scoringRules.gameRule === 'no_ad'
      && currentGame.kind === 'standard'
      && displayPoint(currentGame.firstSidePoints) === '40'
      && displayPoint(currentGame.secondSidePoints) === '40'
      ? '决胜分' : ''
  });
  const tournamentLevelCode = localization.normalizeLevelCode(
    match.tournament.levelCode || 'unknown'
  ) || 'unknown';
  const tournamentTourOrg = match.tournament.tourOrg;
  const viewerFollowState = match.viewerFollowState || {};
  const sides = Object.freeze(match.participants.map((value, index) =>
    side(value, match, index, sets, game)));
  const liveOdds = oddsLine(match.odds?.live || match.odds);
  const preMatchOdds = oddsLine(match.odds?.preMatch || match.odds);
  const preMatch = match.status.group.code === 'upcoming';
  const contextStatusText = contextualStatusText(match, preMatch);
  const matchFollowCount = Number(
    viewerFollowState.match?.followCount ?? match.followCount ?? 0
  );
  return Object.freeze({
    id: match.matchId,
    template: match.ui.templateId,
    statusCode: match.status.code,
    statusLabel: match.status.label,
    statusTone: match.status.statusTone,
    group: match.status.group.code,
    discipline: match.discipline,
    disciplineLabel: disciplineLabel(
      match.discipline,
      tournamentTourOrg,
      tournamentLevelCode
    ),
    stage,
    stageLabel: stageText,
    roundLabel: roundText,
    qualifyingLabel: stage === 'qualifying' ? stageText : '',
    // displayText carries business semantics such as "随上场结束". The
    // lower-level clock label intentionally stays generic when no clock exists.
    scheduleText: match.schedule.displayText || match.schedule.displayTimeLabel,
    officialScheduleDate: /^\d{4}-\d{2}-\d{2}$/u.test(String(
      match.schedule.officialScheduleDate || match.schedule.scheduleGroupDate || ''
    )) ? String(match.schedule.officialScheduleDate || match.schedule.scheduleGroupDate) : '',
    scheduleGroupDate: match.schedule.scheduleGroupDate,
    venueLocalDateTime: field(match.schedule.venueLocalDateTime),
    scheduleStartAt: availableField(match.schedule.venueLocalDateTime) || '',
    tournamentName,
    tournamentId: String(match.tournament.id || ''),
    tournamentTourOrg,
    tournamentSortPriority: numberField(match.tournament.sortPriority),
    tournamentClassificationStatus: match.tournament.classificationStatus,
    tournamentLevel: localization.levelLabel(tournamentLevelCode),
    tournamentLevelCode,
    tournamentLocation,
    tournamentCountry: tournamentCountry === null
      ? '' : String(tournamentCountry),
    tournamentLogoAssetKey: tournamentLogoAssetKey === null
      ? '' : String(tournamentLogoAssetKey),
    tournamentLogoAssetKeys: tournamentLogoAssetKeyList,
    surface: match.surface.code === 'unknown'
      ? '' : match.surface.displayNameZh,
    surfaceCode: match.surface.code,
    court,
    courtSortOrder: numberField(match.court.sortOrder),
    venue,
    sides,
    hasSeed: sides.some(value => Boolean(value.seedLabel)),
    hasIdentityBadge: sides.some(value => Boolean(value.seedLabel || value.entryLabel)),
    scoreVisible,
    scoreMode: match.score.displayMode,
    scorePlaceholder: match.score.annotation || '',
    annotation: match.score.annotation || '',
    scoringRules,
    scoringSummary: scoringRules.summary,
    sets,
    leftScoreCells: sideScoreCells(sets, 0),
    rightScoreCells: sideScoreCells(sets, 1),
    currentGame: game,
    dataDeliveryState: match.delivery.state,
    // Delivery health is a page-level concern. Repeating the same transport
    // sentence on every card obscures scores and looks like match metadata.
    deliveryNotice: '',
    dataAsOf: match.delivery.dataAsOf,
    updatedTime: beijingClock(match.delivery.dataAsOf),
    preMatch,
    contextStatusText,
    showLivePulse: match.delivery.showLivePulse,
    groupingTournamentKey: match.grouping.tournamentKey,
    groupingCourtKey: groupingCourt === null
      ? `unavailable-court:${match.grouping.tournamentKey}`
      : String(groupingCourt),
    odds: liveOdds,
    preMatchOdds,
    liveOdds,
    followed: viewerFollowState.match?.followed === true,
    followTargetId: viewerFollowState.match?.targetId || match.matchId,
    followCount: Number.isFinite(matchFollowCount) && matchFollowCount >= 0
      ? Math.floor(matchFollowCount) : 0,
    followCountLabel: followCountText(matchFollowCount),
    tournamentFollowState: viewerFollowState.tournament || null,
    playerFollowStates: Array.isArray(viewerFollowState.players)
      ? viewerFollowState.players : [],
    ...(includeModules && match.modules !== undefined ? { modules: match.modules } : {})
  });
}

function filtered(matches, filter, followedIds, query, options = {}) {
  const byFilter = filter === 'all'
    ? matches
    : filter === 'followed'
      ? matches.filter(match => match.followed || followedIds.has(match.id))
      : matches.filter(match => match.group === filter);
  const byDetails = byFilter.filter(match =>
    (!options.tourOrg || options.tourOrg === 'all'
      || match.tournamentTourOrg === options.tourOrg)
    && (!options.discipline || options.discipline === 'all'
      || (options.discipline === 'doubles'
        ? ['doubles', 'mixed_doubles', 'mixed'].includes(match.discipline)
        : match.discipline === options.discipline)));
  const search = String(query || '').trim().toLocaleLowerCase('zh-CN');
  if (!search) return byDetails;
  return byDetails.filter(match => [
    match.tournamentName,
    match.tournamentLocation,
    match.court,
    match.roundLabel,
    ...match.sides.flatMap(side => side.members.flatMap(player => [
      player.name, player.originalName
    ]))
  ].some(value => String(value).toLocaleLowerCase('zh-CN').includes(search)));
}

function groupedMatches(projection, filter, followedIds, query = '', options = {}) {
  const matches = filtered(
    projection.payload.matches.map(match => {
      const value = matchView(match, { includeModules: false });
      const override = options.followOverrides instanceof Map
        ? options.followOverrides.get(value.id) : undefined;
      const countOverride = options.followCountOverrides instanceof Map
        ? options.followCountOverrides.get(value.id) : undefined;
      const followCount = Number.isFinite(Number(countOverride))
        ? Math.max(0, Math.floor(Number(countOverride)))
        : value.followCount;
      return Object.freeze({
        ...value,
        followed: override === undefined
          ? value.followed || followedIds.has(value.id)
          : override === true,
        followCount,
        followCountLabel: followCountText(followCount)
      });
    }),
    filter,
    followedIds,
    query,
    options
  );
  const tournaments = new Map();
  for (const match of matches) {
    const tournamentKey = match.groupingTournamentKey;
    if (!tournaments.has(tournamentKey)) {
      const logos = tournamentLogos(
        match.tournamentLogoAssetKeys,
        match.tournamentLevelCode,
        match.tournamentName
      );
      const fallbackLogo = logos[0] || tournamentLogo(
        match.tournamentLogoAssetKey,
        match.tournamentLevelCode,
        match.tournamentName
      );
      tournaments.set(tournamentKey, {
        id: tournamentKey,
        name: match.tournamentName,
        location: match.tournamentLocation,
        title: match.tournamentLocation || match.tournamentName,
        subtitle: [match.tournamentCountry, match.tournamentName, match.surface]
          .filter(Boolean).join(' · '),
        logoAssetKey: match.tournamentLogoAssetKey,
        logoAssetKeys: [...match.tournamentLogoAssetKeys],
        logos,
        logoPath: fallbackLogo.path,
        logoKind: fallbackLogo.kind,
        venue: match.venue,
        followTargetId: match.tournamentFollowState?.targetId || tournamentKey,
        followed: match.tournamentFollowState?.followed === true,
        tourOrg: match.tournamentTourOrg === 'UNKNOWN'
          ? '' : match.tournamentTourOrg,
        tourOrgs: match.tournamentTourOrg === 'UNKNOWN'
          ? [] : [match.tournamentTourOrg],
        level: match.tournamentLevel,
        levelCode: match.tournamentLevelCode,
        surfaceCode: ['hard', 'clay', 'grass'].includes(match.surfaceCode)
          ? match.surfaceCode : 'neutral',
        sortPriority: match.tournamentSortPriority,
        originalIndex: tournaments.size,
        courts: new Map()
      });
    }
    const tournament = tournaments.get(tournamentKey);
    for (const key of match.tournamentLogoAssetKeys) {
      if (!tournament.logoAssetKeys.includes(key)) tournament.logoAssetKeys.push(key);
    }
    tournament.logos = tournamentLogos(
      tournament.logoAssetKeys,
      tournament.levelCode,
      tournament.name
    );
    const firstLogo = tournament.logos[0] || {
      path: tournament.logoPath,
      kind: tournament.logoKind
    };
    tournament.logoPath = firstLogo.path;
    tournament.logoKind = tournament.logos.length > 1 ? 'joint' : firstLogo.kind;
    if (match.tournamentTourOrg !== 'UNKNOWN'
      && !tournament.tourOrgs.includes(match.tournamentTourOrg)) {
      tournament.tourOrgs.push(match.tournamentTourOrg);
      tournament.tourOrg = tournament.tourOrgs.join('/');
    }
    if (match.tournamentFollowState?.followed === true) tournament.followed = true;
    const courtKey = match.groupingCourtKey;
    if (!tournament.courts.has(courtKey)) {
      tournament.courts.set(courtKey, {
        id: courtKey,
        name: match.court,
        sortOrder: match.courtSortOrder,
        originalIndex: tournament.courts.size,
        matches: []
      });
    }
    tournament.courts.get(courtKey).matches.push(match);
  }
  const orderedTournaments = [...tournaments.values()].sort((first, second) => {
    const firstLevel = LEVEL_PRIORITY[localization.normalizeLevelCode(first.levelCode)] || 0;
    const secondLevel = LEVEL_PRIORITY[localization.normalizeLevelCode(second.levelCode)] || 0;
    if (firstLevel !== secondLevel) return secondLevel - firstLevel;
    const firstTour = TOUR_PRIORITY[first.tourOrg] || 0;
    const secondTour = TOUR_PRIORITY[second.tourOrg] || 0;
    if (firstTour !== secondTour) return secondTour - firstTour;
    if (first.sortPriority !== null && second.sortPriority !== null
      && first.sortPriority !== second.sortPriority) {
      return second.sortPriority - first.sortPriority;
    }
    if (first.sortPriority !== null && second.sortPriority === null) return -1;
    if (first.sortPriority === null && second.sortPriority !== null) return 1;
    return first.originalIndex - second.originalIndex;
  });
  return Object.freeze(orderedTournaments.map(tournament =>
    Object.freeze({
      ...tournament,
      courts: Object.freeze([...tournament.courts.values()]
        .sort((first, second) => {
          if (first.sortOrder !== null && second.sortOrder !== null
            && first.sortOrder !== second.sortOrder) {
            return first.sortOrder - second.sortOrder;
          }
          if (first.sortOrder !== null && second.sortOrder === null) return -1;
          if (first.sortOrder === null && second.sortOrder !== null) return 1;
          return first.originalIndex - second.originalIndex;
        }).map(court =>
        Object.freeze({ ...court, matches: Object.freeze(court.matches.sort((first, second) => {
          const firstTime = Date.parse(first.scheduleStartAt);
          const secondTime = Date.parse(second.scheduleStartAt);
          if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime !== secondTime) {
            return firstTime - secondTime;
          }
          if (Number.isFinite(firstTime) && !Number.isFinite(secondTime)) return -1;
          if (!Number.isFinite(firstTime) && Number.isFinite(secondTime)) return 1;
          return String(first.id).localeCompare(String(second.id));
        })) })))
    })));
}

module.exports = Object.freeze({
  FILTERS,
  field,
  availableField,
  scoreRulesView,
  matchView,
  groupedMatches
});
