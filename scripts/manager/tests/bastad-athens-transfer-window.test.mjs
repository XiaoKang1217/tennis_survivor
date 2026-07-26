import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const publication = JSON.parse(
  fs.readFileSync('data/manager/publications/2026-w29-bastad-athens-v3.json', 'utf8')
);
const atp = JSON.parse(fs.readFileSync('data/manager/events/atp-2026-w29-bastad.json', 'utf8'));
const wta = JSON.parse(fs.readFileSync('data/manager/events/wta-2026-w29-athens.json', 'utf8'));
const html = fs.readFileSync('index.html', 'utf8');
const payload = fs.readFileSync('scripts/manager/lib/station-payload.mjs', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202607140002_manager_bastad_athens_cross_tour_transfer_window.sql',
  'utf8'
);

const opensAt = '2026-07-15T06:00:00+08:00';
const closesAt = '2026-07-15T17:00:00+08:00';

test('Bastad and Athens retain the published cross-tour transfer window after station rollover', () => {
  assert.equal(publication.station_key, '2026-w29-bastad-athens');
  assert.equal(publication.publication_version, 3);
  assert.equal(publication.publication_kind, 'window_amendment');
  assert.equal(publication.snapshot.station_config.rules.cross_tour_transfer, true);

  for (const event of [atp, wta]) {
    assert.equal(event.transfer_window_opens_at, opensAt);
    assert.equal(event.transfer_window_closes_at, closesAt);
    assert.equal(event.cross_tour_transfer, true);
    assert.match(event.transfer_window_note, /ATP\/WTA 可以互换/);
  }
});

test('previous-station Combo rules render from the frozen publication instead of Wimbledon constants', () => {
  assert.equal(publication.snapshot.station_config.combo_version, 'normal_2026_v2');
  assert.match(html, /function managerPreviousComboRuleCard\(\)/);
  assert.match(html, /managerPreviousComboRuleCard\(\)\+/);
  assert.doesNotMatch(html, /managerWimbledonComboRuleCard\('上一站 Combo · 温网'\)/);
});

test('cross-tour setting reaches the frontend and Supabase event metadata', () => {
  assert.match(html, /rules\.cross_tour_transfer===true/);
  assert.match(html, /pack\.event\.cross_tour_transfer===true/);
  assert.match(payload, /cross_tour_transfer: event\.cross_tour_transfer === true/);
  assert.match(migration, /2026-07-15T06:00:00\+08:00/);
  assert.match(migration, /2026-07-15T17:00:00\+08:00/);
  assert.match(migration, /metadata->>'cross_tour_transfer'/);
  assert.doesNotMatch(migration, /v_lineup\.station_key <> '2026-w27-wimbledon'/);
});

test('cross-tour migration preserves station-grant-first transfer accounting', () => {
  assert.match(migration, /station_grant_first_then_principal/);
  assert.match(migration, /v_station_release := least\(v_refund_remaining, v_old_station_used\)/);
  assert.match(migration, /'transfer_station_grant_refund'/);
  assert.match(migration, /'transfer_principal_refund'/);
});
