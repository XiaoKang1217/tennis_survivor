'use strict';

const { readTheme, syncNativeTheme } = require('./theme');

function routeOf(url) {
  return String(url || '').split('?')[0].replace(/^\//u, '');
}

function openModule(url) {
  const route = routeOf(url);
  if (!route) return;
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const current = pages?.at?.(-1);
  if (current?.route === route) return;

  // Product modules are peers, not drill-down pages. Replacing the current
  // page avoids the native push/pop slide. Re-assert the current persisted
  // canvas synchronously before replacement so the host surface exposed
  // between page destruction and the target page's first paint cannot fall
  // back to WeChat's light default. readTheme() is memory-backed after App
  // launch, so this adds no storage read, wait, animation, or network work.
  syncNativeTheme(readTheme());
  wx.redirectTo({ url });
}

module.exports = Object.freeze({ openModule, routeOf });
