'use strict';

function routeOf(url) {
  return String(url || '').split('?')[0].replace(/^\//u, '');
}

function currentPages() {
  if (typeof getCurrentPages !== 'function') return [];
  try { return getCurrentPages() || []; } catch (_error) { return []; }
}

function openModule(url) {
  const route = routeOf(url);
  if (!route) return;
  const pages = currentPages();
  const current = pages.at(-1);
  if (current?.route === route) return;

  const existingIndex = pages.findIndex(page => page?.route === route);
  if (existingIndex >= 0) {
    const delta = pages.length - 1 - existingIndex;
    if (delta > 0) wx.navigateBack({ delta });
    return;
  }

  // Keep the painted page underneath while the next module prepares its first
  // frame. redirectTo/reLaunch destroys it first and exposes WeChat's static
  // light window for one frame in the dark skin.
  wx.navigateTo({ url });
}

module.exports = Object.freeze({ openModule, routeOf });
