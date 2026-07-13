#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadActiveStation } from './lib/station-payload.mjs';
import { parseArgs, writeJson } from './lib/manager-utils.mjs';

const args = parseArgs();
const activeFile = args.active || 'data/manager/active_events.json';
const force = Boolean(args.force);
const now = args.now ? new Date(args.now) : new Date();

const { active, events } = await loadActiveStation(activeFile);
const decision = priceBuildDecision(active, events, now, force);
const outFile = `outputs/manager-sync/${active.station_key}-maybe-build-prices.json`;
await writeJson(outFile, decision);

if (!decision.should_build) {
  console.log(`Skipped build-prices for ${active.station_key}: ${decision.reason}. report=${outFile}`);
  process.exit(0);
}

console.log(`Running build-prices for ${active.station_key}: ${decision.reason}. report=${outFile}`);
const here = path.dirname(fileURLToPath(import.meta.url));
await run(path.join(here, 'build-prices.mjs'), forwardedArgs(process.argv.slice(2)));

function priceBuildDecision(active, entries, nowDate, forced) {
  const activeEvents = entries
    .map(({ item, event }) => ({
      event_key: event.event_key || item.event_key,
      tour: event.tour || item.tour,
      name: event.name || event.name_zh || item.event_key,
      market_status: event.market_status || 'draw_pending',
      draw_status: event.draw_status || 'pending',
      submission_cutoff_at: event.submission_cutoff_at || event.submission_closes_at || null,
      main_draw_first_match_at: event.main_draw_first_match_at || null
    }))
    .filter((event) => event.market_status !== 'cancelled' && event.market_status !== 'settled');

  const cutoffs = activeEvents
    .map((event) => parseDate(event.submission_cutoff_at))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const firstMatches = activeEvents
    .map((event) => parseDate(event.main_draw_first_match_at))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const stationCutoff = cutoffs[0] || firstMatches[0] || null;
  const stationHasStarted = firstMatches.some((date) => nowDate >= date);

  if (forced) {
    return baseDecision(active, activeEvents, nowDate, stationCutoff, true, 'forced');
  }
  if (active.pricing?.market_prices_locked === true) {
    return {
      ...baseDecision(active, activeEvents, nowDate, stationCutoff, false, 'market_prices_locked'),
      price_lock: {
        locked_at: active.pricing.locked_at || null,
        publication_version: Number(active.pricing.publication_version) || null,
        reason: active.pricing.reason || null
      }
    };
  }
  if (!activeEvents.length) {
    return baseDecision(active, activeEvents, nowDate, stationCutoff, false, 'no_active_events');
  }
  if (stationCutoff && nowDate >= stationCutoff) {
    return baseDecision(active, activeEvents, nowDate, stationCutoff, false, 'station_submission_cutoff_passed');
  }
  if (stationHasStarted) {
    return baseDecision(active, activeEvents, nowDate, stationCutoff, false, 'station_main_draw_started');
  }
  return baseDecision(active, activeEvents, nowDate, stationCutoff, true, stationCutoff ? 'before_station_submission_cutoff' : 'submission_cutoff_unknown');
}

function baseDecision(active, activeEvents, nowDate, stationCutoff, shouldBuild, reason) {
  return {
    generated_at: new Date().toISOString(),
    station_key: active.station_key,
    season: active.season,
    now: nowDate.toISOString(),
    should_build: shouldBuild,
    reason,
    station_cutoff_at: stationCutoff ? stationCutoff.toISOString() : null,
    active_events: activeEvents
  };
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function forwardedArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (part === '--force' || part.startsWith('--force=')) continue;
    if (part === '--now') {
      i += 1;
      continue;
    }
    if (part.startsWith('--now=')) continue;
    out.push(part);
  }
  return out;
}

function run(script, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...argv], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`build-prices exited with code ${code}`));
    });
  });
}
