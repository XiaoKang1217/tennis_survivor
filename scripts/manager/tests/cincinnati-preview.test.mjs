import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const active = JSON.parse(fs.readFileSync('data/manager/active_events.json', 'utf8'));
const atp = JSON.parse(fs.readFileSync('data/manager/events/atp-2026-w33-cincinnati.json', 'utf8'));
const wta = JSON.parse(fs.readFileSync('data/manager/events/wta-2026-w33-cincinnati.json', 'utf8'));
const transferPublication = JSON.parse(fs.readFileSync('data/manager/publications/2026-w33-cincinnati-v2.json', 'utf8'));
const dataManifest = JSON.parse(fs.readFileSync('data/manifest.json', 'utf8'));
const html = fs.readFileSync('index.html', 'utf8');
const customVillageHopeMigration = fs.readFileSync(
  'supabase/migrations/202608120001_manager_custom_village_hope_submission.sql',
  'utf8',
);
const transferWindowMigration = fs.readFileSync(
  'supabase/migrations/202608150001_manager_cincinnati_transfer_window.sql',
  'utf8',
);

const transferOpensAt = '2026-08-15T10:00:00+08:00';
const transferClosesAt = '2026-08-15T22:45:00+08:00';

function assertCincinnatiEvent(event, tour, eventId, expected) {
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
  assert.equal(event.transfer_window_opens_at, transferOpensAt);
  assert.equal(event.transfer_window_closes_at, transferClosesAt);
  assert.match(event.transfer_window_note, /男女可互换/);
  assert.match(event.transfer_window_note, /换入球员自动继承全村希望|换入球员自动继承全村的希望/);
  assert.equal(event.transfer_fee_rate, 0.15);
  assert.equal(event.cross_tour_transfer, true);
  assert.deepEqual(event.market_price_lock, {
    publication_version: 1,
    locked_at: '2026-08-12T01:00:00.000Z',
  });
  assert.equal(event.players.length, 96);
  assert.equal(event.players.filter((player) => player.is_qualifier_placeholder).length, 0);
  assert.equal(event.players.filter((player) => player.entry_type === 'qualifier').length, 12);
  assert.equal(event.players.filter((player) => player.entry_type === 'lucky_loser').length, expected.luckyLosers);
  assert.equal(new Set(event.players.map((player) => player.draw_position)).size, 96);

  const ranked = event.players.filter((player) => (
    !player.is_qualifier_placeholder
    && !['qualifier', 'lucky_loser'].includes(player.entry_type)
  ));
  assert.equal(ranked.length, expected.rankedDirect);
  assert.ok(ranked.every((player) => Number.isFinite(player.rank) && player.rank > 0));
  assert.ok(ranked.every((player) => Number.isFinite(player.overall_elo) && player.overall_elo > 0));
  assert.ok(ranked.every((player) => Number.isFinite(player.surface_elo) && player.surface_elo > 0));
  assert.ok(event.players.every((player) => Number.isFinite(player.price) && player.price > 0));
  assert.ok(event.players.every((player) => !/\bor\b/i.test(player.name_en)));
}

test('Cincinnati station is frozen as the previous station for US Open', () => {
  const previousConfig = transferPublication.snapshot.station_config;
  assert.equal(active.station_key, '2026-w35-us-open');
  assert.equal(active.previous_station.station_key, '2026-w33-cincinnati');
  assert.equal(active.previous_station.publication_version, 2);
  assert.equal(active.previous_station.publication_file, 'publications/2026-w33-cincinnati-v2.json');
  assert.equal(active.status, 'open');
  assert.equal(previousConfig.rules.station_grant, 1000);
  assert.equal(previousConfig.rules.cross_tour_transfer, true);
  assert.equal(previousConfig.rules.transfer_fee_rate, 0.15);
  assert.equal(previousConfig.rules.combo_version, 'canada_2026_v1');
  assert.equal(previousConfig.rules.combo_design_status, 'confirmed');
  assert.equal(previousConfig.rules.combo.total_cap, 700);
  assert.deepEqual(previousConfig.rules.combo.dual_tour, { R16: 50, QF: 100, SF: 250, F: 450, W: 700 });
  assert.deepEqual(previousConfig.rules.combo.village_hope, {
    selection: 'user_selected_at_submission',
    R16: 50,
    QF: 100,
    SF: 250,
    F: 400,
    W: 700,
  });
  assert.deepEqual(previousConfig.rules.combo.welfare, {
    principal_max: 500,
    min_players: 3,
    discount_rate: 0.2,
    cap: 300,
    max_uses_per_season: 3,
    excluded_from_combo_cap: true,
  });
  assert.ok(transferPublication.snapshot.events.every((event) => (
    Number(event.market_price_lock.publication_version) === 1
    && event.market_price_lock.locked_at === '2026-08-12T01:00:00.000Z'
  )));
  assert.ok(previousConfig.notes.some((note) => note.includes('2026-08-15 10:00 - 22:45')));
  assert.ok(previousConfig.notes.some((note) => note.includes('换人不支持自定义全村的希望')));
});

test('Cincinnati ATP and WTA draws are priced from latest ranking and Elo snapshots', () => {
  assertCincinnatiEvent(atp, 'ATP', '422', { luckyLosers: 2, rankedDirect: 82 });
  assertCincinnatiEvent(wta, 'WTA', '1017', { luckyLosers: 1, rankedDirect: 83 });
  assert.equal(transferPublication.station_key, '2026-w33-cincinnati');
  assert.deepEqual(transferPublication.snapshot.market.map((event) => event.players.length), [96, 96]);
  assert.equal(transferPublication.snapshot.pricing.player_count, 192);
});

test('Cincinnati custom village hope is wired through UI, calculator, and RPC', () => {
  assert.match(html, /function managerVillageHopeSelectHtml\(players,context\)/);
  assert.match(html, /data-manager-village-hope/);
  assert.match(html, /managerVillageHopeUserSelected\(\)\?'自定义选择':'自动认定'/);
  assert.match(html, /managerSetVillageHope\(hopeSel\.value,\{skipRender:!!hopeSel\.closest\('\.manager-dialog'\)\}\)/);
  assert.match(html, /p_village_hope_player_key/);
  assert.match(html, /rpcName='tour_manager_submit_lineup_v2'/);
  assert.match(customVillageHopeMigration, /create or replace function public\.tour_manager_submit_lineup_v2/);
  assert.match(customVillageHopeMigration, /v_selection = 'user_selected_at_submission'/);
  assert.match(customVillageHopeMigration, /raise exception 'village_hope_required'/);
  assert.match(customVillageHopeMigration, /raise exception 'invalid_village_hope_player'/);
  assert.match(customVillageHopeMigration, /set village_hope_player_key = v_selected_key/);
  assert.match(customVillageHopeMigration, /'\{is_village_hope\}'/);
});

test('Cincinnati transfer window is shared and preserves frozen village hope', () => {
  assert.equal(transferPublication.station_key, '2026-w33-cincinnati');
  assert.equal(transferPublication.publication_version, 2);
  assert.equal(transferPublication.publication_kind, 'window_amendment');
  assert.ok(transferPublication.snapshot.windows.every((window) => (
    window.transfer_window_opens_at === transferOpensAt
    && window.transfer_window_closes_at === transferClosesAt
    && window.transfer_fee_rate === 0.15
  )));
  assert.ok(transferPublication.snapshot.events.every((event) => (
    Number(event.market_price_lock.publication_version) === 1
  )));
  assert.match(transferWindowMigration, /station_key = '2026-w33-cincinnati'/);
  assert.match(transferWindowMigration, /2026-08-15T10:00:00\+08:00/);
  assert.match(transferWindowMigration, /2026-08-15T22:45:00\+08:00/);
  assert.match(transferWindowMigration, /new\.station_key <> '2026-w33-cincinnati'/);
  assert.match(transferWindowMigration, /village_hope_player_key = v_in_key/);
  assert.match(transferWindowMigration, /'\{is_village_hope\}'/);
  assert.match(html, /function managerTransferMovesVillageHope\(est,cachedCalc\)/);
  assert.match(html, /换人时不能重新自定义全村的希望/);
  assert.ok(dataManifest.files['data/manager/publications/2026-w33-cincinnati-v2.json']);
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
