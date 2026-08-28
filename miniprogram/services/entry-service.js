'use strict';

const { createSWRCache } = require('../core/swr-cache');
const { loadProjectionResource, readTrustedProjection } = require('../core/projection-resource');

const INDEX_SCHEMA = 'entry-index/2';
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
  cachedIndex() { return this.cached('entries:index', INDEX_SCHEMA); }
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
    return await this.resource('entries:index', INDEX_SCHEMA, '/api/v1/bff/entries', options.force === true);
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
