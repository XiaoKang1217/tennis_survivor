#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/manager-utils.mjs';

const args = parseArgs();
const here = path.dirname(fileURLToPath(import.meta.url));
const publisher = path.join(here, 'publish-station-snapshot.mjs');
const manifests = args._.length ? args._ : [
  'data/manager/publication-manifests/2026-w25-eastbourne-bad-homburg.json',
  'data/manager/publication-manifests/2026-w25-eastbourne-bad-homburg-v2-window.json',
  'data/manager/publication-manifests/2026-w27-wimbledon.json',
  'data/manager/publication-manifests/2026-w29-bastad-athens.json',
  'data/manager/publication-manifests/2026-w29-bastad-athens-v2-window.json'
];

for (const manifest of manifests) {
  await run([
    publisher,
    '--manifest', manifest,
    '--write-file',
    ...(args['require-table'] ? ['--require-table'] : []),
    ...(args['dry-run'] ? ['--dry-run'] : [])
  ]);
}

function run(argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Snapshot publisher exited with code ${code}.`));
    });
  });
}
