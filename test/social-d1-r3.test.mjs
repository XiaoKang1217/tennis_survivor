import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createSWRCache } = require('../core/swr-cache');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function pageDefinition(path) {
  const resolved = require.resolve(path);
  delete require.cache[resolved];
  let definition;
  const prior = globalThis.Page;
  globalThis.Page = value => { definition = value; };
  try { require(resolved); } finally {
    if (prior === undefined) delete globalThis.Page;
    else globalThis.Page = prior;
  }
  return definition;
}

function runtime() {
  const storage = new Map();
  return {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    setStorage: ({ key, data }) => storage.set(key, data),
    removeStorageSync: key => storage.delete(key),
    removeStorage: ({ key }) => storage.delete(key)
  };
}

function projection(count, offset = 0) {
  return {
    bffContractVersion: 'follow-context-bff/1',
    projectionVersion: count,
    dataAsOf: `2026-08-28T00:00:0${count}.000Z`,
    delivery: { state: 'current' },
    payload: {
      counts: { filtered: count, matches: count, players: 0, tournaments: 0 },
      page: { offset, nextOffset: null, hasMore: false },
      pageEntries: [], matches: [], players: [], tournaments: []
    }
  };
}

function followingContext(definition, queue, scopeRef) {
  const wx = runtime();
  return {
    ...definition,
    followingRequestId: 0,
    activeFollowingSignature: '',
    activeAccountScope: '',
    matchDates: new Map(),
    data: structuredClone(definition.data),
    cache: createSWRCache(wx),
    services: {
      account: {
        isComplete: () => Boolean(scopeRef.value),
        currentProfile: () => ({ accountScope: scopeRef.value })
      },
      auth: { async ensure() {}, currentAccountScope: () => scopeRef.value },
      http: { request: (...args) => queue.shift().promise.then(value => value(...args)) }
    },
    setData(update, callback) {
      Object.assign(this.data, update);
      callback?.call(this);
    }
  };
}

test('SOCIAL-D1-R3 stale status and date responses cannot overwrite the latest request', async () => {
  const definition = pageDefinition('../pages/following/index');
  const first = deferred();
  const second = deferred();
  const scope = { value: 'account-a' };
  const context = followingContext(definition, [first, second], scope);
  const oldRequest = definition.load.call(context);
  context.data.selectedMatchStatus = 'ended';
  context.data.selectedDate = '2026-08-27';
  const latestRequest = definition.load.call(context);
  second.resolve(() => projection(2));
  await latestRequest;
  first.resolve(() => projection(1));
  await oldRequest;
  assert.equal(context.data.count, 2);
  assert.equal(context.data.selectedMatchStatus, 'ended');
  assert.equal(context.data.selectedDate, '2026-08-27');
});

test('SOCIAL-D1-R3 stale failure and page response cannot clear a newer page', async () => {
  const definition = pageDefinition('../pages/following/index');
  const first = deferred();
  const second = deferred();
  const scope = { value: 'account-a' };
  const context = followingContext(definition, [first, second], scope);
  const pageOne = definition.load.call(context);
  context.data.pageNumber = 2;
  const pageTwo = definition.load.call(context);
  second.resolve(() => projection(20, 10));
  await pageTwo;
  first.reject(new Error('page_one_failed_late'));
  await pageOne;
  assert.equal(context.data.count, 20);
  assert.equal(context.data.pageNumber, 2);
  assert.equal(context.data.failed, false);
});

test('SOCIAL-D1-R3 account A response cannot cross into account B', async () => {
  const definition = pageDefinition('../pages/following/index');
  const first = deferred();
  const second = deferred();
  const scope = { value: 'account-a' };
  const context = followingContext(definition, [first, second], scope);
  const accountA = definition.load.call(context);
  scope.value = 'account-b';
  const accountB = definition.load.call(context);
  second.resolve(() => projection(8));
  await accountB;
  first.resolve(() => projection(4));
  await accountA;
  assert.equal(context.activeAccountScope, 'account-b');
  assert.equal(context.data.count, 8);
});

test('SOCIAL-D1-R3 player social first load is single-flight and gift refresh is explicit', async () => {
  const definition = pageDefinition('../packages/player/pages/player-detail/index');
  const overview = deferred();
  const viewer = deferred();
  let publicRequests = 0;
  let privateRequests = 0;
  const context = {
    ...definition,
    data: { ...structuredClone(definition.data), playerId: '68074', tour: 'ATP' },
    socialLoadPromise: null,
    socialLoadKey: '',
    socialLoadedKey: '',
    social: {
      playerOverview() { publicRequests += 1; return overview.promise; },
      viewerFanRank() { privateRequests += 1; return viewer.promise; }
    },
    setData(update) { Object.assign(this.data, update); }
  };
  const first = definition.loadSocial.call(context);
  const duplicate = definition.loadSocial.call(context);
  assert.equal(publicRequests, 1);
  assert.equal(privateRequests, 1);
  overview.resolve({ payload: { lifetimeFlowerTotal: 3, topFans: [] } });
  viewer.resolve({ viewer: { flowerTotal: 1, rank: 1 } });
  await Promise.all([first, duplicate]);
  await definition.loadSocial.call(context);
  assert.equal(publicRequests, 1);
  assert.equal(privateRequests, 1);
});
