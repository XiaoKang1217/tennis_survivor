import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ChineseLocalizer } from '../src/localizer.mjs';
import { normalizeMatch } from '../src/normalizer.mjs';

function localizer(cache = { data: {}, scheduleWrite() {} }) {
  return new ChineseLocalizer({
    cache,
    catalogFile: fileURLToPath(new URL('../data/translations.json', import.meta.url))
  });
}

test('localization changes labels only and preserves every schedule fact', () => {
  const instance = localizer();
  const match = normalizeMatch({
    event_key: 7,
    event_date: '2026-07-23',
    event_time: '19:00',
    event_status: 'Set 2',
    event_live: '1',
    event_type_type: 'Atp Singles',
    tournament_key: 319,
    tournament_name: 'Generali Open',
    tournament_surface: 'Clay',
    event_stadium: 'Center Court',
    event_first_player_key: 1,
    event_first_player: 'Tiago Torres',
    event_second_player_key: 2,
    event_second_player: 'Alejandro Tabilo',
    scores: [{ score_set: 1, score_first: 6, score_second: 4 }]
  });
  match.tournament.canonicalKey = 'ATP:319:2026';
  match.officialScheduleDate = '2026-07-23';
  const factsBefore = {
    id: match.id,
    date: match.date,
    time: match.time,
    status: match.status,
    type: match.type,
    tournamentId: match.tournament.id,
    canonicalKey: match.tournament.canonicalKey,
    surface: match.tournament.surface,
    court: match.court,
    winner: match.winner,
    serve: match.serve,
    sets: structuredClone(match.sets),
    officialScheduleDate: match.officialScheduleDate
  };

  instance.enrich([match]);

  assert.deepEqual({
    id: match.id,
    date: match.date,
    time: match.time,
    status: match.status,
    type: match.type,
    tournamentId: match.tournament.id,
    canonicalKey: match.tournament.canonicalKey,
    surface: match.tournament.surface,
    court: match.court,
    winner: match.winner,
    serve: match.serve,
    sets: match.sets,
    officialScheduleDate: match.officialScheduleDate
  }, factsBefore);
  assert.equal(match.first.nameEn, 'Tiago Torres');
  assert.equal(match.first.name, '蒂亚戈·托雷斯');
  assert.equal(match.tournament.name, 'Generali Open');
});

test('a saved player-id translation is reusable without a network source', () => {
  const cache = {
    data: { localization: { playerTranslations: { 101: '测试球员' } } },
    scheduleWrite() {}
  };
  const instance = localizer(cache);
  assert.equal(instance.playerName('101', 'Test Player'), '测试球员');
});

test('localizing a details response cannot alter event metadata', () => {
  const instance = localizer();
  const original = {
    event_key: 42,
    event_date: '2026-07-23',
    event_time: '17:00',
    event_status: 'Finished',
    event_first_player: 'Tiago Torres',
    event_second_player: 'Alejandro Tabilo',
    tournament_name: 'Millennium Estoril Open',
    event_stadium: 'ESTADIO MILLENNIUM'
  };
  const localized = instance.localizeEvent(original);
  assert.equal(localized.event_key, 42);
  assert.equal(localized.event_date, original.event_date);
  assert.equal(localized.event_time, original.event_time);
  assert.equal(localized.event_status, original.event_status);
  assert.equal(localized.event_stadium, original.event_stadium);
  assert.equal(localized.event_first_player_en, 'Tiago Torres');
  assert.equal(localized.event_first_player, '蒂亚戈·托雷斯');
  assert.equal(localized.tournament_name, 'Millennium Estoril Open');
});
