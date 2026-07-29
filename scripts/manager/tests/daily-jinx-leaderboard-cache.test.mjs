import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync('index.html', 'utf8');
const workflow = fs.readFileSync('.github/workflows/update_preference.yml', 'utf8');
const fetchSettlements = fs.readFileSync('scripts/fetch_daily_jinx_settlements.py', 'utf8');
const publisher = fs.readFileSync('scripts/update_daily_jinx_leaderboard.mjs', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202607290002_daily_jinx_incremental_leaderboard.sql',
  'utf8',
);
const safeDeleteFix = fs.readFileSync(
  'supabase/migrations/202607290003_daily_jinx_safe_delete_fix.sql',
  'utf8',
);
const cachePath = 'data/daily_jinx_leaderboard.json';
const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync('data/manifest.json', 'utf8'));

function contentVersion(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

test('Daily Jinx uses an idempotent incremental score ledger', () => {
  assert.match(migration, /create table if not exists public\.daily_jinx_score_ledger/);
  assert.match(migration, /unique \(vote_id, settlement_key\)/);
  assert.match(migration, /daily_jinx_refresh_leaderboard\(\s*p_settlements jsonb,\s*p_refresh_dates date\[\],\s*p_full_refresh boolean/s);
  assert.match(
    migration,
    /if coalesce\(p_full_refresh, false\) then\s+delete from public\.daily_jinx_score_ledger\s+where id is not null/s,
  );
  assert.match(migration, /where vote_date = any\(p_refresh_dates\)/);
  assert.match(
    migration,
    /delete from public\.daily_jinx_leaderboard_cache\s+where account_id is not null/s,
  );
  assert.match(migration, /v\.created_at < s\.match_start_at/);
  assert.match(migration, /btrim\(picked\.player_name\) = s\.player_name/);
  assert.match(migration, /grant execute on function public\.daily_jinx_refresh_leaderboard\(jsonb, date\[\], boolean\)\s+to service_role/);
  assert.doesNotMatch(migration, /to anon|to authenticated/);
});

test('Daily Jinx deployed RPC patch satisfies Supabase safe-delete guards', () => {
  assert.match(
    safeDeleteFix,
    /create or replace function public\.daily_jinx_refresh_leaderboard/,
  );
  assert.match(
    safeDeleteFix,
    /delete from public\.daily_jinx_score_ledger\s+where id is not null/s,
  );
  assert.match(
    safeDeleteFix,
    /delete from public\.daily_jinx_leaderboard_cache\s+where account_id is not null/s,
  );
  assert.doesNotMatch(
    safeDeleteFix,
    /delete from public\.(?:daily_jinx_score_ledger|daily_jinx_leaderboard_cache)\s*;/,
  );
});

test('Update Daily Data settles before publishing the compact cache', () => {
  const settlementIndex = workflow.indexOf('fetch_daily_jinx_settlements.py');
  const leaderboardIndex = workflow.indexOf('update_daily_jinx_leaderboard.mjs');
  const manifestIndex = workflow.indexOf('build_data_manifest.py');
  assert.ok(settlementIndex >= 0);
  assert.ok(leaderboardIndex > settlementIndex);
  assert.ok(manifestIndex > leaderboardIndex);
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
  assert.match(workflow, /data\/daily_jinx_leaderboard\.json/);
  assert.match(fetchSettlements, /"refreshed_dates": sorted\(successful_refresh_dates\)/);
  assert.match(publisher, /row\?\.pick_count \|\| 0/);
  assert.match(publisher, /pickCount <= 0/);
  assert.match(publisher, /existing\.ledger_sync !== true/);
  assert.match(publisher, /p_full_refresh: fullRefresh/);
});

test('frontend prefetched cache replaces lifetime browser-side scoring', () => {
  assert.match(html, /prefetchJinxLeaderboard\(\);\s*loadData\(\);/);
  assert.match(html, /daily-jinx-leaderboard-v2/);
  assert.match(html, /data\/daily_jinx_leaderboard\.json/);
  assert.match(html, /readStoredJinxLeaderboard/);
  assert.match(html, /storeJinxLeaderboard/);
  assert.match(html, /managerApplyActiveBadges\(normalized\.badges\)/);
  assert.doesNotMatch(html, /data\/daily_jinx_settlements\.json/);
  assert.doesNotMatch(html, /client\.rpc\('daily_jinx_leaderboard'/);
});

test('published Daily Jinx cache is compact, complete, and cache-busted', () => {
  assert.equal(cache.schema_version, 2);
  assert.match(cache.settled_through, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Array.isArray(cache.leaderboard));
  assert.ok(cache.leaderboard.some((row) => row.tour === 'ATP'));
  assert.ok(cache.leaderboard.some((row) => row.tour === 'WTA'));
  assert.ok(Array.isArray(cache.badges));
  assert.ok(fs.statSync(cachePath).size < 100_000);
  assert.equal(manifest.files[cachePath]?.version, contentVersion(cachePath));
});
