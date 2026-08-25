import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mirrorRoot = join(root, 'miniprogram');
const mirroredEntries = Object.freeze([
  'app.js',
  'app.json',
  'app.wxss',
  'config.js',
  'sitemap.json',
  'assets',
  'components',
  'core',
  'pages',
  'services',
  'styles'
]);
const allowedMirrorOnly = new Set([
  'project.config.json',
  'project.private.config.json'
]);

function walkFiles(base, entry) {
  const path = join(base, entry);
  if (!existsSync(path)) return [];
  const stats = statSync(path);
  if (!stats.isDirectory()) return [entry];
  const files = [];
  function walk(directory) {
    for (const name of readdirSync(directory)) {
      if (name.startsWith('.')) continue;
      const child = join(directory, name);
      if (statSync(child).isDirectory()) walk(child);
      else files.push(relative(base, child));
    }
  }
  walk(path);
  return files.sort();
}

assert.ok(existsSync(mirrorRoot), 'miniprogram mirror folder is missing');

for (const name of readdirSync(mirrorRoot)) {
  if (name.startsWith('.')) continue;
  assert.ok(
    mirroredEntries.includes(name) || allowedMirrorOnly.has(name),
    `miniprogram mirror contains an unmanaged top-level entry: ${name}`
  );
}

const sourceFiles = mirroredEntries.flatMap(entry => walkFiles(root, entry)).sort();
const mirrorFiles = mirroredEntries.flatMap(entry => walkFiles(mirrorRoot, entry)).sort();
assert.deepEqual(mirrorFiles, sourceFiles, 'miniprogram mirror file list diverges from upload root');

for (const file of sourceFiles) {
  const source = readFileSync(join(root, file));
  const mirror = readFileSync(join(mirrorRoot, file));
  assert.deepEqual(mirror, source, `miniprogram mirror differs from upload root: ${file}`);
}
