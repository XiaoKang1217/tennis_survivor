import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceRoot = fileURLToPath(new URL('..', import.meta.url));
const registry = JSON.parse(fs.readFileSync(
  path.join(serviceRoot, 'test/fixtures/legacy-case-migration.json'),
  'utf8'
));

test('all nine new hotfix scenarios remain individually tracked without merging production code', () => {
  assert.equal(registry.sourceCommit, '7c8fe48');
  assert.equal(registry.baselineCommit, '142c687');
  assert.equal(registry.newCases.length, 9);
  assert.equal(new Set(registry.newCases.map(item => item.id)).size, 9);
  for (const item of registry.newCases) {
    assert.match(item.sourceFile, /^server\/live-score\/test\/.+\.test\.mjs$/);
    assert.equal(typeof item.sourceTest, 'string');
    assert.equal(item.sourceTest.length > 10, true);
    assert.match(item.targetPhase, /^phase-/);
    assert.equal(item.status, 'pending_migration');
    assert.equal(item.requiredOutcome.length > 20, true);
  }
});

test('the hotfix pipeline invalidation change is tracked as a strengthened existing case', () => {
  assert.equal(registry.strengthenedExistingCases.length, 1);
  const [item] = registry.strengthenedExistingCases;
  assert.equal(item.baselineTest, 'invalidates snapshots created by the old competitor-driven pipeline');
  assert.equal(item.sourceTest, 'invalidates snapshots and parsed OOP rows from an incompatible pipeline');
  assert.equal(item.status, 'pending_migration');
});
