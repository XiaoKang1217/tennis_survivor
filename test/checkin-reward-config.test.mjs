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
