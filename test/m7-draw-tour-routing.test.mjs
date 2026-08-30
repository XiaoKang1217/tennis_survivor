import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const miniRoot = resolve(import.meta.dirname, '..');
const { createSWRCache } = require('../core/swr-cache');
const { tournamentOptionsFromCalendarProjection } = require('../core/draw-week-index');

function cacheStorageKey(resourceKey) {
  return 'luwang_swr_entry_v1:' + encodeURIComponent(resourceKey);
}

function drawIndexPayload(overrides = {}) {
  return {
    bffContractVersion: 'draw-player-entry-bff/1',
    tournamentEditionId: 'UO',
    projectionVersion: 7,
    dataAsOf: '2026-08-24T16:00:00.000Z',
    defaultDrawId: '',
    items: [],
    delivery: { state: 'current', message: '签表已更新' },
    ...overrides
  };
}

const available = value => ({ state: 'available', value, reasonCode: null, message: null });

function calendarProjection(items) {
  return {
    bffContractVersion: 'calendar-projection-bff/1',
    projectionVersion: 12,
    dataAsOf: '2026-08-25T02:00:00.000Z',
    delivery: { state: 'current', dataAsOf: '2026-08-25T02:00:00.000Z' },
    presentation: { items }
  };
}

function calendarTournament(overrides = {}) {
  const tourBucket = overrides.tourBucket || 'atp';
  const authority = overrides.authority || (tourBucket === 'wta' || tourBucket === 'wta_125' ? 'WTA' : 'ATP');
  return {
    identity: {
      tournamentEditionId: overrides.id || 'UO',
      tourBucket
    },
    summary: {
      isJoint: overrides.isJoint === true,
      headline: available(overrides.title || '美国网球公开赛'),
      authority: available(authority),
      ...(overrides.authorities ? { authorities: overrides.authorities } : {}),
      tierDisplayName: available(overrides.level || '大满贯'),
      levelCode: available(overrides.levelCode || 'grand_slam'),
      locationSubtitle: available(overrides.location || '纽约'),
      surface: available(overrides.surface || '硬地')
    },
    dates: {
      currentDateRange: {
        start: available(overrides.startDate || '2026-08-24'),
        end: available(overrides.endDate || '2026-09-13')
      }
    },
    displayLifecycle: { label: overrides.status || '签表已公布' },
    capabilities: { draws: { status: overrides.drawStatus || 'available' } }
  };
}

function loadPageDefinition(path) {
  const pagePath = require.resolve(path);
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

function wxRuntime(seed = {}) {
  const storage = new Map(Object.entries(seed));
  return {
    redirected: '',
    navigated: '',
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    setStorage({ key, data }) { storage.set(key, data); },
    removeStorageSync(key) { storage.delete(key); },
    removeStorage({ key }) { storage.delete(key); },
    getWindowInfo() { return { statusBarHeight: 44 }; },
    showToast() {},
    redirectTo(options) { this.redirected = options.url; },
    navigateTo(options) { this.navigated = options.url; },
    showShareMenu() {}
  };
}

function pageContext(definition, wx, http, data = {}) {
  return {
    ...definition,
    http,
    cache: createSWRCache(wx),
    data: { ...structuredClone(definition.data), ...data },
    setData(update, callback) {
      Object.assign(this.data, update);
      if (typeof callback === 'function') callback.call(this);
    }
  };
}

test('draw page keeps WTA US Open requests and cache isolated by tour', async () => {
  const definition = loadPageDefinition('../pages/draws/index');
  const cachedPayload = drawIndexPayload();
  const wx = wxRuntime({
    [cacheStorageKey('draw_index:UO:wta')]: {
      resourceKey: 'draw_index:UO:wta',
      schemaVersion: 'draw-index-projection/1',
      projectionVersion: cachedPayload.projectionVersion,
      cachedAt: Date.now(),
      dataAsOf: cachedPayload.dataAsOf,
      etag: 'etag-wta',
      payload: cachedPayload
    }
  });
  const requests = [];
  const context = pageContext(definition, wx, {
    async request(path, options) {
      requests.push({ path, options });
      return { notModified: true, etag: 'etag-wta', data: null };
    }
  }, {
    selectedTournamentId: 'UO',
    selectedTitle: '美国网球公开赛',
    selectedTour: 'wta'
  });

  await definition.loadIndex.call(context);

  assert.equal(requests.length, 1);
  assert.match(requests[0].path, /tournamentEditionId=UO/u);
  assert.match(requests[0].path, /tour=wta/u);
  assert.doesNotMatch(requests[0].path, /_refresh=/u);
  assert.equal(requests[0].options.ifNoneMatch, 'etag-wta');
  assert.equal(context.data.failed, false);
});

test('draw page all-tour requests do not reuse the WTA draw cache', async () => {
  const definition = loadPageDefinition('../pages/draws/index');
  const wx = wxRuntime({
    [cacheStorageKey('draw_index:UO:wta')]: {
      resourceKey: 'draw_index:UO:wta',
      schemaVersion: 'draw-index-projection/1',
      projectionVersion: 7,
      cachedAt: Date.now(),
      dataAsOf: '2026-08-24T16:00:00.000Z',
      etag: 'etag-wta',
      payload: drawIndexPayload()
    }
  });
  const requests = [];
  const context = pageContext(definition, wx, {
    async request(path, options) {
      requests.push({ path, options });
      return { data: drawIndexPayload({ projectionVersion: 8 }), etag: 'etag-all' };
    }
  }, {
    selectedTournamentId: 'UO',
    selectedTitle: '美国网球公开赛',
    selectedTour: ''
  });

  await definition.loadIndex.call(context);

  assert.equal(requests.length, 1);
  assert.match(requests[0].path, /tournamentEditionId=UO/u);
  assert.doesNotMatch(requests[0].path, /tour=/u);
  assert.equal(requests[0].options.ifNoneMatch, undefined);
});

test('draw week index comes from calendar projection and keeps joint events unfiltered', () => {
  const options = tournamentOptionsFromCalendarProjection(calendarProjection([
    calendarTournament({ id: 'UO', tourBucket: 'atp' }),
    calendarTournament({ id: 'UO', tourBucket: 'wta' }),
    calendarTournament({
      id: 'WTA125-CALI',
      title: '卡利125赛',
      tourBucket: 'wta_125',
      level: 'WTA 125',
      levelCode: 'wta_125',
      startDate: '2026-08-24',
      endDate: '2026-08-30'
    }),
    calendarTournament({
      id: 'CH-PORTO',
      title: '波尔图挑战赛',
      tourBucket: 'atp_challenger',
      level: '挑战赛',
      levelCode: 'challenger_125',
      startDate: '2026-08-24',
      endDate: '2026-08-30'
    }),
    calendarTournament({
      id: 'NO-DRAW',
      title: '无签表赛事',
      tourBucket: 'wta',
      drawStatus: 'unavailable',
      startDate: '2026-08-24',
      endDate: '2026-08-30'
    }),
    calendarTournament({
      id: 'OLD',
      title: '上周赛事',
      tourBucket: 'atp',
      startDate: '2026-08-10',
      endDate: '2026-08-16'
    })
  ]), '2026-08-25');

  assert.deepEqual(options.map(item => item.id), ['UO', 'NO-DRAW', 'WTA125-CALI', 'CH-PORTO']);
  const usOpen = options[0];
  assert.equal(usOpen.tourOrg, 'ATP/WTA');
  assert.equal(usOpen.requestTour, '');
  assert.deepEqual([...usOpen.tourFilters].sort(), ['ATP', 'WTA']);
  assert.equal(options.find(item => item.id === 'WTA125-CALI').requestTour, 'wta');
  assert.deepEqual(options.find(item => item.id === 'CH-PORTO').tourFilters, ['CHALLENGER']);
  assert.equal(options.find(item => item.id === 'NO-DRAW').drawPublished, false);
});

test('draw week index treats production joint US Open as all-tour and localizes enum labels', () => {
  const options = tournamentOptionsFromCalendarProjection(calendarProjection([
    calendarTournament({
      id: 'UO',
      title: '美网',
      tourBucket: 'atp',
      authority: 'ATP/WTA',
      authorities: ['ATP', 'WTA'],
      isJoint: true,
      level: 'grand_slam',
      levelCode: 'grand_slam',
      location: '美网 · 美国',
      surface: null
    })
  ]), '2026-08-25');

  assert.equal(options.length, 1);
  assert.equal(options[0].levelDisplay, '大满贯');
  assert.equal(options[0].requestTour, '');
  assert.equal(options[0].tourOrg, 'ATP/WTA');
  assert.deepEqual([...options[0].tourFilters].sort(), ['ATP', 'WTA']);
  assert.equal(options[0].location, '美国');
  assert.doesNotMatch(options[0].meta, /grand_slam|atp_/u);
  assert.doesNotMatch(options[0].summaryMeta, /grand_slam|atp_/u);
});

test('calendar draw-selection entries carry tour into the draw page', () => {
  const wxml = readFileSync(resolve(miniRoot, 'pages/calendar/index.wxml'), 'utf8');
  assert.match(wxml, /data-tour="\{\{item\.requestTour\}\}"/u);

  const definition = loadPageDefinition('../pages/calendar/index');
  const wx = wxRuntime();
  const previousWx = globalThis.wx;
  globalThis.wx = wx;
  const item = {
    id: 'UO',
    title: '美国网球公开赛',
    requestTour: 'wta',
    drawAvailable: true
  };
  const context = {
    ...definition,
    data: { ...structuredClone(definition.data), drawSelectionMode: true, allItems: [item] },
    setData(update, callback) {
      Object.assign(this.data, update);
      if (typeof callback === 'function') callback.call(this);
    }
  };
  try {
    definition.openTournament.call(context, {
      currentTarget: { dataset: { id: 'UO', title: item.title, tour: 'wta' } }
    });
  } finally {
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
  }

  assert.match(wx.redirected, /^\/pages\/draws\/index\?/u);
  assert.match(wx.redirected, /tournamentEditionId=UO/u);
	  assert.match(wx.redirected, /tour=wta/u);
	});

test('calendar draw-selection omits tour for joint production US Open entries', () => {
  const definition = loadPageDefinition('../pages/calendar/index');
  const wx = wxRuntime();
  const previousWx = globalThis.wx;
  globalThis.wx = wx;
  const context = pageContext(definition, wx, null, {
    drawSelectionMode: true,
    year: 2026,
    activeMonth: 8
  });

  try {
    definition.applyCalendarProjection.call(context, calendarProjection([
      calendarTournament({
        id: 'UO',
        title: '美网',
        tourBucket: 'atp',
        authority: 'ATP/WTA',
        authorities: ['ATP', 'WTA'],
        isJoint: true,
        level: 'grand_slam',
        levelCode: 'grand_slam',
        location: '美网 · 美国'
      })
    ]));
    definition.openTournament.call(context, {
      currentTarget: { dataset: { id: 'UO', title: '美网', tour: '' } }
    });
  } finally {
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
  }

  assert.match(wx.redirected, /^\/pages\/draws\/index\?/u);
  assert.match(wx.redirected, /tournamentEditionId=UO/u);
  assert.doesNotMatch(wx.redirected, /tour=atp|tour=wta/u);
});

test('calendar page uses the single aggregate projection without tour-bucket fallback', async () => {
  const script = readFileSync(resolve(miniRoot, 'pages/calendar/index.js'), 'utf8');
  assert.doesNotMatch(script, /SOURCE_BUCKETS|fetchBucketCalendarFallback|tour-calendar-bff|Promise\.allSettled/u);

  const definition = loadPageDefinition('../pages/calendar/index');
  const wx = wxRuntime();
  const requests = [];
  const context = pageContext(definition, wx, {
    async request(path) {
      requests.push(path);
      throw new Error('calendar_aggregate_unavailable');
    }
  }, { year: 2026 });

  await definition.load.call(context);

  assert.deepEqual(requests, ['/api/v1/bff/calendar/2026']);
  assert.equal(context.data.failed, true);
});

test('draw page auto-selects WTA from calendar projection without reading score matches', async () => {
  const definition = loadPageDefinition('../pages/draws/index');
  const wx = wxRuntime();
  const previousWx = globalThis.wx;
  const previousGetApp = globalThis.getApp;
  const requests = [];
  globalThis.wx = wx;
  globalThis.getApp = () => ({
    services: {
      http: {
        async request(path, options) {
          requests.push({ path, options });
          if (path === '/api/v1/bff/calendar/2026') {
            return { statusCode: 200, data: calendarProjection([
              calendarTournament({ id: 'UO', tourBucket: 'atp' }),
              calendarTournament({ id: 'UO', tourBucket: 'wta' })
            ]), etag: 'calendar-index' };
          }
          return { statusCode: 200, data: drawIndexPayload({ items: [] }), etag: 'wta-index' };
        }
      }
    }
  });
  const context = pageContext(definition, wx, null);

  try {
    definition.onLoad.call(context, { tour: 'wta' });
    await new Promise(resolve => setTimeout(resolve, 20));
  } finally {
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
    if (previousGetApp === undefined) delete globalThis.getApp;
    else globalThis.getApp = previousGetApp;
  }

  assert.equal(context.data.selectedTournamentId, 'UO');
  assert.equal(context.data.selectedTour, 'wta');
  const drawRequest = requests.find(item => item.path.startsWith('/api/v1/bff/draws'));
  assert.ok(drawRequest);
  assert.match(drawRequest.path, /tournamentEditionId=UO/u);
  assert.match(drawRequest.path, /tour=wta/u);
  assert.equal(requests.some(item => /scores|scoreStore/u.test(item.path)), false);
});

test('draw page all filter opens joint US Open without defaulting to ATP', async () => {
  const definition = loadPageDefinition('../pages/draws/index');
  const wx = wxRuntime();
  const previousWx = globalThis.wx;
  const previousGetApp = globalThis.getApp;
  const requests = [];
  globalThis.wx = wx;
  globalThis.getApp = () => ({
    services: {
      http: {
        async request(path) {
          requests.push(path);
          if (path === '/api/v1/bff/calendar/2026') {
            return { statusCode: 200, data: calendarProjection([
              calendarTournament({ id: 'UO', tourBucket: 'atp' }),
              calendarTournament({ id: 'UO', tourBucket: 'wta' })
            ]), etag: 'calendar-index' };
          }
          return {
            statusCode: 200,
            data: drawIndexPayload({
              items: [
                { drawId: 'uo-ms-qual', tourOrg: 'ATP', discipline: 'singles', stage: 'qualifying' },
                { drawId: 'uo-ws-qual', tourOrg: 'WTA', discipline: 'singles', stage: 'qualifying' }
              ]
            }),
            etag: 'all-index'
          };
        }
      }
    }
  });
  const context = pageContext(definition, wx, null);

  try {
    definition.onLoad.call(context, { date: '2026-08-25' });
    await new Promise(resolve => setTimeout(resolve, 20));
  } finally {
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
    if (previousGetApp === undefined) delete globalThis.getApp;
    else globalThis.getApp = previousGetApp;
  }

  const drawRequest = requests.find(path => path.startsWith('/api/v1/bff/draws'));
  assert.ok(drawRequest);
  assert.doesNotMatch(drawRequest, /tour=atp/u);
  assert.deepEqual(context.data.projectOptions.map(item => item.label), ['男单', '女单']);
  assert.deepEqual(context.data.stageOptions.map(item => item.label), ['资格赛']);
});
