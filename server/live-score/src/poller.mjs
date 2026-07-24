import { EventEmitter } from 'node:events';
import {
  applyPrematchOdds,
  groupSchedule,
  isMainTour,
  isObservationWindow,
  mergeMatches,
  normalizeMatch,
  overlayLiveScores
} from './normalizer.mjs';
import { assignOfficialScheduleDate } from './schedule-date.mjs';

const OBSERVATION_PROBE_MS = 60_000;
const LIVE_POLL_MS = 8_000;
const HISTORY_START_DATE = '2026-07-22';
const HISTORY_DAYS = 5;
const DATA_PIPELINE_VERSION = 7;

function normalizedIdentity(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function teamIdentity(player = {}) {
  return normalizedIdentity(player.nameEn || player.name || player.id);
}

function terminalFingerprint(match) {
  const teams = [teamIdentity(match.first), teamIdentity(match.second)].sort();
  if (teams.some(team => !team || team === '待定')) {
    return `id:${match.id}`;
  }
  return [
    match.scheduleDate || match.date,
    normalizedIdentity(match.type),
    ...teams
  ].join('|');
}

function lockTerminalMatches(matches = []) {
  const terminal = new Map();
  matches.forEach(match => {
    if (match.status === 'finished') terminal.set(terminalFingerprint(match), match);
  });
  const locked = new Map();
  matches.forEach(match => {
    const fingerprint = terminalFingerprint(match);
    locked.set(fingerprint, terminal.get(fingerprint) || match);
  });
  return [...locked.values()];
}

function flatten(snapshot = {}) {
  return (snapshot.tournaments || [])
    .flatMap(tour => (tour.venues || []).flatMap(venue => venue.matches || []));
}

export class LivePoller extends EventEmitter {
  constructor({
    client,
    cache,
    config,
    localizer = null,
    officialValidator = null,
    now = () => Date.now()
  }) {
    super();
    this.client = client;
    this.cache = cache;
    this.config = config;
    this.localizer = localizer;
    this.officialValidator = officialValidator;
    this.now = now;
    this.timer = null;
    this.running = false;

    this.cache.data.scheduleHistory ||= {};
    this.cache.data.scheduleArchive ||= {};
    this.cache.data.scheduleBases ||= {};
    this.cache.data.scheduleFixtures ||= {};
    this.cache.data.atpOopSnapshots ||= {};
    this.cache.data.live ||= [];
    if (this.cache.data.pipelineVersion !== DATA_PIPELINE_VERSION) {
      // Old snapshots were allowed to take factual schedule fields from a
      // third-party page. They cannot be migrated safely; rebuild them from
      // API Tennis plus ATP/WTA official references.
      this.cache.data.pipelineVersion = DATA_PIPELINE_VERSION;
      this.cache.data.scheduleHistory = {};
      this.cache.data.scheduleArchive = {};
      this.cache.data.scheduleBases = {};
      this.cache.data.scheduleFixtures = {};
      this.cache.data.officialReferences = {};
      this.cache.data.fixtures = null;
      this.cache.data.live = [];
    }
    if (!this.cache.data.activeScheduleDate
      || this.cache.data.activeScheduleDate < HISTORY_START_DATE) {
      this.cache.data.activeScheduleDate = this.client.beijingDate();
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
    return [...new Set([
      ...Object.keys(this.cache.data.scheduleHistory || {}),
      ...Object.keys(this.cache.data.scheduleBases || {}),
      extraDate
    ].filter(date => date >= HISTORY_START_DATE))]
      .sort()
      .slice(-HISTORY_DAYS);
  }

  trimHistory(extraDate = '') {
    const keep = new Set(this.historyDates(extraDate));
    for (const collection of [
      this.cache.data.scheduleHistory,
      this.cache.data.scheduleBases,
      this.cache.data.scheduleFixtures
    ]) {
      Object.keys(collection || {}).forEach(date => {
        if (!keep.has(date)) delete collection[date];
      });
    }
  }

  rememberSnapshot(snapshot, write = true) {
    if (!snapshot?.date || snapshot.date < HISTORY_START_DATE) return;
    this.cache.data.scheduleHistory[snapshot.date] = {
      ...snapshot,
      availableDates: undefined
    };
    // This archive is intentionally not trimmed with the five-day UI window.
    // One durable snapshot per official schedule day remains available for
    // audit and recovery after the day leaves the date picker.
    const archived = this.cache.data.scheduleArchive[snapshot.date];
    if (!archived || flatten(snapshot).length || !flatten(archived).length) {
      this.cache.data.scheduleArchive[snapshot.date] = {
        ...snapshot,
        availableDates: undefined
      };
    }
    this.trimHistory(snapshot.date);
    snapshot.availableDates = this.historyDates(snapshot.date);
    if (write) this.cache.scheduleWrite();
  }

  terminalMatches() {
    const date = this.scheduleDate();
    const saved = this.cache.data.terminalMatches;
    if (!saved || saved.date !== date || !saved.items
      || typeof saved.items !== 'object') {
      this.cache.data.terminalMatches = { date, items: {} };
    }
    return Object.values(this.cache.data.terminalMatches.items);
  }

  rememberTerminalMatches(items = [], write = true) {
    this.terminalMatches();
    const saved = this.cache.data.terminalMatches.items;
    let changed = false;
    for (const raw of items) {
      const match = raw?.first && raw?.tournament ? raw : normalizeMatch(raw);
      if (!match.id || match.status !== 'finished') continue;
      const key = String(match.id);
      // Persist a normalized terminal row with its official schedule day.
      // A provider may later change event_key or report the Beijing display
      // date; the logical lock must still compare inside the same schedule day.
      const next = structuredClone({
        ...match,
        scheduleDate: match.scheduleDate || this.scheduleDate()
      });
      if (JSON.stringify(saved[key]) === JSON.stringify(next)) continue;
      saved[key] = next;
      changed = true;
    }
    if (changed && write) this.cache.scheduleWrite();
    return changed;
  }

  rankingByPlayer() {
    const ranking = new Map();
    for (const tour of ['ATP', 'WTA']) {
      const rows = this.cache.data.details?.[`standings:${tour}`]?.value || [];
      rows.forEach(row => {
        if (row.player_key && row.place) {
          ranking.set(String(row.player_key), String(row.place));
        }
      });
    }
    return ranking;
  }

  createScheduleBase(date, fixtureItems = [], odds = {}) {
    let matches = mergeMatches(fixtureItems, []).filter(isMainTour);
    // get_fixtures creates the immutable card list. Its transient "live"
    // marker must not become a sticky baseline after a match disappears from
    // get_livescore. Only terminal states are accepted from fixtures; all
    // active point/game state comes from the volatile livescore overlay.
    matches.forEach(match => {
      if (match.status !== 'live') return;
      match.status = 'scheduled';
      match.statusText = 'Scheduled';
      match.current = { first: '', second: '' };
      match.serve = '';
      match.lastPoint = '';
    });
    if (this.officialValidator) {
      matches = this.officialValidator.reconcile(matches, date);
    }
    matches = assignOfficialScheduleDate(matches.filter(isMainTour), date, this.config.timeZone);
    matches = applyPrematchOdds(matches, odds || {});

    const ranking = this.rankingByPlayer();
    matches.forEach(match => {
      if (!match.first.rank) match.first.rank = ranking.get(String(match.first.id)) || '';
      if (!match.second.rank) match.second.rank = ranking.get(String(match.second.id)) || '';
    });
    if (this.localizer) matches = this.localizer.enrich(matches);
    // Official finished results are lock inputs too, not merely presentation
    // metadata. Store them with the same persistence guarantees as a Finished
    // response from get_fixtures/get_livescore.
    if (date === this.scheduleDate()) this.rememberTerminalMatches(matches, false);

    const value = {
      date,
      builtAt: this.now(),
      sourcePolicy: 'api-tennis-candidates+official-atp-oop+wta-official',
      matches: structuredClone(matches)
    };
    this.cache.data.scheduleBases[date] = value;
    this.trimHistory(date);
    return value;
  }

  scheduleBase(date = this.scheduleDate()) {
    const saved = this.cache.data.scheduleBases?.[date];
    if (saved?.matches) return structuredClone(saved.matches);
    const fixtures = this.cache.data.fixtures;
    if ((!fixtures?.date || fixtures.date === date) && Array.isArray(fixtures?.items)) {
      return this.createScheduleBase(
        date,
        fixtures.items,
        this.cache.data.prematchOdds?.date === date
          ? this.cache.data.prematchOdds.items
          : {}
      ).matches;
    }
    return [];
  }

  activeMatches() {
    const base = this.scheduleBase();
    // Lock layer 1/2: persistent terminal cache is applied before the volatile
    // livescore response, so a stale live row cannot resurrect a finished row.
    let matches = overlayLiveScores(base, this.terminalMatches());
    matches = overlayLiveScores(matches, this.cache.data.live || []);
    // Lock layer 3: if a provider changes event_key, the logical pairing keeps
    // the finished copy.
    return lockTerminalMatches(matches);
  }

  snapshotFromMatches(date, matches, error = '') {
    return {
      date,
      timeZone: this.config.timeZone,
      updatedAt: new Date(this.now()).toISOString(),
      stale: Boolean(error),
      error,
      requestBudget: {
        ...this.client.budgetToday(),
        limit: this.config.dailyLimit
      },
      sourcePolicy: {
        schedule: 'API Tennis get_fixtures reconciled with ATP/WTA official schedules',
        live: 'API Tennis get_livescore score/status overlay only',
        localization: 'checked-in Chinese player-name catalogue only'
      },
      hasLive: matches.some(match => match.status === 'live'),
      activeDate: this.scheduleDate(),
      availableDates: this.historyDates(date),
      tournaments: groupSchedule(matches)
    };
  }

  buildSnapshot(error = '') {
    return this.snapshotFromMatches(this.scheduleDate(), this.activeMatches(), error);
  }

  activeDayComplete(snapshot = this.snapshot) {
    const matches = flatten(snapshot);
    return matches.length > 0 && matches.every(match => match.status === 'finished');
  }

  advanceScheduleDayIfComplete(snapshot = this.snapshot) {
    const calendarDate = this.client.beijingDate();
    if (calendarDate <= this.scheduleDate() || !this.activeDayComplete(snapshot)) {
      return false;
    }
    this.cache.data.activeScheduleDate = calendarDate;
    this.cache.data.fixtures = null;
    this.cache.data.live = [];
    this.cache.data.terminalMatches = null;
    this.cache.data.prematchOdds = null;
    this.cache.scheduleWrite();
    return true;
  }

  async refreshOfficial(date, force = false, candidates = []) {
    if (!this.officialValidator) return null;
    return this.officialValidator.refresh(date, this.now(), force, candidates);
  }

  async fetchScheduleDate(date, { force = false, active = false } = {}) {
    if (!force && !active && this.cache.data.scheduleBases?.[date]?.matches?.length) {
      return this.cache.data.scheduleBases[date];
    }
    const dateStop = this.client.dateAfter(date);
    const fixtures = await this.client.fixtures(date, dateStop);
    const candidates = mergeMatches(fixtures, []).filter(isMainTour);
    const [official, odds] = await Promise.all([
      this.refreshOfficial(date, force, candidates).catch(cause => {
        console.warn(`[official:${date}]`, cause.message);
        return null;
      }),
      this.client.odds(date, dateStop).catch(cause => {
        console.warn(`[odds:${date}]`, cause.message);
        return {};
      })
    ]);
    void official;

    this.cache.data.scheduleFixtures[date] = {
      fetchedAt: this.now(),
      date,
      dateStop,
      items: fixtures,
      odds
    };
    if (active) {
      this.cache.data.fixtures = {
        fetchedAt: this.now(),
        date,
        dateStop,
        items: fixtures
      };
      this.cache.data.prematchOdds = {
        fetchedAt: this.now(),
        date,
        dateStop,
        items: odds
      };
      this.rememberTerminalMatches(fixtures, false);
    }
    const base = this.createScheduleBase(date, fixtures, odds);
    const historical = this.snapshotFromMatches(date, base.matches);
    this.rememberSnapshot(historical, false);
    this.cache.scheduleWrite();
    return base;
  }

  async refreshActiveSchedule(force = false) {
    const date = this.scheduleDate();
    const saved = this.cache.data.fixtures;
    const base = this.cache.data.scheduleBases?.[date];
    if (!force && saved?.date === date && base?.matches
      && this.now() - saved.fetchedAt < this.config.fixturesTtlMs) {
      const candidates = mergeMatches(saved.items, []).filter(isMainTour);
      await this.refreshOfficial(date, false, candidates).catch(cause =>
        console.warn(`[official:${date}]`, cause.message));
      return this.createScheduleBase(
        date,
        saved.items,
        this.cache.data.prematchOdds?.date === date
          ? this.cache.data.prematchOdds.items
          : {}
      );
    }
    return this.fetchScheduleDate(date, { force, active: true });
  }

  recentCalendarDates() {
    const dates = [];
    let value = this.client.beijingDate();
    for (let index = 0; index < HISTORY_DAYS; index += 1) {
      if (value >= HISTORY_START_DATE) dates.unshift(value);
      value = this.client.dateAfter(value, -1);
    }
    return dates;
  }

  async backfillRecentDates() {
    for (const date of this.recentCalendarDates()) {
      if (date === this.scheduleDate()) continue;
      if (this.cache.data.scheduleBases?.[date]?.matches?.length) continue;
      try {
        await this.fetchScheduleDate(date);
      } catch (cause) {
        console.warn(`[schedule-backfill:${date}]`, cause.message);
      }
    }
  }

  async refreshPendingOfficialDates() {
    const ttl = this.config.officialTtlMs || 5 * 60_000;
    for (const [date, reference] of Object.entries(this.cache.data.officialReferences || {})) {
      if (date === this.scheduleDate()) continue;
      const pending = (reference?.tours || []).some(tour =>
        tour.tour === 'ATP' && tour.complete === false);
      if (!pending || this.now() - (reference.fetchedAt || 0) < ttl) continue;
      const saved = this.cache.data.scheduleFixtures?.[date];
      if (!saved?.items) continue;
      const candidates = mergeMatches(saved.items, []).filter(isMainTour);
      await this.refreshOfficial(date, false, candidates).catch(cause =>
        console.warn(`[official:${date}]`, cause.message));
      const base = this.createScheduleBase(date, saved.items, saved.odds || {});
      this.rememberSnapshot(this.snapshotFromMatches(date, base.matches), false);
    }
  }

  async prefetchCalendarDay() {
    const date = this.client.beijingDate();
    if (date === this.scheduleDate()
      || this.cache.data.scheduleBases?.[date]?.matches?.length) return false;
    await this.fetchScheduleDate(date);
    return true;
  }

  async snapshotForDate(date) {
    if (date === this.snapshot.date) return this.snapshot;
    const snapshot = this.cache.data.scheduleHistory?.[date];
    if (snapshot) {
      return { ...snapshot, availableDates: this.historyDates(date) };
    }
    if (date < HISTORY_START_DATE || !this.recentCalendarDates().includes(date)) {
      return null;
    }
    await this.fetchScheduleDate(date);
    return {
      ...this.cache.data.scheduleHistory[date],
      availableDates: this.historyDates(date)
    };
  }

  shouldObserve() {
    return this.activeMatches().some(match =>
      isObservationWindow(
        match,
        this.now(),
        this.config.observationBeforeMs,
        this.config.observationAfterMs
      ));
  }

  officialScheduleRefreshDelay() {
    const ttl = this.config.officialTtlMs || 5 * 60_000;
    const delays = Object.entries(this.cache.data.officialReferences || {})
      .filter(([date, reference]) => {
        const atpTours = (reference?.tours || []).filter(tour => tour.tour === 'ATP');
        return atpTours.length && (
          date === this.scheduleDate()
          || (
            atpTours.some(tour => tour.complete === false)
            && Boolean(this.cache.data.scheduleFixtures?.[date]?.items)
          )
        );
      })
      .map(([, reference]) =>
        Math.max(5_000, (reference.fetchedAt || 0) + ttl - this.now()));
    return delays.length ? Math.min(...delays) : Number.POSITIVE_INFINITY;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    let error = '';
    try {
      await this.refreshActiveSchedule();
      await this.backfillRecentDates();
      await this.refreshPendingOfficialDates();
      const observe = this.shouldObserve();
      if (observe) {
        const live = await this.client.livescore();
        this.rememberTerminalMatches(live, false);
        this.cache.data.live = live;
        this.cache.scheduleWrite();
      } else {
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

    const matches = this.activeMatches();
    const pending = matches.filter(match => match.status === 'scheduled');
    const nextWindow = pending.map(match => {
      const start = Date.parse(`${match.date}T${match.time}:00+08:00`);
      return start - this.config.observationBeforeMs - this.now();
    }).filter(delay => Number.isFinite(delay) && delay > 0).sort((a, b) => a - b)[0];
    const fetchedAt = this.cache.data.fixtures?.fetchedAt || 0;
    const fixtureRefresh = Math.max(
      5_000,
      this.config.fixturesTtlMs - (this.now() - fetchedAt)
    );
    const officialRefresh = this.officialScheduleRefreshDelay();
    if (Number.isFinite(nextWindow)) {
      return Math.max(5_000, Math.min(nextWindow, fixtureRefresh, officialRefresh));
    }
    if (pending.length) return Math.min(fixtureRefresh, officialRefresh);
    if (Number.isFinite(officialRefresh)) return officialRefresh;

    const nextDate = this.client.dateAfter(this.scheduleDate());
    return Math.max(
      5_000,
      Date.parse(`${nextDate}T00:00:01+08:00`) - this.now()
    );
  }

  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), delay ?? this.nextDelay());
  }

  start() {
    return this.tick();
  }

  stop() {
    clearTimeout(this.timer);
  }
}
