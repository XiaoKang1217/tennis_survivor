import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ENTRY_KEYS = [
  'id',
  'provider',
  'capability',
  'eventType',
  'scenario',
  'status',
  'realPayload',
  'file',
  'sha256',
  'bytes',
  'contentType',
  'capturedAt',
  'endpointLabel',
  'captureMethod',
  'secretReview',
  'reviewedBy',
  'reviewedAt',
  'reviewNotes',
  'blocker'
];

const PROVIDERS = new Set([
  'api-tennis',
  'atp-official',
  'wta-official',
  'itf-official',
  'goalserve'
]);
const CAPABILITIES = new Set([
  'live-score',
  'schedule',
  'draw',
  'match-stats',
  'player',
  'ranking',
  'historical-match'
]);
const EVENT_TYPES = new Set([
  'fixture',
  'score',
  'stats',
  'draw',
  'ranking',
  'player',
  'error',
  'empty-response',
  'oop-pdf'
]);
const STATUSES = new Set([
  'pending_capture',
  'quarantine',
  'verified',
  'rejected'
]);
const CONTENT_TYPES = new Set(['application/json', 'application/pdf']);

function isIsoDateTime(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

export function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const SECRET_KEYS = new Set([
  'apikey',
  'xapikey',
  'authorization',
  'cookie',
  'setcookie',
  'sessionid',
  'accesstoken',
  'refreshtoken',
  'secret',
  'clientsecret',
  'xamzsignature',
  'xamzcredential',
  'xamzsecuritytoken'
]);

function normalizedSecretKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function detectSecretMaterial(value, location = '$') {
  const findings = [];
  if (typeof value === 'string') {
    if (/\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(value)) {
      findings.push(`${location}: bearer credential`);
    }
    if (/[?&](?:api[_-]?key|x-api-key|apikey|access[_-]?token|refresh[_-]?token|authorization|cookie|set-cookie|session(?:[_-]?id)?|secret|signature|x-amz-signature|x-amz-credential|x-amz-security-token)=[^&#\s]+/i.test(value)) {
      findings.push(`${location}: query credential`);
    }
    return findings;
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => detectSecretMaterial(item, `${location}[${index}]`));
  }
  if (!value || typeof value !== 'object') return findings;
  for (const [key, item] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (SECRET_KEYS.has(normalizedSecretKey(key))) {
      findings.push(`${childLocation}: credential key`);
    }
    findings.push(...detectSecretMaterial(item, childLocation));
  }
  return findings;
}

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be an object'];
  }
  const topKeys = Object.keys(manifest).sort();
  const expectedTopKeys = ['entries', 'registryStatus', 'schemaVersion'];
  if (JSON.stringify(topKeys) !== JSON.stringify(expectedTopKeys)) {
    errors.push(`manifest keys must be exactly ${expectedTopKeys.join(', ')}`);
  }
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (!['blocked_missing_real_payloads', 'partial', 'ready'].includes(manifest.registryStatus)) {
    errors.push('registryStatus is invalid');
  }
  if (!Array.isArray(manifest.entries)) return [...errors, 'entries must be an array'];

  const ids = new Set();
  for (const [index, entry] of manifest.entries.entries()) {
    const label = `entries[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    const unknownKeys = Object.keys(entry).filter(key => !ENTRY_KEYS.includes(key));
    const missingKeys = ENTRY_KEYS.filter(key => !(key in entry));
    if (unknownKeys.length) errors.push(`${label} has unknown keys: ${unknownKeys.join(', ')}`);
    if (missingKeys.length) errors.push(`${label} is missing keys: ${missingKeys.join(', ')}`);
    if (!/^[a-z0-9][a-z0-9-]+$/.test(entry.id || '')) {
      errors.push(`${label}.id is invalid`);
    } else if (ids.has(entry.id)) {
      errors.push(`${label}.id is duplicated`);
    }
    ids.add(entry.id);
    if (!PROVIDERS.has(entry.provider)) errors.push(`${label}.provider is invalid`);
    if (!CAPABILITIES.has(entry.capability)) errors.push(`${label}.capability is invalid`);
    if (!EVENT_TYPES.has(entry.eventType)) errors.push(`${label}.eventType is invalid`);
    if (typeof entry.scenario !== 'string' || entry.scenario.length < 3) {
      errors.push(`${label}.scenario is required`);
    }
    if (!STATUSES.has(entry.status)) errors.push(`${label}.status is invalid`);
    if (typeof entry.realPayload !== 'boolean') errors.push(`${label}.realPayload must be boolean`);
    if (!isNullableString(entry.file)) errors.push(`${label}.file must be string or null`);
    if (entry.sha256 !== null && !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      errors.push(`${label}.sha256 is invalid`);
    }
    if (entry.bytes !== null && (!Number.isInteger(entry.bytes) || entry.bytes < 1)) {
      errors.push(`${label}.bytes is invalid`);
    }
    if (entry.contentType !== null && !CONTENT_TYPES.has(entry.contentType)) {
      errors.push(`${label}.contentType is invalid`);
    }
    for (const key of ['capturedAt', 'endpointLabel', 'captureMethod', 'reviewedBy', 'reviewedAt', 'reviewNotes', 'blocker']) {
      if (!isNullableString(entry[key])) errors.push(`${label}.${key} must be string or null`);
    }
    if (typeof entry.secretReview !== 'boolean') {
      errors.push(`${label}.secretReview must be boolean`);
    }
    if (entry.capturedAt !== null && !isIsoDateTime(entry.capturedAt)) {
      errors.push(`${label}.capturedAt must be ISO date-time`);
    }
    if (entry.reviewedAt !== null && !isIsoDateTime(entry.reviewedAt)) {
      errors.push(`${label}.reviewedAt must be ISO date-time`);
    }

    const payloadFields = ['file', 'sha256', 'bytes', 'contentType', 'capturedAt', 'endpointLabel', 'captureMethod'];
    if (entry.status === 'pending_capture') {
      if (entry.realPayload !== false) errors.push(`${label} pending entry cannot claim realPayload`);
      for (const key of payloadFields) {
        if (entry[key] !== null) errors.push(`${label}.${key} must be null while pending`);
      }
      if (entry.secretReview !== false) errors.push(`${label}.secretReview must be false while pending`);
      if (typeof entry.blocker !== 'string' || entry.blocker.length < 10) {
        errors.push(`${label}.blocker must explain missing real data`);
      }
    }
    if (entry.status === 'quarantine' || entry.status === 'verified') {
      for (const key of payloadFields) {
        if (entry[key] === null) errors.push(`${label}.${key} is required after capture`);
      }
      const expectedPrefix = entry.status === 'verified' ? 'payloads/' : 'quarantine/';
      if (typeof entry.file === 'string' && !entry.file.startsWith(expectedPrefix)) {
        errors.push(`${label}.file must start with ${expectedPrefix}`);
      }
    }
    if (entry.status === 'quarantine' && entry.realPayload !== false) {
      errors.push(`${label} quarantine entry cannot claim independently verified realPayload`);
    }
    if (entry.status === 'verified') {
      if (entry.realPayload !== true) {
        errors.push(`${label}.realPayload becomes true only after independent verification`);
      }
      if (!entry.secretReview) errors.push(`${label}.secretReview is required for verified payload`);
      for (const key of ['reviewedBy', 'reviewedAt', 'reviewNotes']) {
        if (typeof entry[key] !== 'string' || entry[key].length < 3) {
          errors.push(`${label}.${key} is required for verified payload`);
        }
      }
    }
    if (entry.status === 'rejected' && entry.realPayload !== false) {
      errors.push(`${label} rejected entry cannot claim realPayload`);
    }
  }

  const usable = manifest.entries.filter(entry =>
    entry.status === 'quarantine' || entry.status === 'verified');
  const verified = manifest.entries.filter(entry => entry.status === 'verified');
  if (manifest.registryStatus === 'blocked_missing_real_payloads' && usable.length > 0) {
    errors.push('blocked registry cannot contain quarantine or verified payloads');
  }
  if (manifest.registryStatus === 'ready' && verified.length !== manifest.entries.length) {
    errors.push('ready registry requires every entry to be verified');
  }
  return errors;
}

export function validateRegisteredFiles(manifest, fixtureRoot) {
  const errors = [];
  const resolvedRoot = fs.realpathSync(fixtureRoot);
  for (const entry of manifest.entries) {
    if (entry.status !== 'quarantine' && entry.status !== 'verified') continue;
    const candidate = path.resolve(fixtureRoot, entry.file);
    if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
      errors.push(`${entry.id}: file escapes fixture root`);
      continue;
    }
    if (!fs.existsSync(candidate)) {
      errors.push(`${entry.id}: registered file does not exist`);
      continue;
    }
    const bytes = fs.readFileSync(candidate);
    if (bytes.length !== entry.bytes) errors.push(`${entry.id}: byte count mismatch`);
    if (sha256(bytes) !== entry.sha256) errors.push(`${entry.id}: sha256 mismatch`);
    if (entry.contentType === 'application/json') {
      try {
        JSON.parse(bytes.toString('utf8'));
      } catch {
        errors.push(`${entry.id}: JSON payload is invalid`);
      }
    }
    if (entry.contentType === 'application/pdf'
      && bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      errors.push(`${entry.id}: PDF payload has no PDF header`);
    }
  }
  return errors;
}
