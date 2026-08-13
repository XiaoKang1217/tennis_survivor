import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_SUPABASE_URL = 'https://avdnhcwmwdwhsecszlcd.supabase.co';

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) {
      args._.push(part);
      continue;
    }
    const eq = part.indexOf('=');
    if (eq >= 0) {
      args[part.slice(2, eq)] = part.slice(eq + 1);
      continue;
    }
    const key = part.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export async function readJson(file, root = process.cwd()) {
  const raw = await readFile(path.resolve(root, file), 'utf8');
  return JSON.parse(raw);
}

export async function writeJson(file, value, root = process.cwd()) {
  const target = path.resolve(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

export function normalizeSurface(surface = '') {
  const value = String(surface).toLowerCase();
  if (value === 'indoor_hard') return 'hard_in';
  if (value === 'outdoor_hard') return 'hard_out';
  if (value === 'hard') return 'hard';
  return value || 'hard';
}

export function normalizeName(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(value = '') {
  return normalizeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function canonicalPlayerKey(tour, player = {}) {
  if (player.is_qualifier_placeholder || /^Qualifier\b/i.test(player.name_en || '')) {
    const explicitKey = String(player.player_key || '');
    if (explicitKey && /^\w+\|qualifier-/i.test(explicitKey)) return explicitKey;
    return `${tour}|qualifier-${player.draw_position || slugify(player.name_en || player.name_zh || 'q')}`;
  }
  const base = player.name_en || player.name_zh || player.player_key || '';
  return `${tour}|${slugify(base) || slugify(player.player_key || '')}`;
}

export function officialProfileUrl(tour, player = {}) {
  if (!player.profile_id || player.is_qualifier_placeholder) return null;
  const slug = slugify(player.name_en || player.name_zh || '');
  if (tour === 'WTA') return `https://www.wtatennis.com/players/${player.profile_id}/${slug}`;
  if (tour === 'ATP') return `https://www.atptour.com/en/players/${slug}/${player.profile_id}/overview`;
  return null;
}

export function scoreTotal(scores = {}) {
  return Number((
    (scores.base ?? 50) * 0.35
    + (scores.surface ?? 50) * 0.25
    + (scores.draw ?? 50) * 0.20
    + (scores.form ?? 50) * 0.15
    + (scores.manual ?? 0) * 0.05
  ).toFixed(2));
}

export function winnerPointsFor(tour = 'WTA', level = '500') {
  const normalized = String(level || '500').toUpperCase();
  if (normalized === 'GS' || normalized.includes('SLAM')) return 2000;
  const points = Number(String(level || '').replace(/[^\d]/g, ''));
  if (Number.isFinite(points) && points > 0) return points;
  return String(tour || '').toUpperCase() === 'ATP' ? 500 : 500;
}

export function priceTier(price = 0, eventOrWinner = 500) {
  const winner = typeof eventOrWinner === 'object'
    ? winnerPointsFor(eventOrWinner.tour, eventOrWinner.level)
    : Number(eventOrWinner || 500);
  const ratio = Number(price || 0) / Math.max(1, winner);
  if (ratio >= 0.62) return 'S';
  if (ratio >= 0.46) return 'A';
  if (ratio >= 0.29) return 'B';
  if (ratio >= 0.16) return 'C';
  return 'D';
}

export function nowIso() {
  return new Date().toISOString();
}
