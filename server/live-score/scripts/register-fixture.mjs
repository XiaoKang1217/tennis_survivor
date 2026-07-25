import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectSecretMaterial,
  sha256,
  validateManifest
} from './fixture-registry-lib.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(scriptDir, '../test/fixtures');
const manifestPath = path.join(fixtureRoot, 'manifest.json');

function fail(message) {
  process.stderr.write(`Fixture registration refused: ${message}\n`);
  process.exit(1);
}

function argumentsByName(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--attest-authorized-capture') {
      result.attestAuthorizedCapture = true;
      continue;
    }
    if (!token.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      fail(`invalid argument near ${token}`);
    }
    result[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

const args = argumentsByName(process.argv.slice(2));
for (const name of ['id', 'source-file', 'captured-at', 'endpoint-label']) {
  if (!args[name]) fail(`--${name} is required`);
}
if (!args.attestAuthorizedCapture) {
  fail('--attest-authorized-capture is required; handcrafted payloads must never be registered');
}
if (!/^[a-z0-9][a-z0-9-]+$/.test(args.id)) fail('--id is invalid');
if (!/^[A-Za-z0-9_. /-]+$/.test(args['endpoint-label'])
  || /:\/\/|[?=&]/.test(args['endpoint-label'])) {
  fail('--endpoint-label must be a non-secret method label, not a URL or query');
}
if (Number.isNaN(Date.parse(args['captured-at']))
  || !/^\d{4}-\d{2}-\d{2}T/.test(args['captured-at'])) {
  fail('--captured-at must be an ISO date-time');
}

const sourcePath = path.resolve(args['source-file']);
if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
  fail('--source-file must be an existing file');
}
const bytes = fs.readFileSync(sourcePath);
if (bytes.length === 0) fail('source payload is empty');

const extension = path.extname(sourcePath).toLowerCase();
let contentType;
if (extension === '.json') {
  contentType = 'application/json';
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('JSON source payload cannot be parsed');
  }
  const secretFindings = detectSecretMaterial(parsed);
  if (secretFindings.length) {
    fail(`credential-like material was detected at ${secretFindings[0]}; sanitize a copy first`);
  }
} else if (extension === '.pdf') {
  contentType = 'application/pdf';
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    fail('PDF source payload has no PDF header');
  }
} else {
  fail('only .json and .pdf fixtures are accepted');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifestErrors = validateManifest(manifest);
if (manifestErrors.length) fail(`manifest is already invalid: ${manifestErrors.join('; ')}`);
const entry = manifest.entries.find(item => item.id === args.id);
if (!entry) fail(`unknown pending fixture id: ${args.id}`);
if (entry.status !== 'pending_capture') {
  fail(`${args.id} is ${entry.status}; registration only accepts pending_capture`);
}

const digest = sha256(bytes);
const providerDir = path.join(fixtureRoot, 'quarantine', entry.provider);
const outputName = `${entry.id}--${digest.slice(0, 12)}${extension}`;
const destination = path.join(providerDir, outputName);
fs.mkdirSync(providerDir, { recursive: true });
fs.writeFileSync(destination, bytes, { flag: 'wx' });

entry.status = 'quarantine';
entry.realPayload = false;
entry.file = path.relative(fixtureRoot, destination).split(path.sep).join('/');
entry.sha256 = digest;
entry.bytes = bytes.length;
entry.contentType = contentType;
entry.capturedAt = new Date(args['captured-at']).toISOString();
entry.endpointLabel = args['endpoint-label'];
entry.captureMethod = 'authorized-manual-capture';
entry.secretReview = false;
entry.blocker = 'Independent secret, rights, schema, and scenario review is pending.';
manifest.registryStatus = 'partial';

const updatedErrors = validateManifest(manifest);
if (updatedErrors.length) {
  fs.unlinkSync(destination);
  fail(`updated manifest would be invalid: ${updatedErrors.join('; ')}`);
}
const temporaryManifest = `${manifestPath}.tmp`;
fs.writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
fs.renameSync(temporaryManifest, manifestPath);
process.stdout.write(`Registered ${entry.id} in quarantine as ${entry.file}\n`);
