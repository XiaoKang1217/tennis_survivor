#!/usr/bin/env node
import { parseArgs, readJson } from './lib/manager-utils.mjs';
import { SupabaseRestClient } from './lib/supabase-rest.mjs';
import { predictionCycle, shiftOfficialDate } from './lib/prediction-cycle.mjs';
import {
  MEDIAN_SELECTION_START_DATE,
  refreshDailyPredictionGamesByMedian
} from './lib/daily-prediction-selection.mjs';

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

const officialDate=args['official-date'];
let today = args.date || (officialDate?shiftOfficialDate(officialDate,1):chinaDateKey());
let throughDate = args['through-date'] || shiftOfficialDate(today,-1);
const client = new SupabaseRestClient({ dryRun });
const predictionConfig = active.daily_prediction || {};
const predictionStationKey = predictionConfig.station_key || active.station_key;
const predictionSourceStationKey = (
  predictionConfig.starts_on
  && today >= predictionConfig.starts_on
  && predictionConfig.source_station_key
) ? predictionConfig.source_station_key : predictionStationKey;

if (dryRun) {
  console.log('DRY RUN: automatic dates use raw.date of the latest official day with live/results evidence (no database writes).');
  if(args.date||officialDate)console.log(`DRY RUN settle through ${throughDate}; publish ${today}`);
  process.exit(0);
}

if (!args.date&&!officialDate) {
  let events=await client.select('tour_manager_events',{
    station_key:`eq.${predictionSourceStationKey}`,season:`eq.${Number(active.season)||2026}`,
    select:'event_key,metadata'
  });
  const groupKeys=(predictionConfig.event_groups||[]).map(g=>g.event_key).filter(Boolean);
  if(groupKeys.length)events=events.filter(e=>groupKeys.includes(e.event_key));
  const matches=[];
  for (const event of events) {
    // Paginate explicitly so the latest official day is not lost to a response cap.
    for(let offset=0;;offset+=500){
      const rows=await client.select('tour_manager_matches',{
        event_key:`eq.${event.event_key}`,select:'event_key,match_key,status,scheduled_at,raw',
        order:'match_key.asc',limit:500,offset
      });
      matches.push(...rows);
      if(rows.length<500)break;
    }
  }
  const cycle=predictionCycle(events,matches);
  if(!cycle){console.log('No official schedule available; prediction generation deferred.');process.exit(0)}
  today=cycle.contestDate;
  throughDate=args['through-date']||cycle.throughDate;
}
console.log(`Official prediction cycle: settle through ${throughDate}; publish ${today}`);

const settlement = await client.rpc('tour_manager_settle_daily_predictions', {
  p_season: Number(active.season) || 2026,
  p_through_date: throughDate
});
console.log(`Daily prediction settlement: ${JSON.stringify(settlement)}`);

const refresh = today >= MEDIAN_SELECTION_START_DATE
  ? await refreshDailyPredictionGamesByMedian({
    client,
    stationKey: predictionStationKey,
    sourceStationKey: predictionSourceStationKey,
    season: Number(active.season) || 2026,
    contestDate: today,
    exactEventDate: true,
    eventGroups: predictionConfig.event_groups || [],
    dateOverrides: predictionConfig.date_overrides || {}
  })
  : await client.rpc('tour_manager_refresh_daily_prediction_games', {
    p_station_key: predictionStationKey,
    p_season: Number(active.season) || 2026,
    p_contest_date: today
  });
console.log(`Daily prediction refresh: ${JSON.stringify(refresh)}`);
