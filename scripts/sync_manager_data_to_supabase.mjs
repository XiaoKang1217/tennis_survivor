#!/usr/bin/env node
// Compatibility entrypoint. The production manager sync lives in scripts/manager/.
await import('./manager/sync-station.mjs');
