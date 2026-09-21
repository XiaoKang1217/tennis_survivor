import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshDailyPredictionGamesByMedian } from '../lib/daily-prediction-selection.mjs';

const eventGroups = ['seoul', 'singapore'].map(event_key => ({ tour: 'WTA', event_key }));
const dateOverrides = { '2026-09-21': { seoul: { last_matches: 2 } } };

function fixture(day, games = []) {
  const matches = eventGroups.flatMap(({ event_key }) => [10, 20, 30].map((gap, i) => ({
    event_key, match_key: `${event_key}:${i}`, match_order: i,
    scheduled_at: `${day}T${10 + i}:00:00Z`, raw: { date: day },
    player1_key: `${event_key}:${i}:a`, player2_key: `${event_key}:${i}:b`, gap
  })));
  const players = matches.flatMap(m => [
    { event_key: m.event_key, player_key: m.player1_key, ranking: 1 },
    { event_key: m.event_key, player_key: m.player2_key, ranking: m.gap + 1 }
  ]);
  const client = {
    async select(table, query) {
      const event = query.event_key?.slice(3);
      if (table === 'tour_manager_daily_prediction_games') {
        if (query.status) return [];
        return games.filter(g => !event || g.event_key === event);
      }
      if (table === 'tour_manager_events') return [{ event_key: event, metadata: { timezone: 'UTC' } }];
      if (table === 'tour_manager_matches') return matches.filter(m => m.event_key === event);
      if (table === 'tour_manager_event_players') return players.filter(p => p.event_key === event);
      return [];
    },
    async insert(table, rows) { games.push(...rows); return rows; }
  };
  return { client, games };
}

async function run(day, games) {
  const f = fixture(day, games);
  const result = await refreshDailyPredictionGamesByMedian({
    client: f.client, stationKey: 'station', contestDate: day,
    now: `${day}T00:00:00Z`, eventGroups, dateOverrides
  });
  return { ...f, result };
}

test('creates one question per WTA event and limits only today Seoul to final two', async () => {
  const { games, result } = await run('2026-09-21');
  assert.equal(result.created, 2);
  assert.deepEqual(games.map(g => g.match_key), ['seoul:2', 'singapore:1']);
});

test('tomorrow Seoul uses the normal full-day median', async () => {
  const { games } = await run('2026-09-22');
  assert.deepEqual(games.map(g => g.match_key), ['seoul:1', 'singapore:1']);
});

test('preserves existing Singapore game and reruns without duplicating either game', async () => {
  const existing = { id: 'existing', event_key: 'singapore', match_key: 'singapore:0' };
  const { games, result } = await run('2026-09-21', [existing]);
  assert.equal(result.created, 1);
  assert.equal(games[0], existing);
  const again = await run('2026-09-21', games);
  assert.equal(again.result.created, 0);
  assert.equal(again.result.existing, 2);
});
