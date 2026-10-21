const LIVE_STATUSES = new Set([
  'live', 'in progress', 'interrupted', 'suspended', 'paused', 'rain delay',
  'set 1', 'set 2', 'set 3', 'set 4', 'set 5'
]);
const FINISHED_STATUSES = new Set(['finished', 'retired', 'walkover']);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'abandoned']);

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
  const cancelled = CANCELLED_STATUSES.has(statusLower);
  const serve = String(first(raw, ['event_serve', 'serve'], ''));
  const winner = String(first(raw, ['event_winner', 'winner'], ''));
  const type = first(raw, ['event_type_type', 'event_type'], '');
  return {
    id: String(first(raw, ['event_key', 'match_key', 'id'], '')),
    date: first(raw, ['event_date', 'date'], ''),
    time: first(raw, ['event_time', 'time'], ''),
    status: cancelled ? 'cancelled' : finished ? 'finished' : live ? 'live' : 'scheduled',
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

export function identity(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function playerIdentity(player = {}) {
  return identity(player.nameEn || player.name || player.id);
}

function matchFingerprint(match = {}) {
  const teams = [playerIdentity(match.first), playerIdentity(match.second)].sort();
  return [identity(match.type), ...teams].join('|');
}

function normalizedUpdate(value = {}) {
  return value.first && value.second && value.tournament ? value : normalizeMatch(value);
}

/**
 * Overlay volatile scoring fields on an immutable schedule.
 *
 * The schedule is the allow-list. A livescore row may update status, score,
 * server and point state for an existing pairing, but it can never create a
 * match or replace tournament/date/time/court/surface/player identity.
 */
export function overlayLiveScores(schedule = [], updates = []) {
  const output = schedule.map(match => structuredClone(match));
  const byId = new Map();
  const byFingerprint = new Map();

  output.forEach(match => {
    [match.id, match.providerId].filter(Boolean)
      .forEach(id => byId.set(String(id), match));
    const fingerprint = matchFingerprint(match);
    if (fingerprint) {
      if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, []);
      byFingerprint.get(fingerprint).push(match);
    }
  });

  for (const raw of updates) {
    const update = normalizedUpdate(raw);
    let target = byId.get(String(update.id || ''));
    if (!target) {
      const candidates = byFingerprint.get(matchFingerprint(update)) || [];
      if (candidates.length === 1) target = candidates[0];
    }
    if (!target) continue;

    const targetTerminal = target.status === 'finished' || target.status === 'cancelled';
    const updateTerminal = update.status === 'finished' || update.status === 'cancelled';
    if (targetTerminal && !updateTerminal) continue;

    if (!target.providerId && update.id && update.id !== target.id) {
      target.providerId = update.id;
      byId.set(String(update.id), target);
    }

    target.status = update.status;
    target.statusText = update.statusText;
    target.rawUpdatedAt = update.rawUpdatedAt;
    if (update.sets?.length) target.sets = structuredClone(update.sets);
    if (update.winner) target.winner = update.winner;

    if (updateTerminal) {
      target.current = { first: '', second: '' };
      target.serve = '';
      target.lastPoint = '';
    } else if (update.status === 'live') {
      target.current = { ...update.current };
      target.serve = update.serve;
      target.lastPoint = update.lastPoint;
    }
  }
  return output;
}

export function mergeMatches(fixtures = [], live = []) {
  const schedule = fixtures.map(normalizedUpdate);
  return overlayLiveScores(schedule, live)
    .sort((a, b) => `${a.time}${a.id}`.localeCompare(`${b.time}${b.id}`));
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
    if (match.status === 'cancelled') continue;
    const tournamentKey = match.tournament.canonicalKey
      || `${match.tournament.tour || ''}:${match.tournament.id || match.tournament.nameEn || match.tournament.name}`;
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
            || (Number(a.dayOffset) || 0) - (Number(b.dayOffset) || 0)
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
