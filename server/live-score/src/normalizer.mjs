const LIVE_STATUSES = new Set([
  'live', 'in progress', 'interrupted', 'suspended', 'paused', 'rain delay',
  'set 1', 'set 2', 'set 3', 'set 4', 'set 5'
]);
const FINISHED_STATUSES = new Set(['finished', 'retired', 'walkover', 'cancelled', 'abandoned']);

function first(raw, keys, fallback = '') {
  for (const key of keys) if (raw?.[key] !== undefined && raw[key] !== null && raw[key] !== '') return raw[key];
  return fallback;
}

function player(raw, side) {
  const prefix = side === 'first' ? 'event_first_player' : 'event_second_player';
  const keyPrefix = side === 'first' ? 'first_player' : 'second_player';
  return {
    id: String(first(raw, [`${prefix}_key`, `${keyPrefix}_key`], '')),
    name: first(raw, [prefix, `${keyPrefix}_name`], '待定'),
    country: first(raw, [`${prefix}_country`, `${keyPrefix}_country`], ''),
    rank: first(raw, [`${prefix}_rank`, `${keyPrefix}_rank`], ''),
    odds: first(raw, [`${prefix}_odd`, `${keyPrefix}_odd`, `${side}_odd`], ''),
    seed: first(raw, [`${prefix}_seed`, `${keyPrefix}_seed`], '')
  };
}

function scoreSets(raw) {
  const scores = Array.isArray(raw.scores) ? raw.scores : [];
  return scores.map((set, index) => ({
    set: first(set, ['score_set', 'set'], index + 1),
    first: first(set, ['score_first', 'first_score'], ''),
    second: first(set, ['score_second', 'second_score'], '')
  }));
}

function inferLastPointSide(raw) {
  const points = Array.isArray(raw.pointbypoint) ? raw.pointbypoint : [];
  const lastGame = points.at(-1);
  const lastPoint = Array.isArray(lastGame?.points) ? lastGame.points.at(-1) : null;
  const winner = first(lastPoint || {}, ['point_winner', 'winner'], '');
  if (['1', 1, 'first', 'First Player'].includes(winner)) return 'first';
  if (['2', 2, 'second', 'Second Player'].includes(winner)) return 'second';
  const pointsInGame = Array.isArray(lastGame?.points) ? lastGame.points : [];
  const current = String(first(lastPoint || {}, ['score'], '')).split(/\s*-\s*/);
  const previousPoint = pointsInGame.at(-2);
  const previous = previousPoint
    ? String(first(previousPoint, ['score'], '')).split(/\s*-\s*/)
    : ['0', '0'];
  if (current.length !== 2 || previous.length !== 2) return '';
  const rank = value => ({ '0': 0, '15': 1, '30': 2, '40': 3, A: 4 }[String(value).trim()]);
  const deltaFirst = rank(current[0]) - rank(previous[0]);
  const deltaSecond = rank(current[1]) - rank(previous[1]);
  if (!Number.isFinite(deltaFirst) || !Number.isFinite(deltaSecond)) return '';
  if (deltaFirst > 0 || deltaSecond < 0) return 'first';
  if (deltaSecond > 0 || deltaFirst < 0) return 'second';
  return '';
}

function currentGameScore(raw) {
  const combined = first(raw, ['event_game_result'], '');
  if (combined !== '') {
    const parts = String(combined).split(/\s*-\s*/);
    if (parts.length === 2) return { first: parts[0], second: parts[1] };
  }
  return {
    first: first(raw, ['event_first_player_game_score'], ''),
    second: first(raw, ['event_second_player_game_score'], '')
  };
}

export function normalizeMatch(raw) {
  const statusText = String(first(raw, ['event_status', 'status'], 'scheduled'));
  const statusLower = statusText.toLowerCase();
  const live = LIVE_STATUSES.has(statusLower) || Boolean(raw.event_live === '1' || raw.event_live === 1);
  const finished = FINISHED_STATUSES.has(statusLower);
  const serve = String(first(raw, ['event_serve', 'serve'], ''));
  const winner = String(first(raw, ['event_winner', 'winner'], ''));
  const type = first(raw, ['event_type_type', 'event_type'], '');
  return {
    id: String(first(raw, ['event_key', 'match_key', 'id'], '')),
    date: first(raw, ['event_date', 'date'], ''),
    time: first(raw, ['event_time', 'time'], ''),
    status: finished ? 'finished' : live ? 'live' : 'scheduled',
    statusText,
    type,
    round: first(raw, ['tournament_round', 'event_round', 'round'], '未标注'),
    tournament: {
      id: String(first(raw, ['tournament_key'], '')),
      name: first(raw, ['tournament_name'], '未命名赛事'),
      country: first(raw, ['tournament_country'], ''),
      logo: first(raw, ['tournament_logo'], ''),
      surface: first(raw, ['tournament_surface', 'surface', 'event_surface'], '未标注'),
      level: first(raw, ['tournament_level', 'tournament_type', 'league_level'], ''),
      tour: /^wta\b/i.test(String(type)) ? 'WTA' : /^atp\b/i.test(String(type)) ? 'ATP' : ''
    },
    court: first(raw, ['event_stadium', 'event_court', 'court', 'stadium'], '未标注'),
    first: player(raw, 'first'),
    second: player(raw, 'second'),
    winner: ['First Player', '1', 'first'].includes(winner) ? 'first' : ['Second Player', '2', 'second'].includes(winner) ? 'second' : '',
    serve: ['First Player', '1', 'first'].includes(serve) ? 'first' : ['Second Player', '2', 'second'].includes(serve) ? 'second' : '',
    lastPoint: inferLastPointSide(raw),
    current: currentGameScore(raw),
    sets: scoreSets(raw),
    dayOffset: Number(first(raw, ['day_offset'], 0)) || 0,
    officialScheduleMatch: false,
    rawUpdatedAt: Date.now()
  };
}

export function isMainTour(match) {
  return /^(?:atp|wta)\b/i.test(String(match?.type || '').trim());
}

export function tournamentLevelRank(tournament = {}) {
  const value = `${tournament.level || ''} ${tournament.nameEn || ''} ${tournament.name || ''} ${tournament.subtitle || ''}`.toLowerCase();
  if (/grand slam|\bgs\b|australian open|roland garros|wimbledon|us open/.test(value)) return 700;
  if (/finals|year.end|\byec\b/.test(value)) return 650;
  if (/\b1000\b|masters/.test(value)) return 600;
  if (/\b500\b/.test(value)) return 500;
  if (/\b250\b/.test(value)) return 400;
  if (/\b125\b/.test(value)) return 300;
  return 200;
}

export function mergeMatches(fixtures = [], live = []) {
  const byId = new Map(fixtures.map(raw => {
    const item = normalizeMatch(raw);
    return [item.id, item];
  }));
  live.forEach(raw => {
    const item = normalizeMatch(raw);
    const prior = byId.get(item.id);
    if (!prior) return byId.set(item.id, item);
    // A freshly refreshed fixture is authoritative once it confirms the match
    // is over. Some providers keep an outdated copy in get_livescore for a
    // while after the final point; do not let that stale row resurrect it.
    if (prior.status === 'finished' && item.status === 'live') return;
    const tournament = {
      ...prior.tournament,
      ...item.tournament,
      name: item.tournament.name === '未命名赛事' ? prior.tournament.name : item.tournament.name,
      surface: item.tournament.surface === '未标注' ? prior.tournament.surface : item.tournament.surface
    };
    byId.set(item.id, {
      ...prior,
      ...item,
      date: item.date || prior.date,
      time: item.time && item.time !== '00:00' ? item.time : prior.time,
      court: item.court === '未标注' ? prior.court : item.court,
      tournament
    });
  });
  return [...byId.values()].sort((a, b) => `${a.time}${a.id}`.localeCompare(`${b.time}${b.id}`));
}

function decimalOdd(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 1 ? String(value) : '';
}

function marketSide(bookmaker = {}, side) {
  const entry = Object.entries(bookmaker).find(([key]) => key.toLowerCase() === side);
  return decimalOdd(entry?.[1]);
}

function homeAwayMarket(eventOdds = {}) {
  return Object.entries(eventOdds || {}).find(([name]) => name.trim().toLowerCase() === 'home/away')?.[1] || null;
}

export function selectPrematchOdds(eventOdds = {}) {
  const market = homeAwayMarket(eventOdds);
  if (!market || typeof market !== 'object') return null;
  const normalizedName = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const priority = ['bet365', '1xbet', 'betway', 'bwin'];
  const home = Object.entries(market).find(([key]) => key.toLowerCase() === 'home')?.[1];
  const away = Object.entries(market).find(([key]) => key.toLowerCase() === 'away')?.[1];
  if (home && away && typeof home === 'object' && typeof away === 'object') {
    const bookmakerNames = [...new Set([...Object.keys(home), ...Object.keys(away)])];
    bookmakerNames.sort((first, second) => {
      const firstIndex = priority.indexOf(normalizedName(first));
      const secondIndex = priority.indexOf(normalizedName(second));
      return (firstIndex < 0 ? priority.length : firstIndex) - (secondIndex < 0 ? priority.length : secondIndex);
    });
    for (const bookmaker of bookmakerNames) {
      const first = decimalOdd(home[bookmaker]);
      const second = decimalOdd(away[bookmaker]);
      if (first && second) return { first, second, bookmaker };
    }
  }
  const bookmakers = Object.entries(market);
  bookmakers.sort(([first], [second]) => {
    const firstIndex = priority.indexOf(normalizedName(first));
    const secondIndex = priority.indexOf(normalizedName(second));
    return (firstIndex < 0 ? priority.length : firstIndex) - (secondIndex < 0 ? priority.length : secondIndex);
  });
  for (const [bookmaker, values] of bookmakers) {
    const first = marketSide(values, 'home');
    const second = marketSide(values, 'away');
    if (first && second) return { first, second, bookmaker };
  }
  return null;
}

export function applyPrematchOdds(matches = [], oddsByEvent = {}) {
  const rows = Array.isArray(oddsByEvent)
    ? new Map(oddsByEvent.map(item => [String(item.event_key || item.match_key || item.id || ''), item.odds || item]))
    : new Map(Object.entries(oddsByEvent || {}).map(([key, value]) => [String(key), value]));
  for (const match of matches) {
    const selected = selectPrematchOdds(rows.get(String(match.id)));
    if (!selected) continue;
    match.first.odds = selected.first;
    match.second.odds = selected.second;
    match.oddsBookmaker = selected.bookmaker;
  }
  return matches;
}

export function groupSchedule(matches) {
  const tournaments = new Map();
  for (const match of matches) {
    const tournamentKey = `${match.tournament.tour || ''}:${match.tournament.name || match.tournament.id}`;
    if (!tournaments.has(tournamentKey)) tournaments.set(tournamentKey, { ...match.tournament, venues: new Map(), matchCount: 0 });
    const tournament = tournaments.get(tournamentKey);
    const court = match.court || '未标注';
    if (!tournament.venues.has(court)) tournament.venues.set(court, []);
    tournament.venues.get(court).push(match);
    tournament.matchCount += 1;
  }
  return [...tournaments.values()]
    .map(tournament => ({
      ...tournament,
      levelRank: tournamentLevelRank(tournament),
      venues: [...tournament.venues]
        .map(([name, venueMatches]) => ({
          name,
          order: Math.min(...venueMatches.map(match => match.courtOrder ?? Number.MAX_SAFE_INTEGER)),
          matches: venueMatches.sort((a, b) => (a.scheduleOrder ?? Number.MAX_SAFE_INTEGER) - (b.scheduleOrder ?? Number.MAX_SAFE_INTEGER)
            || `${a.time}${a.id}`.localeCompare(`${b.time}${b.id}`))
        }))
        .sort((a, b) => a.order - b.order || String(a.name).localeCompare(String(b.name), 'zh-CN'))
    }))
    .sort((a, b) => b.levelRank - a.levelRank
      || (a.sourceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sourceOrder ?? Number.MAX_SAFE_INTEGER)
      || String(a.tour).localeCompare(String(b.tour))
      || String(a.name).localeCompare(String(b.name), 'zh-CN'));
}

export function isObservationWindow(match, now = Date.now(), beforeMs = 20 * 60_000, afterMs = 4 * 60 * 60_000) {
  if (match.status === 'live') return true;
  if (match.status !== 'scheduled' || !match.date || !match.time) return false;
  const base = Date.parse(`${match.scheduleDate || match.date}T${match.time}:00+08:00`);
  const start = base + (Number(match.dayOffset) || 0) * 24 * 60 * 60_000;
  return Number.isFinite(start) && now >= start - beforeMs && now <= start + afterMs;
}
