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

test('manager boards page delegates mobile scrolling to the page instead of an inner table scroller', () => {
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?\.manager-grid\.view-boards,\s*\.manager-grid\.view-boards>\.manager-panel,\s*\.manager-grid\.view-boards \.manager-panel-b,\s*\.manager-boards-page,\s*\.manager-boards-page \.manager-rules\{overflow:visible\}/);
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?\.manager-boards-page \.manager-rules details\{overflow:visible\}/);
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?\.manager-boards-page \.manager-table-scroll\{[^}]*width:max-content/);
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?\.manager-boards-page \.manager-table-scroll\{[^}]*overflow:visible/);
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?\.manager-boards-page \.manager-table-scroll\{[^}]*-webkit-overflow-scrolling:auto/);
});
