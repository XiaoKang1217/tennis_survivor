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
    assert.match(source, /\.gift-actions button\{[^}]*width:100%[^}]*min-width:0[^}]*margin:0[^}]*box-sizing:border-box/u);
    assert.match(source, /\.gift-dialog input\{[^}]*width:100%[^}]*min-width:0[^}]*box-sizing:border-box/u);
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
