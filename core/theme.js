'use strict';

const STORAGE_KEY = 'luwang_ui_theme';
const DEFAULT_THEME = 'clean-blue';
const THEMES = Object.freeze([
  Object.freeze({ id: 'clean-blue', label: '简洁蓝白', description: '清爽、明快的经典蓝白界面' }),
  Object.freeze({ id: 'dark', label: '黑夜模式', description: '低亮度深色界面，适合夜晚观看' }),
  Object.freeze({ id: 'daylight', label: '日光赛场', description: '暖色纸面与球场绿配色，复用标准组件' })
]);
const THEME_IDS = new Set(THEMES.map((theme) => theme.id));
const THEME_PALETTE = Object.freeze({
  'clean-blue': Object.freeze({
    label: '简洁蓝白',
    accent: '#1769df',
    accentStrong: '#0f4fac',
    ink: '#10233f',
    muted: '#64758a',
    subtle: '#64758a',
    surface: '#ffffff',
    canvas: '#f1f6fd',
    iconMuted: '#64758a'
  }),
  dark: Object.freeze({
    label: '黑夜模式',
    accent: '#6ba8ff',
    accentStrong: '#9bc4ff',
    ink: '#f5f8fc',
    muted: '#a7b7cb',
    subtle: '#a7b7cb',
    surface: '#152135',
    canvas: '#0d1522',
    iconMuted: '#a7b7cb'
  }),
  daylight: Object.freeze({
    label: '日光赛场',
    accent: '#187a59',
    accentStrong: '#10573f',
    ink: '#213228',
    muted: '#6a756c',
    subtle: '#6a756c',
    surface: '#fffdf8',
    canvas: '#f5f0e7',
    iconMuted: '#6a756c'
  })
});

let currentTheme = null;

function normalizeTheme(value) {
  return THEME_IDS.has(value) ? value : DEFAULT_THEME;
}

function readTheme() {
  if (currentTheme) return currentTheme;
  try {
    currentTheme = normalizeTheme(wx.getStorageSync(STORAGE_KEY));
    return currentTheme;
  } catch (_error) {
    currentTheme = DEFAULT_THEME;
    return currentTheme;
  }
}

function writeTheme(value) {
  const theme = normalizeTheme(value);
  currentTheme = theme;
  try {
    wx.setStorageSync(STORAGE_KEY, theme);
  } catch (_error) {
    // The current page is still updated even if persistent storage is unavailable.
  }
  syncNativeTheme(theme);
  syncOpenPagesTheme(theme);
  return theme;
}

function buildThemeData(value = readTheme()) {
  const uiTheme = normalizeTheme(value);
  const palette = THEME_PALETTE[uiTheme] || THEME_PALETTE[DEFAULT_THEME];
  return {
    uiTheme,
    isDaylight: false,
    isDark: uiTheme === 'dark',
    isWarm: uiTheme === 'daylight',
    themeLabel: palette.label,
    themeAccent: palette.accent,
    themeAccentStrong: palette.accentStrong,
    themeInk: palette.ink,
    themeMuted: palette.muted,
    themeSubtle: palette.subtle,
    themeSurface: palette.surface,
    themeCanvas: palette.canvas,
    themePageStyle: `background:${palette.canvas};color:${palette.ink};`,
    themeBackgroundTextStyle: uiTheme === 'dark' ? 'light' : 'dark',
    themeIconMuted: palette.iconMuted
  };
}

function syncNativeTheme(value = readTheme()) {
  const next = buildThemeData(value);
  try {
    wx.setBackgroundColor?.({
      backgroundColor: next.themeCanvas,
      backgroundColorTop: next.themeCanvas,
      backgroundColorBottom: next.themeCanvas
    });
    wx.setNavigationBarColor?.({
      frontColor: next.isDark ? '#ffffff' : '#000000',
      backgroundColor: next.themeCanvas,
      animation: { duration: 0, timingFunc: 'linear' }
    });
  } catch (_error) {
    // page-meta still paints the complete page when the native API is unavailable.
  }
  return next;
}

function syncPageTheme(page, value) {
  const next = syncNativeTheme(value);
  if (!page || typeof page.setData !== 'function') return next;
  if (page.data?.uiTheme !== next.uiTheme) page.setData(next);
  return next;
}

function syncOpenPagesTheme(value) {
  if (typeof getCurrentPages !== 'function') return;
  let pages = [];
  try {
    pages = getCurrentPages() || [];
  } catch (_error) {
    return;
  }
  pages.forEach(page => syncPageTheme(page, value));
}

module.exports = {
  DEFAULT_THEME,
  STORAGE_KEY,
  THEMES,
  buildThemeData,
  normalizeTheme,
  readTheme,
  syncOpenPagesTheme,
  syncNativeTheme,
  syncPageTheme,
  writeTheme
};
