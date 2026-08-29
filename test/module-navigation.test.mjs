import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const modulePath = resolve(import.meta.dirname, '../core/module-navigation.js');

function loadNavigation(pages) {
  delete require.cache[modulePath];
  const actions = [];
  let stored = 'dark';
  globalThis.getCurrentPages = () => pages;
  globalThis.wx = {
    getStorageSync() { return stored; },
    setStorageSync(_key, value) { stored = value; },
    setBackgroundColor(options) { actions.push(['background', options.backgroundColor]); },
    setNavigationBarColor(options) { actions.push(['navigation', options.backgroundColor]); },
    redirectTo(options) { actions.push(['replace', options.url]); }
  };
  return { navigation: require(modulePath), actions };
}

test('module navigation replaces peer modules without native slide animation', () => {
  const { navigation, actions } = loadNavigation([{ route: 'pages/scores/index' }]);
  navigation.openModule('/pages/following/index');
  assert.deepEqual(actions, [
    ['background', '#0d1522'],
    ['navigation', '#0d1522'],
    ['replace', '/pages/following/index']
  ]);
});

test('module navigation does not build or unwind a page stack', () => {
  const { navigation, actions } = loadNavigation([
    { route: 'pages/scores/index' },
    { route: 'pages/following/index' },
    { route: 'pages/account/index' }
  ]);
  navigation.openModule('/pages/following/index');
  assert.deepEqual(actions.at(-1), ['replace', '/pages/following/index']);
});

test('module navigation is a no-op for the current module', () => {
  const { navigation, actions } = loadNavigation([{ route: 'pages/scores/index' }]);
  navigation.openModule('/pages/scores/index');
  assert.deepEqual(actions, []);
});

test('module navigation preserves query parameters while replacing the route', () => {
  const { navigation, actions } = loadNavigation([{ route: 'pages/draws/index' }]);
  navigation.openModule('/pages/calendar/index?mode=draws&season=2026');
  assert.deepEqual(actions.at(-1), ['replace', '/pages/calendar/index?mode=draws&season=2026']);
});

test('thirty peer switches keep replacement semantics without building a page stack', () => {
  const routes = [
    '/pages/scores/index',
    '/pages/draws/index',
    '/pages/calendar/index',
    '/pages/participation/index',
    '/packages/player/pages/players/index',
    '/pages/following/index',
    '/pages/account/index'
  ];
  const page = { route: 'pages/account/index' };
  const { navigation, actions } = loadNavigation([page]);
  for (let index = 0; index < 30; index += 1) {
    const url = routes[index % routes.length];
    page.route = 'pages/current/index';
    navigation.openModule(url);
  }
  assert.equal(actions.filter(action => action[0] === 'replace').length, 30);
  assert.equal(actions.filter(action => action[0] === 'background').length, 30);
});
