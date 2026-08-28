'use strict';

const { normalizeAccountScope } = require('./auth-session');

const STORAGE_PREFIX = 'luwang_v2_follow_store_v1:';
const SCHEMA_VERSION = 1;
const UNKNOWN = 'unknown';
const FOLLOWED = 'followed';
const NOT_FOLLOWED = 'not_followed';

function targetKey(kind, targetId) {
  const normalizedKind = String(kind || '').trim().toLowerCase();
  const id = String(targetId || '').trim();
  return ['match', 'player', 'tournament'].includes(normalizedKind) && id
    ? `${normalizedKind}:${id}` : '';
}

class FollowStore {
  constructor(wxRuntime, auth) {
    this.wx = wxRuntime;
    this.auth = auth;
    this.scope = '';
    this.values = new Map();
    this.listeners = new Set();
  }

  currentScope() {
    return normalizeAccountScope(this.auth?.currentAccountScope?.());
  }

  ensureScope() {
    const scope = this.currentScope();
    if (scope === this.scope) return scope;
    this.scope = scope;
    this.values = new Map();
    if (!scope) return scope;
    try {
      const cached = this.wx.getStorageSync(`${STORAGE_PREFIX}${scope}`);
      if (cached?.version !== SCHEMA_VERSION || cached?.scope !== scope
        || !cached.states || typeof cached.states !== 'object') return scope;
      for (const [key, value] of Object.entries(cached.states).slice(0, 2000)) {
        if (value === FOLLOWED || value === NOT_FOLLOWED) this.values.set(key, value);
      }
    } catch { /* corrupt account cache is safely discarded */ }
    return scope;
  }

  persist() {
    const scope = this.ensureScope();
    if (!scope) return;
    try {
      this.wx.setStorageSync(`${STORAGE_PREFIX}${scope}`, {
        version: SCHEMA_VERSION,
        scope,
        states: Object.fromEntries([...this.values.entries()].slice(-2000))
      });
    } catch { /* bounded cache only */ }
  }

  get(kind, targetId) {
    this.ensureScope();
    const key = targetKey(kind, targetId);
    return key ? this.values.get(key) || UNKNOWN : UNKNOWN;
  }

  snapshot(targets = []) {
    const result = new Map();
    for (const target of targets) {
      const kind = target?.kind || target?.targetKind;
      const targetId = target?.targetId || target?.id;
      const key = targetKey(kind, targetId);
      if (key) result.set(key, this.get(kind, targetId));
    }
    return result;
  }

  set(kind, targetId, followed, options = {}) {
    this.ensureScope();
    const key = targetKey(kind, targetId);
    if (!key) return UNKNOWN;
    const value = followed === true ? FOLLOWED
      : followed === false ? NOT_FOLLOWED : UNKNOWN;
    if (value === UNKNOWN) this.values.delete(key);
    else this.values.set(key, value);
    if (options.persist !== false) this.persist();
    for (const listener of [...this.listeners]) listener({ key, value, scope: this.scope });
    return value;
  }

  optimistic(kind, targetId, followed) {
    const previous = this.get(kind, targetId);
    this.set(kind, targetId, followed);
    return () => {
      if (previous === UNKNOWN) this.set(kind, targetId, null);
      else this.set(kind, targetId, previous === FOLLOWED);
    };
  }

  clearCurrent() {
    const scope = this.ensureScope();
    try { if (scope) this.wx.removeStorageSync?.(`${STORAGE_PREFIX}${scope}`); } catch { /* bounded */ }
    this.values = new Map();
    this.scope = '';
    for (const listener of [...this.listeners]) listener({ reset: true, scope });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

module.exports = Object.freeze({
  FollowStore,
  targetKey,
  UNKNOWN,
  FOLLOWED,
  NOT_FOLLOWED
});
