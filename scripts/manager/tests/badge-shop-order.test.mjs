import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../../assets/manager/badges/ui-v5/badge-ui.css', import.meta.url), 'utf8');

test('badge shop puts the latest release first and sorts each group by price descending', () => {
  assert.match(html, /var latestRelease=badges\.reduce/);
  assert.match(html, /return Number\(bNew\)-Number\(aNew\)\|\|\(Number\(b\.price\)\|\|0\)-\(Number\(a\.price\)\|\|0\)/);
  assert.match(html, /managerBadgeCardHtml\(b,!!owned\[b\.badge_key\],active&&active\.badge_key===b\.badge_key,'shop',isNew\)/);
});

test('only latest shop cards receive a slanted red NEW mark', () => {
  assert.match(html, /source==='shop'&&isNew\?'<span class="manager-badge-new-mark"/);
  assert.match(css, /\.manager-badge-new-mark\{[^}]*color:#d31f1f[^}]*transform:rotate\(-12deg\)/);
  assert.match(css, /\.manager-badge-card\.is-new \.manager-badge-card-flags\{padding-top:38px\}/);
});
