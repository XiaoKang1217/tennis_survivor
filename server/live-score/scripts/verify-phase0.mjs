import { spawnSync } from 'node:child_process';

const behaviorFiles = [
  'test/api-tennis-client.test.mjs',
  'test/localizer.test.mjs',
  'test/normalizer.test.mjs',
  'test/official-validator.test.mjs',
  'test/poller.test.mjs',
  'test/schedule-date.test.mjs',
  'test/source-boundary.test.mjs'
];
const phase0Files = [
  'test/phase0-baseline.test.mjs',
  'test/architecture-boundaries.test.mjs',
  'test/fixture-registry.test.mjs',
  'test/legacy-case-registry.test.mjs'
];

function runCommand(label, command, args) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error || result.status !== 0) {
    process.stderr.write(`${label} failed\n`);
    process.exit(result.status || 1);
  }
}

function run(label, files, expectedTests) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(process.execPath, ['--test', ...files], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) {
    process.stderr.write(`${label} failed to start: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
  const summary = `${result.stdout || ''}\n${result.stderr || ''}`;
  const metric = name => Number(summary.match(new RegExp(`[ℹ#]\\s*${name}\\s+(\\d+)`))?.[1]);
  const count = metric('tests');
  const passes = metric('pass');
  const failures = metric('fail');
  const cancelled = metric('cancelled');
  const skipped = metric('skipped');
  const todo = metric('todo');
  if (count !== expectedTests
    || passes !== expectedTests
    || failures !== 0
    || cancelled !== 0
    || skipped !== 0
    || todo !== 0) {
    process.stderr.write(
      `${label} baseline mismatch: expected ${expectedTests}/${expectedTests} pass with fail/cancelled/skipped/todo all 0; `
      + `got tests=${count}, pass=${passes}, fail=${failures}, cancelled=${cancelled}, skipped=${skipped}, todo=${todo}\n`
    );
    process.exit(1);
  }
}

runCommand('V2 strict TypeScript contracts', 'npm', ['run', 'typecheck:v2']);
run('Existing behavior baseline', behaviorFiles, 61);
run('Phase 0 executable gates', phase0Files, 40);
process.stdout.write('\nPhase 0 code gates passed. Gate C and overall Phase 0 remain blocked on real fixtures as declared in the manifest.\n');
