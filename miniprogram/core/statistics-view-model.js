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

const PRODUCT_GROUP_ORDER = Object.freeze([
  'service',
  'return',
  'unforced_errors',
  'winners',
  'forced_errors',
  'points',
  'games',
  'other'
]);

const PRODUCT_TOTAL_FIELDS = Object.freeze({
  winners: Object.freeze({ labels: Object.freeze(['制胜分']), ids: /^(winners?|total[_-]?winners?)$/iu, label: '总制胜分' }),
  unforced_errors: Object.freeze({ labels: Object.freeze(['非受迫性失误', '非受迫失误']), ids: /^(unforced[_-]?errors?|total[_-]?unforced[_-]?errors?)$/iu, label: '非受迫性失误总数' }),
  forced_errors: Object.freeze({ labels: Object.freeze(['受迫性失误', '受迫失误']), ids: /^(forced[_-]?errors?|total[_-]?forced[_-]?errors?)$/iu, label: '受迫性失误总数' })
});

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

function productValue(value) {
  if (!value || value.display === null || value.display === undefined) return '';
  const display = String(value.display);
  const fractionRate = display.match(/^\s*([^\s()]+)\s*\(\s*([+-]?[\d.]+%)\s*\)\s*$/u);
  if (fractionRate) return `${fractionRate[2]}（${fractionRate[1]}）`;
  return display;
}

function productNumber(value) {
  if (!value) return 0;
  if (value.percentage !== null && value.percentage !== undefined
    && Number.isFinite(Number(value.percentage))) return Number(value.percentage);
  const percentage = String(value.display ?? '').match(/([+-]?[\d.]+)%/u);
  if (percentage && Number.isFinite(Number(percentage[1]))) return Number(percentage[1]);
  if (value.value !== null && value.value !== undefined
    && Number.isFinite(Number(value.value))) return Number(value.value);
  return Number.parseFloat(String(value.display ?? '')) || 0;
}

function productGroupRank(groupId) {
  const rank = PRODUCT_GROUP_ORDER.indexOf(groupId);
  return rank === -1 ? PRODUCT_GROUP_ORDER.length : rank;
}

function productTotalField(groupId, field) {
  const rule = PRODUCT_TOTAL_FIELDS[groupId];
  if (!rule) return null;
  const label = String(field?.labelZh || '').trim();
  const id = String(field?.stableFieldId || '').trim();
  return rule.labels.includes(label) || rule.ids.test(id) ? rule : null;
}

function productStatisticsView(projection, participantNames, selectedPeriod, collapsedGroups) {
  const periods = projection.display.periods;
  const active = periods.find(period => period.period === selectedPeriod)
    ?? periods.find(period => period.period === 'ALL') ?? periods[0];
  const collapsed = collapsedGroups && typeof collapsedGroups === 'object'
    ? collapsedGroups : {};
  const groups = active.groups.map((group, sourceIndex) => ({
    groupId: group.groupId,
    groupNameZh: group.groupNameZh,
    sourceIndex,
    collapsed: collapsed[group.groupId] === true,
    rows: group.fields.map((field, fieldIndex) => {
      const firstNumber = productNumber(field.side1);
      const secondNumber = productNumber(field.side2);
      const scale = Math.max(firstNumber, secondNumber, 1);
      const comparable = field.available === true && firstNumber !== secondNumber;
      const totalField = productTotalField(group.groupId, field);
      return Object.freeze({
        metricId: field.stableFieldId,
        label: totalField?.label || field.labelZh,
        fieldIndex,
        isGroupTotal: Boolean(totalField),
        first: productValue(field.side1),
        second: productValue(field.side2),
        firstBar: Math.round(firstNumber / scale * 100),
        secondBar: Math.round(secondNumber / scale * 100),
        firstHigher: comparable && firstNumber > secondNumber,
        secondHigher: comparable && secondNumber > firstNumber,
        tied: field.available === true && firstNumber === secondNumber,
        available: field.available === true
      });
    }).sort((first, second) => Number(second.isGroupTotal) - Number(first.isGroupTotal)
      || first.fieldIndex - second.fieldIndex)
  })).sort((first, second) => productGroupRank(first.groupId) - productGroupRank(second.groupId)
    || first.sourceIndex - second.sourceIndex);
  return Object.freeze({
    version: projection.projectionVersion,
    dataAsOf: projection.dataAsOf,
    deliveryState: projection.delivery.state,
    deliveryMessage: projection.delivery.message,
    names: Object.freeze([participantNames[0] || '', participantNames[1] || '']),
    duration: '',
    period: active.period,
    periods: Object.freeze(periods.map(period => Object.freeze({
      period: period.period, label: period.labelZh, active: period.period === active.period
    }))),
    groups: Object.freeze(groups),
    rows: Object.freeze(groups.flatMap(group => group.rows))
  });
}

function statisticsView(
  projection,
  participantNames = [],
  selectedPeriod = 'ALL',
  collapsedGroups = {}
) {
  if (!projection) return null;
  if (projection.bffContractVersion === 'match-statistics-bff/3') {
    return productStatisticsView(projection, participantNames, selectedPeriod, collapsedGroups);
  }
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
