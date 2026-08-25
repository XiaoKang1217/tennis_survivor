'use strict';

const METRICS = Object.freeze([
  { metricId: 'aces', label: 'Ace' },
  { metricId: 'doubleFaults', label: '双误' },
  { metricId: 'firstServesIn', label: '一发成功率' },
  { metricId: 'firstServePointsWon', label: '一发得分率' },
  { metricId: 'secondServePointsWon', label: '二发得分率' },
  { metricId: 'breakPointsConverted', label: '破发点兑现' },
  { metricId: 'breakPointsSaved', label: '破发点挽救' },
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

function displayFact(value) {
  if (!value || value.state !== 'known') return '';
  return value.displayText;
}

function statisticsView(projection, participantNames = []) {
  if (!projection) return null;
  if (projection.contractVersion === 'score-completion-bff/1') {
    const statistics = projection.liveStatistics;
    if (statistics === null) return null;
    const values = Object.freeze([
      Object.freeze({
        metricId: 'aces',
        label: 'Ace',
        first: String(statistics.sides[0].aces),
        second: String(statistics.sides[1].aces)
      }),
      Object.freeze({
        metricId: 'doubleFaults',
        label: '双误',
        first: String(statistics.sides[0].doubleFaults),
        second: String(statistics.sides[1].doubleFaults)
      }),
      Object.freeze({
        metricId: 'firstServePointsWonPercentage',
        label: '一发得分率',
        first: `${statistics.sides[0].firstServePointsWonPercentage}%`,
        second: `${statistics.sides[1].firstServePointsWonPercentage}%`
      }),
      Object.freeze({
        metricId: 'breakPointConversionPercentage',
        label: '破发点兑现率',
        first: `${statistics.sides[0].breakPointConversionPercentage}%`,
        second: `${statistics.sides[1].breakPointConversionPercentage}%`
      })
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
    rows: Object.freeze(METRICS.map(({ metricId, label }) => Object.freeze({
      metricId,
      label,
      first: displayFact(sides[0][metricId]),
      second: displayFact(sides[1][metricId])
    })))
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
  displayFact
});
