import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = relative => readFileSync(resolve(root, relative), 'utf8');

test('player and match gift sheets constrain native buttons to two shrinkable columns', () => {
  for (const relative of [
    'packages/player/pages/player-detail/index.wxss',
    'pages/match-detail/index.wxss'
  ]) {
    const source = read(relative);
    assert.match(source, /\.gift-actions\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u);
    assert.match(source, /\.gift-actions \.gift-action-button\{[^}]*width:100%[^}]*min-width:0[^}]*max-width:100%[^}]*margin:0[^}]*white-space:normal[^}]*box-sizing:border-box/u);
    assert.match(source, /\.gift-dialog input\{[^}]*width:100%[^}]*min-width:0[^}]*box-sizing:border-box/u);
    assert.match(source, /\.gift-actions \.gift-action-button::after\{border:0\}/u);
  }
});

test('badge actions and landscape draw toolbar remain bounded under large fonts', () => {
  const social = read('pages/social-center/index.wxss');
  assert.match(social, /\.badge-actions\{[^}]*max-width:58%[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u);
  assert.match(social, /\.badge-list \.badge-actions button\{[^}]*width:100%[^}]*min-width:0[^}]*white-space:normal[^}]*box-sizing:border-box/u);

  const landscape = read('packages/tournament/pages/draw-landscape/index.wxss');
  assert.match(landscape, /grid-template-columns:auto minmax\(120rpx,1fr\) minmax\(0,240rpx\)/u);
  assert.match(landscape, /\.toolbar-actions\{[^}]*width:100%[^}]*min-width:0/u);
  assert.match(landscape, /\.toolbar-actions button\{[^}]*min-width:0[^}]*flex:1 1 0[^}]*white-space:normal[^}]*box-sizing:border-box/u);
});

test('responsive action styles stay synchronized with the upload mirror', () => {
  for (const relative of [
    'packages/player/pages/player-detail/index.wxss',
    'pages/match-detail/index.wxss',
    'pages/social-center/index.wxss',
    'packages/tournament/pages/draw-landscape/index.wxss'
  ]) {
    assert.equal(read(relative), read(`miniprogram/${relative}`), relative);
  }
});

test('gift action columns stay inside 320 to 430px viewports at enlarged fonts', () => {
  for (const viewport of [320, 360, 375, 430]) {
    for (const fontScale of [1, 1.15, 1.3, 1.5]) {
      const maskPadding = viewport * 24 / 750;
      const dialogPadding = viewport * 28 / 750;
      const gap = viewport * 12 / 750;
      const available = viewport - 2 * maskPadding - 2 * dialogPadding;
      const column = (available - gap) / 2;
      const longestLabel = 4 * 11 * fontScale + 2 * viewport * 12 / 750;
      assert.ok(column > 0, `${viewport}px must retain positive columns`);
      assert.ok(longestLabel <= column, `${viewport}px at ${fontScale}x must wrap without overflow`);
    }
  }
});
