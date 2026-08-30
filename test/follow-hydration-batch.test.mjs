import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { FollowService, FOLLOW_STATUS_BATCH_SIZE } = require('../services/follow-service');
const { FollowStore } = require('../services/follow-store');

const ACCOUNT_A = 'aaaaaaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbbbbbbbbbb';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function instrumentedRuntime() {
  const storage = new Map();
  const metrics = { reads: 0, writes: 0, removes: 0 };
  return {
    metrics,
    storage,
    getStorageSync(key) {
      metrics.reads += 1;
      return storage.get(key);
    },
    setStorageSync(key, value) {
      metrics.writes += 1;
      storage.set(key, value);
    },
    removeStorageSync(key) {
      metrics.removes += 1;
      storage.delete(key);
    },
    showToast() {}
  };
}

function authScope(initial = ACCOUNT_A) {
  let scope = initial;
  return {
    async ensure() { return 'a'.repeat(64); },
    currentAccountScope() { return scope; },
    currentAccessToken() { return 'a'.repeat(64); },
    setScope(value) { scope = value; }
  };
}

function matchTargets(count) {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'match',
    targetId: `match-${index + 1}`
  }));
}

function loadScoresPageDefinition() {
  const previousPage = globalThis.Page;
  const previousWx = globalThis.wx;
  let definition;
  globalThis.wx = { getStorageSync() { return 'clean-blue'; } };
  globalThis.Page = value => { definition = value; };
  const pagePath = require.resolve('../pages/scores/index');
  delete require.cache[pagePath];
  try {
    require(pagePath);
  } finally {
    if (previousPage === undefined) delete globalThis.Page;
    else globalThis.Page = previousPage;
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
  }
  return definition;
}

test('320 unique targets keep ten concurrent 32-target requests and commit once', async () => {
  assert.equal(FOLLOW_STATUS_BATCH_SIZE, 32);
  const runtime = instrumentedRuntime();
  const auth = authScope();
  const store = new FollowStore(runtime, auth);
  const notifications = [];
  store.subscribe(event => notifications.push(event));
  const pending = [];
  const http = {
    request(path, options) {
      assert.equal(path, '/api/v1/me/follows/status');
      const item = deferred();
      pending.push({ ...item, targets: options.data.targets });
      return item.promise;
    }
  };
  const service = new FollowService(runtime, auth, http, {}, store);
  const hydration = service.followedTargets(matchTargets(320));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(pending.length, 10);
  assert.deepEqual(pending.map(item => item.targets.length), Array(10).fill(32));
  for (const item of [...pending].reverse()) {
    item.resolve({
      states: item.targets.map(target => ({
        ...target,
        followed: Number(target.targetId.slice('match-'.length)) % 2 === 0
      }))
    });
  }
  const followed = await hydration;

  assert.equal(followed.size, 160);
  assert.equal(store.get('match', 'match-2'), 'followed');
  assert.equal(store.get('match', 'match-3'), 'not_followed');
  assert.equal(runtime.metrics.writes, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].batch, true);
  assert.equal(notifications[0].changes.length, 320);
});

test('hydration deduplicates targets and applies mixed true/false states once', async () => {
  const runtime = instrumentedRuntime();
  const auth = authScope();
  const store = new FollowStore(runtime, auth);
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  const requests = [];
  const service = new FollowService(runtime, auth, {
    async request(_path, options) {
      requests.push(options.data.targets);
      return { states: [
        { kind: 'match', targetId: 'one', followed: true },
        { kind: 'match', targetId: 'two', followed: false }
      ] };
    }
  }, {}, store);

  const followed = await service.followedTargets([
    { kind: 'match', targetId: 'one' },
    { kind: 'match', targetId: 'one' },
    { kind: 'match', targetId: 'two' }
  ]);

  assert.deepEqual(requests[0], [
    { kind: 'match', targetId: 'one' },
    { kind: 'match', targetId: 'two' }
  ]);
  assert.deepEqual([...followed], ['match:one']);
  assert.equal(store.get('match', 'one'), 'followed');
  assert.equal(store.get('match', 'two'), 'not_followed');
  assert.equal(runtime.metrics.writes, 1);
  assert.equal(notifications, 1);
});

test('identical hydration performs zero persistence and zero notification', async () => {
  const runtime = instrumentedRuntime();
  const auth = authScope();
  const store = new FollowStore(runtime, auth);
  store.setMany([
    { kind: 'match', targetId: 'one', followed: true },
    { kind: 'match', targetId: 'two', followed: false }
  ], { expectedScope: ACCOUNT_A });
  runtime.metrics.writes = 0;
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  const service = new FollowService(runtime, auth, {
    async request() {
      return { states: [
        { kind: 'match', targetId: 'one', followed: true },
        { kind: 'match', targetId: 'two', followed: false }
      ] };
    }
  }, {}, store);

  await service.followedTargets(matchTargets(0).concat([
    { kind: 'match', targetId: 'one' },
    { kind: 'match', targetId: 'two' }
  ]));

  assert.equal(runtime.metrics.writes, 0);
  assert.equal(notifications, 0);
});

test('one failed batch publishes no partial state and preserves trusted cache', async () => {
  const runtime = instrumentedRuntime();
  const auth = authScope();
  const store = new FollowStore(runtime, auth);
  store.set('match', 'match-1', true);
  runtime.metrics.writes = 0;
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  let requestNumber = 0;
  const service = new FollowService(runtime, auth, {
    async request(_path, options) {
      requestNumber += 1;
      if (requestNumber === 2) throw new Error('batch_failed');
      return { states: options.data.targets.map(target => ({ ...target, followed: false })) };
    }
  }, {}, store);

  await assert.rejects(service.followedTargets(matchTargets(64)), /batch_failed/u);
  assert.equal(store.get('match', 'match-1'), 'followed');
  assert.equal(store.get('match', 'match-33'), 'unknown');
  assert.equal(runtime.metrics.writes, 0);
  assert.equal(notifications, 0);
});

test('account scope change discards stale hydration without writing into either account', async () => {
  const runtime = instrumentedRuntime();
  const auth = authScope(ACCOUNT_A);
  const store = new FollowStore(runtime, auth);
  store.set('match', 'trusted-a', true);
  const request = deferred();
  const service = new FollowService(runtime, auth, {
    async request() { return request.promise; }
  }, {}, store);
  const hydration = service.followedTargets([{ kind: 'match', targetId: 'stale' }]);
  await new Promise(resolve => setImmediate(resolve));
  auth.setScope(ACCOUNT_B);
  request.resolve({ states: [{ kind: 'match', targetId: 'stale', followed: true }] });

  await assert.rejects(hydration, /follow_account_scope_changed/u);
  assert.equal(store.get('match', 'stale'), 'unknown');
  auth.setScope(ACCOUNT_A);
  assert.equal(store.get('match', 'trusted-a'), 'followed');
  assert.equal(store.get('match', 'stale'), 'unknown');
});

test('single follow and unfollow writes remain immediate', async () => {
  const runtime = instrumentedRuntime();
  const auth = authScope();
  const store = new FollowStore(runtime, auth);
  const events = [];
  store.subscribe(event => events.push(event));
  const requests = [];
  const service = new FollowService(runtime, auth, {
    request() {
      const request = deferred();
      requests.push(request);
      return request.promise;
    }
  }, { isComplete() { return true; } }, store);

  const followPromise = service.setFollow('match', 'live-1', true, 'scores');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.get('match', 'live-1'), 'followed');
  requests[0].resolve({ ok: true });
  await followPromise;
  const unfollowPromise = service.setFollow('match', 'live-1', false, 'scores');
  assert.equal(store.get('match', 'live-1'), 'not_followed');
  requests[1].resolve({ ok: true });
  await unfollowPromise;

  assert.equal(events.every(event => event.batch !== true), true);
  assert.equal(runtime.metrics.writes > 0, true);
});

test('scores hydration renders once and ignores the store batch event', async () => {
  const definition = loadScoresPageDefinition();
  const projection = {
    payload: {
      scheduleGroupDate: '2026-08-30',
      matches: [{ matchId: 'one' }, { matchId: 'two' }]
    }
  };
  let renders = 0;
  const context = {
    ...definition,
    pageActive: true,
    followedIds: new Set(),
    followStateSignature: '',
    followStateRequestId: 0,
    data: { ...definition.data, selectedDate: '2026-08-30' },
    services: {
      account: { isComplete() { return true; } },
      auth: { currentAccessToken() { return 'a'.repeat(64); } },
      follow: { async followedTargets() { return new Set(['match:two']); } },
      scoreStore: { projection }
    },
    rerender() { renders += 1; }
  };

  await definition.refreshViewerFollowStates.call(context, projection, { force: true });

  assert.deepEqual([...context.followedIds], ['two']);
  assert.equal(renders, 1);
  const source = readFileSync(new URL('../pages/scores/index.js', import.meta.url), 'utf8');
  assert.match(source, /if \(change\?\.batch\) return;/u);
});

test('scores unload invalidates pending hydration and prevents destroyed-page rendering', async () => {
  const definition = loadScoresPageDefinition();
  const projection = {
    payload: { scheduleGroupDate: '2026-08-30', matches: [{ matchId: 'one' }] }
  };
  const request = deferred();
  let renders = 0;
  let stopped = 0;
  const context = {
    ...definition,
    pageActive: true,
    followedIds: new Set(),
    followStateSignature: '',
    followStateRequestId: 0,
    unsubscribers: [() => undefined],
    data: { ...definition.data, selectedDate: '2026-08-30' },
    services: {
      account: { isComplete() { return true; } },
      auth: { currentAccessToken() { return 'a'.repeat(64); } },
      follow: { async followedTargets() { return request.promise; } },
      scoreStore: { projection },
      scoreClient: { stop() { stopped += 1; } }
    },
    rerender() { renders += 1; }
  };
  const hydration = definition.refreshViewerFollowStates.call(context, projection, { force: true });
  definition.onUnload.call(context);
  request.resolve(new Set(['match:one']));
  await hydration;

  assert.equal(context.pageActive, false);
  assert.equal(renders, 0);
  assert.equal(stopped, 1);
});

test('SSE merge and follow-count authority files remain outside this change', () => {
  const scoreClient = readFileSync(new URL('../services/score-client.js', import.meta.url), 'utf8');
  const scoreStore = readFileSync(new URL('../core/score-store.js', import.meta.url), 'utf8');
  assert.match(scoreClient, /\/api\/v1\/bff\/scores\/realtime/u);
  assert.match(scoreClient, /new SseParser/u);
  assert.match(scoreStore, /matchVersion/u);
  assert.match(scoreStore, /followCount/u);
});
