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
    navigateTo(options) { actions.push(['push', options.url]); },
    navigateBack(options) { actions.push(['back', options.delta]); }
  };
  return { navigation: require(modulePath), actions };
}

test('module navigation keeps the painted page underneath new modules', () => {
  const { navigation, actions } = loadNavigation([{ route: 'pages/scores/index' }]);
  navigation.openModule('/pages/following/index');
  assert.deepEqual(actions, [['push', '/pages/following/index']]);
});

test('module navigation reveals an already painted page without recreating it', () => {
  const { navigation, actions } = loadNavigation([
    { route: 'pages/scores/index' },
    { route: 'pages/following/index' },
    { route: 'pages/account/index' }
  ]);
  navigation.openModule('/pages/following/index');
  assert.deepEqual(actions, [['back', 1]]);
});
