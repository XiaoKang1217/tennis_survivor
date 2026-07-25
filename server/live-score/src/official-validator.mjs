import fs from 'node:fs/promises';
import { parseAtpOopPdf } from './atp-oop-pdf.mjs';

const PLAYER_A_WINNERS = new Set(['2', '4', '6']);
const PLAYER_B_WINNERS = new Set(['3', '5', '7']);

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalized(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function playerTokens(value = '') {
  return normalized(value).split(' ').filter(token => token.length > 1);
}

function surname(value = '') {
  return playerTokens(value).at(-1) || '';
}

function samePlayer(first = '', second = '') {
  const left = normalized(first);
  const right = normalized(second);
  if (!left || !right) return false;
  if (left === right || surname(left) === surname(right)) return true;
  const leftTokens = new Set(playerTokens(left));
  const rightTokens = new Set(playerTokens(right));
  return [...leftTokens].every(token => rightTokens.has(token))
    || [...rightTokens].every(token => leftTokens.has(token));
}

function teamPlayers(value = '') {
  return String(value).split('/').map(player => player.trim()).filter(Boolean);
}

function sameTeam(first = '', second = '') {
  const left = teamPlayers(first);
  const right = teamPlayers(second);
  if (!left.length || left.length !== right.length) return false;
  const used = new Set();
  return left.every(player => {
    const index = right.findIndex((candidate, candidateIndex) =>
      !used.has(candidateIndex) && samePlayer(player, candidate));
    if (index < 0) return false;
    used.add(index);
    return true;
  });
}

function placeholderOption(value = '') {
  return /^(?:(?:qualifier|lucky loser|alternate|tbd|winner)(?:\s*(?:of)?\s*\d+)?|[abq]|ll)$/i
    .test(String(value).trim());
}

function officialTeamOptions(official = {}) {
  const seen = new Set();
  return [official.name, ...(official.alternatives || [])].filter(value => {
    const key = normalized(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function teamMatches(value, official = {}) {
  const options = officialTeamOptions(official);
  if (options.some(option => sameTeam(value, option))) return true;
  // ATP OOP rows may temporarily say Qualifier, Lucky Loser, A or B, etc.
  // Such a row is not used to identify a candidate, but remains in the
  // official sheet so the next PDF revision can resolve it without deleting
  // the fixtures candidate.
  return options.some(placeholderOption);
}

function officialTeamName(official = {}, fallback = '') {
  const options = officialTeamOptions(official);
  return options.find(option => sameTeam(fallback, option))
    || (placeholderOption(official.name) ? fallback : official.name)
    || fallback;
}

function officialTeamDisplay(official = {}) {
  const options = officialTeamOptions(official);
  return options.length > 1 ? options.join(' or ') : (options[0] || '待定');
}

function matchKind(match = {}) {
  const type = String(match.type || '').toLowerCase();
  return `${type.includes('wta') || type.includes('women') ? 'W' : 'M'}${type.includes('doubles') ? 'D' : 'S'}`;
}

function orientation(match, official) {
  const first = match.first?.nameEn || match.first?.name || '';
  const second = match.second?.nameEn || match.second?.name || '';
  if (teamMatches(first, official.first) && teamMatches(second, official.second)) return 'direct';
  if (teamMatches(first, official.second) && teamMatches(second, official.first)) return 'reversed';
  return '';
}

function tournamentText(match = {}) {
  return normalized([
    match.tournament?.nameEn,
    match.tournament?.name,
    match.tournament?.city,
    match.tournament?.country
  ].filter(Boolean).join(' '));
}

function tournamentNames(tournament) {
  return [tournament.city, tournament.name, ...(tournament.aliases || [])]
    .map(normalized)
    .filter(Boolean);
}

function officialTournamentMatches(match, tournament) {
  if (String(match.tournament?.tour || '').toUpperCase() !== tournament.tour) return false;
  const source = tournamentText(match);
  if (!source) return false;
  return tournamentNames(tournament).some(name => source.includes(name) || name.includes(source));
}

function pairingBelongsToTournament(match, tournament) {
  return (tournament.matches || []).some(official =>
    matchKind(match) === official.kind && Boolean(orientation(match, official)));
}

function resolveOfficialTeam(team = {}, results = [], tournament, kind, officialDate = '') {
  const options = officialTeamOptions(team);
  if (options.length < 2) return team;
  const eligible = [...results]
    .filter(result => {
      const resultDate = result.scheduleDate || result.officialScheduleDate || result.date || '';
      return !officialDate || !resultDate || resultDate <= officialDate;
    })
    .sort((first, second) => String(
      second.scheduleDate || second.officialScheduleDate || second.date || ''
    ).localeCompare(String(
      first.scheduleDate || first.officialScheduleDate || first.date || ''
    )));
  for (const result of eligible) {
    if (result.status !== 'finished' || !result.winner) continue;
    if (kind && matchKind(result) !== kind) continue;
    if (tournament && !officialTournamentMatches(result, tournament)) continue;
    const firstName = result.first?.nameEn || result.first?.name || '';
    const secondName = result.second?.nameEn || result.second?.name || '';
    const firstOption = options.find(option => sameTeam(firstName, option));
    const secondOption = options.find(option => sameTeam(secondName, option));
    if (!firstOption || !secondOption || firstOption === secondOption) continue;
    const winner = result.winner === 'first' ? firstOption : secondOption;
    return {
      ...team,
      name: winner,
      alternatives: [],
      resolvedFrom: `finished:${result.id || ''}`
    };
  }
  return team;
}

function resolveOfficialMatch(official, results, tournament) {
  const first = resolveOfficialTeam(
    official.first,
    results,
    tournament,
    official.kind,
    official.scheduleDate
  );
  const second = resolveOfficialTeam(
    official.second,
    results,
    tournament,
    official.kind,
    official.scheduleDate
  );
  return {
    ...official,
    first,
    second,
    provisional: Boolean(first.alternatives?.length || second.alternatives?.length)
  };
}

function playerName(player = {}) {
  return `${player.FirstName || ''} ${player.SurName || ''}`.replace(/\s+/g, ' ').trim();
}

function teamFromOop(entry = {}) {
  const players = asArray(entry.Player);
  return {
    name: players.map(playerName).filter(Boolean).join('/'),
    ids: players.map(player => String(player.id || '')).filter(Boolean),
    countries: players.map(player => player.Country || '').filter(Boolean)
  };
}

function beijingDateTime(date, time = '') {
  if (!date || !time) return { date: '', time: '' };
  const normalizedOffset = String(time).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const timestamp = Date.parse(`${date}T${normalizedOffset}`);
  if (!Number.isFinite(timestamp)) return { date: '', time: '' };
  const value = new Date(timestamp);
  return {
    date: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(value),
    time: new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(value)
  };
}

function wtaStatus(result = {}, oop = {}) {
  if (String(result.MatchState || '').toUpperCase() === 'F'
    || String(oop.Status || '').toLowerCase() === 'completed') return 'finished';
  if (String(result.MatchState || '').toUpperCase() === 'C') return 'cancelled';
  return 'scheduled';
}

function wtaWinner(result = {}) {
  const value = String(result.Winner || '');
  if (PLAYER_A_WINNERS.has(value)) return 'first';
  if (PLAYER_B_WINNERS.has(value)) return 'second';
  return '';
}

function wtaSets(result = {}) {
  const sets = [];
  for (let index = 1; index <= 5; index += 1) {
    let first = result[`ScoreSet${index}A`];
    let second = result[`ScoreSet${index}B`];
    if (first === '' || first === undefined || second === '' || second === undefined) continue;
    const decidingTiebreak = result[`ScoreTbSet${index}`];
    if (decidingTiebreak !== '' && decidingTiebreak !== undefined
      && ((String(first) === '1' && String(second) === '0')
        || (String(first) === '0' && String(second) === '1'))) {
      [first, second] = String(first) === '1'
        ? ['10', String(decidingTiebreak)]
        : [String(decidingTiebreak), '10'];
    }
    sets.push({ set: String(index), first: String(first), second: String(second) });
  }
  return sets;
}

function parsedOop(oop = {}) {
  return asArray(oop?.orderOfPlay).map(value => {
    try { return typeof value === 'string' ? JSON.parse(value) : value; } catch (_) { return null; }
  }).find(Boolean);
}

function oopDay(oop, date) {
  return asArray(parsedOop(oop)?.OOP?.Schedule?.Day).find(item => item.ISODate === date);
}

function oopMatchIds(oop, date) {
  const ids = new Set();
  asArray(oopDay(oop, date)?.Court).forEach(court => {
    asArray(court?.Matches?.Match).forEach(item => {
      const id = String(item.MatchId || item.MatchID || item.matchId || '');
      if (id) ids.add(id);
    });
  });
  return ids;
}

function wtaCountry(meta = {}) {
  return meta.country
    || meta.countryName
    || meta.tournamentGroup?.country
    || meta.tournamentGroup?.countryName
    || meta.location?.country
    || '';
}

export function parseWtaOfficialTournament({
  tournament,
  oop,
  results,
  date,
  supersededIds = new Set()
}) {
  const day = oopDay(oop, date);
  if (!day) return null;
  const resultById = new Map(asArray(results?.matches).map(result => [String(result.MatchID || ''), result]));
  const matches = [];
  asArray(day.Court).forEach((court, courtOrder) => {
    asArray(court?.Matches?.Match).forEach((item, matchOrder) => {
      const id = String(item.MatchId || item.MatchID || item.matchId || '');
      if (!/^L[SD]/.test(id) || supersededIds.has(id)) return;
      const teams = asArray(item.Players);
      if (teams.length !== 2) return;
      const first = teamFromOop(teams[0]);
      const second = teamFromOop(teams[1]);
      if (!first.name || !second.name) return;
      const result = resultById.get(id) || {};
      const clock = beijingDateTime(date, item.NotBeforeISOTime);
      const status = wtaStatus(result, item);
      matches.push({
        id,
        kind: id.startsWith('LD') ? 'WD' : 'WS',
        first,
        second,
        court: court.CourtName || result.CourtName || '未标注',
        courtOrder,
        scheduleOrder: courtOrder * 100 + Number(item.seq || matchOrder),
        scheduleDate: date,
        date: clock.date,
        time: clock.time,
        status,
        statusText: status === 'finished' ? 'Finished' : '',
        winner: wtaWinner(result),
        sets: wtaSets(result)
      });
    });
  });
  const meta = tournament?.tournamentGroup ? tournament : oop?.tournament || results?.tournament || tournament;
  const group = meta?.tournamentGroup || {};
  return {
    tour: 'WTA',
    id: String(group.id || meta?.liveScoringId || ''),
    year: Number(meta?.year || date.slice(0, 4)),
    name: meta?.title || group.name || meta?.city || 'WTA',
    city: meta?.city || group.name || '',
    country: wtaCountry(meta),
    aliases: [group.name, meta?.city].filter(Boolean),
    surface: ({ Clay: '红土', Hard: '硬地', Grass: '草地' })[meta?.surface] || meta?.surface || '未标注',
    level: meta?.level || group.level || '',
    officialUrl: `https://www.wtatennis.com/scores?date=${date}&status=All`,
    source: 'WTA official',
    complete: true,
    matches
  };
}

function swapSets(sets = []) {
  return sets.map(set => ({ ...set, first: set.second, second: set.first }));
}

function tournamentMetadata(tournament) {
  return {
    id: String(tournament.id || tournament.atpId || ''),
    name: tournament.name || tournament.city,
    nameEn: tournament.name,
    city: tournament.city || '',
    country: tournament.country || '',
    canonicalKey: `${tournament.tour}:${tournament.id || tournament.atpId}:${tournament.year}`,
    surface: tournament.surface,
    level: tournament.level,
    timeZone: tournament.timeZone || '',
    tour: tournament.tour,
    officialUrl: tournament.officialUrl,
    officialSource: tournament.source
  };
}

function officialRawMatch(official, tournament) {
  const metadata = tournamentMetadata(tournament);
  const firstName = officialTeamDisplay(official.first);
  const secondName = officialTeamDisplay(official.second);
  return {
    id: `official:${tournament.tour.toLowerCase()}:${metadata.id}:${tournament.year}:${official.id}`,
    date: official.date || official.scheduleDate,
    time: official.time || '待定',
    status: official.status,
    statusText: official.statusText,
    type: `${tournament.tour === 'WTA' ? 'Wta' : 'Atp'} ${official.kind.endsWith('D') ? 'Doubles' : 'Singles'}`,
    round: official.round || '未标注',
    tournament: { ...metadata, logo: '' },
    court: official.court,
    first: {
      id: official.first.ids?.[0] || '',
      officialIds: official.first.ids || [],
      name: firstName,
      nameEn: firstName,
      alternatives: official.first.alternatives || [],
      country: official.first.countries?.[0] || '',
      rank: '', odds: '', seed: ''
    },
    second: {
      id: official.second.ids?.[0] || '',
      officialIds: official.second.ids || [],
      name: secondName,
      nameEn: secondName,
      alternatives: official.second.alternatives || [],
      country: official.second.countries?.[0] || '',
      rank: '', odds: '', seed: ''
    },
    winner: official.winner,
    serve: '',
    lastPoint: '',
    current: { first: '', second: '' },
    sets: official.sets || [],
    dayOffset: official.date && official.date !== official.scheduleDate ? 1 : 0,
    scheduleDate: official.scheduleDate,
    officialScheduleDate: official.scheduleDate,
    scheduleOrder: official.scheduleOrder,
    courtOrder: official.courtOrder,
    officialScheduleMatch: true,
    officialMainTour: official.officialMainTour !== false,
    provisional: Boolean(
      official.provisional
      || official.first.alternatives?.length
      || official.second.alternatives?.length
    ),
    providerId: '',
    officialMatchId: official.id,
    rawUpdatedAt: Date.now()
  };
}

function overlayTournamentMetadata(match, tournament) {
  return {
    ...match,
    tournament: {
      ...match.tournament,
      ...tournamentMetadata(tournament),
      logo: match.tournament?.logo || ''
    }
  };
}

function overlayOfficial(match, official, tournament, direction) {
  const reversed = direction === 'reversed';
  const officialFirst = reversed ? official.second : official.first;
  const officialSecond = reversed ? official.first : official.second;
  const officialWinner = reversed
    ? official.winner === 'first' ? 'second' : official.winner === 'second' ? 'first' : ''
    : official.winner;
  const officialSets = reversed ? swapSets(official.sets || []) : (official.sets || []);
  const result = {
    ...overlayTournamentMetadata(match, tournament),
    court: official.court || match.court,
    scheduleOrder: official.scheduleOrder,
    courtOrder: official.courtOrder,
    scheduleDate: official.scheduleDate,
    officialScheduleDate: official.scheduleDate,
    officialScheduleMatch: true,
    officialMatchId: official.id,
    first: {
      ...match.first,
      nameEn: officialTeamName(officialFirst, match.first?.nameEn || match.first?.name)
    },
    second: {
      ...match.second,
      nameEn: officialTeamName(officialSecond, match.second?.nameEn || match.second?.name)
    }
  };
  if (official.date) {
    result.date = official.date;
    result.time = official.time || '待定';
    result.dayOffset = official.date === official.scheduleDate ? 0 : 1;
  }
  // OOP fixes immutable schedule fields. Status and score remain the provider's
  // responsibility unless an official WTA result explicitly confirms terminal.
  if (official.status === 'finished') {
    result.status = 'finished';
    result.statusText = official.statusText || 'Finished';
    result.current = { first: '', second: '' };
    result.serve = '';
    if (officialWinner) result.winner = officialWinner;
    if (officialSets.length) result.sets = officialSets;
  } else if (official.status === 'cancelled') {
    result.status = 'cancelled';
    result.statusText = 'Cancelled';
  }
  return result;
}

export function reconcileOfficialSchedule(matches = [], reference = null, date = '', finishedResults = []) {
  let remaining = [...matches];
  const output = [];
  for (const tournament of reference?.tours || []) {
    const candidates = remaining.filter(match =>
      officialTournamentMatches(match, tournament)
      || pairingBelongsToTournament(match, tournament));
    if (!candidates.length) {
      if (tournament.complete) {
        output.push(...(tournament.matches || [])
          .map(official => resolveOfficialMatch(official, finishedResults, tournament))
          .map(official => officialRawMatch(official, tournament)));
      }
      continue;
    }
    const candidateSet = new Set(candidates);
    remaining = remaining.filter(match => !candidateSet.has(match));
    const used = new Set();
    for (const rawOfficial of tournament.matches || []) {
      const official = resolveOfficialMatch(rawOfficial, finishedResults, tournament);
      const candidate = candidates.map((match, index) => ({ match, index }))
        .filter(({ match, index }) => !used.has(index) && matchKind(match) === official.kind)
        .map(item => ({ ...item, direction: orientation(item.match, official) }))
        .find(item => item.direction);
      if (candidate) {
        used.add(candidate.index);
        output.push(overlayOfficial(candidate.match, official, tournament, candidate.direction));
      } else {
        output.push(officialRawMatch(official, tournament));
      }
    }
    candidates.forEach((match, index) => {
      if (!used.has(index) && !tournament.complete) {
        output.push(overlayTournamentMetadata(match, tournament));
      }
    });
  }
  output.push(...remaining);
  return output.filter(match => !date || !match.officialScheduleDate || match.officialScheduleDate === date);
}

function registryMatchesCandidate(registry, match) {
  if (String(match.tournament?.tour || '').toUpperCase() !== 'ATP') return false;
  const source = tournamentText(match);
  if (!source) return false;
  const names = [registry.name, registry.city, ...(registry.aliases || [])].map(normalized).filter(Boolean);
  return names.some(name => source.includes(name) || name.includes(source));
}

function registryActiveOn(registry, date) {
  return Number(registry.year) === Number(date.slice(0, 4))
    && registry.startDate <= date
    && registry.endDate >= date;
}

function cityAgrees(registry, parsed) {
  const expected = normalized(registry.city);
  const actual = normalized(parsed.city);
  return Boolean(expected && actual && (expected.includes(actual) || actual.includes(expected)));
}

const COUNTRY_CODES = new Map([
  ['austria', 'aut'], ['portugal', 'por'], ['united states', 'usa'],
  ['united states of america', 'usa'], ['usa', 'usa'], ['mexico', 'mex'],
  ['canada', 'can'], ['china', 'chn'], ['japan', 'jpn'],
  ['kazakhstan', 'kaz'], ['belgium', 'bel'], ['france', 'fra'],
  ['switzerland', 'sui'], ['sweden', 'swe'], ['italy', 'ita']
]);

function countryIdentity(value = '') {
  const key = normalized(value);
  return COUNTRY_CODES.get(key) || key;
}

function countryAgrees(registry, parsed) {
  return Boolean(
    countryIdentity(registry.country)
    && countryIdentity(registry.country) === countryIdentity(parsed.country)
  );
}

function surfaceAgrees(registry, parsed) {
  const identity = value => {
    const text = String(value || '').toLowerCase();
    if (/clay|红土/.test(text)) return 'clay';
    if (/hard|硬地/.test(text)) return 'hard';
    if (/grass|草地/.test(text)) return 'grass';
    return normalized(text);
  };
  return Boolean(identity(registry.surface) && identity(registry.surface) === identity(parsed.surface));
}

export class OfficialScheduleValidator {
  constructor({
    cache,
    baseUrl = 'https://api.wtatennis.com/tennis',
    ttlMs = 5 * 60_000,
    fetchImpl = fetch,
    atpRegistryFile = null,
    atpRegistryDirectory = new URL('../data/', import.meta.url),
    atpRegistry = null,
    parseAtpPdf = parseAtpOopPdf
  }) {
    this.cache = cache;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.ttlMs = ttlMs;
    this.fetchImpl = fetchImpl;
    this.atpRegistryFile = atpRegistryFile;
    this.atpRegistryDirectory = atpRegistryDirectory;
    this.parseAtpPdf = parseAtpPdf;
    this.injectedAtpRegistry = atpRegistry;
    this.atpRegistryPromises = new Map();
  }

  saved(date) {
    return this.cache.data.officialReferences?.[date] || null;
  }

  async registry(year) {
    if (this.injectedAtpRegistry) {
      return this.injectedAtpRegistry.filter(item => Number(item.year) === Number(year));
    }
    const key = String(year);
    if (!this.atpRegistryPromises.has(key)) {
      const file = this.atpRegistryFile
        || new URL(`atp-tournaments-${key}.json`, this.atpRegistryDirectory);
      this.atpRegistryPromises.set(key, fs.readFile(file, 'utf8').then(JSON.parse));
    }
    return this.atpRegistryPromises.get(key);
  }

  async json(path) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(12_000),
      headers: { accept: 'application/json', 'user-agent': 'LuWang official schedule validator' }
    });
    if (!response.ok) throw new Error(`WTA official HTTP ${response.status}`);
    return response.json();
  }

  async fetchWta(date) {
    const calendar = await this.json(`/tournaments/?page=0&pageSize=30&excludeLevels=ITF&from=${date}&to=${date}`);
    const tournaments = asArray(calendar?.content)
      .filter(item => /^WTA (?:125|250|500|1000)$/.test(item.level || item.tournamentGroup?.level || ''));
    const nextDate = new Date(`${date}T00:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const followingDate = nextDate.toISOString().slice(0, 10);
    const settled = await Promise.allSettled(tournaments.map(async tournament => {
      const id = tournament.tournamentGroup?.id || tournament.liveScoringId;
      const year = tournament.year || date.slice(0, 4);
      const [oop, results] = await Promise.all([
        this.json(`/tournaments/${id}/${year}/oop`),
        this.json(`/tournaments/${id}/${year}/matches?from=${date}&to=${followingDate}`)
      ]);
      return parseWtaOfficialTournament({
        tournament,
        oop,
        results,
        date,
        supersededIds: oopMatchIds(oop, followingDate)
      });
    }));
    settled.filter(item => item.status === 'rejected')
      .forEach(item => console.warn('[official-wta-tournament]', item.reason?.message || item.reason));
    return settled.filter(item => item.status === 'fulfilled').map(item => item.value).filter(Boolean);
  }

  snapshotKey(registry, date) {
    return `${registry.atpId}:${date}`;
  }

  savedAtpSnapshot(registry, date) {
    return this.cache.data.atpOopSnapshots?.[this.snapshotKey(registry, date)]?.current || null;
  }

  saveAtpSnapshot(registry, parsed, sourceUrl, fetchedAt) {
    this.cache.data.atpOopSnapshots ||= {};
    const key = this.snapshotKey(registry, parsed.date);
    const saved = this.cache.data.atpOopSnapshots[key] || { revisions: [] };
    const snapshot = {
      atpId: registry.atpId,
      officialScheduleDate: parsed.date,
      sourceUrl,
      fetchedAt,
      sha256: parsed.sha256,
      parsed
    };
    if (!saved.revisions.some(item => item.sha256 === parsed.sha256)) {
      saved.revisions.push(snapshot);
    }
    saved.current = snapshot;
    this.cache.data.atpOopSnapshots[key] = saved;
    this.cache.scheduleWrite();
    return snapshot;
  }

  atpTourFromSnapshot(registry, snapshot, complete = true) {
    const parsed = snapshot.parsed;
    return {
      tour: 'ATP',
      id: registry.atpId,
      year: registry.year,
      name: registry.name,
      city: parsed.city || registry.city,
      country: parsed.country || registry.country,
      aliases: registry.aliases || [],
      surface: parsed.surface || registry.surface,
      level: registry.level,
      officialUrl: snapshot.sourceUrl,
      source: 'ATP official OOP PDF',
      complete,
      timeZone: registry.timeZone,
      officialScheduleDate: parsed.date,
      oopSha256: parsed.sha256,
      matches: parsed.matches
    };
  }

  atpFallbackTour(registry) {
    return {
      tour: 'ATP',
      id: registry.atpId,
      year: registry.year,
      name: registry.name,
      city: registry.city,
      country: registry.country,
      aliases: registry.aliases || [],
      surface: registry.surface,
      level: registry.level,
      officialUrl: registry.officialUrl,
      source: 'ATP official calendar; OOP pending',
      complete: false,
      timeZone: registry.timeZone,
      matches: []
    };
  }

  async fetchAtpTournament(registry, date, now) {
    const saved = this.savedAtpSnapshot(registry, date);
    const sourceUrl = `https://www.protennislive.com/posting/${registry.year}/${registry.atpId}/op.pdf`;
    try {
      const response = await this.fetchImpl(sourceUrl, {
        signal: AbortSignal.timeout(15_000),
        headers: { accept: 'application/pdf', 'user-agent': 'LuWang ATP OOP validator' }
      });
      if (!response.ok) throw new Error(`ATP OOP HTTP ${response.status}`);
      const parsed = this.parseAtpPdf(Buffer.from(await response.arrayBuffer()), registry);
      if (parsed.date !== date) {
        throw new Error(`ATP OOP currently contains ${parsed.date}, requested ${date}`);
      }
      if (!cityAgrees(registry, parsed)) {
        throw new Error(`ATP OOP city mismatch: registry=${registry.city}, pdf=${parsed.city}`);
      }
      if (!countryAgrees(registry, parsed)) {
        throw new Error(`ATP OOP country mismatch: registry=${registry.country}, pdf=${parsed.country}`);
      }
      if (!surfaceAgrees(registry, parsed)) {
        throw new Error(`ATP OOP surface mismatch: registry=${registry.surface}, pdf=${parsed.surface}`);
      }
      const snapshot = this.saveAtpSnapshot(registry, parsed, sourceUrl, now);
      return this.atpTourFromSnapshot(registry, snapshot);
    } catch (error) {
      if (saved?.parsed?.date === date) {
        console.warn(`[official-atp:${registry.atpId}:${date}] using saved snapshot:`, error.message);
        return this.atpTourFromSnapshot(registry, saved);
      }
      console.warn(`[official-atp:${registry.atpId}:${date}] OOP pending:`, error.message);
      return this.atpFallbackTour(registry);
    }
  }

  async fetchAtp(date, candidates = [], now = Date.now()) {
    const registry = (await this.registry(date.slice(0, 4))).filter(item => registryActiveOn(item, date));
    // Fetch every official ATP tournament active on this calendar date. A
    // complete OOP may contain a match missing from get_fixtures, while an
    // unpublished OOP still returns a metadata-only fallback and leaves every
    // fixtures candidate intact.
    const relevant = registry;
    const settled = await Promise.all(relevant.map(item => this.fetchAtpTournament(item, date, now)));
    return settled;
  }

  async refresh(date, now = Date.now(), force = false, candidates = []) {
    const saved = this.saved(date);
    if (!force && saved && now - saved.fetchedAt < this.ttlMs) return saved;
    try {
      const [wtaResult, atpResult] = await Promise.allSettled([
        this.fetchWta(date),
        this.fetchAtp(date, candidates, now)
      ]);
      const wtaTours = wtaResult.status === 'fulfilled'
        ? wtaResult.value
        : (saved?.tours || []).filter(tour => tour.tour === 'WTA');
      const atpTours = atpResult.status === 'fulfilled'
        ? atpResult.value
        : (saved?.tours || []).filter(tour => tour.tour === 'ATP');
      if (wtaResult.status === 'rejected') console.warn('[official-wta]', wtaResult.reason?.message);
      if (atpResult.status === 'rejected') console.warn('[official-atp]', atpResult.reason?.message);
      const value = { date, fetchedAt: now, tours: [...atpTours, ...wtaTours] };
      this.cache.data.officialReferences ||= {};
      // Daily official references are intentionally retained. The UI only
      // exposes five days, but production snapshots are not deleted with it.
      this.cache.data.officialReferences[date] = value;
      this.cache.scheduleWrite();
      return value;
    } catch (error) {
      if (saved) return saved;
      throw error;
    }
  }

  reconcile(matches, date, finishedResults = []) {
    return reconcileOfficialSchedule(matches, this.saved(date), date, finishedResults);
  }
}
