import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceRoot = fileURLToPath(new URL('..', import.meta.url));
const repositoryRoot = path.resolve(serviceRoot, '../..');
const baseline = JSON.parse(fs.readFileSync(
  path.join(serviceRoot, 'test/architecture/production-baseline.json'),
  'utf8'
));
const IMMUTABLE_BASE_COMMIT = '142c687';

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  if (fs.statSync(root).isFile()) return [root];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

function repoRelative(file) {
  return path.relative(repositoryRoot, file).split(path.sep).join('/');
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

test('Phase 0 baseline records main commit, runtime and 61-test behavior suite', () => {
  assert.equal(baseline.baselineCommit, IMMUTABLE_BASE_COMMIT);
  assert.equal(baseline.baselineBranch, 'origin/main');
  assert.equal(baseline.nodeObserved, 'v24.14.0');
  assert.equal(baseline.nodeSupported, '>=18');
  assert.equal(baseline.baselineTestCount, 61);
});

test('protected production paths have no git diff from the immutable base commit', () => {
  const protectedPaths = [
    'index.html',
    'assets/live-score',
    'server/live-score/deploy',
    'server/live-score/src'
  ];
  const result = spawnSync('git', [
    'diff',
    '--name-only',
    IMMUTABLE_BASE_COMMIT,
    '--',
    ...protectedPaths
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || 'git diff gate failed');
  assert.equal(result.stdout.trim(), '', `protected paths changed:\n${result.stdout}`);
});

test('Phase 0 production source, deploy, root app and frontend surfaces are byte-for-byte frozen', () => {
  const actualPaths = baseline.protectedRoots
    .flatMap(root => filesUnder(path.join(repositoryRoot, root)))
    .map(repoRelative)
    .sort();
  const expectedPaths = baseline.productionFiles.map(entry => entry.path).sort();
  assert.deepEqual(actualPaths, expectedPaths, 'protected production file set changed');

  for (const expected of baseline.productionFiles) {
    const bytes = fs.readFileSync(path.join(repositoryRoot, expected.path));
    assert.equal(bytes.length, expected.bytes, `${expected.path} byte count changed`);
    assert.equal(digest(bytes), expected.sha256, `${expected.path} content changed`);
    if (expected.legacy) {
      const lines = bytes.toString('utf8').match(/\n/g)?.length || 0;
      assert.equal(lines, expected.lines, `${expected.path} line count changed`);
    }
  }
});

test('Phase 0 keeps the production start command and runtime declaration unchanged', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(serviceRoot, 'package.json'), 'utf8'));
  const baseResult = spawnSync('git', [
    'show',
    `${IMMUTABLE_BASE_COMMIT}:server/live-score/package.json`
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  assert.equal(baseResult.status, 0, baseResult.stderr || 'cannot read immutable package baseline');
  const immutablePackageJson = JSON.parse(baseResult.stdout);
  assert.equal(packageJson.scripts.start, immutablePackageJson.scripts.start);
  assert.deepEqual(packageJson.engines || {}, immutablePackageJson.engines || {});
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.deepEqual(
      packageJson[key] || {},
      immutablePackageJson[key] || {},
      `production package ${key} changed`
    );
  }
  const lockfileNames = new Set([
    'package-lock.json',
    'npm-shrinkwrap.json',
    'pnpm-lock.yaml',
    'yarn.lock'
  ]);
  const actualLockfiles = fs.readdirSync(serviceRoot)
    .filter(name => lockfileNames.has(name))
    .sort();
  assert.deepEqual(
    actualLockfiles,
    baseline.productionPackageSurface.lockfiles,
    'production package lockfile surface changed'
  );
});

test('Phase 0 architecture contract and scoped agent instructions are present', () => {
  const required = [
    'AGENTS.md',
    'server/live-score/AGENTS.md',
    'docs/architecture/ARCHITECTURE.md',
    'docs/architecture/DOMAIN_MODEL.md',
    'docs/architecture/MATCH_STATE_MACHINE.md',
    'docs/architecture/SOURCE_POLICY.md',
    'docs/architecture/SLO_AND_RELEASE_GATES.md',
    'docs/architecture/PHASE0_BASELINE.md',
    'docs/architecture/adr/0001-modular-monolith-event-ledger.md',
    'server/live-score/v2/package.json',
    'server/live-score/v2/package-lock.json',
    'server/live-score/v2/tsconfig.json',
    'server/live-score/v2/src/contracts/capabilities.ts',
    'server/live-score/v2/src/contracts/source-event.ts',
    'server/live-score/v2/src/domain/canonical.ts',
    'server/live-score/v2/src/domain/state-machine.ts',
    'server/live-score/v2/src/projections/read-models.ts'
  ];
  for (const relative of required) {
    const file = path.join(repositoryRoot, relative);
    assert.equal(fs.existsSync(file), true, `${relative} is missing`);
    assert.equal(fs.readFileSync(file, 'utf8').trim().length > 100, true, `${relative} is empty`);
  }
});
