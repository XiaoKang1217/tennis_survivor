/**
 * Map livetennisapi.com live matches onto the official schedule.
 *
 * This module exists to keep the optional secondary source inside the same
 * data-production boundary as `get_livescore`: it may fill score state on a
 * match the official schedule already contains, and it may do nothing else.
 *
 * The rules it holds to, in order of how much damage breaking them would do:
 *
 * 1. It never creates a match. A provider row that does not resolve to exactly
 *    one scheduled match is dropped.
 * 2. It never writes a terminal state. Only `live` rows are emitted, so this
 *    layer cannot lock a match as finished, cancel one, or hide one. Completion
 *    stays with `get_fixtures`, the ATP/WTA official references, and the three
 *    existing terminal locks.
 * 3. It never asserts identity fields. Each update is a copy of the scheduled
 *    match with only the volatile scoring fields replaced, so tournament, date,
 *    time, court, surface and players cannot move even if this file is wrong.
 * 4. It never invents a score. Sets come only from integer game counts the
 *    provider actually returned; a completed match with an empty games array
 *    contributes nothing rather than a synthesised scoreline.
 * 5. It never bridges id spaces. The join is an exact normalized player-pair
 *    within the schedule day, and any ambiguity on either side drops the row.
 *    No provider id is written onto the schedule.
 */

import { identity } from './normalizer.mjs';

const AMBIGUOUS = Symbol('ambiguous');

function nameKey(value) {
  return identity(value ?? '');
}

function schedulePlayerKey(player = {}) {
  return nameKey(player.nameEn || player.name);
}

function pairKey(firstKey, secondKey) {
  if (!firstKey || !secondKey) return '';
  return [firstKey, secondKey].sort().join('|');
}

function isScheduleDoubles(match = {}) {
  return /doubles/i.test(String(match.type || ''));
}

/**
 * Index the schedule by player pair. A pair that appears more than once in the
 * same day cannot be resolved, so it is poisoned rather than guessed at.
 */
export function indexSchedule(schedule = []) {
  const index = new Map();
  for (const match of schedule) {
    if (isScheduleDoubles(match)) continue;
    const key = pairKey(schedulePlayerKey(match.first), schedulePlayerKey(match.second));
    if (!key) continue;
    index.set(key, index.has(key) ? AMBIGUOUS : match);
  }
  return index;
}

function providerPlayerKey(player = {}) {
  return nameKey(player.name);
}

/**
 * Per-set game counts, in schedule order.
 *
 * Stops at the first set the provider did not report as a pair of integers, so
 * set numbering stays contiguous and a partial array never shifts later sets.
 */
export function toScheduleSets(score = {}) {
  const games = Array.isArray(score?.games) ? score.games : [];
  const firstGames = Array.isArray(games[0]) ? games[0] : [];
  const secondGames = Array.isArray(games[1]) ? games[1] : [];
  const sets = [];
  for (let index = 0; index < Math.min(firstGames.length, secondGames.length); index += 1) {
    const first = firstGames[index];
    const second = secondGames[index];
    if (!Number.isInteger(first) || !Number.isInteger(second)) break;
    sets.push({ set: index + 1, first: String(first), second: String(second) });
  }
  return sets;
}

/**
 * In-game points. Entries are nullable in the provider schema, so anything but
 * two strings means "not known", not "love".
 */
export function toCurrentPoints(score = {}) {
  const points = Array.isArray(score?.points) ? score.points : [];
  const [first, second] = points;
  if (typeof first !== 'string' || typeof second !== 'string') return null;
  return { first, second };
}

function side(value, swapped) {
  if (value !== 1 && value !== 2) return '';
  const isFirst = value === 1 ? !swapped : swapped;
  return isFirst ? 'first' : 'second';
}

/**
 * Build overlay updates for the matches this provider can be trusted about.
 *
 * @param {Array} providerMatches rows from GET /matches?status=live
 * @param {Array} schedule the official schedule, which is the allow-list
 * @returns {Array} normalized matches carrying only volatile scoring changes
 */
export function toOverlayUpdates(providerMatches = [], schedule = [], now = Date.now()) {
  const index = indexSchedule(schedule);

  // Group the provider side first: two live rows for one pairing is the same
  // unresolvable ambiguity as two scheduled matches for one pairing.
  const byPair = new Map();
  for (const raw of providerMatches) {
    if (!raw || raw.is_doubles) continue;
    if (String(raw.status || '') !== 'live') continue;
    const key = pairKey(providerPlayerKey(raw.players?.p1), providerPlayerKey(raw.players?.p2));
    if (!key) continue;
    byPair.set(key, byPair.has(key) ? AMBIGUOUS : raw);
  }

  const updates = [];
  for (const [key, raw] of byPair) {
    if (raw === AMBIGUOUS) continue;
    const target = index.get(key);
    if (!target || target === AMBIGUOUS) continue;

    // Orientation is resolved by name, never by position: the provider is free
    // to list the pairing the other way round from the official schedule.
    const providerFirst = providerPlayerKey(raw.players?.p1);
    const scheduleFirst = schedulePlayerKey(target.first);
    const scheduleSecond = schedulePlayerKey(target.second);
    let swapped;
    if (providerFirst === scheduleFirst) swapped = false;
    else if (providerFirst === scheduleSecond) swapped = true;
    else continue;

    const sets = toScheduleSets(raw.score);
    const current = toCurrentPoints(raw.score);
    const ordered = swapped
      ? sets.map(set => ({ set: set.set, first: set.second, second: set.first }))
      : sets;

    updates.push({
      // A copy of the scheduled match: identity fields are carried through
      // unchanged so this layer is structurally unable to move them.
      ...structuredClone(target),
      status: 'live',
      statusText: 'Live',
      sets: ordered,
      current: current
        ? (swapped ? { first: current.second, second: current.first } : { ...current })
        : { first: '', second: '' },
      serve: side(raw.score?.server, swapped),
      // The provider reports a point-in-time snapshot with no previous state,
      // so which side won the last point is not knowable here.
      lastPoint: '',
      rawUpdatedAt: now
    });
  }
  return updates;
}
