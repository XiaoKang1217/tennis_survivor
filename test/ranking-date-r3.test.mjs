import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);

function pageDefinition() {
  const path = require.resolve('../packages/player/pages/players/index');
  delete require.cache[path];
  let definition;
  const prior = globalThis.Page;
  globalThis.Page = value => { definition = value; };
  try { require(path); } finally {
    if (prior === undefined) delete globalThis.Page;
    else globalThis.Page = prior;
  }
  return definition;
}

function context(definition) {
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(update, callback) {
      Object.assign(this.data, update);
      callback?.call(this);
    }
  };
}

test('RANKING-D1 four tabs show their own trusted business date', () => {
  const definition = pageDefinition();
  const page = context(definition);
  for (const authority of ['ATP', 'WTA']) {
    definition.applyRankingValue.call(page, {
      payload: { snapshot: { rankingDate: '2026-08-24', entries: [], hasMore: false } }
    }, {
      append: false, offset: 0, authority, rankingKind: 'official',
      useProfileSearch: false, isRace: false, fromCache: false
    });
    assert.equal(page.data.rankingDateLabel, '官方排名日期：2026年8月24日');
    definition.applyRankingValue.call(page, {
      payload: { ranking: { snapshotDate: '2026-08-25', entries: [] } }
    }, {
      append: false, offset: 0, authority, rankingKind: 'race',
      useProfileSearch: false, isRace: true, fromCache: true
    });
    assert.equal(page.data.rankingDateLabel, 'Race榜数据日期：2026年8月25日');
  }
});

test('RANKING-D1 missing date is explicit and never falls back to execution time', () => {
  const definition = pageDefinition();
  const page = context(definition);
  definition.applyRankingValue.call(page, {
    dataAsOf: '2099-12-31T23:59:59.000Z',
    payload: { snapshot: { entries: [], hasMore: false } }
  }, {
    append: false, offset: 0, authority: 'ATP', rankingKind: 'official',
    useProfileSearch: false, isRace: false, fromCache: false
  });
  assert.equal(page.data.rankingDateLabel, '排名日期暂缺');
});

test('ranking backend isolates all channels and preserves empty backfill', () => {
  const source = readFileSync(new URL(
    '../../inc1-d3-r2-backend/operations/scorecard-player-rankings-refresh.mjs',
    import.meta.url
  ), 'utf8');
  for (const channel of ['ATP_official', 'ATP_race', 'WTA_official', 'WTA_race']) {
    assert.match(source, new RegExp(channel));
  }
  assert.match(source, /ranking_backfill_skipped/u);
  assert.match(source, /RANKING_BACKFILL_ZERO_ROWS/u);
  assert.match(source, /commitChannelSnapshot/u);
  assert.match(source, /BEGIN/u);
  assert.match(source, /RANKING_CHANNEL_ROW_GATE_REJECTED/u);
  assert.match(source, /provider_pages_\$\{pages\}_unique_rows_\$\{rows\.length\}/u);
});
