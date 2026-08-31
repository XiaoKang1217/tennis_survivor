import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('check-in buttons read the reward published in the existing summary', () => {
  for (const path of ['pages/account/index.wxml', 'pages/social-center/index.wxml']) {
    assert.match(source(path), /checkins\.dailyCheckinReward/u);
    assert.doesNotMatch(source(path), /签到领 1 朵花/u);
  }
});

test('check-in success messages use the reward returned by the write API', () => {
  for (const path of ['pages/account/index.js', 'pages/social-center/index.js']) {
    assert.match(source(path), /Number\(value\.reward\)/u);
    assert.doesNotMatch(source(path), /花朵 \+1/u);
  }
});

test('R2 renders the complete seven-day schedule from the server contract', () => {
  for (const path of ['pages/account/index.js', 'pages/social-center/index.js']) {
    assert.match(source(path), /\[5, 5, 5, 5, 10, 15, 20\]/u);
    assert.match(source(path), /cycleRewards/u);
  }
  for (const path of ['pages/account/index.wxml', 'pages/social-center/index.wxml']) {
    assert.match(source(path), /checkins\.cycleRewards/u);
    assert.match(source(path), /item\.claimed \? '🌸' : '·'/u);
    assert.match(source(path), /item\.rewardLabel/u);
  }
  for (const path of ['pages/account/index.wxss', 'pages/social-center/index.wxss']) {
    const css = source(path);
    assert.match(css, /\.\w+-cycle>view\.claimed\{background:var\(--brand-soft\);color:var\(--brand-strong\)\}/u);
    assert.doesNotMatch(css, /\.\w+-cycle>view\.claimed[^}]*background:var\(--brand-strong\)/u);
  }
});

test('R2 exposes monthly perfect-attendance progress and bonus', () => {
  const center = source('pages/social-center/index.wxml');
  assert.match(center, /整月全勤奖励/u);
  assert.match(center, /monthlyProgress\.checkedDays/u);
  assert.match(center, /monthlyProgress\.daysInMonth/u);
  assert.match(center, /monthlyProgress\.bonus/u);
  for (const path of ['pages/account/index.js', 'pages/social-center/index.js']) {
    assert.match(source(path), /整月全勤额外获得50朵花/u);
  }
});

test('R2 success feedback separates daily and monthly grants', () => {
  for (const path of ['pages/account/index.js', 'pages/social-center/index.js']) {
    assert.match(source(path), /value\.dailyReward/u);
    assert.match(source(path), /value\.monthlyBonus/u);
    assert.match(source(path), /全勤/u);
  }
});
