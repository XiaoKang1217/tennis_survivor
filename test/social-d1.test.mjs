import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = readFileSync(new URL('../pages/social-center/index.js', import.meta.url), 'utf8');

test('SOCIAL-D1 check-in calendar sends a stable Shanghai YYYY-MM', () => {
  assert.match(root, /Date\.now\(\) \+ 8 \* 60 \* 60 \* 1000/u);
  assert.match(root, /getUTCFullYear\(\).*getUTCMonth\(\) \+ 1/u);
  assert.doesNotMatch(root, /DateTimeFormat/u);
});

test('SOCIAL-D1 flower totals use the flower emoji and sit inline with player names', () => {
  const matchView = readFileSync(new URL('../pages/match-detail/index.wxml', import.meta.url), 'utf8');
  const matchStyle = readFileSync(new URL('../pages/match-detail/index.wxss', import.meta.url), 'utf8');
  const playerView = readFileSync(new URL('../packages/player/pages/player-detail/index.wxml', import.meta.url), 'utf8');
  const leaderboardView = readFileSync(new URL('../packages/player/pages/players/index.wxml', import.meta.url), 'utf8');
  assert.match(matchView, /hero-name[^\n]*🌸\{\{item\.members\[0\]\.flowerTotal\}\}/u);
  assert.match(matchStyle, /hero-name-wrap\{align-items:baseline;gap:2rpx\}/u);
  assert.match(playerView, /🌸\{\{lifetimeFlowerTotal\}\}/u);
  assert.match(leaderboardView, /🌸\{\{item\.flowerTotal\}\}/u);
  assert.doesNotMatch(`${matchView}\n${playerView}\n${leaderboardView}`, />花\{\{/u);
});

test('SOCIAL-D1 account and check-in keep clear flower copy but use the emoji artwork', () => {
  const account = readFileSync(new URL('../pages/account/index.wxml', import.meta.url), 'utf8');
  const accountStyle = readFileSync(new URL('../pages/account/index.wxss', import.meta.url), 'utf8');
  const center = readFileSync(new URL('../pages/social-center/index.wxml', import.meta.url), 'utf8');
  assert.match(account, /我的花朵/u);
  assert.match(account, /签到、花朵与勋章/u);
  assert.match(center, /可用花朵/u);
  assert.match(center, /花朵明细/u);
  assert.match(`${account}\n${center}`, /🌸/u);
  assert.doesNotMatch(`${account}\n${center}`, /ui-icon[^>]*name="flower"/u);
  assert.match(accountStyle, /flower-emoji\{display:inline-flex;align-items:center;justify-content:center/u);
  assert.match(accountStyle, /flower-emoji-small\{width:20rpx;height:20rpx/u);
});

test('SOCIAL-D1 keeps logout at the bottom of the account page', () => {
  const account = readFileSync(new URL('../pages/account/index.wxml', import.meta.url), 'utf8');
  const accountStyle = readFileSync(new URL('../pages/account/index.wxss', import.meta.url), 'utf8');
  const settingsIndex = account.indexOf('class="settings-card"');
  const logoutIndex = account.indexOf('class="account-auth-button is-logout"');
  assert.ok(settingsIndex >= 0 && logoutIndex > settingsIndex);
  assert.match(account, /wx:if="\{\{profile\.completed\}\}" class="account-auth-button is-logout"/u);
  assert.match(accountStyle, /account-auth-button\.is-logout[^}]*margin-top: auto;/su);
  assert.match(accountStyle, /account-content[^}]*display: flex;[^}]*flex-direction: column;/su);
});

test('SOCIAL-D1 flower ledger has a five-item preview and server-filtered 20-item pages', () => {
  const center = readFileSync(new URL('../pages/social-center/index.js', import.meta.url), 'utf8');
  const centerView = readFileSync(new URL('../pages/social-center/index.wxml', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../services/social-service.js', import.meta.url), 'utf8');
  const ledger = readFileSync(new URL('../pages/flower-ledger/index.js', import.meta.url), 'utf8');
  const ledgerView = readFileSync(new URL('../pages/flower-ledger/index.wxml', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app.json', import.meta.url), 'utf8');
  assert.match(center, /ledger\(\{ limit: 5, offset: 0 \}\)/u);
  assert.match(centerView, /查看全部/u);
  assert.match(centerView, /openLedger/u);
  assert.match(app, /pages\/flower-ledger\/index/u);
  assert.match(ledger, /const PAGE_SIZE = 20/u);
  assert.match(ledger, /direction: this\.data\.selectedDirection/u);
  assert.match(ledger, /from: this\.data\.fromDate/u);
  assert.match(ledger, /to: this\.data\.toDate/u);
  assert.match(service, /direction=\$\{encodeURIComponent\(direction\)\}/u);
  assert.match(service, /from=\$\{encodeURIComponent\(from\)\}/u);
  assert.match(service, /to=\$\{encodeURIComponent\(to\)\}/u);
  for (const copy of ['全部', '收入', '支出', '开始日期', '结束日期', '上一页', '下一页']) {
    assert.match(`${ledger}\n${ledgerView}`, new RegExp(copy, 'u'));
  }
});
