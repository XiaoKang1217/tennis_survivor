#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parseArgs, readJson, writeJson } from './lib/manager-utils.mjs';
import {
  SNAPSHOT_TABLE,
  archiveDocument,
  buildPublicationRow,
  canonicalJson,
  fileDigest,
  publicationReadiness,
  sha256
} from './lib/station-publication-snapshot.mjs';
import { SupabaseRestClient } from './lib/supabase-rest.mjs';

const args = parseArgs();
const root = process.cwd();
const activeFile = args.active || 'data/manager/active_events.json';
const manifestSource = args.manifest ? await readSourceJson(args.manifest, null) : null;
const manifest = manifestSource?.value || {};
const photoFile = args.photos || manifest.photo_file || 'data/manager/player_photos.json';
const gitRef = args['git-ref'] || manifest.git_ref || null;
const publicationVersion = positiveInt(args.version || manifest.publication_version || 1, 'publication version');
const publicationKind = args.kind || manifest.publication_kind || (gitRef ? 'manual_backfill' : 'initial_open');
const sourceRef = gitRef || args['source-ref'] || process.env.GITHUB_SHA || 'working-tree';
const writeFile = Boolean(args['write-file']);
const strictReady = Boolean(args['strict-ready']);
const strictOpen = Boolean(args['strict-open']);
const allowBackfill = Boolean(args['allow-backfill']) || Boolean(gitRef) || publicationKind === 'manual_backfill';
const serviceEnabled = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) && !args['dry-run'];

const activeSource = await readSourceJson(activeFile, gitRef);
const photoSource = await readSourceJson(photoFile, gitRef);
const active = mergeActive(activeSource.value, manifest);
const outputFile = args.output
  || manifest.output
  || `data/manager/publications/${active.station_key}-v${publicationVersion}.json`;
const eventItems = manifest.events || active.events || [];
const eventSources = [];
for (const item of eventItems.filter((entry) => entry.active !== false || allowBackfill)) {
  const eventPath = item.path || `data/manager/${item.data_file}`;
  const source = await readSourceJson(eventPath, gitRef);
  eventSources.push({ item, event: source.value, path: eventPath, raw: source.raw });
}

const readiness = publicationReadiness({ active, events: eventSources, allowBackfill });
if (!readiness.ready) {
  const message = `Station publication skipped for ${active.station_key}: ${readiness.reasons.join(', ')}`;
  const openConfigurationErrors = readiness.reasons.filter((reason) => (
    reason !== 'station_not_open' && reason !== 'submission_not_open_yet'
  ));
  if (strictReady || (strictOpen && active.status === 'open' && openConfigurationErrors.length)) {
    throw new Error(message);
  }
  console.log(message);
  await writeReport({ status: 'skipped', station_key: active.station_key, readiness });
  process.exit(0);
}

let archive = await readArchive(outputFile);
let client = null;
let tableAvailable = false;
let databaseRow = null;
if (serviceEnabled) {
  client = new SupabaseRestClient({ dryRun: false });
  try {
    const rows = await selectSnapshot(client, active.station_key, Number(active.season), publicationVersion);
    tableAvailable = true;
    databaseRow = rows[0] || null;
  } catch (error) {
    if (!missingSnapshotTable(error)) throw error;
    console.warn(`Snapshot table is not available yet; run migration 202607130001. ${error.message}`);
  }
}

if (archive) {
  archive = hydrateArchive(archive);
  assertArchiveIdentity(archive, active.station_key, Number(active.season), publicationVersion);
  if (databaseRow) {
    assertSameHash(archive, databaseRow, 'Git archive', 'Supabase snapshot');
    console.log(`Station publication already archived: ${active.station_key} v${publicationVersion} ${archive.data_hash}`);
    await writeReport({ status: 'already_published', archive: archiveDocument(archive), database_id: databaseRow.id });
    process.exit(0);
  }
} else {
  const sourceFiles = [
    ...(manifestSource ? [sourceFileRecord(args.manifest, manifestSource.raw)] : []),
    sourceFileRecord(activeFile, activeSource.raw),
    sourceFileRecord(photoFile, photoSource.raw),
    ...eventSources.map((entry) => sourceFileRecord(entry.path, entry.raw))
  ];
  const priceVersion = serviceEnabled && tableAvailable
    ? await latestPriceVersion(client, active.station_key, Number(active.season))
    : null;
  archive = buildPublicationRow({
    active,
    events: eventSources,
    publicationVersion,
    publicationKind,
    publishedAt: args['published-at'] || manifest.published_at,
    sourceRef,
    sourceFiles,
    priceVersion: priceVersion || manifest.price_version || null,
    activeFile,
    photoData: photoSource.value,
    photoFile
  });

  if (writeFile) {
    await writeJson(outputFile, archiveDocument(archive), root);
    console.log(`Wrote immutable Git archive ${outputFile}`);
  }
}

if (databaseRow) {
  assertSameHash(archive, databaseRow, 'generated archive', 'Supabase snapshot');
  console.log(`Station publication already exists in Supabase: ${active.station_key} v${publicationVersion}`);
} else if (serviceEnabled && tableAvailable) {
  const inserted = await insertSnapshot(client, archive);
  console.log(
    inserted.alreadyPublished
      ? `Station publication was inserted concurrently and verified: ${active.station_key} v${publicationVersion}`
      : `Inserted Supabase station publication ${inserted.row?.id || ''}`.trim()
  );
} else {
  console.log(`Dry run: ${active.station_key} v${publicationVersion} ${archive.data_hash}`);
}

await writeReport({
  status: serviceEnabled && tableAvailable ? 'published' : 'dry_run',
  archive: archiveDocument(archive),
  output_file: writeFile ? outputFile : null
});

function mergeActive(source, publicationManifest) {
  const merged = JSON.parse(JSON.stringify(source));
  for (const key of ['station_key', 'station_name', 'season', 'status', 'survivor_aligned', 'updated_at']) {
    if (publicationManifest[key] !== undefined) merged[key] = publicationManifest[key];
  }
  if (publicationManifest.rules) merged.rules = publicationManifest.rules;
  if (publicationManifest.notes) merged.notes = publicationManifest.notes;
  if (publicationManifest.events) merged.events = publicationManifest.events;
  return merged;
}

async function readSourceJson(file, ref) {
  const raw = ref
    ? execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : await readFile(path.resolve(root, file), 'utf8');
  return { raw, value: JSON.parse(raw) };
}

async function readArchive(file) {
  try {
    return await readJson(file, root);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function hydrateArchive(document) {
  const canonicalPayload = canonicalJson(document.snapshot);
  const dataHash = sha256(canonicalPayload);
  if (document.hash_algorithm !== 'sha256' || document.data_hash !== dataHash) {
    throw new Error(`Archive hash verification failed for ${document.station_key} v${document.publication_version}.`);
  }
  return { ...document, canonical_payload: canonicalPayload };
}

function databaseInsertRow(row) {
  return {
    station_key: row.station_key,
    season: row.season,
    publication_version: row.publication_version,
    publication_kind: row.publication_kind,
    snapshot_schema_version: row.snapshot_schema_version,
    published_at: row.published_at,
    event_keys: row.event_keys,
    station_grant: row.station_grant,
    combo_version: row.combo_version,
    price_version_id: row.price_version_id,
    price_version: row.price_version,
    hash_algorithm: row.hash_algorithm,
    data_hash: row.data_hash,
    canonical_payload: row.canonical_payload || canonicalJson(row.snapshot),
    snapshot: row.snapshot,
    source: row.source
  };
}

async function selectSnapshot(client, stationKey, season, version) {
  return client.select(SNAPSHOT_TABLE, {
    select: 'id,station_key,season,publication_version,data_hash',
    station_key: `eq.${stationKey}`,
    season: `eq.${season}`,
    publication_version: `eq.${version}`,
    limit: 1
  });
}

async function latestPriceVersion(client, stationKey, season) {
  const rows = await client.select('tour_manager_price_versions', {
    select: 'id,station_key,season,version,status,formula_version,weights,generated_from,created_at,published_at,locked_at',
    station_key: `eq.${stationKey}`,
    season: `eq.${season}`,
    order: 'version.desc',
    limit: 1
  });
  return rows[0] || null;
}

async function insertSnapshot(client, snapshot) {
  try {
    const rows = await client.insert(SNAPSHOT_TABLE, [databaseInsertRow(snapshot)]);
    return { row: rows[0] || null, alreadyPublished: false };
  } catch (error) {
    if (!/409|23505|duplicate key/i.test(String(error?.message || error))) throw error;
    const rows = await selectSnapshot(
      client,
      snapshot.station_key,
      snapshot.season,
      snapshot.publication_version
    );
    const existing = rows[0];
    if (!existing) throw error;
    assertSameHash(snapshot, existing, 'generated archive', 'concurrent Supabase snapshot');
    return { row: existing, alreadyPublished: true };
  }
}

function assertArchiveIdentity(row, stationKey, season, version) {
  if (row.station_key !== stationKey || Number(row.season) !== season || Number(row.publication_version) !== version) {
    throw new Error(`Archive identity does not match ${stationKey} season ${season} v${version}.`);
  }
}

function assertSameHash(left, right, leftLabel, rightLabel) {
  if (left.data_hash !== right.data_hash) {
    throw new Error(
      `${leftLabel} hash ${left.data_hash} conflicts with ${rightLabel} hash ${right.data_hash}. `
      + 'Published snapshots are immutable; increment --version for an amendment.'
    );
  }
}

function sourceFileRecord(file, raw) {
  return { path: file, sha256: fileDigest(raw) };
}

function missingSnapshotTable(error) {
  return /PGRST205|42P01|station_publication_snapshots.*not find|does not exist/i.test(String(error?.message || error));
}

function positiveInt(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

async function writeReport(value) {
  const station = value.station_key || value.archive?.station_key || active.station_key || 'unknown';
  await writeJson(`outputs/manager-sync/${station}-publication-v${publicationVersion}.json`, value, root);
}
