const PLAYER_A_WINNERS = new Set(['2', '4', '6']);
const PLAYER_B_WINNERS = new Set(['3', '5', '7']);

const ATP_TOURNAMENTS = [
  {
    aliases: ['kitzbuhel', 'kitzbühel'],
    name: 'Generali Open',
    city: 'Kitzbühel',
    surface: '红土',
    level: 'ATP 250',
    officialUrl: 'https://www.atptour.com/en/scores/current/kitzbuhel/319/results'
  },
  {
    aliases: ['estoril'],
    name: 'Millennium Estoril Open',
    city: 'Estoril',
    surface: '红土',
    level: 'ATP 250',
    officialUrl: 'https://www.atptour.com/en/scores/current/estoril/7290/results'
  }
];

function officialTeam(name) {
  return { name, ids: [], countries: [] };
}

function officialMatch({
  id,
  kind = 'MS',
  first,
  second,
  court,
  courtOrder = 0,
  scheduleOrder,
  scheduleDate = '2026-07-22',
  date = '',
  time = '',
  round = '',
  status = 'finished',
  statusText = status === 'finished' ? 'Finished' : '',
  winner = '',
  sets = []
}) {
  return {
    id,
    kind,
    first: officialTeam(first),
    second: officialTeam(second),
    court,
    courtOrder,
    scheduleOrder: scheduleOrder ?? Number(String(id).match(/(\d+)$/)?.[1] || 0),
    scheduleDate,
    date,
    time,
    round,
    status,
    statusText,
    winner,
    sets: sets.map(([a, b], index) => ({
      set: String(index + 1),
      first: String(a),
      second: String(b)
    }))
  };
}

// ATP pages do not expose a supported public JSON endpoint. These complete
// official day sheets are transcribed from the ATP-linked ProTennisLive Order
// of Play PDFs. API Tennis remains the primary source for every other ATP day.
const ATP_VERIFIED_DAYS = {
  '2026-07-22': [
    {
      tour: 'ATP',
      id: '7290',
      year: 2026,
      name: 'Millennium Estoril Open',
      city: 'Estoril',
      aliases: ['estoril'],
      surface: '红土',
      level: 'ATP 250',
      officialUrl: 'https://www.atptour.com/en/scores/current/estoril/7290/daily-schedule?day=5',
      source: 'ATP official daily schedule',
      complete: true,
      matches: [
        officialMatch({ id: 'estoril-1', first: 'Hugo Gaston', second: 'Titouan Droguet', court: 'ESTADIO MILLENNIUM', winner: 'first', sets: [[6, 0], [6, 3]] }),
        officialMatch({ id: 'estoril-2', first: 'Roman Andres Burruchaga', second: 'Nuno Borges', court: 'ESTADIO MILLENNIUM', winner: 'first', sets: [[6, 1], [4, 6], [6, 3]] }),
        officialMatch({ id: 'estoril-3', first: 'Tiago Torres', second: 'Alejandro Tabilo', court: 'ESTADIO MILLENNIUM', winner: 'second', sets: [[4, 6], [4, 6]] }),
        officialMatch({ id: 'estoril-4', first: 'Alexander Blockx', second: 'Kyrian Jacquet', court: 'ESTADIO MILLENNIUM', winner: 'first', sets: [[3, 6], [6, 4], [7, 6]] }),
        officialMatch({ id: 'estoril-5', kind: 'MD', first: 'Orlando Luz/Rafael Matos', second: 'Ray Ho/Benjamin Kittay', court: 'COURT CASCAIS', winner: 'first', sets: [[7, 6], [6, 2]] }),
        officialMatch({ id: 'estoril-6', kind: 'MD', first: 'Nuno Borges/Francisco Cabral', second: 'Arthur Reymond/Luca Sanchez', court: 'COURT CASCAIS', winner: 'first', sets: [[7, 6], [7, 6]] }),
        officialMatch({ id: 'estoril-7', kind: 'MD', first: 'Joao Domingues/Tiago Torres', second: 'Jaime Faria/Henrique Rocha', court: 'COURT CASCAIS', winner: 'first', sets: [[1, 6], [6, 3], [10, 8]] }),
        officialMatch({ id: 'estoril-8', kind: 'MD', first: 'Vasil Kirkov/Bart Stevens', second: 'Marcelo Demoliner/Robert Galloway', court: 'COURT CTE', winner: 'first', sets: [[6, 2], [3, 6], [10, 7]] })
      ]
    },
    {
      tour: 'ATP',
      id: '319',
      year: 2026,
      name: 'Generali Open',
      city: 'Kitzbühel',
      aliases: ['kitzbuhel', 'kitzbühel'],
      surface: '红土',
      level: 'ATP 250',
      officialUrl: 'https://www.atptour.com/en/scores/current/kitzbuhel/319/daily-schedule?day=5',
      source: 'ATP official daily schedule',
      complete: true,
      matches: [
        officialMatch({ id: 'kitzbuhel-1', first: 'Quentin Halys', second: 'Valentin Vacherot', court: 'Center Court', winner: 'first', sets: [[6, 3], [6, 4]] }),
        officialMatch({ id: 'kitzbuhel-2', first: 'Mariano Navone', second: 'Jan-Lennard Struff', court: 'Center Court', winner: 'first', sets: [[6, 0], [6, 3]] }),
        officialMatch({ id: 'kitzbuhel-3', first: 'Tomas Martin Etcheverry', second: 'Jurij Rodionov', court: 'Center Court', winner: 'first', sets: [[6, 2], [7, 6]] }),
        officialMatch({ id: 'kitzbuhel-4', first: 'Alexander Bublik', second: 'Facundo Diaz Acosta', court: 'Center Court', winner: 'first', sets: [[6, 3], [7, 5]] }),
        officialMatch({ id: 'kitzbuhel-5', kind: 'MD', first: 'Lucas Miedler/Marc Polmans', second: 'Adam Pavlasek/Patrik Rikl', court: 'Center Court', winner: 'first', sets: [[6, 3], [7, 6]] }),
        officialMatch({ id: 'kitzbuhel-6', first: 'Sebastian Baez', second: 'Arthur Rinderknech', court: 'Grandstand', winner: 'first', sets: [[7, 6], [2, 6], [6, 4]] }),
        officialMatch({ id: 'kitzbuhel-7', first: 'Ignacio Buse', second: 'Kilian Feldbausch', court: 'Grandstand', winner: 'first', sets: [[2, 6], [6, 2], [6, 2]] }),
        officialMatch({ id: 'kitzbuhel-8', first: 'Alex Molcan', second: 'Daniel Altmaier', court: 'Grandstand', winner: 'first', sets: [[6, 3], [3, 6], [7, 5]] }),
        officialMatch({ id: 'kitzbuhel-9', kind: 'MD', first: 'Jakob Schnaitter/Mark Wallner', second: 'Andres Molteni/Patrik Trhac', court: 'Küchenmeister', winner: 'first', sets: [[6, 3], [6, 2]] }),
        officialMatch({ id: 'kitzbuhel-10', first: 'Yannick Hanfmann', second: 'Marco Trungelliti', court: 'Küchenmeister', winner: 'first', sets: [[6, 4], [7, 6]] }),
        officialMatch({ id: 'kitzbuhel-11', kind: 'MD', first: 'N.Sriram Balaji/Andre Goransson', second: 'Constantin Frantzen/Robin Haase', court: 'Küchenmeister', winner: 'first', sets: [[6, 4], [7, 6]] })
      ]
    }
  ],
  '2026-07-23': [
    {
      tour: 'ATP',
      id: '7290',
      year: 2026,
      name: 'Millennium Estoril Open',
      city: 'Estoril',
      aliases: ['estoril'],
      surface: '红土',
      level: 'ATP 250',
      officialUrl: 'https://www.atptour.com/en/scores/current/estoril/7290/daily-schedule?day=2',
      source: 'ATP official daily schedule',
      complete: true,
      matches: [
        officialMatch({ id: 'estoril-20260723-1', first: 'Luca Van Assche', second: 'Pablo Carreno Busta', court: 'ESTADIO MILLENNIUM', scheduleDate: '2026-07-23', date: '2026-07-23', time: '19:00', round: 'R16', status: 'scheduled', scheduleOrder: 1 }),
        officialMatch({ id: 'estoril-20260723-2', first: 'Jaime Faria', second: 'Gonzalo Bueno', court: 'ESTADIO MILLENNIUM', scheduleDate: '2026-07-23', date: '2026-07-23', time: '21:00', round: 'R16', status: 'scheduled', scheduleOrder: 2 }),
        officialMatch({ id: 'estoril-20260723-3', first: 'Andrey Rublev', second: 'Timofey Skatov', court: 'ESTADIO MILLENNIUM', scheduleDate: '2026-07-23', date: '2026-07-24', time: '00:00', round: 'R16', status: 'scheduled', scheduleOrder: 3 }),
        officialMatch({ id: 'estoril-20260723-4', first: 'Pedro Martinez', second: 'Luciano Darderi', court: 'ESTADIO MILLENNIUM', scheduleDate: '2026-07-23', date: '2026-07-24', time: '', round: 'R16', status: 'scheduled', scheduleOrder: 4 }),
        officialMatch({ id: 'estoril-20260723-5', kind: 'MD', first: 'Diego Hidalgo/Alejandro Tabilo', second: 'Sander Arends/David Pel', court: 'COURT CASCAIS', courtOrder: 1, scheduleDate: '2026-07-23', date: '2026-07-23', time: '20:00', round: 'QF', status: 'scheduled', scheduleOrder: 101 }),
        officialMatch({ id: 'estoril-20260723-6', kind: 'MD', first: 'Joao Domingues/Tiago Torres', second: 'Orlando Luz/Rafael Matos', court: 'COURT CASCAIS', courtOrder: 1, scheduleDate: '2026-07-23', date: '2026-07-23', time: '', round: 'QF', status: 'scheduled', scheduleOrder: 102 }),
        officialMatch({ id: 'estoril-20260723-7', kind: 'MD', first: 'Titouan Droguet/Kyrian Jacquet', second: 'Santiago Gonzalez/Miguel Angel Reyes-Varela', court: 'COURT CTE', courtOrder: 2, scheduleDate: '2026-07-23', date: '2026-07-23', time: '20:00', round: 'QF', status: 'scheduled', scheduleOrder: 201 })
      ]
    },
    {
      tour: 'ATP',
      id: '319',
      year: 2026,
      name: 'Generali Open',
      city: 'Kitzbühel',
      aliases: ['kitzbuhel', 'kitzbühel'],
      surface: '红土',
      level: 'ATP 250',
      officialUrl: 'https://www.atptour.com/en/scores/current/kitzbuhel/319/daily-schedule?day=1',
      source: 'ATP official daily schedule',
      complete: true,
      matches: [
        officialMatch({ id: 'kitzbuhel-20260723-1', first: 'Quentin Halys', second: 'Mariano Navone', court: 'Center Court', scheduleDate: '2026-07-23', date: '2026-07-23', time: '17:00', round: 'QF', status: 'finished', winner: 'first', sets: [[7, 5], [6, 3]], scheduleOrder: 1 }),
        officialMatch({ id: 'kitzbuhel-20260723-2', first: 'Yannick Hanfmann', second: 'Sebastian Baez', court: 'Center Court', scheduleDate: '2026-07-23', date: '2026-07-23', time: '', round: 'QF', status: 'finished', winner: 'first', sets: [[6, 3], [6, 1]], scheduleOrder: 2 }),
        officialMatch({ id: 'kitzbuhel-20260723-3', first: 'Tomas Martin Etcheverry', second: 'Ignacio Buse', court: 'Center Court', scheduleDate: '2026-07-23', date: '2026-07-23', time: '', round: 'QF', status: 'finished', winner: 'first', sets: [[6, 2], [7, 5]], scheduleOrder: 3 }),
        officialMatch({ id: 'kitzbuhel-20260723-4', first: 'Alexander Bublik', second: 'Alex Molcan', court: 'Center Court', scheduleDate: '2026-07-23', date: '2026-07-23', time: '', round: 'QF', status: 'scheduled', scheduleOrder: 4 }),
        officialMatch({ id: 'kitzbuhel-20260723-5', kind: 'MD', first: 'Pierre-Hugues Herbert/Kevin Krawietz', second: 'Lukas Neumayer/Joel Schwaerzler', court: 'Grandstand', courtOrder: 1, scheduleDate: '2026-07-23', date: '2026-07-23', time: '17:30', round: 'QF', status: 'finished', winner: 'first', sets: [[6, 3], [6, 4]], scheduleOrder: 101 }),
        officialMatch({ id: 'kitzbuhel-20260723-6', kind: 'MD', first: 'Jean-Julien Rojer/Theodore Winegar', second: 'Lucas Miedler/Marc Polmans', court: 'Grandstand', courtOrder: 1, scheduleDate: '2026-07-23', date: '2026-07-23', time: '23:00', round: 'QF', status: 'scheduled', scheduleOrder: 102 })
      ]
    }
  ],
  '2026-07-24': [
    {
      tour: 'ATP',
      id: '7290',
      year: 2026,
      name: 'Millennium Estoril Open',
      city: 'Estoril',
      aliases: ['estoril'],
      surface: '红土',
      level: 'ATP 250',
      officialUrl: 'https://www.protennislive.com/posting/2026/7290/op.pdf',
      source: 'ATP official OOP PDF',
      complete: true,
      matches: [
        officialMatch({ id: 'estoril-20260724-1', first: 'Tiago Torres', second: 'Hugo Gaston', court: 'ESTADIO MILLENNIUM', scheduleDate: '2026-07-24', date: '2026-07-24', time: '18:00', round: 'QF', status: 'scheduled', scheduleOrder: 1 }),
        officialMatch({ id: 'estoril-20260724-2', first: 'Andrey Rublev', second: 'Luca Van Assche', court: 'ESTADIO MILLENNIUM', scheduleDate: '2026-07-24', date: '2026-07-24', time: '', round: 'QF', status: 'scheduled', scheduleOrder: 2 }),
        officialMatch({ id: 'estoril-20260724-3', first: 'Roman Andres Burruchaga', second: 'Alexander Blockx', court: 'ESTADIO MILLENNIUM', scheduleDate: '2026-07-24', date: '2026-07-24', time: '23:00', round: 'QF', status: 'scheduled', scheduleOrder: 3 }),
        officialMatch({ id: 'estoril-20260724-4', first: 'Jaime Faria', second: 'Luciano Darderi', court: 'ESTADIO MILLENNIUM', scheduleDate: '2026-07-24', date: '2026-07-24', time: '', round: 'QF', status: 'scheduled', scheduleOrder: 4 }),
        officialMatch({ id: 'estoril-20260724-5', kind: 'MD', first: 'Vasil Kirkov/Bart Stevens', second: 'Nuno Borges/Francisco Cabral', court: 'COURT CASCAIS', courtOrder: 1, scheduleDate: '2026-07-24', date: '2026-07-24', time: '20:00', round: 'QF', status: 'scheduled', scheduleOrder: 101 }),
        officialMatch({ id: 'estoril-20260724-6', kind: 'MD', first: 'Sander Arends/David Pel', second: 'Orlando Luz/Rafael Matos', court: 'COURT CASCAIS', courtOrder: 1, scheduleDate: '2026-07-24', date: '2026-07-24', time: '', round: 'SF', status: 'scheduled', scheduleOrder: 102 })
      ]
    },
    {
      tour: 'ATP',
      id: '319',
      year: 2026,
      name: 'Generali Open',
      city: 'Kitzbühel',
      aliases: ['kitzbuhel', 'kitzbühel'],
      surface: '红土',
      level: 'ATP 250',
      officialUrl: 'https://www.protennislive.com/posting/2026/319/op.pdf',
      source: 'ATP official OOP PDF',
      complete: true,
      matches: [
        officialMatch({ id: 'kitzbuhel-20260724-1', kind: 'MD', first: 'Pierre-Hugues Herbert/Kevin Krawietz', second: 'Jakob Schnaitter/Mark Wallner', court: 'Center Court', scheduleDate: '2026-07-24', date: '2026-07-24', time: '16:30', round: 'SF', status: 'scheduled', scheduleOrder: 1 }),
        officialMatch({ id: 'kitzbuhel-20260724-2', first: 'Yannick Hanfmann', second: 'Quentin Halys', court: 'Center Court', scheduleDate: '2026-07-24', date: '2026-07-24', time: '18:30', round: 'SF', status: 'scheduled', scheduleOrder: 2 }),
        officialMatch({ id: 'kitzbuhel-20260724-3', first: 'Alexander Bublik', second: 'Tomas Martin Etcheverry', court: 'Center Court', scheduleDate: '2026-07-24', date: '2026-07-24', time: '20:00', round: 'SF', status: 'scheduled', scheduleOrder: 3 }),
        officialMatch({ id: 'kitzbuhel-20260724-4', kind: 'MD', first: 'N.Sriram Balaji/Andre Goransson', second: 'Lucas Miedler/Marc Polmans', court: 'Center Court', scheduleDate: '2026-07-24', date: '2026-07-24', time: '', round: 'SF', status: 'scheduled', scheduleOrder: 4 })
      ]
    }
  ]
};

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

function matchKind(match = {}) {
  const type = String(match.type || '').toLowerCase();
  return `${type.includes('wta') || type.includes('women') ? 'W' : 'M'}${type.includes('doubles') ? 'D' : 'S'}`;
}

function orientation(match, official) {
  const first = match.first?.nameEn || match.first?.name || '';
  const second = match.second?.nameEn || match.second?.name || '';
  if (sameTeam(first, official.first.name) && sameTeam(second, official.second.name)) return 'direct';
  if (sameTeam(first, official.second.name) && sameTeam(second, official.first.name)) return 'reversed';
  return '';
}

function tournamentText(match = {}) {
  return normalized(`${match.tournament?.nameEn || ''} ${match.tournament?.name || ''}`);
}

function officialTournamentMatches(match, tournament) {
  if (String(match.tournament?.tour || '').toUpperCase() !== tournament.tour) return false;
  const source = tournamentText(match);
  const names = [tournament.city, tournament.name, ...(tournament.aliases || [])]
    .map(normalized)
    .filter(Boolean);
  return names.some(name => source.includes(name) || name.includes(source));
}

function pairingBelongsToTournament(match, tournament) {
  return (tournament.matches || []).some(official =>
    matchKind(match) === official.kind && Boolean(orientation(match, official)));
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
  if (String(result.MatchState || '').toUpperCase() === 'F' || String(oop.Status || '').toLowerCase() === 'completed') {
    return 'finished';
  }
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
      if (!/^L[SD]/.test(id)) return;
      // The WTA OOP can retain a postponed row on the old day. If the same
      // official MatchID appears on the following day, only the later official
      // day owns it.
      if (supersededIds.has(id)) return;
      const teams = asArray(item.Players);
      if (teams.length !== 2) return;
      const first = teamFromOop(teams[0]);
      const second = teamFromOop(teams[1]);
      if (!first.name || !second.name) return;
      const result = resultById.get(id) || {};
      const clock = beijingDateTime(date, item.NotBeforeISOTime);
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
        status: wtaStatus(result, item),
        statusText: wtaStatus(result, item) === 'finished' ? 'Finished' : '',
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

function officialRawMatch(official, tournament) {
  const canonicalKey = `${tournament.tour}:${tournament.id}:${tournament.year}`;
  return {
    id: `official:${tournament.tour.toLowerCase()}:${tournament.id}:${tournament.year}:${official.id}`,
    date: official.date || official.scheduleDate,
    time: official.time || '待定',
    status: official.status,
    statusText: official.statusText,
    type: `${tournament.tour === 'WTA' ? 'Wta' : 'Atp'} ${official.kind.endsWith('D') ? 'Doubles' : 'Singles'}`,
    round: official.round || '未标注',
    tournament: {
      id: tournament.id,
      name: tournament.city || tournament.name,
      nameEn: tournament.name,
      canonicalKey,
      country: '',
      logo: '',
      surface: tournament.surface,
      level: tournament.level,
      tour: tournament.tour,
      officialUrl: tournament.officialUrl,
      officialSource: tournament.source
    },
    court: official.court,
    first: {
      id: official.first.ids[0] || '',
      officialIds: official.first.ids,
      name: official.first.name,
      nameEn: official.first.name,
      country: official.first.countries[0] || '',
      rank: '', odds: '', seed: ''
    },
    second: {
      id: official.second.ids[0] || '',
      officialIds: official.second.ids,
      name: official.second.name,
      nameEn: official.second.name,
      country: official.second.countries[0] || '',
      rank: '', odds: '', seed: ''
    },
    winner: official.winner,
    serve: '',
    lastPoint: '',
    current: { first: '', second: '' },
    sets: official.sets,
    dayOffset: official.date && official.date !== official.scheduleDate ? 1 : 0,
    scheduleDate: official.scheduleDate,
    officialScheduleDate: official.scheduleDate,
    scheduleOrder: official.scheduleOrder,
    courtOrder: official.courtOrder,
    officialScheduleMatch: true,
    officialMatchId: official.id,
    rawUpdatedAt: Date.now()
  };
}

function overlayOfficial(match, official, tournament, direction) {
  const reversed = direction === 'reversed';
  const officialFirst = reversed ? official.second : official.first;
  const officialSecond = reversed ? official.first : official.second;
  const officialWinner = reversed
    ? official.winner === 'first' ? 'second' : official.winner === 'second' ? 'first' : ''
    : official.winner;
  const officialSets = reversed ? swapSets(official.sets) : official.sets;
  const result = {
    ...match,
    court: official.court || match.court,
    scheduleOrder: official.scheduleOrder,
    courtOrder: official.courtOrder,
    scheduleDate: official.scheduleDate,
    officialScheduleDate: official.scheduleDate,
    officialScheduleMatch: true,
    officialMatchId: official.id,
    first: {
      ...match.first,
      nameEn: officialFirst.name || match.first?.nameEn || match.first?.name
    },
    second: {
      ...match.second,
      nameEn: officialSecond.name || match.second?.nameEn || match.second?.name
    },
    tournament: {
      ...match.tournament,
      id: String(tournament.id),
      name: tournament.city || tournament.name,
      nameEn: tournament.name,
      canonicalKey: `${tournament.tour}:${tournament.id}:${tournament.year}`,
      tour: tournament.tour,
      surface: tournament.surface || match.tournament.surface,
      level: tournament.level || match.tournament.level,
      officialUrl: tournament.officialUrl,
      officialSource: tournament.source
    }
  };
  if (official.date && official.time) {
    result.date = official.date;
    result.time = official.time;
    result.dayOffset = official.date === official.scheduleDate ? 0 : 1;
  }
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

export function reconcileOfficialSchedule(matches = [], reference = null, date = '') {
  let remaining = [...matches];
  const output = [];
  for (const tournament of reference?.tours || []) {
    const candidates = remaining.filter(match =>
      officialTournamentMatches(match, tournament)
      || pairingBelongsToTournament(match, tournament));
    if (!candidates.length) {
      if (tournament.complete) {
        output.push(...(tournament.matches || []).map(official => officialRawMatch(official, tournament)));
      }
      continue;
    }
    const candidateSet = new Set(candidates);
    remaining = remaining.filter(match => !candidateSet.has(match));
    const used = new Set();
    for (const official of tournament.matches || []) {
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
    if (!tournament.complete) {
      candidates.forEach((match, index) => { if (!used.has(index)) output.push(match); });
    }
  }
  for (const match of remaining) {
    if (String(match.tournament?.tour || '').toUpperCase() === 'ATP') {
      const name = tournamentText(match);
      const meta = ATP_TOURNAMENTS.find(item => item.aliases.some(alias => name.includes(normalized(alias))));
      if (meta) {
        match.tournament = {
          ...match.tournament,
          nameEn: match.tournament.nameEn || meta.name,
          surface: meta.surface,
          level: match.tournament.level || meta.level,
          officialUrl: meta.officialUrl,
          officialSource: 'ATP official tournament page'
        };
      }
    }
    output.push(match);
  }
  return output.filter(match => !date || !match.officialScheduleDate || match.officialScheduleDate === date);
}

export class OfficialScheduleValidator {
  constructor({ cache, baseUrl = 'https://api.wtatennis.com/tennis', ttlMs = 5 * 60_000, fetchImpl = fetch }) {
    this.cache = cache;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.ttlMs = ttlMs;
    this.fetchImpl = fetchImpl;
  }

  saved(date) {
    return this.cache.data.officialReferences?.[date] || null;
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

  async refresh(date, now = Date.now(), force = false) {
    const saved = this.saved(date);
    if (!force && saved && now - saved.fetchedAt < this.ttlMs) return saved;
    try {
      let wtaTours = [];
      try {
        wtaTours = await this.fetchWta(date);
      } catch (error) {
        wtaTours = (saved?.tours || []).filter(tour => tour.tour === 'WTA');
        if (!wtaTours.length && !(ATP_VERIFIED_DAYS[date] || []).length) throw error;
        console.warn('[official-wta]', error.message);
      }
      const tours = [...(ATP_VERIFIED_DAYS[date] || []), ...wtaTours];
      const value = { date, fetchedAt: now, tours };
      this.cache.data.officialReferences ||= {};
      this.cache.data.officialReferences[date] = value;
      Object.keys(this.cache.data.officialReferences).sort().slice(0, -5)
        .forEach(oldDate => delete this.cache.data.officialReferences[oldDate]);
      this.cache.scheduleWrite();
      return value;
    } catch (error) {
      if (saved) return saved;
      throw error;
    }
  }

  reconcile(matches, date) {
    return reconcileOfficialSchedule(matches, this.saved(date), date);
  }
}
