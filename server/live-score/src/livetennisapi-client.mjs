/**
 * Optional secondary live-score client for livetennisapi.com.
 *
 * Disabled unless LIVETENNISAPI_KEY is set. It reads one FREE endpoint,
 * `GET /matches?status=live`, and never touches the schedule: the rows it
 * returns are handed to livetennisapi-overlay.mjs, which can only fill score
 * state on matches the official schedule already contains.
 */

const DEFAULT_BASE = 'https://api.livetennisapi.com/api/public/v1';
const PAGE_LIMIT = 200;
const MAX_PAGES = 5;
const REQUEST_TIMEOUT_MS = 8_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;

export class LiveTennisApiClient {
  constructor({
    apiKey,
    apiBase = DEFAULT_BASE,
    fetchImpl = fetch,
    now = () => Date.now()
  }) {
    this.apiKey = apiKey;
    this.apiBase = String(apiBase).replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cooldownUntil = 0;
  }

  async request(path, params = {}) {
    if (!this.apiKey) throw new Error('LIVETENNISAPI_KEY is not configured');
    const url = new URL(`${this.apiBase}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json', authorization: `Bearer ${this.apiKey}` }
    });
    if (response.status === 429) {
      // Respect the provider saying no; back off instead of retrying into it.
      const retryAfter = Number(response.headers?.get?.('retry-after')) || 0;
      this.cooldownUntil = this.now() + Math.max(RATE_LIMIT_COOLDOWN_MS, retryAfter * 1000);
      throw new Error('livetennisapi rate limited');
    }
    if (!response.ok) throw new Error(`livetennisapi HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Every match the provider currently reports as in progress.
   *
   * Returns [] rather than a partial page when the provider paginates past
   * MAX_PAGES, because a half-read board is indistinguishable from a board
   * whose missing rows simply are not live.
   */
  async liveMatches() {
    if (this.now() < this.cooldownUntil) return [];
    const matches = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const payload = await this.request('/matches', {
        status: 'live',
        limit: PAGE_LIMIT,
        offset: page * PAGE_LIMIT
      });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      matches.push(...data);
      if (!payload?.meta?.has_more || !data.length) return matches;
    }
    return matches;
  }
}
