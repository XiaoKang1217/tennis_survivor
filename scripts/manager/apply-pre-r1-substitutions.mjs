#!/usr/bin/env node
import { loadActiveStation, buildStationPayload } from './lib/station-payload.mjs';
import { SupabaseRestClient } from './lib/supabase-rest.mjs';
import { collectPreR1Substitutions } from './lib/qualifier-placements.mjs';
import { parseArgs, readJson, writeJson } from './lib/manager-utils.mjs';

const args = parseArgs();
const activeFile = args.active || 'data/manager/active_events.json';
const photoFile = args.photos || 'data/manager/player_photos.json';
const dryRun = Boolean(args['dry-run']) || !process.env.SUPABASE_SERVICE_ROLE_KEY;
const syncRows = !args['no-sync-rows'];
const now = args.now ? new Date(args.now) : new Date();

const { active, events } = await loadActiveStation(activeFile);
const substitutions = collectPreR1Substitutions(events);
const outFile = `outputs/manager-sync/${active.station_key}-pre-r1-substitutions.json`;
const report = {
  generated_at: now.toISOString(),
  station_key: active.station_key,
  season: active.season,
  dry_run: dryRun,
  sync_rows: syncRows && !dryRun,
  substitutions,
  late_review: substitutions.filter((item) => isMainDrawStarted(item.main_draw_first_match_at, now)),
  skipped: [],
  applied: []
};

const pending = substitutions;

if (!substitutions.length) {
  await writeJson(outFile, report);
  console.log(`No pre-R1 substitutions found for ${active.station_key}. report=${outFile}`);
  process.exit(0);
}

if (dryRun) {
  await writeJson(outFile, report);
  console.log(`Dry run. pre_r1_substitutions=${pending.length} late_review=${report.late_review.length} report=${outFile}`);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('Set SUPABASE_SERVICE_ROLE_KEY to apply pre-R1 substitutions to Supabase.');
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

for (const item of pending) {
  try {
    const count = await client.rpc('tour_manager_apply_pre_r1_substitution_v2', {
      p_event_key: item.event_key,
      p_out_player_key: item.out_player_key,
      p_in_player_key: item.replacement_player_key,
      p_source_url: item.source_url
    });
    report.applied.push({
      ...item,
      updated_contracts: Number(count || 0)
    });
  } catch (error) {
    if (isMissingPreR1SubstitutionRpc(error)) {
      report.skipped_reason = 'missing_tour_manager_apply_pre_r1_substitution_v2_rpc';
      report.warning = 'Supabase migration 202606210006_manager_pre_r1_substitution_price_policy.sql has not been applied yet; skipped pre-R1 contract replacements.';
      await writeJson(outFile, report);
      console.log(`WARN ${report.warning} report=${outFile}`);
      process.exit(0);
    }
    throw error;
  }
}

await writeJson(outFile, report);
const changed = report.applied.filter((item) => item.updated_contracts > 0);
console.log(`Applied pre-R1 substitutions for ${active.station_key}. scanned=${substitutions.length} updated=${changed.length} late_review=${report.late_review.length} report=${outFile}`);
for (const item of changed) {
  console.log(`${item.event_key} ${item.out_player_key} -> ${item.replacement_player_key}: contracts=${item.updated_contracts}`);
}

function isMainDrawStarted(value, nowDate) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && nowDate.getTime() >= date.getTime();
}

function isMissingPreR1SubstitutionRpc(error) {
  const message = String(error?.message || error || '');
  return /tour_manager_apply_pre_r1_substitution_v2/.test(message)
    && (/PGRST202/.test(message) || /Could not find/i.test(message) || /rpc failed:\s*404/.test(message));
}
