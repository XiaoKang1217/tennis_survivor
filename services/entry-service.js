'use strict';

class EntryService {
  constructor(http) { this.http = http; }
  async index() { return await this.http.request('/api/v1/bff/entries', { authMode: 'none' }); }
  async tournament(tournamentId) {
    return await this.http.request(`/api/v1/bff/entries/tournaments/${encodeURIComponent(tournamentId)}`, { authMode: 'none' });
  }
  async player(playerId) {
    return await this.http.request(`/api/v1/bff/entries/players/${encodeURIComponent(playerId)}`, { authMode: 'none' });
  }
}

module.exports = Object.freeze({ EntryService });
