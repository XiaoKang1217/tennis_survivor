import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../../../supabase/migrations/202607130002_manager_market_price_rollback.sql',
  import.meta.url
);

test('market price rollback is session-independent and keeps target lists aligned', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.doesNotMatch(sql, /create\s+temporary\s+table/i);
  assert.doesNotMatch(
    sql,
    /manager_market_price_rollback_targets|manager_athens_qualifier_identity_repairs/
  );

  const targetBlocks = [...sql.matchAll(/v_targets jsonb := '(\[[\s\S]*?\])'::jsonb;/g)]
    .map((match) => JSON.parse(match[1]));

  assert.equal(targetBlocks.length, 2);
  assert.equal(targetBlocks[0].length, 19);
  assert.deepEqual(targetBlocks[1], targetBlocks[0]);
  assert.equal(new Set(targetBlocks[0].map((row) => `${row.event_key}|${row.player_key}`)).size, 19);
});
