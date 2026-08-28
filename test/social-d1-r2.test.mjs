import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { FollowStore } = require('../services/follow-store');
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function runtime() {
  const storage = new Map();
  return {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key)
  };
}

test('SOCIAL-D1-R2 follow state is account scoped and survives token rotation', () => {
  let scope = 'aaaaaaaaaaaaaaaa';
  const store = new FollowStore(runtime(), { currentAccountScope: () => scope });
  store.set('player', 'ATP:1', true);
  assert.equal(store.get('player', 'ATP:1'), 'followed');
  scope = 'bbbbbbbbbbbbbbbb';
  assert.equal(store.get('player', 'ATP:1'), 'unknown');
  scope = 'aaaaaaaaaaaaaaaa';
  assert.equal(store.get('player', 'ATP:1'), 'followed');
});

test('SOCIAL-D1-R2 optimistic follow rollback restores the precise tri-state', () => {
  const store = new FollowStore(runtime(), { currentAccountScope: () => 'aaaaaaaaaaaaaaaa' });
  const rollbackUnknown = store.optimistic('match', 'm1', true);
  assert.equal(store.get('match', 'm1'), 'followed');
  rollbackUnknown();
  assert.equal(store.get('match', 'm1'), 'unknown');
  store.set('match', 'm1', false);
  const rollbackFalse = store.optimistic('match', 'm1', true);
  rollbackFalse();
  assert.equal(store.get('match', 'm1'), 'not_followed');
});

test('SOCIAL-D1-R2 uses one bounded status batch and no private follow scan', () => {
  const service = read('services/follow-service.js');
  assert.match(service, /\/api\/v1\/me\/follows\/status/u);
  assert.match(service, /method:\s*'POST'/u);
  assert.doesNotMatch(service, /following\(\{[\s\S]*limit:\s*50/u);
});

test('SOCIAL-D1-R2 social writes have no fixed profile refresh preflight', () => {
  const social = read('services/social-service.js');
  const follow = read('services/follow-service.js');
  assert.doesNotMatch(social, /account\.refresh/u);
  assert.doesNotMatch(follow, /account\.refresh/u);
  assert.match(social, /profile_required/u);
  assert.match(follow, /profile_required/u);
});

test('SOCIAL-D1-R2 detail first frame is neutral and resolves one batch', () => {
  const player = read('packages/player/pages/player-detail/index.wxml');
  const match = read('pages/match-detail/index.wxml');
  assert.match(player, /关注状态…/u);
  assert.match(match, /关注状态…|状态…/u);
  assert.match(read('pages/match-detail/index.js'), /followedTargets\(targets\)/u);
});

test('SOCIAL-D1-R2 bootstrap drives recent five ledger entries and persistent badge share', () => {
  const social = read('pages/social-center/index.js');
  const markup = read('pages/social-center/index.wxml');
  assert.match(social, /recentLedger/u);
  assert.match(social, /occurredDate/u);
  assert.match(markup, /open-type="share"/u);
  assert.doesNotMatch(social, /ledger\(\{\s*limit:\s*5/u);
});
