import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { matchId, presentation } from './support.mjs';

const miniRoot = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { createSWRCache } = require('../core/swr-cache');

function cacheStorageKey(resourceKey) {
  return 'luwang_swr_entry_v1:' + encodeURIComponent(resourceKey);
}

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker ${endMarker}`);
  return source.slice(start, end);
}

function loadPageDefinition() {
  const pagePath = require.resolve('../pages/match-detail/index');
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
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    setStorage({ key, data }) { storage.set(key, data); },
    removeStorageSync(key) { storage.delete(key); },
    removeStorage({ key }) { storage.delete(key); }
  };
}

function matchEnvelope(overrides = {}) {
  const payload = presentation(overrides);
  return {
    bffContractVersion: 'score-bff/3',
    presentationContractVersion: 'match-presentation/1',
    projectionVersion: 9,
    projectionGeneratedAt: payload.delivery.dataAsOf,
    dataAsOf: payload.delivery.dataAsOf,
    delivery: {
      state: payload.delivery.state,
      message: payload.delivery.dataNotice,
      dataAsOf: payload.delivery.dataAsOf
    },
    payload
  };
}

function oddsEnvelope() {
  return {
    bffContractVersion: 'match-odds-bff/1',
    oddsContractVersion: 'match-odds/1',
    matchId,
    projectionVersion: 4,
    oddsVersion: 4,
    dataAsOf: '2026-08-06T23:40:00.000Z',
    delivery: { state: 'current', message: '赔率已更新', dataAsOf: '2026-08-06T23:40:00.000Z' },
    payload: {
      matchId,
      odds: {
        state: 'available',
        firstSideDecimal: 1.55,
        secondSideDecimal: 2.45,
        preMatch: { state: 'available', firstSideDecimal: 1.60, secondSideDecimal: 2.35 },
        live: { state: 'available', firstSideDecimal: 1.55, secondSideDecimal: 2.45 }
      }
    }
  };
}

function pageContext(definition, wx, http) {
  return {
    ...definition,
    matchId,
    services: { http },
    cache: createSWRCache(wx),
    data: {
      ...structuredClone(definition.data),
      match: null
    },
    applyMatch(value) {
      this.data.match = { id: value.matchId, raw: value };
    },
    setData(update, callback) {
      Object.assign(this.data, update);
      if (typeof callback === 'function') callback.call(this);
    }
  };
}

test('match detail consumes odds and progression through independent module routes', () => {
  const source = readFileSync(
    resolve(miniRoot, 'pages/match-detail/index.js'),
    'utf8'
  );

  assert.match(source, /async loadOdds\(match/u);
  assert.match(source, /loadProjectionResource/u);
  assert.match(source, /readTrustedProjection/u);
  assert.match(source, /contracts\.oddsProjection/u);
  assert.match(source, /\/api\/v1\/bff\/matches\/\$\{encodeURIComponent\(match\.id\)\}\/odds/u);
  assert.match(source, /async loadProgression\(match/u);
  assert.match(source, /contracts\.progressionProjection/u);
  assert.match(source, /scoreText:\s*String\(node\.scoreText/u);
  const markup = readFileSync(new URL('../pages/match-detail/index.wxml', import.meta.url), 'utf8');
  assert.match(markup, /\{\{entry\.opponent\}\}<\/text><text>\{\{entry\.round\}\}/u);
  assert.match(markup, /entry\.scoreText \|\| entry\.status/u);
  assert.match(source, /\/api\/v1\/bff\/matches\/\$\{encodeURIComponent\(match\.id\)\}\/progression-path/u);
  assert.match(source, /void this\.loadOdds\(match\)/u);
  assert.match(source, /void this\.loadProgression\(match, \{ background: true \}\)/u);

  const progressionLoader = sourceSlice(
    source,
    'async loadProgression(match',
    'async loadH2h(match'
  );
  assert.doesNotMatch(progressionLoader, /\bloadMatch\s*\(/u);
  assert.match(progressionLoader, /MATCH_PROGRESSION_CACHE_SCHEMA/u);
  assert.match(progressionLoader, /matchProgressionCacheKey/u);

  const retryBranch = sourceSlice(
    source,
    "this.data.activeTab === 'progression_path'",
    '} else {'
  );
  assert.match(retryBranch, /loadProgression\(this\.data\.match, \{ force: true \}\)/u);
  assert.doesNotMatch(retryBranch, /\bloadMatch\s*\(/u);
});

test('match detail keeps trusted match projection visible when refresh fails', async () => {
  const definition = loadPageDefinition();
  const envelope = matchEnvelope();
  const wx = wxRuntime({
    [cacheStorageKey(`match_detail:${matchId}`)]: {
      resourceKey: `match_detail:${matchId}`,
      schemaVersion: 'match-detail-bff/1',
      projectionVersion: envelope.projectionVersion,
      cachedAt: Date.now(),
      dataAsOf: envelope.dataAsOf,
      etag: 'etag-match',
      payload: envelope
    }
  });
  const requests = [];
  const context = pageContext(definition, wx, {
    async request(path, options) {
      requests.push({ path, options });
      throw new Error('network_down');
    }
  });

  await definition.loadMatch.call(context);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.ifNoneMatch, 'etag-match');
  assert.equal(context.data.failed, false);
  assert.equal(context.data.loading, false);
  assert.equal(context.data.match.id, matchId);
});

test('match detail odds module reuses trusted cache on 304 without blocking shell', async () => {
  const definition = loadPageDefinition();
  const envelope = oddsEnvelope();
  const wx = wxRuntime({
    [cacheStorageKey(`match_odds:${matchId}`)]: {
      resourceKey: `match_odds:${matchId}`,
      schemaVersion: 'match-odds-bff/1',
      projectionVersion: envelope.projectionVersion,
      cachedAt: Date.now(),
      dataAsOf: envelope.dataAsOf,
      etag: 'etag-odds',
      payload: envelope
    }
  });
  const requests = [];
  const context = pageContext(definition, wx, {
    async request(path, options) {
      requests.push({ path, options });
      return { notModified: true, etag: 'etag-odds', data: null };
    }
  });
  context.currentMatchId = matchId;
  context.data.match = { id: matchId, sides: [{}, {}] };

  await definition.loadOdds.call(context, { id: matchId });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.ifNoneMatch, 'etag-odds');
  assert.equal(context.data.oddsLoadState, 'content');
  assert.equal(context.data.match.odds.first, '1.55');
});

test('match detail contracts validate independent odds and progression envelopes', () => {
  const contracts = readFileSync(
    resolve(miniRoot, 'core/contracts.js'),
    'utf8'
  );
  assert.match(contracts, /function oddsProjection/u);
  assert.match(contracts, /match-odds-bff\/1/u);
  assert.match(contracts, /function progressionProjection/u);
  assert.match(contracts, /match-progression-path-bff\/1/u);
});
