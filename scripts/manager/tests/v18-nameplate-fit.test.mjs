import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../../assets/manager/badges/ui-v18/badge-ui-v18.css', import.meta.url), 'utf8');

test('six v18 card themes fit long CJK names in hall and lineup plaques', () => {
  for (const theme of [
    'federer_eternal',
    'gauff_energy',
    'swiatek_whirlwind',
    'nadal_clay_soul',
    'who_is_leather',
    'rotten_cabbage',
  ]) {
    assert.match(html, new RegExp(`MANAGER_BADGE_HERO_NAME_FIT_THEMES=\\[[^\\]]*'${theme}'`));
    assert.match(css, new RegExp(`data-badge="${theme}"`));
  }
  assert.match(html, /cjkCount>=4\?' is-name-compact'/);
  assert.match(html, /while\(name\.scrollWidth>name\.clientWidth\+1&&size>9\)/);
  assert.match(css, /\.manager-badge-hero-name\.is-name-compact[\s\S]*align-items:center;[\s\S]*justify-content:center;/);
});

test('only the four affected v18 themes fit long names in the top banner', () => {
  assert.match(html, /MANAGER_BADGE_LOGIN_NAME_FIT_THEMES=\['federer_eternal','gauff_energy','swiatek_whirlwind','nadal_clay_soul'\]/);
  assert.match(css, /#hdr\.badge-login-header \.badge-identity--login\.is-name-compact[\s\S]*align-items:center;[\s\S]*justify-content:center;/);
  assert.doesNotMatch(html, /MANAGER_BADGE_LOGIN_NAME_FIT_THEMES=[^\n]*who_is_leather/);
  assert.doesNotMatch(html, /MANAGER_BADGE_LOGIN_NAME_FIT_THEMES=[^\n]*rotten_cabbage/);
});
