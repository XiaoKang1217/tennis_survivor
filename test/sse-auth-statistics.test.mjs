import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  completionProjection,
  matchId,
  statisticsProjection
} from './support.mjs';

const require = createRequire(import.meta.url);
const { Utf8StreamDecoder, SseParser } = require('../core/sse-parser');
const { AuthSession, stableAccountScope } = require('../services/auth-session');
const { wxRequest, HttpClient } = require('../services/http-client');
const { StatisticsStore } = require('../core/statistics-store');
const {
  CompletionStatisticsStore
} = require('../core/completion-statistics-store');
const { statisticsView } = require('../core/statistics-view-model');

test('SSE parser preserves split multibyte Chinese and multiple events', () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode('event: delta\ndata: {"message":"次日比分"}\n\nevent: ready\ndata: {}\n\n');
  const events = [];
  const parser = new SseParser(event => events.push(event));
  for (let index = 0; index < bytes.length; index += 2) {
    parser.feed(bytes.slice(index, index + 2));
  }
  parser.finish();
  assert.deepEqual(events.map(event => event.event), ['delta', 'ready']);
  assert.match(events[0].data, /次日比分/);
  assert.equal(new Utf8StreamDecoder().decode(new Uint8Array([0xff])), '�');
});

function wxRuntime() {
  const storage = new Map();
  return {
    storage,
    login({ success }) { success({ code: 'single_use_code_kept_inside_runtime' }); },
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); }
  };
}

test('automatic user login stores only the short session and refreshes without exposing identity material', async () => {
  const runtime = wxRuntime();
  const requests = [];
  const auth = new AuthSession(runtime, async options => {
    requests.push(options);
    return {
      statusCode: 200,
      data: {
	        contractVersion: 'score-bff/2',
	        accessToken: 'a'.repeat(64),
	        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
	        accountId: 'account-alpha'
	      }
	    };
	  });
  assert.equal(await auth.ensure(), 'a'.repeat(64));
  assert.equal(auth.state, 'ready');
	  assert.deepEqual(Object.keys([...runtime.storage.values()][0]).sort(),
	    ['accessToken', 'accountScope', 'expiresAt']);
	  assert.equal(
	    runtime.storage.get('luwang_v2_user_session_v1').accountScope,
	    stableAccountScope('account-alpha')
	  );
	  assert.equal(requests[0].data.code, 'single_use_code_kept_inside_runtime');
	  assert.doesNotMatch(JSON.stringify([...runtime.storage.values()]), /single_use_code|account-alpha/);
	});

test('an expiring session refreshes once for concurrent callers while trusted content may remain visible', async () => {
  const runtime = wxRuntime();
  runtime.storage.set('luwang_v2_user_session_v1', {
    accessToken: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 15_000).toISOString()
  });
  let exchangeCount = 0;
  const auth = new AuthSession(runtime, async () => {
    exchangeCount += 1;
    await new Promise(resolve => setImmediate(resolve));
    return {
      statusCode: 200,
      data: {
        contractVersion: 'score-bff/2',
        accessToken: 'b'.repeat(64),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString()
      }
    };
  });
  const states = [];
  auth.subscribe(state => states.push(state));
  const tokens = await Promise.all([auth.ensure(), auth.ensure(), auth.ensure()]);
  assert.deepEqual(tokens, Array(3).fill('b'.repeat(64)));
  assert.equal(exchangeCount, 1);
  assert.deepEqual(states, ['authenticating', 'refreshing', 'ready']);
	  assert.equal(runtime.storage.get('luwang_v2_user_session_v1').accessToken,
	    'b'.repeat(64));
	});

test('session token renewal preserves the stable account scope when the backend identity is unchanged', async () => {
  const runtime = wxRuntime();
  const scope = stableAccountScope('account-stable');
  runtime.storage.set('luwang_v2_user_session_v1', {
    accessToken: 'a'.repeat(64),
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
    accountScope: scope
  });
  const auth = new AuthSession(runtime, async () => ({
    statusCode: 200,
    data: {
      contractVersion: 'score-bff/2',
      accessToken: 'b'.repeat(64),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      accountId: 'account-stable'
    }
  }));

  assert.equal(await auth.ensure(), 'b'.repeat(64));
  assert.equal(auth.currentAccountScope(), scope);
  assert.equal(runtime.storage.get('luwang_v2_user_session_v1').accountScope, scope);
});

test('an existing session adopts the stable account scope returned by profile recovery', () => {
  const runtime = wxRuntime();
  runtime.storage.set('luwang_v2_user_session_v1', {
    accessToken: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString()
  });
  const auth = new AuthSession(runtime, async () => {
    throw new Error('the usable session must not log in again');
  });

  const scope = auth.adoptAccountScope('user_candice');

  assert.equal(scope, stableAccountScope('user_candice'));
  assert.equal(auth.currentAccountScope(), scope);
  assert.equal(runtime.storage.get('luwang_v2_user_session_v1').accountScope, scope);
});

test('public HTTP reads default to authMode none and do not attach bearer', async () => {
  const runtime = wxRuntime();
  const authorizations = [];
  runtime.request = options => {
    authorizations.push(options.header.authorization);
    options.success({ statusCode: 200, data: { ok: true } });
  };
  const auth = {
    async ensure() { throw new Error('public read must not authenticate'); },
    currentAccessToken() { return 'a'.repeat(64); },
    invalidate() {},
    async refresh() { throw new Error('public read must not refresh'); }
  };
  const response = await new HttpClient(runtime, auth).request('/api/v1/bff/scores/today');
  assert.deepEqual(response, { ok: true });
  assert.deepEqual(authorizations, [undefined]);
});

test('required HTTP 401 invalidates and renews the session before one bounded retry', async () => {
  const runtime = wxRuntime();
  const authorizations = [];
  let token = 'a'.repeat(64);
  let invalidations = 0;
  let refreshes = 0;
  runtime.request = options => {
    authorizations.push(options.header.authorization);
    options.success({
      statusCode: authorizations.length === 1 ? 401 : 200,
      data: authorizations.length === 1 ? { error: { code: 'identity_expired' } } : { ok: true }
    });
  };
  const auth = {
    async ensure() { return token; },
    invalidate() { invalidations += 1; },
    async refresh() { refreshes += 1; token = 'b'.repeat(64); return token; }
  };
  const response = await new HttpClient(runtime, auth).request('/api/v1/me/profile', {
    authMode: 'required'
  });
  assert.deepEqual(response, { ok: true });
  assert.deepEqual(authorizations, [
    `Bearer ${'a'.repeat(64)}`,
    `Bearer ${'b'.repeat(64)}`
  ]);
  assert.equal(invalidations, 1);
  assert.equal(refreshes, 1);
});

test('invalid WeChat login is rejected without retaining a credential', async () => {
  const runtime = wxRuntime();
  const auth = new AuthSession(runtime, async () => ({ statusCode: 401, data: {} }));
  await assert.rejects(auth.ensure(), /wechat_login_rejected/);
  assert.equal(auth.state, 'failed');
  assert.equal(runtime.storage.size, 0);
});

test('a silent WeChat login fails promptly instead of leaving the page spinning forever', async () => {
  const runtime = wxRuntime();
  runtime.login = () => {};
  const auth = new AuthSession(runtime, async () => {
    throw new Error('the BFF must not be called without a WeChat code');
  }, 1);
  await assert.rejects(auth.ensure(), /wechat_login_timeout/);
  assert.equal(auth.state, 'failed');
  assert.equal(runtime.storage.size, 0);
});

test('a silent BFF request has a callback-independent timeout and exits login loading', async () => {
  const runtime = wxRuntime();
  let aborts = 0;
  runtime.request = () => ({
    abort() { aborts += 1; }
  });
  const auth = new AuthSession(
    runtime,
    options => wxRequest(runtime, options),
    1
  );
  await assert.rejects(auth.ensure(), /network_request_timeout/);
  assert.equal(auth.state, 'failed');
  assert.equal(runtime.storage.size, 0);
  assert.equal(aborts, 1);
});

test('statistics store applies allowed contiguous patches and preserves trusted data across gaps', () => {
  const store = new StatisticsStore(matchId);
  store.snapshot(statisticsProjection(1));
  const frame = {
    contractVersion: 'match-statistics-realtime/2', kind: 'delta', matchId,
    baseVersion: 1, version: 2, statisticsVersion: 2,
    dataAsOf: '2026-08-06T23:30:11.000Z',
    patches: [{
      path: 'display.sides.0.aces',
      value: { state: 'known', displayText: '9', value: { value: 9 }, reasonCode: null }
    }]
  };
  assert.equal(store.frame(frame).action, 'delta_applied');
  assert.equal(statisticsView(store.projection).rows[0].first, '9');
  const trusted = store.projection;
  assert.equal(store.frame({ ...frame, baseVersion: 3, version: 4 }).action,
    'resync_required');
  assert.equal(store.projection, trusted);
  assert.throws(() => store.frame({
    ...frame, baseVersion: 2, version: 3,
    patches: [{ path: 'payload.rawJson', value: {} }]
  }), /patch path invalid/);
});

test('rate statistics show percent signs and every metric exposes comparison bars', () => {
  const view = statisticsView(statisticsProjection(1));
  const firstServe = view.rows.find(row => row.metricId === 'firstServesIn');
  const breakPoints = view.rows.find(row => row.metricId === 'breakPointsConverted');
  assert.equal(firstServe.first, '60%');
  assert.equal(breakPoints.first, '43%');
  assert.equal(breakPoints.label, '破发点兑现率');
  assert.equal(firstServe.firstBar, 60);
  assert.ok(view.rows.every(row => Number.isInteger(row.firstBar)
    && Number.isInteger(row.secondBar)));
});

test('Sofa statistics V2 renders six period tabs, Chinese groups and unavailable fields honestly', () => {
  const periods = ['ALL', '1ST', '2ND', '3RD', '4TH', '5TH'].map((period, index) => ({
    period, labelZh: index === 0 ? '总计' : `第${index}盘`, groups: [{
      groupId: 'service', groupNameZh: '发球', fields: [{
        stableFieldId: 'aces', labelZh: 'ACE球',
        side1: { value: index, display: String(index) },
        side2: { value: index + 1, display: String(index + 1) },
        available: index === 0, sourceObservedAt: '2026-08-31T12:00:00.000Z'
      }]
    }]
  }));
  const projection = {
    bffContractVersion: 'match-statistics-bff/3',
    statisticsContractVersion: 'match-statistics-v2/1', projectionVersion: 2,
    statisticsVersion: 2, dataAsOf: '2026-08-31T12:00:00.000Z',
    payload: { statistics: { matchId } }, display: { periods },
    delivery: { state: 'current', message: '', dataAsOf: '2026-08-31T12:00:00.000Z' }
  };
  const view = statisticsView(projection, ['甲', '乙'], '2ND');
  assert.equal(view.periods.length, 6);
  assert.equal(view.period, '2ND');
  assert.equal(view.groups[0].groupNameZh, '发球');
  assert.equal(view.groups[0].rows[0].available, false);
});

test('completion statistics store uses the permanent compact stream and preserves trusted facts on gaps', () => {
  const store = new CompletionStatisticsStore(matchId);
  store.snapshot(completionProjection(5));
  assert.equal(statisticsView(store.projection).rows[0].first, '4');
  const trusted = store.projection;
  assert.equal(store.frame({
    contractVersion: 'score-completion-realtime/1',
    kind: 'delta',
    matchId,
    baseVersion: 5,
    version: 9,
    dataAsOf: '2026-08-06T23:30:11.000Z',
    delivery: completionProjection(9).delivery,
    changes: {
      liveStatistics: completionProjection(9, { firstAces: 8 }).liveStatistics
    }
  }).action, 'update_applied');
  assert.equal(statisticsView(store.projection).rows[0].first, '8');
  assert.equal(store.frame({
    contractVersion: 'score-completion-realtime/1',
    kind: 'status',
    matchId,
    baseVersion: 7,
    version: 10,
    dataAsOf: '2026-08-06T23:30:12.000Z',
    delivery: completionProjection(10).delivery
  }).action, 'resync_required');
  assert.notEqual(store.projection, trusted);
  assert.equal(statisticsView(store.projection).rows[0].first, '8');
});
