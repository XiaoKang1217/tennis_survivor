import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLiveTennisDrawId } from '../lib/live-tennis-current-station.mjs';

test('normal and AJAX Beijing draw links resolve to the same numeric event ID', () => {
  for (const id of ['20747', '31020']) {
    for (const path of [`${id}/2026`, `ajax/${id}/2026/device/0/horizontal/true`, `${id}/2026?lang=zh`]) {
      assert.equal(extractLiveTennisDrawId(`https://www.live-tennis.cn/zh/draw/${path}`), id);
    }
  }
  for (const path of ['ajax/2026', '20747/20260', 'list', '']) {
    assert.equal(extractLiveTennisDrawId(`https://www.live-tennis.cn/zh/draw/${path}`), '');
  }
});
