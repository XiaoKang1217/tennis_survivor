import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const active = JSON.parse(fs.readFileSync('data/manager/active_events.json', 'utf8'));
const atp = JSON.parse(fs.readFileSync('data/manager/events/atp-2026-w35-us-open.json', 'utf8'));
const wta = JSON.parse(fs.readFileSync('data/manager/events/wta-2026-w35-us-open.json', 'utf8'));
const market = JSON.parse(fs.readFileSync('data/manager/market_snapshot.json', 'utf8'));
const openingPublication = JSON.parse(fs.readFileSync('data/manager/publications/2026-w35-us-open-v1.json', 'utf8'));
const cutoffAmendment = JSON.parse(fs.readFileSync('data/manager/publications/2026-w35-us-open-v2.json', 'utf8'));
const transferWindowPublication = JSON.parse(fs.readFileSync('data/manager/publications/2026-w35-us-open-v4.json', 'utf8'));
const dataManifest = JSON.parse(fs.readFileSync('data/manifest.json', 'utf8'));
const sourceOverrides = JSON.parse(fs.readFileSync('data/manager/player_source_overrides.json', 'utf8'));
const html = fs.readFileSync('index.html', 'utf8');
const prepareScript = fs.readFileSync('scripts/manager/prepare-us-open-2026-preview.mjs', 'utf8');
const buildPrices = fs.readFileSync('scripts/manager/build-prices.mjs', 'utf8');
const syncStation = fs.readFileSync('scripts/manager/sync-station.mjs', 'utf8');
const updateManagerWorkflow = fs.readFileSync('.github/workflows/update_manager.yml', 'utf8');
const migration = fs.readFileSync('supabase/migrations/202608280001_manager_us_open_combo_and_welfare_limit.sql', 'utf8');
const cutoffMigration = fs.readFileSync('supabase/migrations/202608290001_manager_us_open_submission_cutoff_0830.sql', 'utf8');
const transferWindowMigration = fs.readFileSync('supabase/migrations/202609020001_manager_us_open_transfer_window.sql', 'utf8');
const delayedTransferWindowMigration = fs.readFileSync('supabase/migrations/202609020002_manager_us_open_transfer_window_1345.sql', 'utf8');

const transferOpensAt = '2026-09-02T13:45:00+08:00';
const transferClosesAt = '2026-09-02T22:45:00+08:00';

function contentVersion(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

function assertUsOpenEvent(event, tour, qualifierSlotCount) {
  assert.equal(event.tour, tour);
  assert.equal(event.event_key, `${tour.toLowerCase()}-2026-w35-us-open`);
  assert.equal(event.name, 'US Open');
  assert.equal(event.name_zh, '美网');
  assert.equal(event.level, 'GS');
  assert.equal(event.surface, 'hard_out');
  assert.equal(event.draw_size, 128);
  assert.equal(event.city, 'New York');
  assert.equal(event.country, 'United States');
  assert.equal(event.timezone, 'America/New_York');
  assert.equal(event.draw_status, 'published');
  assert.equal(event.market_status, 'open');
  assert.deepEqual(event.market_price_lock, {
    publication_version: 1,
    locked_at: '2026-08-28T01:15:00.000Z'
  });
  assert.equal(event.submission_status, 'open');
  assert.equal(event.submission_opens_at, '2026-08-28T09:15:00+08:00');
  assert.equal(event.main_draw_first_match_at, '2026-08-30T15:00:00.000Z');
  assert.equal(event.submission_cutoff_at, '2026-08-30T14:45:00.000Z');
  assert.equal(event.submission_closes_at, '2026-08-30T14:45:00.000Z');
  assert.equal(event.allow_submission_after_first_match, false);
  assert.equal(event.transfer_fee_rate, 0.15);
  assert.equal(event.cross_tour_transfer, true);
  assert.equal(event.transfer_welfare_discount, false);
  assert.equal(event.transfer_window_opens_at, transferOpensAt);
  assert.equal(event.transfer_window_closes_at, transferClosesAt);
  assert.match(event.transfer_window_note, /男女可互换/);
  assert.match(event.transfer_window_note, /不再享受低保折扣/);
  assert.ok(event.source_urls.includes('https://www.live-tennis.cn/zh/draw/UO/2026'));
  assert.equal(event.players.length, 128);
  const qualifierPlaceholders = event.players.filter((player) => player.is_qualifier_placeholder).length;
  const qualifierReplacements = event.players.filter((player) => player.qualifier_replacement).length;
  assert.equal(qualifierPlaceholders + qualifierReplacements, qualifierSlotCount);
  assert.equal(new Set(event.players.map((player) => player.draw_position)).size, 128);
  assert.ok(event.players.every((player) => Number.isFinite(player.price) && player.price > 0));
  const known = event.players.filter((player) => !player.is_qualifier_placeholder);
  assert.ok(known.every((player) => (
    player.qualifier_replacement || (Number.isFinite(player.rank) && player.rank > 0)
  )));
  assert.ok(known.every((player) => (
    player.qualifier_replacement || (Number.isFinite(player.overall_elo) && player.overall_elo > 0)
  )));
  assert.ok(known.every((player) => (
    player.qualifier_replacement || (Number.isFinite(player.surface_elo) && player.surface_elo > 0)
  )));
}

test('US Open station is current with 2000 grant, 1200 Combo cap, and Cincinnati as previous station', () => {
  assert.equal(active.station_key, '2026-w35-us-open');
  assert.equal(active.station_name, 'ATP 美网 + WTA 美网');
  assert.equal(active.status, 'open');
  assert.equal(active.rules.station_grant, 2000);
  assert.equal(active.announcement, '美网换人窗口已开启！0902 13:45-0902 22:45，手续费15%，男女可互换');
  assert.equal(active.rules.cross_tour_transfer, true);
  assert.equal(active.rules.transfer_fee_rate, 0.15);
  assert.equal(active.rules.transfer_welfare_discount, false);
  assert.equal(active.rules.combo_version, 'us_open_2026_v1');
  assert.equal(active.rules.combo_design_status, 'confirmed');
  assert.equal(active.rules.combo.total_cap, 1200);
  assert.deepEqual(active.rules.combo.steady.multi, { R32: 200, R16: 400, QF: 600, SF: 800 });
  assert.equal(active.rules.combo.steady.all_r16, undefined);
  assert.deepEqual(active.rules.combo.dual_tour, {
    R32: 200,
    R16: 400,
    QF: 600,
    SF: 800,
    F: 1000,
    W: 1200
  });
  assert.deepEqual(active.rules.combo.value_pick, {
    max_price: 300,
    max_triggers: 1,
    R32: 200,
    R16: 400,
    QF: 600,
    SF: 800,
    F: 1000,
    W: 1200
  });
  assert.deepEqual(active.rules.combo.village_hope, {
    selection: 'user_selected_at_submission',
    R32: 200,
    R16: 400,
    QF: 600,
    SF: 800,
    F: 1000,
    W: 1200
  });
  assert.deepEqual(active.rules.combo.welfare, {
    principal_max: 500,
    min_players: 3,
    discount_rate: 0.2,
    cap: 300,
    max_uses_per_season: 3,
    season_start: '2026-01-01',
    season_end: '2026-12-31',
    excluded_from_combo_cap: true
  });
  assert.deepEqual(active.pricing, {
    market_prices_locked: true,
    publication_version: 1,
    price_version: 26082801,
    locked_at: '2026-08-28T01:15:00.000Z',
    reason: 'US Open opening prices are locked from publication v1; qualifier placements inherit the published Q-slot prices.'
  });
  assert.equal(active.previous_station.station_key, '2026-w33-cincinnati');
  assert.equal(active.previous_station.publication_version, 2);
  assert.equal(active.previous_station.publication_file, 'publications/2026-w33-cincinnati-v2.json');
  assert.equal(active.daily_prediction.starts_on, '2026-08-30');
  assert.equal(active.daily_prediction.station_key, active.station_key);
  assert.equal(active.daily_prediction.source_station_key, active.station_key);
  assert.ok(active.notes.some((note) => note.includes('2026-08-30 22:45')));
  assert.ok(active.notes.some((note) => note.includes('2026-09-02 13:45') && note.includes('不再享受低保')));
  assert.ok(active.notes.some((note) => note.includes('R1 正式开赛前继续展示辛辛那提收益')));
});

test('US Open ATP and WTA draws are priced from latest ranking and TA Elo snapshots', () => {
  assertUsOpenEvent(atp, 'ATP', 18);
  assertUsOpenEvent(wta, 'WTA', 16);
  assert.equal(market.station_key, '2026-w35-us-open');
  assert.deepEqual(market.events.map((event) => event.players.length), [128, 128]);
  assert.equal(market.source_status.ATP.ranking_rows, 1200);
  assert.equal(market.source_status.WTA.ranking_rows, 1200);
  assert.ok(market.source_status.ATP.elo_rows >= 500);
  assert.ok(market.source_status.WTA.elo_rows >= 500);
  assert.deepEqual(market.warnings, [
    'Sebastian GORZNY: TA current Elo unavailable; used ranking proxy score.',
    'Venus WILLIAMS: TA current Elo unavailable; used ranking proxy score.',
    'Thea FRODIN: TA current Elo unavailable; used ranking proxy score.'
  ]);
});

test('US Open cutoff amendment moves submission close to 2026-08-30 22:45 without rewriting opening v1', () => {
  assert.equal(openingPublication.station_key, '2026-w35-us-open');
  assert.equal(openingPublication.publication_version, 1);
  assert.equal(openingPublication.publication_kind, 'initial_open');
  assert.ok(openingPublication.snapshot.windows.every((window) => (
    window.submission_cutoff_at === '2026-08-31T14:45:00.000Z'
    && window.submission_closes_at === '2026-08-31T14:45:00.000Z'
  )), 'the immutable opening snapshot must retain the originally published cutoff');

  assert.equal(cutoffAmendment.station_key, '2026-w35-us-open');
  assert.equal(cutoffAmendment.publication_version, 2);
  assert.equal(cutoffAmendment.publication_kind, 'window_amendment');
  assert.equal(cutoffAmendment.snapshot.windows.length, 2);
  assert.ok(cutoffAmendment.snapshot.windows.every((window) => (
    window.submission_cutoff_at === '2026-08-30T14:45:00.000Z'
    && window.submission_closes_at === '2026-08-30T14:45:00.000Z'
  )));
  assert.ok(cutoffAmendment.snapshot.events.every((event) => (
    event.allow_submission_after_first_match === false
  )));
  assert.match(cutoffMigration, /station_key = '2026-w35-us-open'/);
  assert.match(cutoffMigration, /submission_cutoff_at = '2026-08-30T22:45:00\+08:00'/);
  assert.match(cutoffMigration, /submission_closes_at = '2026-08-30T22:45:00\+08:00'/);
});

test('US Open transfer window is shared cross-tour and does not recalculate welfare', () => {
  assert.equal(transferWindowPublication.station_key, '2026-w35-us-open');
  assert.equal(transferWindowPublication.publication_version, 4);
  assert.equal(transferWindowPublication.publication_kind, 'window_amendment');
  assert.equal(transferWindowPublication.snapshot.station_config.rules.cross_tour_transfer, true);
  assert.equal(transferWindowPublication.snapshot.station_config.rules.transfer_fee_rate, 0.15);
  assert.equal(transferWindowPublication.snapshot.station_config.rules.transfer_welfare_discount, false);
  assert.ok(transferWindowPublication.snapshot.station_config.notes.some((note) => (
    note.includes('2026-09-02 13:45') && note.includes('不再享受低保')
  )));
  assert.ok(transferWindowPublication.snapshot.windows.every((window) => (
    window.transfer_window_opens_at === transferOpensAt
    && window.transfer_window_closes_at === transferClosesAt
    && window.transfer_fee_rate === 0.15
  )));
  assert.ok(transferWindowPublication.snapshot.events.every((event) => (
    event.cross_tour_transfer === true
    && event.transfer_welfare_discount === false
  )));
  assert.match(transferWindowMigration, /station_key = '2026-w35-us-open'/);
  assert.match(transferWindowMigration, /2026-09-02T13:00:00\+08:00/);
  assert.match(transferWindowMigration, /2026-09-02T22:45:00\+08:00/);
  assert.match(transferWindowMigration, /transfer_fee_rate = 0\.15/);
  assert.match(transferWindowMigration, /'transfer_welfare_discount', false/);
  assert.match(transferWindowMigration, /tour_manager_apply_us_open_transfer_village_hope/);
  assert.match(delayedTransferWindowMigration, /station_key = '2026-w35-us-open'/);
  assert.match(delayedTransferWindowMigration, /2026-09-02T13:45:00\+08:00/);
  assert.match(delayedTransferWindowMigration, /2026-09-02T22:45:00\+08:00/);
  assert.match(delayedTransferWindowMigration, /transfer_fee_rate = 0\.15/);
  assert.match(html, /if\(submitted\)\{\s*var frozenActive=Number\.isFinite\(frozenDiscount\)&&frozenDiscount>0;/);
  assert.match(html, /discount:frozenActive\?Math\.round\(frozenDiscount\):0/);
});

test('Carlos Alcaraz form score is manually corrected to 50 before pricing', () => {
  const alcaraz = atp.players.find((player) => player.player_key === 'ATP|carlos-alcaraz');
  const marketAlcaraz = market.events.flatMap((event) => event.players).find((player) => player.player_key === 'ATP|carlos-alcaraz');
  const photoPath = 'assets/manager/players/atp/atp-carlos-alcaraz.webp';
  assert.ok(alcaraz);
  assert.equal(sourceOverrides['ATP|carlos-alcaraz'].scores.form, 50);
  assert.match(buildPrices, /scoreOverrideValue\(override, 'form'\) \?\? formScore/);
  assert.equal(alcaraz.scores.form, 50);
  assert.equal(alcaraz.pricing_detail.score_overrides.form, 50);
  assert.equal(alcaraz.price, 865);
  assert.equal(alcaraz.expected_round, 'QF');
  assert.equal(alcaraz.photo_url, photoPath);
  assert.equal(marketAlcaraz?.photo_url, photoPath);
  assert.equal(JSON.parse(fs.readFileSync('data/manager/player_photos.json', 'utf8')).players['ATP|carlos-alcaraz'].photo_url, photoPath);
  assert.match(html, /'ATP\|阿尔卡拉斯':'assets\/manager\/players\/atp\/atp-carlos-alcaraz\.webp'/);
  assert.ok(fs.existsSync(photoPath), 'Carlos Alcaraz local photo asset is missing');
});

test('US Open Combo and welfare limit are wired through frontend and backend', () => {
  assert.match(html, /function managerUsOpenComboScenario\(gross,rounds\)/);
  assert.match(html, /if\(policy==='us_open_2026_v1'\)return managerUsOpenComboScenario\(gross,rounds\)/);
  assert.match(html, /function managerUsOpenComboRulesHtml\(rules\)/);
  assert.match(html, /c\.comboVersion==='us_open_2026_v1'/);
  assert.match(html, /version\.indexOf\('wimbledon'\)>=0\|\|version\.indexOf\('us_open_2026'\)>=0/);
  assert.match(migration, /create or replace function public\.tour_manager_apply_us_open_combo_v1/);
  assert.match(migration, /if v_combo_version = 'us_open_2026_v1'[\s\S]*tour_manager_apply_us_open_combo_v1/);
  assert.match(migration, /'combo_version', v_combo_version \|\| '_daily_delta'/);
  assert.match(migration, /v_bonus_delta := greatest\(v_entitled_bonus - v_paid_bonus, 0\)/);
  assert.match(migration, /v_raw_bonus := v_stable_bonus \+ v_dual_bonus \+ v_jewel_bonus \+ v_village_bonus/);
  assert.match(migration, /'key', 'village_hope', 'label', '全村的希望'/);
  assert.match(migration, /jsonb_typeof\(v_combo->'welfare'\) = 'object'/);
  assert.match(migration, /submitted_at >= make_timestamptz\(p_season, 1, 1/);
  assert.match(migration, /submitted_at < make_timestamptz\(p_season \+ 1, 1, 1/);
  assert.match(migration, /v_welfare_uses < v_welfare_max_uses/);
  assert.match(html, /阵容里≥3 人进 R32\/R16\/QF\/SF，最高档 \+200\/\+400\/\+600\/\+800/);
  assert.match(html, /ATP\/WTA 各至少 1 人进 R32\/R16\/QF\/SF\/F\/W，最高档 \+200\/\+400\/\+600\/\+800\/\+1000\/\+1200/);
  assert.match(html, /价格 <=300 的球员进 R32\/R16\/QF\/SF\/F\/W，最高档 \+200\/\+400\/\+600\/\+800\/\+1000\/\+1200/);
  assert.doesNotMatch(html, /按温网放缩/);
  assert.doesNotMatch(JSON.stringify(active.rules.combo), /scale_ratio|scale_from/);
});

test('US Open locked market is synced without rebuilding prices', () => {
  assert.match(syncStation, /only-if-market-locked/);
  assert.match(syncStation, /active\.pricing\?\.price_version/);
  assert.match(syncStation, /marketLocked \? 'published' : 'draft'/);
  assert.match(updateManagerWorkflow, /maybe-build-prices\.mjs[\s\S]*sync-station\.mjs --only-if-market-locked[\s\S]*publish-station-snapshot\.mjs/);
});

test('US Open source files are generated and cache-busted in the data manifest', () => {
  assert.match(prepareScript, /parseDrawPlayersFromAjax/);
  for (const file of [
    'data/manager/active_events.json',
    'data/manager/market_snapshot.json',
    'data/manager/events/atp-2026-w35-us-open.json',
    'data/manager/events/wta-2026-w35-us-open.json',
    'data/manager/publications/2026-w35-us-open-v2.json',
    'data/manager/publications/2026-w35-us-open-v3.json',
    'data/manager/publications/2026-w35-us-open-v4.json',
    'data/manager/player_source_overrides.json'
  ]) {
    assert.equal(dataManifest.files[file]?.version, contentVersion(file), `${file} manifest version is stale`);
  }
});
