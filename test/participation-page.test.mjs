import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const uploadRoot = resolve(import.meta.dirname, '..');

function loadPageDefinition() {
  const pagePath = require.resolve('../pages/participation/index');
  delete require.cache[pagePath];
  let definition;
  const previousPage = globalThis.Page;
  globalThis.Page = value => { definition = value; };
  try {
    require(pagePath);
  } finally {
    if (previousPage === undefined) delete globalThis.Page;
    else globalThis.Page = previousPage;
  }
  return definition;
}

function wxRuntime() {
  return {
    redirected: '',
    refreshStopped: false,
    getStorageSync() { return ''; },
    setStorageSync() {},
    getWindowInfo() { return { statusBarHeight: 47 }; },
    getSystemInfoSync() { return { statusBarHeight: 44 }; },
    stopPullDownRefresh() { this.refreshStopped = true; },
    redirectTo(options) { this.redirected = options.url; }
  };
}

function pageContext(definition) {
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(update, callback) {
      Object.assign(this.data, update);
      if (typeof callback === 'function') callback.call(this);
    }
  };
}

test('participation page is owner-deferred instead of an engineering placeholder', () => {
  const source = [
    readFileSync(resolve(uploadRoot, 'pages/participation/index.js'), 'utf8'),
    readFileSync(resolve(uploadRoot, 'pages/participation/index.wxml'), 'utf8'),
    readFileSync(resolve(uploadRoot, 'pages/participation/index.wxss'), 'utf8')
  ].join('\n');
  assert.match(source, /M7-PARTICIPATION-DEFERRED-BY-OWNER/u);
  assert.match(source, /暂无参赛动态/u);
  assert.match(source, /退赛、替补和名单变化会显示在这里/u);
  assert.doesNotMatch(source, /TOUR WATCH|正在准备|当前接口|接入真实|尚未返回可信/u);
  assert.doesNotMatch(source, /\/api\/v1\/bff\/participation|loadProjectionResource|readTrustedProjection|createSWRCache/u);
  assert.doesNotMatch(source, /normalizeKind|participation-projection-bff|participation_projection/u);
  assert.doesNotMatch(source, /data-notice|participation-summary|eventItems|retryable|loading|failed/u);
});

test('participation page stays static and never calls an app service', () => {
  const previousWx = globalThis.wx;
  const previousGetApp = globalThis.getApp;
  const wx = wxRuntime();
  globalThis.wx = wx;
  globalThis.getApp = () => {
    throw new Error('participation_page_must_not_request_services');
  };
  try {
    const definition = loadPageDefinition();
    const context = pageContext(definition);
    definition.onLoad.call(context);
    definition.onPullDownRefresh.call(context);

    assert.equal(context.data.topInset, 47);
    assert.equal(context.data.participationDeferredMarker, 'M7-PARTICIPATION-DEFERRED-BY-OWNER');
    assert.equal(context.data.emptyLabel, '暂无参赛动态');
    assert.equal(context.data.emptyMessage, '退赛、替补和名单变化会显示在这里');
    assert.equal(wx.refreshStopped, true);

    definition.openDraws.call(context);
    assert.equal(wx.redirected, '/pages/draws/index');
  } finally {
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
    if (previousGetApp === undefined) delete globalThis.getApp;
    else globalThis.getApp = previousGetApp;
  }
});
