import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const active = JSON.parse(fs.readFileSync('data/manager/active_events.json', 'utf8'));
const atp = JSON.parse(fs.readFileSync('data/manager/events/atp-2026-w32-montreal.json', 'utf8'));
const wta = JSON.parse(fs.readFileSync('data/manager/events/wta-2026-w32-toronto.json', 'utf8'));
const market = JSON.parse(fs.readFileSync('data/manager/market_snapshot.json', 'utf8'));
const publication = JSON.parse(fs.readFileSync('data/manager/publications/2026-w32-canada-v1.json', 'utf8'));
const windowAmendment = JSON.parse(fs.readFileSync('data/manager/publications/2026-w32-canada-v2.json', 'utf8'));
const deadlineAmendment = JSON.parse(fs.readFileSync('data/manager/publications/2026-w32-canada-v3.json', 'utf8'));
const dataManifest = JSON.parse(fs.readFileSync('data/manifest.json', 'utf8'));
const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('supabase/migrations/202608010001_manager_canada_combo_and_welfare.sql', 'utf8');
const cutoffMigration = fs.readFileSync('supabase/migrations/202608020001_manager_canada_submission_cutoff_2245.sql', 'utf8');
const deadlineMigration = fs.readFileSync('supabase/migrations/202608020002_manager_canada_submission_cutoff_2315.sql', 'utf8');

function contentVersion(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

function assertOfficialStation(event, tour, officialPattern) {
  assert.equal(event.tour, tour);
  assert.equal(event.level, '1000');
  assert.equal(event.surface, 'hard_out');
  assert.equal(event.draw_status, 'published');
  assert.equal(event.market_status, 'open');
  assert.equal(event.submission_status, 'open');
  assert.deepEqual(event.market_price_lock, {
    publication_version: 1,
    locked_at: '2026-08-01T07:24:33Z'
  });
  assert.equal(event.submission_opens_at, '2026-08-01T00:00:00+08:00');
  assert.equal(event.submission_cutoff_at, '2026-08-02T23:15:00+08:00');
  assert.equal(event.submission_closes_at, '2026-08-02T23:15:00+08:00');
  assert.equal(event.allow_submission_after_first_match, true);
  assert.equal(event.transfer_window_opens_at ?? null, null);
  assert.equal(event.transfer_window_closes_at ?? null, null);
  assert.equal(event.players.length, 96);
  const qualifierPlaceholders = event.players.filter((player) => player.is_qualifier_placeholder).length;
  assert.ok(qualifierPlaceholders >= 0 && qualifierPlaceholders <= 16);
  assert.equal(new Set(event.players.map((player) => player.draw_position)).size, 96);
  assert.ok(event.source_urls.slice(0, 2).some((url) => officialPattern.test(url)));

  const known = event.players.filter((player) => !player.is_qualifier_placeholder);
  assert.equal(known.length, 96 - qualifierPlaceholders);
  assert.ok(known.every((player) => player.name_zh));
  assert.ok(known.every((player) => player.profile_id));
  assert.ok(known.every((player) => (
    player.qualifier_replacement || (Number.isFinite(player.rank) && player.rank > 0)
  )));
  assert.ok(known.every((player) => Number.isFinite(player.price) && player.price > 0));
  assert.ok(event.players.every((player) => !/\bor\b/i.test(player.name_en)));
}

test('Canada station is open with locked prices and confirmed sale and Combo rules', () => {
  assert.equal(active.station_key, '2026-w32-canada');
  assert.equal(active.status, 'open');
  assert.equal(active.rules.station_grant, 1000);
  assert.equal(active.rules.combo_version, 'canada_2026_v1');
  assert.equal(active.rules.combo_design_status, 'confirmed');
  assert.equal(active.rules.combo.total_cap, 700);
  assert.deepEqual(active.rules.combo.dual_tour, { R16: 50, QF: 100, SF: 250, F: 450, W: 700 });
  assert.equal(active.rules.combo.value_pick.max_price, 150);
  assert.deepEqual(active.rules.combo.village_hope, {
    selection: 'highest_original_price_at_submission',
    R16: 50,
    QF: 100,
    SF: 250,
    F: 400,
    W: 700
  });
  assert.deepEqual(active.rules.combo.welfare, {
    principal_max: 500,
    min_players: 3,
    discount_rate: 0.2,
    cap: 300,
    max_uses_per_season: 3,
    excluded_from_combo_cap: true
  });
  assert.equal(active.pricing.market_prices_locked, true);
  assert.equal(active.pricing.publication_version, 1);
  assert.equal(active.pricing.locked_at, '2026-08-01T07:24:33Z');
  assert.equal(active.events.length, 2);
});

test('ATP Montreal reproduces the official 96-player main draw', () => {
  assertOfficialStation(atp, 'ATP', /(?:atptour\.com|protennislive\.com)/i);
  assert.equal(atp.city, 'Montreal');
  assert.equal(atp.country, 'Canada');
  assert.equal(atp.event_id, '421');
});

test('WTA Toronto reproduces the official 96-player main draw', () => {
  assertOfficialStation(wta, 'WTA', /wtatennis\.com/i);
  assert.equal(wta.city, 'Toronto');
  assert.equal(wta.country, 'Canada');
  assert.equal(wta.event_id, '806');
});

test('Canada market snapshot contains all 192 priced draw entries', () => {
  assert.equal(market.station_key, '2026-w32-canada');
  assert.equal(market.events.length, 2);
  assert.deepEqual(market.events.map((event) => event.players.length), [96, 96]);
  assert.equal(market.events.flatMap((event) => event.players).length, 192);
});

test('Canada opening publication freezes the complete 192-player price market', () => {
  assert.equal(publication.station_key, '2026-w32-canada');
  assert.equal(publication.publication_kind, 'initial_open');
  assert.equal(publication.publication_version, 1);
  assert.equal(publication.published_at, '2026-08-01T07:24:33.000Z');
  assert.equal(publication.snapshot.station_config.status, 'open');
  assert.equal(publication.snapshot.pricing.player_count, 192);
  assert.deepEqual(publication.snapshot.events.map((event) => event.market_status), ['open', 'open']);

  const currentPrices = new Map(
    market.events.flatMap((event) => event.players.map((player) => [`${event.event_key}|${player.player_key}`, player.price]))
  );
  const publishedPlayers = publication.snapshot.market.flatMap((event) => (
    event.players.map((player) => ({ eventKey: event.event_key, ...player }))
  ));
  assert.equal(publishedPlayers.length, 192);
  assert.ok(publishedPlayers.every((player) => (
    currentPrices.get(`${player.eventKey}|${player.player_key}`) === player.price
  )));
  assert.ok(publication.snapshot.windows.every((window) => (
    window.submission_cutoff_at === '2026-08-02T22:15:00+08:00'
    && window.submission_closes_at === '2026-08-02T22:15:00+08:00'
  )), 'the immutable opening snapshot must retain the originally published cutoff');
});

test('Canada window amendment extends both tours to 22:45 without rewriting opening v1', () => {
  assert.equal(windowAmendment.station_key, '2026-w32-canada');
  assert.equal(windowAmendment.publication_version, 2);
  assert.equal(windowAmendment.publication_kind, 'window_amendment');
  assert.equal(windowAmendment.snapshot.windows.length, 2);
  assert.ok(windowAmendment.snapshot.windows.every((window) => (
    window.submission_cutoff_at === '2026-08-02T22:45:00+08:00'
    && window.submission_closes_at === '2026-08-02T22:45:00+08:00'
  )));
  assert.match(cutoffMigration, /station_key = '2026-w32-canada'/);
  assert.match(cutoffMigration, /submission_cutoff_at = '2026-08-02T22:45:00\+08:00'/);
  assert.match(cutoffMigration, /submission_closes_at = '2026-08-02T22:45:00\+08:00'/);
});

test('Canada deadline amendment extends both tours to 23:15 without rewriting prior snapshots', () => {
  assert.equal(deadlineAmendment.station_key, '2026-w32-canada');
  assert.equal(deadlineAmendment.publication_version, 3);
  assert.equal(deadlineAmendment.publication_kind, 'window_amendment');
  assert.equal(deadlineAmendment.snapshot.windows.length, 2);
  assert.ok(deadlineAmendment.snapshot.windows.every((window) => (
    window.submission_cutoff_at === '2026-08-02T23:15:00+08:00'
    && window.submission_closes_at === '2026-08-02T23:15:00+08:00'
  )));
  assert.match(deadlineMigration, /station_key = '2026-w32-canada'/);
  assert.match(deadlineMigration, /submission_cutoff_at = '2026-08-02T23:15:00\+08:00'/);
  assert.match(deadlineMigration, /submission_closes_at = '2026-08-02T23:15:00\+08:00'/);
});

test('Canada opening files are cache-busted in the frontend data manifest', () => {
  for (const file of [
    'data/manager/active_events.json',
    'data/manager/market_snapshot.json',
    'data/manager/events/atp-2026-w32-montreal.json',
    'data/manager/events/wta-2026-w32-toronto.json',
    'data/manager/publications/2026-w32-canada-v1.json',
    'data/manager/publications/2026-w32-canada-v2.json',
    'data/manager/publications/2026-w32-canada-v3.json'
  ]) {
    assert.equal(dataManifest.files[file]?.version, contentVersion(file), `${file} manifest version is stale`);
  }
});

test('Canada Combo and the independent welfare discount are wired into the preview', () => {
  assert.match(html, /if\(policy==='canada_2026_v1'\)return managerCanadaComboScenario\(gross,rounds\)/);
  assert.match(html, /function managerCanadaComboScenario\(gross,rounds\)/);
  assert.match(html, /四项赛果 Combo 合计封顶 700/);
  assert.match(html, /低保办（独立于 700 封顶）/);
  assert.match(html, /function managerWelfareQuote\(players,principal,submitted\)/);
  assert.match(html, /低保折扣 20%/);
  assert.match(html, /全村的希望/);
  assert.match(html, /不会写入线上 Supabase/);
});

test('authoritative Canada submission freezes welfare cost and village hope without changing the RPC contract', () => {
  assert.match(migration, /create or replace function public\.tour_manager_submit_lineup\([\s\S]*p_lineup_style text default null/);
  assert.match(migration, /add column if not exists original_lineup_cost int not null default 0/);
  assert.match(migration, /add column if not exists welfare_discount int not null default 0/);
  assert.match(migration, /add column if not exists village_hope_player_key text/);
  assert.match(migration, /v_balance <= v_welfare_principal_max/);
  assert.match(migration, /v_count >= v_welfare_min_players/);
  assert.match(migration, /v_welfare_uses < v_welfare_max_uses/);
  assert.match(migration, /round\(v_original_cost \* greatest\(v_welfare_rate, 0\)\)::int/);
  assert.match(migration, /v_payable_cost := greatest\(v_original_cost - v_welfare_discount, 0\)/);
  assert.match(migration, /order by ep\.price desc, ep\.player_key/);
  assert.match(migration, /lineup_cost, original_lineup_cost,[\s\S]*welfare_discount/);
  assert.match(html, /originalCost:l\.original_lineup_cost\|\|l\.lineup_cost\|\|0/);
  assert.match(html, /villageHopePlayerId:l\.village_hope_player_key\|\|''/);
});

test('Canada Combo keeps the existing serialized daily delta and historical dispatchers', () => {
  assert.match(migration, /create or replace function public\.tour_manager_apply_canada_combo_v1/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /where lineup_id = v_lineup\.id[\s\S]*and type = 'station_combo_bonus'/);
  assert.match(migration, /v_bonus_delta := greatest\(v_entitled_bonus - v_paid_bonus, 0\)/);
  assert.match(migration, /'combo_version', v_combo_version \|\| '_daily_delta'/);
  assert.match(migration, /v_raw_bonus := v_stable_bonus \+ v_dual_bonus \+ v_jewel_bonus \+ v_village_bonus/);
  assert.match(migration, /v_entitled_bonus := least\(v_raw_bonus, v_combo_cap\)/);
  assert.match(migration, /'key', 'village_hope', 'label', '全村的希望'/);
  assert.match(migration, /if v_combo_version = 'canada_2026_v1'[\s\S]*tour_manager_apply_canada_combo_v1/);
  assert.match(migration, /if v_combo_version = 'washington_2026_v2'[\s\S]*tour_manager_apply_washington_combo_v2/);
  assert.match(migration, /if v_combo_version = 'washington_2026_v1'[\s\S]*tour_manager_apply_washington_combo/);
  assert.match(migration, /tour_manager_apply_station_combo_legacy_20260719/);
});
