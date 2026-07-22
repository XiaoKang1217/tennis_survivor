export class ApiTennisClient {
  constructor({ apiKey, apiBase, cache, timeZone }) {
    this.apiKey = apiKey;
    this.apiBase = apiBase;
    this.cache = cache;
    this.timeZone = timeZone;
  }

  beijingDate(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  dateAfter(date, days = 1) {
    const [year, month, day] = String(date).split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day + days));
    return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : date;
  }

  budgetToday() {
    const day = this.beijingDate();
    if (!this.cache.data.budget || this.cache.data.budget.day !== day) this.cache.data.budget = { day, used: 0 };
    return this.cache.data.budget;
  }

  async request(method, params = {}) {
    if (!this.apiKey) throw Object.assign(new Error('API_TENNIS_KEY is not configured'), { statusCode: 503, publicCode: 'api_key_missing' });
    const url = new URL(this.apiBase);
    url.searchParams.set('method', method);
    url.searchParams.set('APIkey', this.apiKey);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    const budget = this.budgetToday();
    budget.used += 1;
    this.cache.scheduleWrite();
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' } });
    if (!response.ok) throw Object.assign(new Error(`API Tennis HTTP ${response.status}`), { statusCode: 502, publicCode: 'provider_http_error' });
    const payload = await response.json();
    if (payload.success === 0 || payload.error) {
      const message = typeof payload.error === 'string' ? payload.error : 'API Tennis returned an error';
      throw Object.assign(new Error(message), { statusCode: 502, publicCode: 'provider_error' });
    }
    return Array.isArray(payload.result) ? payload.result : (payload.result || []);
  }

  fixtures(date = this.beijingDate(), dateStop = this.dateAfter(date)) {
    return this.request('get_fixtures', { date_start: date, date_stop: dateStop, timezone: this.timeZone });
  }
  odds(date = this.beijingDate(), dateStop = this.dateAfter(date)) {
    return this.request('get_odds', { date_start: date, date_stop: dateStop });
  }
  livescore() { return this.request('get_livescore', { timezone: this.timeZone }); }
  statistics(matchKey) { return this.request('get_statistics', { match_key: matchKey }); }
  h2h(firstPlayerKey, secondPlayerKey) { return this.request('get_H2H', { first_player_key: firstPlayerKey, second_player_key: secondPlayerKey }); }
  playerHistory(playerKey, dateStart, dateStop) { return this.request('get_fixtures', { player_key: playerKey, date_start: dateStart, date_stop: dateStop, timezone: this.timeZone }); }
  standings(eventType) { return this.request('get_standings', { event_type: eventType }); }
}
