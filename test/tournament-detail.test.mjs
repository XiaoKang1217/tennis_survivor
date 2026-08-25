import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const miniRoot = resolve(import.meta.dirname, '../miniprogram');
const read = path => readFileSync(resolve(miniRoot, path), 'utf8');
const {
  noticeState,
  tournamentDetailView
} = require('../miniprogram/core/tournament-detail-view');

const editionId = '019c13ac-7b00-7005-8000-000000000701';
const available = value => ({
  state: 'available', value, reasonCode: null, message: null
});
const unknown = message => ({
  state: 'unknown', value: null, reasonCode: 'not_observed', message
});
const known = value => ({ state: 'known', value, reasonCode: null });
const unknownFact = () => ({
  state: 'unknown', value: null, reasonCode: 'not_observed'
});

function presentation(overrides = {}) {
  const base = {
    identity: { tournamentEditionId: editionId },
    names: {
      headline: available('加拿大网球公开赛'),
      displayNameZh: unknown('赛事中文名待确认'),
      displayNameOriginal: available('National Bank Open')
    },
    classification: {
      authority: available('ATP'),
      circuit: available('atp_tour'),
      levelCode: available('masters_1000'),
      ageGroup: available('adult'),
      tierDisplayName: unknown('赛事级别名称待确认')
    },
    datesAndStatus: {
      officialStartLocalDate: available('2026-08-02'),
      officialEndLocalDate: available('2026-08-13'),
      displayLifecycle: { code: 'ongoing', label: '进行中' }
    },
    locationAndSurface: {
      countryDisplayName: available('加拿大'),
      cityDisplayName: available('多伦多'),
      venueDisplayName: available('Sobeys Stadium'),
      surface: available('hard'),
      environment: available('outdoor')
    },
    venues: {
      sites: [{
        venueId: 'venue-1',
        displayName: available('Sobeys Stadium'),
        cityDisplayName: available('多伦多'),
        countryCode: available('CA')
      }],
      courts: [{
        venueId: 'court-1',
        displayName: available('中心球场'),
        surface: available('hard')
      }],
      availability: 'available'
    },
    history: {
      pastChampions: [{
        discipline: 'singles',
        year: known(2025),
        playerIds: unknownFact(),
        displayNames: ['Ben Shelton'],
        resultDisplay: known('6-7 6-4 7-6')
      }],
      records: [{
        playerId: unknownFact(),
        displayName: known('Rafael Nadal'),
        matchWins: known(38),
        titleCount: known(5),
        scope: known('singles')
      }],
      completeness: 'partial'
    },
    delivery: {
      availability: 'partial',
      completeness: 'partial',
      coverageGaps: ['media_not_joined'],
      dataAsOf: '2026-08-09T08:00:00.000Z',
      dataNotice: '部分赛事资料仍在确认'
    }
  };
  return { ...base, ...overrides };
}

function bff(overrides = {}) {
  return {
    bffContractVersion: 'tournament-context-bff/1',
    dataAsOf: '2026-08-09T08:00:00.000Z',
    delivery: {
      state: 'delayed',
      message: '部分赛事资料仍在确认',
      dataAsOf: '2026-08-09T08:00:00.000Z'
    },
    presentation: presentation(),
    ...overrides
  };
}

function loadPageDefinition() {
  const pagePath = require.resolve('../miniprogram/pages/tournament-detail/index');
  delete require.cache[pagePath];
  let definition;
  const previousPage = globalThis.Page;
  globalThis.Page = value => { definition = value; };
  try {
    require(pagePath);
  } finally {
    if (previousPage === undefined) delete globalThis.Page;
    else globalThis.Page = previousPage;
  }
  return definition;
}

function pageContext(definition, http, data = {}) {
  return {
    ...definition,
    http,
    data: { ...structuredClone(definition.data), ...data },
    setData(value) { Object.assign(this.data, value); }
  };
}

test('tournament detail view renders contract facts without inventing missing values', () => {
  const view = tournamentDetailView(presentation());
  assert.equal(view.name.value, '加拿大网球公开赛');
  assert.deepEqual(view.classification.map(item => item.value), [
    'ATP', 'ATP 巡回赛', 'ATP 1000', '成人'
  ]);
  assert.equal(view.location[3].value, '硬地');
  assert.equal(view.location[4].value, '室外');
  assert.equal(view.sites[0].name.value, 'Sobeys Stadium');
  assert.equal(view.courts[0].name.value, '中心球场');
  assert.equal(view.champions[0].names, 'Ben Shelton');
  assert.equal(view.records[0].titleCount.value, '5');
  assert.equal(view.hasHistory, true);
  assert.equal(view.dataStatus.gapMessage, '1 项资料仍待补齐');
  assert.equal(Object.isFrozen(view), true);
  assert.doesNotMatch(JSON.stringify(view), /prize|奖金|ranking points/i);

  const partial = tournamentDetailView(presentation({
    names: {
      headline: unknown('赛事名称待确认'),
      displayNameZh: unknown('赛事中文名待确认'),
      displayNameOriginal: unknown('赛事原名待确认')
    },
    datesAndStatus: {
      officialStartLocalDate: unknown('赛事开始日期待确认'),
      officialEndLocalDate: unknown('赛事结束日期待确认'),
      displayLifecycle: { code: 'unknown', label: '状态待确认' }
    },
    locationAndSurface: {
      countryDisplayName: unknown('国家或地区待确认'),
      cityDisplayName: unknown('城市待确认'),
      venueDisplayName: unknown('场馆待确认'),
      surface: available('unknown'),
      environment: available('unknown')
    },
    venues: { sites: [], courts: [], availability: 'unavailable' },
    history: { pastChampions: [], records: [], completeness: 'unknown' }
  }));
  assert.equal(partial.name.available, false);
  assert.equal(partial.name.value, '');
  assert.equal(partial.name.message, '赛事名称待确认');
  assert.equal(partial.dates.every(item => item.available === false), true);
  assert.equal(partial.location.every(item => item.available === false), true);
  assert.equal(partial.hasHistory, false);
});

test('tournament detail page handles delayed success and rejects identity drift', async () => {
  const definition = loadPageDefinition();
  const requests = [];
  const context = pageContext(definition, {
    async request(path, options) {
      requests.push({ path, options });
      return bff();
    }
  }, { tournamentEditionId: editionId });
  await definition.load.call(context);
  assert.equal(requests[0].path, `/api/v1/bff/tournaments/${editionId}`);
  assert.equal(
    requests[0].options.header['x-luwang-client-contract-version'],
    'tournament-context-bff/1'
  );
  assert.equal(context.data.detailLoaded, true);
  assert.equal(context.data.failed, false);
  assert.equal(context.data.deliveryState, 'delayed');
  assert.equal(context.data.detail.name.value, '加拿大网球公开赛');

  const drift = pageContext(definition, {
    async request() {
      return bff({
        presentation: presentation({
          identity: { tournamentEditionId: 'different-edition' }
        })
      });
    }
  }, { tournamentEditionId: editionId });
  await definition.load.call(drift);
  assert.equal(drift.data.failed, true);
  assert.equal(drift.data.detailLoaded, false);
});

test('tournament detail keeps last trusted content when a refresh fails', async () => {
  const definition = loadPageDefinition();
  const retainedDetail = tournamentDetailView(presentation());
  const context = pageContext(definition, {
    async request() { throw new Error('network unavailable'); }
  }, {
    tournamentEditionId: editionId,
    detailLoaded: true,
    detail: retainedDetail,
    deliveryState: 'live',
    deliveryMessage: '赛事资料已更新'
  });
  await definition.load.call(context);
  assert.equal(context.data.failed, false);
  assert.equal(context.data.refreshFailed, true);
  assert.equal(context.data.deliveryState, 'stale');
  assert.equal(context.data.detail, retainedDetail);

  const firstLoad = pageContext(definition, {
    async request() { throw new Error('network unavailable'); }
  }, { tournamentEditionId: editionId });
  await definition.load.call(firstLoad);
  assert.equal(firstLoad.data.failed, true);
  assert.equal(firstLoad.data.detailLoaded, false);
  assert.match(firstLoad.data.failureMessage, /暂不可用/);
});

test('tournament detail composes official draw awards through champion', async () => {
  const definition = loadPageDefinition();
  const context = pageContext(definition, {
    async request(path) {
      if (path.startsWith('/api/v1/bff/tournaments/')) return bff();
      return {
        bffContractVersion: 'draw-player-entry-bff/1',
        tournamentEditionId: editionId,
        items: [{
          drawId: 'draw-1', stage: 'main_draw', discipline: 'singles',
          officialMetadata: {
            roundAwards: [
              {
                roundKey: 'r128', roundLabel: 'R128',
                prizeMoney: { raw: '$10,000' }, rankingPoints: { value: 10 }
              },
              {
                roundKey: 'champion', roundLabel: 'Champion',
                prizeMoney: { raw: '$1,000,000' }, rankingPoints: { value: 1000 }
              }
            ],
            incidents: []
          }
        }]
      };
    }
  }, { tournamentEditionId: editionId });
  await definition.load.call(context);
  assert.equal(context.data.awardGroups.length, 1);
  assert.equal(context.data.awardGroups[0].label, '正赛 · 单打');
  assert.deepEqual(
    context.data.awardGroups[0].rows.map(value => value.round),
    ['128强', '冠军']
  );
  assert.equal(context.data.drawFactsUnavailable, false);
});

test('tournament detail keeps request tour for draw facts and draw navigation', async () => {
  const definition = loadPageDefinition();
  const requests = [];
  const context = pageContext(definition, {
    async request(path) {
      requests.push(path);
      if (path.startsWith('/api/v1/bff/tournaments/')) return bff();
      return {
        bffContractVersion: 'draw-player-entry-bff/1',
        tournamentEditionId: editionId,
        items: []
      };
    }
  }, {
    tournamentEditionId: editionId,
    requestTour: 'wta',
    titleHint: '美国网球公开赛'
  });

  await definition.load.call(context);

  assert.match(requests.find(path => path.startsWith('/api/v1/bff/draws')), /tour=wta/u);

  const previousWx = globalThis.wx;
  const wx = { navigated: '', navigateTo(options) { this.navigated = options.url; } };
  globalThis.wx = wx;
  try {
    definition.openDraws.call(context);
  } finally {
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
  }
  assert.match(wx.navigated, /tournamentEditionId=/u);
  assert.match(wx.navigated, /tour=wta/u);
});

test('calendar routes to detail and detail exposes only the edition draw action', () => {
  const app = JSON.parse(read('app.json'));
  const calendar = read('pages/calendar/index.js');
  const calendarMarkup = read('pages/calendar/index.wxml');
  const detail = read('pages/tournament-detail/index.js');
  const markup = read('pages/tournament-detail/index.wxml');
  assert.ok(app.pages.includes('pages/tournament-detail/index'));
  assert.match(calendar, /wx\.navigateTo\(\{[\s\S]*\/pages\/tournament-detail\/index\?tournamentEditionId=/);
  assert.match(calendarMarkup, /查看赛事详情/);
  assert.match(detail, /\/api\/v1\/bff\/tournaments\/\$\{encodeURIComponent\(tournamentEditionId\)\}/);
  assert.match(detail, /\/pages\/draws\/index\?tournamentEditionId=/);
  assert.match(markup, /级别与体系/);
  assert.match(markup, /日期与状态/);
  assert.match(markup, /地点与场地/);
  assert.match(markup, /场馆与球场/);
  assert.match(markup, /历届冠军与纪录/);
  assert.match(markup, /数据状态/);
  assert.match(markup, /奖金与积分/);
  assert.match(markup, /官方每轮奖金与积分/);
  assert.match(markup, /查看签表/);
  assert.match(markup, /client-state state="loading"/);
  assert.match(markup, /client-state state="failed"/);
  assert.equal(noticeState('current'), 'live');
  assert.equal(noticeState('stale'), 'stale');
});

test('calendar keeps joint ATP and WTA editions when provider ids match', () => {
  const calendar = read('pages/calendar/index.js');
  assert.match(calendar, /function calendarMergeKey\(item\)/);
  assert.match(calendar, /`\$\{item\.bucket\}:\$\{item\.id\}`/);
  assert.match(calendar, /byId\.set\(calendarMergeKey\(item\), item\)/);
  assert.doesNotMatch(calendar, /byId\.set\(item\.id, item\)/);
});
