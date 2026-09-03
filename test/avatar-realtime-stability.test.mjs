import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { presentation } from './support.mjs';

const require = createRequire(import.meta.url);
const { mergeRealtimeOnlyState, mergeSnapshotState } = require('../core/score-store');
const { matchView } = require('../core/view-model');

const available = value => ({ state: 'available', value, message: null, reasonCode: null });
const unknown = () => ({ state: 'unknown', value: null, message: 'unknown', reasonCode: 'not_observed' });

function withPortraits(value) {
  const copy = structuredClone(value);
  copy.participants[0].sourceSideKey = 'first';
  copy.participants[1].sourceSideKey = 'second';
  copy.participants[0].members[0].portraitAvailability = available({ publicUrl: 'https://media.example/a.jpg' });
  copy.participants[1].members[0].portraitAvailability = available({ publicUrl: 'https://media.example/b.jpg' });
  return copy;
}

test('thin realtime participants cannot clear trusted detail portraits', () => {
  const previous = withPortraits(presentation());
  const incoming = structuredClone(previous);
  incoming.matchVersion = 2;
  incoming.participants.forEach(side => side.members.forEach(member => {
    member.portraitAvailability = unknown();
    member.ranking = unknown();
  }));
  const merged = mergeRealtimeOnlyState(incoming, previous);
  assert.deepEqual(
    merged.participants.map(side => side.members[0].portraitAvailability.value.publicUrl),
    ['https://media.example/a.jpg', 'https://media.example/b.jpg']
  );
});

test('sides and doubles members merge by stable IDs when presentation order changes', () => {
  const previous = withPortraits(presentation({ discipline: 'doubles' }));
  const firstExtra = structuredClone(previous.participants[0].members[0]);
  firstExtra.playerId = available('player-a2');
  firstExtra.portraitAvailability = available({ publicUrl: 'https://media.example/a2.jpg' });
  previous.participants[0].members.push(firstExtra);
  const incoming = structuredClone(previous);
  incoming.participants.reverse();
  incoming.participants.forEach(side => {
    side.members.reverse();
    side.members.forEach(member => { member.portraitAvailability = unknown(); });
  });
  const merged = mergeSnapshotState(incoming, previous);
  const portraits = new Map(merged.participants.flatMap(side => side.members.map(member => [
    member.playerId.value,
    member.portraitAvailability.value.publicUrl
  ])));
  assert.equal(portraits.get('player-a2'), 'https://media.example/a2.jpg');
  assert.equal(portraits.get(previous.participants[1].members[0].playerId.value),
    'https://media.example/b.jpg');
});

test('match view produces a stable image-failure key and above-fold portraits are eager', () => {
  const view = matchView(withPortraits(presentation()));
  assert.match(view.sides[0].members[0].portraitKey, /\|https:\/\/media\.example\/a\.jpg$/u);
  const markup = readFileSync(new URL('../pages/match-detail/index.wxml', import.meta.url), 'utf8');
  assert.match(markup, /lazy-load="\{\{false\}\}"/u);
  assert.match(markup, /failedPortraits\[member\.portraitKey\]/u);
  assert.match(markup, /binderror="onPortraitError"/u);
});
