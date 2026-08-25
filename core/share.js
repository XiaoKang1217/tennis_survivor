'use strict';

const SHARE_IMAGES = Object.freeze({
  match: Object.freeze({
    card: '',
    timeline: ''
  }),
  tournament: Object.freeze({
    card: '',
    timeline: ''
  }),
  player: Object.freeze({
    card: '',
    timeline: ''
  }),
  draw: Object.freeze({
    card: '',
    timeline: ''
  })
});

function cleanText(value, fallback = '') {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  return text || fallback;
}

function truncate(value, maxLength = 42) {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function queryString(values) {
  return Object.keys(values || {})
    .sort()
    .filter(key => values[key] !== undefined && values[key] !== null && values[key] !== '')
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(values[key]))}`)
    .join('&');
}

function withQuery(path, values) {
  const query = queryString(values);
  return query ? `${path}?${query}` : path;
}

function shareImage(candidate, fallback) {
  return cleanText(candidate) || fallback;
}

function enablePageShare() {
  if (!wx.showShareMenu) return;
  wx.showShareMenu({
    withShareTicket: true,
    menus: ['shareAppMessage', 'shareTimeline'],
    fail: () => undefined
  });
}

function knownDisplay(candidate, fallback = '') {
  if (!candidate) return fallback;
  if (candidate.displayText) return cleanText(candidate.displayText, fallback);
  if (candidate.value !== undefined && candidate.value !== null) {
    return cleanText(candidate.value, fallback);
  }
  return fallback;
}

function detailName(detail, fallback = '') {
  if (!detail) return cleanText(fallback);
  return knownDisplay(detail.name, fallback) || cleanText(detail.title, fallback);
}

function detailField(fields, label) {
  const field = (Array.isArray(fields) ? fields : [])
    .find(item => item.label === label && item.available);
  return cleanText(field?.value);
}

function matchSideNames(match) {
  return (Array.isArray(match?.sides) ? match.sides : [])
    .map(side => cleanText(side.names))
    .filter(Boolean);
}

function setScoreText(firstCell, secondCell) {
  if (!firstCell || !secondCell) return '';
  const first = cleanText(firstCell.value);
  const second = cleanText(secondCell.value);
  if (!first || !second) return '';
  const firstGames = Number(first);
  const secondGames = Number(second);
  const loserTiebreak = Number.isFinite(firstGames) && Number.isFinite(secondGames)
    ? firstGames > secondGames ? cleanText(secondCell.tiebreak)
      : secondGames > firstGames ? cleanText(firstCell.tiebreak) : ''
    : '';
  return `${first}-${second}${loserTiebreak ? `(${loserTiebreak})` : ''}`;
}

function matchScoreText(match) {
  const left = Array.isArray(match?.leftScoreCells) ? match.leftScoreCells : [];
  const right = Array.isArray(match?.rightScoreCells) ? match.rightScoreCells : [];
  const sets = left.map((cell, index) => setScoreText(cell, right[index])).filter(Boolean);
  if (sets.length > 0) return sets.join(' ');
  return cleanText(match?.scorePlaceholder);
}

function matchTitle(match) {
  const names = matchSideNames(match);
  const matchup = names.length >= 2 ? `${names[0]} vs ${names[1]}`
    : names[0] || '比赛详情';
  const score = matchScoreText(match);
  const tournament = cleanText(match?.tournamentName);
  const round = cleanText(match?.roundLabel);
  const scope = [tournament, round].filter(Boolean).join(' · ');
  const prefix = match?.group === 'in_progress' ? '炉网实时比分'
    : match?.group === 'ended' ? '炉网赛果' : '炉网比赛';
  const suffix = score || scope;
  return truncate(`${prefix}｜${matchup}${suffix ? ` ${suffix}` : ''}`);
}

function matchShare(match, fallback = {}) {
  const matchId = cleanText(match?.id, cleanText(fallback.matchId));
  const date = cleanText(match?.scheduleGroupDate, cleanText(fallback.date));
  const title = matchTitle(match) || '炉网比赛详情';
  const params = { matchId, date, shared: 'match' };
  return Object.freeze({
    appMessage: Object.freeze({
      title,
      path: matchId ? withQuery('/pages/match-detail/index', params) : '/pages/scores/index',
      imageUrl: shareImage(fallback.cardImageUrl, SHARE_IMAGES.match.card)
    }),
    timeline: Object.freeze({
      title,
      query: queryString(params),
      imageUrl: shareImage(fallback.timelineImageUrl, SHARE_IMAGES.match.timeline)
    })
  });
}

function tournamentShare(detail, fallback = {}) {
  const tournamentEditionId = cleanText(
    detail?.tournamentEditionId,
    cleanText(fallback.tournamentEditionId)
  );
  const name = detailName(detail, fallback.title || '赛事详情');
  const location = detailField(detail?.location, '城市');
  const title = truncate(`炉网赛事｜${name}${location ? ` · ${location}` : ''}`);
  const params = {
    tournamentEditionId,
    title: name,
    tour: cleanText(detail?.requestTour, cleanText(fallback.tour)),
    shared: 'tournament'
  };
  return Object.freeze({
    appMessage: Object.freeze({
      title,
      path: tournamentEditionId
        ? withQuery('/packages/tournament/pages/tournament-detail/index', params)
        : '/pages/calendar/index',
      imageUrl: shareImage(fallback.cardImageUrl, SHARE_IMAGES.tournament.card)
    }),
    timeline: Object.freeze({
      title,
      query: queryString(params),
      imageUrl: shareImage(fallback.timelineImageUrl, SHARE_IMAGES.tournament.timeline)
    })
  });
}

function playerShare(data = {}) {
  const playerId = cleanText(data.playerId);
  const tour = cleanText(data.tour, 'ATP');
  const name = cleanText(data.name, cleanText(data.originalName, '球员资料'));
  const countryCode = cleanText(data.countryCode);
  const position = cleanText(data.position);
  const rank = position ? ` 世界排名 ${position}` : '';
  const title = truncate(`炉网球员｜${name}${rank}`);
  const params = {
    playerId,
    tour,
    name,
    originalName: cleanText(data.originalName),
    countryCode,
    position,
    points: cleanText(data.points),
    shared: 'player'
  };
  return Object.freeze({
    appMessage: Object.freeze({
      title,
      path: playerId
        ? withQuery('/packages/player/pages/player-detail/index', params)
        : '/packages/player/pages/players/index',
      imageUrl: shareImage(data.shareCardImageUrl, SHARE_IMAGES.player.card)
    }),
    timeline: Object.freeze({
      title,
      query: queryString(params),
      imageUrl: shareImage(data.shareTimelineImageUrl, SHARE_IMAGES.player.timeline)
    })
  });
}

function selectedDrawLabel(draws, drawId) {
  const draw = (Array.isArray(draws) ? draws : [])
    .find(item => item.drawId === drawId);
  return cleanText(draw?.label);
}

function drawShare(data = {}, fallback = {}) {
  const tournamentEditionId = cleanText(data.selectedTournamentId);
  const titleHint = cleanText(data.selectedTitle, '赛事签表');
  const drawId = cleanText(data.selectedDrawId);
  const drawLabel = selectedDrawLabel(data.draws, drawId);
  const title = truncate(`炉网签表｜${titleHint}${drawLabel ? ` ${drawLabel}` : ''}`);
  const params = {
    tournamentEditionId,
    title: titleHint,
    drawId,
    tour: cleanText(data.selectedTour, cleanText(fallback.tour)),
    date: cleanText(fallback.date),
    shared: 'draw'
  };
  return Object.freeze({
    appMessage: Object.freeze({
      title,
      path: tournamentEditionId ? withQuery('/pages/draws/index', params) : '/pages/draws/index',
      imageUrl: shareImage(data.shareCardImageUrl, SHARE_IMAGES.draw.card)
    }),
    timeline: Object.freeze({
      title,
      query: queryString(params),
      imageUrl: shareImage(data.shareTimelineImageUrl, SHARE_IMAGES.draw.timeline)
    })
  });
}

module.exports = Object.freeze({
  cleanText,
  drawShare,
  enablePageShare,
  matchShare,
  playerShare,
  queryString,
  tournamentShare,
  withQuery
});
