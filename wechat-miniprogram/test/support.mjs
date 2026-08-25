export const matchId = '019c13ac-7b00-7005-8000-000000000501';

const available = value => ({
  state: 'available', value, message: null, reasonCode: null
});
const unknown = message => ({
  state: 'unknown', value: null, message, reasonCode: 'not_observed'
});

function player(id, name, ranking = null) {
  return {
    playerId: available(id),
    displayNameZh: available(name),
    displayNameOriginal: available(name),
    nameZhStatus: 'original_fallback',
    countryCode: unknown('国家待确认'),
    ranking: ranking === null ? unknown('排名待确认') : available(ranking),
    rankingDiscipline: ranking === null ? unknown('排名项目待确认') : available('singles'),
    rankingAsOf: ranking === null ? unknown('排名日期待确认') : available('2026-08-03'),
    portraitAvailability: unknown('头像未授权')
  };
}

export function presentation(overrides = {}) {
  const firstSideId = '019c13ac-7b00-7005-8000-000000000505';
  const secondSideId = '019c13ac-7b00-7005-8000-000000000506';
  const base = {
    presentationContractVersion: 'match-presentation/1',
    dictionaryVersion: '1.1.0',
    matchId,
    visible: true,
    discipline: 'singles',
    competitionContext: { stage: 'main_draw', round: 'R32', isQualifying: false },
    status: {
      code: 'live', label: '进行中',
      group: { code: 'in_progress', label: '进行中' },
      uiTemplate: 'live', statusTone: 'live'
    },
    ui: { templateId: 'live', showWinStamp: false, winStampSideId: null },
    tournament: {
      id: '019c13ac-7b00-7005-8000-000000000502', tourOrg: 'ATP',
      levelCode: 'tour_500', classificationStatus: 'classified',
      sortPriority: available(10), logoAssetKey: unknown('赛事标识未授权'),
      locationNameZh: available('华盛顿'), displayNameZh: available('华盛顿公开赛')
    },
    court: {
      id: available('court-1'), displayNameZh: available('中心球场'),
      sortOrder: available(1), availability: 'available'
    },
    venue: { displayNameZh: unknown('场馆待确认'), availability: 'unknown' },
    surface: { code: 'hard', displayNameZh: '硬地', environment: unknown('室内外待确认') },
    schedule: {
      timeKind: 'exact', scheduledStartAt: available('2026-08-06T23:00:00.000Z'),
      officialScheduleDate: '2026-08-06', scheduleGroupDate: '2026-08-06',
      scheduledAtUtc: available('2026-08-06T23:00:00.000Z'),
      beijingScheduledAt: available('2026-08-07T07:00:00+08:00'),
      beijingDate: available('2026-08-07'), beijingTime: available('07:00'),
      displayDayOffset: available(1), displayDayRelation: available('next_day'),
      displayTimeLabel: '次日 07:00', venueLocalDateTime: unknown('当地时间待确认'),
      venueTimezone: null, displayText: '次日 07:00', reminderEligible: false
    },
    participants: [
      { sideId: firstSideId, seed: available(1), members: [player(
        '019c13ac-7b00-7005-8000-000000000507',
        '一位姓名非常非常长的第一位测试球员', 12
      )] },
      { sideId: secondSideId, seed: unknown('种子待确认'), members: [player(
        '019c13ac-7b00-7005-8000-000000000508',
        'Second Player With A Very Long Name'
      )] }
    ],
    score: {
      displayMode: 'live',
      sets: [
        { setNumber: 1, kind: 'standard', firstSideGames: 7, secondSideGames: 6,
          firstSideTiebreakPoints: 9, secondSideTiebreakPoints: 7, state: 'complete' },
        { setNumber: 2, kind: 'standard', firstSideGames: 4, secondSideGames: 6,
          firstSideTiebreakPoints: null, secondSideTiebreakPoints: null, state: 'complete' },
        { setNumber: 3, kind: 'standard', firstSideGames: 12, secondSideGames: 12,
          firstSideTiebreakPoints: null, secondSideTiebreakPoints: null, state: 'in_progress' }
      ],
      currentGame: { kind: 'tiebreak', firstSidePoints: 10, secondSidePoints: 9 },
      annotation: null
    },
    serve: {
      displayMode: 'current', availability: 'available', granularity: 'player',
      sideId: firstSideId, playerId: '019c13ac-7b00-7005-8000-000000000507',
      updatedAt: '2026-08-06T23:30:00.000Z'
    },
    lastPoint: {
      availability: 'available', highlightSideId: firstSideId,
      eventId: 'point-1', occurredAt: '2026-08-06T23:30:00.000Z',
      observedAt: '2026-08-06T23:30:01.000Z'
    },
    result: { state: 'none', resultKind: 'none', winnerSideId: unknown('未结束'), advancingSideId: unknown('未结束') },
    delivery: {
      state: 'live', dataNotice: '比分实时更新中', dataAsOf: '2026-08-06T23:30:01.000Z',
      showLivePulse: true
    },
    modules: {
      statistics: { id: 'statistics', label: '比赛统计', state: 'content', message: null, dataAsOf: '2026-08-06T23:30:01.000Z', preservesLastTrustedContent: true, retryable: true },
      point_by_point: { id: 'point_by_point', label: '逐分', state: 'empty', message: '当前没有逐分数据', dataAsOf: null, preservesLastTrustedContent: false, retryable: false },
      h2h: { id: 'h2h', label: '交手记录', state: 'delayed', message: '交手记录仍在确认', dataAsOf: null, preservesLastTrustedContent: true, retryable: true },
      progression_path: { id: 'progression_path', label: '晋级路径', state: 'failed', message: '晋级路径暂不可用', dataAsOf: null, preservesLastTrustedContent: false, retryable: true }
    },
    actions: [],
    grouping: {
      dateKey: available('2026-08-06'),
      tournamentKey: 'tournament-1', courtKey: available('court-1'),
      tournamentSortPriority: available(10), courtSortOrder: available(1)
    },
    fieldDegradations: []
  };
  return { ...base, ...overrides };
}

export function todayProjection(version = 1, match = presentation()) {
  return {
    bffContractVersion: 'score-bff/3',
    presentationContractVersion: 'match-presentation/1',
    projectionVersion: version,
    projectionGeneratedAt: '2026-08-06T23:30:01.100Z',
    dataAsOf: match.delivery.dataAsOf,
    payloadSha256: 'a'.repeat(64),
    delivery: {
      state: match.delivery.state, message: match.delivery.dataNotice,
      dataAsOf: match.delivery.dataAsOf, servedFromLastCommittedReplica: false,
      knownGaps: []
    },
    payload: {
      scheduleGroupDate: '2026-08-06', officialDate: '2026-08-06',
      displayTimezone: 'Asia/Shanghai', displayDateTimezone: 'Asia/Shanghai',
      matches: [match]
    }
  };
}

function known(displayText, value) {
  return { state: 'known', displayText, value, reasonCode: null };
}

export function statisticsProjection(version = 1) {
  const count = value => known(String(value), { value });
  const ratio = (a, b) => known(`${a}/${b}（${Math.round(a / b * 100)}%）`, {
    numerator: a, denominator: b, percentageBasisPoints: Math.round(a / b * 10000)
  });
  const side = (id, offset) => ({
    sideId: id, aces: count(6 + offset), doubleFaults: count(2 + offset),
    firstServesIn: ratio(30, 50), firstServePointsWon: ratio(22, 30),
    secondServePointsWon: ratio(11, 20), breakPointsConverted: ratio(3, 7),
    breakPointsSaved: ratio(4, 6), serviceGames: count(10), returnGames: count(10),
    returnPointsWon: ratio(25, 60), totalPointsWon: count(70 + offset),
    winners: count(24), unforcedErrors: count(18), netPointsWon: ratio(8, 12),
    fastestServe: known('201 km/h', { value: 201, unit: 'km/h' }),
    averageFirstServe: known('184 km/h', { value: 184, unit: 'km/h' }),
    averageSecondServe: known('151 km/h', { value: 151, unit: 'km/h' })
  });
  return {
    bffContractVersion: 'match-statistics-bff/2',
    statisticsContractVersion: 'match-statistics/2',
    projectionVersion: version,
    statisticsVersion: version,
    dataAsOf: '2026-08-06T23:30:01.000Z',
    payloadSha256: 'b'.repeat(64),
    delivery: { state: 'current', message: '比赛统计已更新', dataAsOf: '2026-08-06T23:30:01.000Z', servedFromLastCommittedReplica: false, knownGaps: [] },
    replica: { singaporeDataAsOf: '2026-08-06T23:30:01.000Z', shanghaiAppliedAt: '2026-08-06T23:30:01.100Z', lastContiguousSequence: version },
    display: {
      sides: [side('side-1', 0), side('side-2', 1)],
      duration: known('1:42:08', { seconds: 6128 }),
      perSet: known('3盘', 3)
    },
    payload: {
      apiVersion: '1', capabilityContractVersion: 'match-statistics/2',
      projectionVersion: version, dataAsOf: '2026-08-06T23:30:01.000Z',
      statistics: { matchId, statisticsVersion: version, sets: { state: 'known', value: [], reasonCode: null } }
    }
  };
}

export function completionProjection(version = 1, overrides = {}) {
  const dataAsOf = overrides.dataAsOf ?? '2026-08-06T23:30:01.000Z';
  return {
    contractVersion: 'score-completion-bff/1',
    matchId,
    projectionVersion: version,
    dataAsOf,
    payloadSha256: 'c'.repeat(64),
    delivery: {
      state: overrides.deliveryState ?? 'live',
      message: overrides.deliveryMessage ?? '比赛详情实时更新中',
      dataAsOf,
      servedFromLastCommittedReplica: false,
      knownGaps: []
    },
    liveStatistics: overrides.liveStatistics === null ? null : {
      kind: 'live_match_statistics_v1',
      matchId,
      statisticVersion: version,
      lifecycle: overrides.lifecycle ?? 'live_snapshot',
      scope: 'whole_match_to_date',
      coverage: overrides.coverage ?? 'partial_live',
      sourceHealth: 'healthy',
      sides: [
        {
          sideId: 'side-1', sideOrdinal: 1,
          aces: overrides.firstAces ?? 4, doubleFaults: 1,
          firstServePointsWonPercentage: 67,
          breakPointConversionPercentage: 50
        },
        {
          sideId: 'side-2', sideOrdinal: 2,
          aces: 3, doubleFaults: 2,
          firstServePointsWonPercentage: 64,
          breakPointConversionPercentage: 33
        }
      ],
      capabilityContractVersion: 'live-match-statistics/1',
      schemaVersion: 1,
      apiVersion: '1',
      dataAsOf,
      projectionVersion: version
    },
    currentResult: overrides.currentResult ?? null
  };
}
