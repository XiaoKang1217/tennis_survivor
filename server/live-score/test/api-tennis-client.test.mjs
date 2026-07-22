import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiTennisClient } from '../src/api-tennis-client.mjs';

test('loads the Beijing schedule date and following date in one fixtures request', async () => {
  const cache = { data: {}, scheduleWrite() {} };
  const client = new ApiTennisClient({ apiKey: 'test', apiBase: 'https://example.test', cache, timeZone: 'Asia/Shanghai' });
  client.request = async (method, params) => ({ method, params });
  const result = await client.fixtures('2026-12-31');
  assert.equal(result.method, 'get_fixtures');
  assert.deepEqual(result.params, {
    date_start: '2026-12-31', date_stop: '2027-01-01', timezone: 'Asia/Shanghai'
  });
});

test('loads prematch odds for the Beijing schedule date and following date', async () => {
  const cache = { data: {}, scheduleWrite() {} };
  const client = new ApiTennisClient({ apiKey: 'test', apiBase: 'https://example.test', cache, timeZone: 'Asia/Shanghai' });
  client.request = async (method, params) => ({ method, params });
  const result = await client.odds('2026-12-31');
  assert.equal(result.method, 'get_odds');
  assert.deepEqual(result.params, { date_start: '2026-12-31', date_stop: '2027-01-01' });
});
