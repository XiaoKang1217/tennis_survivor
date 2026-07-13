import { createHash } from 'node:crypto';

import { canonicalPlayerKey } from './manager-utils.mjs';
import { buildStationPayload } from './station-payload.mjs';

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const SNAPSHOT_TABLE = 'tour_manager_station_publication_snapshots';

const PUBLICATION_KINDS = new Set([
  'initial_open',
  'window_amendment',
  'market_amendment',
  'manual_backfill'
]);

const WINDOW_FIELDS = [
  'submission_opens_at',
  'main_draw_first_match_at',
  'submission_cutoff_at',
  'submission_closes_at',
  'round1_completed_at',
  'round2_first_match_at',
  'transfer_window_opens_at',
  'transfer_window_closes_at',
  'transfer_window_note',
  'transfer_window_days',
  'transfer_fee_rate'
];

const LEVEL_RULES = {
  '250': { minPlayers: 1, maxPlayers: 2, transfers: 1, transferDays: 2, transferFeeRate: 0.10 },
  '500': { minPlayers: 1, maxPlayers: 2, transfers: 1, transferDays: 2, transferFeeRate: 0.10 },
  '1000': { minPlayers: 2, maxPlayers: 3, transfers: 1, transferDays: 3, transferFeeRate: 0.15 },
  GS: { minPlayers: 2, maxPlayers: 4, transfers: 1, transferDays: 3, transferFeeRate: 0.15 }
};

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function fileDigest(value) {
  return sha256(typeof value === 'string' ? value : canonicalJson(value));
}

export function publicationReadiness({ active, events, now = new Date(), allowBackfill = false }) {
  const reasons = [];
  if (!active?.station_key) reasons.push('station_key_missing');
  if (!Number.isInteger(Number(active?.season))) reasons.push('season_missing');
  if (!events.length) reasons.push('events_missing');
  if (!allowBackfill && active?.status !== 'open') reasons.push('station_not_open');

  for (const { event } of events) {
    if (!event?.event_key) reasons.push('event_key_missing');
    if (!allowBackfill && event?.market_status !== 'open') {
      reasons.push(`${event?.event_key || 'unknown'}_market_not_open`);
    }
    if (!(event?.players || []).length) reasons.push(`${event?.event_key || 'unknown'}_market_empty`);
  }

  const opensAt = stationOpenTime(active, events);
  if (!allowBackfill && opensAt && now < opensAt) reasons.push('submission_not_open_yet');

  const rules = active?.rules || {};
  if (!Number.isFinite(Number(rules.station_grant)) || Number(rules.station_grant) < 0) {
    reasons.push('station_grant_missing');
  }
  if (!rules.combo_version) reasons.push('combo_version_missing');
  if (!rules.combo || typeof rules.combo !== 'object' || Array.isArray(rules.combo)) {
    reasons.push('combo_rules_missing');
  }

  return {
    ready: reasons.length === 0,
    reasons: [...new Set(reasons)],
    station_open_at: opensAt ? opensAt.toISOString() : null
  };
}

export function buildPublicationRow({
  active,
  events,
  publicationVersion = 1,
  publicationKind = 'initial_open',
  publishedAt,
  sourceRef = 'working-tree',
  sourceFiles = [],
  priceVersion = null,
  activeFile = 'data/manager/active_events.json',
  photoData = {},
  photoFile = 'data/manager/player_photos.json'
}) {
  if (!PUBLICATION_KINDS.has(publicationKind)) {
    throw new Error(`Unsupported publication kind: ${publicationKind}.`);
  }
  const rules = active.rules || {};
  const stationGrant = Number(rules.station_grant);
  if (!Number.isFinite(stationGrant) || stationGrant < 0) {
    throw new Error('A non-negative active.rules.station_grant is required for publication.');
  }
  if (!rules.combo_version || !rules.combo || typeof rules.combo !== 'object') {
    throw new Error('active.rules must include combo_version and complete combo rules.');
  }

  const normalizedEvents = [...events]
    .map(({ item, event, path: sourcePath }) => ({
      item: { ...item },
      event: clone(event),
      sourcePath: sourcePath || item.path || `data/manager/${item.data_file}`
    }))
    .sort((a, b) => String(a.event.event_key).localeCompare(String(b.event.event_key)));
  validateMarket(normalizedEvents);

  const payload = buildStationPayload({
    active,
    events: normalizedEvents,
    photoMap: photoData.players || {},
    priceVersion: priceVersion?.version || publicationVersion,
    priceStatus: priceVersion?.status || 'published'
  });
  const effectivePublishedAt = normalizeIso(
    publishedAt || stationOpenTime(active, normalizedEvents)?.toISOString() || active.updated_at
  );
  if (!effectivePublishedAt) throw new Error('A valid published_at timestamp is required.');

  const market = normalizedEvents.map(({ event }) => ({
    event_key: event.event_key,
    tour: event.tour,
    player_count: (event.players || []).length,
    players: [...(event.players || [])].sort(comparePlayers).map((player) => ({
      ...player,
      publication_photo: resolvePublicationPhoto(photoData, event.tour, player)
    }))
  }));
  const eventConfigs = normalizedEvents.map(({ event, sourcePath }) => ({
    source_file: sourcePath,
    ...withoutPlayers(event)
  }));
  const windows = normalizedEvents.map(({ event }) => ({
    event_key: event.event_key,
    tour: event.tour,
    ...Object.fromEntries(WINDOW_FIELDS.map((field) => [field, event[field] ?? null]))
  }));
  const pricingPlayers = [...payload.priceRows].sort((a, b) => {
    const eventOrder = String(a.event_key).localeCompare(String(b.event_key));
    return eventOrder || String(a.player_key).localeCompare(String(b.player_key));
  });
  const selectedPriceVersion = {
    ...clone(priceVersion || derivedPriceVersion(normalizedEvents)),
    content_hash: sha256(canonicalJson({
      formulas: pricingFormulas(normalizedEvents),
      players: pricingPlayers
    }))
  };
  const effectiveRules = effectiveStationRules(rules, normalizedEvents);

  const snapshot = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    publication: {
      station_key: active.station_key,
      station_name: active.station_name,
      season: Number(active.season),
      version: Number(publicationVersion),
      kind: publicationKind,
      published_at: effectivePublishedAt,
      source_ref: sourceRef
    },
    station_config: {
      survivor_aligned: active.survivor_aligned !== false,
      status: active.status,
      station_grant: Math.round(stationGrant),
      combo_version: rules.combo_version,
      combo: clone(rules.combo),
      rules: clone(rules),
      effective_rules: effectiveRules,
      notes: clone(active.notes || [])
    },
    events: eventConfigs,
    market,
    pricing: {
      selected_version: clone(selectedPriceVersion),
      player_count: pricingPlayers.length,
      players: pricingPlayers
    },
    photos: {
      source_file: photoFile,
      updated_at: photoData.updated_at || null,
      policy: photoData.policy || null,
      fallbacks: clone(photoData.fallbacks || {}),
      selected_players: selectedPhotoRegistry(photoData, normalizedEvents)
    },
    windows,
    provenance: {
      active_file: activeFile,
      source_ref: sourceRef,
      files: [...sourceFiles].sort((a, b) => String(a.path).localeCompare(String(b.path)))
    }
  };
  const canonicalPayload = canonicalJson(snapshot);
  const dataHash = sha256(canonicalPayload);
  const eventKeys = eventConfigs.map((event) => event.event_key).sort();

  return {
    station_key: active.station_key,
    season: Number(active.season),
    publication_version: Number(publicationVersion),
    publication_kind: publicationKind,
    snapshot_schema_version: SNAPSHOT_SCHEMA_VERSION,
    published_at: effectivePublishedAt,
    event_keys: eventKeys,
    station_grant: Math.round(stationGrant),
    combo_version: rules.combo_version,
    price_version_id: selectedPriceVersion.id || null,
    price_version: selectedPriceVersion.version != null && Number.isFinite(Number(selectedPriceVersion.version))
      ? Number(selectedPriceVersion.version)
      : null,
    hash_algorithm: 'sha256',
    data_hash: dataHash,
    canonical_payload: canonicalPayload,
    snapshot,
    source: {
      source_ref: sourceRef,
      source_files: sourceFiles.map((item) => item.path),
      generator: 'scripts/manager/publish-station-snapshot.mjs'
    }
  };
}

export function archiveDocument(row) {
  return {
    station_key: row.station_key,
    season: row.season,
    publication_version: row.publication_version,
    publication_kind: row.publication_kind,
    snapshot_schema_version: row.snapshot_schema_version,
    published_at: row.published_at,
    event_keys: row.event_keys,
    station_grant: row.station_grant,
    combo_version: row.combo_version,
    price_version_id: row.price_version_id,
    price_version: row.price_version,
    hash_algorithm: row.hash_algorithm,
    data_hash: row.data_hash,
    snapshot: row.snapshot,
    source: row.source
  };
}

function stationOpenTime(active, events) {
  const values = events
    .map(({ event }) => parseDate(event.submission_opens_at))
    .filter(Boolean)
    .sort((a, b) => b - a);
  return values[0] || parseDate(active?.updated_at);
}

function pricingFormulas(events) {
  return events.map(({ event }) => ({
    event_key: event.event_key,
    formula: clone(event.pricing_formula || {}),
    generated_at: event.pricing_formula?.generated_at || null
  }));
}

function derivedPriceVersion(events) {
  const formulas = pricingFormulas(events);
  return {
    id: null,
    version: null,
    status: 'published',
    formula_version: [...new Set(formulas.map((item) => item.formula.formula_version).filter(Boolean))].join('+') || 'event_snapshot',
    generated_from: { event_formulas: formulas }
  };
}

function effectiveStationRules(rules, events) {
  const levels = events.map(({ event }) => String(event.level || '500'));
  const configs = levels.map((level) => LEVEL_RULES[level] || LEVEL_RULES['500']);
  const topConfig = configs.reduce((best, current) => (
    current.transferFeeRate > best.transferFeeRate ? current : best
  ), LEVEL_RULES['250']);
  const eventFees = events
    .map(({ event }) => Number(event.transfer_fee_rate))
    .filter(Number.isFinite);
  const eventTransferDays = events
    .map(({ event }) => Number(event.transfer_window_days))
    .filter(Number.isFinite);

  return {
    min_players: configuredNumber(rules.min_players, Math.min(...configs.map((item) => item.minPlayers))),
    max_players: configuredNumber(rules.max_players, configs.reduce((sum, item) => sum + item.maxPlayers, 0)),
    transfers: configuredNumber(rules.transfers, topConfig.transfers),
    transfer_days: configuredNumber(
      rules.transfer_days,
      eventTransferDays.length ? Math.max(...eventTransferDays) : topConfig.transferDays
    ),
    transfer_fee_rate: configuredNumber(
      rules.transfer_fee_rate,
      eventFees.length ? Math.max(...eventFees) : topConfig.transferFeeRate
    ),
    station_grant: Math.round(Number(rules.station_grant)),
    combo_version: rules.combo_version
  };
}

function configuredNumber(value, fallback) {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function selectedPhotoRegistry(photoData, events) {
  const players = photoData.players || {};
  const selected = {};
  for (const { event } of events) {
    for (const player of event.players || []) {
      const resolved = resolvePublicationPhoto(photoData, event.tour, player);
      if (resolved.registry_key && players[resolved.registry_key]) {
        selected[resolved.registry_key] = clone(players[resolved.registry_key]);
      }
    }
  }
  return Object.fromEntries(Object.entries(selected).sort(([left], [right]) => left.localeCompare(right)));
}

function resolvePublicationPhoto(photoData, tour, player) {
  const players = photoData.players || {};
  const canonicalKey = canonicalPlayerKey(tour, player);
  const candidates = [
    player.player_key,
    canonicalKey,
    player.name_zh ? `${tour}|${player.name_zh}` : null
  ].filter(Boolean);
  const registryKey = candidates.find((key) => players[key]) || null;
  const registry = registryKey ? players[registryKey] : null;
  const photoUrl = photoValue(registry, false)
    || player.photo_url
    || player.profile_image_url
    || player.full_body_url
    || player.body_url
    || photoData.fallbacks?.[tour]
    || null;
  const fullBodyUrl = photoValue(registry, true)
    || player.full_body_url
    || player.body_url
    || player.photo_full_url
    || photoUrl;
  return {
    registry_key: registryKey,
    photo_url: photoUrl,
    full_body_url: fullBodyUrl,
    status: registry?.status || (photoUrl ? 'source' : 'missing')
  };
}

function photoValue(value, fullBody) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (fullBody) {
    return value.full_body_url || value.body_url || value.photo_full_url || value.photo_url || null;
  }
  return value.photo_url || value.profile_image_url || value.full_body_url || value.body_url || null;
}

function validateMarket(events) {
  for (const { event } of events) {
    const seen = new Set();
    for (const player of event.players || []) {
      const key = player.player_key || `${event.tour}|${player.name_en || player.name_zh}`;
      if (seen.has(key)) throw new Error(`Duplicate market player ${key} in ${event.event_key}.`);
      seen.add(key);
      if (!Number.isFinite(Number(player.price)) || Number(player.price) < 0) {
        throw new Error(`Invalid price for ${key} in ${event.event_key}.`);
      }
    }
  }
}

function comparePlayers(a, b) {
  const position = Number(a.draw_position || Number.MAX_SAFE_INTEGER) - Number(b.draw_position || Number.MAX_SAFE_INTEGER);
  if (position) return position;
  return String(a.player_key || a.name_en || a.name_zh).localeCompare(String(b.player_key || b.name_en || b.name_zh));
}

function withoutPlayers(event) {
  const copy = clone(event);
  delete copy.players;
  return copy;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortJson(value[key])])
  );
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeIso(value) {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
