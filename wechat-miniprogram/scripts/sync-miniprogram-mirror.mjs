import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
  'packages',
  'pages',
  'services',
  'styles'
]);

mkdirSync(mirrorRoot, { recursive: true });

for (const entry of mirroredEntries) {
  const source = join(root, entry);
  const target = join(mirrorRoot, entry);
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true, dereference: false, force: true });
}
