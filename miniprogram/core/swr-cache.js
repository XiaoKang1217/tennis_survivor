'use strict';

const INDEX_KEY = 'luwang_swr_index_v1';
const ENTRY_PREFIX = 'luwang_swr_entry_v1:';
const DEFAULT_MAX_ENTRIES = 72;
const DEFAULT_MAX_TOTAL_BYTES = 7 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 900 * 1024;
const WRITE_THROTTLE_MS = 120;

const instances = new WeakMap();

function stableKey(resourceKey) {
  return ENTRY_PREFIX + encodeURIComponent(String(resourceKey || 'unknown'));
}

function byteSize(value) {
  try {
    const text = JSON.stringify(value);
    return typeof TextEncoder === 'function'
      ? new TextEncoder().encode(text).length
      : unescape(encodeURIComponent(text)).length;
  } catch { return Number.POSITIVE_INFINITY; }
}

function nowMs() { return Date.now(); }

function normalizeEntry(entry, resourceKey, schemaVersion) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.resourceKey !== resourceKey) return null;
  if (schemaVersion && entry.schemaVersion !== schemaVersion) return null;
  if (!entry.payload || typeof entry.payload !== 'object') return null;
  const cachedAt = Number(entry.cachedAt);
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) return null;
  return entry;
}

class SwrCache {
  constructor(wxRuntime, options = {}) {
    this.wx = wxRuntime;
    this.maxEntries = options.maxEntries || DEFAULT_MAX_ENTRIES;
    this.maxTotalBytes = options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES;
    this.maxEntryBytes = options.maxEntryBytes || DEFAULT_MAX_ENTRY_BYTES;
    this.pendingWrites = new Map();
    this.flushTimer = null;
    this.indexLoaded = false;
    this.index = [];
  }

  sanitizeIndex(value) {
    return value && typeof value === 'object' && Array.isArray(value.items)
      ? value.items.filter(item =>
        item
        && typeof item.resourceKey === 'string'
        && typeof item.key === 'string'
        && item.key === stableKey(item.resourceKey))
        .map(item => ({
          resourceKey: item.resourceKey,
          key: item.key,
          size: Number.isFinite(Number(item.size)) ? Math.max(0, Number(item.size)) : 0,
          touchedAt: Number.isFinite(Number(item.touchedAt)) ? Number(item.touchedAt) : 0
        }))
      : null;
  }

  loadIndex() {
    if (this.indexLoaded) return this.index;
    try {
      const value = this.wx.getStorageSync(INDEX_KEY);
      const items = this.sanitizeIndex(value);
      if (items === null && value !== undefined && value !== null) {
        try { this.wx.removeStorageSync?.(INDEX_KEY); } catch { /* best effort */ }
      }
      this.index = items || [];
    } catch {
      this.index = [];
    }
    this.indexLoaded = true;
    return this.index;
  }

  getIndex() {
    return this.loadIndex().map(item => ({ ...item }));
  }

  setIndex(items) {
    this.index = this.sanitizeIndex({ items }) || [];
    this.indexLoaded = true;
    this.scheduleRawWrite(INDEX_KEY, { items: this.index });
  }

  pendingEntry(key, resourceKey, schemaVersion) {
    if (!this.pendingWrites.has(key)) return null;
    return normalizeEntry(this.pendingWrites.get(key), resourceKey, schemaVersion);
  }

  storedEntry(key, resourceKey, schemaVersion) {
    return normalizeEntry(this.wx.getStorageSync(key), resourceKey, schemaVersion);
  }

  read(resourceKey, schemaVersion = '') {
    const key = stableKey(resourceKey);
    try {
      const entry = this.pendingEntry(key, resourceKey, schemaVersion)
        || this.storedEntry(key, resourceKey, schemaVersion);
      if (!entry) {
        this.remove(resourceKey);
        return null;
      }
      this.touch(resourceKey, key, byteSize(entry));
      return entry;
    } catch {
      this.remove(resourceKey);
      return null;
    }
  }

  write(resourceKey, options = {}) {
    if (!resourceKey || !options.payload || typeof options.payload !== 'object') return false;
    const entry = {
      resourceKey,
      schemaVersion: String(options.schemaVersion || ''),
      projectionVersion: Number.isFinite(Number(options.projectionVersion))
        ? Number(options.projectionVersion) : 0,
      cachedAt: nowMs(),
      dataAsOf: String(options.dataAsOf || ''),
      etag: String(options.etag || ''),
      payload: options.payload
    };
    const size = byteSize(entry);
    if (!Number.isFinite(size) || size > this.maxEntryBytes) return false;
    const key = stableKey(resourceKey);
    const existing = this.pendingEntry(key, resourceKey, entry.schemaVersion)
      || this.storedEntry(key, resourceKey, entry.schemaVersion);
    if (existing && Number(existing.projectionVersion || 0) > entry.projectionVersion) {
      this.touch(resourceKey, key, byteSize(existing));
      return false;
    }
    this.scheduleRawWrite(key, entry);
    this.touch(resourceKey, key, size);
    this.evict();
    return true;
  }

  remove(resourceKey) {
    const key = stableKey(resourceKey);
    this.pendingWrites.delete(key);
    try { this.wx.removeStorage?.({ key }); } catch { /* best effort */ }
    try { this.wx.removeStorageSync?.(key); } catch { /* best effort */ }
    this.setIndex(this.getIndex().filter(item => item.resourceKey !== resourceKey));
  }

  touch(resourceKey, key, size) {
    const items = this.getIndex().filter(item => item.resourceKey !== resourceKey);
    items.unshift({ resourceKey, key, size: Number(size) || 0, touchedAt: nowMs() });
    this.setIndex(items);
  }

  evict() {
    const items = this.getIndex();
    let total = 0;
    const keep = [];
    const drop = [];
    for (const item of items) {
      total += Number(item.size) || 0;
      if (keep.length < this.maxEntries && total <= this.maxTotalBytes) keep.push(item);
      else drop.push(item);
    }
    for (const item of drop) {
      this.pendingWrites.delete(item.key);
      try { this.wx.removeStorage?.({ key: item.key }); } catch { /* best effort */ }
      try { this.wx.removeStorageSync?.(item.key); } catch { /* best effort */ }
    }
    if (drop.length > 0) this.setIndex(keep);
  }

  scheduleRawWrite(key, value) {
    this.pendingWrites.set(key, value);
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => this.flush(), WRITE_THROTTLE_MS);
  }

  flush() {
    const writes = [...this.pendingWrites.entries()];
    this.pendingWrites.clear();
    this.flushTimer = null;
    for (const [key, value] of writes) {
      try {
        if (typeof this.wx.setStorage === 'function') this.wx.setStorage({ key, data: value });
        else this.wx.setStorageSync(key, value);
      } catch { /* cache is best effort */ }
    }
  }

  requestOptions(resourceKey, schemaVersion = '') {
    const entry = this.read(resourceKey, schemaVersion);
    return {
      entry,
      request: entry?.etag ? { ifNoneMatch: entry.etag } : {}
    };
  }
}

function createSWRCache(wxRuntime, options = {}) {
  if (!wxRuntime || typeof wxRuntime !== 'object') {
    return {
      read() { return null; },
      write() { return false; },
      remove() {},
      requestOptions() { return { entry: null, request: {} }; }
    };
  }
  if (!instances.has(wxRuntime)) instances.set(wxRuntime, new SwrCache(wxRuntime, options));
  return instances.get(wxRuntime);
}

module.exports = Object.freeze({ createSWRCache, SwrCache });
