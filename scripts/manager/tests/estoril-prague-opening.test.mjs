import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { canonicalJson, sha256 } from '../lib/station-publication-snapshot.mjs';

const openingPublication = JSON.parse(fs.readFileSync('data/manager/publications/2026-w30-estoril-prague-v1.json', 'utf8'));
const windowAmendment = JSON.parse(fs.readFileSync('data/manager/publications/2026-w30-estoril-prague-v2.json', 'utf8'));
const events = [
  'data/manager/events/atp-2026-w30-estoril.json',
  'data/manager/events/wta-2026-w30-prague.json'
].map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202607190001_manager_dual_tour_champion_combo.sql',
  'utf8'
);

test('Estoril and Prague close at the amended manual deadline', () => {
  assert.equal(windowAmendment.station_key, '2026-w30-estoril-prague');
  assert.equal(windowAmendment.snapshot.station_config.status, 'open');
  for (const event of events) {
    assert.equal(event.submission_status, 'open');
    assert.equal(event.manual_schedule_windows, true);
    assert.equal(event.submission_cutoff_at, '2026-07-20T16:45:00+08:00');
    assert.equal(event.submission_closes_at, '2026-07-20T16:45:00+08:00');
  }
});

test('window amendment preserves the immutable opening publication', () => {
  assert.equal(openingPublication.publication_version, 1);
  assert.equal(openingPublication.publication_kind, 'initial_open');
  assert.equal(openingPublication.snapshot.windows[0].submission_cutoff_at, '2026-07-20T17:45:00+08:00');
  assert.equal(windowAmendment.publication_version, 2);
  assert.equal(windowAmendment.publication_kind, 'window_amendment');
  assert.equal(windowAmendment.snapshot.windows[0].submission_cutoff_at, '2026-07-20T16:45:00+08:00');
});

test('normal dual-tour Combo includes a config-driven champion tier', () => {
  assert.deepEqual(
    windowAmendment.snapshot.station_config.combo.dual_tour,
    { QF: 20, SF: 45, F: 80, W: 120 }
  );
  assert.equal(openingPublication.snapshot.station_config.combo.dual_tour.W, 120);
  assert.match(html, /eachTour\('W'\)\?120/);
  assert.match(html, /QF\/SF\/F\/W/);
  assert.match(migration, /\{combo,dual_tour,W\}/);
  assert.match(migration, /v_atp_w > 0 and v_wta_w > 0/);
  assert.match(migration, /v_dual_bonus := v_dual_w_value/);
});

test('publication hashes match their frozen snapshots', () => {
  assert.equal(openingPublication.data_hash, sha256(canonicalJson(openingPublication.snapshot)));
  assert.equal(windowAmendment.data_hash, sha256(canonicalJson(windowAmendment.snapshot)));
});

test('homepage uses the optimized current group QR code', () => {
  assert.match(html, /assets\/manager\/wechat-group-qr\.webp/);
  assert.doesNotMatch(html, /assets\/manager\/wechat-group-qr\.jpg/);
});
