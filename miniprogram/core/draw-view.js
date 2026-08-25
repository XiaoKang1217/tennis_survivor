'use strict';

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'object') return '';
  if (value.state === 'available' || value.state === 'known') {
    return text(value.displayText) || text(value.value);
  }
  return text(value.displayText)
    || text(value.label)
    || text(value.name)
    || text(value.title)
    || text(value.value);
}

function field(candidate, fallback = '') {
  return text(candidate) || fallback;
}

function firstText(...values) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return '';
}

function participantName(slot) {
  if (slot?.state === 'bye') return '轮空';
  if (slot?.state === 'pending') return '待定';
  const members = participantMembers(slot);
  if (members.length > 1) return members.map(member => member.name).join(' / ');
  return members[0]?.name || '待定';
}

function participantMembers(slot) {
  if (slot?.state === 'bye') return Object.freeze([
    Object.freeze({ id: 'bye', name: '轮空', country: '' })
  ]);
  if (slot?.state === 'pending') return Object.freeze([
    Object.freeze({ id: 'pending', name: '待定', country: '' })
  ]);
  const participant = slot?.participant || slot?.entry || slot?.side || {};
  const sourceMembers = Array.isArray(participant.members)
    ? participant.members : Array.isArray(slot?.members) ? slot.members : [];
  const members = sourceMembers
    .map((member, index) => memberView(member, index))
    .filter(member => member.name);
  if (members.length > 0) return Object.freeze(members);
  const name = firstText(
    participant.displayNameZh,
    participant.displayNameOriginal,
    participant.nameZh,
    participant.name,
    participant.displayName,
    slot?.displayNameZh,
    slot?.displayNameOriginal
  );
  if (name) return Object.freeze([
    Object.freeze({
      id: firstText(participant.playerId, participant.id, slot?.participantSideId) || 'participant',
      name,
      country: firstText(participant.countryMark, participant.countryCode, participant.country?.code)
    })
  ]);
  return Object.freeze([
    Object.freeze({ id: 'unknown', name: '待定', country: '' })
  ]);
}

function memberView(member, index) {
  return Object.freeze({
    id: firstText(member.playerId, member.id) || `member-${index}`,
    name: firstText(
      member.displayNameZh,
      member.displayNameOriginal,
      member.nameZh,
      member.name,
      member.displayName
    ) || (index === 0 ? '待定' : ''),
    country: firstText(member.countryMark, member.countryCode, member.country?.code)
  });
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

function visibleStatus(value) {
  const label = localizedOutcomeText(value);
  if (!label || /^(已完赛|完赛|正常完赛|Completed)$/iu.test(label)) return '';
  return label;
}

function roundTitle(label, index = 0) {
  const value = String(label || '').trim();
  const normalized = value.toUpperCase().replace(/[_-]+/g, ' ');
  const code = normalized.replace(/\s+/g, '');
  if (/资格赛.*决胜轮|QUALIF(?:YING|IER).*FINAL|^QR$/u.test(value + normalized)) return '资格赛决胜轮';
  const qualifying = /QUALIF(?:YING|IER).*?(\d+)/u.exec(normalized)?.[1]
    || /^Q([1-9])$/u.exec(code)?.[1];
  if (qualifying) {
    const number = Number(qualifying);
    if (number === 1) return '资格赛第一轮';
    if (number === 2) return '资格赛第二轮';
    if (number === 3) return '资格赛决胜轮';
    return `资格赛第${number}轮`;
  }
  const roundNumber = /ROUND\s*([1-9])\b/u.exec(normalized)?.[1]
    || /^ROUND_?([1-9])$/u.exec(code)?.[1];
  if (roundNumber) return ordinalRound(Number(roundNumber));
  const roundOf = /(?:ROUND OF |R)(128|96|64|48|32|16)\b/u.exec(normalized)?.[1];
  if (roundOf) return roundOfTitle(roundOf, index);
  if (/半决赛/u.test(value) || /SEMI|\bSF\b/u.test(normalized)) return '半决赛';
  if (/1\/4|¼|四分之一/u.test(value) || /QUARTER|\bQF\b/u.test(normalized)) return '四分之一决赛';
  if (/冠军/u.test(value) || /CHAMPION|WINNER/u.test(normalized)) return '冠军';
  if (/决赛/u.test(value) || /\b(?:FINAL|F)\b/u.test(normalized)) return '决赛';
  const names = ['第一轮', '第二轮', '第三轮', '第四轮', '第五轮'];
  return names[index] || value || '轮次';
}

function ordinalRound(number) {
  return ['第一轮', '第二轮', '第三轮', '第四轮', '第五轮'][number - 1]
    || `第${number}轮`;
}

function roundOfTitle(value, index) {
  const labels = Object.freeze({
    128: '第一轮',
    96: '第二轮',
    64: '第二轮',
    48: '第三轮',
    32: '三十二强',
    16: '十六强'
  });
  return labels[value] || ordinalRound(index + 1);
}

function localizedRound(label, index = 0) {
  return roundTitle(label, index);
}

function drawColumns(presentation) {
  const slots = new Map((presentation?.slots || []).map(slot => [slot.slotId, slot]));
  const rounds = presentation?.rounds || [];
  const sourceMatches = presentation?.matches || [];
  const cardHeight = 124;
  const stride = 146;
  const columnDrafts = rounds.map((round, roundIndex) => {
    const matches = sourceMatches
      .filter(match => match.roundId === round.roundId)
      .sort((first, second) => Number(first.bracketIndex ?? 0)
        - Number(second.bracketIndex ?? 0))
      .map((match, matchIndex) => {
        const first = slots.get(match.slotIds?.[0]);
        const second = slots.get(match.slotIds?.[1]);
        const firstMembers = participantMembers(first);
        const secondMembers = participantMembers(second);
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
          status: visibleStatus(match.statusLabel),
          scoreText: localizedOutcomeText(match.scoreText),
          first: firstMembers.map(member => member.name).filter(Boolean).join(' / ') || participantName(first),
          second: secondMembers.map(member => member.name).filter(Boolean).join(' / ') || participantName(second),
          firstMembers,
          secondMembers,
          firstSeed: field(first?.seedNumber),
          secondSeed: field(second?.seedNumber),
          firstEntry: entryLabel(first?.entryLabelZh || first?.entryCode),
          secondEntry: entryLabel(second?.entryLabelZh || second?.entryCode),
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
      title: roundTitle(round.displayNameZh || round.roundKey || round.roundCode, roundIndex),
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
          incomingStyle: 'top:68rpx;height:1rpx',
          first: participantName(winnerSlot),
          firstMembers: participantMembers(winnerSlot),
          firstSeed: field(winnerSlot?.seedNumber),
          firstEntry: entryLabel(winnerSlot?.entryLabelZh || winnerSlot?.entryCode),
          status: '冠军'
        })
      ])
    })
  ]);
}

function drawRoundView(presentation, selectedRoundId = '', focusedPlayerId = '') {
  const slots = new Map((presentation?.slots || []).map(slot => [slot.slotId, slot]));
  const rounds = (presentation?.rounds || []).map((round, index) => Object.freeze({
    id: round.roundId,
    title: roundTitle(round.displayNameZh || round.roundKey || round.roundCode, index),
    current: Boolean(round.current || round.isCurrent || round.isActive)
  }));
  const defaultRoundId = selectedRoundId && rounds.some(round => round.id === selectedRoundId)
    ? selectedRoundId
    : firstText(
      presentation?.currentRoundId,
      presentation?.activeRoundId,
      presentation?.defaultRoundId
    ) || rounds.find(round => round.current)?.id || rounds[0]?.id || '';
  const roundItems = rounds.map(round => {
    const matches = (presentation?.matches || [])
      .filter(match => match.roundId === round.id)
      .sort((first, second) => Number(first.bracketIndex ?? 0)
        - Number(second.bracketIndex ?? 0))
      .map((match, index) => roundMatchView(match, slots, index, focusedPlayerId));
    return Object.freeze({
      ...round,
      selected: round.id === defaultRoundId,
      matchCount: matches.length,
      hasFocusedPlayer: Boolean(focusedPlayerId)
        && matches.some(match => match.focused),
      matches: Object.freeze(matches)
    });
  });
  const selectedRound = roundItems.find(round => round.selected) || roundItems[0];
  return Object.freeze({
    selectedRoundId: selectedRound?.id || '',
    selectedRoundTitle: selectedRound?.title || '',
    selectedRoundMatchCount: selectedRound?.matchCount || 0,
    roundTabs: Object.freeze(roundItems.map(({ matches: _matches, ...round }) => Object.freeze(round))),
    roundMatches: selectedRound?.matches || Object.freeze([]),
    rounds: Object.freeze(roundItems)
  });
}

function roundMatchView(match, slots, index, focusedPlayerId = '') {
  const first = slots.get(match.slotIds?.[0]);
  const second = slots.get(match.slotIds?.[1]);
  const winnerId = field(match.winnerSideId);
  const firstSide = sideView(first, match.score, 1, winnerId, focusedPlayerId);
  const secondSide = sideView(second, match.score, 2, winnerId, focusedPlayerId);
  const focused = firstSide.focused || secondSide.focused;
  return Object.freeze({
    id: match.nodeId || match.matchId?.value || `match-${index}`,
    matchId: field(match.matchId),
    canOpen: Boolean(match.canOpenMatch && field(match.matchId)),
    status: visibleStatus(match.statusLabel),
    scoreText: localizedOutcomeText(match.scoreText),
    focused,
    sides: Object.freeze([firstSide, secondSide])
  });
}

function sideView(slot, score, side, winnerId, focusedPlayerId = '') {
  const members = participantMembers(slot);
  return Object.freeze({
    id: sideIdentity(slot) || `side-${side}`,
    seed: field(slot?.seedNumber),
    entry: entryLabel(slot?.entryLabelZh || slot?.entryCode),
    isWinner: Boolean(winnerId) && winnerId === sideIdentity(slot),
    scores: sideScores(score, side),
    hasScores: sideScores(score, side).length > 0,
    focused: Boolean(focusedPlayerId) && members.some(member => member.id === focusedPlayerId),
    members
  });
}

function entryLabel(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toUpperCase();
  const labels = Object.freeze({
    WC: '外卡',
    Q: '资格赛晋级',
    LL: '幸运落败者',
    ALT: '替补',
    PR: '保护排名',
    SR: '保护排名'
  });
  return labels[normalized] ? `${labels[normalized]} · ${normalized}` : raw;
}

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
  return `${drawDisciplineLabel(item)} · ${drawStageLabel(item)}`;
}

function drawSelectionView(items, selectedDrawId = '') {
  const draws = (Array.isArray(items) ? items : []).map(item => Object.freeze({
    ...item,
    projectKey: drawProjectKey(item),
    projectLabel: drawDisciplineLabel(item),
    stageKey: String(item?.stage || 'unknown'),
    stageLabel: drawStageLabel(item),
    label: drawGroupLabel(item)
  }));
  const active = draws.find(item => item.drawId === selectedDrawId) || draws[0] || null;
  const projectKeys = new Set();
  const projectOptions = [];
  for (const item of draws) {
    if (projectKeys.has(item.projectKey)) continue;
    projectKeys.add(item.projectKey);
    projectOptions.push(Object.freeze({
      id: item.projectKey,
      label: item.projectLabel,
      drawId: preferredDrawForProject(draws, item.projectKey, active?.stageKey)?.drawId || item.drawId,
      selected: item.projectKey === active?.projectKey
    }));
  }
  const stageOptions = draws
    .filter(item => item.projectKey === active?.projectKey)
    .map(item => Object.freeze({
      id: item.stageKey,
      label: item.stageLabel,
      drawId: item.drawId,
      selected: item.drawId === active?.drawId
    }));
  return Object.freeze({
    drawOptions: Object.freeze(draws),
    activeDraw: active,
    selectedDrawLabel: active?.label || '',
    projectOptions: Object.freeze(projectOptions),
    stageOptions: Object.freeze(stageOptions)
  });
}

function drawProjectKey(item) {
  return `${drawDisciplineLabel(item)}:${String(item?.discipline || '')}:${String(item?.tourOrg || '')}`;
}

function preferredDrawForProject(draws, projectKey, stageKey) {
  return draws.find(item => item.projectKey === projectKey && item.stageKey === stageKey)
    || draws.find(item => item.projectKey === projectKey);
}

function awardBelongsToDraw(award, scope) {
  if (!scope) return true;
  const drawId = firstText(scope.drawId, scope.id);
  if (award?.drawId && drawId && award.drawId !== drawId) return false;
  const stage = String(scope.stage || '');
  const discipline = String(scope.discipline || '');
  return (!stage || !award?.stage || award.stage === stage)
    && (!discipline || !award?.discipline || award.discipline === discipline);
}

function officialMetadataView(metadata, scope = {}) {
  const roundAwards = Array.isArray(metadata?.roundAwards)
    ? metadata.roundAwards.filter(value =>
        awardBelongsToDraw(value, scope)).map((value, index) => Object.freeze({
        id: firstText(value.sourceRoundId, value.roundId, value.roundKey, value.roundLabel)
          || `round-award-${index}`,
        round: localizedRound(value.roundLabel || value.roundKey, index),
        prize: moneyLabel(value.prizeMoney),
        prizeBasis: prizeBasisLabel(value),
        points: Number.isFinite(value.rankingPoints?.value)
          ? `${value.rankingPoints.value} 分` : firstText(value.rankingPoints?.raw, '—'),
        sequence: awardSequence(value)
      })).sort((first, second) => first.sequence - second.sequence)
    : [];
  const withdrawals = [
    ...recordsFrom(metadata?.withdrawals, 'withdrawal', scope),
    ...incidentRecords(metadata?.incidents, ['withdrawal'], scope)
  ];
  const drawChanges = [
    ...recordsFrom(metadata?.drawChanges, 'draw_change', scope),
    ...incidentRecords(metadata?.incidents, ['replacement', 'draw_change', 'alternate'], scope)
  ];
  return Object.freeze({
    roundAwards: Object.freeze(roundAwards),
    withdrawals: Object.freeze(withdrawals),
    drawChanges: Object.freeze(drawChanges),
    incidents: Object.freeze([...withdrawals, ...drawChanges])
  });
}

function moneyLabel(value) {
  return firstText(value?.raw, [
    firstText(value?.currency),
    firstText(value?.amount, value?.value)
  ].filter(Boolean).join(' '), '—');
}

function prizeBasisLabel(value) {
  const raw = firstText(
    value.prizeBasis,
    value.prizeMoney?.basis,
    value.prizeMoney?.scope,
    value.prizeMoney?.unit
  ).toLocaleLowerCase('en-US');
  if (/team|pair|队/u.test(raw)) return '每队';
  if (/person|player|individual|人/u.test(raw)) return '每人';
  return '';
}

function recordsFrom(values, fallbackKind, scope = {}) {
  return Array.isArray(values)
    ? values
      .filter(value => recordBelongsToDraw(value, scope) && !isMatchOutcomeRecord(value))
      .map((value, index) => recordView(value, fallbackKind, index))
      .filter(Boolean)
    : [];
}

function incidentRecords(values, kinds, scope = {}) {
  return Array.isArray(values)
    ? values
      .filter(value => kinds.includes(String(value?.kind || ''))
        && recordBelongsToDraw(value, scope)
        && !isMatchOutcomeRecord(value))
      .map((value, index) => recordView(value, value.kind, index))
      .filter(Boolean)
    : [];
}

function recordBelongsToDraw(value, scope = {}) {
  if (!scope) return true;
  const drawId = firstText(scope.drawId, scope.id);
  const recordDrawId = firstText(value?.drawId, value?.scope?.drawId, value?.draw?.drawId);
  if (recordDrawId && drawId && recordDrawId !== drawId) return false;
  const stage = String(scope.stage || '');
  const recordStage = firstText(value?.stage, value?.scope?.stage);
  if (recordStage && stage && recordStage !== stage) return false;
  const discipline = String(scope.discipline || '');
  const recordDiscipline = firstText(value?.discipline, value?.scope?.discipline);
  return !(recordDiscipline && discipline && recordDiscipline !== discipline);
}

function isMatchOutcomeRecord(value) {
  const raw = [
    value?.kind,
    value?.type,
    value?.resultKind,
    value?.result?.kind,
    value?.statusCode,
    value?.status?.code,
    value?.outcomeCode
  ].map(item => String(item || '').trim().toUpperCase()).filter(Boolean);
  return raw.some(item => /^(RET|RETIREMENT|W\/O|WO|WALKOVER|DEF|DEFAULT|DSQ|NS|NO_SHOW)$/u.test(item));
}

function recordView(value, fallbackKind, index) {
  if (!value || typeof value !== 'object') return null;
  const kind = recordKindLabel(value.kind || fallbackKind);
  return Object.freeze({
    id: firstText(value.id, value.changeId, value.withdrawalId)
      || `${fallbackKind}:${firstText(value.displayNameZh, value.displayName, value.name, index)}`,
    kind,
    name: firstText(value.displayNameZh, value.nameZh, value.displayName, value.name, value.playerName, '—'),
    originalName: firstText(value.originalDisplayNameZh, value.originalName, value.oldName),
    replacementName: firstText(value.replacementDisplayNameZh, value.replacementName, value.newName),
    round: localizedRound(firstText(value.roundLabel, value.roundKey, value.roundId)),
    position: firstText(value.positionLabel, value.position),
    time: compactDate(firstText(value.effectiveAt, value.occurredAt, value.updatedAt, value.dateLabel)),
    reason: firstText(value.descriptionZh, value.reasonZh, value.reason, value.rawReason, value.note)
  });
}

function recordKindLabel(value) {
  const labels = Object.freeze({
    withdrawal: '退赛',
    replacement: '替补',
    alternate: '替补',
    draw_change: '签表变动'
  });
  return labels[value] || '签表变动';
}

function compactDate(value) {
  const raw = text(value);
  if (!raw) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/.exec(raw);
  if (!match) return raw;
  const date = `${Number(match[2])}月${Number(match[3])}日`;
  return match[4] ? `${date} ${match[4]}:${match[5]}` : date;
}

function awardSequence(value) {
  const key = String(value.roundKey || value.roundLabel || '').toLocaleLowerCase('en-US');
  if (/winner|champion/u.test(key)) return 80;
  if (/final/u.test(key) && !/semi|quarter/u.test(key)) return 70;
  if (/semi/u.test(key)) return 60;
  if (/quarter|qf/u.test(key)) return 50;
  const roundOf = /(?:round[_ ]of[_ ]|r)(128|96|64|48|32|16)/u.exec(key)?.[1];
  if (roundOf) return { 128: 10, 96: 15, 64: 20, 48: 25, 32: 30, 16: 40 }[roundOf];
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
  drawColumns,
  drawGroupLabel,
  drawRoundView,
  drawSelectionView,
  field,
  localizedOutcomeText,
  localizedRound,
  officialMetadataView,
  participantMembers,
  participantName,
  sideScores,
  tournamentDrawFacts
});
