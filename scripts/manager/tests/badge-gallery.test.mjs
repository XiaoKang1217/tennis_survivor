import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../../../index.html', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../../supabase/migrations/202607170005_manager_badge_gallery.sql', import.meta.url), 'utf8');

test('public badge gallery view exposes only display-safe collection fields', () => {
  assert.match(migration, /create view public\.tour_manager_badge_gallery/);
  assert.match(migration, /order by badge_count desc, badge_total_price desc/);
  assert.match(migration, /grant select on public\.tour_manager_badge_gallery to anon, authenticated/);
  const projection = migration.slice(migration.lastIndexOf('\nselect\n'), migration.indexOf('\nfrom ranked;'));
  assert.match(projection, /rank_no/);
  assert.match(projection, /display_name/);
  assert.match(projection, /badge_count/);
  assert.match(projection, /badges/);
  assert.doesNotMatch(projection, /user_id|badge_total_price|purchased_at/);
});

test('badge gallery is rendered below the wallet leaderboard', () => {
  const renderer = html.slice(html.indexOf('function managerRenderBoardsPage()'), html.indexOf('function managerRenderDailyPredictions()'));
  assert.ok(renderer.indexOf('当前本金榜') < renderer.indexOf('徽章展馆'));
  assert.match(renderer, /managerRenderBadgeGallery\(\)/);
});

test('each badge collection paginates independently at eight thumbnails', () => {
  assert.match(html, /managerPaginate\(badges,MANAGER_BADGE_GALLERY_PAGES\[key\],8\)/);
  assert.match(html, /data-manager-action="page-badge-gallery"/);
  assert.match(html, /data-manager-gallery-key=/);
  assert.match(html, /managerSetBadgeGalleryPage/);
});

test('badge thumbnails defer loading and preserve stable two-row shelves', () => {
  assert.match(html, /manager-badge-gallery-shelf\{[^}]*grid-template-rows:repeat\(2,86px\)/);
  assert.match(html, /class="manager-badge-gallery-item"[\s\S]*?loading="lazy" decoding="async" fetchpriority="low"/);
});

test('public data loader fetches the badge gallery alongside other boards', () => {
  assert.match(html, /client\.from\('tour_manager_badge_gallery'\)/);
  assert.match(html, /Promise\.allSettled\(\[configReq,boardReq,walletReq,activeBadgeReq,badgeCatalogReq,badgeGalleryReq\]\)/);
});
