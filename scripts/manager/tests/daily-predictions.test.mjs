import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {
  MEDIAN_SELECTION_METHOD,
  MEDIAN_SELECTION_START_DATE,
  MIN_SELECTION_LEAD_MINUTES,
  refreshDailyPredictionGamesByMedian,
  selectMedianRankingGapMatch
} from '../lib/daily-prediction-selection.mjs';

const migration = fs.readFileSync('supabase/migrations/202607150001_manager_daily_predictions.sql', 'utf8');
const immutableMigration = fs.readFileSync('supabase/migrations/202607170001_manager_daily_prediction_immutable_games.sql', 'utf8');
const eventDateCompatMigration = fs.readFileSync('supabase/migrations/202607170002_manager_daily_prediction_event_date_compat.sql', 'utf8');
const eventDateColumnMigration = fs.readFileSync('supabase/migrations/202607170003_manager_daily_prediction_event_date_column.sql', 'utf8');
const predictionSummaryMigration = fs.readFileSync('supabase/migrations/202607310001_manager_prediction_summary.sql', 'utf8');
const medianSelectionMigration = fs.readFileSync('supabase/migrations/202608160001_manager_daily_prediction_median_rank_gap.sql', 'utf8');
const dailyPredictionUpdater = fs.readFileSync('scripts/manager/update-daily-predictions.mjs', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const workflow = fs.readFileSync('.github/workflows/update_manager.yml', 'utf8');
const canadaAtpReplacement = fs.readFileSync('scripts/manager/replace-canada-atp-daily-prediction.mjs', 'utf8');
const cincinnatiAtpReplacement = fs.readFileSync('scripts/manager/replace-cincinnati-atp-daily-prediction.mjs', 'utf8');
const cincinnatiWtaReplacement = fs.readFileSync('scripts/manager/replace-cincinnati-wta-daily-prediction-20260825.mjs', 'utf8');
const stationPayload = fs.readFileSync('scripts/manager/lib/station-payload.mjs', 'utf8');
const refreshCurrentStation = fs.readFileSync('scripts/manager/refresh-current-station-data.mjs', 'utf8');
const activeEvents = JSON.parse(fs.readFileSync('data/manager/active_events.json', 'utf8'));
const bastad = JSON.parse(fs.readFileSync('data/manager/events/atp-2026-w29-bastad.json', 'utf8'));
const athens = JSON.parse(fs.readFileSync('data/manager/events/wta-2026-w29-athens.json', 'utf8'));

test('legacy daily games freeze one ATP and WTA match by smallest ranking gap', () => {
  assert.match(migration, /unique \(station_key, contest_date, tour\)/);
  assert.match(migration, /foreach v_tour in array array\['ATP','WTA'\]/);
  assert.match(migration, /order by\s+abs\(p1\.ranking - p2\.ranking\) asc/i);
  assert.match(migration, /m\.scheduled_at > now\(\)/);
  assert.match(migration, /closes_at[^;]+scheduled_at/i);
});

test('daily games switch to the upper-median ranking gap on August 17', () => {
  assert.equal(MEDIAN_SELECTION_START_DATE, '2026-08-17');
  assert.equal(MEDIAN_SELECTION_METHOD, 'median_world_rank_gap_official_event_day');
  assert.equal(selectMedianRankingGapMatch([
    { match_key: 'a', ranking_gap: 2, scheduled_at: '2026-08-17T15:00:00Z' },
    { match_key: 'b', ranking_gap: 9, scheduled_at: '2026-08-17T16:00:00Z' },
    { match_key: 'c', ranking_gap: 30, scheduled_at: '2026-08-17T17:00:00Z' }
  ]).match_key, 'b');
  assert.equal(selectMedianRankingGapMatch([
    { match_key: 'a', ranking_gap: 2, scheduled_at: '2026-08-17T15:00:00Z' },
    { match_key: 'b', ranking_gap: 9, scheduled_at: '2026-08-17T16:00:00Z' },
    { match_key: 'c', ranking_gap: 30, scheduled_at: '2026-08-17T17:00:00Z' },
    { match_key: 'd', ranking_gap: 70, scheduled_at: '2026-08-17T18:00:00Z' }
  ]).match_key, 'c');
  assert.match(dailyPredictionUpdater, /today >= MEDIAN_SELECTION_START_DATE/);
  assert.match(dailyPredictionUpdater, /refreshDailyPredictionGamesByMedian/);
  assert.match(medianSelectionMigration, /p_contest_date >= date '2026-08-17'/);
  assert.match(medianSelectionMigration, /row_number\(\) over/);
  assert.match(medianSelectionMigration, /count\(\*\) over \(\) as candidate_count/);
  assert.match(medianSelectionMigration, /floor\(candidate_count::numeric \/ 2\)::int \+ 1/);
  assert.match(medianSelectionMigration, /median_world_rank_gap_official_event_day/);
});

test('daily selection skips matches that start too soon for users to pick', async () => {
  assert.equal(MIN_SELECTION_LEAD_MINUTES, 120);
  const inserted = [];
  const matchQueries = [];
  const client = {
    async select(table, query) {
      if (table === 'tour_manager_daily_prediction_games' && query.station_key) return [];
      if (table === 'tour_manager_events') {
        const tour = query.tour.replace(/^eq\./, '');
        return [{ event_key: `${tour.toLowerCase()}-source-event`, metadata: { timezone: 'UTC' } }];
      }
      if (table === 'tour_manager_matches') {
        matchQueries.push(query);
        const eventKey = query.event_key.replace(/^eq\./, '');
        const tour = eventKey.startsWith('atp') ? 'ATP' : 'WTA';
        return [
          {
            event_key: eventKey,
            match_key: `${eventKey}:later`,
            match_order: 2,
            scheduled_at: '2026-08-25T05:00:00.000Z',
            player1_key: `${tour}|a`,
            player1_name: `${tour} A`,
            player2_key: `${tour}|b`,
            player2_name: `${tour} B`,
            raw: { date: '2026-08-25' }
          }
        ];
      }
      if (table === 'tour_manager_event_players') {
        const eventKey = query.event_key.replace(/^eq\./, '');
        const tour = eventKey.startsWith('atp') ? 'ATP' : 'WTA';
        return [
          { event_key: eventKey, player_key: `${tour}|a`, name_zh: `${tour} A`, ranking: 41 },
          { event_key: eventKey, player_key: `${tour}|b`, name_zh: `${tour} B`, ranking: 49 }
        ];
      }
      return [];
    },
    async insert(table, rows) {
      assert.equal(table, 'tour_manager_daily_prediction_games');
      inserted.push(...rows);
      return rows.map((row, index) => ({ ...row, id: `game-${index}` }));
    }
  };
  const result = await refreshDailyPredictionGamesByMedian({
    client,
    stationKey: '2026-w33-cincinnati',
    sourceStationKey: '2026-w34-winston-salem-monterrey-predictions',
    season: 2026,
    contestDate: '2026-08-25',
    now: new Date('2026-08-25T02:00:00.000Z')
  });
  assert.equal(result.created, 2);
  assert.deepEqual(matchQueries.map((query) => query.scheduled_at), [
    'gt.2026-08-25T04:00:00.000Z',
    'gt.2026-08-25T04:00:00.000Z'
  ]);
  assert.ok(inserted.every((row) => row.match_key.endsWith(':later')));
});

test('daily refresh skips new questions while an older prediction is still open', async () => {
  const eventQueries = [];
  const client = {
    async select(table, query) {
      if (table === 'tour_manager_daily_prediction_games' && query.status === 'eq.open') {
        return [{
          id: 'open-old',
          contest_date: '2026-08-31',
          closes_at: '2026-09-01T01:00:00.000Z'
        }];
      }
      if (table === 'tour_manager_events') eventQueries.push(query);
      return [];
    },
    async insert() {
      throw new Error('refresh should not insert while an older prediction is still open');
    }
  };
  const result = await refreshDailyPredictionGamesByMedian({
    client,
    stationKey: '2026-w35-us-open',
    sourceStationKey: '2026-w35-us-open',
    season: 2026,
    contestDate: '2026-09-01',
    now: new Date('2026-08-31T16:30:00.000Z')
  });
  assert.equal(result.skipped_active, true);
  assert.equal(result.created, 0);
  assert.equal(result.active_contest_date, '2026-08-31');
  assert.deepEqual(eventQueries, []);
});

test('daily selection groups the full official event day across China midnight', () => {
  assert.match(migration, /p_raw ->> 'date'/);
  assert.match(migration, /tour_manager_match_event_date[\s\S]+?= v_event_date/);
  assert.match(migration, /closest_world_rank_official_event_day/);
  assert.match(migration, /'event_date', g\.event_date/);
  assert.doesNotMatch(migration, /timezone\('Asia\/Shanghai', m\.scheduled_at\)/);
  assert.match(stationPayload, /timezone: event\.timezone \|\| null/);
  assert.equal(bastad.timezone, 'Europe/Stockholm');
  assert.equal(athens.timezone, 'Europe/Athens');
});

test('daily predictions can use a prediction-only source station while rewarding the active station', async () => {
  assert.equal(activeEvents.daily_prediction.starts_on, '2026-08-30');
  assert.equal(activeEvents.daily_prediction.station_key, activeEvents.station_key);
  assert.equal(activeEvents.daily_prediction.source_station_key, activeEvents.station_key);
  assert.match(dailyPredictionUpdater, /predictionSourceStationKey/);
  assert.match(dailyPredictionUpdater, /sourceStationKey: predictionSourceStationKey/);
  assert.match(refreshCurrentStation, /loadDailyPredictionEvents/);
  assert.match(refreshCurrentStation, /source_station_key/);
  assert.match(refreshCurrentStation, /scope:\s*entry\.scope/);
  assert.match(refreshCurrentStation, /predictionPayload\.eventRows/);
  assert.match(refreshCurrentStation, /predictionPayload\.eventPlayerRows/);

  const inserted = [];
  const eventQueries = [];
  const client = {
    async select(table, query) {
      if (table === 'tour_manager_daily_prediction_games' && query.station_key) return [];
      if (table === 'tour_manager_events') {
        eventQueries.push(query);
        const tour = query.tour.replace(/^eq\./, '');
        return [{ event_key: `${tour.toLowerCase()}-source-event`, metadata: { timezone: 'UTC' } }];
      }
      if (table === 'tour_manager_matches') {
        const eventKey = query.event_key.replace(/^eq\./, '');
        const tour = eventKey.startsWith('atp') ? 'ATP' : 'WTA';
        return [
          {
            event_key: eventKey,
            match_key: `${eventKey}:m1`,
            match_order: 1,
            scheduled_at: '2026-08-24T16:00:00.000Z',
            player1_key: `${tour}|a`,
            player1_name: `${tour} A`,
            player2_key: `${tour}|b`,
            player2_name: `${tour} B`,
            raw: { date: '2026-08-24' }
          }
        ];
      }
      if (table === 'tour_manager_event_players') {
        const eventKey = query.event_key.replace(/^eq\./, '');
        const tour = eventKey.startsWith('atp') ? 'ATP' : 'WTA';
        return [
          { event_key: eventKey, player_key: `${tour}|a`, name_zh: `${tour} A`, ranking: 41 },
          { event_key: eventKey, player_key: `${tour}|b`, name_zh: `${tour} B`, ranking: 49 }
        ];
      }
      return [];
    },
    async insert(table, rows) {
      assert.equal(table, 'tour_manager_daily_prediction_games');
      inserted.push(...rows);
      return rows.map((row, index) => ({ ...row, id: `game-${index}` }));
    }
  };
  const result = await refreshDailyPredictionGamesByMedian({
    client,
    stationKey: '2026-w33-cincinnati',
    sourceStationKey: '2026-w34-winston-salem-monterrey-predictions',
    season: 2026,
    contestDate: '2026-08-24',
    now: new Date('2026-08-23T12:00:00.000Z')
  });
  assert.equal(result.created, 2);
  assert.equal(result.station_key, '2026-w33-cincinnati');
  assert.equal(result.source_station_key, '2026-w34-winston-salem-monterrey-predictions');
  assert.deepEqual(eventQueries.map((query) => query.station_key), [
    'eq.2026-w34-winston-salem-monterrey-predictions',
    'eq.2026-w34-winston-salem-monterrey-predictions'
  ]);
  assert.deepEqual(inserted.map((row) => row.station_key), [
    '2026-w33-cincinnati',
    '2026-w33-cincinnati'
  ]);
  assert.ok(inserted.every((row) => /-source-event$/.test(row.event_key)));
});

test('daily predictions fall back to latest ranking snapshots when source event players have no ranking', async () => {
  const inserted = [];
  const rankingQueries = [];
  const client = {
    async select(table, query) {
      if (table === 'tour_manager_daily_prediction_games' && query.station_key) return [];
      if (table === 'tour_manager_events') {
        const tour = query.tour.replace(/^eq\./, '');
        return [{ event_key: `${tour.toLowerCase()}-source-event`, metadata: { timezone: 'UTC' } }];
      }
      if (table === 'tour_manager_matches') {
        const eventKey = query.event_key.replace(/^eq\./, '');
        const tour = eventKey.startsWith('atp') ? 'ATP' : 'WTA';
        return [
          {
            event_key: eventKey,
            match_key: `${eventKey}:m1`,
            match_order: 1,
            scheduled_at: '2026-08-24T16:00:00.000Z',
            player1_key: `${tour}|a`,
            player1_name: `${tour} A`,
            player2_key: `${tour}|b`,
            player2_name: `${tour} B`,
            raw: { date: '2026-08-24' }
          }
        ];
      }
      if (table === 'tour_manager_event_players') {
        const eventKey = query.event_key.replace(/^eq\./, '');
        const tour = eventKey.startsWith('atp') ? 'ATP' : 'WTA';
        return [
          { event_key: eventKey, player_key: `${tour}|a`, name_zh: `${tour} A`, ranking: null },
          { event_key: eventKey, player_key: `${tour}|b`, name_zh: `${tour} B`, ranking: null }
        ];
      }
      if (table === 'tour_manager_ranking_snapshots') {
        rankingQueries.push(query);
        const tour = query.tour.replace(/^eq\./, '');
        return [
          { player_key: `${tour}|a`, name_en: `${tour} A`, rank: 40, ranking_date: '2026-08-24' },
          { player_key: `${tour}|b`, name_en: `${tour} B`, rank: 47, ranking_date: '2026-08-24' },
          { player_key: `${tour}|a`, name_en: `${tour} A`, rank: 42, ranking_date: '2026-08-17' }
        ];
      }
      return [];
    },
    async insert(table, rows) {
      assert.equal(table, 'tour_manager_daily_prediction_games');
      inserted.push(...rows);
      return rows.map((row, index) => ({ ...row, id: `game-${index}` }));
    }
  };
  const result = await refreshDailyPredictionGamesByMedian({
    client,
    stationKey: '2026-w33-cincinnati',
    sourceStationKey: '2026-w34-winston-salem-monterrey-predictions',
    season: 2026,
    contestDate: '2026-08-24',
    now: new Date('2026-08-24T01:30:00.000Z')
  });

  assert.equal(result.created, 2);
  assert.deepEqual(result.missing_tours, []);
  assert.equal(rankingQueries.length, 2);
  assert.ok(rankingQueries.every((query) => query.player_key.includes('"')));
  assert.deepEqual(inserted.map((row) => [row.tour, row.player1_ranking, row.player2_ranking]), [
    ['ATP', 40, 47],
    ['WTA', 40, 47]
  ]);
});

test('the first published station/date/tour question is immutable', () => {
  for (const sql of [migration, immutableMigration, medianSelectionMigration]) {
    assert.match(sql, /if exists \([\s\S]+?g\.station_key = p_station_key[\s\S]+?g\.contest_date = p_contest_date[\s\S]+?g\.tour = v_tour[\s\S]+?continue;/);
    assert.doesNotMatch(sql, /delete from public\.tour_manager_daily_prediction_games/);
    assert.match(sql, /'replaced_total', 0/);
    assert.match(sql, /'replaced_unpicked', 0/);
  }
});

test('immutable prediction migrations provide the exact event-date helper signature', () => {
  const helperSignature = /tour_manager_match_event_date\s*\(\s*p_raw jsonb,\s*p_scheduled_at timestamptz,\s*p_timezone text/s;
  assert.match(immutableMigration, helperSignature);
  assert.match(eventDateCompatMigration, helperSignature);
  assert.match(eventDateColumnMigration, helperSignature);
  assert.match(immutableMigration, /add column if not exists event_date date/);
  assert.match(eventDateCompatMigration, /add column if not exists event_date date/);
  assert.match(eventDateColumnMigration, /add column if not exists event_date date/);
  assert.match(eventDateColumnMigration, /set event_date = public\.tour_manager_match_event_date/);
  assert.match(eventDateColumnMigration, /set event_date = contest_date/);
  assert.doesNotMatch(eventDateCompatMigration, /insert\s+into|update\s+public\.|delete\s+from/i);
  assert.doesNotMatch(eventDateColumnMigration, /tour_manager_wallet|daily_prediction_picks|settle_daily_predictions/i);
});

test('prediction submission is authenticated, atomic, and closes at match start', () => {
  assert.match(migration, /tour_manager_submit_daily_predictions\(\s*p_picks jsonb/);
  assert.match(migration, /tour_manager_submit_daily_prediction\(\s*\(v_item ->> 'game_id'\)::uuid/);
  assert.match(migration, /v_game\.status <> 'open' or now\(\) >= v_game\.closes_at/);
  assert.match(migration, /v_match\.status <> 'scheduled' or v_match\.scheduled_at <= now\(\)/);
  assert.match(migration, /grant execute on function public\.tour_manager_submit_daily_predictions\(jsonb\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.tour_manager_submit_daily_predictions\(jsonb\) to anon/);
});

test('correct picks pay principal once and write an auditable wallet row', () => {
  assert.match(migration, /balance = balance \+ v_game\.reward_amount/);
  assert.match(migration, /'daily_prediction_reward'/);
  assert.match(migration, /每日竞猜奖励/);
  assert.match(migration, /tour_manager_daily_prediction_reward_once_idx/);
  assert.match(migration, /where game_id = v_game\.id and settled_at is null/);
  assert.match(migration, /reward_amount = case when v_correct then v_game\.reward_amount else 0 end/);
  assert.match(migration, /'principal_reward', true/);
  assert.match(migration, /'income_player_key', v_pick\.picked_player_key/);
  assert.match(migration, /'income_player_name', v_pick\.picked_player_name/);
  assert.match(migration, /'每日竞猜奖励 · ' \|\| v_game\.tour \|\| ' · 猜中' \|\| v_pick\.picked_player_name/);
  assert.match(immutableMigration, /tour_manager_enrich_daily_prediction_reward_ledger/);
  assert.match(immutableMigration, /'income_player_name', v_player_name/);
});

test('daily workflow settles old games after match sync and then creates today games', () => {
  const settleIndex = workflow.indexOf('settle-current-or-previous-station.mjs');
  const replacementIndex = workflow.indexOf('replace-canada-atp-daily-prediction.mjs');
  const cincinnatiReplacementIndex = workflow.indexOf('- run: node scripts/manager/replace-cincinnati-atp-daily-prediction.mjs');
  const cincinnatiWtaReplacementIndex = workflow.indexOf('- run: node scripts/manager/replace-cincinnati-wta-daily-prediction-20260825.mjs');
  const predictionIndex = workflow.indexOf('update-daily-predictions.mjs');
  assert.ok(settleIndex >= 0);
  assert.ok(replacementIndex > settleIndex);
  assert.ok(cincinnatiReplacementIndex > replacementIndex);
  assert.ok(cincinnatiWtaReplacementIndex > cincinnatiReplacementIndex);
  assert.ok(predictionIndex > cincinnatiWtaReplacementIndex);
  assert.match(migration, /g\.contest_date <= p_through_date/);
  assert.match(migration, /m\.status in \('completed','walkover','retired','cancelled'\)/);
});

test('August 25 Cincinnati WTA question is replaced with a later playable match', () => {
  assert.match(cincinnatiWtaReplacement, /TARGET_DATE = '2026-08-25'/);
  assert.match(cincinnatiWtaReplacement, /TOO_EARLY_MATCH_KEY = `\$\{EVENT_KEY\}:LS019`/);
  assert.match(cincinnatiWtaReplacement, /REPLACEMENT_MATCH_KEY = `\$\{EVENT_KEY\}:LS014`/);
  assert.match(cincinnatiWtaReplacement, /MIN_REPLACEMENT_LEAD_MINUTES = 120/);
  assert.match(cincinnatiWtaReplacement, /match\.raw\?\.date !== TARGET_DATE/);
  assert.match(cincinnatiWtaReplacement, /manual_replacement_too_early_question_20260825/);
  assert.match(cincinnatiWtaReplacement, /tour_manager_ranking_snapshots/);
  assert.match(cincinnatiWtaReplacement, /client\.delete\('tour_manager_daily_prediction_picks'/);
  assert.match(workflow, /replace-cincinnati-wta-daily-prediction-20260825\.mjs/);
});

test('August 16 Cincinnati ATP question is replaced with the closest-ranked later match', () => {
  assert.match(cincinnatiAtpReplacement, /TARGET_DATE = '2026-08-16'/);
  assert.match(cincinnatiAtpReplacement, /EXPIRED_MATCH_KEY = `\$\{EVENT_KEY\}:MS032`/);
  assert.match(cincinnatiAtpReplacement, /REPLACEMENT_MATCH_KEY = `\$\{EVENT_KEY\}:MS049`/);
  assert.match(cincinnatiAtpReplacement, /game\.status !== 'open'/);
  assert.match(cincinnatiAtpReplacement, /sourceMatches\[0\]\.status !== 'completed'/);
  assert.match(cincinnatiAtpReplacement, /match\.raw\?\.date !== TARGET_DATE/);
  assert.match(cincinnatiAtpReplacement, /match\.status !== 'scheduled'/);
  assert.match(cincinnatiAtpReplacement, /tour_manager_daily_prediction_picks/);
  assert.match(cincinnatiAtpReplacement, /client\.delete\('tour_manager_daily_prediction_picks'/);
  assert.match(cincinnatiAtpReplacement, /manual_replacement_expired_question_20260816/);
  assert.match(cincinnatiAtpReplacement, /ranking_gap: Math\.abs\(player1\.ranking - player2\.ranking\)/);
  assert.match(cincinnatiAtpReplacement, /status: 'eq\.open'/);
  assert.match(workflow, /push:[\s\S]+branches:[\s\S]+main[\s\S]+replace-cincinnati-atp-daily-prediction\.mjs/);
});

test('August 4 Canada ATP question is replaced only after expiry with a later scheduled match', () => {
  assert.match(canadaAtpReplacement, /TARGET_DATE = '2026-08-04'/);
  assert.match(canadaAtpReplacement, /EXPIRED_MATCH_KEY = `\$\{EVENT_KEY\}:MS109`/);
  assert.match(canadaAtpReplacement, /REPLACEMENT_MATCH_KEY = `\$\{EVENT_KEY\}:MS074`/);
  assert.match(canadaAtpReplacement, /game\.closes_at[\s\S]+Date\.now\(\)/);
  assert.match(canadaAtpReplacement, /match\.status !== 'scheduled'/);
  assert.match(canadaAtpReplacement, /tour_manager_daily_prediction_picks/);
  assert.match(canadaAtpReplacement, /client\.delete\('tour_manager_daily_prediction_picks'/);
  assert.match(canadaAtpReplacement, /manual_replacement_expired_question_20260804/);
  assert.match(canadaAtpReplacement, /closes_at: match\.scheduled_at/);
});

test('frontend exposes picks and separates personal prediction income without changing the station leaderboard', () => {
  assert.match(html, /data-manager-view="prediction">每日竞猜/);
  assert.match(html, /tour_manager_submit_daily_predictions/);
  assert.match(html, /当前为本地测试，不会写入线上数据/);
  assert.match(html, /introTitle=MANAGER_DAILY_PREDICTIONS&&MANAGER_DAILY_PREDICTIONS\.carried_over\?'继续竞猜':'今日竞猜'/);
  assert.match(html, /\+introTitle\+' <span class="manager-prediction-reward">猜对一场 \+10 本金<\/span>/);
  assert.match(html, /<p>比赛开始前可提交或修改。<\/p>/);
  assert.doesNotMatch(html, /每天各选一场 ATP、WTA 排名接近的比赛/);
  assert.doesNotMatch(html, /<br>排名差/);
  assert.doesNotMatch(html, /竞猜奖励会进入本金、我的收益和次日收益弹窗/);
  assert.match(html, /竞猜收益/);
  assert.match(html, /yesterdayPrediction/);
  assert.match(html, /stationPrediction/);
  assert.match(html, /daily_prediction_reward\|每日竞猜奖励/);
  assert.match(html, /meta\.income_player_name\|\|meta\.picked_player_name\|\|meta\.winner_name/);
  assert.doesNotMatch(migration, /as prediction_bonus/);
  assert.match(migration, /\(coalesce\(lt\.player_settlement_income, 0\) \+ coalesce\(lt\.combo_bonus, 0\)\)::int as station_net_income/);
  assert.doesNotMatch(html, /prediction:Number\(x\.prediction_bonus\)/);
  assert.doesNotMatch(html, /<th>竞猜奖励<\/th>/);
  assert.match(html, /本站净收益榜只统计球员收益 \+ Combo，不含竞猜收益/);
});

test('personal prediction summary attributes yesterday by contest date and reconciles rewards to ledger', () => {
  assert.match(predictionSummaryMigration, /tour_manager_get_my_prediction_summary/);
  assert.match(predictionSummaryMigration, /v_previous_contest_date date := p_reference_date - 1/);
  assert.match(predictionSummaryMigration, /g\.contest_date = v_previous_contest_date/);
  assert.match(predictionSummaryMigration, /wl\.metadata ->> 'prediction_pick_id' = p\.id::text/);
  assert.match(predictionSummaryMigration, /wl\.type = 'daily_prediction_reward'/);
  assert.match(predictionSummaryMigration, /'previous_pending_count'/);
  assert.match(predictionSummaryMigration, /'career_income'/);
  assert.doesNotMatch(predictionSummaryMigration, /timezone\('Asia\/Shanghai', wl\.created_at\)/);
  assert.match(predictionSummaryMigration, /grant execute on function public\.tour_manager_get_my_prediction_summary\(date\)\s+to authenticated/);
  assert.match(predictionSummaryMigration, /revoke all on function public\.tour_manager_get_my_prediction_summary\(date\)\s+from public, anon/);
});

test('daily prediction page shows yesterday picks, yesterday reward, and career reward without blocking today games', () => {
  assert.match(html, /tour_manager_get_my_prediction_summary/);
  assert.match(html, /昨日竞猜选人/);
  assert.match(html, /昨日竞猜收益/);
  assert.match(html, /竞猜累计收益/);
  assert.match(html, /昨日未参加竞猜/);
  assert.match(html, /场待结算/);
  assert.match(html, /今日竞猜仍可正常提交/);
});

test('local QA reads immutable Supabase questions and falls back from previous to current station', () => {
  assert.match(html, /function managerDailyPredictionStationKeys\(\)/);
  assert.match(html, /\[previous,managerStationKey\(\)\]/);
  assert.match(html, /function managerDailyPredictionDateKeys\(\)/);
  assert.match(html, /for\(var i=days;i>=0;i--\)dates\.push\(managerChinaDateKey\(new Date\(\),-i\)\)/);
  assert.match(html, /for\(var i=0;i<stationKeys\.length;i\+\+\)/);
  assert.match(html, /for\(var j=0;j<contestDates\.length;j\+\+\)/);
  assert.match(html, /managerDailyPredictionSetHasOpenGame\(data\)/);
  assert.match(html, /data\.carried_over=true/);
  assert.match(html, /p_contest_date:dateKey/);
  assert.match(html, /继续竞猜/);
  assert.doesNotMatch(html, /function managerPredictionPreviewData\(\)/);
  assert.match(html, /if\(managerLocalQaMode\(\)\)\{/);
  assert.match(html, /当前为本地测试，不会写入线上数据/);
});

test('cross-midnight visibility follows each game closes_at instead of China midnight', () => {
  const start = html.indexOf('function managerDailyPredictionSetHasOpenGame');
  const end = html.indexOf('function managerPredictionDataKey', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(html.slice(start, end), context);
  const now = Date.parse('2026-07-28T00:10:00+08:00');
  assert.equal(context.managerDailyPredictionSetHasOpenGame({
    games: [
      { status: 'open', closes_at: '2026-07-28T00:30:00+08:00' },
      { status: 'open', closes_at: '2026-07-28T06:30:00+08:00' },
    ],
  }, now), true);
  assert.equal(context.managerDailyPredictionSetHasOpenGame({
    games: [{ status: 'open', closes_at: '2026-07-28T00:00:00+08:00' }],
  }, now), false);
});
