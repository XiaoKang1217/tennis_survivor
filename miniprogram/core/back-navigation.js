'use strict';

const { readTheme, syncNativeTheme } = require('./theme');

function goBackOrHome(homeUrl = '/pages/scores/index') {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  if (pages.length > 1) {
    wx.navigateBack();
    return;
  }

  // A page opened from a share card is the only page in the stack. There is
  // nothing for navigateBack() to reveal, so rebuild the stack at the app home.
  syncNativeTheme(readTheme());
  wx.reLaunch({ url: homeUrl });
}

module.exports = Object.freeze({ goBackOrHome });
