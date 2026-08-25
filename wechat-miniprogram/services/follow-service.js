'use strict';

const { createIdempotencyKey } = require('./http-client');

const FOLLOW_RETRY_DELAYS_MS = Object.freeze([350, 900]);

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
  return '/api/v1/bff/following'
    + `?filter=${encodeURIComponent(kind)}`
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
  return '/api/v1/bff/following/leaderboard'
    + `?tour=${encodeURIComponent(tour)}`
    + `&limit=${encodeURIComponent(String(limit))}`
    + `&offset=${encodeURIComponent(String(offset))}`;
}

class FollowService {
  constructor(wxRuntime, auth, http, account) {
    this.wx = wxRuntime;
    this.auth = auth;
    this.http = http;
    this.account = account;
  }

  activeProfileGate() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const page = pages.length ? pages[pages.length - 1] : null;
    return page && typeof page.selectComponent === 'function'
      ? page.selectComponent('#profileGate') : null;
  }

  async ensureProfileReady(sourceEntry = '') {
    await this.auth.ensure();
    if (this.account?.isComplete?.()) {
      try {
        await this.account?.refresh?.();
      } catch { /* current token path will surface on the follow request */ }
      if (this.account?.isComplete?.()) return true;
    }
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

  async setFollow(targetKind, targetId, followed, sourceEntry = '', snapshot = null) {
    const kind = String(targetKind || '').trim();
    const id = String(targetId || '').trim();
    if (!kind || !id) throw new Error('follow_target_missing');
    if (followed) {
      await this.ensureProfileReady(sourceEntry);
    } else if (!this.auth.currentAccessToken()) {
      await this.auth.ensure();
    }
    if (followed) {
      const data = { targetKind: kind, targetId: id, sourceEntry };
      if (snapshot && typeof snapshot === 'object') data.snapshot = snapshot;
      const idempotencyKey = createIdempotencyKey(`follow:${kind}:${id}`);
      return await this.requestWithRetry(() => this.http.request('/api/v1/me/follows', {
        method: 'POST',
        data,
        header: {
          'content-type': 'application/json',
          'x-idempotency-key': idempotencyKey
        },
        authRequired: true
      }));
    }
    const idempotencyKey = createIdempotencyKey(`unfollow:${kind}:${id}`);
    return await this.requestWithRetry(() => this.http.request(
      `/api/v1/me/follows/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        header: { 'x-idempotency-key': idempotencyKey },
        authRequired: true
      }
    ));
  }

  async following(options = {}) {
    return await this.http.request(followingPath(options), {
      header: { 'x-luwang-client-contract-version': 'follow-context-bff/1' },
      authRequired: true
    });
  }

  async leaderboard(options = {}) {
    return await this.http.request(leaderboardPath(options), {
      header: { 'x-luwang-client-contract-version': 'follow-leaderboard-bff/1' }
    });
  }
}

module.exports = Object.freeze({
  FollowService,
  followingPath,
  leaderboardPath
});
