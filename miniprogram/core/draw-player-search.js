'use strict';

function searchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function playerOccurrences(rounds, playerId, selectedRoundId = '') {
  const currentIndex = Math.max(0, rounds.findIndex(round => round.id === selectedRoundId));
  const lastIndex = Math.max(0, rounds.length - 1);
  const values = [];
  for (const [roundIndex, round] of (rounds || []).entries()) {
    for (const match of round.matches || []) {
      const member = (match.sides || []).flatMap(side => side.members || [])
        .find(item => String(item.id || '') === String(playerId || ''));
      if (!member) continue;
      const priority = roundIndex === currentIndex ? 0
        : roundIndex === currentIndex + 1 ? 1
          : roundIndex === lastIndex ? 2
            : 3 + Math.abs(roundIndex - currentIndex);
      values.push(Object.freeze({
        playerId: member.id,
        name: member.name,
        roundId: round.id,
        roundTitle: round.title,
        nodeId: match.id,
        viewId: match.viewId,
        matchId: match.matchId,
        priority,
        roundIndex,
        matchNumber: match.matchNumber
      }));
    }
  }
  return Object.freeze(values.sort((first, second) => first.priority - second.priority
    || first.roundIndex - second.roundIndex
    || first.matchNumber - second.matchNumber
    || first.nodeId.localeCompare(second.nodeId)));
}

function playerSearchResults(rounds, query, selectedRoundId = '') {
  const search = searchText(query);
  if (!search) return Object.freeze([]);
  const players = new Map();
  for (const round of rounds || []) {
    for (const match of round.matches || []) {
      for (const side of match.sides || []) {
        for (const member of side.members || []) {
          const id = String(member.id || '').trim();
          if (!id || id === 'unknown' || id === 'pending' || id === 'bye') continue;
          const aliases = [member.name, ...(member.aliases || [])]
            .map(searchText).filter(Boolean);
          if (!aliases.some(alias => alias.includes(search))) continue;
          if (!players.has(id)) players.set(id, member);
        }
      }
    }
  }
  return Object.freeze([...players.values()].map(member => {
    const occurrences = playerOccurrences(rounds, member.id, selectedRoundId);
    const primary = occurrences[0];
    return Object.freeze({
      id: member.id,
      name: member.name,
      aliases: member.aliases || [],
      roundId: primary?.roundId || '',
      roundTitle: primary?.roundTitle || '',
      nodeId: primary?.nodeId || '',
      viewId: primary?.viewId || '',
      matchId: primary?.matchId || '',
      occurrenceCount: occurrences.length,
      summary: `出现 ${occurrences.length} 处${primary?.roundTitle ? ` · 优先${primary.roundTitle}` : ''}`,
      priority: primary?.priority ?? 999
    });
  }).sort((first, second) => first.priority - second.priority
    || first.name.localeCompare(second.name, 'zh-CN')).slice(0, 8));
}

module.exports = Object.freeze({ playerOccurrences, playerSearchResults, searchText });
