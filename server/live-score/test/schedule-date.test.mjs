import test from 'node:test';
import assert from 'node:assert/strict';
import { assignOfficialScheduleDate, tournamentTimeZone } from '../src/schedule-date.mjs';
import { normalizeMatch } from '../src/normalizer.mjs';

function fixture(values = {}) {
  return normalizeMatch({
    event_key: values.id || 1,
    event_date: values.date,
    event_time: values.time,
    event_type_type: values.type || 'Atp Singles',
    tournament_key: values.tournamentKey,
    tournament_name: values.tournament,
    event_first_player: 'A',
    event_second_player: 'B'
  });
}

test('knows the current ATP and WTA tournament time zones', () => {
  assert.equal(tournamentTimeZone(fixture({ tournamentKey: 2204, tournament: 'ATP Estoril' })), 'Europe/Lisbon');
  assert.equal(tournamentTimeZone(fixture({ tournamentKey: 3733, tournament: 'WTA Hamburg' })), 'Europe/Berlin');
});

test('keeps an Estoril match after Beijing midnight on the previous official date', () => {
  const match = fixture({ date: '2026-07-23', time: '01:30', tournamentKey: 2204, tournament: 'ATP Estoril' });
  const result = assignOfficialScheduleDate([match], '2026-07-22');
  assert.equal(result.length, 1);
  assert.equal(result[0].scheduleDate, '2026-07-22');
  assert.equal(result[0].date, '2026-07-23');
  assert.equal(result[0].dayOffset, 1);
});

test('does not include the previous official date in the next schedule day', () => {
  const previous = fixture({ id: 1, date: '2026-07-23', time: '01:25', tournamentKey: 2204, tournament: 'ATP Estoril' });
  const today = fixture({ id: 2, date: '2026-07-23', time: '19:00', tournamentKey: 2204, tournament: 'ATP Estoril' });
  const nextDay = fixture({ id: 3, date: '2026-07-24', time: '01:30', tournamentKey: 2204, tournament: 'ATP Estoril' });
  const result = assignOfficialScheduleDate([previous, today, nextDay], '2026-07-23');
  assert.deepEqual(result.map(match => match.id), ['2', '3']);
  assert.deepEqual(result.map(match => match.dayOffset), [0, 1]);
});

test('an explicit official schedule date is never reassigned by Beijing time', () => {
  const match = fixture({ date: '2026-07-23', time: '19:00', tournamentKey: 3733, tournament: 'WTA Hamburg' });
  match.officialScheduleDate = '2026-07-22';
  const result = assignOfficialScheduleDate([match], '2026-07-22');
  assert.equal(result.length, 1);
  assert.equal(result[0].scheduleDate, '2026-07-22');
  assert.equal(result[0].dayOffset, 1);
});
