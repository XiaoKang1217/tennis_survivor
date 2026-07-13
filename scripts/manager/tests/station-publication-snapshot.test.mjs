import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublicationRow,
  canonicalJson,
  publicationReadiness,
  sha256
} from '../lib/station-publication-snapshot.mjs';

const active = {
  season: 2026,
  station_key: '2026-test-station',
  station_name: 'Test Station',
  status: 'open',
  survivor_aligned: true,
  updated_at: '2026-07-01T00:00:00Z',
  rules: {
    station_grant: 200,
    combo_version: 'normal_2026_v2',
    combo: { total_cap: 200, steady: { cap: 50 } }
  }
};

const events = [{
  item: {
    tour: 'ATP',
    event_key: 'atp-test',
    data_file: 'events/atp-test.json',
    active: true
  },
  event: {
    event_key: 'atp-test',
    season: 2026,
    tour: 'ATP',
    name: 'Test Open',
    name_zh: '测试赛',
    level: '250',
    surface: 'clay',
    draw_size: 28,
    draw_status: 'published',
    market_status: 'open',
    submission_opens_at: '2026-07-01T00:00:00Z',
    submission_cutoff_at: '2026-07-02T00:00:00Z',
    transfer_window_opens_at: null,
    transfer_window_closes_at: null,
    transfer_window_note: 'R1 end to R2 start',
    pricing_formula: { formula_version: 'build-prices-v1' },
    players: [{
      player_key: 'ATP|test-player',
      name_en: 'Test PLAYER',
      name_zh: '测试球员',
      rank: 10,
      price: 100,
      scores: { base: 80, surface: 70, draw: 60, form: 50, manual: 0 },
      expected_points: 90,
      expected_round: 'SF',
      breakeven_round: 'SF',
      draw_position: 1
    }]
  }
}];

test('canonical JSON and hash are independent of object key insertion order', () => {
  const first = canonicalJson({ b: 2, a: { d: 4, c: 3 } });
  const second = canonicalJson({ a: { c: 3, d: 4 }, b: 2 });
  assert.equal(first, second);
  assert.equal(sha256(first), sha256(second));
});

test('publication row freezes rules, complete market, prices and windows', () => {
  const row = buildPublicationRow({
    active,
    events,
    publicationVersion: 1,
    publishedAt: '2026-07-01T00:00:00Z',
    sourceRef: 'test-ref',
    sourceFiles: [{ path: 'data/manager/active_events.json', sha256: 'a'.repeat(64) }],
    photoData: {
      updated_at: '2026-07-01T00:00:00Z',
      fallbacks: { ATP: 'fallback-atp.svg' },
      players: {
        'ATP|test-player': {
          photo_url: 'test-player.webp',
          status: 'ready'
        }
      }
    }
  });

  assert.equal(row.station_grant, 200);
  assert.equal(row.combo_version, 'normal_2026_v2');
  assert.equal(row.snapshot.station_config.combo.total_cap, 200);
  assert.deepEqual(row.snapshot.station_config.effective_rules, {
    min_players: 1,
    max_players: 2,
    transfers: 1,
    transfer_days: 2,
    transfer_fee_rate: 0.1,
    station_grant: 200,
    combo_version: 'normal_2026_v2'
  });
  assert.equal(row.snapshot.market[0].player_count, 1);
  assert.equal(row.snapshot.market[0].players[0].price, 100);
  assert.equal(row.snapshot.market[0].players[0].publication_photo.photo_url, 'test-player.webp');
  assert.equal(row.snapshot.photos.selected_players['ATP|test-player'].status, 'ready');
  assert.equal(row.snapshot.pricing.players[0].expected_points, 90);
  assert.equal(row.snapshot.pricing.selected_version.version, null);
  assert.equal(row.price_version, null);
  assert.match(row.snapshot.pricing.selected_version.content_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.snapshot.windows[0].submission_cutoff_at, '2026-07-02T00:00:00Z');
  assert.equal(row.snapshot.windows[0].transfer_window_opens_at, null);
  assert.equal(row.data_hash, sha256(row.canonical_payload));
  assert.deepEqual(JSON.parse(row.canonical_payload), row.snapshot);
});

test('publication row is deterministic for the same reviewed inputs', () => {
  const options = {
    active,
    events,
    publicationVersion: 1,
    publishedAt: '2026-07-01T00:00:00Z',
    sourceRef: 'test-ref',
    sourceFiles: []
  };
  assert.equal(buildPublicationRow(options).data_hash, buildPublicationRow(options).data_hash);
});

test('window amendments do not invent a new price version', () => {
  const common = {
    active,
    events,
    publishedAt: '2026-07-01T00:00:00Z',
    sourceRef: 'test-ref',
    sourceFiles: []
  };
  const initial = buildPublicationRow({ ...common, publicationVersion: 1 });
  const amendment = buildPublicationRow({
    ...common,
    publicationVersion: 2,
    publicationKind: 'window_amendment'
  });

  assert.equal(initial.snapshot.pricing.selected_version.version, null);
  assert.equal(amendment.snapshot.pricing.selected_version.version, null);
  assert.equal(
    amendment.snapshot.pricing.selected_version.content_hash,
    initial.snapshot.pricing.selected_version.content_hash
  );
});

test('open station readiness blocks future openings and missing rules', () => {
  const futureEvents = structuredClone(events);
  futureEvents[0].event.submission_opens_at = '2099-01-01T00:00:00Z';
  const future = publicationReadiness({ active, events: futureEvents, now: new Date('2026-07-01T00:00:00Z') });
  assert.equal(future.ready, false);
  assert.ok(future.reasons.includes('submission_not_open_yet'));

  const noRules = publicationReadiness({ active: { ...active, rules: {} }, events });
  assert.equal(noRules.ready, false);
  assert.ok(noRules.reasons.includes('station_grant_missing'));
  assert.ok(noRules.reasons.includes('combo_rules_missing'));
});

test('invalid and duplicate market prices are rejected', () => {
  const invalid = structuredClone(events);
  invalid[0].event.players[0].price = -1;
  assert.throws(() => buildPublicationRow({
    active,
    events: invalid,
    publishedAt: '2026-07-01T00:00:00Z'
  }), /Invalid price/);

  const duplicate = structuredClone(events);
  duplicate[0].event.players.push(structuredClone(duplicate[0].event.players[0]));
  assert.throws(() => buildPublicationRow({
    active,
    events: duplicate,
    publishedAt: '2026-07-01T00:00:00Z'
  }), /Duplicate market player/);
});

test('unsupported publication kinds are rejected before archiving', () => {
  assert.throws(() => buildPublicationRow({
    active,
    events,
    publicationKind: 'silent_rewrite',
    publishedAt: '2026-07-01T00:00:00Z'
  }), /Unsupported publication kind/);
});
