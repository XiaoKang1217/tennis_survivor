#!/usr/bin/env node
import { SupabaseRestClient } from './lib/supabase-rest.mjs';
import { loadActiveStation, buildStationPayload } from './lib/station-payload.mjs';
import { parseArgs, readJson, writeJson } from './lib/manager-utils.mjs';

const args = parseArgs();
const dryRun = Boolean(args['dry-run']) || !process.env.SUPABASE_SERVICE_ROLE_KEY;
const activeFile = args.active || 'data/manager/active_events.json';
const photoFile = args.photos || 'data/manager/player_photos.json';

const { active, events } = await loadActiveStation(activeFile);
const photos = await readJson(photoFile).catch(() => ({ players: {} }));
const payload = buildStationPayload({ active, events, photoMap: photos.players || {} });

const playerPhotoRows = payload.playerRows.map((p) => ({
  tour: p.tour,
  player_key: p.player_key,
  photo_url: p.photo_url,
  photo_source: p.photo_source,
  photo_status: p.photo_status,
  photo_storage_path: p.photo_storage_path,
  photo_updated_at: p.photo_updated_at
}));

const eventPhotoRows = payload.eventPlayerRows.map((p) => ({
  event_key: p.event_key,
  player_key: p.player_key,
  photo_url: p.photo_url,
  photo_status: p.photo_status,
  photo_storage_path: p.photo_storage_path,
  photo_updated_at: p.photo_updated_at
}));

if (dryRun) {
  const out = `outputs/manager-sync/${active.station_key}-photos.json`;
  await writeJson(out, {
    station_key: active.station_key,
    player_photos: playerPhotoRows,
    event_player_photos: eventPhotoRows,
    note: 'This script syncs reviewed photo metadata. Download/cache/upload will be implemented as the next adapter.'
  });
  console.log(`Dry run only. Wrote photo payload to ${out}`);
  console.log(`ready=${playerPhotoRows.filter((p) => p.photo_status === 'ready').length} pending=${playerPhotoRows.filter((p) => p.photo_status === 'pending').length} missing=${playerPhotoRows.filter((p) => p.photo_status === 'missing').length}`);
  process.exit(0);
}

const client = new SupabaseRestClient();
let playerUpdates = 0;
let eventPlayerUpdates = 0;

for (const row of playerPhotoRows) {
  const updated = await client.update(
    'tour_manager_players',
    {
      photo_url: row.photo_url,
      photo_source: row.photo_source,
      photo_status: row.photo_status,
      photo_storage_path: row.photo_storage_path,
      photo_updated_at: row.photo_updated_at
    },
    {
      tour: `eq.${row.tour}`,
      player_key: `eq.${row.player_key}`
    }
  );
  playerUpdates += updated.length;
}

for (const row of eventPhotoRows) {
  const updated = await client.update(
    'tour_manager_event_players',
    {
      photo_url: row.photo_url,
      photo_status: row.photo_status,
      photo_storage_path: row.photo_storage_path,
      photo_updated_at: row.photo_updated_at
    },
    {
      event_key: `eq.${row.event_key}`,
      player_key: `eq.${row.player_key}`
    }
  );
  eventPlayerUpdates += updated.length;
}

console.log(`Synced photo metadata for ${playerUpdates} player rows and ${eventPlayerUpdates} event-player rows in ${active.station_key}`);
