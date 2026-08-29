import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const miniRoot = resolve(import.meta.dirname, '..');
const read = relative => readFileSync(resolve(miniRoot, relative), 'utf8');
const { leaderboardPath } = require('../services/follow-service');
const { SocialService } = require('../services/social-service');

test('follow leaderboard request carries full-list query and 50-entry page offsets', () => {
  const path = leaderboardPath({
    tour: 'WTA', query: '郑钦文 Qinwen', limit: 50, offset: 100
  });
  assert.equal(path,
    '/api/v1/bff/following/leaderboard?tour=WTA&q=%E9%83%91%E9%92%A6%E6%96%87%20Qinwen&limit=50&offset=100');
});

test('both flower leaderboard kinds carry scope, full-list query and page offset', async () => {
  const requests = [];
  const service = new SocialService({}, {}, {
    async request(path, options) {
      requests.push({ path, options });
      return { payload: { entries: [] } };
    }
  }, {});
  await service.flowerLeaderboard('players', 'ATP', {
    query: '辛纳 Sinner', limit: 50, offset: 50
  });
  await service.flowerLeaderboard('fans', 'WTA', {
    query: 'Candice', limit: 50, offset: 100
  });
  assert.equal(requests[0].path,
    '/api/v1/bff/social/leaderboards/flowers/players?scope=ATP&q=%E8%BE%9B%E7%BA%B3%20Sinner&limit=50&offset=50');
  assert.equal(requests[1].path,
    '/api/v1/bff/social/leaderboards/flowers/fans?scope=WTA&q=Candice&limit=50&offset=100');
  assert.deepEqual(requests.map(request => request.options.authMode), ['none', 'none']);
});

test('players page uses explicit leaderboard pages and server-side search', () => {
  const script = read('packages/player/pages/players/index.js');
  const markup = read('packages/player/pages/players/index.wxml');
  assert.match(script, /pageSize:\s*50/u);
  assert.match(script, /previousLeaderboardPage/u);
  assert.match(script, /nextLeaderboardPage/u);
  assert.match(script, /\{ query, limit: pageSize, offset \}/u);
  assert.match(script, /query\s*\n\s*\}\);/u);
  assert.match(script, /\['ranking', 'flowers', 'follows'\]\.includes/u);
  assert.match(script, /section === 'flowers' \|\| this\.data\.section === 'follows'/u);
  assert.match(markup, /section === 'ranking' \|\| section === 'follows' \|\| section === 'flowers'/u);
  assert.equal((markup.match(/bindtap="previousLeaderboardPage"/gu) || []).length, 2);
  assert.equal((markup.match(/bindtap="nextLeaderboardPage"/gu) || []).length, 2);
  assert.equal((markup.match(/第 \{\{leaderboardPage\}\} 页/gu) || []).length, 2);
});

test('source and miniprogram mirrors stay identical for leaderboard files', () => {
  for (const relative of [
    'packages/player/pages/players/index.js',
    'packages/player/pages/players/index.wxml',
    'packages/player/pages/players/index.wxss',
    'services/follow-service.js',
    'services/social-service.js'
  ]) {
    assert.equal(read(relative), read(`miniprogram/${relative}`), relative);
  }
});
