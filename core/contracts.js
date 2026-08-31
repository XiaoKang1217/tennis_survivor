'use strict';

const MATCH_STATUSES = Object.freeze([
  'scheduled', 'delayed', 'postponed', 'live', 'interrupted',
  'suspended', 'finished', 'retired', 'walkover', 'defaulted',
  'disqualified', 'no_show', 'cancelled', 'abandoned', 'unknown'
]);
const UI_TEMPLATES = Object.freeze([
  'scheduled', 'delayed_or_postponed', 'live',
  'interrupted_or_suspended', 'finished', 'special_result', 'unknown'
]);
const SCORE_DISPLAY_MODES = Object.freeze([
  'hidden', 'live', 'last_trusted', 'frozen', 'final', 'retired',
  'not_played', 'special_result', 'abandoned'
]);
const DELIVERY_STATES = Object.freeze([
  'live', 'current', 'recovering', 'calibrating', 'source_interrupted',
  'checking', 'delayed', 'stale', 'unavailable'
]);
const BUSINESS_GROUPS = Object.freeze([
  'upcoming', 'in_progress', 'ended', 'unknown'
]);
const MODULE_STATES = Object.freeze([
  'loading', 'content', 'empty', 'delayed', 'failed'
]);
const MODULE_IDS = Object.freeze([
  'statistics', 'point_by_point', 'h2h', 'progression_path'
]);
const FIELD_STATES = Object.freeze([
  'available', 'unknown', 'not_applicable', 'placeholder',
  'loading', 'expired', 'failed'
]);
const STATUS_TONES = Object.freeze([
  'brand', 'live', 'upcoming', 'warning', 'success', 'special_result', 'neutral'
]);
const SCORE_COMPACT_CHANGE_FIELDS = Object.freeze([
  'status',
  'ui',
  'score',
  'serve',
  'lastPoint',
  'delivery',
  'winnerSide',
  'terminalReason',
  'participants'
]);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} invalid`);
  }
  return value;
}

function oneOf(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`${label} invalid`);
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} invalid`);
  }
  return value;
}

function version(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} invalid`);
  }
  return value;
}

function presentationField(value, label) {
  const candidate = object(value, label);
  oneOf(candidate.state, FIELD_STATES, `${label} state`);
  if (!Object.prototype.hasOwnProperty.call(candidate, 'value')) {
    throw new Error(`${label} value invalid`);
  }
  if (candidate.message !== null && typeof candidate.message !== 'string') {
    throw new Error(`${label} message invalid`);
  }
  if (candidate.reasonCode !== null && typeof candidate.reasonCode !== 'string') {
    throw new Error(`${label} reasonCode invalid`);
  }
  return candidate;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} invalid`);
  return value;
}

function presentationOdds(value, label) {
  const odds = object(value, label);
  oneOf(odds.state,
    ['available', 'suspended', 'closed', 'settled', 'unavailable'],
    `${label} state`);
  return odds;
}

function presentation(value, options = {}) {
  const requireModules = options.requireModules !== false;
  const match = object(value, 'presentation');
  if (match.presentationContractVersion !== 'match-presentation/1'
    || match.visible !== true) {
    throw new Error('presentation contract invalid');
  }
  text(match.matchId, 'presentation matchId');
  if (match.stableMatchId !== undefined) {
    text(match.stableMatchId, 'presentation stableMatchId');
  }
  if (match.matchVersion !== undefined) {
    version(match.matchVersion, 'presentation matchVersion');
  }
  const status = object(match.status, 'presentation status');
  oneOf(status.code, MATCH_STATUSES, 'presentation status code');
  text(status.label, 'presentation status label');
  oneOf(status.uiTemplate, UI_TEMPLATES, 'presentation status template');
  oneOf(status.statusTone, STATUS_TONES, 'presentation status tone');
  const group = object(status.group, 'presentation status group');
  oneOf(group.code, BUSINESS_GROUPS, 'presentation business group');
  text(group.label, 'presentation business group label');
  const ui = object(match.ui, 'presentation ui');
  oneOf(ui.templateId, UI_TEMPLATES, 'presentation template');
  if (status.uiTemplate !== ui.templateId) {
    throw new Error('presentation template conflict');
  }
  oneOf(match.discipline,
    ['singles', 'doubles', 'mixed_doubles', 'mixed', 'unknown'],
    'presentation discipline');
  const competitionContext = object(match.competitionContext,
    'presentation competition context');
  text(competitionContext.stage, 'presentation competition stage');
  text(competitionContext.round, 'presentation competition round');
  const score = object(match.score, 'presentation score');
  oneOf(score.displayMode, SCORE_DISPLAY_MODES, 'presentation score mode');
  if (!Array.isArray(score.sets) || score.sets.length > 5) {
    throw new Error('presentation set scores invalid');
  }
  if (score.annotation !== null && typeof score.annotation !== 'string') {
    throw new Error('presentation score annotation invalid');
  }
  const delivery = object(match.delivery, 'presentation delivery');
  oneOf(delivery.state, DELIVERY_STATES, 'presentation delivery state');
  text(delivery.dataNotice, 'presentation delivery notice');
  text(delivery.dataAsOf, 'presentation delivery dataAsOf');
  const tournament = object(match.tournament, 'presentation tournament');
  text(tournament.id, 'presentation tournament id');
  oneOf(tournament.tourOrg, ['ATP', 'WTA', 'ITF', 'OTHER', 'UNKNOWN'],
    'presentation tournament organization');
  oneOf(tournament.classificationStatus,
    ['classified', 'provisional', 'level_pending', 'unknown'],
    'presentation tournament classification');
  presentationField(tournament.sortPriority,
    'presentation tournament sort priority');
  presentationField(tournament.locationNameZh,
    'presentation tournament location');
  if (tournament.countryNameZh !== undefined) {
    presentationField(tournament.countryNameZh,
      'presentation tournament country');
  }
  presentationField(tournament.displayNameZh,
    'presentation tournament name');
  const court = object(match.court, 'presentation court');
  presentationField(court.id, 'presentation court id');
  presentationField(court.displayNameZh, 'presentation court name');
  presentationField(court.sortOrder, 'presentation court sort order');
  oneOf(court.availability, ['available', 'unknown'],
    'presentation court availability');
  const venue = object(match.venue, 'presentation venue');
  presentationField(venue.displayNameZh, 'presentation venue name');
  const surface = object(match.surface, 'presentation surface');
  text(surface.code, 'presentation surface code');
  text(surface.displayNameZh, 'presentation surface name');
  const schedule = object(match.schedule, 'presentation schedule');
  text(schedule.scheduleGroupDate, 'presentation schedule group date');
  text(schedule.displayTimeLabel, 'presentation schedule display time');
  presentationField(schedule.venueLocalDateTime,
    'presentation venue local datetime');
  const grouping = object(match.grouping, 'presentation grouping');
  text(grouping.tournamentKey, 'presentation tournament grouping key');
  presentationField(grouping.courtKey, 'presentation court grouping key');
  if (!Array.isArray(match.participants) || match.participants.length !== 2) {
    throw new Error('presentation participants invalid');
  }
  match.participants.forEach((participant, sideIndex) => {
    const side = object(participant, `presentation side ${sideIndex}`);
    text(side.sideId, `presentation side ${sideIndex} id`);
    presentationField(side.seed, `presentation side ${sideIndex} seed`);
    if (!Array.isArray(side.members) || side.members.length === 0) {
      throw new Error(`presentation side ${sideIndex} members invalid`);
    }
    side.members.forEach((member, memberIndex) => {
      const player = object(member,
        `presentation side ${sideIndex} member ${memberIndex}`);
      for (const key of [
        'playerId', 'displayNameZh', 'displayNameOriginal', 'countryCode',
        'ranking', 'portraitAvailability'
      ]) {
        presentationField(player[key],
          `presentation side ${sideIndex} member ${memberIndex} ${key}`);
      }
    });
  });
  score.sets.forEach((set, index) => {
    const value = object(set, `presentation set ${index}`);
    finite(value.setNumber, `presentation set ${index} number`);
    oneOf(value.kind, ['standard', 'short', 'match_tiebreak', 'unknown'],
      `presentation set ${index} kind`);
    finite(value.firstSideGames, `presentation set ${index} first score`);
    finite(value.secondSideGames, `presentation set ${index} second score`);
  });
  if (score.currentGame !== null) {
    const game = object(score.currentGame, 'presentation current game');
    oneOf(game.kind, ['standard', 'tiebreak', 'unknown'],
      'presentation current game kind');
  }
  const serve = object(match.serve, 'presentation serve');
  oneOf(serve.availability, ['available', 'unknown', 'unavailable'],
    'presentation serve availability');
  oneOf(serve.granularity, ['player', 'team', 'unknown'],
    'presentation serve granularity');
  const lastPoint = object(match.lastPoint, 'presentation last point');
  oneOf(lastPoint.availability, ['available', 'unknown', 'unavailable'],
    'presentation last point availability');
  if (match.odds !== undefined) {
    const odds = presentationOdds(match.odds, 'presentation odds');
    if (odds.preMatch !== undefined && odds.preMatch !== null) {
      presentationOdds(odds.preMatch, 'presentation pre-match odds');
    }
    if (odds.live !== undefined && odds.live !== null) {
      presentationOdds(odds.live, 'presentation live odds');
    }
  }
  if (requireModules || match.modules !== undefined) {
    const modules = object(match.modules, 'presentation modules');
    for (const id of MODULE_IDS) {
      const module = object(modules[id], `presentation module ${id}`);
      if (module.id !== id) throw new Error(`presentation module ${id} invalid`);
      text(module.label, `presentation module ${id} label`);
      oneOf(module.state, MODULE_STATES, `presentation module ${id} state`);
      if (module.message !== null && typeof module.message !== 'string') {
        throw new Error(`presentation module ${id} message invalid`);
      }
      if (typeof module.retryable !== 'boolean'
        || typeof module.preservesLastTrustedContent !== 'boolean') {
        throw new Error(`presentation module ${id} behavior invalid`);
      }
      if (module.dataAsOf !== null && typeof module.dataAsOf !== 'string') {
        throw new Error(`presentation module ${id} dataAsOf invalid`);
      }
    }
  }
  return match;
}

function todayProjection(value) {
  const envelope = object(value, 'TodayScores envelope');
  if (envelope.bffContractVersion !== 'score-bff/3'
    || envelope.presentationContractVersion !== 'match-presentation/1') {
    throw new Error('TodayScores BFF contract invalid');
  }
  version(envelope.projectionVersion, 'TodayScores projectionVersion');
  text(envelope.dataAsOf, 'TodayScores dataAsOf');
  const payload = object(envelope.payload, 'TodayScores payload');
  text(payload.scheduleGroupDate, 'TodayScores scheduleGroupDate');
  if (!Array.isArray(payload.matches)) throw new Error('TodayScores matches invalid');
  payload.matches.forEach(match => presentation(match, { requireModules: false }));
  oneOf(object(envelope.delivery, 'TodayScores delivery').state,
    DELIVERY_STATES, 'TodayScores delivery state');
  return envelope;
}

function matchProjection(value) {
  const envelope = object(value, 'MatchDetail envelope');
  if (envelope.bffContractVersion !== 'score-bff/3'
    || envelope.presentationContractVersion !== 'match-presentation/1') {
    throw new Error('MatchDetail BFF contract invalid');
  }
  version(envelope.projectionVersion, 'MatchDetail projectionVersion');
  text(envelope.dataAsOf, 'MatchDetail dataAsOf');
  presentation(envelope.payload);
  oneOf(object(envelope.delivery, 'MatchDetail delivery').state,
    DELIVERY_STATES, 'MatchDetail delivery state');
  return envelope;
}

function statisticsProjection(value) {
  const envelope = object(value, 'statistics envelope');
  const productV2 = envelope.bffContractVersion === 'match-statistics-bff/3'
    && envelope.statisticsContractVersion === 'match-statistics-v2/1';
  if (!productV2 && (envelope.bffContractVersion !== 'match-statistics-bff/2'
    || envelope.statisticsContractVersion !== 'match-statistics/2')) {
    throw new Error('statistics BFF contract invalid');
  }
  version(envelope.projectionVersion, 'statistics projectionVersion');
  version(envelope.statisticsVersion, 'statistics statisticsVersion');
  text(envelope.dataAsOf, 'statistics dataAsOf');
  const payload = object(envelope.payload, 'statistics payload');
  const statistics = object(payload.statistics, 'statistics facts');
  text(statistics.matchId, 'statistics matchId');
  const display = object(envelope.display, 'statistics display');
  if (productV2) {
    if (!Array.isArray(display.periods) || display.periods.length !== 6) {
      throw new Error('statistics periods invalid');
    }
    display.periods.forEach(period => {
      oneOf(period.period, ['ALL', '1ST', '2ND', '3RD', '4TH', '5TH'], 'statistics period');
      text(period.labelZh, 'statistics period label');
      if (!Array.isArray(period.groups)) throw new Error('statistics groups invalid');
      period.groups.forEach(group => {
        text(group.groupId, 'statistics group id');
        text(group.groupNameZh, 'statistics group label');
        if (!Array.isArray(group.fields)) throw new Error('statistics group fields invalid');
      });
    });
  } else if (!Array.isArray(display.sides) || display.sides.length !== 2) {
    throw new Error('statistics display sides invalid');
  } else display.sides.forEach((side, index) => {
    text(object(side, `statistics side ${index}`).sideId,
      `statistics side ${index} id`);
  });
  oneOf(object(envelope.delivery, 'statistics delivery').state,
    ['current', 'delayed', 'stale', 'unavailable', 'checking'],
    'statistics delivery state');
  return envelope;
}

function statisticsRealtimeFrame(value) {
  const frame = object(value, 'statistics realtime frame');
  if (frame.contractVersion !== 'match-statistics-realtime/2') {
    throw new Error('statistics realtime contract invalid');
  }
  oneOf(frame.kind, ['snapshot', 'delta', 'deltas', 'up_to_date', 'unavailable'],
    'statistics realtime kind');
  text(frame.matchId, 'statistics realtime matchId');
  if (frame.kind === 'snapshot') statisticsProjection(frame.projection);
  if (frame.kind === 'delta') {
    version(frame.baseVersion, 'statistics realtime baseVersion');
    version(frame.version, 'statistics realtime version');
    version(frame.statisticsVersion, 'statistics realtime statisticsVersion');
    if (!Array.isArray(frame.patches)) throw new Error('statistics patches invalid');
  }
  if (frame.kind === 'deltas') {
    version(frame.version, 'statistics realtime batch version');
    if (!Array.isArray(frame.frames)) throw new Error('statistics batch invalid');
    frame.frames.forEach(statisticsRealtimeFrame);
  }
  if (frame.kind === 'up_to_date') {
    version(frame.version, 'statistics realtime version');
  }
  return frame;
}

function completionProjection(value) {
  const envelope = object(value, 'score completion envelope');
  if (envelope.contractVersion !== 'score-completion-bff/1') {
    throw new Error('score completion BFF contract invalid');
  }
  text(envelope.matchId, 'score completion matchId');
  version(envelope.projectionVersion, 'score completion projectionVersion');
  text(envelope.dataAsOf, 'score completion dataAsOf');
  const delivery = object(envelope.delivery, 'score completion delivery');
  oneOf(delivery.state,
    ['live', 'delayed', 'stale', 'unavailable', 'checking'],
    'score completion delivery state');
  if (envelope.liveStatistics !== null) {
    const statistics = object(
      envelope.liveStatistics,
      'score completion live statistics'
    );
    text(statistics.matchId, 'score completion statistics matchId');
    version(statistics.statisticVersion, 'score completion statisticVersion');
    oneOf(statistics.lifecycle, ['live_snapshot', 'post_match_final'],
      'score completion statistics lifecycle');
    oneOf(statistics.coverage,
      ['live', 'partial_live', 'post_match_only', 'none', 'not_observed'],
      'score completion statistics coverage');
    if (!Array.isArray(statistics.sides) || statistics.sides.length !== 2) {
      throw new Error('score completion statistics sides invalid');
    }
    statistics.sides.forEach((side, index) => {
      const item = object(side, `score completion statistics side ${index}`);
      text(item.sideId, `score completion statistics side ${index} id`);
      if (item.sideOrdinal !== index + 1) {
        throw new Error('score completion statistics side order invalid');
      }
      for (const key of [
        'aces',
        'doubleFaults',
        'firstServePointsWonPercentage',
        'breakPointConversionPercentage'
      ]) {
        if (!Number.isInteger(item[key]) || item[key] < 0
          || (key.endsWith('Percentage') && item[key] > 100)) {
          throw new Error(`score completion statistics ${key} invalid`);
        }
      }
    });
  }
  if (envelope.pointByPoint !== null && envelope.pointByPoint !== undefined) {
    const points = object(envelope.pointByPoint, 'score completion points');
    text(points.matchId, 'score completion points matchId');
    version(points.pointByPointVersion, 'score completion points version');
    if (!Array.isArray(points.sets)) {
      throw new Error('score completion point sets invalid');
    }
    points.sets.forEach((set, setIndex) => {
      const item = object(set, `point set ${setIndex}`);
      version(item.setNumber, `point set ${setIndex} number`);
      if (!Array.isArray(item.games)) throw new Error('point games invalid');
      item.games.forEach((game, gameIndex) => {
        const value = object(game, `point game ${gameIndex}`);
        version(value.gameNumber, `point game ${gameIndex} number`);
        if (typeof value.finalScore !== 'string') {
          throw new Error(`point game ${gameIndex} score invalid`);
        }
        if (!Array.isArray(value.points)) throw new Error('point list invalid');
        value.points.forEach((point, pointIndex) => {
          const token = object(point, `point token ${pointIndex}`);
          version(token.sequence, `point token ${pointIndex} sequence`);
          text(token.score, `point token ${pointIndex} score`);
          if (typeof token.breakPoint !== 'boolean') {
            throw new Error('point break flag invalid');
          }
        });
      });
    });
  }
  return envelope;
}

function completionRealtimeFrame(value) {
  const frame = object(value, 'score completion realtime frame');
  if (frame.contractVersion !== 'score-completion-realtime/1') {
    throw new Error('score completion realtime contract invalid');
  }
  oneOf(frame.kind,
    ['snapshot', 'delta', 'status', 'updates', 'up_to_date', 'unavailable'],
    'score completion realtime kind');
  text(frame.matchId, 'score completion realtime matchId');
  if (frame.kind === 'snapshot') completionProjection(frame.projection);
  if (frame.kind === 'delta' || frame.kind === 'status') {
    version(frame.baseVersion, 'score completion realtime baseVersion');
    version(frame.version, 'score completion realtime version');
    text(frame.dataAsOf, 'score completion realtime dataAsOf');
  }
  if (frame.kind === 'updates') {
    version(frame.version, 'score completion realtime batch version');
    if (!Array.isArray(frame.frames)) {
      throw new Error('score completion realtime batch invalid');
    }
    frame.frames.forEach(completionRealtimeFrame);
  }
  if (frame.kind === 'up_to_date') {
    version(frame.version, 'score completion realtime version');
  }
  return frame;
}

function oddsProjection(value) {
  const envelope = object(value, 'match odds envelope');
  if (envelope.bffContractVersion !== 'match-odds-bff/1'
    || envelope.oddsContractVersion !== 'match-odds/1') {
    throw new Error('match odds BFF contract invalid');
  }
  text(envelope.matchId, 'match odds matchId');
  version(envelope.projectionVersion, 'match odds projectionVersion');
  version(envelope.oddsVersion, 'match odds oddsVersion');
  text(envelope.dataAsOf, 'match odds dataAsOf');
  const payload = object(envelope.payload, 'match odds payload');
  text(payload.matchId, 'match odds payload matchId');
  const odds = presentationOdds(object(payload.odds, 'match odds payload odds'), 'match odds');
  if (odds.preMatch !== undefined && odds.preMatch !== null) {
    presentationOdds(odds.preMatch, 'match odds preMatch');
  }
  if (odds.live !== undefined && odds.live !== null) {
    presentationOdds(odds.live, 'match odds live');
  }
  oneOf(object(envelope.delivery, 'match odds delivery').state,
    ['current', 'delayed', 'stale', 'unavailable', 'checking'],
    'match odds delivery state');
  return envelope;
}

function progressionProjection(value) {
  const envelope = object(value, 'match progression envelope');
  if (envelope.bffContractVersion !== 'match-progression-path-bff/1'
    || envelope.progressionContractVersion !== 'match-progression-path/1') {
    throw new Error('match progression BFF contract invalid');
  }
  text(envelope.matchId, 'match progression matchId');
  version(envelope.projectionVersion, 'match progression projectionVersion');
  version(envelope.progressionVersion, 'match progression progressionVersion');
  text(envelope.dataAsOf, 'match progression dataAsOf');
  const delivery = object(envelope.delivery, 'match progression delivery');
  oneOf(delivery.state,
    ['current', 'delayed', 'stale', 'unavailable', 'checking'],
    'match progression delivery state');
  if (envelope.presentation !== undefined) {
    const presentationValue = object(envelope.presentation, 'match progression presentation');
    if (!Array.isArray(presentationValue.rounds)
      || !Array.isArray(presentationValue.slots)
      || !Array.isArray(presentationValue.matches)) {
      throw new Error('match progression presentation invalid');
    }
  }
  if (envelope.progression !== undefined && !Array.isArray(envelope.progression?.paths)) {
    throw new Error('match progression paths invalid');
  }
  return envelope;
}

function realtimeFrame(value) {
  const frame = object(value, 'realtime frame');
  if (frame.contractVersion !== 'score-realtime/3') {
    throw new Error('realtime contract invalid');
  }
  const kinds = [
    'delta', 'deltas', 'score_delta', 'score_deltas', 'up_to_date', 'resync_required',
    'unavailable', 'heartbeat'
  ];
  oneOf(frame.kind, kinds, 'realtime kind');
  if (frame.kind === 'delta') {
    version(frame.baseVersion, 'realtime baseVersion');
    version(frame.version, 'realtime version');
    if (!Array.isArray(frame.upserts)
      || !Array.isArray(frame.removedMatchIds)) {
      throw new Error('realtime delta invalid');
    }
    frame.upserts.forEach(presentation);
  }
  if (frame.kind === 'score_delta') {
    version(frame.baseVersion, 'realtime baseVersion');
    version(frame.version, 'realtime version');
    version(frame.snapshotVersion ?? frame.version, 'realtime snapshotVersion');
    if (!Array.isArray(frame.changes) || frame.changes.length < 1) {
      throw new Error('realtime compact delta invalid');
    }
    frame.changes.forEach((item, index) => {
      const change = object(item, `realtime compact change ${index}`);
      text(change.matchId, `realtime compact change ${index} matchId`);
      version(change.matchVersion, `realtime compact change ${index} matchVersion`);
      const fields = object(change.changes, `realtime compact change ${index} fields`);
      const keys = Object.keys(fields);
      if (keys.length < 1) throw new Error('realtime compact changes empty');
      keys.forEach(key => {
        if (!SCORE_COMPACT_CHANGE_FIELDS.includes(key)) {
          throw new Error(`realtime compact change ${key} invalid`);
        }
      });
    });
  }
  if (frame.kind === 'deltas') {
    version(frame.version, 'realtime batch version');
    if (!Array.isArray(frame.frames)) throw new Error('realtime batch invalid');
    frame.frames.forEach(realtimeFrame);
  }
  if (frame.kind === 'score_deltas') {
    version(frame.version, 'realtime compact batch version');
    if (!Array.isArray(frame.frames)) throw new Error('realtime compact batch invalid');
    frame.frames.forEach(realtimeFrame);
  }
  if (frame.kind === 'up_to_date' || frame.kind === 'resync_required') {
    version(frame.version, 'realtime version');
  }
  return frame;
}

module.exports = Object.freeze({
  MATCH_STATUSES,
  UI_TEMPLATES,
  SCORE_DISPLAY_MODES,
  DELIVERY_STATES,
  BUSINESS_GROUPS,
  MODULE_STATES,
  MODULE_IDS,
  STATUS_TONES,
  presentation,
  todayProjection,
  matchProjection,
  realtimeFrame,
  statisticsProjection,
  statisticsRealtimeFrame,
  completionProjection,
  completionRealtimeFrame,
  oddsProjection,
  progressionProjection
});
