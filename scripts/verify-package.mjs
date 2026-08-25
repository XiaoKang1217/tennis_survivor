import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const project = JSON.parse(readFileSync(join(root, 'project.config.json'), 'utf8'));
const productionRoot = resolve(root, project.miniprogramRoot || '.');
const resourceSizeLimitBytes = 200 * 1024;
const files = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const relativePath = relative(productionRoot, path);
    const firstSegment = relativePath.split('/')[0];
    const ignored = project.packOptions?.ignore || [];
    const ignoredFolder = ignored.some(item =>
      item?.type === 'folder' && item.value === firstSegment);
    if (ignoredFolder || name.startsWith('.')) continue;
    if (statSync(path).isDirectory()) walk(path); else files.push(path);
  }
}
walk(productionRoot);
assert.ok(files.length >= 20, 'native package is unexpectedly incomplete');
for (const path of files) {
  const stats = statSync(path);
  const label = relative(root, path);
  if (/\.(?:png|jpe?g|gif|webp|svg|mp3|m4a|aac|wav)$/i.test(path)) {
    assert.ok(stats.size <= resourceSizeLimitBytes,
      `${label} exceeds the 200K WeChat resource limit`);
  }
  if (/\.(?:png|jpe?g|gif|webp|mp3|m4a|aac|wav)$/i.test(path)) continue;
  const text = readFileSync(path, 'utf8');
  assert.doesNotMatch(text, /AppSecret|OPENID|openid|single_use_code_kept_inside_runtime/,
    `${label} contains identity material`);
  assert.doesNotMatch(text, /console\.(log|info|warn|error)/,
    `${label} logs outside the bounded event sink`);
  assert.doesNotMatch(text, /[\u{1F000}-\u{1FAFF}]/u,
    `${label} contains an emoji glyph instead of UiIcon`);
  assert.doesNotMatch(text, /fixture|mock/i,
    `${label} contains visual or mock data in production code`);
}
assert.equal(project.compileType, 'miniprogram');
assert.equal(project.appid, 'wxd3c0a5f7ff64178d');
assert.equal(project.setting.urlCheck, true);
assert.equal(project.miniprogramRoot, undefined, 'project root must stay the actual upload root');
const config = readFileSync(join(productionRoot, 'config.js'), 'utf8');
assert.match(config, /bffBaseUrl:\s*'https:\/\/api\.tennisapi\.online'/);
assert.match(config, /streamBaseUrl:\s*'https:\/\/stream\.tennisapi\.online'/);
assert.doesNotMatch(config, /calibrationMilliseconds:\s*5_000/);
assert.match(config, /score-bff\/3/);
assert.match(config, /score-realtime\/3/);

for (const file of readdirSync(join(root, 'test')).filter(name => name.endsWith('.test.mjs'))) {
  const source = readFileSync(join(root, 'test', file), 'utf8');
  assert.doesNotMatch(source, /\.\.\/miniprogram/u, `${file} targets the generated mirror`);
}
