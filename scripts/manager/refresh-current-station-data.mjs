#!/usr/bin/env node
import { loadActiveStation, buildStationPayload } from './lib/station-payload.mjs';
import { SupabaseRestClient } from './lib/supabase-rest.mjs';
import { collectPreR1Substitutions, collectQualifierPlacements } from './lib/qualifier-placements.mjs';
import {
  parseArgs,
  readJson,
  writeJson
} from './lib/manager-utils.mjs';
import {
  dateRange,
  deriveEventWindows,
  discoverDrawUrls,
  fetchDrawPlayers,
  fetchResultDate,
  matchRowsForEvent,
  mergeDrawPlayers
} from './lib/live-tennis-current-station.mjs';

const args = parseArgs();
const activeFile = args.active || 'data/manager/active_events.json';
const photoFile = args.photos || 'data/manager/player_photos.json';
const write = Boolean(args.write);
const sync = Boolean(args.sync) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const settle = Boolean(args.settle) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const skipDraw = Boolean(args['skip-draw']);
const skipSchedule = Boolean(args['skip-schedule']);
const minDrawPlayers = Number(args['min-draw-players'] || 8);
const fetchedAt = new Date();

const { active, events } = await loadActiveStation(activeFile);
const drawUrls = await discoverDrawUrls(events, active.season);
const refreshedEvents = [];
const allMatchRows = [];
const reports = [];

for (const entry of events) {
  const { item, event } = entry;
  let nextEvent = { ...event, players: [...(event.players || [])] };
  const report = {
    event_key: event.event_key,
    tour: event.tour || item.tour,
    draw_url: drawUrls.get(event.event_key) || null,
    draw_players: 0,
    draw_updated: false,
    matches: 0,
    completed_matches: 0,
    windows_updated: false,
    warnings: []
  };

  if (!skipDraw && report.draw_url) {
    try {
      const parsed = await fetchDrawPlayers(nextEvent, report.draw_url);
      report.draw_players = parsed.players.length;
      report.warnings.push(...(parsed.warnings || []));
      if (parsed.players.length >= Math.max(minDrawPlayers, Math.floor(Number(event.draw_size || 0) * 0.65))) {
        const mergedPlayers = mergeDrawPlayers(nextEvent, parsed.players, parsed.source_url);
        nextEvent = {
          ...nextEvent,
          draw_status: 'published',
          source_urls: mergeSourceUrls(nextEvent.source_urls, report.draw_url, parsed.source_url),
          players: mergedPlayers,
          market_message: nextEvent.market_message || '签表已由 live-tennis 当前站刷新。'
        };
        report.draw_updated = true;
      } else {
        report.warnings.push(`draw parser returned only ${parsed.players.length} players; kept existing event JSON`);
      }
    } catch (error) {
      report.warnings.push(`draw refresh failed: ${error.message}`);
    }
  }

  refreshedEvents.push({ item, event: nextEvent });
  reports.push(report);
}

let resultRecords = [];
if (!skipSchedule) {
  const dates = stationDateRange(refreshedEvents);
  for (const date of dates) {
    try {
      const rows = await fetchResultDate(date);
      resultRecords.push(...rows);
      console.log(`${date}: result rows=${rows.length}`);
    } catch (error) {
      console.log(`WARN ${date}: result fetch failed: ${error.message}`);
    }
  }

  for (let i = 0; i < refreshedEvents.length; i += 1) {
    const entry = refreshedEvents[i];
    const report = reports[i];
    const rows = matchRowsForEvent(entry.event, resultRecords, report.draw_url || '');
    const windows = deriveEventWindows(entry.event, rows, fetchedAt);
    entry.event = {
      ...entry.event,
      ...windows,
      transfer_window_note: entry.event.transfer_window_note || '换人窗口为 R1 全部结束后、R2 第一场开始前，由当前站赛程自动更新。',
      source_urls: mergeSourceUrls(entry.event.source_urls, report.draw_url)
    };
    report.matches = rows.length;
    report.completed_matches = rows.filter((row) => ['completed', 'walkover', 'retired'].includes(row.status)).length;
    report.windows_updated = Boolean(windows.main_draw_first_match_at || windows.round2_first_match_at);
    allMatchRows.push(...rows);
  }
}

if (write) {
  for (const { item, event } of refreshedEvents) {
    await writeJson(`data/manager/${item.data_file}`, event);
  }
}

const out = {
  generated_at: fetchedAt.toISOString(),
  station_key: active.station_key,
  season: active.season,
  write,
  sync,
  settle,
  qualifier_placements: collectQualifierPlacements(refreshedEvents, { includeDerived: false }),
  pre_r1_substitutions: collectPreR1Substitutions(refreshedEvents),
  reports,
  matches: allMatchRows
};
const outFile = `outputs/manager-sync/${active.station_key}-current-station-data.json`;
await writeJson(outFile, out);

if (sync) {
  const photos = await readJson(photoFile).catch(() => ({ players: {} }));
  const payload = buildStationPayload({
    active,
    events: refreshedEvents,
    photoMap: photos.players || {},
    priceVersion: args['price-version'] || 1,
    priceStatus: args['price-status'] || 'draft'
  });
  const client = new SupabaseRestClient({ dryRun: false });
  await client.upsert('tour_manager_events', payload.eventRows, 'event_key');
  if (allMatchRows.length) {
    await client.upsert('tour_manager_matches', allMatchRows, 'event_key,match_key');
  }
  if (settle) {
    const settledFor = args['settled-for-date'] || localDateKey(new Date(Date.now() - 86400000), 8);
    const result = await client.rpc('tour_manager_settle_completed_matches', {
      p_station_key: active.station_key,
      p_season: Number(active.season),
      p_settled_for_date: settledFor
    });
    out.settlement_result = result;
    await writeJson(outFile, out);
  }
}

console.log(`${write ? 'Updated' : 'Dry run'} current station data for ${active.station_key}`);
console.log(`events=${reports.length} matches=${allMatchRows.length} report=${outFile}`);
for (const report of reports) {
  const bits = [
    `${report.tour}`,
    `draw=${report.draw_players}${report.draw_updated ? '/updated' : ''}`,
    `matches=${report.matches}`,
    `completed=${report.completed_matches}`,
    report.windows_updated ? 'windows=updated' : 'windows=pending'
  ];
  console.log(bits.join(' '));
  for (const warning of report.warnings.slice(0, 5)) console.log(`WARN ${report.event_key}: ${warning}`);
}
if (Boolean(args.sync) && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log('WARN --sync/--settle requested but SUPABASE_SERVICE_ROLE_KEY is missing; wrote local report only.');
}

function mergeSourceUrls(urls = [], ...items) {
  const out = [];
  for (const item of [...(urls || []), ...items]) {
    if (!item) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function stationDateRange(entries) {
  const starts = entries.map(({ event }) => event.start_date).filter(Boolean).sort();
  const ends = entries.map(({ event }) => event.end_date || event.start_date).filter(Boolean).sort();
  const start = args.from || starts[0] || new Date().toISOString().slice(0, 10);
  const end = args.to || ends[ends.length - 1] || start;
  return dateRange(start, end);
}

function localDateKey(date = new Date(), utcOffsetHours = 8) {
  return new Date(date.getTime() + utcOffsetHours * 3600000).toISOString().slice(0, 10);
}
