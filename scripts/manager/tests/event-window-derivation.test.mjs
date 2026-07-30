import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveEventWindows } from '../lib/live-tennis-current-station.mjs';

function player(drawPosition) {
  return {
    draw_position: drawPosition,
    first_round: 'R1'
  };
}

function completedR1(scheduledAt) {
  return {
    round_order: 1,
    scheduled_at: scheduledAt,
    status: 'completed'
  };
}

function scheduledR2(scheduledAt) {
  return {
    round_order: 2,
    scheduled_at: scheduledAt,
    status: 'scheduled'
  };
}

test('earlier configured R2 time caps R1 when the detected R2 row starts later', () => {
  const event = {
    players: [player(1), player(2), player(3), player(4)],
    round2_first_match_at: '2026-07-29T17:00:00.000Z',
    transfer_window_closes_at: '2026-07-29T14:45:00.000Z'
  };
  const rows = [
    completedR1('2026-07-29T14:00:00.000Z'),
    completedR1('2026-07-29T14:09:00.000Z'),
    scheduledR2('2026-07-29T17:10:00.000Z')
  ];

  const windows = deriveEventWindows(event, rows, new Date('2026-07-30T01:53:20.000Z'));

  assert.equal(windows.round1_completed_at, '2026-07-29T16:59:00.000Z');
  assert.equal(windows.round2_first_match_at, '2026-07-29T17:00:00.000Z');
  assert.ok(
    new Date(windows.round1_completed_at) < new Date(windows.round2_first_match_at),
    'derived R1 completion must remain before the configured R2 boundary'
  );
});

test('manual transfer close is the safety boundary when no R2 start is configured or detected', () => {
  const event = {
    players: [player(1), player(2), player(3), player(4)],
    transfer_window_closes_at: '2026-07-29T14:45:00.000Z'
  };
  const rows = [
    completedR1('2026-07-29T14:00:00.000Z'),
    completedR1('2026-07-29T14:09:00.000Z')
  ];

  const windows = deriveEventWindows(event, rows, new Date('2026-07-30T01:53:20.000Z'));

  assert.equal(windows.round1_completed_at, '2026-07-29T14:44:00.000Z');
  assert.equal(windows.round2_first_match_at, '2026-07-29T14:45:00.000Z');
});
