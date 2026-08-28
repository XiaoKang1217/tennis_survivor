import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const miniRoot = resolve(import.meta.dirname, '..');
const read = relative => readFileSync(resolve(miniRoot, relative), 'utf8');

test('the three skins are persistent and keep clean blue as the safe default', () => {
  let stored = '';
  const pageUpdates = [[], []];
  const nativeBackgrounds = [];
  const nativeNavigation = [];
  globalThis.wx = {
    getStorageSync: () => stored,
    setStorageSync: (_key, value) => { stored = value; },
    setBackgroundColor: value => nativeBackgrounds.push(value),
    setNavigationBarColor: value => nativeNavigation.push(value)
  };
  globalThis.getCurrentPages = () => pageUpdates.map(updates => ({
    data: { uiTheme: 'clean-blue' },
    setData: value => updates.push(value)
  }));
  const require = createRequire(import.meta.url);
  const theme = require(resolve(miniRoot, 'core/theme.js'));
  assert.equal(theme.readTheme(), 'clean-blue');
  assert.equal(theme.writeTheme('daylight'), 'daylight');
  assert.equal(nativeBackgrounds.at(-1).backgroundColor, '#f5f0e7');
  assert.equal(nativeNavigation.at(-1).frontColor, '#000000');
  assert.deepEqual(pageUpdates.map(updates => updates.at(-1)?.uiTheme), ['daylight', 'daylight']);
  assert.equal(theme.readTheme(), 'daylight');
  assert.equal(theme.writeTheme('dark'), 'dark');
  assert.equal(nativeBackgrounds.at(-1).backgroundColor, '#0d1522');
  assert.equal(nativeNavigation.at(-1).frontColor, '#ffffff');
  assert.equal(theme.readTheme(), 'dark');
  assert.equal(theme.writeTheme('unknown'), 'clean-blue');
  assert.deepEqual(theme.THEMES.map(item => item.label), ['简洁蓝白', '黑夜模式', '日光赛场']);
  delete globalThis.getCurrentPages;
});

test('daylight and dark reuse the standard product structure at runtime', () => {
  const pagePaths = [
    'pages/account/index',
    'pages/calendar/index',
    'pages/draws/index',
    'pages/following/index',
    'pages/match-detail/index',
    'pages/participation/index',
    'packages/player/pages/player-detail/index',
    'packages/player/pages/players/index',
    'pages/scores/index',
    'packages/tournament/pages/tournament-detail/index'
  ];
  const require = createRequire(import.meta.url);
  const theme = require(resolve(miniRoot, 'core/theme.js'));
  assert.equal(theme.buildThemeData('daylight').isDaylight, false);
  assert.equal(theme.buildThemeData('daylight').isWarm, true);
  assert.equal(theme.buildThemeData('dark').isDark, true);
  for (const pagePath of pagePaths) {
    const markup = read(`${pagePath}.wxml`);
    assert.match(markup, /theme-\{\{uiTheme\}\}/, pagePath);
    assert.doesNotMatch(markup, /isDaylight/, pagePath);
    const script = read(`${pagePath}.js`);
    assert.match(script, /buildThemeData/, pagePath);
    assert.match(script, /syncPageTheme/, pagePath);
  }
  const cardMarkup = read('components/match-card/index.wxml');
  const cardCss = read('components/match-card/index.wxss');
  const detailMarkup = read('pages/match-detail/index.wxml');
  assert.doesNotMatch(cardMarkup, /daylight-match-card/);
  assert.doesNotMatch(cardCss, /daylight-match-card/);
  assert.doesNotMatch(detailMarkup, /match\.group !== 'completed'/);
  assert.match(detailMarkup, /match\.officialScheduleDate/);
  assert.doesNotMatch(detailMarkup, /class="tour-badge"/);
  assert.match(cardCss, /\.match-card\.theme-daylight/);
  assert.match(cardCss, /\.match-card\.theme-dark/);
});

test('every page applies the persisted theme before first-frame page setup', () => {
  for (const pagePath of [
    'pages/account/index',
    'pages/scores/index',
    'pages/match-detail/index',
    'pages/draws/index',
    'pages/calendar/index',
    'pages/participation/index',
    'pages/following/index',
    'pages/social-center/index',
    'pages/flower-ledger/index',
    'pages/legal/index',
    'packages/player/pages/players/index',
    'packages/player/pages/player-detail/index',
    'packages/tournament/pages/tournament-detail/index',
    'packages/tournament/pages/draw-landscape/index'
  ]) {
    const markup = read(`${pagePath}.wxml`);
    const script = read(`${pagePath}.js`);
    assert.match(markup, /^<page-meta page-style="\{\{themePageStyle\}\}" background-color="\{\{themeCanvas\}\}"/u, pagePath);
    assert.match(markup, /theme-\{\{uiTheme\}\}/u, pagePath);
    assert.match(script, /onLoad\([^)]*\)\s*\{\s*syncPageTheme\(this\);/u, pagePath);
  }
});

test('module navigation preserves the painted window instead of relaunching to white', () => {
  const tabbar = read('components/product-tabbar/index.js');
  const navigation = read('core/module-navigation.js');
  assert.match(tabbar, /openModule\(ROUTES\[target\]\)/u);
  assert.match(navigation, /wx\.navigateTo\(\{ url \}\)/u);
  assert.match(navigation, /wx\.navigateBack\(\{ delta \}\)/u);
  assert.doesNotMatch(navigation, /wx\.redirectTo|wx\.reLaunch/u);
  assert.doesNotMatch(tabbar, /wx\.reLaunch/u);
});

test('visual truth tokens and svg paths are migrated without the sample portrait', () => {
  const globalCss = read('app.wxss');
  const themeScript = read('core/theme.js');
  const icons = read('components/ui-icon/index.js');
  assert.match(globalCss, /--brand:\s*#1769df/);
  assert.match(globalCss, /--canvas:\s*#f1f6fd/);
  assert.match(globalCss, /--brand:\s*#187a59/);
  assert.match(globalCss, /--canvas:\s*#0d1522/);
  assert.match(themeScript, /#1769df/);
  assert.match(themeScript, /#187a59/);
  assert.match(themeScript, /#6ba8ff/);
  assert.match(icons, /circle cx="14" cy="12" r="7\.5"/u);
  assert.match(icons, /circle cx="12" cy="12" r="9"/u);
  assert.match(icons, /circle cx="17\.2" cy="7" r="2\.2"/u);
  assert.match(icons, /rect x="3" y="3" width="18" height="18" rx="4"/u);
  assert.match(icons, /rect x="3" y="3\.5" width="6" height="4"/u);
  assert.equal(
    existsSync(resolve(miniRoot, 'assets/player-share-portrait-sample.png')),
    false
  );
});

test('product copy avoids decorative english eyebrows', () => {
  const markup = [
    'pages/account/index.wxml',
    'pages/calendar/index.wxml',
    'pages/following/index.wxml',
    'pages/legal/index.wxml',
    'pages/participation/index.wxml',
    'packages/player/pages/player-detail/index.wxml',
    'packages/player/pages/players/index.wxml',
    'pages/scores/index.wxml',
    'packages/tournament/pages/tournament-detail/index.wxml'
  ].map(read).join('\n');
  assert.doesNotMatch(
    markup,
    /LIVE TENNIS|PLAYER CENTER|TOUR CALENDAR|PAST DRAWS|MY TENNIS|ENTRY BOARD|ACCOUNT|TOURNAMENT|LEGAL|SEASON|CAREER|PLAYER/u
  );
});

test('daylight match cards preserve the complete real score identity', () => {
  const markup = read('components/match-card/index.wxml');
  for (const field of [
    'item.seedLabel', 'member.countryMark', 'match.disciplineLabel',
    'item.isServer', 'item.isWinner',
    'item.oddsLabel', 'item.setScores', 'item.tiebreak'
  ]) assert.match(markup, new RegExp(field.replace('.', '\\.')));
  assert.doesNotMatch(markup, /match\.qualifyingLabel/u);
  assert.match(markup, /item\.isServer && match\.group !== 'ended'/);
});

test('account provides the named skin switch without removing the blue skin', () => {
  const markup = read('pages/account/index.wxml');
  const script = read('pages/account/index.js');
  assert.match(markup, /界面主题/);
  assert.match(markup, /用户协议/);
  assert.match(markup, /隐私政策/);
  assert.match(markup, /toggleLogin/);
  assert.match(markup, /themeOptions/);
  assert.match(markup, /chooseTheme/);
  assert.match(markup, /product-tabbar active="account" theme="\{\{uiTheme\}\}"/);
  assert.match(markup, /class="account-content" style="padding-top:\{\{topInset\}\}px"/u);
  assert.doesNotMatch(markup, /个人中心|class="root-head"/u);
  assert.match(script, /未登录/);
  assert.match(script, /编辑资料/);
  assert.match(script, /退出登录/);
  assert.match(script, /logout/);
  assert.doesNotMatch(markup, /数据时区|比分更新|赛程归属|数据同步/);
  assert.doesNotMatch(markup + script, /未设置昵称|完善资料|手机号/);
});

test('full-width themed pages explicitly contain horizontal overflow', () => {
  for (const page of [
    'packages/player/pages/players',
    'pages/calendar',
    'pages/match-detail',
    'packages/player/pages/player-detail'
  ]) {
    const css = read(`${page}/index.wxss`);
    assert.match(css, /overflow-x:hidden/, page);
    assert.match(css, /theme-daylight/, page);
  }
});
