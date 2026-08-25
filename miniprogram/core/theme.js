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
    accent: '#339cff',
    accentStrong: '#1677d2',
    ink: '#1a1c1f',
    muted: '#526171',
    subtle: '#66788a',
    surface: '#ffffff',
    canvas: '#edf5fc',
    iconMuted: '#66788a'
  }),
  dark: Object.freeze({
    label: '黑夜模式',
    accent: '#60a5fa',
    accentStrong: '#38bdf8',
    ink: '#e5eef8',
    muted: '#cbd5e1',
    subtle: '#94a3b8',
    surface: '#111827',
    canvas: '#07111f',
    iconMuted: '#94a3b8'
  }),
  daylight: Object.freeze({
    label: '日光赛场',
    accent: '#d88b62',
    accentStrong: '#54775e',
    ink: '#233028',
    muted: '#748078',
    subtle: '#8b8b7e',
    surface: '#fffdf7',
    canvas: '#f5f1e6',
    iconMuted: '#8b8b7e'
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

function syncPageTheme(page, value) {
  const next = buildThemeData(value);
  if (!page || typeof page.setData !== 'function') return next;
  if (page.data?.uiTheme !== next.uiTheme) page.setData(next);
  return next;
}

module.exports = {
  DEFAULT_THEME,
  STORAGE_KEY,
  THEMES,
  buildThemeData,
  normalizeTheme,
  readTheme,
  syncPageTheme,
  writeTheme
};
