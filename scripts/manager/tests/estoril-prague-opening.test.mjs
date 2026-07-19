import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { canonicalJson, sha256 } from '../lib/station-publication-snapshot.mjs';

const active = JSON.parse(fs.readFileSync('data/manager/active_events.json', 'utf8'));
const publication = JSON.parse(fs.readFileSync('data/manager/publications/2026-w30-estoril-prague-v1.json', 'utf8'));
const events = active.events.map((item) => JSON.parse(fs.readFileSync(`data/manager/${item.data_file}`, 'utf8')));
const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202607190001_manager_dual_tour_champion_combo.sql',
  'utf8'
);

test('Estoril and Prague are open through the published deadline', () => {
  assert.equal(active.station_key, '2026-w30-estoril-prague');
  assert.equal(active.status, 'open');
  for (const event of events) {
    assert.equal(event.submission_status, 'open');
    assert.equal(event.submission_cutoff_at, '2026-07-20T17:45:00+08:00');
    assert.equal(event.submission_closes_at, '2026-07-20T17:45:00+08:00');
  }
});

test('normal dual-tour Combo includes a config-driven champion tier', () => {
  assert.deepEqual(active.rules.combo.dual_tour, { QF: 20, SF: 45, F: 80, W: 120 });
  assert.equal(publication.snapshot.station_config.combo.dual_tour.W, 120);
  assert.match(html, /eachTour\('W'\)\?120/);
  assert.match(html, /QF\/SF\/F\/W/);
  assert.match(migration, /\{combo,dual_tour,W\}/);
  assert.match(migration, /v_atp_w > 0 and v_wta_w > 0/);
  assert.match(migration, /v_dual_bonus := v_dual_w_value/);
});

test('opening publication hash matches its frozen snapshot', () => {
  assert.equal(publication.data_hash, sha256(canonicalJson(publication.snapshot)));
});

test('homepage uses the optimized current group QR code', () => {
  assert.match(html, /assets\/manager\/wechat-group-qr\.webp/);
  assert.doesNotMatch(html, /assets\/manager\/wechat-group-qr\.jpg/);
});
