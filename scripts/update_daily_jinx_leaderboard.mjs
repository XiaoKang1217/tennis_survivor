#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import {
  parseArgs,
  readJson,
  writeJson
} from './manager/lib/manager-utils.mjs';
import { SupabaseRestClient } from './manager/lib/supabase-rest.mjs';

const SOURCE_PATH = 'data/daily_jinx_settlements.json';
const OUTPUT_PATH = 'data/daily_jinx_leaderboard.json';
const SCHEMA_VERSION = 2;
const DEFAULT_REFRESH_DAYS = 10;
const args = parseArgs();

function normalizeSettlement(row) {
  const pickCount = Math.trunc(Number(row?.pick_count || 0));
  if (
    !row?.date
    || !['ATP', 'WTA'].includes(row?.tour)
    || !String(row?.player_name || '').trim()
    || !row?.match_start_at
    || pickCount <= 0
  ) return null;
  return {
    vote_date: String(row.date),
    tour: row.tour,
    event_id: String(row.event_id || ''),
    match_id: String(row.match_id || ''),
    player_name: String(row.player_name).trim(),
    pick_count: pickCount,
    match_start_at: String(row.match_start_at)
  };
}

function dateRangeThrough(dateKey, days = DEFAULT_REFRESH_DAYS) {
  const end = new Date(`${dateKey}T12:00:00Z`);
  if (!dateKey || Number.isNaN(end.getTime())) return [];
  const out = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    out.push(new Date(end.getTime() - offset * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

function uniqueDates(values) {
  return [...new Set((values || []).filter(Boolean).map(String))].sort();
}

async function readExistingOutput() {
  try {
    return await readJson(OUTPUT_PATH);
  } catch {
    return null;
  }
}

async function publicBootstrapClient() {
  const html = await readFile('index.html', 'utf8');
  const url = html.match(/const SUPABASE_URL='([^']+)'/)?.[1];
  const key = html.match(/const SUPABASE_ANON_KEY='([^']+)'/)?.[1];
  if (!url || !key) throw new Error('Public Supabase configuration was not found in index.html.');
  return new SupabaseRestClient({ url, serviceRoleKey: key });
}

function publicBadgeRows(rows) {
  return (rows || []).map((row) => ({
    display_name: String(row.display_name || ''),
    badge_key: String(row.badge_key || ''),
    title: String(row.title || ''),
    subtitle: String(row.subtitle || ''),
    image_url: String(row.image_url || ''),
    thumb_url: String(row.thumb_url || ''),
    rarity: String(row.rarity || '')
  })).filter((row) => row.display_name && row.badge_key);
}

function publicLeaderboardRows(rows) {
  return (rows || []).map((row) => ({
    tour: row.tour,
    display_name: String(row.display_name || '匿名炉友'),
    score: Math.trunc(Number(row.score || 0)),
    hit_count: Math.trunc(Number(row.hit_count || 0)),
    scored_days: Math.trunc(Number(row.scored_days || 0))
  })).filter((row) => ['ATP', 'WTA'].includes(row.tour))
    .sort((a, b) => (
      a.tour.localeCompare(b.tour)
      || b.score - a.score
      || b.hit_count - a.hit_count
      || a.display_name.localeCompare(b.display_name, 'zh-Hans-CN-u-co-pinyin')
    ));
}

const source = await readJson(SOURCE_PATH);
const allSettlements = (source.settlements || []).map(normalizeSettlement).filter(Boolean);
const existing = await readExistingOutput();
const bootstrapLegacy = Boolean(args['bootstrap-legacy']);
const fullRefresh = Boolean(args['full-refresh'])
  || !existing
  || existing.schema_version !== SCHEMA_VERSION
  || existing.ledger_sync !== true;

let refreshDates = fullRefresh
  ? uniqueDates((source.settlements || []).map((row) => row?.date))
  : uniqueDates(source.refreshed_dates);

if (!refreshDates.length && source.settled_through) {
  refreshDates = dateRangeThrough(source.settled_through);
}

const refreshDateSet = new Set(refreshDates);
const settlements = fullRefresh
  ? allSettlements
  : allSettlements.filter((row) => refreshDateSet.has(row.vote_date));

if (args['dry-run']) {
  console.log(JSON.stringify({
    mode: fullRefresh ? 'full' : 'incremental',
    source_rows: (source.settlements || []).length,
    scoring_rows: settlements.length,
    refresh_dates: refreshDates
  }, null, 2));
  process.exit(0);
}

let client;
let leaderboard;
let ledgerSync;

if (bootstrapLegacy) {
  client = await publicBootstrapClient();
  leaderboard = await client.rpc('daily_jinx_leaderboard', {
    p_settlements: allSettlements
  });
  ledgerSync = false;
} else {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to settle and publish the Daily Jinx leaderboard.');
  }
  client = new SupabaseRestClient();
  leaderboard = await client.rpc('daily_jinx_refresh_leaderboard', {
    p_settlements: settlements,
    p_refresh_dates: refreshDates,
    p_full_refresh: fullRefresh
  });
  ledgerSync = true;
}

const badges = await client.select('tour_manager_active_badges', {
  select: 'display_name,badge_key,title,subtitle,image_url,thumb_url,rarity',
  limit: 500
});

const output = {
  schema_version: SCHEMA_VERSION,
  updated_at: new Date().toISOString(),
  source_updated_at: source.updated_at || '',
  settled_through: source.settled_through || '',
  ledger_sync: ledgerSync,
  refresh_mode: bootstrapLegacy ? 'legacy_bootstrap' : (fullRefresh ? 'full' : 'incremental'),
  leaderboard: publicLeaderboardRows(leaderboard),
  badges: publicBadgeRows(badges)
};

await writeJson(OUTPUT_PATH, output);
console.log(
  `Daily Jinx leaderboard: ${output.leaderboard.length} rows, `
  + `${output.badges.length} badges, ${output.refresh_mode}, `
  + `${settlements.length} scoring settlements`
);
