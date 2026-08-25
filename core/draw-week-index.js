'use strict';

const { normalizeLevelCode, levelLabel } = require('./localization');

const CALENDAR_CACHE_SCHEMA = 'calendar-projection-bff/1';

const LEVEL_PRIORITY = Object.freeze({
  grand_slam: 10000,
  masters_1000: 9000,
  wta_1000: 9000,
  tour_500: 8000,
  wta_500: 8000,
  tour_250: 7000,
  wta_250: 7000,
  challenger_175: 6175,
  challenger_125: 6125,
  wta_125: 6125,
  challenger_100: 6100,
  challenger_75: 6075,
  challenger_50: 6050,
  itf_w100: 5100,
  itf_w75: 5075,
  itf_w50: 5050,
  itf_w35: 5035,
  itf_m25: 5025,
  itf_m15: 5015,
  itf_w15: 5015
});

const TOUR_PRIORITY = Object.freeze({
  'ATP/WTA': 5,
  ATP: 4,
  WTA: 3,
  CHALLENGER: 2,
  ITF: 1,
  UNKNOWN: 0
});

function calendarCacheKey(year) { return 'calendar_projection:' + year; }

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'object') return '';
  if (value.state === 'available' || value.state === 'known') {
    return text(value.displayText) || text(value.value);
  }
  return text(value.displayText)
    || text(value.label)
    || text(value.name)
    || text(value.title)
    || text(value.value);
}

function field(candidate, fallback = '') {
  return text(candidate) || fallback;
}

function isMachineLabel(value) {
  const source = String(value || '').trim();
  return /^[a-z]{2,}[a-z0-9_]*$/u.test(source) || /^[A-Z]{2,}_[A-Z0-9_]+$/u.test(source);
}

function displayLevel(summary = {}) {
  const rawTier = field(summary.tierDisplayName);
  const code = normalizeLevelCode(field(summary.levelCode) || field(summary.tierCode) || rawTier);
  const localized = levelLabel(code);
  if (localized) return localized;
  return rawTier && !isMachineLabel(rawTier) ? rawTier : field(summary.levelCode);
}

function displaySurface(value) {
  const raw = field(value);
  const code = raw.toLocaleLowerCase('en-US');
  if (code === 'hard') return '硬地';
  if (code === 'clay') return '红土';
  if (code === 'grass') return '草地';
  if (code === 'indoor_hard') return '室内硬地';
  return raw && !isMachineLabel(raw) ? raw : '';
}

function displayLocation(value, title = '') {
  const raw = field(value);
  if (!raw) return '';
  const titleText = String(title || '').trim();
  const parts = raw.split('·').map(item => item.trim()).filter(Boolean)
    .filter(item => item !== titleText);
  return (parts.length ? parts.join(' · ') : raw).trim();
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    + `-${String(now.getDate()).padStart(2, '0')}`;
}

function utcDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

function isoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    + `-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDays(value, amount) {
  const date = utcDate(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDate(date);
}

function weekStart(value) {
  const date = utcDate(value || todayIso());
  if (!date) return '';
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return isoDate(date);
}

function yearOf(value) {
  const date = utcDate(value || todayIso());
  return date ? date.getUTCFullYear() : new Date().getFullYear();
}

function weekRangeLabel(value = '') {
  const start = utcDate(weekStart(value || todayIso()));
  if (!start) return '';
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const startLabel = `${start.getUTCMonth() + 1}月${start.getUTCDate()}日`;
  const endLabel = start.getUTCMonth() === end.getUTCMonth()
    ? `${end.getUTCDate()}日` : `${end.getUTCMonth() + 1}月${end.getUTCDate()}日`;
  return `${startLabel}—${endLabel}`;
}

function dateRange(item) {
  const dates = item?.dates || {};
  const startDate = field(dates.currentDateRange?.start)
    || field(dates.officialStartLocalDate)
    || field(dates.startDate)
    || field(item?.startDate);
  const endDate = field(dates.currentDateRange?.end)
    || field(dates.officialEndLocalDate)
    || field(dates.endDate)
    || startDate;
  return Object.freeze({ startDate, endDate });
}

function overlapsWeek(item, targetDate) {
  const start = weekStart(targetDate || todayIso());
  const end = addDays(start, 6);
  const range = dateRange(item);
  if (!range.startDate) return true;
  return range.startDate <= end && (range.endDate || range.startDate) >= start;
}

function drawAvailable(item) {
  const status = String(item?.capabilities?.draws?.status || '').toLowerCase();
  return status === 'available' || status === 'partial';
}

function calendarItems(projection) {
  if (projection?.bffContractVersion !== CALENDAR_CACHE_SCHEMA) return [];
  return Array.isArray(projection.presentation?.items) ? projection.presentation.items : [];
}

function tourInfo(item) {
  const bucket = String(item?.identity?.tourBucket || '').toLowerCase();
  const level = normalizeLevelCode(field(item?.summary?.levelCode) || field(item?.summary?.tierCode));
  const authority = field(item?.summary?.authority).toUpperCase();
  const authorities = Array.isArray(item?.summary?.authorities)
    ? item.summary.authorities.map(value => String(value || '').trim().toUpperCase()).filter(Boolean)
    : [];
  const joint = item?.summary?.isJoint === true
    || authority === 'ATP/WTA'
    || authority === 'WTA/ATP'
    || (authorities.includes('ATP') && authorities.includes('WTA'));
  if (joint) {
    return Object.freeze({
      filter: 'ATP/WTA',
      filters: Object.freeze(['ATP', 'WTA']),
      requestTour: '',
      tourOrg: 'ATP/WTA'
    });
  }
  if (bucket === 'wta' || bucket === 'wta_125' || level === 'wta_125' || /^wta_/u.test(level)) {
    return Object.freeze({ filter: 'WTA', requestTour: 'wta', tourOrg: 'WTA' });
  }
  if (bucket === 'atp_challenger' || /^challenger_/u.test(level)) {
    return Object.freeze({ filter: 'CHALLENGER', requestTour: 'atp', tourOrg: 'CHALLENGER' });
  }
  if (bucket === 'itf' || /^itf_/u.test(level)) {
    return Object.freeze({ filter: 'ITF', requestTour: '', tourOrg: 'ITF' });
  }
  if (bucket === 'atp' || /^atp_|^tour_/u.test(level) || authority === 'ATP') {
    return Object.freeze({ filter: 'ATP', requestTour: 'atp', tourOrg: 'ATP' });
  }
  if (authority === 'WTA') return Object.freeze({ filter: 'WTA', requestTour: 'wta', tourOrg: 'WTA' });
  return Object.freeze({ filter: 'UNKNOWN', requestTour: '', tourOrg: 'UNKNOWN' });
}

function tournamentOptionFromCalendarItem(item) {
  const id = field(item?.identity?.tournamentEditionId, field(item?.tournamentEditionId));
  if (!id || !drawAvailable(item)) return null;
  const range = dateRange(item);
  const levelCode = normalizeLevelCode(field(item?.summary?.levelCode) || field(item?.summary?.tierCode));
  const levelDisplay = displayLevel(item?.summary) || levelLabel(levelCode);
  const info = tourInfo(item);
  const title = field(item?.summary?.headline, '赛事');
  const location = displayLocation(item?.summary?.locationSubtitle, title);
  const surface = displaySurface(item?.summary?.surface);
  const tourFilters = info.filters || [info.filter].filter(value => value && value !== 'UNKNOWN');
  const meta = [info.tourOrg, levelDisplay, location, surface].filter(Boolean).join(' · ');
  const summaryMeta = [info.tourOrg, location, surface].filter(Boolean).join(' · ');
  return Object.freeze({
    id,
    title,
    location,
    surface,
    tourOrg: info.tourOrg,
    tourFilters: Object.freeze(tourFilters),
    requestTour: info.requestTour,
    levelCode,
    levelDisplay,
    meta,
    summaryMeta,
    status: field(item?.displayLifecycle?.label),
    startDate: range.startDate,
    endDate: range.endDate,
    searchText: [
      title,
      location,
      levelDisplay,
      surface,
      info.filter,
      info.tourOrg
    ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN')
  });
}

function mergeTournamentOptions(values) {
  const byId = new Map();
  for (const item of values) {
    if (!item) continue;
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, { ...item, tourFilters: new Set(item.tourFilters), searchTextParts: [item.searchText] });
      continue;
    }
    for (const filter of item.tourFilters) existing.tourFilters.add(filter);
    existing.tourOrg = mergeTourOrg(existing.tourOrg, item.tourOrg);
    existing.requestTour = existing.requestTour === item.requestTour ? existing.requestTour : '';
    existing.levelCode = choosePreferred(existing.levelCode, item.levelCode);
    existing.levelDisplay = existing.levelDisplay || item.levelDisplay;
    existing.location = existing.location || item.location;
    existing.surface = existing.surface || item.surface;
    existing.status = existing.status || item.status;
    existing.meta = [existing.tourOrg, existing.levelDisplay, existing.location, existing.surface]
      .filter(Boolean).join(' · ');
    existing.summaryMeta = [existing.tourOrg, existing.location, existing.surface]
      .filter(Boolean).join(' · ');
    existing.startDate = [existing.startDate, item.startDate].filter(Boolean).sort()[0] || '';
    existing.endDate = [existing.endDate, item.endDate].filter(Boolean).sort().pop() || '';
    existing.searchTextParts.push(item.searchText);
  }
  return [...byId.values()].map(value => Object.freeze({
    ...value,
    tourFilters: Object.freeze([...value.tourFilters]),
    searchText: value.searchTextParts.join(' ').toLocaleLowerCase('zh-CN'),
    searchTextParts: undefined
  }));
}

function choosePreferred(first, second) {
  const firstPriority = LEVEL_PRIORITY[first] || 0;
  const secondPriority = LEVEL_PRIORITY[second] || 0;
  return secondPriority > firstPriority ? second : first;
}

function mergeTourOrg(first, second) {
  if (!first || first === 'UNKNOWN') return second || '';
  if (!second || second === 'UNKNOWN' || first === second) return first;
  if ((first === 'ATP' && second === 'WTA') || (first === 'WTA' && second === 'ATP')) return 'ATP/WTA';
  return first.includes(second) ? first : `${first}/${second}`;
}

function tournamentOptionsFromCalendarProjection(projection, targetDate = '') {
  return mergeTournamentOptions(
    calendarItems(projection)
      .filter(item => overlapsWeek(item, targetDate || todayIso()))
      .map(tournamentOptionFromCalendarItem)
  ).sort((first, second) => {
    const firstLevel = LEVEL_PRIORITY[first.levelCode] || 0;
    const secondLevel = LEVEL_PRIORITY[second.levelCode] || 0;
    if (firstLevel !== secondLevel) return secondLevel - firstLevel;
    const firstTour = TOUR_PRIORITY[first.tourOrg] || 0;
    const secondTour = TOUR_PRIORITY[second.tourOrg] || 0;
    if (firstTour !== secondTour) return secondTour - firstTour;
    return (first.startDate || '').localeCompare(second.startDate || '')
      || first.title.localeCompare(second.title, 'zh-CN');
  });
}

module.exports = Object.freeze({
  CALENDAR_CACHE_SCHEMA,
  calendarCacheKey,
  tournamentOptionsFromCalendarProjection,
  weekRangeLabel,
  yearOf
});
