import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const miniRoot = resolve(import.meta.dirname, '..', 'miniprogram');
const read = relative => readFileSync(resolve(miniRoot, relative), 'utf8');

test('the three skins are persistent and keep clean blue as the safe default', () => {
  let stored = '';
  globalThis.wx = {
    getStorageSync: () => stored,
    setStorageSync: (_key, value) => { stored = value; }
  };
  const require = createRequire(import.meta.url);
  const theme = require(resolve(miniRoot, 'core/theme.js'));
  assert.equal(theme.readTheme(), 'clean-blue');
  assert.equal(theme.writeTheme('daylight'), 'daylight');
  assert.equal(theme.readTheme(), 'daylight');
  assert.equal(theme.writeTheme('dark'), 'dark');
  assert.equal(theme.readTheme(), 'dark');
  assert.equal(theme.writeTheme('unknown'), 'clean-blue');
  assert.deepEqual(theme.THEMES.map(item => item.label), ['简洁蓝白', '黑夜模式', '日光赛场']);
});

test('daylight and dark reuse the standard product structure at runtime', () => {
  const pages = [
    'account', 'calendar', 'draws', 'following', 'match-detail',
    'participation', 'player-detail', 'players', 'scores', 'tournament-detail'
  ];
  const require = createRequire(import.meta.url);
  const theme = require(resolve(miniRoot, 'core/theme.js'));
  assert.equal(theme.buildThemeData('daylight').isDaylight, false);
  assert.equal(theme.buildThemeData('daylight').isWarm, true);
  assert.equal(theme.buildThemeData('dark').isDark, true);
  for (const page of pages) {
    const markup = read(`pages/${page}/index.wxml`);
    assert.match(markup, /theme-\{\{uiTheme\}\}/, page);
    assert.match(markup, /wx:else/, page);
    const script = read(`pages/${page}/index.js`);
    assert.match(script, /buildThemeData/, page);
    assert.match(script, /syncPageTheme/, page);
  }
  const cardMarkup = read('components/match-card/index.wxml');
  const cardCss = read('components/match-card/index.wxss');
  const detailMarkup = read('pages/match-detail/index.wxml');
  assert.doesNotMatch(cardMarkup, /daylight-match-card/);
  assert.doesNotMatch(cardCss, /daylight-match-card/);
  assert.doesNotMatch(detailMarkup, /match\.group !== 'completed'/);
  assert.match(cardCss, /\.match-card\.theme-daylight/);
  assert.match(cardCss, /\.match-card\.theme-dark/);
});

test('daylight match cards preserve the complete real score identity', () => {
  const markup = read('components/match-card/index.wxml');
  for (const field of [
    'item.seedLabel', 'member.countryMark', 'match.disciplineLabel',
    'match.qualifyingLabel', 'item.isServer', 'item.isWinner',
    'item.oddsLabel', 'item.setScores', 'item.tiebreak'
  ]) assert.match(markup, new RegExp(field.replace('.', '\\.')));
  assert.match(markup, /item\.isServer && match\.group !== 'ended'/);
});

test('account provides the named skin switch without removing the blue skin', () => {
  const markup = read('pages/account/index.wxml');
  const script = read('pages/account/index.js');
  assert.match(markup, /界面皮肤/);
  assert.match(markup, /用户协议/);
  assert.match(markup, /隐私政策/);
  assert.match(markup, /toggleLogin/);
  assert.match(markup, /themeOptions/);
  assert.match(markup, /chooseTheme/);
  assert.match(markup, /product-tabbar active="account" theme="\{\{uiTheme\}\}"/);
  assert.match(script, /未登录/);
  assert.match(script, /编辑资料/);
  assert.match(script, /退出登录/);
  assert.match(script, /logout/);
  assert.doesNotMatch(markup, /数据时区|比分更新|赛程归属|数据同步/);
  assert.doesNotMatch(markup + script, /未设置昵称|完善资料|手机号/);
});

test('full-width themed pages explicitly contain horizontal overflow', () => {
  for (const page of ['players', 'calendar', 'match-detail', 'player-detail']) {
    const css = read(`pages/${page}/index.wxss`);
    assert.match(css, /overflow-x:hidden/, page);
    assert.match(css, /theme-daylight/, page);
  }
});
