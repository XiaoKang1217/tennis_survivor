'use strict';

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
  // page avoids the native push/pop slide while still preserving the app and
  // its already-applied runtime theme (unlike reLaunch).
  wx.redirectTo({ url });
}

module.exports = Object.freeze({ openModule, routeOf });
