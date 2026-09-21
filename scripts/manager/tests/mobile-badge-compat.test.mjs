import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const asset=name=>readFileSync(new URL('../../../assets/manager/badges/ui-v20/'+name,import.meta.url),'utf8');

test('primary actions have a solid fallback before feature-gated mixed colors',()=>{
 const css=asset('site-themes.css');
 const fallback=css.indexOf('background:var(--site-chrome-start,#35557d)');
 const guard=css.indexOf('@supports (background:color-mix(in srgb,black,white))');
 assert.ok(fallback>=0&&guard>fallback);
 assert.match(css.slice(fallback,guard),/^background:[^}]+}/);
});

test('native previews have bounded readiness without image decoding gates',()=>{
 const js=asset('native-preview.js');
 assert.ok(!js.includes('styleLoads'));
 assert.ok(!js.includes('.decode()'));
 assert.match(js,/loaded\|\|Date\.now\(\)-started>=3000/);
 assert.match(js,/clearInterval\(stylePoll\)/);
 assert.match(js,/clearInterval\(lateResize\)/);
 assert.match(js,/clearTimeout\(stopLateResize\)/);
});

test('preview tables cannot shrink recursively with their iframe viewport',()=>{
 assert.ok(asset('native-preview.js').includes('.manager-table-scroll,.tbl-wrap{max-height:none!important}'));
});
