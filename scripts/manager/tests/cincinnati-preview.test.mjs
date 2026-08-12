import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const active = JSON.parse(fs.readFileSync('data/manager/active_events.json', 'utf8'));
const atp = JSON.parse(fs.readFileSync('data/manager/events/atp-2026-w33-cincinnati.json', 'utf8'));
const wta = JSON.parse(fs.readFileSync('data/manager/events/wta-2026-w33-cincinnati.json', 'utf8'));
const market = JSON.parse(fs.readFileSync('data/manager/market_snapshot.json', 'utf8'));
const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202608120001_manager_custom_village_hope_submission.sql',
  'utf8',
);

function assertCincinnatiEvent(event, tour, eventId) {
  assert.equal(event.tour, tour);
  assert.equal(event.level, '1000');
  assert.equal(event.city, 'Cincinnati');
  assert.equal(event.country, 'United States');
  assert.equal(event.event_id, eventId);
  assert.equal(event.surface, 'hard_out');
  assert.equal(event.draw_status, 'published');
  assert.equal(event.market_status, 'open');
  assert.equal(event.submission_status, 'open');
  assert.equal(event.submission_opens_at, '2026-08-12T09:00:00+08:00');
  assert.equal(event.submission_cutoff_at, '2026-08-13T23:45:00+08:00');
  assert.equal(event.submission_closes_at, '2026-08-13T23:45:00+08:00');
  assert.equal(event.allow_submission_after_first_match, true);
  assert.equal(event.transfer_fee_rate, 0.15);
  assert.equal(event.cross_tour_transfer, true);
  assert.deepEqual(event.market_price_lock, {
    publication_version: 1,
    locked_at: '2026-08-12T01:00:00.000Z',
  });
  assert.equal(event.players.length, 96);
  assert.equal(event.players.filter((player) => player.is_qualifier_placeholder).length, 12);
  assert.equal(new Set(event.players.map((player) => player.draw_position)).size, 96);

  const known = event.players.filter((player) => !player.is_qualifier_placeholder);
  assert.equal(known.length, 84);
  assert.ok(known.every((player) => Number.isFinite(player.rank) && player.rank > 0));
  assert.ok(known.every((player) => Number.isFinite(player.overall_elo) && player.overall_elo > 0));
  assert.ok(known.every((player) => Number.isFinite(player.surface_elo) && player.surface_elo > 0));
  assert.ok(known.every((player) => Number.isFinite(player.price) && player.price > 0));
  assert.ok(event.players.every((player) => !/\bor\b/i.test(player.name_en)));
}

test('Cincinnati station is open with 1000 grant and Montreal-compatible Combo rules', () => {
  assert.equal(active.station_key, '2026-w33-cincinnati');
  assert.equal(active.status, 'open');
  assert.equal(active.station_name, 'ATP 辛辛那提 + WTA 辛辛那提');
  assert.equal(active.rules.station_grant, 1000);
  assert.equal(active.rules.cross_tour_transfer, true);
  assert.equal(active.rules.transfer_fee_rate, 0.15);
  assert.equal(active.rules.combo_version, 'canada_2026_v1');
  assert.equal(active.rules.combo_design_status, 'confirmed');
  assert.equal(active.rules.combo.total_cap, 700);
  assert.deepEqual(active.rules.combo.dual_tour, { R16: 50, QF: 100, SF: 250, F: 450, W: 700 });
  assert.deepEqual(active.rules.combo.village_hope, {
    selection: 'user_selected_at_submission',
    R16: 50,
    QF: 100,
    SF: 250,
    F: 400,
    W: 700,
  });
  assert.deepEqual(active.rules.combo.welfare, {
    principal_max: 500,
    min_players: 3,
    discount_rate: 0.2,
    cap: 300,
    max_uses_per_season: 3,
    excluded_from_combo_cap: true,
  });
  assert.equal(active.pricing.market_prices_locked, true);
  assert.equal(active.pricing.publication_version, 1);
  assert.equal(active.pricing.locked_at, '2026-08-12T01:00:00.000Z');
  assert.equal(active.previous_station.station_key, '2026-w32-canada');
});

test('Cincinnati ATP and WTA draws are priced from latest ranking and Elo snapshots', () => {
  assertCincinnatiEvent(atp, 'ATP', '422');
  assertCincinnatiEvent(wta, 'WTA', '1017');
  assert.equal(market.station_key, '2026-w33-cincinnati');
  assert.deepEqual(market.events.map((event) => event.players.length), [96, 96]);
  assert.equal(market.source_status.ATP.ranking_rows, 1200);
  assert.equal(market.source_status.WTA.ranking_rows, 1200);
  assert.ok(market.source_status.ATP.elo_rows >= 500);
  assert.ok(market.source_status.WTA.elo_rows >= 500);
  assert.deepEqual(market.warnings, [
    'Thanasi KOKKINAKIS: TA current Elo unavailable; used ranking proxy score.',
    'Venus WILLIAMS: TA current Elo unavailable; used ranking proxy score.',
  ]);
});

test('Cincinnati custom village hope is wired through UI, calculator, and RPC', () => {
  assert.match(html, /function managerVillageHopeSelectHtml\(players,context\)/);
  assert.match(html, /data-manager-village-hope/);
  assert.match(html, /managerVillageHopeUserSelected\(\)\?'自定义选择':'自动认定'/);
  assert.match(html, /managerSetVillageHope\(hopeSel\.value,\{skipRender:!!hopeSel\.closest\('\.manager-dialog'\)\}\)/);
  assert.match(html, /p_village_hope_player_key/);
  assert.match(html, /rpcName='tour_manager_submit_lineup_v2'/);
  assert.match(migration, /create or replace function public\.tour_manager_submit_lineup_v2/);
  assert.match(migration, /v_selection = 'user_selected_at_submission'/);
  assert.match(migration, /raise exception 'village_hope_required'/);
  assert.match(migration, /raise exception 'invalid_village_hope_player'/);
  assert.match(migration, /set village_hope_player_key = v_selected_key/);
  assert.match(migration, /'\{is_village_hope\}'/);
});

test('leaderboard exposes current and previous station net-income tabs', () => {
  assert.match(html, /let MANAGER_STATION_NET_TAB='current'/);
  assert.match(html, /let MANAGER_REMOTE_PREVIOUS_STATION_NET_BOARD=\[\]/);
  assert.match(html, />本站净收益榜<\/button>/);
  assert.match(html, />上站净收益榜<\/button>/);
  assert.match(html, /function managerStationNetBoardMeta\(mode\)/);
  assert.match(html, /previousBoardReq=previousBoardMeta\.isPrevious/);
  assert.match(html, /previous_board_count:MANAGER_REMOTE_PREVIOUS_STATION_NET_BOARD\.length/);
});
