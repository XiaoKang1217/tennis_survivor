import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OfficialScheduleValidator,
  parseWtaOfficialTournament,
  reconcileOfficialSchedule
} from '../src/official-validator.mjs';
import { normalizeMatch } from '../src/normalizer.mjs';

function apiMatch(id, first, second, type = 'Atp Singles') {
  return normalizeMatch({
    event_key: id,
    event_date: '2026-07-22',
    event_time: '19:00',
    event_type_type: type,
    tournament_key: 1267,
    tournament_name: 'ATP Estoril',
    event_first_player: first,
    event_second_player: second
  });
}

test('parses a WTA official OOP and result into Beijing display time', () => {
  const tournament = {
    year: 2026,
    city: 'Hamburg',
    surface: 'Clay',
    level: 'WTA 250',
    tournamentGroup: { id: 2042, name: 'Hamburg' }
  };
  const oop = {
    orderOfPlay: [JSON.stringify({
      OOP: {
        Schedule: {
          Day: {
            ISODate: '2026-07-22',
            Court: {
              CourtName: 'M1',
              Matches: {
                Match: {
                  MatchId: 'LS010',
                  seq: 1,
                  NotBeforeISOTime: '19:30:00+0200',
                  Status: 'Completed',
                  Players: [
                    { Player: { id: '1', FirstName: 'Anna', SurName: 'Bondar', Country: 'HUN' } },
                    { Player: { id: '2', FirstName: 'Noma', SurName: 'Noha Akugue', Country: 'GER' } }
                  ]
                }
              }
            }
          }
        }
      }
    })]
  };
  const results = {
    matches: [{
      MatchID: 'LS010',
      MatchState: 'F',
      Winner: '2',
      ScoreSet1A: 6,
      ScoreSet1B: 1,
      ScoreSet2A: 3,
      ScoreSet2B: 6,
      ScoreSet3A: 7,
      ScoreSet3B: 5
    }]
  };
  const parsed = parseWtaOfficialTournament({ tournament, oop, results, date: '2026-07-22' });
  assert.equal(parsed.complete, true);
  assert.equal(parsed.surface, '红土');
  assert.equal(parsed.matches.length, 1);
  assert.deepEqual(parsed.matches[0], {
    id: 'LS010',
    kind: 'WS',
    first: { name: 'Anna Bondar', ids: ['1'], countries: ['HUN'] },
    second: { name: 'Noma Noha Akugue', ids: ['2'], countries: ['GER'] },
    court: 'M1',
    courtOrder: 0,
    scheduleOrder: 1,
    scheduleDate: '2026-07-22',
    date: '2026-07-23',
    time: '01:30',
    status: 'finished',
    statusText: 'Finished',
    winner: 'first',
    sets: [
      { set: '1', first: '6', second: '1' },
      { set: '2', first: '3', second: '6' },
      { set: '3', first: '7', second: '5' }
    ]
  });
});

test('expands the WTA deciding doubles tiebreak from 1-0 to its real points', () => {
  const parsed = parseWtaOfficialTournament({
    tournament: {
      year: 2026,
      city: 'Prague',
      surface: 'Hard',
      level: 'WTA 250',
      tournamentGroup: { id: 1082, name: 'Prague' }
    },
    oop: {
      orderOfPlay: [JSON.stringify({
        OOP: {
          Schedule: {
            Day: {
              ISODate: '2026-07-22',
              Court: {
                CourtName: 'Court 1',
                Matches: {
                  Match: {
                    MatchId: 'LD013',
                    Players: [
                      { Player: [{ FirstName: 'A', SurName: 'One' }, { FirstName: 'A', SurName: 'Two' }] },
                      { Player: [{ FirstName: 'B', SurName: 'One' }, { FirstName: 'B', SurName: 'Two' }] }
                    ]
                  }
                }
              }
            }
          }
        }
      })]
    },
    results: {
      matches: [{
        MatchID: 'LD013',
        MatchState: 'F',
        Winner: '3',
        ScoreSet1A: '6', ScoreSet1B: '3',
        ScoreSet2A: '3', ScoreSet2B: '6',
        ScoreSet3A: '0', ScoreSet3B: '1',
        ScoreTbSet3: '7'
      }]
    },
    date: '2026-07-22'
  });
  assert.deepEqual(parsed.matches[0].sets[2], { set: '3', first: '7', second: '10' });
});

test('a complete official WTA sheet replaces stale status and removes unmatched API rows', () => {
  const official = {
    date: '2026-07-22',
    tours: [{
      tour: 'WTA',
      id: '2042',
      year: 2026,
      name: 'Hamburg',
      city: 'Hamburg',
      aliases: ['Hamburg'],
      surface: '红土',
      level: 'WTA 250',
      officialUrl: 'https://www.wtatennis.com/scores?date=2026-07-22&status=All',
      source: 'WTA official',
      complete: true,
      matches: [{
        id: 'LS010',
        kind: 'WS',
        first: { name: 'Anna Bondar', ids: [], countries: [] },
        second: { name: 'Noma Noha Akugue', ids: [], countries: [] },
        court: 'M1',
        courtOrder: 0,
        scheduleOrder: 1,
        scheduleDate: '2026-07-22',
        date: '2026-07-22',
        time: '17:00',
        status: 'finished',
        statusText: 'Finished',
        winner: 'first',
        sets: [{ set: '1', first: '6', second: '1' }]
      }]
    }]
  };
  const valid = normalizeMatch({
    event_key: 1,
    event_date: '2026-07-22',
    event_time: '17:00',
    event_status: 'Set 1',
    event_live: '1',
    event_type_type: 'Wta Singles',
    tournament_name: 'WTA Hamburg',
    event_first_player: 'A. Bondar',
    event_second_player: 'N. Noha Akugue'
  });
  const dirty = normalizeMatch({
    event_key: 2,
    event_date: '2026-07-22',
    event_time: '19:10',
    event_type_type: 'Wta Singles',
    tournament_name: 'WTA Hamburg',
    event_first_player: 'T. Brockmann',
    event_second_player: 'E. Jacquemot'
  });
  const reconciled = reconcileOfficialSchedule([valid, dirty], official, '2026-07-22');
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].id, '1');
  assert.equal(reconciled[0].status, 'finished');
  assert.equal(reconciled[0].court, 'M1');
  assert.equal(reconciled[0].tournament.surface, '红土');
  assert.deepEqual(reconciled[0].current, { first: '', second: '' });
});

test('a complete official sheet supplies a tournament missing from the provider fixtures', () => {
  const official = {
    tours: [{
      tour: 'WTA',
      id: '2042',
      year: 2026,
      name: 'MSC Hamburg Ladies Open',
      city: 'HAMBURG',
      aliases: ['Hamburg'],
      surface: '红土',
      level: 'WTA 250',
      officialUrl: 'https://www.wtatennis.com/scores?date=2026-07-22&status=All',
      source: 'WTA official',
      complete: true,
      matches: [{
        id: 'LS010',
        kind: 'WS',
        first: { name: 'Anna Bondar', ids: ['310760'], countries: ['HUN'] },
        second: { name: 'Noma Noha Akugue', ids: ['329064'], countries: ['GER'] },
        court: 'Center Court',
        scheduleOrder: 1,
        courtOrder: 0,
        scheduleDate: '2026-07-22',
        date: '2026-07-22',
        time: '23:00',
        status: 'finished',
        statusText: 'Finished',
        winner: 'first',
        sets: [{ set: '1', first: '6', second: '1' }]
      }]
    }]
  };
  const [match] = reconcileOfficialSchedule([], official, '2026-07-22');
  assert.equal(match.tournament.nameEn, 'MSC Hamburg Ladies Open');
  assert.equal(match.first.nameEn, 'Anna Bondar');
  assert.equal(match.status, 'finished');
});

test('official pairing canonicalizes a provider-mislabeled Hamburg row and never groups it as Palermo', () => {
  const official = {
    tours: [{
      tour: 'WTA',
      id: '2042',
      year: 2026,
      name: 'MSC Hamburg Ladies Open',
      city: 'Hamburg',
      aliases: ['Hamburg'],
      surface: '红土',
      level: 'WTA 125',
      officialUrl: 'https://www.wtatennis.com/scores?date=2026-07-23&status=All',
      source: 'WTA official',
      complete: true,
      matches: [{
        id: 'LS020',
        kind: 'WS',
        first: { name: 'Mayar Sherif', ids: [], countries: [] },
        second: { name: 'Elsa Jacquemot', ids: [], countries: [] },
        court: 'Center Court',
        courtOrder: 0,
        scheduleOrder: 1,
        scheduleDate: '2026-07-23',
        date: '2026-07-23',
        time: '17:00',
        status: 'finished',
        statusText: 'Finished',
        winner: 'first',
        sets: [{ set: '1', first: '6', second: '3' }]
      }]
    }]
  };
  const dirty = normalizeMatch({
    event_key: 77,
    event_date: '2026-07-23',
    event_time: '17:00',
    event_type_type: 'Wta Singles',
    tournament_name: 'WTA125 Palermo',
    event_first_player: 'M. Sherif',
    event_second_player: 'E. Jacquemot'
  });
  const [match] = reconcileOfficialSchedule([dirty], official, '2026-07-23');
  assert.equal(match.id, '77');
  assert.equal(match.tournament.id, '2042');
  assert.equal(match.tournament.name, 'Hamburg');
  assert.equal(match.tournament.nameEn, 'MSC Hamburg Ladies Open');
  assert.equal(match.tournament.canonicalKey, 'WTA:2042:2026');
});

test('a postponed WTA MatchID is removed from the old official day', () => {
  const match = {
    MatchId: 'LD011',
    Players: [
      { Player: [{ FirstName: 'A', SurName: 'One' }, { FirstName: 'A', SurName: 'Two' }] },
      { Player: [{ FirstName: 'B', SurName: 'One' }, { FirstName: 'B', SurName: 'Two' }] }
    ]
  };
  const oop = {
    orderOfPlay: [JSON.stringify({
      OOP: {
        Schedule: {
          Day: [
            { ISODate: '2026-07-22', Court: { CourtName: 'M1', Matches: { Match: match } } },
            { ISODate: '2026-07-23', Court: { CourtName: 'M2', Matches: { Match: match } } }
          ]
        }
      }
    })]
  };
  const tournament = {
    year: 2026,
    city: 'Hamburg',
    surface: 'Clay',
    level: 'WTA 125',
    tournamentGroup: { id: 2042, name: 'Hamburg' }
  };
  const oldDay = parseWtaOfficialTournament({
    tournament,
    oop,
    results: { matches: [] },
    date: '2026-07-22',
    supersededIds: new Set(['LD011'])
  });
  const newDay = parseWtaOfficialTournament({
    tournament,
    oop,
    results: { matches: [] },
    date: '2026-07-23'
  });
  assert.equal(oldDay.matches.length, 0);
  assert.equal(newDay.matches.length, 1);
  assert.equal(newDay.matches[0].court, 'M2');
  assert.equal(newDay.matches[0].scheduleDate, '2026-07-23');
});

test('WTA 125 tournaments are included in official schedule refresh', async () => {
  const calendar = {
    content: [{
      year: 2026,
      city: 'Hamburg',
      level: 'WTA 125',
      surface: 'Clay',
      tournamentGroup: { id: 2042, name: 'Hamburg', level: 'WTA 125' }
    }]
  };
  const oop = {
    orderOfPlay: [JSON.stringify({
      OOP: {
        Schedule: {
          Day: {
            ISODate: '2026-07-23',
            Court: {
              CourtName: 'Center Court',
              Matches: {
                Match: {
                  MatchId: 'LS020',
                  Players: [
                    { Player: { FirstName: 'Mayar', SurName: 'Sherif' } },
                    { Player: { FirstName: 'Elsa', SurName: 'Jacquemot' } }
                  ]
                }
              }
            }
          }
        }
      }
    })]
  };
  const validator = new OfficialScheduleValidator({
    cache: { data: { officialReferences: {} }, scheduleWrite() {} },
    fetchImpl: async url => ({
      ok: true,
      json: async () => url.includes('/tournaments/?')
        ? calendar
        : url.endsWith('/oop')
          ? oop
          : { matches: [] }
    })
  });
  const value = await validator.refresh('2026-07-23', 1, true);
  const wta = value.tours.filter(tour => tour.tour === 'WTA');
  assert.equal(wta.length, 1);
  assert.equal(wta[0].level, 'WTA 125');
  assert.equal(wta[0].matches[0].court, 'Center Court');
});

test('the verified ATP 2026-07-23 sheets contain every official tour match and court', async () => {
  const cache = { data: { officialReferences: {} }, scheduleWrite() {} };
  const validator = new OfficialScheduleValidator({
    cache,
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [] }) })
  });
  const value = await validator.refresh('2026-07-23', 1, true);
  const atp = value.tours.filter(tour => tour.tour === 'ATP');
  assert.equal(atp.length, 2);
  assert.deepEqual(atp.map(tour => [tour.city, tour.matches.length]), [
    ['Estoril', 7],
    ['Kitzbühel', 6]
  ]);
  assert.deepEqual(
    [...new Set(atp.find(tour => tour.city === 'Estoril').matches.map(match => match.court))],
    ['ESTADIO MILLENNIUM', 'COURT CASCAIS', 'COURT CTE']
  );
  assert.deepEqual(
    [...new Set(atp.find(tour => tour.city === 'Kitzbühel').matches.map(match => match.court))],
    ['Center Court', 'Grandstand']
  );
  const kitzbuhel = atp.find(tour => tour.city === 'Kitzbühel');
  assert.deepEqual(
    kitzbuhel.matches.slice(0, 3).map(match => [match.first.name, match.second.name, match.status, match.winner]),
    [
      ['Quentin Halys', 'Mariano Navone', 'finished', 'first'],
      ['Yannick Hanfmann', 'Sebastian Baez', 'finished', 'first'],
      ['Tomas Martin Etcheverry', 'Ignacio Buse', 'finished', 'first']
    ]
  );
  assert.equal(kitzbuhel.matches[4].status, 'finished');
});

test('the verified ATP 2026-07-24 OOP sheets supply clay surface and every main-tour court', async () => {
  const cache = { data: { officialReferences: {} }, scheduleWrite() {} };
  const validator = new OfficialScheduleValidator({
    cache,
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [] }) })
  });
  const value = await validator.refresh('2026-07-24', 1, true);
  const atp = value.tours.filter(tour => tour.tour === 'ATP');
  assert.deepEqual(atp.map(tour => [tour.city, tour.matches.length, tour.surface]), [
    ['Estoril', 6, '红土'],
    ['Kitzbühel', 4, '红土']
  ]);

  const estoril = atp.find(tour => tour.city === 'Estoril');
  assert.deepEqual([...new Set(estoril.matches.map(match => match.court))], [
    'ESTADIO MILLENNIUM',
    'COURT CASCAIS'
  ]);
  assert.deepEqual(
    estoril.matches.map(match => [match.first.name, match.second.name, match.court, match.time]),
    [
      ['Tiago Torres', 'Hugo Gaston', 'ESTADIO MILLENNIUM', '18:00'],
      ['Andrey Rublev', 'Luca Van Assche', 'ESTADIO MILLENNIUM', ''],
      ['Roman Andres Burruchaga', 'Alexander Blockx', 'ESTADIO MILLENNIUM', '23:00'],
      ['Jaime Faria', 'Luciano Darderi', 'ESTADIO MILLENNIUM', ''],
      ['Vasil Kirkov/Bart Stevens', 'Nuno Borges/Francisco Cabral', 'COURT CASCAIS', '20:00'],
      ['Sander Arends/David Pel', 'Orlando Luz/Rafael Matos', 'COURT CASCAIS', '']
    ]
  );

  const kitzbuhel = atp.find(tour => tour.city === 'Kitzbühel');
  assert.equal(kitzbuhel.matches.every(match => match.court === 'Center Court'), true);
  assert.equal(kitzbuhel.matches.some(match => /Choi|Lorincik|Calin|Drijver/.test(
    `${match.first.name} ${match.second.name}`
  )), false);
  assert.deepEqual(kitzbuhel.matches.map(match => match.time), ['16:30', '18:30', '20:00', '']);
  assert.match(kitzbuhel.officialUrl, /protennislive\.com\/posting\/2026\/319\/op\.pdf/);
});

test('the ATP 2026-07-24 OOP replaces an unmarked API court without changing live state', async () => {
  const cache = { data: { officialReferences: {} }, scheduleWrite() {} };
  const validator = new OfficialScheduleValidator({
    cache,
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [] }) })
  });
  await validator.refresh('2026-07-24', 1, true);
  const live = normalizeMatch({
    event_key: 24,
    event_date: '2026-07-24',
    event_time: '18:30',
    event_status: 'Set 1',
    event_live: '1',
    event_type_type: 'Atp Singles',
    tournament_name: 'ATP Kitzbuhel',
    event_first_player: 'Yannick Hanfmann',
    event_second_player: 'Quentin Halys'
  });
  const reconciled = validator.reconcile([live], '2026-07-24');
  const match = reconciled.find(item => item.id === '24');
  assert.equal(match.status, 'live');
  assert.equal(match.court, 'Center Court');
  assert.equal(match.time, '18:30');
  assert.equal(match.tournament.surface, '红土');
  assert.equal(match.officialScheduleMatch, true);
});

test('the verified ATP 2026-07-22 sheet removes the dirty ninth Estoril row per pairing', async () => {
  const cache = { data: { officialReferences: {} }, scheduleWrite() {} };
  const validator = new OfficialScheduleValidator({
    cache,
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [] }) })
  });
  await validator.refresh('2026-07-22', 1, true);
  const matches = [
    apiMatch(1, 'Hugo Gaston', 'Titouan Droguet'),
    apiMatch(2, 'Roman Andres Burruchaga', 'Nuno Borges'),
    apiMatch(3, 'Tiago Torres', 'Alejandro Tabilo'),
    apiMatch(4, 'Alexander Blockx', 'Kyrian Jacquet'),
    apiMatch(5, 'Orlando Luz/Rafael Matos', 'Ray Ho/Benjamin Kittay', 'Atp Doubles'),
    apiMatch(6, 'Nuno Borges/Francisco Cabral', 'Arthur Reymond/Luca Sanchez', 'Atp Doubles'),
    apiMatch(7, 'Joao Domingues/Tiago Torres', 'Jaime Faria/Henrique Rocha', 'Atp Doubles'),
    apiMatch(8, 'Vasil Kirkov/Bart Stevens', 'Marcelo Demoliner/Robert Galloway', 'Atp Doubles'),
    apiMatch(9, 'Roman Andres Burruchaga/Camilo Ugo Carabelli', 'Jaime Faria/Henrique Rocha', 'Atp Doubles')
  ];
  const reconciled = validator.reconcile(matches, '2026-07-22');
  const estoril = reconciled.filter(match => match.tournament.nameEn.includes('Estoril'));
  assert.equal(estoril.length, 8);
  assert.equal(estoril.some(match => match.id === '9'), false);
  assert.equal(estoril.every(match => match.status === 'finished'), true);
  assert.equal(estoril.find(match => match.id === '5').first.nameEn, 'Orlando Luz/Rafael Matos');
  assert.equal(estoril.find(match => match.id === '5').second.nameEn, 'Ray Ho/Benjamin Kittay');
  const tabilo = estoril.find(match => match.id === '3');
  assert.equal(tabilo.winner, 'second');
  assert.deepEqual(tabilo.sets.map(set => [set.first, set.second]), [['4', '6'], ['4', '6']]);
  assert.deepEqual([...new Set(estoril.map(match => match.court))].sort(), [
    'COURT CASCAIS',
    'COURT CTE',
    'ESTADIO MILLENNIUM'
  ]);
});

test('ATP metadata never changes an unverified day pairing or status', () => {
  const match = apiMatch(1, 'A', 'B');
  const [reconciled] = reconcileOfficialSchedule([match], { tours: [] }, '2026-07-23');
  assert.equal(reconciled.id, '1');
  assert.equal(reconciled.first.name, 'A');
  assert.equal(reconciled.second.name, 'B');
  assert.equal(reconciled.status, 'scheduled');
  assert.equal(reconciled.tournament.surface, '红土');
  assert.match(reconciled.tournament.officialUrl, /atptour\.com/);
});
