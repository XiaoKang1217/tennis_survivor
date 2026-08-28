import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('score entry modules load and format Shanghai time without Intl', () => {
  const savedIntl = globalThis.Intl;
  try {
    globalThis.Intl = undefined;
    const schedulePath = require.resolve('../core/schedule-date');
    const viewModelPath = require.resolve('../core/view-model');
    delete require.cache[schedulePath];
    delete require.cache[viewModelPath];
    const schedule = require('../core/schedule-date');
    assert.equal(schedule.beijingDate(new Date('2026-08-27T16:30:00Z')), '2026-08-28');
    assert.equal(schedule.beijingClock('2026-08-27T16:30:45Z'), '00:30:45');
    assert.equal(schedule.beijingDateTime('2026-08-27T16:30:00Z'), '2026-08-28 00:30');
    assert.doesNotThrow(() => require('../core/view-model'));
  } finally {
    globalThis.Intl = savedIntl;
  }
});
