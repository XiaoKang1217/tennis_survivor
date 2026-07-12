#!/usr/bin/env node
import { SupabaseRestClient } from './lib/supabase-rest.mjs';
import { loadActiveStation, buildStationPayload } from './lib/station-payload.mjs';
import { parseArgs, readJson, writeJson } from './lib/manager-utils.mjs';

const args = parseArgs();
const dryRun = Boolean(args['dry-run']) || !process.env.SUPABASE_SERVICE_ROLE_KEY;
const activeFile = args.active || 'data/manager/active_events.json';
const photoFile = args.photos || 'data/manager/player_photos.json';
const priceVersion = args['price-version'] || 1;
const priceStatus = args['price-status'] || 'draft';

const { active, events } = await loadActiveStation(activeFile);
const photos = await readJson(photoFile).catch(() => ({ players: {} }));
const payload = buildStationPayload({
  active,
  events,
  photoMap: photos.players || {},
  priceVersion,
  priceStatus
});

if (dryRun) {
  const out = `outputs/manager-sync/${active.station_key}.json`;
  await writeJson(out, payload);
  console.log(`Dry run only. Wrote ${out}`);
  console.log(`events=${payload.eventRows.length} players=${payload.playerRows.length} draw_entries=${payload.drawRows.length} market_players=${payload.eventPlayerRows.length}`);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('Set SUPABASE_SERVICE_ROLE_KEY to write these rows to Supabase.');
  }
  process.exit(0);
}

const client = new SupabaseRestClient({ dryRun: false });

await client.upsert('tour_manager_station_configs', [payload.stationConfigRow], 'station_key,season');
await client.upsert('tour_manager_events', payload.eventRows, 'event_key');
await client.upsert('tour_manager_players', payload.playerRows, 'tour,player_key');
await client.upsert('tour_manager_draw_entries', payload.drawRows, 'event_key,draw_version,draw_position');
await client.upsert('tour_manager_event_players', payload.eventPlayerRows, 'event_key,player_key');

const versionRows = await client.upsert(
  'tour_manager_price_versions',
  [payload.priceVersionRow],
  'station_key,season,version'
);
const priceVersionId = versionRows[0]?.id;
if (!priceVersionId) {
  throw new Error('Supabase did not return price_version id. Check table grants and REST response.');
}

await client.upsert(
  'tour_manager_price_version_players',
  payload.priceRows.map((row) => ({ ...row, price_version_id: priceVersionId })),
  'price_version_id,event_key,player_key'
);

console.log(`Synced station ${active.station_key}`);
console.log(`events=${payload.eventRows.length} players=${payload.playerRows.length} draw_entries=${payload.drawRows.length} market_players=${payload.eventPlayerRows.length} price_rows=${payload.priceRows.length}`);
