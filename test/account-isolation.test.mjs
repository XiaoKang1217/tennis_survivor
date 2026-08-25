import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  AccountService,
  LEGACY_PROFILE_STORAGE_KEY,
  profileStorageKey
} = require('../miniprogram/services/account-service');
const { stableAccountScope } = require('../miniprogram/services/auth-session');

function wxRuntime(seed = {}) {
  const storage = new Map(Object.entries(seed));
  return {
    storage,
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
    getFileSystemManager() { return null; }
  };
}

function authSession(initialScope) {
  let scope = initialScope;
  let token = 'a'.repeat(64);
  return {
    currentAccountScope() { return scope; },
    currentAccessToken() { return token; },
    async ensure() { return token; },
    rotateToken(next = 'b'.repeat(64)) { token = next; },
    switchScope(nextScope) { scope = nextScope; },
    invalidate() { scope = ''; token = ''; }
  };
}

function completeProfile(scope, nickname) {
  return {
    accountScope: scope,
    nickname,
    avatarUrl: `https://cdn.tennisapi.online/avatar/${nickname}.jpg`,
    updatedAt: '2026-08-25T10:00:00.000Z'
  };
}

test('account profile cache for A is not displayed to B', () => {
  const scopeA = stableAccountScope('account-a');
  const scopeB = stableAccountScope('account-b');
  const wx = wxRuntime({
    [profileStorageKey(scopeA)]: completeProfile(scopeA, 'A用户')
  });
  const auth = authSession(scopeB);
  const account = new AccountService(wx, auth, { async request() { return {}; } });

  assert.equal(account.currentProfile().completed, false);

  auth.switchScope(scopeA);
  assert.equal(account.currentProfile().nickname, 'A用户');
  assert.equal(account.currentProfile().completed, true);
});

test('token renewal keeps using the same stable account profile scope', () => {
  const scope = stableAccountScope('account-stable');
  const wx = wxRuntime();
  const auth = authSession(scope);
  const account = new AccountService(wx, auth, { async request() { return {}; } });

  account.writeStored(completeProfile(scope, '同一账号'));
  auth.rotateToken('c'.repeat(64));

  assert.equal(auth.currentAccessToken(), 'c'.repeat(64));
  assert.equal(account.currentProfile().nickname, '同一账号');
  assert.equal(wx.storage.has(profileStorageKey(scope)), true);
});

test('account service does not show historical private profile without current identity', () => {
  const scope = stableAccountScope('account-history');
  const wx = wxRuntime({
    [profileStorageKey(scope)]: completeProfile(scope, '历史用户')
  });
  const account = new AccountService(
    wx,
    authSession(''),
    { async request() { return {}; } }
  );

  assert.equal(account.currentProfile().completed, false);
  assert.equal(account.currentProfile().nickname, '');
});

test('logout clears the current private profile cache and legacy global cache', () => {
  const scope = stableAccountScope('account-logout');
  const wx = wxRuntime({
    [profileStorageKey(scope)]: completeProfile(scope, '退出用户'),
    [LEGACY_PROFILE_STORAGE_KEY]: completeProfile(scope, '旧缓存')
  });
  const auth = authSession(scope);
  const account = new AccountService(wx, auth, { async request() { return {}; } });

  assert.equal(account.currentProfile().completed, true);
  account.logout();

  assert.equal(account.currentProfile().completed, false);
  assert.equal(auth.currentAccountScope(), '');
  assert.equal(wx.storage.has(profileStorageKey(scope)), false);
  assert.equal(wx.storage.has(LEGACY_PROFILE_STORAGE_KEY), false);
});
