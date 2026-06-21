#!/usr/bin/env node
import { loadActiveStation, buildStationPayload } from './lib/station-payload.mjs';
import { SupabaseRestClient } from './lib/supabase-rest.mjs';
import { collectQualifierPlacements } from './lib/qualifier-placements.mjs';
import { parseArgs, readJson, writeJson } from './lib/manager-utils.mjs';

const args = parseArgs();
const activeFile = args.active || 'data/manager/active_events.json';
const photoFile = args.photos || 'data/manager/player_photos.json';
const dryRun = Boolean(args['dry-run']) || !process.env.SUPABASE_SERVICE_ROLE_KEY;
const syncRows = !args['no-sync-rows'];

const { active, events } = await loadActiveStation(activeFile);
const placements = collectQualifierPlacements(events);
const outFile = `outputs/manager-sync/${active.station_key}-qualifier-placements.json`;
const report = {
  generated_at: new Date().toISOString(),
  station_key: active.station_key,
  season: active.season,
  dry_run: dryRun,
  sync_rows: syncRows && !dryRun,
  placements,
  applied: []
};

if (!placements.length) {
  await writeJson(outFile, report);
  console.log(`No qualifier placements found for ${active.station_key}. report=${outFile}`);
  process.exit(0);
}

if (dryRun) {
  await writeJson(outFile, report);
  console.log(`Dry run. qualifier_placements=${placements.length} report=${outFile}`);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('Set SUPABASE_SERVICE_ROLE_KEY to apply qualifier placements to Supabase.');
  }
  process.exit(0);
}

const client = new SupabaseRestClient({ dryRun: false });

if (syncRows) {
  const photos = await readJson(photoFile).catch(() => ({ players: {} }));
  const payload = buildStationPayload({
    active,
    events,
    photoMap: photos.players || {},
    priceVersion: args['price-version'] || 1,
    priceStatus: args['price-status'] || 'draft'
  });
  await client.upsert('tour_manager_events', payload.eventRows, 'event_key');
  await client.upsert('tour_manager_players', payload.playerRows, 'tour,player_key');
  await client.upsert('tour_manager_draw_entries', payload.drawRows, 'event_key,draw_version,draw_position');
  await client.upsert('tour_manager_event_players', payload.eventPlayerRows, 'event_key,player_key');
}

for (const placement of placements) {
  const count = await client.rpc('tour_manager_apply_qualifier_placement', {
    p_event_key: placement.event_key,
    p_placeholder_player_key: placement.placeholder_player_key,
    p_replacement_player_key: placement.replacement_player_key,
    p_source_url: placement.source_url
  });
  report.applied.push({
    ...placement,
    updated_contracts: Number(count || 0)
  });
}

await writeJson(outFile, report);
const changed = report.applied.filter((item) => item.updated_contracts > 0);
console.log(`Applied qualifier placements for ${active.station_key}. scanned=${placements.length} updated=${changed.length} report=${outFile}`);
for (const item of changed) {
  console.log(`${item.event_key} ${item.placeholder_player_key} -> ${item.replacement_player_key}: contracts=${item.updated_contracts}`);
}
