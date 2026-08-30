'use strict';

const { createSWRCache } = require('../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../core/projection-resource');
const {
  ENTRY_INDEX_CACHE_SCHEMA,
  ENTRY_SUMMARY_CACHE_SCHEMA,
  ENTRY_PLAYER_PAGE_SCHEMA,
  validateEntrySummary,
  validateEntryPlayerPage
} = require('../core/entry-index');

const TOURNAMENT_SCHEMA = 'entry-tournament/2';

class EntryService {
  constructor(wxRuntime, http) {
    this.http = http;
    this.cache = createSWRCache(wxRuntime);
    this.inflight = new Map();
  }
  cached(resourceKey, schemaVersion) {
    return readTrustedProjection(this.cache, resourceKey, schemaVersion)?.payload || null;
  }
  cachedLegacyIndex() { return this.cached('entries:index', ENTRY_INDEX_CACHE_SCHEMA); }
  cachedIndex() {
    return this.cached('entries:summary', ENTRY_SUMMARY_CACHE_SCHEMA) || this.cachedLegacyIndex();
  }
  cachedTournament(tournamentId) {
    return this.cached(`entries:tournament:${tournamentId}`, TOURNAMENT_SCHEMA);
  }
  async resource(resourceKey, schemaVersion, path, force = false) {
    try {
      return (await loadProjectionResource({
        http: this.http, cache: this.cache, resourceKey, schemaVersion, path, force
      })).value;
    } catch (error) {
      const cached = this.cached(resourceKey, schemaVersion);
      if (cached) return { ...cached, delivery: { ...(cached.delivery || {}), state: 'stale' } };
      throw error;
    }
  }
  async index(options = {}) {
    try {
      return (await loadProjectionResource({
        http: this.http,
        cache: this.cache,
        resourceKey: 'entries:summary',
        schemaVersion: ENTRY_SUMMARY_CACHE_SCHEMA,
        path: '/api/v1/bff/entries',
        force: options.force === true,
        validate: validateEntrySummary
      })).value;
    } catch (error) {
      const cached = this.cachedIndex();
      if (cached) return { ...cached, delivery: { ...(cached.delivery || {}), state: 'stale' } };
      throw error;
    }
  }
  playerPage(options = {}) {
    const tour = options.tour === 'WTA' ? 'WTA' : 'ATP';
    const limit = 50;
    const page = Math.max(1, Number(options.page) || 1);
    const offset = (page - 1) * limit;
    const query = String(options.query || '').trim();
    const key = `entries:players:${tour}:${query}:${page}`;
    const path = `/api/v1/bff/entries/players?tour=${encodeURIComponent(tour)}`
      + `&q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`;
    return this.resource(key, ENTRY_PLAYER_PAGE_SCHEMA, path, options.force === true)
      .then(validateEntryPlayerPage);
  }
  async tournament(tournamentId) {
    const id = String(tournamentId || '').trim();
    if (!id) throw new Error('entry_tournament_id_missing');
    const key = `entries:tournament:${id}`;
    if (this.inflight.has(key)) return await this.inflight.get(key);
    const task = this.resource(key, TOURNAMENT_SCHEMA,
      `/api/v1/bff/entries/tournaments/${encodeURIComponent(id)}`)
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return await task;
  }
  async player(playerId) {
    return await this.http.request(`/api/v1/bff/entries/players/${encodeURIComponent(playerId)}`, { authMode: 'none' });
  }
}

module.exports = Object.freeze({ EntryService });
