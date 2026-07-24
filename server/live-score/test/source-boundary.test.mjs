import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('production live-score code has no competitor runtime dependency', () => {
  const serviceRoot = fileURLToPath(new URL('..', import.meta.url));
  const roots = [
    path.join(serviceRoot, 'src'),
    path.join(serviceRoot, 'scripts'),
    fileURLToPath(new URL('../../../assets/live-score', import.meta.url))
  ];
  const files = roots.flatMap(root => fs.readdirSync(root)
    .filter(name => /\.(?:mjs|js)$/.test(name))
    .map(name => path.join(root, name)));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /live-tennis\.cn/i, path.basename(file));
    assert.doesNotMatch(source, /cResult(?:Tour|Court|Match)/, path.basename(file));
    assert.doesNotMatch(source, /tournamentByExact|tournamentName\(/, path.basename(file));
  }

  const catalog = JSON.parse(fs.readFileSync(path.join(serviceRoot, 'data/translations.json'), 'utf8'));
  assert.deepEqual(Object.keys(catalog).sort(), ['generatedAt', 'players']);
  assert.equal(Object.keys(catalog.players || {}).length > 400, true);
});

test('frontend tournament headers render official level, country and city metadata', () => {
  const script = fs.readFileSync(
    fileURLToPath(new URL('../../../assets/live-score/live-score.js', import.meta.url)),
    'utf8'
  );
  const styles = fs.readFileSync(
    fileURLToPath(new URL('../../../assets/live-score/live-score-enhancements.css', import.meta.url)),
    'utf8'
  );
  assert.match(script, /const facts=\[t\.level,t\.country,t\.city/);
  assert.match(script, /live-tour-fact/);
  assert.match(styles, /\.live-tour-fact\b/);
});
