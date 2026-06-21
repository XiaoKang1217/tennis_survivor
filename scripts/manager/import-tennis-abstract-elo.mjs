#!/usr/bin/env node
import { SupabaseRestClient } from './lib/supabase-rest.mjs';
import { canonicalPlayerKey, normalizeName, parseArgs, writeJson } from './lib/manager-utils.mjs';

const URLS = {
  ATP: 'https://tennisabstract.com/reports/atp_elo_ratings.html',
  WTA: 'https://tennisabstract.com/reports/wta_elo_ratings.html'
};

function decodeHtml(value = '') {
  return String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function toInt(value) {
  const n = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toNum(value) {
  const n = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseRows(html, tour, sourceUrl, snapshotDate) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1] || '';
  const rows = [];
  for (const row of body.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => decodeHtml(m[1]));
    if (cells.length < 17) continue;
    const name = normalizeName(cells[1]);
    if (!name) continue;
    const playerKey = canonicalPlayerKey(tour, { name_en: name });
    rows.push({
      tour,
      snapshot_date: snapshotDate,
      player_key: playerKey,
      name_en: name,
      overall_rank: toInt(cells[0]),
      overall_elo: toNum(cells[3]),
      hard_rank: toInt(cells[5]),
      hard_elo: toNum(cells[6]),
      clay_rank: toInt(cells[7]),
      clay_elo: toNum(cells[8]),
      grass_rank: toInt(cells[9]),
      grass_elo: toNum(cells[10]),
      source_url: sourceUrl,
      raw: { cells }
    });
  }
  return rows;
}

const args = parseArgs();
const tour = String(args.tour || 'WTA').toUpperCase();
const dryRun = Boolean(args['dry-run']) || !process.env.SUPABASE_SERVICE_ROLE_KEY;
const snapshotDate = args.date || new Date().toISOString().slice(0, 10);
const sourceUrl = args.url || URLS[tour];

if (!sourceUrl || !URLS[tour]) {
  throw new Error('Use --tour ATP or --tour WTA.');
}

const res = await fetch(sourceUrl);
if (!res.ok) throw new Error(`Tennis Abstract fetch failed: ${res.status}`);
const html = await res.text();
const rows = parseRows(html, tour, sourceUrl, snapshotDate);

if (dryRun) {
  const out = `outputs/manager-sync/${tour.toLowerCase()}-elo-${snapshotDate}.json`;
  await writeJson(out, { tour, sourceUrl, snapshotDate, rows });
  console.log(`Dry run only. Parsed ${rows.length} ${tour} Elo rows into ${out}`);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('Set SUPABASE_SERVICE_ROLE_KEY to write Elo snapshots to Supabase.');
  }
  process.exit(0);
}

const client = new SupabaseRestClient();
await client.upsert('tour_manager_elo_snapshots', rows, 'tour,snapshot_date,player_key');
console.log(`Imported ${rows.length} ${tour} Elo rows for ${snapshotDate}`);

