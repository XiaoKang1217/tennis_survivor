#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/manager-utils.mjs';

const args = parseArgs();
const dryRun = Boolean(args['dry-run']) || !process.env.SUPABASE_SERVICE_ROLE_KEY;
const activeFile = args.active || 'data/manager/active_events.json';
const photoFile = args.photos || 'data/manager/player_photos.json';
const snapshotDate = args.date || new Date().toISOString().slice(0, 10);
const priceVersion = args['price-version'] || 1;
const priceStatus = args['price-status'] || 'draft';
const skipElo = Boolean(args['skip-elo']);
const skipPhotos = Boolean(args['skip-photos']);

const here = path.dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

function script(name) {
  return path.join(here, name);
}

function run(label, argv) {
  return new Promise((resolve, reject) => {
    console.log(`\n== ${label} ==`);
    const child = spawn(node, argv, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

const common = ['--active', activeFile, '--photos', photoFile, '--price-version', String(priceVersion), '--price-status', String(priceStatus)];
if (dryRun) common.push('--dry-run');

await run('validate current station', [
  script('validate-station.mjs'),
  '--active', activeFile,
  '--photos', photoFile,
  '--price-version', String(priceVersion),
  '--price-status', String(priceStatus),
  '--output', `outputs/manager-sync/current-station-validation-${snapshotDate}.json`
]);

await run('sync station payload', [
  script('sync-station.mjs'),
  ...common
]);

if (!skipElo) {
  await run('import ATP Tennis Abstract Elo', [
    script('import-tennis-abstract-elo.mjs'),
    '--tour', 'ATP',
    '--date', snapshotDate,
    ...(dryRun ? ['--dry-run'] : [])
  ]);
  await run('import WTA Tennis Abstract Elo', [
    script('import-tennis-abstract-elo.mjs'),
    '--tour', 'WTA',
    '--date', snapshotDate,
    ...(dryRun ? ['--dry-run'] : [])
  ]);
}

if (!skipPhotos) {
  await run('sync reviewed player photo metadata', [
    script('sync-player-photos.mjs'),
    '--active', activeFile,
    '--photos', photoFile,
    ...(dryRun ? ['--dry-run'] : [])
  ]);
}

console.log(`\nDone. ${dryRun ? 'Dry-run files are in outputs/manager-sync. Set SUPABASE_SERVICE_ROLE_KEY to write to Supabase.' : 'Rows were written to Supabase.'}`);
