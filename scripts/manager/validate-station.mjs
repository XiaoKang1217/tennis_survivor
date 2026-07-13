#!/usr/bin/env node
import { loadActiveStation, buildStationPayload } from './lib/station-payload.mjs';
import {
  canonicalPlayerKey,
  parseArgs,
  readJson,
  writeJson
} from './lib/manager-utils.mjs';

const args = parseArgs();
const activeFile = args.active || 'data/manager/active_events.json';
const photoFile = args.photos || 'data/manager/player_photos.json';
const output = args.output || '';

const { active, events } = await loadActiveStation(activeFile);
const photos = await readJson(photoFile).catch(() => ({ players: {} }));
const payload = buildStationPayload({
  active,
  events,
  photoMap: photos.players || {},
  priceVersion: args['price-version'] || 1,
  priceStatus: args['price-status'] || 'draft'
});

const errors = [];
const warnings = [];
const eventReports = [];
const now = new Date();
const openEventWindows = [];
const priceLock = active.pricing?.market_prices_locked === true ? active.pricing : null;
const lockedMarketByEvent = new Map();

if (priceLock) {
  const publicationVersion = Number(priceLock.publication_version);
  if (!Number.isInteger(publicationVersion) || publicationVersion <= 0) {
    errors.push('active price lock is missing a valid publication_version.');
  } else {
    const publicationFile = `data/manager/publications/${active.station_key}-v${publicationVersion}.json`;
    try {
      const publication = await readJson(publicationFile);
      for (const market of publication.snapshot?.market || []) {
        lockedMarketByEvent.set(
          market.event_key,
          new Map((market.players || []).map((player) => [player.player_key, player]))
        );
      }
    } catch (error) {
      errors.push(`active price lock publication could not be read: ${publicationFile} (${error.message})`);
    }
  }
}

function dateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

if (!active.station_key) errors.push('active_events.json missing station_key.');
if (!active.season) errors.push('active_events.json missing season.');
if (!events.length) errors.push('active_events.json has no active events.');

for (const { item, event } of events) {
  const label = `${event.tour || item.tour} ${event.name || item.event_key || event.event_key}`;
  const report = {
    event_key: event.event_key || item.event_key,
    tour: event.tour || item.tour,
    level: event.level,
    surface: event.surface,
    draw_size: event.draw_size,
    draw_status: event.draw_status || 'pending',
    market_status: event.market_status || 'draw_pending',
    players: (event.players || []).length,
    qualifier_placeholders: (event.players || []).filter((p) => p.is_qualifier_placeholder).length,
    missing_profile_ids: 0,
    missing_photos: 0,
    ready_photos: 0
  };

  if (!event.event_key) errors.push(`${label}: missing event_key.`);
  if (!event.tour && !item.tour) errors.push(`${label}: missing tour.`);
  if (!event.level) errors.push(`${label}: missing level.`);
  if (!event.surface) errors.push(`${label}: missing surface.`);
  if (!Number.isFinite(Number(event.draw_size))) errors.push(`${label}: missing numeric draw_size.`);
  if (!Array.isArray(event.source_urls) || !event.source_urls.length) warnings.push(`${label}: missing source_urls.`);

  const players = event.players || [];
  if (priceLock && Number(event.market_price_lock?.publication_version) !== Number(priceLock.publication_version)) {
    errors.push(`${label}: market_price_lock does not match active publication v${priceLock.publication_version}.`);
  }
  if ((event.draw_status === 'published' || event.market_status === 'open') && !players.length) {
    errors.push(`${label}: draw/market is open but players list is empty.`);
  }
  if ((event.draw_status === 'pending' || event.market_status === 'draw_pending') && !players.length) {
    warnings.push(`${label}: draw is pending; event shell will sync, market will stay unavailable.`);
  }

  const submissionCutoff = dateValue(event.submission_cutoff_at || event.submission_closes_at);
  const mainDrawFirstMatch = dateValue(event.main_draw_first_match_at);
  const round1Completed = dateValue(event.round1_completed_at || event.transfer_window_opens_at);
  const round2FirstMatch = dateValue(event.round2_first_match_at || event.transfer_window_closes_at);
  const scheduleStatus = String(event.schedule_status || '').toLowerCase();
  if (event.market_status === 'open') {
    openEventWindows.push({ label, event, submissionCutoff, mainDrawFirstMatch });
  }

  if (event.market_status === 'open') {
    if (!submissionCutoff) warnings.push(`${label}: market is open but this event has no per-event submission cutoff yet.`);
    if (!mainDrawFirstMatch) warnings.push(`${label}: market is open but this event has no per-event main_draw_first_match_at yet.`);
    if (submissionCutoff && mainDrawFirstMatch && submissionCutoff >= mainDrawFirstMatch) {
      errors.push(`${label}: submission cutoff must be before main_draw_first_match_at.`);
    }
  }
  if (mainDrawFirstMatch && now >= mainDrawFirstMatch && !round1Completed) {
    warnings.push(`${label}: main draw has started but R1 completion/transfer open is not known yet.`);
  }
  if (mainDrawFirstMatch && now >= mainDrawFirstMatch && !round2FirstMatch) {
    const round2ShouldBeKnown = Boolean(round1Completed) || ['confirmed', 'final'].includes(scheduleStatus);
    if (round2ShouldBeKnown) {
      errors.push(`${label}: round2_first_match_at/transfer close should be known but is still missing.`);
    } else {
      warnings.push(`${label}: main draw has started but round2_first_match_at/transfer close is not known yet.`);
    }
  }
  if (round1Completed && round2FirstMatch && round1Completed >= round2FirstMatch) {
    errors.push(`${label}: round1_completed_at/transfer open must be before round2_first_match_at/transfer close.`);
  }

  const positionSeen = new Set();
  const playerSeen = new Set();
  for (const player of players) {
    const playerKey = canonicalPlayerKey(event.tour || item.tour, player);
    if (playerSeen.has(playerKey)) errors.push(`${label}: duplicated player_key ${playerKey}.`);
    playerSeen.add(playerKey);

    if (player.draw_position) {
      if (positionSeen.has(player.draw_position)) errors.push(`${label}: duplicated draw_position ${player.draw_position}.`);
      positionSeen.add(player.draw_position);
    }

    if (!player.name_en && !player.name_zh) errors.push(`${label}: player at position ${player.draw_position || '?'} missing name.`);
    if (!player.is_qualifier_placeholder && !player.profile_id) {
      warnings.push(`${label}: ${player.name_en || player.name_zh} missing official profile_id.`);
      report.missing_profile_ids += 1;
    }
    if (!Number.isFinite(Number(player.price))) errors.push(`${label}: ${player.name_en || player.name_zh} missing numeric price.`);

    if (priceLock) {
      const publishedKey = player.qualifier_replacement?.placeholder_player_key
        || player.pre_r1_substitution?.out_player_key
        || playerKey;
      const publishedPlayer = lockedMarketByEvent.get(event.event_key)?.get(publishedKey);
      if (!publishedPlayer) {
        errors.push(`${label}: ${player.name_en || player.name_zh} is missing from locked publication price map (${publishedKey}).`);
      } else if (Number(player.price) !== Number(publishedPlayer.price)) {
        errors.push(
          `${label}: ${player.name_en || player.name_zh} price ${player.price} differs from locked publication price ${publishedPlayer.price}.`
        );
      }
    }

    const scores = player.scores || {};
    for (const key of ['base', 'surface', 'draw', 'form']) {
      if (!Number.isFinite(Number(scores[key]))) {
        errors.push(`${label}: ${player.name_en || player.name_zh} missing numeric ${key}_score.`);
      }
    }

    const photoRow = payload.eventPlayerRows.find((row) => row.event_key === event.event_key && row.player_key === playerKey);
    if (photoRow?.photo_status === 'ready' || photoRow?.photo_status === 'manual') {
      report.ready_photos += 1;
    } else {
      report.missing_photos += 1;
      if (!player.is_qualifier_placeholder) {
        warnings.push(`${label}: ${player.name_en || player.name_zh} has no ready/manual official photo yet.`);
      }
    }
  }

  if (positionSeen.size > Number(event.draw_size || 0)) {
    errors.push(`${label}: draw positions exceed draw_size ${event.draw_size}.`);
  }
	  eventReports.push(report);
	}

const stationCutoff = openEventWindows
  .map((item) => item.submissionCutoff)
  .filter(Boolean)
  .sort((a, b) => a - b)[0] || null;

if (openEventWindows.length) {
  if (!stationCutoff) {
    errors.push('station market is open but no active event has submission_cutoff_at/submission_closes_at.');
  } else {
    const cutoffDate = stationCutoff.toISOString().slice(0, 10);
    for (const item of openEventWindows) {
      if (item.submissionCutoff) continue;
      const eventStart = item.event.start_date || '';
      if (!eventStart || eventStart <= cutoffDate) {
        errors.push(`${item.label}: missing cutoff could affect the station submission window.`);
      }
    }
  }
}

const report = {
  ok: errors.length === 0,
  station_key: active.station_key,
  season: active.season,
  active_events: eventReports,
  rows: {
    events: payload.eventRows.length,
    players: payload.playerRows.length,
    draw_entries: payload.drawRows.length,
    event_players: payload.eventPlayerRows.length,
    price_rows: payload.priceRows.length
  },
  errors,
  warnings
};

if (output) {
  await writeJson(output, report);
}

console.log(`${report.ok ? 'OK' : 'FAILED'} ${active.station_key || '(missing station_key)'}`);
console.log(`events=${report.rows.events} players=${report.rows.players} draw_entries=${report.rows.draw_entries} market_players=${report.rows.event_players} price_rows=${report.rows.price_rows}`);
if (warnings.length) {
  console.log(`warnings=${warnings.length}`);
  for (const warning of warnings.slice(0, 12)) console.log(`WARN ${warning}`);
  if (warnings.length > 12) console.log(`WARN ... ${warnings.length - 12} more`);
}
if (errors.length) {
  console.log(`errors=${errors.length}`);
  for (const error of errors) console.log(`ERROR ${error}`);
  process.exit(1);
}
