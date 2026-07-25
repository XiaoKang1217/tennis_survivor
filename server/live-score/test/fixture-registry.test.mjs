import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectSecretMaterial,
  validateManifest,
  validateRegisteredFiles
} from '../scripts/fixture-registry-lib.mjs';

const fixtureRoot = fileURLToPath(new URL('./fixtures', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.schema.json'), 'utf8'));
const serviceRoot = fileURLToPath(new URL('..', import.meta.url));
const captureScript = path.join(serviceRoot, 'scripts/capture-api-tennis-fixture.mjs');
const registerScript = path.join(serviceRoot, 'scripts/register-fixture.mjs');

function capture(args, env = {}) {
  return spawnSync(process.execPath, [captureScript, ...args], {
    cwd: serviceRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      API_TENNIS_KEY: 'phase0-test-secret-that-must-not-leak',
      ...env
    }
  });
}

test('fixture manifest schema declares strict entry shape and status lifecycle', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.$defs.entry.additionalProperties, false);
  assert.deepEqual(schema.$defs.entry.properties.status.enum, [
    'pending_capture',
    'quarantine',
    'verified',
    'rejected'
  ]);
  assert.equal(schema.$defs.entry.allOf.length, 2);
});

test('fixture manifest validates and every captured file matches its hash and type', () => {
  assert.deepEqual(validateManifest(manifest), []);
  assert.deepEqual(validateRegisteredFiles(manifest, fixtureRoot), []);
});

test('Phase 0 fixture registry truthfully blocks on missing real payloads', () => {
  assert.equal(manifest.registryStatus, 'blocked_missing_real_payloads');
  assert.equal(manifest.entries.length >= 15, true);
  assert.equal(manifest.entries.every(entry => entry.status === 'pending_capture'), true);
  assert.equal(manifest.entries.every(entry =>
    entry.realPayload === false
      && entry.file === null
      && entry.sha256 === null
      && typeof entry.blocker === 'string'), true);
  const providers = new Set(manifest.entries.map(entry => entry.provider));
  for (const provider of [
    'api-tennis',
    'atp-official',
    'wta-official',
    'itf-official',
    'goalserve'
  ]) {
    assert.equal(providers.has(provider), true, `${provider} blocker is not registered`);
  }
});

test('manifest validator rejects a pending handcrafted payload mislabeled as real', () => {
  const invalid = structuredClone(manifest);
  invalid.entries[0].realPayload = true;
  invalid.entries[0].file = 'payloads/fake.json';
  invalid.entries[0].sha256 = 'a'.repeat(64);
  invalid.entries[0].bytes = 2;
  invalid.entries[0].contentType = 'application/json';
  invalid.entries[0].capturedAt = '2026-07-25T10:00:00Z';
  invalid.entries[0].endpointLabel = 'fake';
  invalid.entries[0].captureMethod = 'handcrafted';
  assert.equal(validateManifest(invalid).length > 0, true);
});

test('quarantine records an authorized capture without claiming verified real payload', () => {
  const quarantine = structuredClone(manifest);
  quarantine.registryStatus = 'partial';
  const entry = quarantine.entries[0];
  entry.status = 'quarantine';
  entry.realPayload = false;
  entry.file = 'quarantine/api-tennis/example.json';
  entry.sha256 = 'a'.repeat(64);
  entry.bytes = 2;
  entry.contentType = 'application/json';
  entry.capturedAt = '2026-07-25T10:00:00Z';
  entry.endpointLabel = 'get_fixtures';
  entry.captureMethod = 'authorized-manual-capture';
  entry.blocker = 'Independent review remains pending.';
  assert.deepEqual(validateManifest(quarantine), []);
  entry.realPayload = true;
  assert.equal(validateManifest(quarantine).some(error =>
    error.includes('cannot claim independently verified realPayload')), true);
});

test('secret scanner recursively rejects standard, refresh, cookie and AWS credentials', () => {
  const findings = detectSecretMaterial({
    nested: {
      api_key: 'nested-secret',
      headers: {
        authorization: 'Bearer abc.def',
        'x-api-key': 'header-secret',
        'set-cookie': 'session=secret',
        sessionId: 'session-secret',
        refresh_token: 'refresh-secret'
      }
    },
    callbacks: [
      'https://example.invalid/path?access_token=query-secret',
      'https://example.invalid/path?signature=query-signature',
      'https://example.invalid/path?x-api-key=query-api-key',
      'https://example.invalid/path?session_id=query-session-id',
      'https://example.invalid/path?session=query-session',
      'https://example.invalid/path?X-Amz-Signature=aws-signature',
      'https://example.invalid/path?X-Amz-Credential=credential%2Fscope',
      'https://example.invalid/path?X-Amz-Security-Token=session-token'
    ]
  });
  assert.equal(findings.some(finding => finding.includes('$.nested.api_key')), true);
  assert.equal(findings.some(finding => finding.includes('$.nested.headers.authorization')), true);
  assert.equal(findings.some(finding => finding.includes('$.nested.headers.x-api-key')), true);
  assert.equal(findings.some(finding => finding.includes('$.nested.headers.set-cookie')), true);
  assert.equal(findings.some(finding => finding.includes('$.nested.headers.sessionId')), true);
  assert.equal(findings.some(finding => finding.includes('$.nested.headers.refresh_token')), true);
  assert.equal(
    findings.filter(finding => finding.includes('query credential')).length,
    8
  );
});

test('secret scanner rejects AWS credential keys and refresh-token query parameters', () => {
  const findings = detectSecretMaterial({
    'X-Amz-Signature': 'aws-signature',
    'X-Amz-Credential': 'aws-credential',
    'X-Amz-Security-Token': 'aws-session',
    location: 'https://example.invalid/?refresh_token=refresh-secret'
  });
  for (const key of [
    '$.X-Amz-Signature',
    '$.X-Amz-Credential',
    '$.X-Amz-Security-Token'
  ]) {
    assert.equal(findings.some(finding => finding.includes(key)), true);
  }
  assert.equal(findings.some(finding => finding.includes('query credential')), true);
});

test('fixture registrar rejects nested JSON credentials before quarantine write', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-secret-'));
  const source = path.join(directory, 'response.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(source, JSON.stringify({ result: { cookie: 'nested-secret' } }));
  const result = spawnSync(process.execPath, [
    registerScript,
    '--id', 'api-tennis-normal-finish',
    '--source-file', source,
    '--captured-at', '2026-07-25T10:00:00Z',
    '--endpoint-label', 'get_fixtures',
    '--attest-authorized-capture'
  ], {
    cwd: serviceRoot,
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /credential-like material/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /nested-secret/);
});

test('quarantine captures are ignored by git by default', () => {
  const repositoryRoot = path.resolve(serviceRoot, '../..');
  const result = spawnSync('git', [
    'check-ignore',
    '--quiet',
    'server/live-score/test/fixtures/quarantine/api-tennis/captured.json'
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || 'quarantine path is not ignored');
});

test('API Tennis capture refuses a malicious base host without network or key leakage', t => {
  const output = path.join(os.tmpdir(), `live-score-malicious-host-${process.pid}.json`);
  t.after(() => fs.rmSync(output, { force: true }));
  const result = capture([
    '--method', 'get_livescore',
    '--output', output
  ], {
    API_TENNIS_BASE: 'https://attacker.invalid/collect'
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(output), false);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /phase0-test-secret-that-must-not-leak/);
  assert.match(result.stderr, /host must be exactly api\.api-tennis\.com/);
});

test('API Tennis capture refuses an output path inside the repository', t => {
  const output = path.join(fixtureRoot, `forbidden-capture-${process.pid}.json`);
  t.after(() => fs.rmSync(output, { force: true }));
  const result = capture([
    '--method', 'get_livescore',
    '--output', output
  ]);
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(output), false);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /phase0-test-secret-that-must-not-leak/);
  assert.match(result.stderr, /outside the repository/);
});
