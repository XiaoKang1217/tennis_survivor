import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ChineseLocalizer, parseChineseSchedule } from '../src/localizer.mjs';
import { normalizeMatch } from '../src/normalizer.mjs';

test('parses Chinese tournament, court, surface and player names', () => {
  const html = `
    <div class="cResultTourTitle" tour-id="20319">
      <div class="cResultTourInfoCity">基茨比厄尔</div>
      <div class="cResultTourInfoName">忠利公开赛</div>
      <span class="SurfaceClay"></span>
      <div class="cResultCourt something">
        <div class="cResultCourtTitle">中心球场</div>
        <div class="cResultMatch something">
          <div class="cResultMatchTime">1784701200</div>
          <div class="cResultMatchGender">男单</div>
          <table><tr class="one"><td><span>辛纳</span><sub>1</sub> 1.25</td></tr><tr class="two"><td><span>阿尔卡拉斯</span><sub>2</sub> 3.75</td></tr></table>
          <a>3:2</a>
        </div>
      </div>
    </div>`;
  const tours = parseChineseSchedule(html, '2026-07-22');
  assert.equal(tours.length, 1);
  assert.deepEqual(tours[0], {
    id: '20319', city: '基茨比厄尔', name: '忠利公开赛', surface: '红土', level: '',
    matches: [{
      time: '14:20', beijingDate: '2026-07-22', dayOffset: 0, kind: 'MS',
      first: '辛纳', second: '阿尔卡拉斯', firstRank: '1', secondRank: '2',
      firstOdds: '1.25', secondOdds: '3.75', h2h: '3:2', court: '中心球场'
    }]
  });
});

test('marks Beijing next-day matches while retaining the official schedule date', () => {
  const epoch = Date.parse('2026-07-23T00:30:00+08:00') / 1000;
  const html = `\n<div class="cResultTourTitle" tour-id="1"><div class="cResultTourInfoCity">A</div><div class="cResultCourt x"><div class="cResultCourtTitle">C</div><div class="cResultMatch x"><div class="cResultMatchTime">${epoch}</div><div class="cResultMatchGender">男单</div><tr class="a"><span>A</span></tr><tr class="b"><span>B</span></tr></div></div></div>`;
  assert.equal(parseChineseSchedule(html, '2026-07-22')[0].matches[0].dayOffset, 1);
});

test('keeps the last complete schedule when an upstream refresh is empty', { concurrency: false }, async () => {
  const tours = [{ id: '1', city: '测试站', matches: [{ dayOffset: 1 }] }];
  const cache = {
    data: { localization: { date: '2026-07-22', version: 4, fetchedAt: 0, tours } },
    scheduleWrite() {}
  };
  const localizer = new ChineseLocalizer({ cache, url: 'https://example.test/zh/{date}', ttlMs: 1, catalogFile: '/file/does/not/exist' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => '' });
  try {
    assert.equal(await localizer.refresh('2026-07-22', 10), tours);
    assert.equal(cache.data.localization.tours, tours);
    assert.equal(cache.data.localization.fetchedAt, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('caches historical Chinese-name sheets separately from the active day', async () => {
  const cache = {
    data: {
      localization: { date: '2026-07-23', version: 5, fetchedAt: 20, tours: [{ id: 'today' }] },
      localizationHistory: {}
    },
    scheduleWrite() {}
  };
  const localizer = new ChineseLocalizer({
    cache,
    url: '',
    ttlMs: 100,
    catalogFile: '/file/does/not/exist'
  });
  let fetches = 0;
  localizer.fetchTours = async date => {
    fetches += 1;
    return [{ id: date, matches: [] }];
  };
  const first = await localizer.loadDate('2026-07-22', 30);
  const second = await localizer.loadDate('2026-07-22', 40);
  assert.equal(fetches, 1);
  assert.equal(first.tours[0].id, '2026-07-22');
  assert.equal(second.tours[0].id, '2026-07-22');
  assert.equal(cache.data.localization.date, '2026-07-23');
  assert.equal(cache.data.localizationHistory['2026-07-22'].tours[0].id, '2026-07-22');
});

test('catalog lookups tolerate ATP and WTA prefixes', () => {
  const cache = { data: {}, scheduleWrite() {} };
  const localizer = new ChineseLocalizer({ cache, url: '', ttlMs: 1, catalogFile: '/file/does/not/exist' });
  localizer.tournamentByExact.set('wimbledon', '温网');
  assert.equal(localizer.tournamentName('ATP Wimbledon'), '温网');
  assert.doesNotThrow(() => localizer.enrich([]));
});

test('replaces an untranslated Latin component inside a localized doubles name', () => {
  const cache = { data: {}, scheduleWrite() {} };
  const localizer = new ChineseLocalizer({
    cache,
    url: '',
    ttlMs: 1,
    catalogFile: fileURLToPath(new URL('../data/translations.json', import.meta.url))
  });
  assert.equal(
    localizer.preferredLocalizedName('若昂·多明格斯/Tiago TORRES', 'Domingues/ Torres'),
    '若昂·多明格斯/蒂亚戈·托雷斯'
  );
});

test('uses a complete pairing only for Chinese names and never overwrites API metadata', () => {
  const cache = {
    data: { localization: { date: '2026-07-22', translations: {}, tournamentTranslations: {}, tours: [{
      city: '埃斯托利尔', name: '埃斯托利尔公开赛', englishCity: 'Estoril', englishName: 'Estoril Open',
      matches: [{
        time: '23:00', beijingDate: '2026-07-22', dayOffset: 0, kind: 'MD',
        first: '努诺·博尔热斯/弗朗西斯科·卡布拉尔', second: '阿蒂尔·雷蒙/卢卡·桑切斯',
        firstEn: 'Borges/Cabral', secondEn: 'Reymond/Sanchez', court: '卡斯卡伊斯球场'
      }]
    }] } },
    scheduleWrite() {}
  };
  const localizer = new ChineseLocalizer({ cache, url: '', ttlMs: 1, catalogFile: '/file/does/not/exist' });
  const match = normalizeMatch({
    event_key: 1, event_date: '2026-07-22', event_time: '21:30', event_type_type: 'Atp Doubles',
    tournament_key: 1267, tournament_name: 'ATP Estoril Doubles',
    event_first_player: 'Borges/ Cabral', event_second_player: 'Reymond/ Sanchez'
  });
  localizer.enrich([match]);
  assert.equal(match.time, '21:30');
  assert.equal(match.court, '未标注');
  assert.equal(match.tournament.surface, '未标注');
  assert.equal(match.first.name, '努诺·博尔热斯/弗朗西斯科·卡布拉尔');
  assert.equal(match.second.name, '阿蒂尔·雷蒙/卢卡·桑切斯');
  assert.equal(match.first.nameEn, 'Borges/ Cabral');
  assert.equal(match.second.nameEn, 'Reymond/ Sanchez');
  assert.equal(cache.data.localization.translations[''], undefined);
});

test('matches abbreviated doubles teams even when a surname is written first', () => {
  const cache = {
    data: { localization: { date: '2026-07-22', translations: {}, tournamentTranslations: {}, tours: [{
      city: '埃斯托利尔', name: '埃斯托利尔公开赛', englishCity: 'Estoril', englishName: 'Estoril Open',
      matches: [{
        time: '20:10', beijingDate: '2026-07-22', dayOffset: 0, kind: 'MD',
        first: '何承叡/本杰明·基泰', second: '奥兰多·鲁兹/拉斐斯·马托斯',
        firstEn: 'HO Ray/Benjamin KITTAY', secondEn: 'Orlando LUZ/Rafael MATOS', court: '卡斯卡伊斯球场'
      }]
    }] } },
    scheduleWrite() {}
  };
  const localizer = new ChineseLocalizer({ cache, url: '', ttlMs: 1, catalogFile: '/file/does/not/exist' });
  const match = normalizeMatch({
    event_key: 12147573, event_date: '2026-07-22', event_time: '20:10', event_type_type: 'Atp Doubles',
    tournament_key: 1267, tournament_name: 'ATP Estoril Doubles',
    event_first_player_key: 105332, event_first_player: 'Ho/ Kittay',
    event_second_player_key: 9914, event_second_player: 'Luz/ Matos'
  });
  localizer.enrich([match]);
  assert.equal(match.first.name, '何承叡/本杰明·基泰');
  assert.equal(match.second.name, '奥兰多·鲁兹/拉斐斯·马托斯');
  assert.equal(match.court, '未标注');
  assert.equal(cache.data.localization.translations['105332'], '何承叡/本杰明·基泰');
  assert.equal(cache.data.localization.translations['9914'], '奥兰多·鲁兹/拉斐斯·马托斯');
  localizer.enrich([match]);
  assert.equal(match.first.name, '何承叡/本杰明·基泰');
  assert.equal(match.first.nameEn, 'Ho/ Kittay');
});

test('keeps localized sides aligned when the provider reverses player order', () => {
  const cache = {
    data: { localization: { date: '2026-07-22', translations: {}, tournamentTranslations: {}, tours: [{
      city: '测试站', name: '测试公开赛', englishCity: 'Test', englishName: 'Test Open',
      matches: [{
        time: '19:00', beijingDate: '2026-07-22', dayOffset: 0, kind: 'MS',
        first: '甲', second: '乙', firstEn: 'Alpha ONE', secondEn: 'Beta TWO', court: '中心球场'
      }]
    }] } },
    scheduleWrite() {}
  };
  const localizer = new ChineseLocalizer({ cache, url: '', ttlMs: 1, catalogFile: '/file/does/not/exist' });
  const match = normalizeMatch({
    event_key: 3, event_date: '2026-07-22', event_time: '19:00', event_type_type: 'Atp Singles',
    tournament_key: 3, tournament_name: 'ATP Test',
    event_first_player_key: 31, event_first_player: 'B. Two',
    event_second_player_key: 32, event_second_player: 'A. One'
  });
  localizer.enrich([match]);
  assert.equal(match.first.name, '乙');
  assert.equal(match.second.name, '甲');
});

test('never overwrites an API match when only one player and the time match', () => {
  const cache = {
    data: { localization: { date: '2026-07-22', translations: {}, tournamentTranslations: {}, tours: [{
      city: '汉堡', name: '汉堡公开赛', englishCity: 'Hamburg', englishName: 'Hamburg Open', surface: '红土',
      matches: [{
        time: '19:10', beijingDate: '2026-07-22', dayOffset: 0, kind: 'WS',
        first: '泰莎-约翰娜·布罗克曼', second: '埃尔莎·雅克莫',
        firstEn: 'T. Brockmann', secondEn: 'E. Jacquemot', court: 'M1'
      }]
    }] } },
    scheduleWrite() {}
  };
  const localizer = new ChineseLocalizer({ cache, url: '', ttlMs: 1, catalogFile: '/file/does/not/exist' });
  const match = normalizeMatch({
    event_key: 2, event_date: '2026-07-23', event_time: '19:10', event_type_type: 'Wta Singles',
    tournament_key: 3733, tournament_name: 'WTA Hamburg',
    event_first_player: 'M. Sherif', event_second_player: 'E. Jacquemot'
  });
  localizer.enrich([match]);
  assert.equal(match.first.name, 'M. Sherif');
  assert.equal(match.second.name, 'E. Jacquemot');
  assert.equal(match.date, '2026-07-23');
  assert.equal(match.time, '19:10');
  assert.equal(match.court, '未标注');
  assert.equal(match.tournament.surface, '未标注');
});
