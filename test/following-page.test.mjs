import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const miniRoot = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { createSWRCache } = require('../core/swr-cache');
const { FollowService } = require('../services/follow-service');
const read = relative => readFileSync(resolve(miniRoot, relative), 'utf8');

function cacheStorageKey(resourceKey) {
  return 'luwang_swr_entry_v1:' + encodeURIComponent(resourceKey);
}

function tokenScope(token) {
  const source = String(token || '');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function available(value) {
  return { state: 'available', value, reasonCode: null, message: null };
}

function followingProjection() {
  return {
    bffContractVersion: 'follow-context-bff/1',
    projectionVersion: 6,
    dataAsOf: '2026-08-25T01:20:00.000Z',
    delivery: { state: 'current', message: '关注已更新', dataAsOf: '2026-08-25T01:20:00.000Z' },
    payload: {
      counts: { total: 1, players: 1, matches: 0, tournaments: 0 },
      page: { nextOffset: 1, hasMore: false },
      pageEntries: [{
        targetKind: 'player',
        targetId: 'ATP:1001',
        sortDate: '2026-08-25',
        followedAt: '2026-08-25T01:00:00.000Z'
      }],
      players: [{
        targetId: 'ATP:1001',
        authority: 'ATP',
        sourcePlayerId: '1001',
        displayName: available('扬尼克·辛纳'),
        displayNameOriginal: available('Jannik Sinner'),
        countryCode: available('ITA'),
        officialRanking: { position: 1 },
        raceRanking: { position: 2 },
        personal: { age: available(25) },
        movement: available(0),
        season: { titles: available(3) },
        followCount: 18,
        careerPerformance: { recentEvents: [] }
      }]
    }
  };
}

function loadPageDefinition() {
  const pagePath = require.resolve('../pages/following/index');
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

function pageContext(definition, wx, services) {
  return {
    ...definition,
    services,
    cache: createSWRCache(wx),
    matchDates: new Map(),
    data: structuredClone(definition.data),
    setData(update, callback) {
      Object.assign(this.data, update);
      if (typeof callback === 'function') callback.call(this);
    }
  };
}

test('following page exposes category tabs, badge cards, match date filter and 10-item pagination', () => {
  const markup = read('pages/following/index.wxml');
  assert.match(markup, />我的关注</u);
  assert.doesNotMatch(markup, /我的比赛/u);
  const script = read('pages/following/index.js');
  for (const label of ['全部关注', '球员', '比赛', '赛事']) {
    assert.match(markup, new RegExp(label));
  }
  assert.match(markup, /player-badge/);
  assert.match(markup, /mode="date"/);
  assert.match(markup, /bindchange="selectMatchDate"/);
  assert.match(markup, /bindtap="previousPage"/);
  assert.match(markup, /bindtap="nextPage"/);
  assert.match(markup, /每页 10 条/);
  assert.match(script, /DISPLAY_PAGE_SIZE = 10/);
  assert.match(script, /API_PAGE_SIZE = 50/);
  assert.match(script, /matchDateFilteredItems/);
  assert.match(script, /paginatedFeed/);
  assert.match(script, /offset/);
  assert.match(script, /hasMore/);
  assert.match(script, /FOLLOWING_CACHE_SCHEMA/);
  assert.match(script, /currentCacheScope/);
});

test('detail pages resolve current account follow state across paginated following results', async () => {
  const requests = [];
  const service = new FollowService({}, {}, {
    async request(path) {
      requests.push(path);
      const offset = Number(new URL(`https://local${path}`).searchParams.get('offset'));
      return {
        payload: {
          pageEntries: offset === 0
            ? [{ targetKind: 'player', targetId: 'ATP:other' }]
            : [{ targetKind: 'player', targetId: 'ATP:1001' }],
          page: { nextOffset: offset === 0 ? 50 : null }
        }
      };
    }
  });
  const followed = await service.followedTargets([
    { kind: 'player', targetId: 'ATP:1001' },
    { kind: 'player', targetId: 'ATP:missing' }
  ]);
  assert.equal(followed.has('player:ATP:1001'), true);
  assert.equal(followed.has('player:ATP:missing'), false);
  assert.equal(requests.length, 2);
  assert.match(read('packages/player/pages/player-detail/index.wxml'), /followed \? '已关注' : '关注球员'/u);
  assert.match(read('pages/match-detail/index.js'), /refreshViewerFollowStates/u);
});

test('scores followed filter merges the current account follow list', () => {
  const script = read('pages/scores/index.js');
  assert.match(script, /refreshViewerFollowStates/u);
  assert.match(script, /this\.services\.follow\.followedTargets\(targets\)/u);
  assert.match(script, /this\.followedIds = new Set/u);
  assert.match(script, /selectedFilter === 'followed'/u);
  assert.match(script, /force: true/u);
});

test('following matches render by date feed instead of tournament court grouping', () => {
  const markup = read('pages/following/index.wxml');
  const script = read('pages/following/index.js');
  assert.match(markup, /dateGroups/);
  assert.match(markup, /wx:if="\{\{selectedKind === 'match'\}\}" class="follow-date-head"/u);
  assert.match(script, /`\$\{year\}年\$\{Number\(month\)\}月\$\{Number\(day\)\}日`/u);
  assert.match(script, /dateGroups\(feed\.pageItems, selectedKind === 'match'\)/u);
  assert.match(script, /id: 'all',[\s\S]*label: '',[\s\S]*countLabel: ''/u);
  assert.doesNotMatch(markup, /court\.matches/);
  assert.doesNotMatch(markup, /court\.name/);
  assert.doesNotMatch(markup, /wx:for-item="court"/);
});

test('following player badge prefers half-body media and keeps controls off the photo', () => {
  const markup = read('pages/following/index.wxml');
  const script = read('pages/following/index.js');
  assert.match(
    script,
    /portrait\(item\.heroImage,\s*'96',\s*authority\)[\s\S]*\|\| portrait\(item\.portrait,\s*'96',\s*authority\)/u
  );
  const photoBlocks = markup.match(/<view class="player-photo">[\s\S]*?<\/view>/g) || [];
  assert.equal(photoBlocks.length, 1);
  for (const block of photoBlocks) assert.doesNotMatch(block, /player-heart/);
  assert.equal((markup.match(/mode="aspectFit"/g) || []).length, 1);
  assert.equal((markup.match(/mode="aspectFill"/g) || []).length, 0);
});

test('following player badge shows titles, recent form and follower count', () => {
  const markup = read('pages/following/index.wxml');
  const script = read('pages/following/index.js');
  assert.match(markup, /seasonTitlesLabel/);
  assert.match(markup, /recentRecordLabel/);
  assert.match(markup, /followCountLabel/);
  assert.match(script, /recentRecordLabel/);
  const recentRecordSource = /function recentRecordLabel\(item\) \{[\s\S]*?\n\}/u.exec(script)?.[0] || '';
  assert.match(recentRecordSource, /careerPerformance\.recentEvents/);
  assert.doesNotMatch(recentRecordSource, /recentActivities/);
  assert.doesNotMatch(markup, /正手：/);
  assert.doesNotMatch(markup, /反手：/);
  assert.doesNotMatch(markup, /被关注记录/);
});

test('player follows leaderboard is wired to large cards and real pagination', () => {
  const markup = read('packages/player/pages/players/index.wxml');
  assert.match(markup, />资料与排名</u);
  assert.doesNotMatch(markup, /module-head-mark|球员资料与排名/u);
  const script = read('packages/player/pages/players/index.js');
  assert.match(script, /followTabs/);
  assert.match(script, /loadFollowLeaderboard/);
  assert.match(markup, /follow-leaderboard-list/);
  assert.match(markup, /leaderboard-card/);
  assert.match(markup, /followCountLabel/);
  assert.doesNotMatch(markup, /关注榜稍后接入/);
});

test('player ranking search queries full basic profile inventory', () => {
  const script = read('packages/player/pages/players/index.js');
  assert.match(script, /const useProfileSearch = Boolean\(searchQuery\);/);
  assert.match(script, /\/api\/v2\/bff\/player-basic-profiles\/\$\{encodeURIComponent\(authority\)\}/);
  assert.match(script, /useProfileSearch\s*\?\s*profileEntries\(value, authority, rankingKind\)/);
  assert.match(script, /Boolean\(value\?\.payload\?\.hasMore\)/);
});

test('match cards and match detail expose follower counts', () => {
  const cardMarkup = read('components/match-card/index.wxml');
  const detailMarkup = read('pages/match-detail/index.wxml');
  const viewModel = read('core/view-model.js');
  assert.match(cardMarkup, /match-follow-count/);
  assert.match(detailMarkup, /detail-follow-count/);
  assert.match(viewModel, /followCountLabel/);
});

test('following page keeps account-scoped trusted cache visible when refresh fails', async () => {
  const definition = loadPageDefinition();
  const token = 'a'.repeat(64);
  const scope = tokenScope(token);
  const projection = followingProjection();
  const wx = wxRuntime({
    [cacheStorageKey(`following:${scope}:player:50:0`)]: {
      resourceKey: `following:${scope}:player:50:0`,
      schemaVersion: 'follow-context-bff-cache/2',
      projectionVersion: projection.projectionVersion,
      cachedAt: Date.now(),
      dataAsOf: projection.dataAsOf,
      etag: 'etag-following',
      payload: projection
    }
  });
  const requests = [];
  let ensureCalls = 0;
  const context = pageContext(definition, wx, {
    auth: {
      currentAccessToken() { return token; },
      async ensure() { ensureCalls += 1; return token; }
    },
    account: { isComplete() { return true; } },
    http: {
      async request(path, options) {
        requests.push({ path, options });
        throw new Error('network_down');
      }
    }
  });
  context.data.selectedKind = 'player';

  await definition.load.call(context);

  assert.equal(ensureCalls, 0);
  assert.equal(requests[0].options.ifNoneMatch, 'etag-following');
  assert.equal(context.data.failed, false);
  assert.equal(context.data.count, 1);
  assert.equal(context.data.items[0].player.name, '扬尼克·辛纳');
  assert.equal(context.data.deliveryState, 'stale');
  assert.equal(context.data.deliveryMessage, '刷新暂未成功，已保留上次关注');
});

test('following page does not show cached user data without a current account scope', async () => {
  const definition = loadPageDefinition();
  const projection = followingProjection();
  const wx = wxRuntime({
    [cacheStorageKey('following:oldscope:all:50:0')]: {
      resourceKey: 'following:oldscope:all:50:0',
      schemaVersion: 'follow-context-bff-cache/2',
      projectionVersion: projection.projectionVersion,
      cachedAt: Date.now(),
      dataAsOf: projection.dataAsOf,
      etag: 'etag-old-user',
      payload: projection
    }
  });
  const context = pageContext(definition, wx, {
    auth: {
      currentAccessToken() { return ''; },
      async ensure() { throw new Error('login_required'); }
    },
    account: { isComplete() { return false; } },
    http: {
      async request() { throw new Error('must_not_request_without_auth'); }
    }
  });

  await definition.load.call(context);

  assert.equal(context.data.failed, false);
  assert.equal(context.data.authPrompt, true);
  assert.equal(context.data.items.length, 0);
  assert.equal(context.data.count, 0);
});
