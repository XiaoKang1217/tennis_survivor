'use strict';

function field(candidate, fallback = '') {
  return candidate && candidate.state === 'available' && candidate.value !== null
    ? String(candidate.value) : fallback;
}

function participantName(slot) {
  if (slot?.state === 'pending') return '胜者待定';
  if (slot?.participant) {
    return field(slot.participant.displayNameZh)
      || field(slot.participant.displayNameOriginal)
      || (slot?.state === 'pending' ? '胜者待定' : '参赛方待确认');
  }
  if (slot?.state === 'bye') return '轮空';
  return slot?.state === 'pending' ? '胜者待定' : '参赛方待确认';
}

function sideIdentity(slot) {
  return field(slot?.participantSideId)
    || String(slot?.participant?.participantSideId || '');
}

function sideScores(score, side) {
  if (!score || !Array.isArray(score.sets)) return [];
  return score.sets.map(set => {
    const first = side === 1;
    const games = first ? set.firstSideGames : set.secondSideGames;
    const tiebreak = first
      ? set.firstSideTiebreakPoints : set.secondSideTiebreakPoints;
    return Object.freeze({
      games: Number.isFinite(games) ? String(games) : '–',
      tiebreak: Number.isFinite(tiebreak) ? String(tiebreak) : ''
    });
  });
}

function localizedOutcomeText(value) {
  return String(value || '')
    .replace(/\bRET\b/gu, '中途退赛')
    .replace(/\bW\/?O\b/giu, '赛前退赛')
    .trim();
}

function drawColumns(presentation) {
  const slots = new Map((presentation?.slots || []).map(slot => [slot.slotId, slot]));
  const rounds = presentation?.rounds || [];
  const sourceMatches = presentation?.matches || [];
  const cardHeight = 196;
  const stride = 228;
  const columnDrafts = rounds.map((round, roundIndex) => {
    const matches = sourceMatches
      .filter(match => match.roundId === round.roundId)
      .sort((first, second) => Number(first.bracketIndex ?? 0)
        - Number(second.bracketIndex ?? 0))
      .map((match, matchIndex) => {
        const first = slots.get(match.slotIds[0]);
        const second = slots.get(match.slotIds[1]);
        const winnerId = field(match.winnerSideId);
        const bracketIndex = Number.isFinite(Number(match.bracketIndex))
          ? Number(match.bracketIndex) : matchIndex;
        const firstScores = sideScores(match.score, 1);
        const secondScores = sideScores(match.score, 2);
        const scale = 2 ** roundIndex;
        const center = (bracketIndex * scale + scale / 2) * stride;
        const connectorHeight = roundIndex === 0 ? 0 : (2 ** (roundIndex - 1)) * stride;
        const top = Math.max(0, center - cardHeight / 2);
        return Object.freeze({
          id: match.nodeId,
          top,
          nodeStyle: `top:${top}rpx`,
          hasIncoming: roundIndex > 0,
          incomingStyle: `top:${(cardHeight - connectorHeight) / 2}rpx;height:${connectorHeight}rpx`,
          matchId: field(match.matchId),
          canOpen: match.canOpenMatch,
          status: localizedOutcomeText(match.statusLabel),
          scoreText: localizedOutcomeText(match.scoreText),
          first: participantName(first),
          second: participantName(second),
          firstSeed: field(first?.seedNumber),
          secondSeed: field(second?.seedNumber),
          firstEntry: first?.entryLabelZh || '',
          secondEntry: second?.entryLabelZh || '',
          firstScores,
          secondScores,
          hasFirstScores: firstScores.length > 0,
          hasSecondScores: secondScores.length > 0,
          firstWon: Boolean(winnerId) && winnerId === sideIdentity(first),
          secondWon: Boolean(winnerId) && winnerId === sideIdentity(second)
        });
      });
    const height = Math.max(stride, ...matches.map(match => match.top + cardHeight + 96));
    return Object.freeze({
      id: round.roundId,
      title: roundTitle(round.displayNameZh, roundIndex),
      champion: false,
      height,
      matches: Object.freeze(matches.map(match => {
        const { top: _top, ...clean } = match;
        return Object.freeze(clean);
      }))
    });
  });
  const boardHeight = Math.max(stride, ...columnDrafts.map(column => column.height));
  const columns = columnDrafts.map(column => Object.freeze({
    ...column,
    height: boardHeight
  }));
  const finalColumn = columns[columns.length - 1];
  const finalRoundId = finalColumn?.id;
  const finalMatch = sourceMatches.find(match => match.roundId === finalRoundId);
  if (!finalMatch) return Object.freeze(columns);
  const winnerId = field(finalMatch.winnerSideId) || field(finalMatch.advancingSideId);
  if (!winnerId) return Object.freeze(columns);
  const winnerSlot = winnerId
    ? finalMatch.slotIds.map(id => slots.get(id)).find(slot => sideIdentity(slot) === winnerId)
    : null;
  if (!winnerSlot) return Object.freeze(columns);
  return Object.freeze([
    ...columns,
    Object.freeze({
      id: `${finalRoundId}:champion`,
      title: '冠军',
      champion: true,
      height: boardHeight,
      matches: Object.freeze([
        Object.freeze({
          id: `${finalMatch.nodeId}:champion`,
          champion: true,
          nodeStyle: `top:${Math.max(0, boardHeight / 2 - cardHeight / 2)}rpx`,
          hasIncoming: true,
          incomingStyle: 'top:87rpx;height:1rpx',
          first: participantName(winnerSlot),
          firstSeed: field(winnerSlot?.seedNumber),
          firstEntry: winnerSlot?.entryLabelZh || '',
          status: '已晋级'
        })
      ])
    })
  ]);
}

function roundTitle(label, index) {
  const value = String(label || '').trim();
  const normalized = value.toUpperCase().replace(/[_-]+/g, ' ');
  if (/半决赛/u.test(value)) return '半决赛';
  if (/1\/4|¼|四分之一/u.test(value)) return '¼决赛';
  if (/决赛/u.test(value) && !/半决赛/u.test(value)) return '决赛';
  if (/冠军/u.test(value)) return '冠军';
  if (/SEMI|\bSF\b/.test(normalized)) return '半决赛';
  if (/QUARTER|\bQF\b/.test(normalized)) return '¼决赛';
  if (/\b(?:FINAL|F)\b/.test(normalized)) return '决赛';
  if (/CHAMPION|WINNER/.test(normalized)) return '冠军';
  const names = ['第一轮', '第二轮', '第三轮', '第四轮', '第五轮'];
  return names[index] || value || '轮次';
}

function localizedRound(label) {
  const value = String(label || '').trim();
  const normalized = value.toUpperCase().replace(/[_-]+/g, ' ');
  const roundOf = /(?:ROUND OF |R)(128|64|32|16)\b/.exec(normalized)?.[1];
  if (roundOf) return `${roundOf}强`;
  if (/半决赛/u.test(value)) return '半决赛';
  if (/1\/4|¼|四分之一/u.test(value)) return '¼决赛';
  if (/冠军/u.test(value)) return '冠军';
  if (/决赛/u.test(value) && !/半决赛/u.test(value)) return '决赛';
  if (/SEMI|\bSF\b/.test(normalized)) return '半决赛';
  if (/QUARTER|\bQF\b/.test(normalized)) return '¼决赛';
  if (/CHAMPION|WINNER/.test(normalized)) return '冠军';
  if (/QUALIFIER/.test(normalized) && !/ROUND/.test(normalized)) return '晋级正赛';
  const qualifying = /QUALIF(?:YING|IER).*?(\d+)/.exec(normalized)?.[1];
  if (qualifying) return `资格赛第${qualifying}轮`;
  if (/\b(?:FINAL|F)\b/.test(normalized)) return '决赛';
  return value || '轮次';
}

const INCIDENT_LABELS = Object.freeze({
  withdrawal: '退赛',
  replacement: '替补',
  draw_change: '签表变动',
  retirement: '中途退赛',
  walkover: '赛前退赛',
  retirement_or_walkover: '退赛 / 赛前晋级'
});

function drawDisciplineLabel(item) {
  const discipline = String(item?.discipline || '');
  if (discipline === 'mixed' || discipline === 'mixed_doubles') return '混双';
  const level = String(item?.competitionLevel || item?.levelCode || '')
    .toLocaleLowerCase('en-US');
  const tourOrg = String(item?.tourOrg || '').toUpperCase();
  const doubles = discipline === 'doubles';
  const women = tourOrg === 'WTA' || /^itf_w/u.test(level)
    || level === 'wta_125' || /^wta_/u.test(level);
  const men = tourOrg === 'ATP' || /^itf_m/u.test(level)
    || /^challenger_/u.test(level) || /^atp_/u.test(level);
  if (women) return doubles ? '女双' : '女单';
  if (men) return doubles ? '男双' : '男单';
  return doubles ? '双打' : discipline === 'singles' ? '单打' : discipline || '项目';
}

function drawStageLabel(item) {
  const labels = Object.freeze({
    main_draw: '正赛',
    qualifying: '资格赛',
    round_robin: '小组赛'
  });
  const stage = String(item?.stage || '');
  return labels[stage] || stage || '签表';
}

function drawGroupLabel(item) {
  return `${drawStageLabel(item)} · ${drawDisciplineLabel(item)}`;
}

function awardBelongsToDraw(award, scope) {
  if (!scope) return true;
  const stage = String(scope.stage || '');
  const discipline = String(scope.discipline || '');
  return (!stage || !award?.stage || award.stage === stage)
    && (!discipline || !award?.discipline || award.discipline === discipline);
}

function officialMetadataView(metadata, scope) {
  const roundAwards = Array.isArray(metadata?.roundAwards)
    ? metadata.roundAwards.filter(value =>
        awardBelongsToDraw(value, scope)).map(value => Object.freeze({
        id: `${value.sourceRoundId || value.roundKey || value.roundLabel}`,
        round: localizedRound(value.roundLabel || value.roundKey),
        prize: value.prizeMoney?.raw || [
          value.prizeMoney?.currency,
          value.prizeMoney?.amount ?? value.prizeMoney?.value
        ].filter(item => item !== undefined && item !== null && item !== '').join(' '),
        points: Number.isFinite(value.rankingPoints?.value)
          ? `${value.rankingPoints.value} 分` : value.rankingPoints?.raw || '',
        sequence: awardSequence(value)
      })).sort((first, second) => first.sequence - second.sequence)
    : [];
  const incidents = Array.isArray(metadata?.incidents)
    ? metadata.incidents.map((value, index) => Object.freeze({
        id: `${value.kind}:${value.displayNameZh || value.displayName}:${index}`,
        kind: INCIDENT_LABELS[value.kind] || '签表变动',
        name: String(value.displayNameZh || value.nameZh || value.displayName || '球员待确认'),
        reason: String(value.descriptionZh || value.reasonZh
          || value.reason || value.rawReason || '')
      }))
    : [];
  return Object.freeze({
    roundAwards: Object.freeze(roundAwards),
    incidents: Object.freeze(incidents)
  });
}

function awardSequence(value) {
  const key = String(value.roundKey || value.roundLabel || '').toLocaleLowerCase('en-US');
  if (/winner|champion/u.test(key)) return 80;
  if (/final/u.test(key) && !/semi|quarter/u.test(key)) return 70;
  if (/semi/u.test(key)) return 60;
  if (/quarter/u.test(key)) return 50;
  const roundOf = /(?:round[_ ]of[_ ]|r)(128|64|32|16)/u.exec(key)?.[1];
  if (roundOf) return { 128: 10, 64: 20, 32: 30, 16: 40 }[roundOf];
  const qualifier = /qualif.*?(\d+)/u.exec(key)?.[1];
  return qualifier ? Number(qualifier) : 45;
}

function tournamentDrawFacts(items) {
  const awardGroups = [];
  const incidents = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const metadata = officialMetadataView(item?.officialMetadata, item);
    if (metadata.roundAwards.length > 0) {
      awardGroups.push(Object.freeze({
        id: String(item.drawId || `${item.stage}:${item.discipline}`),
        label: drawGroupLabel(item),
        rows: metadata.roundAwards
      }));
    }
    for (const incident of metadata.incidents) {
      const key = `${incident.kind}:${incident.name}:${incident.reason}`;
      if (!incidents.has(key)) incidents.set(key, incident);
    }
  }
  return Object.freeze({
    awardGroups: Object.freeze(awardGroups),
    incidents: Object.freeze([...incidents.values()])
  });
}

module.exports = Object.freeze({
  drawGroupLabel,
  drawColumns,
  field,
  localizedOutcomeText,
  officialMetadataView,
  participantName,
  sideScores,
  tournamentDrawFacts
});
