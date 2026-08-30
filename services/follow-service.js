'use strict';

const { createIdempotencyKey } = require('./http-client');
const { normalizeAccountScope } = require('./auth-session');

const FOLLOW_RETRY_DELAYS_MS = Object.freeze([350, 900]);
const FOLLOW_STATUS_BATCH_SIZE = 32;

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function retryableFollowError(error) {
  const message = String(error?.message || error?.code || '');
  return error?.retryable === true
    || error?.statusCode === 408
    || error?.statusCode === 429
    || Number(error?.statusCode) >= 500
    || /network_request_(?:failed|timeout)/u.test(message);
}

function followingPath(options = {}) {
  const kind = ['all', 'player', 'match', 'tournament']
    .includes(String(options.kind || options.filter || '').trim())
    ? String(options.kind || options.filter).trim()
    : 'all';
  const limit = Number.isSafeInteger(Number(options.limit))
    ? Math.max(1, Math.min(50, Number(options.limit))) : 20;
  const offset = Number.isSafeInteger(Number(options.offset))
    ? Math.max(0, Number(options.offset)) : 0;
  const status = ['upcoming', 'live', 'ended'].includes(String(options.status || '').trim())
    ? String(options.status).trim() : '';
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(String(options.date || '').trim())
    ? String(options.date).trim() : '';
  return '/api/v1/bff/following'
    + `?filter=${encodeURIComponent(kind)}`
    + `&status=${encodeURIComponent(status)}`
    + `&date=${encodeURIComponent(date)}`
    + `&limit=${encodeURIComponent(String(limit))}`
    + `&offset=${encodeURIComponent(String(offset))}`;
}

function leaderboardPath(options = {}) {
  const tour = ['all', 'ATP', 'WTA'].includes(String(options.tour || '').trim())
    ? String(options.tour).trim()
    : 'all';
  const limit = Number.isSafeInteger(Number(options.limit))
    ? Math.max(1, Math.min(100, Number(options.limit))) : 20;
  const offset = Number.isSafeInteger(Number(options.offset))
    ? Math.max(0, Number(options.offset)) : 0;
  const query = String(options.query || '').trim().slice(0, 80);
  return '/api/v1/bff/following/leaderboard'
    + `?tour=${encodeURIComponent(tour)}`
    + `&q=${encodeURIComponent(query)}`
    + `&limit=${encodeURIComponent(String(limit))}`
    + `&offset=${encodeURIComponent(String(offset))}`;
}

class FollowService {
  constructor(wxRuntime, auth, http, account, store = null) {
    this.wx = wxRuntime;
    this.auth = auth;
    this.http = http;
    this.account = account;
    this.store = store;
  }

  activeProfileGate() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const page = pages.length ? pages[pages.length - 1] : null;
    return page && typeof page.selectComponent === 'function'
      ? page.selectComponent('#profileGate') : null;
  }

  async ensureProfileReady(sourceEntry = '') {
    await this.auth.ensure();
    if (this.account?.isComplete?.()) return true;
    const gate = this.activeProfileGate();
    if (!gate || typeof gate.collect !== 'function') {
      this.wx.showToast({ title: '请先登录', icon: 'none' });
      throw new Error('follow_profile_required');
    }
    const completed = await gate.collect({ sourceEntry, mode: 'login' });
    if (!completed) throw new Error('follow_login_cancelled');
    return true;
  }

  async requestWithRetry(factory) {
    let lastError = null;
    for (let attempt = 0; attempt <= FOLLOW_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await factory();
      } catch (error) {
        lastError = error;
        if (!retryableFollowError(error) || attempt >= FOLLOW_RETRY_DELAYS_MS.length) {
          throw error;
        }
        await sleep(FOLLOW_RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError || new Error('network_request_failed');
  }

  async setFollow(targetKind, targetId, followed, sourceEntry = '', snapshot = null, profileRetry = false) {
    const kind = String(targetKind || '').trim();
    const id = String(targetId || '').trim();
    if (!kind || !id) throw new Error('follow_target_missing');
    let rollback = () => undefined;
    try {
    if (followed) await this.ensureProfileReady(sourceEntry);
    else if (!this.auth.currentAccessToken()) await this.auth.ensure();
    rollback = this.store?.optimistic?.(kind, id, followed) || rollback;
    if (followed) {
      const data = { targetKind: kind, targetId: id, sourceEntry };
      if (snapshot && typeof snapshot === 'object') data.snapshot = snapshot;
      const idempotencyKey = createIdempotencyKey(`follow:${kind}:${id}`);
      const result = await this.requestWithRetry(() => this.http.request('/api/v1/me/follows', {
        method: 'POST',
        data,
        header: {
          'content-type': 'application/json',
          'x-idempotency-key': idempotencyKey
        },
        authRequired: true
      }));
      this.store?.set?.(kind, id, true);
      return result;
    }
    const idempotencyKey = createIdempotencyKey(`unfollow:${kind}:${id}`);
    const result = await this.requestWithRetry(() => this.http.request(
      `/api/v1/me/follows/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        header: { 'x-idempotency-key': idempotencyKey },
        authRequired: true
      }
    ));
    this.store?.set?.(kind, id, false);
    return result;
    } catch (error) {
      rollback();
      if (followed && !profileRetry && /profile_required/u.test(String(error?.message || ''))) {
        const gate = this.activeProfileGate();
        const completed = await gate?.collect?.({ sourceEntry, mode: 'login' });
        if (completed) return await this.setFollow(
          targetKind, targetId, followed, sourceEntry, snapshot, true
        );
      }
      throw error;
    }
  }

  async following(options = {}) {
    return await this.http.request(followingPath(options), {
      header: { 'x-luwang-client-contract-version': 'follow-context-bff/1' },
      authRequired: true
    });
  }

  async followedTargets(targets = []) {
    const requested = [];
    const seen = new Set();
    for (const target of targets) {
      const kind = String(target?.kind || target?.targetKind || '').trim().toLowerCase();
      const targetId = String(target?.targetId || target?.id || '').trim();
      if (!['match', 'player', 'tournament'].includes(kind) || !targetId) continue;
      const key = `${kind}:${targetId}`;
      if (!seen.has(key)) requested.push({ kind, targetId });
      seen.add(key);
    }
    if (!requested.length) return new Set();
    await this.auth.ensure();
    const requestScope = normalizeAccountScope(this.auth.currentAccountScope?.());
    const batches = [];
    for (let offset = 0; offset < requested.length; offset += FOLLOW_STATUS_BATCH_SIZE) {
      batches.push(requested.slice(offset, offset + FOLLOW_STATUS_BATCH_SIZE));
    }
    const responses = await Promise.all(batches.map(batch => this.http.request(
      '/api/v1/me/follows/status',
      {
        method: 'POST',
        data: { targets: batch },
        header: { 'content-type': 'application/json' },
        authRequired: true
      }
    )));
    const merged = new Map(requested.map(target => [
      `${target.kind}:${target.targetId}`,
      Object.freeze({ ...target, followed: false })
    ]));
    for (const response of responses) {
      for (const state of Array.isArray(response?.states) ? response.states : []) {
        const kind = String(state?.kind || '').trim().toLowerCase();
        const targetId = String(state?.targetId || '').trim();
        const key = `${kind}:${targetId}`;
        if (!merged.has(key) || typeof state?.followed !== 'boolean') continue;
        merged.set(key, Object.freeze({ kind, targetId, followed: state.followed }));
      }
    }
    if (normalizeAccountScope(this.auth.currentAccountScope?.()) !== requestScope) {
      throw new Error('follow_account_scope_changed');
    }
    const states = [...merged.values()];
    const commit = this.store?.setMany?.(states, { expectedScope: requestScope });
    if (commit && commit.applied === false) throw new Error('follow_account_scope_changed');
    const followed = new Set(states
      .filter(state => state.followed)
      .map(state => `${state.kind}:${state.targetId}`));
    return followed;
  }

  cachedStates(targets = []) {
    return this.store?.snapshot?.(targets) || new Map();
  }

  subscribe(listener) {
    return this.store?.subscribe?.(listener) || (() => undefined);
  }

  async leaderboard(options = {}) {
    return await this.http.request(leaderboardPath(options), {
      header: { 'x-luwang-client-contract-version': 'follow-leaderboard-bff/1' }
    });
  }
}

module.exports = Object.freeze({
  FollowService,
  FOLLOW_STATUS_BATCH_SIZE,
  followingPath,
  leaderboardPath
});
