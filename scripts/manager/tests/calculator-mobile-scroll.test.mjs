import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync('index.html', 'utf8');

test('manager calculator table keeps an iOS-friendly horizontal scroll wrapper', () => {
  assert.match(html, /\.manager-table-scroll\{[^}]*overflow-x:auto/);
  assert.match(html, /\.manager-table-scroll\{[^}]*-webkit-overflow-scrolling:touch/);
  assert.match(html, /\.manager-table-scroll\{[^}]*touch-action:auto/);
  assert.doesNotMatch(html, /\.manager-table-scroll\{[^}]*touch-action:pan-x/);
  assert.match(html, /\.manager-table-scroll \.manager-calc-table\{min-width:680px\}/);
  assert.match(html, /<div class="manager-table-scroll manager-calc-scroll"><table class="manager-calc-table">/);
});
