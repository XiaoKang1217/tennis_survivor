'use strict';

const ENTRY_INDEX_CACHE_SCHEMA = 'entry-index-lite/1';
const ENTRY_SUMMARY_CACHE_SCHEMA = 'entry-index-summary/1';
const ENTRY_PLAYER_PAGE_SCHEMA = 'entry-player-page/1';

function pick(source, keys) {
  const result = {};
  for (const key of keys) {
    if (source?.[key] !== undefined) result[key] = source[key];
  }
  return result;
}

const TOURNAMENT_FIELDS = Object.freeze([
  'tournamentId', 'tournamentName', 'originalTournamentName', 'tour', 'weekStart',
  'competitionLevel', 'surface', 'startsOn', 'endsOn', 'entryCount'
]);
const PLAYER_FIELDS = Object.freeze([
  'playerId', 'playerName', 'originalPlayerName', 'countryCode', 'tour',
  'worldRanking', 'portraitUrl', 'entryCount'
]);
const APPEARANCE_FIELDS = Object.freeze([
  'tournamentId', 'tournamentName', 'tour', 'weekStart', 'surface', 'startsOn',
  'endsOn'
]);

function compactAppearance(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    ...pick(value, APPEARANCE_FIELDS),
    status: value.status || value.entryStatus,
    entryListScope: value.entryListScope || value.drawStage
  };
}

function appearanceIdentity(value = {}) {
  if (!value || typeof value !== 'object') return '';
  return [value.tournamentId, value.startsOn || value.weekStart, value.status,
    value.entryListScope].map(item => String(item || '')).join('|');
}

function compactEntryIndex(value) {
  if (!value || typeof value !== 'object' || !value.payload || typeof value.payload !== 'object') {
    throw new Error('entry_index_projection_invalid');
  }
  if (value.schemaVersion === ENTRY_INDEX_CACHE_SCHEMA) return value;
  const payload = value.payload;
  if (!Array.isArray(payload.tournaments) || !Array.isArray(payload.players)) {
    throw new Error('entry_index_projection_invalid');
  }
  return {
    contractVersion: value.contractVersion,
    schemaVersion: ENTRY_INDEX_CACHE_SCHEMA,
    projectionVersion: value.projectionVersion,
    projectionKey: value.projectionKey,
    dataAsOf: value.dataAsOf,
    delivery: value.delivery,
    payload: {
      dataAsOf: payload.dataAsOf,
      quality: pick(payload.quality, ['identityCoverage']),
      sourceWeeks: payload.sourceWeeks && typeof payload.sourceWeeks === 'object'
        ? payload.sourceWeeks : {},
      tournaments: payload.tournaments.map(item => pick(item, TOURNAMENT_FIELDS)),
      players: payload.players.map(item => {
        const nextAppearance = compactAppearance(item.nextAppearance);
        const appearances = Array.isArray(item.appearances)
          ? item.appearances.map(compactAppearance).filter(Boolean) : [];
        const nextAppearanceKey = appearanceIdentity(nextAppearance);
        if (nextAppearance && nextAppearanceKey
          && !appearances.some(entry => appearanceIdentity(entry) === nextAppearanceKey)) {
          appearances.unshift(nextAppearance);
        }
        return { ...pick(item, PLAYER_FIELDS), nextAppearanceKey, appearances };
      })
    }
  };
}

function validateEntrySummary(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== ENTRY_SUMMARY_CACHE_SCHEMA
    || !value.payload || !Array.isArray(value.payload.tournaments)) {
    throw new Error('entry_summary_validate_failed');
  }
  return value;
}

function validateEntryPlayerPage(value) {
  const payload = value?.payload;
  if (!value || value.schemaVersion !== ENTRY_PLAYER_PAGE_SCHEMA || !payload
    || !Array.isArray(payload.players) || !Number.isSafeInteger(Number(payload.total))) {
    throw new Error('entry_player_page_validate_failed');
  }
  return value;
}

function jsonByteSize(value) {
  const text = JSON.stringify(value);
  return typeof TextEncoder === 'function'
    ? new TextEncoder().encode(text).length
    : unescape(encodeURIComponent(text)).length;
}

module.exports = Object.freeze({
  ENTRY_INDEX_CACHE_SCHEMA,
  ENTRY_SUMMARY_CACHE_SCHEMA,
  ENTRY_PLAYER_PAGE_SCHEMA,
  appearanceIdentity,
  compactEntryIndex,
  validateEntrySummary,
  validateEntryPlayerPage,
  jsonByteSize
});
