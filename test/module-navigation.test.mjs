import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const modulePath = resolve(import.meta.dirname, '../core/module-navigation.js');

function loadNavigation(pages) {
  delete require.cache[modulePath];
  const actions = [];
  globalThis.getCurrentPages = () => pages;
  globalThis.wx = {
    redirectTo(options) { actions.push(['replace', options.url]); }
  };
  return { navigation: require(modulePath), actions };
}

test('module navigation replaces peer modules without native slide animation', () => {
  const { navigation, actions } = loadNavigation([{ route: 'pages/scores/index' }]);
  navigation.openModule('/pages/following/index');
  assert.deepEqual(actions, [['replace', '/pages/following/index']]);
});

test('module navigation does not build or unwind a page stack', () => {
  const { navigation, actions } = loadNavigation([
    { route: 'pages/scores/index' },
    { route: 'pages/following/index' },
    { route: 'pages/account/index' }
  ]);
  navigation.openModule('/pages/following/index');
  assert.deepEqual(actions, [['replace', '/pages/following/index']]);
});

test('module navigation is a no-op for the current module', () => {
  const { navigation, actions } = loadNavigation([{ route: 'pages/scores/index' }]);
  navigation.openModule('/pages/scores/index');
  assert.deepEqual(actions, []);
});
