'use strict';

const { createIdempotencyKey } = require('./http-client');

class SocialService {
  constructor(wxRuntime, auth, http, account) {
    this.wx = wxRuntime;
    this.auth = auth;
    this.http = http;
    this.account = account;
  }

  activeProfileGate() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const page = pages.at?.(-1) || pages[pages.length - 1];
    return page?.selectComponent?.('#profileGate') || null;
  }

  async requireProfile(sourceEntry) {
    await this.auth.ensure();
    try { await this.account.refresh(); } catch { /* the requested write will surface auth/network */ }
    if (this.account.isComplete()) return true;
    const gate = this.activeProfileGate();
    if (!gate?.collect) throw new Error('profile_required');
    const completed = await gate.collect({ sourceEntry, mode: 'login' });
    if (!completed) throw new Error('profile_gate_cancelled');
    return true;
  }

  async bootstrap() {
    await this.auth.ensure();
    return await this.http.request('/api/v1/me/bootstrap', { authRequired: true });
  }

  async checkin() {
    await this.requireProfile('daily_checkin');
    return await this.http.request('/api/v1/me/checkins', {
      method: 'POST',
      data: {},
      header: {
        'content-type': 'application/json',
        'x-idempotency-key': createIdempotencyKey('daily-checkin')
      },
      authRequired: true
    });
  }

  async checkinCalendar(month) {
    await this.auth.ensure();
    return await this.http.request(`/api/v1/me/checkins/calendar?month=${encodeURIComponent(month)}`, {
      authRequired: true
    });
  }

  async ledger(options = {}) {
    await this.auth.ensure();
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 30));
    const offset = Math.max(0, Number(options.offset) || 0);
    const direction = ['income', 'expense'].includes(options.direction)
      ? options.direction : 'all';
    const from = /^\d{4}-\d{2}-\d{2}$/u.test(String(options.from || ''))
      ? String(options.from) : '';
    const to = /^\d{4}-\d{2}-\d{2}$/u.test(String(options.to || ''))
      ? String(options.to) : '';
    const query = [
      `limit=${limit}`,
      `offset=${offset}`,
      `direction=${encodeURIComponent(direction)}`,
      from ? `from=${encodeURIComponent(from)}` : '',
      to ? `to=${encodeURIComponent(to)}` : ''
    ].filter(Boolean).join('&');
    return await this.http.request(`/api/v1/me/flowers/ledger?${query}`, {
      authRequired: true
    });
  }

  async gift(playerId, amount, sourceEntry = '') {
    await this.requireProfile(sourceEntry || 'player_gift');
    return await this.http.request(`/api/v1/players/${encodeURIComponent(playerId)}/flowers`, {
      method: 'POST',
      data: { amount, sourceEntry },
      header: {
        'content-type': 'application/json',
        'x-idempotency-key': createIdempotencyKey(`flower-gift:${playerId}:${amount}`)
      },
      authRequired: true
    });
  }

  async badges() {
    await this.auth.ensure();
    return await this.http.request('/api/v1/me/badges', { authRequired: true });
  }

  async equipBadge(playerId) {
    await this.requireProfile('badge_equip');
    return await this.http.request('/api/v1/me/badges/equipped', {
      method: 'PUT',
      data: { playerId },
      header: {
        'content-type': 'application/json',
        'x-idempotency-key': createIdempotencyKey(`badge-equip:${playerId}`)
      },
      authRequired: true
    });
  }

  async unequipBadge() {
    await this.requireProfile('badge_unequip');
    return await this.http.request('/api/v1/me/badges/equipped', {
      method: 'DELETE',
      header: { 'x-idempotency-key': createIdempotencyKey('badge-unequip') },
      authRequired: true
    });
  }

  async playerSummary(playerId) {
    return await this.http.request(`/api/v1/bff/social/players/${encodeURIComponent(playerId)}`, {
      authMode: 'none'
    });
  }

  async matchPlayerSummaries(matchId) {
    return await this.http.request(`/api/v1/bff/social/matches/${encodeURIComponent(matchId)}/player-summaries`, {
      authMode: 'none'
    });
  }

  async topFans(playerId) {
    return await this.http.request(`/api/v1/bff/social/players/${encodeURIComponent(playerId)}/top-fans`, {
      authMode: 'none'
    });
  }

  async viewerFanRank(playerId) {
    if (!this.auth.currentAccessToken()) return { viewer: { flowerTotal: 0, rank: null } };
    return await this.http.request(`/api/v1/me/players/${encodeURIComponent(playerId)}/fan-rank`, {
      authRequired: true
    });
  }

  async flowerLeaderboard(kind, scope = 'all') {
    const resource = kind === 'fans' ? 'fans' : 'players';
    return await this.http.request(`/api/v1/bff/social/leaderboards/flowers/${resource}?scope=${encodeURIComponent(scope)}`, {
      authMode: 'none'
    });
  }

  async followLeaderboard(scope = 'all') {
    return await this.http.request(`/api/v1/bff/social/leaderboards/follows?scope=${encodeURIComponent(scope)}`, {
      authMode: 'none'
    });
  }
}

module.exports = Object.freeze({ SocialService });
