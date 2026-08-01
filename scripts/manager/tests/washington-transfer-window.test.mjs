import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const atp = JSON.parse(fs.readFileSync('data/manager/events/atp-2026-w31-washington.json', 'utf8'));
const wta = JSON.parse(fs.readFileSync('data/manager/events/wta-2026-w31-washington.json', 'utf8'));
const publication = JSON.parse(
  fs.readFileSync('data/manager/publications/2026-w31-washington-v4.json', 'utf8'),
);
const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202607290001_manager_washington_cross_tour_transfer_window.sql',
  'utf8',
);

const opensAt = '2026-07-29T10:30:00+08:00';
const closesAt = '2026-07-29T22:45:00+08:00';

function contentVersion(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

test('Washington publishes one shared ATP/WTA transfer window', () => {
  assert.equal(publication.station_key, '2026-w31-washington');
  assert.equal(publication.snapshot.station_config.rules.cross_tour_transfer, true);
  assert.doesNotMatch(publication.snapshot.station_config.notes.join('\n'), /换人窗口待/);

  for (const event of [atp, wta]) {
    assert.equal(event.manual_schedule_windows, true);
    assert.equal(event.transfer_window_opens_at, opensAt);
    assert.equal(event.transfer_window_closes_at, closesAt);
    assert.equal(event.cross_tour_transfer, true);
    assert.match(event.transfer_window_note, /男女可以互换/);
  }
});

test('Washington transfer window is preserved as an immutable station amendment', () => {
  assert.equal(publication.station_key, '2026-w31-washington');
  assert.equal(publication.publication_version, 4);
  assert.equal(publication.publication_kind, 'window_amendment');
  assert.equal(publication.snapshot.station_config.rules.cross_tour_transfer, true);

  for (const event of publication.snapshot.events) {
    assert.equal(event.transfer_window_opens_at, opensAt);
    assert.equal(event.transfer_window_closes_at, closesAt);
    assert.equal(event.cross_tour_transfer, true);
  }
});

test('Washington backend migration opens both tours and verifies cross-tour metadata', () => {
  assert.match(migration, /2026-07-29T10:30:00\+08:00/);
  assert.match(migration, /2026-07-29T22:45:00\+08:00/);
  assert.match(migration, /jsonb_build_object\('cross_tour_transfer', true\)/);
  assert.match(migration, /if v_count <> 2/);
});

test('frontend announces the live transfer window and cross-tour rule', () => {
  assert.match(html, /换人窗口已开放！/);
  assert.match(html, /transferWindowLabel/);
  assert.match(html, /男女可以互换（ATP\/WTA）/);
  assert.match(html, /managerCrossTourTransferEnabled\(\)\?'ATP\/WTA 同一窗口开放，男女可以互换。'/);
});

test('Washington transfer-window files are cache-busted in the data manifest', () => {
  const manifest = JSON.parse(fs.readFileSync('data/manifest.json', 'utf8'));
  for (const file of [
    'data/manager/events/atp-2026-w31-washington.json',
    'data/manager/events/wta-2026-w31-washington.json',
    'data/manager/publications/2026-w31-washington-v4.json',
  ]) {
    assert.equal(manifest.files[file]?.version, contentVersion(file), `${file} manifest version is stale`);
  }
});
