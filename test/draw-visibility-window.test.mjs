import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  tournamentOptionsFromCalendarProjection,
  visibilityWindow,
  visibleOnBusinessDate
} = require('../core/draw-week-index');

const available = value => ({ state: 'available', value });

function event({
  id = 'EVENT',
  title = '测试赛事',
  authority = 'ATP',
  levelCode = 'atp_250',
  startDate = '2026-09-10',
  endDate = '2026-09-16',
  drawStatus = 'available',
  tourBucket = authority === 'WTA' ? 'wta' : 'atp'
} = {}) {
  return {
    identity: { tournamentEditionId: id, tourBucket },
    summary: {
      headline: available(title),
      authority: available(authority),
      levelCode: available(levelCode),
      tierDisplayName: available(levelCode),
      surface: available('Hard')
    },
    dates: {
      currentDateRange: { start: available(startDate), end: available(endDate) }
    },
    capabilities: { draws: { status: drawStatus } },
    displayLifecycle: { label: '即将开赛' }
  };
}

function projection(items) {
  return {
    bffContractVersion: 'calendar-projection-bff/1',
    presentation: { items }
  };
}

test('ordinary draw visibility uses inclusive start-3 through end+1 boundaries', () => {
  const item = event();
  assert.deepEqual(visibilityWindow(item), {
    startDate: '2026-09-10',
    endDate: '2026-09-16',
    levelCode: 'tour_250',
    visibleFrom: '2026-09-07',
    visibleThrough: '2026-09-17'
  });
  for (const day of ['2026-09-07', '2026-09-10', '2026-09-13', '2026-09-16', '2026-09-17']) {
    assert.equal(visibleOnBusinessDate(item, day), true, day);
  }
  assert.equal(visibleOnBusinessDate(item, '2026-09-06'), false);
  assert.equal(visibleOnBusinessDate(item, '2026-09-18'), false);
});

test('grand slam uses stable levelCode and inclusive start-7 through end+1 boundaries', () => {
  const slam = event({ title: '测试公开赛', levelCode: 'grand_slam', endDate: '2026-09-23' });
  assert.deepEqual(visibilityWindow(slam), {
    startDate: '2026-09-10',
    endDate: '2026-09-23',
    levelCode: 'grand_slam',
    visibleFrom: '2026-09-03',
    visibleThrough: '2026-09-24'
  });
  assert.equal(visibleOnBusinessDate(slam, '2026-09-02'), false);
  assert.equal(visibleOnBusinessDate(slam, '2026-09-03'), true);
  assert.equal(visibleOnBusinessDate(slam, '2026-09-24'), true);
  assert.equal(visibleOnBusinessDate(slam, '2026-09-25'), false);

  const misleadingName = event({ title: '某大满贯', levelCode: 'atp_250' });
  assert.equal(visibilityWindow(misleadingName).visibleFrom, '2026-09-07');
});

test('date arithmetic handles month, year and leap-day boundaries', () => {
  assert.deepEqual(visibilityWindow(event({
    startDate: '2027-01-02', endDate: '2027-01-09'
  })), {
    startDate: '2027-01-02', endDate: '2027-01-09', levelCode: 'tour_250',
    visibleFrom: '2026-12-30', visibleThrough: '2027-01-10'
  });
  assert.deepEqual(visibilityWindow(event({
    startDate: '2028-03-02', endDate: '2028-03-08', levelCode: 'grand_slam'
  })), {
    startDate: '2028-03-02', endDate: '2028-03-08', levelCode: 'grand_slam',
    visibleFrom: '2028-02-24', visibleThrough: '2028-03-09'
  });
});

test('all concurrent ATP WTA and unpublished tournaments remain in the current window', () => {
  const options = tournamentOptionsFromCalendarProjection(projection([
    event({ id: 'ATP-MAIN' }),
    event({ id: 'WTA-QUAL', authority: 'WTA', tourBucket: 'wta', drawStatus: 'partial' }),
    event({ id: 'NO-DRAW', authority: 'WTA', tourBucket: 'wta', drawStatus: 'unavailable' }),
    event({ id: 'TOO-EARLY', startDate: '2026-09-20', endDate: '2026-09-26' })
  ]), '2026-09-09');

  assert.deepEqual(options.map(item => item.id).sort(), ['ATP-MAIN', 'NO-DRAW', 'WTA-QUAL']);
  assert.equal(options.find(item => item.id === 'WTA-QUAL').drawPublished, true);
  assert.equal(options.find(item => item.id === 'NO-DRAW').drawPublished, false);
});

test('draw page exposes unpublished state and keeps the past-draw history entry', () => {
  const wxml = readFileSync(resolve(import.meta.dirname, '../pages/draws/index.wxml'), 'utf8');
  const page = readFileSync(resolve(import.meta.dirname, '../pages/draws/index.js'), 'utf8');
  assert.match(wxml, /label="签表尚未发布"/u);
  assert.match(page, /openPastDraws\(\) \{ openModule\('\/pages\/calendar\/index\?mode=draws'\); \}/u);
  assert.match(page, /selected\?\.drawPublished === false/u);
});
