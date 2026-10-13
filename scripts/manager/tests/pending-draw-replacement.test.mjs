import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDrawPlayers } from '../lib/live-tennis-current-station.mjs';
import { collectPreR1Substitutions, collectQualifierPlacements } from '../lib/qualifier-placements.mjs';

test('TBD waits without invalid RPC and later resolves at the locked price', () => {
  const original = { player_key: 'WTA|old-player', name_en: 'Old Player', draw_position: 12, price: 165 };
  const event = { tour: 'WTA', event_key: 'test', pricing: { market_prices_locked: true }, players: [original] };
  const pending = { name_en: '未知', profile_id: 'TBD', draw_position: 12, price: 999 };
  const first = mergeDrawPlayers(event, [pending]);
  assert.equal(first[0].price, 165);
  assert.equal(first[0].is_qualifier_placeholder, true);
  assert.deepEqual(collectPreR1Substitutions([{ event: { ...event, players: first } }]), []);
  const again = mergeDrawPlayers({ ...event, players: first }, [pending]);
  assert.equal(again[0].price, 165);
  const landed = mergeDrawPlayers({ ...event, players: again }, [{ name_en: 'New Player', profile_id: '123', draw_position: 12 }]);
  assert.equal(landed[0].price, 165);
  assert.equal(landed[0].pre_r1_substitution.locked_publication_player_key, 'WTA|old-player');
  const entries = [{ event: { ...event, players: landed } }];
  const swaps = collectPreR1Substitutions(entries);
  assert.equal(swaps[0].out_player_key, 'WTA|old-player');
  assert.equal(swaps[0].replacement_player_key, 'WTA|new-player');
  assert.equal(collectQualifierPlacements(entries)[0].replacement_player_key, 'WTA|new-player');
});

test('legacy pending slot recovers original publication identity, not temporary Q key', () => {
  const event = { tour: 'WTA', pricing: { market_prices_locked: true }, players: [{
    player_key: 'WTA|qualifier-12', name_en: 'Qualifier pending 12',
    is_qualifier_placeholder: true, draw_position: 12, price: 175,
    pre_r1_substitution: { out_player_key: 'WTA|anna-kalinskaya', replacement_player_key: 'WTA|qualifier-12' }
  }] };
  const incoming = [{ name_en: 'Lanlana TARARUDEE', profile_id: '123', draw_position: 12, price: 999 }];
  const landed = mergeDrawPlayers(event, incoming);
  assert.equal(landed[0].price, 175);
  assert.equal(landed[0].pre_r1_substitution.locked_publication_player_key, 'WTA|anna-kalinskaya');
  const repeated = mergeDrawPlayers({ ...event, players: landed }, incoming);
  assert.equal(repeated[0].price, 175);
  assert.equal(repeated[0].pre_r1_substitution.locked_publication_player_key, 'WTA|anna-kalinskaya');
});
