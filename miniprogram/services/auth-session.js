'use strict';

const config = require('../config');
const safeEvents = require('../core/safe-events');

const STORAGE_KEY = 'luwang_v2_user_session_v1';
const WECHAT_LOGIN_TIMEOUT_MILLISECONDS = 10_000;
const AUTH_STATES = Object.freeze([
  'ready', 'authenticating', 'refreshing', 'failed'
]);

function cleanStableIdentity(value) {
  const source = String(value || '').trim();
  if (!source || source.length > 160) return '';
  const lowered = source.toLowerCase();
  const blocked = ['session' + '_key', 'open' + 'id', 'union' + 'id', 'token'];
  if (blocked.some(item => lowered.includes(item))) return '';
  return source;
}

function stableAccountScope(value) {
  const source = cleanStableIdentity(value);
  if (!source) return '';
  let first = 2166136261;
  let second = 2166136261 ^ 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 16777619) >>> 0;
    second ^= code + index;
    second = Math.imul(second, 16777619) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function normalizeAccountScope(value) {
  const source = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{16}$/u.test(source) ? source : '';
}

function accountScopeFromBody(body) {
  const candidates = [
    body?.accountScope,
    body?.accountId,
    body?.userId,
    body?.viewerId,
    body?.subject,
    body?.sub,
    body?.account?.id,
    body?.user?.id,
    body?.profile?.accountId,
    body?.profile?.userId,
    body?.profile?.viewerId
  ];
  for (const candidate of candidates) {
    const existingScope = normalizeAccountScope(candidate);
    if (existingScope) return existingScope;
    const scope = stableAccountScope(candidate);
    if (scope) return scope;
  }
  return '';
}

class AuthSession {
  constructor(wxRuntime, request,
    loginTimeoutMilliseconds = WECHAT_LOGIN_TIMEOUT_MILLISECONDS) {
    this.wx = wxRuntime;
    this.request = request;
    this.listeners = new Set();
    this.pending = null;
    this.loginTimeoutMilliseconds = loginTimeoutMilliseconds;
    this.state = 'authenticating';
    this.session = this.readStored();
    if (this.isUsable(this.session)) this.state = 'ready';
  }

  readStored() {
    try {
      const candidate = this.wx.getStorageSync(STORAGE_KEY);
      if (!candidate || typeof candidate !== 'object') return null;
      if (!/^[0-9a-f]{64}$/.test(candidate.accessToken)
        || !Number.isFinite(Date.parse(candidate.expiresAt))) return null;
      return {
        accessToken: candidate.accessToken,
        expiresAt: candidate.expiresAt,
        accountScope: normalizeAccountScope(candidate.accountScope)
      };
    } catch {
      return null;
    }
  }

  isUsable(session) {
    return session !== null
      && Date.parse(session.expiresAt) - Date.now()
        > config.sessionRefreshSkewMilliseconds;
  }

  currentAccessToken() {
    return this.isUsable(this.session) ? this.session.accessToken : '';
  }

  currentAccountScope() {
    return this.isUsable(this.session) ? normalizeAccountScope(this.session.accountScope) : '';
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  setState(next) {
    if (!AUTH_STATES.includes(next)) throw new Error('auth state invalid');
    this.state = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  async ensure() {
    if (this.isUsable(this.session)) return this.session.accessToken;
    return this.refresh(this.session !== null);
  }

  async refresh(preserveContent = true) {
    if (this.pending !== null) return this.pending;
    this.setState(preserveContent ? 'refreshing' : 'authenticating');
    this.pending = this.login().then(session => {
      this.session = session;
      this.wx.setStorageSync(STORAGE_KEY, {
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        ...(session.accountScope ? { accountScope: session.accountScope } : {})
      });
      this.setState('ready');
      safeEvents.emit('wechat_login_succeeded');
      return session.accessToken;
    }).catch(error => {
      this.session = null;
      try { this.wx.removeStorageSync(STORAGE_KEY); } catch { /* bounded */ }
      this.setState('failed');
      safeEvents.emit('wechat_login_failed');
      throw error;
    }).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  invalidate() {
    this.session = null;
    try { this.wx.removeStorageSync(STORAGE_KEY); } catch { /* bounded */ }
  }

  async login() {
    const code = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = callback => value => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };
      const timeout = setTimeout(
        finish(reject),
        this.loginTimeoutMilliseconds,
        new Error('wechat_login_timeout')
      );
      this.wx.login({
        success: result => result && typeof result.code === 'string'
          ? finish(resolve)(result.code)
          : finish(reject)(new Error('wechat_login_code_missing')),
        fail: () => finish(reject)(new Error('wechat_login_unavailable'))
      });
    });
    const response = await this.request({
      url: `${config.bffBaseUrl}/api/v1/auth/wechat/login`,
      method: 'POST',
      timeout: this.loginTimeoutMilliseconds,
      header: {
        'content-type': 'application/json',
        'x-luwang-client-contract-version': config.clientContractVersion
      },
      data: { code }
    });
    if (response.statusCode !== 200) {
      throw new Error(response.statusCode === 401
        ? 'wechat_login_rejected'
        : 'wechat_login_bff_unavailable');
    }
    const body = response.data;
    if (!body || body.contractVersion !== 'score-bff/2'
      || !/^[0-9a-f]{64}$/.test(body.accessToken)
      || !Number.isFinite(Date.parse(body.expiresAt))) {
      throw new Error('wechat_login_response_invalid');
    }
    return {
      accessToken: body.accessToken,
      expiresAt: body.expiresAt,
      accountScope: accountScopeFromBody(body)
    };
  }
}

module.exports = Object.freeze({
  AuthSession,
  AUTH_STATES,
  stableAccountScope,
  normalizeAccountScope,
  accountScopeFromBody
});
