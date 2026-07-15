#!/usr/bin/env node
import { parseArgs, readJson } from './lib/manager-utils.mjs';
import { SupabaseRestClient } from './lib/supabase-rest.mjs';

const args = parseArgs();
const active = await readJson(args.active || 'data/manager/active_events.json');
const dryRun = Boolean(args['dry-run']) || !process.env.SUPABASE_SERVICE_ROLE_KEY;

function chinaDateKey(value = new Date(), offsetDays = 0) {
  const date = new Date(value.getTime() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

const today = args.date || chinaDateKey();
const throughDate = args['through-date'] || chinaDateKey(new Date(`${today}T04:00:00Z`), -1);
const client = new SupabaseRestClient({ dryRun });

if (dryRun) {
  console.log(`DRY RUN settle predictions through ${throughDate}`);
  console.log(`DRY RUN refresh ${active.station_key} predictions for ${today}`);
  process.exit(0);
}

const settlement = await client.rpc('tour_manager_settle_daily_predictions', {
  p_season: Number(active.season) || 2026,
  p_through_date: throughDate
});
console.log(`Daily prediction settlement: ${JSON.stringify(settlement)}`);

const refresh = await client.rpc('tour_manager_refresh_daily_prediction_games', {
  p_station_key: active.station_key,
  p_season: Number(active.season) || 2026,
  p_contest_date: today
});
console.log(`Daily prediction refresh: ${JSON.stringify(refresh)}`);
