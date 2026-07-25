import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  OfficialScheduleValidator,
  parseWtaOfficialTournament,
  reconcileOfficialSchedule
} from '../src/official-validator.mjs';
import { parseAtpOopLayout } from '../src/atp-oop-pdf.mjs';
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
  assert.equal(match.tournament.name, 'MSC Hamburg Ladies Open');
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
    atpRegistry: [],
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

function atpLayout() {
  return [
    { x: 50, y: 824, text: 'GENERALI OPEN' },
    { x: 50, y: 804, text: 'Kitzbühel, Austria' },
    { x: 50, y: 790, text: 'ATP 250 | Clay | Outdoor' },
    { x: 50, y: 770, text: 'ORDER OF PLAY - FRIDAY, JULY 24, 2026' },
    { x: 50, y: 742, text: 'CENTER COURT' },
    { x: 50, y: 710, text: 'Starts At 10:30' },
    { x: 50, y: 680, text: 'Yannick Hanfmann (GER)' },
    { x: 50, y: 660, text: 'vs.' },
    { x: 50, y: 640, text: 'Qualifier or Quentin Halys (FRA)' },
    { x: 50, y: 600, text: 'Followed By' },
    { x: 50, y: 570, text: 'Vasil Kirkov (USA)' },
    { x: 50, y: 558, text: 'Bart Stevens (NED)' },
    { x: 50, y: 540, text: 'vs.' },
    { x: 50, y: 522, text: 'Nuno Borges (POR)' },
    { x: 50, y: 510, text: 'Francisco Cabral (POR)' }
  ];
}

function parsedAtp(sha256 = 'first-sha') {
  return parseAtpOopLayout(atpLayout(), {
    atpId: '319',
    name: 'Generali Open',
    city: 'Kitzbühel',
    country: 'Austria',
    timeZone: 'Europe/Vienna'
  }, sha256);
}

function atpRegistry() {
  return [{
    atpId: '319',
    year: 2026,
    name: 'Generali Open',
    city: 'Kitzbühel',
    country: 'Austria',
    level: 'ATP 250',
    surface: '红土',
    timeZone: 'Europe/Vienna',
    startDate: '2026-07-20',
    endDate: '2026-07-25',
    aliases: ['kitzbuhel', 'generali open'],
    officialUrl: 'https://www.atptour.com/en/tournaments/kitzbuhel/319/overview'
  }];
}

function validatorFetch({ pdfOk = true } = {}) {
  return async url => {
    if (url.startsWith('https://api.wtatennis.com/')) {
      return { ok: true, json: async () => ({ content: [] }) };
    }
    return {
      ok: pdfOk,
      status: pdfOk ? 200 : 404,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    };
  };
}

test('parses ATP OOP layout into official date, city, surface, order, court and Beijing time', () => {
  const parsed = parsedAtp();
  assert.equal(parsed.date, '2026-07-24');
  assert.equal(parsed.city, 'Kitzbühel');
  assert.equal(parsed.country, 'Austria');
  assert.equal(parsed.surface, '红土');
  assert.equal(parsed.matches.length, 2);
  assert.deepEqual(
    parsed.matches.map(match => [match.kind, match.court, match.time]),
    [['MS', 'Center Court', '16:30'], ['MD', 'Center Court', '']]
  );
  assert.deepEqual(parsed.matches[0].second.alternatives, ['Qualifier', 'Quentin Halys']);
});

test('parses compact ATP feeder alternatives as singles instead of a doubles team', () => {
  const layout = atpLayout()
    .filter(line => line.y >= 640)
    .map(line => {
      if (line.text === 'Yannick Hanfmann (GER)') {
        return { ...line, text: 'Roman Andres Burruchaga (ARG)or/Alexander Blockx (BEL)' };
      }
      if (line.text === 'Qualifier or Quentin Halys (FRA)') {
        return { ...line, text: 'Jaime Faria (POR)or/Luciano Darderi (ITA)' };
      }
      return line;
    });
  layout.push({ x: 50, y: 700, text: 'SINGLES FINAL' });
  const parsed = parseAtpOopLayout(layout, {
    atpId: '7290',
    name: 'Millennium Estoril Open',
    city: 'Estoril',
    country: 'Portugal',
    timeZone: 'Europe/Lisbon'
  });
  assert.equal(parsed.matches.length, 1);
  assert.equal(parsed.matches[0].kind, 'MS');
  assert.equal(parsed.matches[0].round, 'SINGLES FINAL');
  assert.deepEqual(parsed.matches[0].first.alternatives, [
    'Roman Andres Burruchaga',
    'Alexander Blockx'
  ]);
  assert.deepEqual(parsed.matches[0].second.alternatives, [
    'Jaime Faria',
    'Luciano Darderi'
  ]);
});

test('filters a labeled ATP junior side event without dropping adjacent tour finals', () => {
  const layout = [
    { x: 50, y: 824, text: 'GENERALI OPEN' },
    { x: 50, y: 804, text: 'Kitzbühel, Austria' },
    { x: 50, y: 790, text: 'ATP 250 | Clay | Outdoor' },
    { x: 50, y: 770, text: 'ORDER OF PLAY - SATURDAY, JULY 25, 2026' },
    { x: 50, y: 742, text: 'CENTER COURT' },
    { x: 50, y: 730, text: 'Starts At 10:30' },
    { x: 50, y: 718, text: 'DOUBLES FINAL' },
    { x: 50, y: 700, text: 'Jakob Schnaitter (GER)' },
    { x: 50, y: 688, text: 'Mark Wallner (GER)' },
    { x: 50, y: 670, text: 'vs.' },
    { x: 50, y: 652, text: 'Lucas Miedler (AUT)' },
    { x: 50, y: 640, text: 'Marc Polmans (AUS)' },
    { x: 50, y: 612, text: 'Followed By' },
    { x: 50, y: 600, text: 'KITZ RISING FINAL' },
    { x: 50, y: 580, text: 'Rafael Pagonis (GRE)' },
    { x: 50, y: 560, text: 'vs.' },
    { x: 50, y: 540, text: 'Mohamed Genidy (EGY)' },
    { x: 50, y: 512, text: 'Not Before 13:00' },
    { x: 50, y: 500, text: 'SINGLES FINAL' },
    { x: 50, y: 480, text: 'Alexander Bublik (KAZ)' },
    { x: 50, y: 460, text: 'vs.' },
    { x: 50, y: 440, text: 'Quentin Halys (FRA)' }
  ];
  const parsed = parseAtpOopLayout(layout, {
    atpId: '319',
    name: 'Generali Open',
    city: 'Kitzbühel',
    country: 'Austria',
    timeZone: 'Europe/Vienna'
  });
  assert.deepEqual(
    parsed.matches.map(match => [match.kind, match.first.name, match.second.name]),
    [
      ['MD', 'Jakob Schnaitter/Mark Wallner', 'Lucas Miedler/Marc Polmans'],
      ['MS', 'Alexander Bublik', 'Quentin Halys']
    ]
  );
  assert.equal(parsed.matches.some(match => /Pagonis|Genidy/.test(match.first.name)), false);
});

test('keeps ATP OOP page coordinates isolated in a multi-page PDF', () => {
  const firstPage = atpLayout().map(line => ({ ...line, page: 0 }));
  const secondPage = atpLayout().map(line => ({
    ...line,
    page: 1,
    text: line.text
      .replace('Yannick Hanfmann', 'Alexander Bublik')
      .replace('Qualifier or Quentin Halys', 'Tomas Martin Etcheverry')
      .replace('Vasil Kirkov', 'Lucas Miedler')
      .replace('Bart Stevens', 'Marc Polmans')
      .replace('Nuno Borges', 'Sriram Balaji')
      .replace('Francisco Cabral', 'Andre Goransson')
  }));
  const parsed = parseAtpOopLayout([...firstPage, ...secondPage], {
    atpId: '319',
    name: 'Generali Open',
    city: 'Kitzbühel',
    country: 'Austria',
    timeZone: 'Europe/Vienna'
  });
  assert.equal(parsed.matches.length, 4);
  assert.deepEqual(
    parsed.matches.map(match => match.first.name),
    ['Yannick Hanfmann', 'Vasil Kirkov/Bart Stevens', 'Alexander Bublik', 'Lucas Miedler/Marc Polmans']
  );
  assert.deepEqual(parsed.matches.map(match => match.scheduleOrder), [0, 1, 10_000, 10_001]);
});

test('finished feeder matches resolve ATP OOP alternatives before fixtures publishes the final', () => {
  const tournament = {
    tour: 'ATP',
    id: '7290',
    year: 2026,
    name: 'Millennium Estoril Open',
    city: 'Estoril',
    country: 'Portugal',
    aliases: ['Estoril'],
    surface: '红土',
    level: 'ATP 250',
    source: 'ATP official OOP PDF',
    complete: true,
    matches: [{
      id: 'atp-final',
      kind: 'MS',
      first: {
        name: 'Roman Andres Burruchaga',
        alternatives: ['Roman Andres Burruchaga', 'Alexander Blockx'],
        ids: [],
        countries: []
      },
      second: {
        name: 'Jaime Faria',
        alternatives: ['Jaime Faria', 'Luciano Darderi'],
        ids: [],
        countries: []
      },
      court: 'Estadio Millennium',
      scheduleDate: '2026-07-25',
      date: '2026-07-26',
      time: '00:30',
      status: 'scheduled',
      winner: '',
      sets: []
    }]
  };
  const finished = [
    normalizeMatch({
      event_key: 91,
      event_date: '2026-07-24',
      event_time: '18:00',
      event_status: 'Finished',
      event_winner: 'Second Player',
      event_final_result: '0 - 2',
      event_type_type: 'Atp Singles',
      tournament_name: 'ATP Estoril',
      event_first_player: 'Roman Andres Burruchaga',
      event_second_player: 'Alexander Blockx',
      event_first_player_result: '0',
      event_second_player_result: '2'
    }),
    normalizeMatch({
      event_key: 92,
      event_date: '2026-07-24',
      event_time: '20:00',
      event_status: 'Finished',
      event_winner: 'Second Player',
      event_final_result: '0 - 2',
      event_type_type: 'Atp Singles',
      tournament_name: 'ATP Estoril',
      event_first_player: 'Jaime Faria',
      event_second_player: 'Luciano Darderi',
      event_first_player_result: '0',
      event_second_player_result: '2'
    })
  ];
  const [resolved] = reconcileOfficialSchedule(
    [],
    { date: '2026-07-25', tours: [tournament] },
    '2026-07-25',
    finished
  );
  assert.equal(resolved.first.nameEn, 'Alexander Blockx');
  assert.equal(resolved.second.nameEn, 'Luciano Darderi');
  assert.equal(resolved.type, 'Atp Singles');
  assert.equal(resolved.provisional, false);
});

test('an unresolved ATP feeder choice is displayed once per candidate', () => {
  const [match] = reconcileOfficialSchedule([], {
    tours: [{
      tour: 'ATP',
      id: '7290',
      year: 2026,
      name: 'Millennium Estoril Open',
      city: 'Estoril',
      country: 'Portugal',
      aliases: ['Estoril'],
      surface: '红土',
      level: 'ATP 250',
      complete: true,
      matches: [{
        id: 'atp-final',
        kind: 'MS',
        first: {
          name: 'Roman Andres Burruchaga',
          alternatives: ['Roman Andres Burruchaga', 'Alexander Blockx']
        },
        second: {
          name: 'Jaime Faria',
          alternatives: ['Jaime Faria', 'Luciano Darderi']
        },
        scheduleDate: '2026-07-25',
        date: '2026-07-26',
        time: '00:30',
        status: 'scheduled'
      }]
    }]
  }, '2026-07-25');
  assert.equal(match.first.nameEn, 'Roman Andres Burruchaga or Alexander Blockx');
  assert.equal(match.second.nameEn, 'Jaime Faria or Luciano Darderi');
  assert.equal(match.provisional, true);
});

test('ATP validator stores versioned parsed snapshots by main-draw ID and official day', async () => {
  const cache = {
    data: { officialReferences: {}, atpOopSnapshots: {} },
    scheduleWrite() {}
  };
  let revision = 0;
  const validator = new OfficialScheduleValidator({
    cache,
    atpRegistry: atpRegistry(),
    fetchImpl: validatorFetch(),
    parseAtpPdf: () => parsedAtp(`sha-${revision += 1}`)
  });
  const candidates = [normalizeMatch({
    event_key: 24,
    event_date: '2026-07-24',
    event_time: '16:30',
    event_status: 'Scheduled',
    event_type_type: 'Atp Singles',
    tournament_name: 'ATP Kitzbuhel',
    event_first_player: 'Yannick Hanfmann',
    event_second_player: 'Quentin Halys'
  })];
  await validator.refresh('2026-07-24', 1, true, candidates);
  await validator.refresh('2026-07-24', 2, true, candidates);
  const saved = cache.data.atpOopSnapshots['319:2026-07-24'];
  assert.equal(saved.current.atpId, '319');
  assert.equal(saved.revisions.length, 2);
  assert.match(saved.current.sourceUrl, /\/2026\/319\/op\.pdf$/);
});

test('ATP OOP is authoritative per pairing and court without changing provider live state', async () => {
  const cache = {
    data: { officialReferences: {}, atpOopSnapshots: {} },
    scheduleWrite() {}
  };
  const validator = new OfficialScheduleValidator({
    cache,
    atpRegistry: atpRegistry(),
    fetchImpl: validatorFetch(),
    parseAtpPdf: () => parsedAtp()
  });
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
  const dirty = normalizeMatch({
    event_key: 25,
    event_date: '2026-07-24',
    event_time: '18:30',
    event_status: 'Scheduled',
    event_type_type: 'Atp Singles',
    tournament_name: 'ATP Kitzbuhel',
    event_first_player: 'Wrong Player',
    event_second_player: 'Wrong Opponent'
  });
  await validator.refresh('2026-07-24', 1, true, [live, dirty]);
  const reconciled = validator.reconcile([live, dirty], '2026-07-24');
  const match = reconciled.find(item => item.id === '24');
  assert.equal(reconciled.length, 2);
  assert.equal(reconciled.some(item => item.id === '25'), false);
  assert.equal(match.status, 'live');
  assert.equal(match.court, 'Center Court');
  assert.equal(match.time, '16:30');
  assert.equal(match.tournament.level, 'ATP 250');
  assert.equal(match.tournament.country, 'Austria');
  assert.equal(match.tournament.city, 'Kitzbühel');
  assert.equal(match.second.nameEn, 'Quentin Halys');
});

test('an unpublished ATP OOP retains fixtures candidates and retries from a metadata-only reference', async () => {
  const cache = {
    data: { officialReferences: {}, atpOopSnapshots: {} },
    scheduleWrite() {}
  };
  const validator = new OfficialScheduleValidator({
    cache,
    atpRegistry: atpRegistry(),
    fetchImpl: validatorFetch({ pdfOk: false })
  });
  const candidate = normalizeMatch({
    event_key: 24,
    event_date: '2026-07-24',
    event_time: '18:30',
    event_status: 'Scheduled',
    event_type_type: 'Atp Singles',
    tournament_name: 'ATP Kitzbuhel',
    event_first_player: 'Yannick Hanfmann',
    event_second_player: 'Quentin Halys'
  });
  await validator.refresh('2026-07-24', 1, true, [candidate]);
  const [kept] = validator.reconcile([candidate], '2026-07-24');
  assert.equal(kept.id, '24');
  assert.equal(kept.tournament.level, 'ATP 250');
  assert.equal(kept.officialScheduleMatch, false);
  assert.equal(cache.data.atpOopSnapshots['319:2026-07-24'], undefined);
});

test('ATP metadata never changes an unverified day pairing or status', () => {
  const match = apiMatch(1, 'A', 'B');
  const [reconciled] = reconcileOfficialSchedule([match], { tours: [] }, '2026-07-23');
  assert.equal(reconciled.id, '1');
  assert.equal(reconciled.first.name, 'A');
  assert.equal(reconciled.second.name, 'B');
  assert.equal(reconciled.status, 'scheduled');
  assert.equal(reconciled.tournament.surface, '未标注');
  assert.equal(reconciled.tournament.officialUrl, undefined);
});

test('checked-in ATP calendar uses one unique main-draw ID and complete official metadata per event', () => {
  const registry = JSON.parse(fs.readFileSync(
    new URL('../data/atp-tournaments-2026.json', import.meta.url),
    'utf8'
  ));
  assert.equal(new Set(registry.map(item => item.atpId)).size, registry.length);
  assert.equal(registry.some(item => item.atpId === '7481' || item.atpId === '4714'), false);
  assert.equal(registry.some(item => item.atpId === '7480'), true);
  assert.equal(registry.some(item => item.atpId === '4713'), true);
  registry.forEach(item => {
    assert.match(item.atpId, /^\d+$/);
    assert.equal(item.year, 2026);
    assert.equal(item.startDate <= item.endDate, true);
    assert.equal(Boolean(item.name && item.city && item.country && item.level), true);
    assert.equal(Boolean(item.surface && item.timeZone && item.officialUrl), true);
    assert.match(item.officialUrl, new RegExp(`/tournaments/.+/${item.atpId}/overview$`));
  });
});
