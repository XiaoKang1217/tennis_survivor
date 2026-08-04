import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const migration = fs.readFileSync('supabase/migrations/202607150001_manager_daily_predictions.sql', 'utf8');
const immutableMigration = fs.readFileSync('supabase/migrations/202607170001_manager_daily_prediction_immutable_games.sql', 'utf8');
const eventDateCompatMigration = fs.readFileSync('supabase/migrations/202607170002_manager_daily_prediction_event_date_compat.sql', 'utf8');
const eventDateColumnMigration = fs.readFileSync('supabase/migrations/202607170003_manager_daily_prediction_event_date_column.sql', 'utf8');
const predictionSummaryMigration = fs.readFileSync('supabase/migrations/202607310001_manager_prediction_summary.sql', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const workflow = fs.readFileSync('.github/workflows/update_manager.yml', 'utf8');
const canadaAtpReplacement = fs.readFileSync('scripts/manager/replace-canada-atp-daily-prediction.mjs', 'utf8');
const stationPayload = fs.readFileSync('scripts/manager/lib/station-payload.mjs', 'utf8');
const bastad = JSON.parse(fs.readFileSync('data/manager/events/atp-2026-w29-bastad.json', 'utf8'));
const athens = JSON.parse(fs.readFileSync('data/manager/events/wta-2026-w29-athens.json', 'utf8'));

test('daily games freeze one ATP and WTA match by smallest ranking gap', () => {
  assert.match(migration, /unique \(station_key, contest_date, tour\)/);
  assert.match(migration, /foreach v_tour in array array\['ATP','WTA'\]/);
  assert.match(migration, /order by\s+abs\(p1\.ranking - p2\.ranking\) asc/i);
  assert.match(migration, /m\.scheduled_at > now\(\)/);
  assert.match(migration, /closes_at[^;]+scheduled_at/i);
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

test('the first published station/date/tour question is immutable', () => {
  for (const sql of [migration, immutableMigration]) {
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
  const predictionIndex = workflow.indexOf('update-daily-predictions.mjs');
  assert.ok(settleIndex >= 0);
  assert.ok(replacementIndex > settleIndex);
  assert.ok(predictionIndex > replacementIndex);
  assert.match(migration, /g\.contest_date <= p_through_date/);
  assert.match(migration, /m\.status in \('completed','walkover','retired','cancelled'\)/);
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
  assert.match(html, /今日竞猜 <span class="manager-prediction-reward">猜对一场 \+10 本金<\/span>/);
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
  assert.match(html, /managerChinaDateKey\(new Date\(\),-1\)/);
  assert.match(html, /for\(var i=0;i<stationKeys\.length;i\+\+\)/);
  assert.match(html, /managerDailyPredictionSetHasOpenGame\(previousData\)/);
  assert.match(html, /previousData\.carried_over=true/);
  assert.match(html, /p_contest_date:previousDate/);
  assert.match(html, /p_contest_date:todayDate/);
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
