'use strict';

const SET_TITLES = Object.freeze([
  '',
  '第一盘',
  '第二盘',
  '第三盘',
  '第四盘',
  '第五盘'
]);

function setTitle(setNumber) {
  return SET_TITLES[setNumber] || `第 ${setNumber} 盘`;
}

function tiebreakLabel(setNumber, game, scoringRules) {
  if (!game.tiebreak) return '';
  const rules = scoringRules && typeof scoringRules === 'object' ? scoringRules : {};
  if (rules.decidingSetIsMatchTiebreak === true
    && Number(rules.bestOfSets) === Number(setNumber)) {
    const target = Number(rules.matchTiebreakTargetPoints);
    return Number.isFinite(target) && target > 0 ? `抢${target}` : '';
  }
  if (Number(rules.bestOfSets) === Number(setNumber)
    && Number(rules.finalSetTiebreakTargetPoints) > 7) {
    return `抢${Number(rules.finalSetTiebreakTargetPoints)}`;
  }
  const target = Number(rules.regularTiebreakTargetPoints);
  return Number.isFinite(target) && target > 0 ? `抢${target}` : '';
}

function pointByPointView(projection, participantNames, scoringRules = null) {
  const source = projection?.pointByPoint;
  if (!source) return null;
  const lastSetIndex = source.sets.length - 1;
  return Object.freeze({
    version: source.pointByPointVersion,
    dataAsOf: source.dataAsOf,
    deliveryState: projection.delivery.state,
    deliveryMessage: projection.delivery.message,
    sets: Object.freeze(source.sets.map((set, setIndex) => Object.freeze({
      setNumber: set.setNumber,
      title: setTitle(set.setNumber),
      isCurrent: setIndex === lastSetIndex,
      games: Object.freeze(set.games.map((game, gameIndex) => {
        const ordinal = game.serverSideOrdinal;
        const serverName = ordinal === 1 || ordinal === 2
          ? participantNames[ordinal - 1] || `球员 ${ordinal}` : '';
        return Object.freeze({
          gameNumber: game.gameNumber,
          title: `第 ${game.gameNumber} 局`,
          finalScore: game.finalScore || '比分更新中',
          serverName,
          serverLabel: serverName ? `${serverName} 发球` : '',
          tiebreak: game.tiebreak,
          tiebreakLabel: tiebreakLabel(set.setNumber, game, scoringRules),
          isLatest: setIndex === lastSetIndex
            && gameIndex === set.games.length - 1,
          empty: game.points.length === 0,
          points: Object.freeze(game.points.map(point => Object.freeze({
            sequence: point.sequence,
            score: point.score,
            breakPoint: point.breakPoint
          })))
        });
      }))
    })))
  });
}

module.exports = Object.freeze({ pointByPointView });
