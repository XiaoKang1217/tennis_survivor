import test from 'node:test';
import assert from 'node:assert/strict';
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

test('catalog lookups tolerate ATP and WTA prefixes', () => {
  const cache = { data: {}, scheduleWrite() {} };
  const localizer = new ChineseLocalizer({ cache, url: '', ttlMs: 1, catalogFile: '/file/does/not/exist' });
  localizer.tournamentByExact.set('wimbledon', '温网');
  assert.equal(localizer.tournamentName('ATP Wimbledon'), '温网');
  assert.doesNotThrow(() => localizer.enrich([]));
});

test('matches reference schedule by players when provider time has changed', () => {
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
  assert.equal(match.officialScheduleMatch, true);
  assert.equal(match.time, '23:00');
  assert.equal(match.court, '卡斯卡伊斯球场');
});

test('retains the official day while marking a matched Beijing next-day fixture', () => {
  const cache = {
    data: { localization: { date: '2026-07-22', translations: {}, tournamentTranslations: {}, tours: [{
      city: '埃斯托利尔', name: '埃斯托利尔公开赛', englishCity: 'Estoril', englishName: 'Estoril Open',
      matches: [{
        time: '00:00', beijingDate: '2026-07-23', dayOffset: 1, kind: 'MS',
        first: '亚历杭德罗·塔比洛', second: 'Tiago Torres',
        firstEn: 'Alejandro Tabilo', secondEn: 'Tiago Torres', court: '千禧银行球场'
      }]
    }] } },
    scheduleWrite() {}
  };
  const localizer = new ChineseLocalizer({ cache, url: '', ttlMs: 1, catalogFile: '/file/does/not/exist' });
  const match = normalizeMatch({
    event_key: 2, event_date: '2026-07-23', event_time: '00:00', event_type_type: 'Atp Singles',
    tournament_key: 2204, tournament_name: 'ATP Estoril',
    event_first_player: 'A. Tabilo', event_second_player: 'T. Torres'
  });
  localizer.enrich([match]);
  assert.equal(match.officialScheduleMatch, true);
  assert.equal(match.scheduleDate, '2026-07-22');
  assert.equal(match.dayOffset, 1);
});
