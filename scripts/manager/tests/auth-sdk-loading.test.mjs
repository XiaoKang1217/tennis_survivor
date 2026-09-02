import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync('index.html', 'utf8');
const localSdk = fs.readFileSync('assets/vendor/supabase-js-2.112.4.min.js', 'utf8');

test('auth loads Supabase SDK from local vendor before CDN fallbacks', () => {
  assert.match(html, /const SUPABASE_JS_URL='assets\/vendor\/supabase-js-2\.112\.4\.min\.js'/);
  assert.match(html, /const SUPABASE_JS_FALLBACK_URLS=\[/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.112\.4\/dist\/umd\/supabase\.min\.js/);
  assert.match(html, /function loadScriptOnce\(src\)/);
  assert.match(html, /SUPABASE_LOADING=null;/);
  assert.match(html, /Supabase SDK 加载失败，请刷新页面或切换网络后重试。/);
  assert.match(localSdk, /var supabase=/);
  assert.match(localSdk, /createClient/);
});
