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
const skipDrawWalkovers = Boolean(args['skip-draw-walkovers']);
const minDrawPlayers = Number(args['min-draw-players'] || 8);
const fetchedAt = new Date();
const WINDOW_FIELDS = [
  'main_draw_first_match_at',
  'submission_cutoff_at',
  'submission_closes_at',
  'round1_completed_at',
  'round2_first_match_at',
  'transfer_window_opens_at',
  'transfer_window_closes_at'
];

function mergeDerivedWindows(event, windows) {
  if (!event.manual_schedule_windows) return windows;
  const next = { ...windows };
  for (const field of WINDOW_FIELDS) {
    if (event[field]) next[field] = event[field];
  }
  return next;
}

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
    duplicate_matches_dropped: 0,
    completed_matches: 0,
    draw_walkover_matches: 0,
    windows_updated: false,
    warnings: []
  };

  if (!skipDraw && report.draw_url) {
    try {
      const parsed = await fetchDrawPlayers(nextEvent, report.draw_url);
      report.draw_players = parsed.players.length;
      const drawWalkoverRows = (parsed.walkover_matches || []).filter((row) => row.status === 'walkover');
      report.draw_walkover_matches = drawWalkoverRows.length;
      report.warnings.push(...(parsed.warnings || []));
      entry.drawWalkoverRows = drawWalkoverRows;
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
  } else if (!skipDrawWalkovers && report.draw_url) {
    try {
      const parsed = await fetchDrawPlayers(nextEvent, report.draw_url);
      const drawWalkoverRows = (parsed.walkover_matches || []).filter((row) => row.status === 'walkover');
      report.draw_walkover_matches = drawWalkoverRows.length;
      report.warnings.push(...(parsed.warnings || []));
      entry.drawWalkoverRows = drawWalkoverRows;
    } catch (error) {
      report.warnings.push(`draw walkover refresh failed: ${error.message}`);
    }
  }

  refreshedEvents.push({ item, event: nextEvent, drawWalkoverRows: entry.drawWalkoverRows || [] });
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
}

for (let i = 0; i < refreshedEvents.length; i += 1) {
  const entry = refreshedEvents[i];
  const report = reports[i];
  const scheduleRows = skipSchedule ? [] : matchRowsForEvent(entry.event, resultRecords, report.draw_url || '');
  const rawRows = scheduleRows.concat(entry.drawWalkoverRows || []);
  const rows = dedupeMatchRows(rawRows);
  const duplicateMatchesDropped = rawRows.length - rows.length;
  const windows = mergeDerivedWindows(entry.event, deriveEventWindows(entry.event, rows, fetchedAt));
  entry.event = {
    ...entry.event,
    ...windows,
    transfer_window_note: entry.event.transfer_window_note || '换人窗口为 R1 全部结束后、R2 第一场开始前，由当前站赛程自动更新。',
    source_urls: mergeSourceUrls(entry.event.source_urls, report.draw_url)
  };
  report.matches = rows.length;
  report.duplicate_matches_dropped = duplicateMatchesDropped;
  if (duplicateMatchesDropped > 0) {
    report.warnings.push(`dropped ${duplicateMatchesDropped} duplicate match row(s) before sync`);
  }
  report.completed_matches = rows.filter((row) => ['completed', 'walkover', 'retired'].includes(row.status)).length;
  report.windows_updated = Boolean(windows.main_draw_first_match_at || windows.round2_first_match_at);
  allMatchRows.push(...rows);
}

const syncMatchRows = dedupeMatchRows(allMatchRows);
const duplicateMatchesDropped = reports.reduce((sum, report) => sum + Number(report.duplicate_matches_dropped || 0), 0)
  + (allMatchRows.length - syncMatchRows.length);

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
  duplicate_matches_dropped: duplicateMatchesDropped,
  reports,
  matches: syncMatchRows
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
  if (!Number.isFinite(payload.stationConfigRow.station_grant)) {
    throw new Error(
      `station grant missing for ${active.station_key}; refusing to overwrite backend station config`
    );
  }
  await client.upsert('tour_manager_station_configs', [payload.stationConfigRow], 'station_key,season');
  await client.upsert('tour_manager_events', payload.eventRows, 'event_key');
  const syncedRules = await client.rpc('tour_manager_station_rules', {
    p_station_key: active.station_key,
    p_season: Number(active.season)
  });
  const configuredGrant = payload.stationConfigRow.station_grant;
  const syncedGrant = Number(syncedRules?.station_grant);
  if (Number.isFinite(configuredGrant) && syncedGrant !== configuredGrant) {
    throw new Error(
      `station grant sync mismatch for ${active.station_key}: configured=${configuredGrant} backend=${syncedGrant}`
    );
  }
  if (syncMatchRows.length) {
    await client.upsert('tour_manager_matches', syncMatchRows, 'event_key,match_key');
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
console.log(`events=${reports.length} matches=${syncMatchRows.length} duplicates_dropped=${duplicateMatchesDropped} report=${outFile}`);
for (const report of reports) {
  const bits = [
    `${report.tour}`,
    `draw=${report.draw_players}${report.draw_updated ? '/updated' : ''}`,
    report.draw_walkover_matches ? `draw_walkovers=${report.draw_walkover_matches}` : '',
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

function dedupeMatchRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.event_key}\u0000${row.match_key}`;
    const existing = byKey.get(key);
    if (!existing || matchRowCompleteness(row) >= matchRowCompleteness(existing)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

function matchRowCompleteness(row) {
  return statusPriority(row.status) * 1000
    + (row.winner_key || row.winner_name ? 100 : 0)
    + (row.score ? 40 : 0)
    + (row.player1_key ? 10 : 0)
    + (row.player2_key ? 10 : 0)
    + (row.scheduled_at ? 5 : 0)
    + (row.source_url ? 1 : 0);
}

function statusPriority(status) {
  if (['completed', 'walkover', 'retired'].includes(status)) return 5;
  if (status === 'live') return 4;
  if (status === 'scheduled') return 3;
  if (status === 'cancelled') return 2;
  return 1;
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
