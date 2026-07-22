import { EventEmitter } from 'node:events';
import { applyPrematchOdds, groupSchedule, isMainTour, isObservationWindow, mergeMatches } from './normalizer.mjs';

const OBSERVATION_PROBE_MS = 60_000;
const LIVE_POLL_MS = 8_000;

export class LivePoller extends EventEmitter {
  constructor({ client, cache, config, localizer = null, now = () => Date.now() }) {
    super();
    this.client = client;
    this.cache = cache;
    this.config = config;
    this.localizer = localizer;
    this.now = now;
    this.timer = null;
    this.running = false;
    this.snapshot = this.buildSnapshot();
  }

  buildSnapshot(error = '') {
    const fixtures = this.cache.data.fixtures?.items || [];
    const date = this.client.beijingDate();
    let matches = mergeMatches(fixtures, this.cache.data.live || []);
    if (this.localizer) matches = this.localizer.enrich(matches);
    matches = applyPrematchOdds(matches, this.cache.data.prematchOdds?.items || {});
    const rankingByPlayer = new Map();
    for (const tour of ['ATP', 'WTA']) {
      const rows = this.cache.data.details?.[`standings:${tour}`]?.value || [];
      rows.forEach(row => {
        if (row.player_key && row.place) rankingByPlayer.set(String(row.player_key), String(row.place));
      });
    }
    matches.forEach(match => {
      if (!match.first.rank) match.first.rank = rankingByPlayer.get(String(match.first.id)) || '';
      if (!match.second.rank) match.second.rank = rankingByPlayer.get(String(match.second.id)) || '';
    });
    const officialScheduleReady = this.cache.data.localization?.date === date && (this.cache.data.localization?.tours || []).length > 0;
    matches = matches.filter(match => isMainTour(match)
      && (officialScheduleReady ? match.officialScheduleMatch : match.date === date));
    return {
      date,
      timeZone: this.config.timeZone,
      updatedAt: new Date(this.now()).toISOString(),
      stale: Boolean(error),
      error,
      requestBudget: { ...this.client.budgetToday(), limit: this.config.dailyLimit },
      hasLive: matches.some(match => match.status === 'live'),
      tournaments: groupSchedule(matches)
    };
  }

  async refreshFixtures(force = false) {
    const saved = this.cache.data.fixtures;
    const date = this.client.beijingDate();
    const dateStop = this.client.dateAfter(date);
    if (!force && saved && saved.date === date && saved.dateStop === dateStop && this.now() - saved.fetchedAt < this.config.fixturesTtlMs) return saved.items;
    const items = await this.client.fixtures(date, dateStop);
    this.cache.data.fixtures = { fetchedAt: this.now(), date, dateStop, items };
    this.cache.scheduleWrite();
    return items;
  }

  async refreshPrematchOdds(force = false) {
    const saved = this.cache.data.prematchOdds;
    const date = this.client.beijingDate();
    const dateStop = this.client.dateAfter(date);
    if (!force && saved && saved.date === date && saved.dateStop === dateStop && this.now() - saved.fetchedAt < this.config.oddsTtlMs) return saved.items;
    const items = await this.client.odds(date, dateStop);
    this.cache.data.prematchOdds = { fetchedAt: this.now(), date, dateStop, items };
    this.cache.scheduleWrite();
    return items;
  }

  shouldObserve() {
    const date = this.client.beijingDate();
    let matches = mergeMatches(this.cache.data.fixtures?.items || [], this.cache.data.live || []);
    if (this.localizer) matches = this.localizer.enrich(matches);
    const officialScheduleReady = this.cache.data.localization?.date === date && (this.cache.data.localization?.tours || []).length > 0;
    return matches.some(match => isMainTour(match)
      && (officialScheduleReady ? match.officialScheduleMatch : match.date === date)
      && isObservationWindow(match, this.now(), this.config.observationBeforeMs, this.config.observationAfterMs));
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    let error = '';
    try {
      await this.refreshFixtures();
      await this.localizer?.refresh(this.client.beijingDate(), this.now()).catch(cause => console.warn('[localizer]', cause.message));
      await this.refreshPrematchOdds().catch(cause => console.warn('[odds]', cause.message));
      if (this.shouldObserve()) {
        this.cache.data.live = await this.client.livescore();
        this.cache.scheduleWrite();
      } else if (!this.shouldObserve()) {
        this.cache.data.live = [];
      }
    } catch (cause) {
      error = cause.publicCode || cause.message || 'refresh_failed';
      console.warn('[poller]', cause.message);
    } finally {
      this.snapshot = this.buildSnapshot(error);
      this.emit('snapshot', this.snapshot);
      this.running = false;
      this.schedule();
    }
  }

  nextDelay() {
    if (this.snapshot.hasLive) return LIVE_POLL_MS;
    if (this.shouldObserve()) return OBSERVATION_PROBE_MS;
    const fixtures = this.cache.data.fixtures?.items || [];
    const date = this.client.beijingDate();
    let matches = mergeMatches(fixtures, this.cache.data.live || []);
    if (this.localizer) matches = this.localizer.enrich(matches);
    const officialScheduleReady = this.cache.data.localization?.date === date && (this.cache.data.localization?.tours || []).length > 0;
    const pending = matches.filter(match => isMainTour(match)
      && match.status === 'scheduled'
      && (officialScheduleReady ? match.officialScheduleMatch : match.date === date));
    const nextWindow = pending.map(match => {
      const start = Date.parse(`${match.scheduleDate || match.date}T${match.time}:00+08:00`)
        + (Number(match.dayOffset) || 0) * 24 * 60 * 60_000;
      return start - this.config.observationBeforeMs - this.now();
    }).filter(delay => Number.isFinite(delay) && delay > 0).sort((a, b) => a - b)[0];
    const fetchedAt = this.cache.data.fixtures?.fetchedAt || 0;
    const fixtureRefresh = Math.max(5_000, this.config.fixturesTtlMs - (this.now() - fetchedAt));
    if (Number.isFinite(nextWindow)) return Math.max(5_000, Math.min(nextWindow, fixtureRefresh));
    if (pending.length) return fixtureRefresh;
    const nextDate = this.client.dateAfter(date);
    return Math.max(5_000, Date.parse(`${nextDate}T00:00:01+08:00`) - this.now());
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), this.nextDelay());
  }

  start() { return this.tick(); }
  stop() { clearTimeout(this.timer); }
}
