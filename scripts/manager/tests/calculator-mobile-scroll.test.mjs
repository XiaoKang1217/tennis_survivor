import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync('index.html', 'utf8');

test('manager calculator table keeps an iOS-friendly horizontal scroll wrapper', () => {
  assert.match(html, /\.manager-table-scroll\{[^}]*overflow-x:auto/);
  assert.match(html, /\.manager-table-scroll\{[^}]*-webkit-overflow-scrolling:touch/);
  assert.match(html, /\.manager-table-scroll\{[^}]*touch-action:auto/);
  assert.match(html, /\.manager-table-scroll \.manager-calc-table\{min-width:680px\}/);
  assert.match(html, /<div class="manager-table-scroll manager-calc-scroll"><table class="manager-calc-table">/);
});

test('manager boards stay viewport-wide and scroll in both directions on mobile', () => {
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?body\.manager-mode\{overflow-x:hidden\}/);
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?\.manager-grid\.view-boards,[^{]+\{min-width:0;max-width:100%\}/);
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?\.manager-boards-page \.manager-table-scroll\{[^}]*width:100%/);
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?\.manager-boards-page \.manager-table-scroll\{[^}]*max-width:100%/);
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?\.manager-boards-page \.manager-table-scroll\{[^}]*max-height:68dvh/);
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?\.manager-boards-page \.manager-table-scroll\{[^}]*overflow:auto/);
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?\.manager-boards-page \.manager-table-scroll\{[^}]*-webkit-overflow-scrolling:touch/);
  assert.match(html, /@media\(max-width:768px\)\{[\s\S]*?\.manager-boards-page \.manager-table-scroll\{[^}]*touch-action:pan-x pan-y/);
  assert.doesNotMatch(html, /\.manager-boards-page \.manager-table-scroll\{[^}]*width:max-content/);
  assert.doesNotMatch(html, /\.manager-boards-page \.manager-table-scroll\{[^}]*overflow:visible/);
});
