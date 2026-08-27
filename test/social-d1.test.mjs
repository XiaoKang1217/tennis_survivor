import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = readFileSync(new URL('../pages/social-center/index.js', import.meta.url), 'utf8');
const mirror = readFileSync(new URL('../miniprogram/pages/social-center/index.js', import.meta.url), 'utf8');

for (const [name, source] of [['root', root], ['mirror', mirror]]) {
  test(`SOCIAL-D1 ${name} check-in calendar sends a stable Shanghai YYYY-MM`, () => {
    assert.match(source, /Date\.now\(\) \+ 8 \* 60 \* 60 \* 1000/u);
    assert.match(source, /getUTCFullYear\(\).*getUTCMonth\(\) \+ 1/u);
    assert.doesNotMatch(source, /DateTimeFormat/u);
  });
}

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
