'use strict';

const METRICS = Object.freeze([
  { metricId: 'aces', label: 'Ace' },
  { metricId: 'doubleFaults', label: '双误' },
  { metricId: 'firstServesIn', label: '一发成功率' },
  { metricId: 'firstServePointsWon', label: '一发得分率' },
  { metricId: 'secondServePointsWon', label: '二发得分率' },
  { metricId: 'breakPointsConverted', label: '破发点兑现率' },
  { metricId: 'breakPointsSaved', label: '破发点挽救率' },
  { metricId: 'serviceGames', label: '发球局' },
  { metricId: 'returnGames', label: '接发局' },
  { metricId: 'returnPointsWon', label: '接发得分' },
  { metricId: 'totalPointsWon', label: '总得分' },
  { metricId: 'winners', label: '制胜分' },
  { metricId: 'unforcedErrors', label: '非受迫失误' },
  { metricId: 'netPointsWon', label: '网前得分' },
  { metricId: 'fastestServe', label: '最快发球' },
  { metricId: 'averageFirstServe', label: '平均一发速度' },
  { metricId: 'averageSecondServe', label: '平均二发速度' }
]);

const PERCENTAGE_METRICS = new Set([
  'firstServesIn',
  'firstServePointsWon',
  'secondServePointsWon',
  'breakPointsConverted',
  'breakPointsSaved'
]);

function displayFact(value) {
  if (!value || value.state !== 'known') return '';
  return value.displayText;
}

function numericFact(value) {
  if (!value || value.state !== 'known') return 0;
  const facts = value.value && typeof value.value === 'object' ? value.value : {};
  if (Number.isFinite(Number(facts.percentageBasisPoints))) {
    return Number(facts.percentageBasisPoints) / 100;
  }
  if (Number.isFinite(Number(facts.value))) return Number(facts.value);
  const parsed = Number.parseFloat(String(value.displayText || '').replace(/,/gu, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentageFact(value) {
  const number = numericFact(value);
  return displayFact(value) === '' ? '' : `${Math.round(number)}%`;
}

function visualRow(metricId, label, firstValue, secondValue, firstFact, secondFact) {
  const percentage = PERCENTAGE_METRICS.has(metricId);
  const firstNumber = percentage ? numericFact(firstFact) : Number.parseFloat(firstValue) || 0;
  const secondNumber = percentage ? numericFact(secondFact) : Number.parseFloat(secondValue) || 0;
  const scale = percentage ? 100 : Math.max(firstNumber, secondNumber, 1);
  return Object.freeze({
    metricId,
    label,
    first: percentage ? percentageFact(firstFact) : firstValue,
    second: percentage ? percentageFact(secondFact) : secondValue,
    firstBar: Math.max(0, Math.min(100, Math.round(firstNumber / scale * 100))),
    secondBar: Math.max(0, Math.min(100, Math.round(secondNumber / scale * 100)))
  });
}

function statisticsView(projection, participantNames = []) {
  if (!projection) return null;
  if (projection.contractVersion === 'score-completion-bff/1') {
    const statistics = projection.liveStatistics;
    if (statistics === null) return null;
    const values = Object.freeze([
      visualRow(
        'aces',
        'Ace', String(statistics.sides[0].aces), String(statistics.sides[1].aces)
      ),
      visualRow(
        'doubleFaults',
        '双误', String(statistics.sides[0].doubleFaults),
        String(statistics.sides[1].doubleFaults)
      ),
      visualRow(
        'firstServePointsWon', '一发得分率', '', '',
        { state: 'known', displayText: String(statistics.sides[0].firstServePointsWonPercentage),
          value: { value: statistics.sides[0].firstServePointsWonPercentage } },
        { state: 'known', displayText: String(statistics.sides[1].firstServePointsWonPercentage),
          value: { value: statistics.sides[1].firstServePointsWonPercentage } }
      ),
      visualRow(
        'breakPointsConverted', '破发点兑现率', '', '',
        { state: 'known', displayText: String(statistics.sides[0].breakPointConversionPercentage),
          value: { value: statistics.sides[0].breakPointConversionPercentage } },
        { state: 'known', displayText: String(statistics.sides[1].breakPointConversionPercentage),
          value: { value: statistics.sides[1].breakPointConversionPercentage } }
      )
    ]);
    return Object.freeze({
      version: projection.projectionVersion,
      dataAsOf: projection.dataAsOf,
      deliveryState: projection.delivery.state,
      deliveryMessage: projection.delivery.message,
      coverage: statistics.coverage,
      lifecycle: statistics.lifecycle,
      names: Object.freeze([
        participantNames[0] || '', participantNames[1] || ''
      ]),
      duration: '',
      rows: values
    });
  }
  const sides = projection.display.sides;
  return Object.freeze({
    version: projection.projectionVersion,
    dataAsOf: projection.dataAsOf,
    deliveryState: projection.delivery.state,
    deliveryMessage: projection.delivery.message,
    names: Object.freeze([
      participantNames[0] || '', participantNames[1] || ''
    ]),
    duration: displayFact(projection.display.duration),
    rows: Object.freeze(METRICS.map(({ metricId, label }) => visualRow(
      metricId,
      label,
      displayFact(sides[0][metricId]),
      displayFact(sides[1][metricId]),
      sides[0][metricId],
      sides[1][metricId]
    )))
  });
}

function statisticsModuleState(declared, statistics, transportState) {
  if (statistics !== null) {
    const delayed = !['current', 'live'].includes(statistics.deliveryState);
    return Object.freeze({
      id: 'statistics',
      label: declared.label,
      state: delayed ? 'delayed' : 'content',
      dataAsOf: statistics.dataAsOf || declared.dataAsOf,
      message: delayed
        ? (statistics.deliveryMessage || '比赛统计更新稍有延迟')
        : null,
      retryable: false,
      hasTrustedContent: true,
      preservesLastTrustedContent: delayed
    });
  }

  const state = transportState === 'offline'
    ? 'failed'
    : transportState === 'connected' ? 'empty' : 'loading';
  const messages = Object.freeze({
    connecting: '正在读取比赛统计',
    reconnecting: '正在重新读取比赛统计',
    connected: '暂无可用比赛统计',
    offline: '比赛统计暂时无法加载'
  });
  return Object.freeze({
    ...declared,
    state,
    dataAsOf: null,
    message: messages[transportState] || messages.connecting,
    retryable: state === 'failed',
    hasTrustedContent: false,
    preservesLastTrustedContent: false
  });
}

module.exports = Object.freeze({
  METRICS,
  statisticsView,
  statisticsModuleState,
  displayFact,
  numericFact,
  percentageFact
});
