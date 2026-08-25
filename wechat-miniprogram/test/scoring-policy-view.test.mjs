import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const miniRoot = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(miniRoot, path), 'utf8');
const { pointByPointView } = require('../core/point-by-point-view-model');
const { scoreRulesView } = require('../core/view-model');

test('score rules view exposes set format, final tiebreak and no-ad labels', () => {
  assert.equal(scoreRulesView({
    bestOfSets: 5,
    setsToWin: 3,
    regularTiebreakTargetPoints: 7,
    finalSetTiebreakTargetPoints: 10,
    decidingSetIsMatchTiebreak: false,
    matchTiebreakTargetPoints: 10,
    gameRule: 'advantage'
  }).summary, '五盘三胜 · 决胜盘抢10');

  assert.equal(scoreRulesView({
    bestOfSets: 3,
    setsToWin: 2,
    regularTiebreakTargetPoints: 7,
    finalSetTiebreakTargetPoints: 7,
    decidingSetIsMatchTiebreak: true,
    matchTiebreakTargetPoints: 10,
    gameRule: 'no_ad'
	  }).summary, '三盘两胜 · 决胜盘抢10 · 无占先');
	});

test('score rules view does not invent a scoring summary from unknown fields', () => {
  assert.equal(scoreRulesView({}).summary, '');
  assert.equal(scoreRulesView({
    setsToWin: 2,
    decidingSetIsMatchTiebreak: true
  }).summary, '');
  assert.equal(scoreRulesView({
    bestOfSets: 3,
    setsToWin: 2,
    finalSetTiebreakTargetPoints: 7
  }).summary, '三盘两胜');
});

test('point-by-point tiebreak tag follows match scoring rules', () => {
  const view = pointByPointView({
    delivery: { state: 'live', message: '' },
    pointByPoint: {
      pointByPointVersion: 1,
      dataAsOf: '2026-08-19T00:00:00.000Z',
      sets: [{
        setNumber: 3,
        games: [{
          gameNumber: 1,
          finalScore: '10-8',
          serverSideOrdinal: 1,
          tiebreak: true,
          points: []
        }]
      }]
    }
  }, ['一号组合', '二号组合'], {
    bestOfSets: 3,
    decidingSetIsMatchTiebreak: true,
    matchTiebreakTargetPoints: 10,
    regularTiebreakTargetPoints: 7
  });
	  assert.equal(view.sets[0].games[0].tiebreakLabel, '抢10');
	});

test('point-by-point tiebreak tag stays empty when target points are unknown', () => {
  const view = pointByPointView({
    delivery: { state: 'live', message: '' },
    pointByPoint: {
      pointByPointVersion: 1,
      dataAsOf: '2026-08-19T00:00:00.000Z',
      sets: [{
        setNumber: 1,
        games: [{
          gameNumber: 1,
          finalScore: '7-6',
          serverSideOrdinal: 1,
          tiebreak: true,
          points: []
        }]
      }]
    }
  }, ['一号', '二号'], {});

  assert.equal(view.sets[0].games[0].tiebreakLabel, '');
});

test('detail renders scoring policy while score cards keep schedule metadata only', () => {
	  const detail = read('pages/match-detail/index.wxml');
	  const card = read('components/match-card/index.wxml');
	  assert.match(detail, /match\.scoringSummary/u);
	  assert.doesNotMatch(card, /match\.scoringSummary/u);
	  assert.match(detail, /\{\{game\.tiebreakLabel\}\}/u);
	  assert.doesNotMatch(detail, />抢七<\/text>/u);
  assert.match(detail, /cell\.kindLabel/u);
  assert.match(card, /decidingPointLabel/u);
});
