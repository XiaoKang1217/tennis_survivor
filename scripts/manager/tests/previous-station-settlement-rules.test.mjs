import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { buildStationPayload } from '../lib/station-payload.mjs';

test('previous station settlement restores frozen publication rules', () => {
  const source = fs.readFileSync('scripts/manager/settle-current-or-previous-station.mjs', 'utf8');

  assert.match(source, /previous\.publication_file/);
  assert.match(source, /publication\?\.snapshot\?\.station_config/);
  assert.match(source, /rules:\s*\{/);
  assert.match(source, /station_grant:\s*Number\(stationGrant\)/);
  assert.match(source, /combo_version:/);
  assert.match(source, /combo:/);
});

test('missing station grant stays missing and is rejected before backend upsert', () => {
  const payload = buildStationPayload({
    active: { station_key: 'missing-rules', season: 2026 },
    events: []
  });
  assert.equal(payload.stationConfigRow.station_grant, null);

  const source = fs.readFileSync('scripts/manager/refresh-current-station-data.mjs', 'utf8');
  const guardIndex = source.indexOf('station grant missing for');
  const upsertIndex = source.indexOf("client.upsert('tour_manager_station_configs'");
  assert.ok(guardIndex > -1);
  assert.ok(upsertIndex > -1);
  assert.ok(guardIndex < upsertIndex);
});
