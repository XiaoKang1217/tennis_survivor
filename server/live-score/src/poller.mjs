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
const DATA_PIPELINE_VERSION = 8;

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
    this.cache.data.terminalMatchesByDate ||= {};
    this.cache.data.live ||= [];
    if (this.cache.data.pipelineVersion !== DATA_PIPELINE_VERSION) {
      // Schedule snapshots and parsed OOP rows are tied to the production
      // pipeline version. Incompatible derived facts cannot be migrated
      // safely; rebuild them from API Tennis plus ATP/WTA official references.
      this.cache.data.pipelineVersion = DATA_PIPELINE_VERSION;
      this.cache.data.scheduleHistory = {};
      this.cache.data.scheduleArchive = {};
      this.cache.data.scheduleBases = {};
      this.cache.data.scheduleFixtures = {};
      // Parsed OOP objects are parser-versioned data, not immutable source
      // files. Version 7 may have stored junior side events or misclassified
      // compact "A (ARG)or/B" singles rows, and the original overwritten PDF
      // is no longer available to reparse. Discard those incompatible parsed
      // snapshots while retaining terminal match locks separately.
      this.cache.data.atpOopSnapshots = {};
      this.cache.data.officialReferences = {};
      this.cache.data.fixtures = null;
      this.cache.data.live = [];
    }
    if (!this.cache.data.activeScheduleDate
      || this.cache.data.activeScheduleDate < HISTORY_START_DATE) {
      this.cache.data.activeScheduleDate = this.client.beijingDate();
    }

    const legacyTerminal = this.cache.data.terminalMatches;
    if (legacyTerminal?.date && legacyTerminal?.items) {
      this.cache.data.terminalMatchesByDate[legacyTerminal.date] ||= {};
      Object.assign(
        this.cache.data.terminalMatchesByDate[legacyTerminal.date],
        legacyTerminal.items
      );
    }
    this.rememberTerminalMatches(
      this.cache.data.fixtures?.items || [],
      false,
      this.cache.data.fixtures?.date || this.scheduleDate()
    );
    this.rememberTerminalMatches(this.cache.data.live || [], false);
    this.snapshot = this.buildSnapshot();
    this.rememberSnapshot(this.snapshot, false);
  }

  scheduleDate() {
    return this.cache.data.activeScheduleDate || this.client.beijingDate();
  }

  historyDates(extraDate = '') {
    const baseDates = Object.entries(this.cache.data.scheduleBases || {})
      .filter(([, base]) => base?.matches?.length)
      .map(([date]) => date);
    return [...new Set([
      ...Object.keys(this.cache.data.scheduleHistory || {}),
      ...baseDates,
      extraDate
    ].filter(date => date >= HISTORY_START_DATE))]
      .sort()
      .slice(-HISTORY_DAYS);
  }

  trimHistory(extraDate = '') {
    const keep = new Set(this.historyDates(extraDate));
    for (const collection of [
      this.cache.data.scheduleHistory,
      this.cache.data.scheduleBases
    ]) {
      Object.keys(collection || {}).forEach(date => {
        if (!keep.has(date)) delete collection[date];
      });
    }
    // Fixture source state has a different retention contract from the
    // five-day UI history. Keep the independently watched source days even
    // before they have produced a display snapshot; otherwise constructing
    // today's snapshot would immediately discard tomorrow's prefetched
    // fixtures and force a five-second refetch loop.
    const today = this.client.beijingDate();
    const fixtureKeep = new Set([
      ...keep,
      this.scheduleDate(),
      today,
      this.client.dateAfter(today),
      this.client.dateAfter(today, -1)
    ]);
    Object.keys(this.cache.data.scheduleFixtures || {}).forEach(date => {
      if (!fixtureKeep.has(date)) delete this.cache.data.scheduleFixtures[date];
    });
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

  terminalMatches(date = this.scheduleDate()) {
    this.cache.data.terminalMatchesByDate ||= {};
    this.cache.data.terminalMatchesByDate[date] ||= {};
    if (date === this.scheduleDate()) {
      this.cache.data.terminalMatches = {
        date,
        items: this.cache.data.terminalMatchesByDate[date]
      };
    }
    return Object.values(this.cache.data.terminalMatchesByDate[date]);
  }

  matchScheduleDate(match = {}, fallbackDate = '') {
    if (match.scheduleDate || match.officialScheduleDate) {
      return match.scheduleDate || match.officialScheduleDate;
    }
    const id = String(match.id || '');
    if (id) {
      for (const [date, base] of Object.entries(this.cache.data.scheduleBases || {})) {
        if ((base.matches || []).some(candidate =>
          String(candidate.id || '') === id || String(candidate.providerId || '') === id)) {
          return date;
        }
      }
    }
    return fallbackDate || this.scheduleDate();
  }

  rememberTerminalMatches(items = [], write = true, fallbackDate = '') {
    let changed = false;
    for (const raw of items) {
      const match = raw?.first && raw?.tournament ? raw : normalizeMatch(raw);
      if (!match.id || match.status !== 'finished') continue;
      const date = this.matchScheduleDate(match, fallbackDate);
      this.cache.data.terminalMatchesByDate[date] ||= {};
      const saved = this.cache.data.terminalMatchesByDate[date];
      const key = String(match.id);
      // Persist a normalized terminal row with its official schedule day.
      // A provider may later change event_key or report the Beijing display
      // date; the logical lock must still compare inside the same schedule day.
      const next = structuredClone({
        ...match,
        scheduleDate: match.scheduleDate || date
      });
      if (JSON.stringify(saved[key]) === JSON.stringify(next)) continue;
      saved[key] = next;
      changed = true;
    }
    this.terminalMatches(this.scheduleDate());
    if (changed && write) this.cache.scheduleWrite();
    return changed;
  }

  knownFinishedMatches() {
    const collected = [];
    Object.values(this.cache.data.terminalMatchesByDate || {})
      .forEach(items => collected.push(...Object.values(items || {})));
    Object.values(this.cache.data.scheduleBases || {})
      .forEach(base => collected.push(...(base.matches || []).filter(match =>
        match.status === 'finished')));
    Object.values(this.cache.data.scheduleHistory || {})
      .forEach(snapshot => collected.push(...flatten(snapshot).filter(match =>
        match.status === 'finished')));
    const unique = new Map();
    collected.forEach(match => {
      const key = String(match.id || terminalFingerprint(match));
      if (key) unique.set(key, match);
    });
    return [...unique.values()];
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
      matches = this.officialValidator.reconcile(
        matches,
        date,
        this.knownFinishedMatches()
      );
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
    this.rememberTerminalMatches(matches, false, date);

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

  matchesForDate(date = this.scheduleDate()) {
    const base = this.scheduleBase(date);
    // Lock layer 1/2: persistent terminal cache is applied before the volatile
    // livescore response, so a stale live row cannot resurrect a finished row.
    let matches = overlayLiveScores(base, this.terminalMatches(date));
    matches = overlayLiveScores(matches, this.cache.data.live || []);
    // Lock layer 3: if a provider changes event_key, the logical pairing keeps
    // the finished copy.
    return lockTerminalMatches(matches);
  }

  activeMatches() {
    return this.matchesForDate(this.scheduleDate());
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

  providerBacked(match = {}) {
    return Boolean(
      match.providerId
      || (match.id && !String(match.id).startsWith('official:'))
    );
  }

  matchStart(match = {}) {
    if (!match.date || !/^\d{2}:\d{2}$/.test(String(match.time || ''))) return NaN;
    return Date.parse(`${match.date}T${match.time}:00+08:00`);
  }

  matchBlocksDayAdvance(match = {}) {
    if (match.status === 'finished' || match.status === 'cancelled') return false;
    if (match.officialMainTour === false) return false;
    const start = this.matchStart(match);
    if (!Number.isFinite(start)) {
      const fallback = Date.parse(`${match.scheduleDate || this.scheduleDate()}T12:00:00+08:00`)
        + 24 * 60 * 60_000;
      return this.now() <= fallback;
    }
    // A verified provider row gets a wider postponement window. OOP-only rows
    // are still watched in the background, but cannot freeze the default date
    // forever when the provider never acknowledges them.
    const grace = this.providerBacked(match)
      ? Math.max(this.config.observationAfterMs, 18 * 60 * 60_000)
      : this.config.observationAfterMs;
    return this.now() <= start + grace;
  }

  activeDayComplete(snapshot = this.snapshot) {
    // Cancelled rows are intentionally hidden from the public card list, so
    // a flattened snapshot can be empty even though the source base has
    // terminal rows. Fall back to the ungrouped base before deciding whether
    // the old official day may advance.
    const visible = flatten(snapshot);
    const matches = visible.length ? visible : this.activeMatches();
    return matches.length > 0 && !matches.some(match =>
      this.matchBlocksDayAdvance(match));
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

  scheduleFixtureState(date) {
    const saved = this.cache.data.scheduleFixtures?.[date];
    if (saved?.items) return saved;
    if (this.cache.data.fixtures?.date === date && this.cache.data.fixtures?.items) {
      return {
        ...this.cache.data.fixtures,
        odds: this.cache.data.prematchOdds?.date === date
          ? this.cache.data.prematchOdds.items
          : {},
        oddsFetchedAt: this.cache.data.prematchOdds?.date === date
          ? this.cache.data.prematchOdds.fetchedAt
          : 0
      };
    }
    return null;
  }

  scheduleHasUnresolved(date) {
    return (this.cache.data.scheduleBases?.[date]?.matches || []).some(match =>
      match.provisional
      || match.first?.alternatives?.length
      || match.second?.alternatives?.length
      || (match.officialScheduleMatch && !this.providerBacked(match)));
  }

  fixtureRefreshTtl(date) {
    if (this.scheduleHasUnresolved(date)) {
      return this.config.unresolvedFixturesTtlMs || 5 * 60_000;
    }
    if (date > this.client.beijingDate()) {
      return this.config.futureFixturesTtlMs || 60 * 60_000;
    }
    return this.config.fixturesTtlMs || 30 * 60_000;
  }

  async fetchScheduleDate(date, { force = false, active = false } = {}) {
    const dateStop = this.client.dateAfter(date);
    const fixtures = await this.client.fixtures(date, dateStop);
    const candidates = mergeMatches(fixtures, []).filter(isMainTour);
    this.rememberTerminalMatches(fixtures, false, date);
    const previous = this.scheduleFixtureState(date);
    const oddsFresh = previous?.odds
      && this.now() - (previous.oddsFetchedAt || 0)
        < (this.config.oddsTtlMs || 60 * 60_000);
    const [official, odds] = await Promise.all([
      this.refreshOfficial(date, force, candidates).catch(cause => {
        console.warn(`[official:${date}]`, cause.message);
        return null;
      }),
      oddsFresh
        ? Promise.resolve(previous.odds)
        : this.client.odds(date, dateStop).catch(cause => {
          console.warn(`[odds:${date}]`, cause.message);
          return previous?.odds || {};
        })
    ]);
    void official;

    this.cache.data.scheduleFixtures[date] = {
      fetchedAt: this.now(),
      oddsFetchedAt: oddsFresh ? previous.oddsFetchedAt : this.now(),
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
        fetchedAt: this.cache.data.scheduleFixtures[date].oddsFetchedAt,
        date,
        dateStop,
        items: odds
      };
      this.rememberTerminalMatches(fixtures, false);
    }
    const base = this.createScheduleBase(date, fixtures, odds);
    const historical = this.snapshotFromMatches(date, base.matches);
    if (base.matches.length || date <= this.client.beijingDate()) {
      this.rememberSnapshot(historical, false);
    }
    this.cache.scheduleWrite();
    return base;
  }

  async refreshScheduleDate(date, { force = false, active = false } = {}) {
    const saved = this.scheduleFixtureState(date);
    const fresh = saved?.items
      && this.now() - (saved.fetchedAt || 0) < this.fixtureRefreshTtl(date);
    if (!force && fresh) {
      const candidates = mergeMatches(saved.items, []).filter(isMainTour);
      await this.refreshOfficial(date, false, candidates).catch(cause =>
        console.warn(`[official:${date}]`, cause.message));
      const base = this.createScheduleBase(
        date,
        saved.items,
        saved.odds || {}
      );
      if (active) {
        this.cache.data.fixtures = {
          fetchedAt: saved.fetchedAt,
          date,
          dateStop: saved.dateStop,
          items: saved.items
        };
        this.cache.data.prematchOdds = {
          fetchedAt: saved.oddsFetchedAt || saved.fetchedAt,
          date,
          dateStop: saved.dateStop,
          items: saved.odds || {}
        };
      }
      if (base.matches.length || date <= this.client.beijingDate()) {
        this.rememberSnapshot(this.snapshotFromMatches(date, this.matchesForDate(date)), false);
      }
      return base;
    }
    return this.fetchScheduleDate(date, { force, active });
  }

  async refreshActiveSchedule(force = false) {
    return this.refreshScheduleDate(this.scheduleDate(), {
      force,
      active: true
    });
  }

  watchedScheduleDates() {
    const today = this.client.beijingDate();
    const tomorrow = this.client.dateAfter(today);
    const yesterday = this.client.dateAfter(today, -1);
    const dates = new Set([this.scheduleDate(), today, tomorrow]);
    if (this.cache.data.scheduleBases?.[yesterday]?.matches?.some(match =>
      match.status !== 'finished' && match.status !== 'cancelled')) {
      dates.add(yesterday);
    }
    return [...dates].filter(date => date >= HISTORY_START_DATE).sort();
  }

  async refreshAdditionalScheduleDates({ forceUnresolved = false } = {}) {
    for (const date of this.watchedScheduleDates()) {
      if (date === this.scheduleDate()) continue;
      try {
        await this.refreshScheduleDate(date, {
          force: forceUnresolved && this.scheduleHasUnresolved(date)
        });
      } catch (cause) {
        console.warn(`[schedule-watch:${date}]`, cause.message);
      }
    }
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
      if (this.cache.data.scheduleBases?.[date]?.matches?.length
        || this.scheduleFixtureState(date)?.items) continue;
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
      if (!this.watchedScheduleDates().includes(date)
        || this.now() - (reference.fetchedAt || 0) < ttl) continue;
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
    if (date === this.scheduleDate()) return false;
    const existed = Boolean(this.cache.data.scheduleBases?.[date]?.matches?.length);
    await this.refreshScheduleDate(date);
    return !existed;
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
    const watched = new Set(this.watchedScheduleDates());
    const delays = Object.entries(this.cache.data.officialReferences || {})
      .filter(([date, reference]) => {
        const atpTours = (reference?.tours || []).filter(tour => tour.tour === 'ATP');
        return watched.has(date) && atpTours.length;
      })
      .map(([, reference]) =>
        Math.max(5_000, (reference.fetchedAt || 0) + ttl - this.now()));
    return delays.length ? Math.min(...delays) : Number.POSITIVE_INFINITY;
  }

  fixtureScheduleRefreshDelay() {
    const delays = this.watchedScheduleDates().map(date => {
      const saved = this.scheduleFixtureState(date);
      if (!saved?.items) return 5_000;
      return Math.max(
        5_000,
        (saved.fetchedAt || 0) + this.fixtureRefreshTtl(date) - this.now()
      );
    });
    return delays.length ? Math.min(...delays) : Number.POSITIVE_INFINITY;
  }

  rebuildWatchedSnapshots() {
    for (const date of this.watchedScheduleDates()) {
      const saved = this.scheduleFixtureState(date);
      if (!saved?.items) continue;
      this.createScheduleBase(date, saved.items, saved.odds || {});
      this.rememberSnapshot(
        this.snapshotFromMatches(date, this.matchesForDate(date)),
        false
      );
    }
  }

  async refreshUnresolvedScheduleDates() {
    for (const date of this.watchedScheduleDates()) {
      if (!this.scheduleHasUnresolved(date)) continue;
      try {
        await this.refreshScheduleDate(date, {
          force: true,
          active: date === this.scheduleDate()
        });
      } catch (cause) {
        console.warn(`[schedule-resolve:${date}]`, cause.message);
      }
    }
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    let error = '';
    try {
      await this.refreshActiveSchedule();
      await this.refreshAdditionalScheduleDates();
      await this.backfillRecentDates();
      const observe = this.shouldObserve();
      if (observe) {
        const live = await this.client.livescore();
        const terminalChanged = this.rememberTerminalMatches(live, false);
        this.cache.data.live = live;
        if (terminalChanged) {
          // Resolve "A or B" immediately from the completed feeder, then ask
          // fixtures for the provider event id without waiting for the normal
          // date TTL.
          this.rebuildWatchedSnapshots();
          await this.refreshUnresolvedScheduleDates();
        }
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
    const fixtureRefresh = this.fixtureScheduleRefreshDelay();
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
