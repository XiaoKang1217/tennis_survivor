import { EventEmitter } from 'node:events';
import { applyPrematchOdds, groupSchedule, isMainTour, isObservationWindow, mergeMatches, normalizeMatch } from './normalizer.mjs';

const OBSERVATION_PROBE_MS = 60_000;
const LIVE_POLL_MS = 8_000;
const HISTORY_START_DATE = '2026-07-22';
const HISTORY_DAYS = 5;

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
    if (!this.cache.data.activeScheduleDate || this.cache.data.activeScheduleDate < HISTORY_START_DATE) {
      this.cache.data.activeScheduleDate = this.client.beijingDate();
    }
    if (!this.cache.data.scheduleHistory || typeof this.cache.data.scheduleHistory !== 'object') {
      this.cache.data.scheduleHistory = {};
    }
    this.rememberTerminalMatches(this.cache.data.fixtures?.items || [], false);
    this.rememberTerminalMatches(this.cache.data.live || [], false);
    this.snapshot = this.buildSnapshot();
    this.rememberSnapshot(this.snapshot, false);
  }

  scheduleDate() {
    return this.cache.data.activeScheduleDate || this.client.beijingDate();
  }

  historyDates(extraDate = '') {
    return [...new Set([...Object.keys(this.cache.data.scheduleHistory || {}), extraDate].filter(date => date >= HISTORY_START_DATE))]
      .sort()
      .slice(-HISTORY_DAYS);
  }

  rememberSnapshot(snapshot, write = true) {
    if (!snapshot?.date || snapshot.date < HISTORY_START_DATE) return;
    const history = this.cache.data.scheduleHistory;
    history[snapshot.date] = { ...snapshot, availableDates: undefined };
    const keep = new Set(this.historyDates(snapshot.date));
    Object.keys(history).forEach(date => { if (!keep.has(date)) delete history[date]; });
    snapshot.availableDates = this.historyDates(snapshot.date);
    if (write) this.cache.scheduleWrite();
  }

  activeDayComplete(snapshot = this.snapshot) {
    const matches = (snapshot?.tournaments || []).flatMap(tour => tour.venues.flatMap(venue => venue.matches));
    return matches.length > 0 && matches.every(match => match.status === 'finished');
  }

  advanceScheduleDayIfComplete(snapshot = this.snapshot) {
    const calendarDate = this.client.beijingDate();
    if (calendarDate <= this.scheduleDate() || !this.activeDayComplete(snapshot)) return false;
    this.cache.data.activeScheduleDate = calendarDate;
    this.cache.data.fixtures = null;
    this.cache.data.live = [];
    this.cache.data.terminalMatches = null;
    this.cache.data.prematchOdds = null;
    this.cache.scheduleWrite();
    return true;
  }

  terminalMatches() {
    const date = this.scheduleDate();
    const saved = this.cache.data.terminalMatches;
    if (!saved || saved.date !== date || !saved.items || typeof saved.items !== 'object') {
      this.cache.data.terminalMatches = { date, items: {} };
    }
    return Object.values(this.cache.data.terminalMatches.items);
  }

  rememberTerminalMatches(items = [], write = true) {
    this.terminalMatches();
    const saved = this.cache.data.terminalMatches.items;
    let changed = false;
    for (const raw of items) {
      const match = normalizeMatch(raw);
      if (!match.id || match.status !== 'finished') continue;
      const key = String(match.id);
      const next = JSON.stringify(raw);
      if (JSON.stringify(saved[key]) === next) continue;
      saved[key] = raw;
      changed = true;
    }
    if (changed && write) this.cache.scheduleWrite();
    return changed;
  }

  matchSources() {
    return [
      ...(this.cache.data.fixtures?.items || []),
      ...this.terminalMatches()
    ];
  }

  buildSnapshot(error = '') {
    const date = this.scheduleDate();
    let matches = mergeMatches(this.matchSources(), this.cache.data.live || []);
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
      activeDate: date,
      availableDates: this.historyDates(date),
      tournaments: groupSchedule(matches)
    };
  }

  async refreshFixtures(force = false) {
    const saved = this.cache.data.fixtures;
    const date = this.scheduleDate();
    const dateStop = this.client.dateAfter(date);
    if (!force && saved && saved.date === date && saved.dateStop === dateStop && this.now() - saved.fetchedAt < this.config.fixturesTtlMs) return saved.items;
    const items = await this.client.fixtures(date, dateStop);
    this.cache.data.fixtures = { fetchedAt: this.now(), date, dateStop, items };
    this.rememberTerminalMatches(items, false);
    this.cache.scheduleWrite();
    return items;
  }

  async refreshPrematchOdds(force = false) {
    const saved = this.cache.data.prematchOdds;
    const date = this.scheduleDate();
    const dateStop = this.client.dateAfter(date);
    if (!force && saved && saved.date === date && saved.dateStop === dateStop && this.now() - saved.fetchedAt < this.config.oddsTtlMs) return saved.items;
    const items = await this.client.odds(date, dateStop);
    this.cache.data.prematchOdds = { fetchedAt: this.now(), date, dateStop, items };
    this.cache.scheduleWrite();
    return items;
  }

  shouldObserve() {
    const date = this.scheduleDate();
    let matches = mergeMatches(this.matchSources(), this.cache.data.live || []);
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
      await this.localizer?.refresh(this.scheduleDate(), this.now()).catch(cause => console.warn('[localizer]', cause.message));
      await this.refreshPrematchOdds().catch(cause => console.warn('[odds]', cause.message));
      if (this.shouldObserve()) {
        const live = await this.client.livescore();
        this.rememberTerminalMatches(live, false);
        this.cache.data.live = live;
        this.cache.scheduleWrite();
      } else if (!this.shouldObserve()) {
        this.cache.data.live = [];
      }
    } catch (cause) {
      error = cause.publicCode || cause.message || 'refresh_failed';
      console.warn('[poller]', cause.message);
    } finally {
      this.snapshot = this.buildSnapshot(error);
      this.rememberSnapshot(this.snapshot);
      this.emit('snapshot', this.snapshot);
      const advanced = this.advanceScheduleDayIfComplete(this.snapshot);
      this.running = false;
      this.schedule(advanced ? 5_000 : undefined);
    }
  }

  nextDelay() {
    if (this.snapshot.hasLive) return LIVE_POLL_MS;
    if (this.shouldObserve()) return OBSERVATION_PROBE_MS;
    const date = this.scheduleDate();
    let matches = mergeMatches(this.matchSources(), this.cache.data.live || []);
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

  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), delay ?? this.nextDelay());
  }

  start() { return this.tick(); }
  stop() { clearTimeout(this.timer); }
}
