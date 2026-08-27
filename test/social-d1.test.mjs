import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = readFileSync(new URL('../pages/social-center/index.js', import.meta.url), 'utf8');
const mirror = readFileSync(new URL('../miniprogram/pages/social-center/index.js', import.meta.url), 'utf8');

for (const [name, source] of [['root', root], ['mirror', mirror]]) {
  test(`SOCIAL-D1 ${name} check-in calendar sends a stable Shanghai YYYY-MM`, () => {
    assert.match(source, /Date\.now\(\) \+ 8 \* 60 \* 60 \* 1000/u);
    assert.match(source, /getUTCFullYear\(\).*getUTCMonth\(\) \+ 1/u);
    assert.doesNotMatch(source, /DateTimeFormat/u);
  });
}
