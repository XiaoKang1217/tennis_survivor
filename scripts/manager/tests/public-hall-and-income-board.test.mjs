import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202607270002_manager_career_income_leaderboard.sql',
  'utf8',
);

test('configuration hall exposes all requested sort modes', () => {
  assert.match(html, /id="manager-hall-sort"/);
  assert.match(html, />默认排序<\/option>/);
  assert.match(html, />总花费金额升序<\/option>/);
  assert.match(html, />总花费金额降序<\/option>/);
  assert.match(html, />提交时间升序<\/option>/);
  assert.match(html, />提交时间降序<\/option>/);
  assert.match(html, /MANAGER_HALL_SORT==='cost-asc'/);
  assert.match(html, /MANAGER_HALL_SORT==='cost-desc'/);
  assert.match(html, /MANAGER_HALL_SORT==='submitted-asc'/);
  assert.match(html, /MANAGER_HALL_SORT==='submitted-desc'/);
  assert.match(html, /managerHallSortChanged\(target\.value\)/);
});

test('career income view reuses the popup income definition and counts participated stations', () => {
  assert.match(migration, /create view public\.tour_manager_career_income_leaderboard/);
  assert.match(migration, /wl\.type in \('player_points_delta','points_delta'\)/);
  assert.match(migration, /wl\.type = 'station_combo_bonus'/);
  assert.match(migration, /wl\.type = 'daily_prediction_reward'/);
  assert.match(migration, /wl\.amount > 0/);
  assert.match(migration, /count\(distinct l\.station_key\)::int as station_count/);
  assert.match(migration, /l\.status in \('submitted','locked','settling','settled'\)/);
  assert.match(migration, /round\(total_income::numeric \/ nullif\(station_count, 0\), 1\)/);
  assert.match(migration, /grant select on public\.tour_manager_career_income_leaderboard to anon, authenticated/);
  const publicProjection = migration.slice(migration.lastIndexOf('\nselect\n'), migration.indexOf('\nfrom scored;'));
  assert.doesNotMatch(publicProjection, /\n\s+user_id,\n\s+display_name/);
});

test('leaderboard loads and displays cumulative income breakdown without replacing badge gallery', () => {
  assert.match(html, /from\('tour_manager_career_income_leaderboard'\)/);
  assert.match(html, /<b>累计收益榜<\/b>/);
  for (const label of ['总收益', '球员收益', 'Combo 收益', '竞猜收益', '参赛站数', '站均收益']) {
    assert.ok(html.includes(`<th>${label}</th>`), `${label} column missing`);
  }
  assert.match(html, /<b>徽章展馆<\/b>/);
  assert.match(html, /managerRenderBadgeGallery\(\)/);
});
