#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { SupabaseRestClient } from './lib/supabase-rest.mjs';
import { buildStationPayload, loadActiveStation } from './lib/station-payload.mjs';
import {
  canonicalPlayerKey,
  normalizeName,
  parseArgs,
  priceTier,
  readJson,
  scoreTotal,
  slugify,
  writeJson
} from './lib/manager-utils.mjs';

const RANKING_URLS = {
  ATP: 'https://www.live-tennis.cn/zh/rank/atp/s/year',
  WTA: 'https://www.live-tennis.cn/zh/rank/wta/s/year'
};

const ELO_URLS = {
  ATP: 'https://tennisabstract.com/reports/atp_elo_ratings.html',
  WTA: 'https://tennisabstract.com/reports/wta_elo_ratings.html'
};

const LIVE_TENNIS_RANK_COLUMNS = [
  'c_rank',
  'point',
  'full_name',
  'eng_name',
  'change',
  'f_rank',
  'highest',
  'alt_point',
  'flop',
  'w_point',
  'engname',
  'name_for_search',
  'age',
  'birth',
  'nation',
  'noc_rank',
  'id',
  'ioc',
  'titles',
  'tour_c',
  'mand_0',
  'streak',
  'prize',
  'win',
  'lose',
  'win_r',
  'q_tour',
  'q_point',
  'w_in',
  'w_tour',
  'partner',
  'next_oppo',
  'next_h2h',
  'predict_R64',
  'predict_R32',
  'predict_R16',
  'predict_QF',
  'predict_SF',
  'predict_F',
  'predict_W'
];

const WEIGHTS = {
  base: 0.35,
  surface: 0.25,
  draw: 0.20,
  form: 0.15,
  manual: 0.05
};

const POINT_TABLES = {
  ATP: {
    '250': {
      28: { R128: 0, R64: 0, R32: 0, R16: 25, QF: 50, SF: 100, F: 165, W: 250 },
      32: { R128: 0, R64: 0, R32: 0, R16: 25, QF: 50, SF: 100, F: 165, W: 250 },
      48: { R128: 0, R64: 0, R32: 13, R16: 25, QF: 50, SF: 100, F: 165, W: 250 }
    },
    '500': {
      28: { R128: 0, R64: 0, R32: 0, R16: 50, QF: 100, SF: 200, F: 330, W: 500 },
      32: { R128: 0, R64: 0, R32: 0, R16: 50, QF: 100, SF: 200, F: 330, W: 500 },
      48: { R128: 0, R64: 0, R32: 25, R16: 50, QF: 100, SF: 200, F: 330, W: 500 }
    },
    '1000': {
      56: { R128: 0, R64: 10, R32: 50, R16: 100, QF: 200, SF: 400, F: 650, W: 1000 },
      64: { R128: 0, R64: 10, R32: 50, R16: 100, QF: 200, SF: 400, F: 650, W: 1000 },
      96: { R128: 10, R64: 30, R32: 50, R16: 100, QF: 200, SF: 400, F: 650, W: 1000 }
    },
    slam: {
      128: { R128: 10, R64: 50, R32: 100, R16: 200, QF: 400, SF: 800, F: 1300, W: 2000 }
    }
  },
  WTA: {
    '250': {
      28: { R128: 0, R64: 0, R32: 1, R16: 30, QF: 54, SF: 98, F: 163, W: 250 },
      32: { R128: 0, R64: 0, R32: 1, R16: 30, QF: 54, SF: 98, F: 163, W: 250 },
      48: { R128: 0, R64: 1, R32: 18, R16: 30, QF: 54, SF: 98, F: 163, W: 250 }
    },
    '500': {
      28: { R128: 0, R64: 0, R32: 1, R16: 60, QF: 108, SF: 195, F: 325, W: 500 },
      32: { R128: 0, R64: 0, R32: 1, R16: 60, QF: 108, SF: 195, F: 325, W: 500 },
      48: { R128: 0, R64: 1, R32: 30, R16: 60, QF: 108, SF: 195, F: 325, W: 500 }
    },
    '1000': {
      56: { R128: 0, R64: 10, R32: 65, R16: 120, QF: 215, SF: 390, F: 650, W: 1000 },
      64: { R128: 0, R64: 10, R32: 65, R16: 120, QF: 215, SF: 390, F: 650, W: 1000 },
      96: { R128: 10, R64: 35, R32: 65, R16: 120, QF: 215, SF: 390, F: 650, W: 1000 }
    },
    slam: {
      128: { R128: 10, R64: 70, R32: 130, R16: 240, QF: 430, SF: 780, F: 1300, W: 2000 }
    }
  }
};

const ROUND_LABELS_BY_BRACKET = {
  32: ['R32', 'R16', 'QF', 'SF', 'F', 'W'],
  64: ['R64', 'R32', 'R16', 'QF', 'SF', 'F', 'W'],
  128: ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', 'W']
};

function decodeHtml(value = '') {
  return String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(html = '', name) {
  const m = html.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'));
  return m ? decodeHtml(m[1]) : null;
}

function elementTextByClass(html = '', tag, className) {
  for (const match of html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi'))) {
    const classes = attr(match[1], 'class');
    if (classes && classes.split(/\s+/).includes(className)) return decodeHtml(match[2]);
  }
  return null;
}

function toInt(value) {
  const n = Number(String(value ?? '').replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toNum(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function roundTo5(value) {
  return Math.max(0, Math.round(Number(value || 0) / 5) * 5);
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function statPercentile(value, values, { highGood = true, fallback = 50 } = {}) {
  const clean = values.filter((v) => Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (!Number.isFinite(Number(value)) || clean.length < 2) return fallback;
  let belowOrEqual = 0;
  for (const item of clean) {
    if (item <= Number(value)) belowOrEqual += 1;
  }
  const pct = ((belowOrEqual - 1) / (clean.length - 1)) * 100;
  return round2(highGood ? pct : 100 - pct);
}

function scorePercentileMap(rows, field, { highGood = true, keyField = 'player_key' } = {}) {
  const values = rows.map((row) => row[field]).filter((v) => Number.isFinite(Number(v))).map(Number);
  const map = new Map();
  for (const row of rows) {
    map.set(row[keyField], statPercentile(row[field], values, { highGood }));
  }
  return map;
}

function parseYearMonth(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{1,2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function monthsBetween(startValue, endValue) {
  const start = parseYearMonth(startValue);
  const endDate = endValue ? new Date(endValue) : new Date();
  if (!start || Number.isNaN(endDate.getTime())) return null;
  const end = { year: endDate.getUTCFullYear(), month: endDate.getUTCMonth() + 1 };
  return Math.max(0, (end.year - start.year) * 12 + (end.month - start.month));
}

function peakClosenessScore(currentElo, peakElo) {
  if (!Number.isFinite(Number(currentElo)) || !Number.isFinite(Number(peakElo)) || Number(peakElo) <= 0) return null;
  return round2(clamp((Number(currentElo) / Number(peakElo)) * 100));
}

function peakRecencyScore(peakMonth, snapshotDate) {
  const monthsAgo = monthsBetween(peakMonth, snapshotDate);
  if (!Number.isFinite(Number(monthsAgo))) return null;
  return round2(clamp(100 - (Number(monthsAgo) / 48) * 100));
}

async function loadText({ tour, kind, file, url, warnings }) {
  if (file) return readFile(file, 'utf8');
  const sourceUrl = url || (kind === 'ranking' ? RANKING_URLS[tour] : ELO_URLS[tour]);
  try {
    const res = await fetch(sourceUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 tour-manager-pricing/1.0'
      }
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } catch (error) {
    warnings.push(`${tour} ${kind} fetch failed from ${sourceUrl}: ${error.message}`);
    return '';
  }
}

function parseTennisAbstractElo(html, tour, sourceUrl, snapshotDate) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1] || '';
  const rows = [];
  for (const row of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => decodeHtml(m[1]));
    if (cells.length < 11) continue;
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
      peak_elo: toNum(cells[12]),
      peak_month: normalizeName(cells[13]),
      source_url: sourceUrl,
      raw: { cells }
    });
  }
  return rows;
}

function parseOfficialRankings(html, tour, sourceUrl, rankingDate, snapshotDate, warnings) {
  if (!html) return [];
  if (/Just a moment|cf-browser-verification|challenge-platform|Cloudflare/i.test(html)) {
    warnings.push(`${tour} official ranking page was blocked by anti-bot challenge. Use --${tour.toLowerCase()}-ranking-file with a downloaded official page/export.`);
    return [];
  }
  if (tour === 'WTA') return parseWtaRankings(html, sourceUrl, rankingDate, snapshotDate);
  return parseAtpRankings(html, sourceUrl, rankingDate, snapshotDate, warnings);
}

function parseWtaRankings(html, sourceUrl, rankingDate, snapshotDate) {
  const rows = [];
  for (const rowMatch of html.matchAll(/<tr\b([^>]*)class=["'][^"']*player-row[^"']*["']([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const attrs = `${rowMatch[1]} ${rowMatch[2]}`;
    const rowHtml = rowMatch[3];
    const name = normalizeName(attr(attrs, 'data-player-name') || rowHtml.match(/player-cell__name[^>]*>\s*([^<]+)</i)?.[1]);
    if (!name) continue;
    const rank = toInt(elementTextByClass(rowHtml, 'span', 'player-row__rank'));
    const points = toInt(rowHtml.match(/class=["'][^"']*\bplayer-row__cell--points\b[^"']*["'][^>]*>\s*([\s\S]*?)<\/td>/i)?.[1]);
    const movementRaw = decodeHtml(rowHtml.match(/player-row__movement[^>]*>\s*([^<]+)</i)?.[1] || '');
    const movement = movementRaw === '-' ? 0 : toInt(movementRaw);
    const profileId = attr(attrs, 'data-player-id');
    rows.push({
      tour: 'WTA',
      ranking_type: 'singles',
      ranking_date: rankingDate,
      snapshot_date: snapshotDate,
      rank,
      player_key: canonicalPlayerKey('WTA', { name_en: name }),
      name_en: name,
      points,
      movement,
      source_url: sourceUrl,
      raw: { profile_id: profileId, source: 'wtatennis.com/rankings' }
    });
  }
  return rows.filter((row) => row.rank);
}

function parseWtaApiRankingRows(rows, sourceUrl, fallbackRankingDate, snapshotDate) {
  return rows.map((row) => {
    const player = row.player || {};
    const name = normalizeName(player.fullName || [player.firstName, player.lastName].filter(Boolean).join(' '));
    const rankedAt = String(row.rankedAt || '').slice(0, 10);
    return {
      tour: 'WTA',
      ranking_type: 'singles',
      ranking_date: rankedAt || fallbackRankingDate,
      snapshot_date: snapshotDate,
      rank: toInt(row.ranking || row.rank),
      player_key: canonicalPlayerKey('WTA', { name_en: name }),
      name_en: name,
      points: toInt(row.points),
      movement: toInt(row.movement),
      source_url: sourceUrl,
      raw: {
        profile_id: player.id ? String(player.id) : null,
        country_code: player.countryCode || null,
        ranked_at: row.rankedAt || null,
        source: 'api.wtatennis.com/tennis/players/ranked'
      }
    };
  }).filter((row) => row.name_en && row.rank);
}

async function loadWtaRankingRowsFromApi({ args, warnings, rankingDate, snapshotDate }) {
  const pageUrl = args['wta-ranking-url'] || RANKING_URLS.WTA;
  const html = await loadText({ tour: 'WTA', kind: 'ranking', url: pageUrl, warnings });
  const pageRankingDate = html.match(/data-date=["']([^"']+)["']/i)?.[1] || rankingDate;
  const account = html.match(/"wscApiKey"\s*:\s*"([^"]+)"/)?.[1] || null;
  const tennisApiRaw = html.match(/"tennisApi"\s*:\s*"([^"]+)"/)?.[1] || '//api.wtatennis.com/tennis';
  const tennisApi = tennisApiRaw.startsWith('//') ? `https:${tennisApiRaw}` : tennisApiRaw;
  if (!account) {
    warnings.push('WTA ranking API account key not found in official page; falling back to first-page HTML ranking parse.');
    return parseWtaRankings(html, pageUrl, pageRankingDate, snapshotDate);
  }

  const pageSize = Math.min(500, Math.max(50, Number(args['wta-ranking-page-size'] || 100)));
  const allRows = [];
  for (let page = 0; page < 40; page += 1) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      type: 'rankSingles',
      sort: 'asc',
      metric: 'SINGLES',
      at: pageRankingDate,
      name: '',
      nationality: ''
    });
    const sourceUrl = `${tennisApi}/players/ranked?${params}`;
    let apiRows = [];
    try {
      const res = await fetch(sourceUrl, {
        headers: {
          accept: 'application/json',
          account,
          'user-agent': 'Mozilla/5.0 tour-manager-pricing/1.0'
        }
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      apiRows = await res.json();
    } catch (error) {
      warnings.push(`WTA ranking API fetch failed from ${sourceUrl}: ${error.message}`);
      break;
    }
    if (!Array.isArray(apiRows) || !apiRows.length) break;
    allRows.push(...parseWtaApiRankingRows(apiRows, sourceUrl, pageRankingDate, snapshotDate));
    if (apiRows.length < pageSize) break;
  }
  if (!allRows.length) {
    warnings.push('WTA ranking API returned no rows; falling back to first-page HTML ranking parse.');
    return parseWtaRankings(html, pageUrl, pageRankingDate, snapshotDate);
  }
  return allRows;
}

function parseAtpRankings(html, sourceUrl, rankingDate, snapshotDate, warnings) {
  const rows = [];
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    if (!/rank|player|points/i.test(rowHtml)) continue;
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => decodeHtml(m[1]));
    if (cells.length < 3) continue;
    const rank = toInt(cells[0]);
    const name = normalizeName(cells.find((cell) => /[A-Za-z]{2,}\s+[A-Za-z]/.test(cell)) || '');
    const points = toInt(cells.slice().reverse().find((cell) => /[\d,]{3,}/.test(cell)));
    if (!rank || !name) continue;
    rows.push({
      tour: 'ATP',
      ranking_type: 'singles',
      ranking_date: rankingDate,
      snapshot_date: snapshotDate,
      rank,
      player_key: canonicalPlayerKey('ATP', { name_en: name }),
      name_en: name,
      points,
      movement: null,
      source_url: sourceUrl,
      raw: { cells, source: 'atptour.com/rankings' }
    });
  }
  if (!rows.length) warnings.push('ATP ranking parser found no rows. Provide a downloaded official ranking file if ATP market has players.');
  return rows;
}

function isLiveTennisRankingUrl(sourceUrl = '') {
  return /live-tennis\.cn\/[^/]+\/rank\//i.test(String(sourceUrl));
}

function liveTennisQueryUrl(sourceUrl = '') {
  return String(sourceUrl).replace(/\/$/, '') + '/query';
}

function cookieHeaderFromHeaders(headers) {
  const getSetCookie = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const raw = getSetCookie.length ? getSetCookie : String(headers.get('set-cookie') || '').split(/,(?=[^;,]+=)/);
  return raw
    .map((item) => String(item || '').split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function liveTennisRankingBody() {
  const params = new URLSearchParams({
    draw: '1',
    start: '0',
    length: '1200',
    device: '0'
  });
  LIVE_TENNIS_RANK_COLUMNS.forEach((column, index) => {
    params.set(`columns[${index}][data]`, column);
    params.set(`columns[${index}][name]`, '');
    params.set(`columns[${index}][searchable]`, 'true');
    params.set(`columns[${index}][orderable]`, 'true');
    params.set(`columns[${index}][search][value]`, '');
    params.set(`columns[${index}][search][regex]`, 'false');
  });
  params.set('order[0][column]', '0');
  params.set('order[0][dir]', 'asc');
  params.set('search[value]', '');
  params.set('search[regex]', 'false');
  return params;
}

function parseLiveTennisRankingRows(payload, tour, sourceUrl, rankingDate, snapshotDate) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data.map((row) => {
    const name = normalizeName(row.eng_name || row.engname || row.full_name || row.name_for_search);
    const rank = toInt(row.c_rank || row.f_rank);
    const profileId = row.id ? String(row.id) : null;
    return {
      tour,
      ranking_type: 'singles',
      ranking_date: rankingDate,
      snapshot_date: snapshotDate,
      rank,
      player_key: canonicalPlayerKey(tour, { name_en: name }),
      name_en: name,
      points: toInt(row.point || row.alt_point),
      movement: toInt(row.change),
      source_url: sourceUrl,
      raw: {
        ...row,
        profile_id: profileId,
        country_code: row.ioc || null,
        photo_url: profileId ? `https://static.live-tennis.cn/pic/ts/${profileId}` : null,
        source: 'live-tennis.cn/rank'
      }
    };
  }).filter((row) => row.name_en && row.rank);
}

async function loadLiveTennisRankingRows({ tour, sourceUrl, warnings, rankingDate, snapshotDate }) {
  let html = '';
  let cookieHeader = '';
  let csrf = '';
  try {
    const pageRes = await fetch(sourceUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 tour-manager-pricing/1.0'
      }
    });
    if (!pageRes.ok) throw new Error(`${pageRes.status} ${pageRes.statusText}`);
    cookieHeader = cookieHeaderFromHeaders(pageRes.headers);
    html = await pageRes.text();
    csrf = html.match(/name=["']csrf-token["']\s+content=["']([^"']+)/i)?.[1] || '';
  } catch (error) {
    warnings.push(`${tour} Live Tennis ranking page fetch failed from ${sourceUrl}: ${error.message}`);
    return [];
  }

  try {
    const queryUrl = liveTennisQueryUrl(sourceUrl);
    const res = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/javascript, */*; q=0.01',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        cookie: cookieHeader,
        referer: sourceUrl,
        'user-agent': 'Mozilla/5.0 tour-manager-pricing/1.0',
        'x-csrf-token': csrf,
        'x-requested-with': 'XMLHttpRequest'
      },
      body: liveTennisRankingBody()
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const payload = await res.json();
    const rows = parseLiveTennisRankingRows(payload, tour, sourceUrl, rankingDate, snapshotDate);
    if (!rows.length) warnings.push(`${tour} Live Tennis ranking query returned no parseable rows.`);
    return rows;
  } catch (error) {
    warnings.push(`${tour} Live Tennis ranking query failed from ${sourceUrl}: ${error.message}`);
    return [];
  }
}

function parseDelimited(text, tour, sourceUrl, rankingDate, snapshotDate) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitDelimitedLine(lines[0], delimiter).map((h) => slugify(h).replace(/-/g, '_'));
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = splitDelimitedLine(line, delimiter);
    const row = Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
    const name = normalizeName(row.name || row.name_en || row.player || row.player_name);
    const rank = toInt(row.rank || row.ranking || row.official_rank);
    if (!name || !rank) continue;
    out.push({
      tour,
      ranking_type: 'singles',
      ranking_date: rankingDate,
      snapshot_date: snapshotDate,
      rank,
      player_key: canonicalPlayerKey(tour, { name_en: name }),
      name_en: name,
      points: toInt(row.points || row.official_points),
      movement: toInt(row.movement),
      source_url: sourceUrl,
      raw: row
    });
  }
  return out;
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === delimiter && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

async function loadRankingRows({ tour, args, warnings, rankingDate, snapshotDate }) {
  const specific = args[`${tour.toLowerCase()}-ranking-file`] || args[`${tour}-ranking-file`];
  const generic = args['ranking-file'];
  const file = specific || generic;
  if (file && /\.(csv|tsv)$/i.test(file)) {
    return parseDelimited(await readFile(file, 'utf8'), tour, `file://${file}`, rankingDate, snapshotDate);
  }
  if (file && /\.json$/i.test(file)) {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return normalizeRankingRows(data.rows || data, tour, `file://${file}`, rankingDate, snapshotDate);
  }
  const sourceUrl = args[`${tour.toLowerCase()}-ranking-url`] || RANKING_URLS[tour];
  if (isLiveTennisRankingUrl(sourceUrl)) {
    return loadLiveTennisRankingRows({ tour, sourceUrl, warnings, rankingDate, snapshotDate });
  }
  if (tour === 'WTA' && /wtatennis\.com\/rankings/i.test(sourceUrl)) {
    return loadWtaRankingRowsFromApi({ args, warnings, rankingDate, snapshotDate });
  }
  const html = await loadText({ tour, kind: 'ranking', file, url: sourceUrl, warnings });
  return parseOfficialRankings(html, tour, sourceUrl, rankingDate, snapshotDate, warnings);
}

async function loadEloRows({ tour, args, warnings, snapshotDate }) {
  const file = args[`${tour.toLowerCase()}-elo-file`] || args[`${tour}-elo-file`] || args['elo-file'];
  if (file && /\.json$/i.test(file)) {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return normalizeEloRows(data.rows || data, tour, `file://${file}`, snapshotDate);
  }
  const sourceUrl = args[`${tour.toLowerCase()}-elo-url`] || ELO_URLS[tour];
  const html = await loadText({ tour, kind: 'elo', file, url: sourceUrl, warnings });
  const rows = parseTennisAbstractElo(html, tour, sourceUrl, snapshotDate);
  if (!rows.length) warnings.push(`${tour} Tennis Abstract parser found no Elo rows.`);
  return rows;
}

function normalizeRankingRows(rows, tour, sourceUrl, rankingDate, snapshotDate) {
  return rows.map((row) => {
    const name = normalizeName(row.name_en || row.name || row.player || row.player_name);
    return {
      tour,
      ranking_type: 'singles',
      ranking_date,
      snapshot_date: snapshotDate,
      rank: toInt(row.rank || row.ranking || row.official_rank),
      player_key: row.player_key || canonicalPlayerKey(tour, { name_en: name }),
      name_en: name,
      points: toInt(row.points || row.official_points),
      movement: toInt(row.movement),
      source_url: row.source_url || sourceUrl,
      raw: row.raw || row
    };
  }).filter((row) => row.name_en && row.rank);
}

function normalizeEloRows(rows, tour, sourceUrl, snapshotDate) {
  return rows.map((row) => {
    const name = normalizeName(row.name_en || row.name || row.player || row.player_name);
    return {
      tour,
      snapshot_date: snapshotDate,
      player_key: row.player_key || canonicalPlayerKey(tour, { name_en: name }),
      name_en: name,
      overall_rank: toInt(row.overall_rank),
      overall_elo: toNum(row.overall_elo),
      hard_rank: toInt(row.hard_rank),
      hard_elo: toNum(row.hard_elo),
      clay_rank: toInt(row.clay_rank),
      clay_elo: toNum(row.clay_elo),
      grass_rank: toInt(row.grass_rank),
      grass_elo: toNum(row.grass_elo),
      source_url: row.source_url || sourceUrl,
      raw: row.raw || row
    };
  }).filter((row) => row.name_en);
}

function bracketSizeFor(drawSize = 32) {
  if (drawSize <= 32) return 32;
  if (drawSize <= 64) return 64;
  return 128;
}

function drawBucket(drawSize = 32) {
  const n = Number(drawSize) || 32;
  if (n >= 128) return 128;
  if (n >= 96) return 96;
  if (n >= 64) return 64;
  if (n >= 56) return 56;
  if (n >= 48) return 48;
  if (n >= 32) return 32;
  if (n >= 28) return 28;
  return 32;
}

function pointsFor(event) {
  const level = String(event.level || '').toLowerCase();
  const key = /\bgs\b|slam|grand|大满贯/.test(level) ? 'slam' : String(event.level || '500');
  const tables = POINT_TABLES[event.tour]?.[key] || POINT_TABLES[event.tour]?.['500'] || POINT_TABLES.WTA['500'];
  const bucket = drawBucket(event.draw_size);
  return tables[bucket] || tables[32] || tables[28] || tables[64] || tables[96] || tables[128] || {};
}

function surfaceField(surface = '') {
  const value = String(surface).toLowerCase();
  if (value.includes('clay') || value.includes('红土')) return 'clay_elo';
  if (value.includes('grass') || value.includes('草')) return 'grass_elo';
  return 'hard_elo';
}

function eloValue(row, field) {
  return toNum(row?.[field]) || toNum(row?.overall_elo) || null;
}

function nameVariants(value = '') {
  const normalized = normalizeName(value);
  const variants = new Set([slugify(normalized)]);
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts.every((part) => /^[A-Za-z'.-]+$/.test(part))) {
    variants.add(slugify(`${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}`));
    if (parts.length === 2) {
      variants.add(slugify(`${parts[1]} ${parts[0]}`));
    } else {
      const givenJoined = parts.slice(0, -1).join('');
      variants.add(slugify(`${givenJoined} ${parts[parts.length - 1]}`));
      variants.add(slugify(`${parts[parts.length - 1]} ${givenJoined}`));
    }
  }
  return [...variants].filter(Boolean);
}

function aliasVariants(key, aliases = {}) {
  const values = aliases[key] || aliases[slugify(key)] || [];
  return Array.isArray(values) ? values.flatMap((value) => nameVariants(value)) : [];
}

function buildMatchMaps(rows, aliases = {}) {
  const byKey = new Map();
  const byName = new Map();
  for (const row of rows) {
    byKey.set(row.player_key, row);
    for (const variant of [...nameVariants(row.name_en), ...aliasVariants(row.player_key, aliases)]) {
      if (!byName.has(variant)) byName.set(variant, row);
    }
  }
  return { byKey, byName };
}

function findRow(player, maps, tour, aliases = {}) {
  const key = canonicalPlayerKey(tour, player);
  const candidates = [
    ...nameVariants(player.name_en || ''),
    ...nameVariants(player.name_zh || ''),
    ...aliasVariants(key, aliases),
    ...aliasVariants(player.player_key, aliases)
  ];
  return maps.byKey.get(key) || candidates.map((candidate) => maps.byName.get(candidate)).find(Boolean) || null;
}

function sourceOverrideFor(key, overrides = {}) {
  return overrides[key] || overrides[slugify(key)] || null;
}

function rankingOverrideRow(player, key, tour, override, snapshotDate) {
  const ranking = override?.ranking;
  if (!ranking || ranking.rank == null) return null;
  return {
    tour,
    ranking_type: 'singles',
    ranking_date: String(ranking.ranking_date || snapshotDate),
    snapshot_date: snapshotDate,
    rank: toInt(ranking.rank),
    player_key: key,
    name_en: normalizeName(ranking.name_en || player.name_en || player.name_zh),
    points: toInt(ranking.points),
    movement: toInt(ranking.movement),
    source_url: ranking.source_url || 'source_override',
    raw: {
      source: 'player_source_overrides',
      note: ranking.note || null
    }
  };
}

function buildRankEloProxyRows(rankings, elos, aliases, tour, surfaceEloField) {
  const eloMaps = buildMatchMaps(elos, aliases);
  const rows = [];
  for (const ranking of rankings) {
    const elo = findRow({ name_en: ranking.name_en, player_key: ranking.player_key }, eloMaps, tour, aliases);
    const overallElo = eloValue(elo, 'overall_elo');
    if (!Number.isFinite(Number(ranking.rank)) || !Number.isFinite(overallElo)) continue;
    rows.push({
      rank: Number(ranking.rank),
      overall_elo: overallElo,
      surface_elo: eloValue(elo, surfaceEloField),
      peak_elo: eloValue(elo, 'peak_elo'),
      peak_month: elo?.peak_month || null
    });
  }
  return rows.sort((a, b) => a.rank - b.rank);
}

function weightedAverage(values) {
  let totalWeight = 0;
  let totalValue = 0;
  for (const item of values) {
    if (!Number.isFinite(Number(item.value)) || !Number.isFinite(Number(item.weight)) || item.weight <= 0) continue;
    totalWeight += item.weight;
    totalValue += item.value * item.weight;
  }
  return totalWeight ? totalValue / totalWeight : null;
}

function proxyEloFromRank({ player, ranking, proxyRows, tour, surfaceEloField, snapshotDate }) {
  const rank = Number(ranking?.rank);
  if (!Number.isFinite(rank) || !proxyRows.length) return null;
  const nearest = proxyRows
    .map((row) => ({ ...row, distance: Math.abs(row.rank - rank) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.min(9, proxyRows.length));
  const weighted = nearest.map((row) => ({ ...row, weight: 1 / (1 + row.distance) }));
  const overallElo = weightedAverage(weighted.map((row) => ({ value: row.overall_elo, weight: row.weight })));
  const surfaceElo = weightedAverage(weighted.map((row) => ({ value: row.surface_elo, weight: row.weight })));
  const peakElo = weightedAverage(weighted.map((row) => ({ value: row.peak_elo, weight: row.weight })));
  if (!Number.isFinite(overallElo)) return null;
  return {
    tour,
    snapshot_date: snapshotDate,
    player_key: canonicalPlayerKey(tour, player),
    name_en: normalizeName(player.name_en || player.name_zh),
    overall_rank: null,
    overall_elo: round2(overallElo),
    hard_rank: null,
    hard_elo: null,
    clay_rank: null,
    clay_elo: null,
    grass_rank: null,
    grass_elo: round2(Number.isFinite(surfaceElo) ? surfaceElo : overallElo),
    peak_elo: round2(Number.isFinite(peakElo) ? peakElo : overallElo),
    peak_month: null,
    source_url: `rank_proxy:${ranking.source_url || 'official_ranking'}+tennisabstract_distribution:${surfaceEloField}`,
    raw: {
      source: 'rank_proxy_from_official_ranking_and_tennis_abstract_distribution',
      rank,
      sample_count: nearest.length,
      sample_rank_range: [nearest[0]?.rank || null, nearest[nearest.length - 1]?.rank || null]
    }
  };
}

function playerBucket(player, event) {
  if (player.is_qualifier_placeholder || /^Qualifier\b/i.test(player.name_en || '')) return 'qualifier';
  if (player.first_round === 'BYE') return 'seed_bye';
  if (player.seed) return 'seed';
  if (Number(player.rank) > 250) return 'wildcard_or_low_rank';
  return 'direct';
}

function withSwappedPosition(players, aKey, bPosition, tour) {
  const cloned = players.map((player) => ({ ...player }));
  const a = cloned.find((player) => canonicalPlayerKey(tour, player) === aKey);
  const b = cloned.find((player) => player.draw_position === bPosition);
  if (!a || !b || a === b) return cloned;
  const tmpPosition = a.draw_position;
  const tmpRound = a.first_round;
  a.draw_position = b.draw_position;
  a.first_round = b.first_round;
  b.draw_position = tmpPosition;
  b.first_round = tmpRound;
  return cloned;
}

function eloWinProb(aElo, bElo) {
  const a = Number(aElo || 1500);
  const b = Number(bElo || 1500);
  return 1 / (1 + (10 ** ((b - a) / 400)));
}

function simulateExpectedPoints(event, players, factsByKey) {
  const bracketSize = bracketSizeFor(event.draw_size);
  const stages = ROUND_LABELS_BY_BRACKET[bracketSize];
  const pointTable = pointsFor(event);
  const leaves = Array.from({ length: bracketSize }, () => null);
  const reach = new Map();

  for (const player of players) {
    if (!player.draw_position || player.draw_position < 1 || player.draw_position > bracketSize) continue;
    const key = canonicalPlayerKey(event.tour, player);
    leaves[player.draw_position - 1] = key;
    reach.set(key, { [stages[0]]: 1 });
  }

  let nodes = leaves.map((key) => (key ? new Map([[key, 1]]) : new Map()));
  for (let round = 0; round < stages.length - 1; round += 1) {
    const nextStage = stages[round + 1];
    const nextNodes = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i] || new Map();
      const right = nodes[i + 1] || new Map();
      const leftSum = sumMap(left);
      const rightSum = sumMap(right);
      const merged = new Map();

      if (leftSum > 0 && rightSum === 0) {
        for (const [key, prob] of left) addAdvance(merged, reach, key, prob, nextStage);
      } else if (rightSum > 0 && leftSum === 0) {
        for (const [key, prob] of right) addAdvance(merged, reach, key, prob, nextStage);
      } else if (leftSum > 0 && rightSum > 0) {
        for (const [leftKey, leftProb] of left) {
          let advanceProb = 0;
          for (const [rightKey, rightProb] of right) {
            const p = eloWinProb(factsByKey.get(leftKey)?.surface_elo, factsByKey.get(rightKey)?.surface_elo);
            advanceProb += leftProb * rightProb * p;
            const rightAdvance = leftProb * rightProb * (1 - p);
            addAdvance(merged, reach, rightKey, rightAdvance, nextStage);
          }
          addAdvance(merged, reach, leftKey, advanceProb, nextStage);
        }
      }
      nextNodes.push(merged);
    }
    nodes = nextNodes;
  }

  const result = new Map();
  for (const [key, stageReach] of reach) {
    let expected = pointTable[stages[0]] || 0;
    for (let i = 1; i < stages.length; i += 1) {
      const prev = pointTable[stages[i - 1]] || 0;
      const curr = pointTable[stages[i]] || 0;
      expected += Math.max(0, curr - prev) * (stageReach[stages[i]] || 0);
    }
    result.set(key, {
      reach: stageReach,
      expected_points: round2(expected),
      expected_round: roundFromPoints(expected, pointTable, stages)
    });
  }
  return { stages, pointTable, result };
}

function sumMap(map) {
  let sum = 0;
  for (const value of map.values()) sum += value;
  return sum;
}

function addAdvance(merged, reach, key, prob, stage) {
  if (!prob) return;
  merged.set(key, (merged.get(key) || 0) + prob);
  const stageReach = reach.get(key) || {};
  stageReach[stage] = (stageReach[stage] || 0) + prob;
  reach.set(key, stageReach);
}

function roundFromPoints(points, pointTable, stages) {
  let label = stages[0];
  for (const stage of stages) {
    if ((pointTable[stage] || 0) <= points) label = stage;
  }
  return label;
}

function breakevenRound(price, pointTable, stages) {
  for (const stage of stages) {
    if ((pointTable[stage] || 0) >= price) return stage;
  }
  return '夺冠仍未回本';
}

function expectedPricingElo(player) {
  const surface = Number(player.surface_elo);
  const overall = Number(player.overall_elo);
  const scores = player.scores || {};
  const form = Number(scores.form ?? 50);
  const base = Number(scores.base ?? 50);
  let elo = 1500;
  if (Number.isFinite(surface) && Number.isFinite(overall)) {
    elo = surface * 0.74 + overall * 0.26;
  } else if (Number.isFinite(surface)) {
    elo = surface;
  } else if (Number.isFinite(overall)) {
    elo = overall;
  }
  const formBoost = clamp((form - 50) * 1.4, -70, 70);
  const baseBoost = clamp((base - 50) * 0.6, -30, 30);
  return elo + formBoost + baseBoost;
}

function simulateExpectedPricing(event, players) {
  const bracketSize = bracketSizeFor(event.draw_size);
  const stages = ROUND_LABELS_BY_BRACKET[bracketSize];
  const pointTable = pointsFor(event);
  const leaves = Array.from({ length: bracketSize }, () => null);
  const reach = new Map();
  const eloByKey = new Map();

  for (const player of players || []) {
    if (!player.draw_position || player.draw_position < 1 || player.draw_position > bracketSize) continue;
    const key = player.player_key || canonicalPlayerKey(event.tour, player);
    leaves[player.draw_position - 1] = key;
    reach.set(key, { [stages[0]]: 1 });
    eloByKey.set(key, expectedPricingElo(player));
  }

  let nodes = leaves.map((key) => (key ? new Map([[key, 1]]) : new Map()));
  for (let round = 0; round < stages.length - 1; round += 1) {
    const nextStage = stages[round + 1];
    const nextNodes = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i] || new Map();
      const right = nodes[i + 1] || new Map();
      const leftSum = sumMap(left);
      const rightSum = sumMap(right);
      const merged = new Map();

      if (leftSum > 0 && rightSum === 0) {
        for (const [key, prob] of left) addAdvance(merged, reach, key, prob, nextStage);
      } else if (rightSum > 0 && leftSum === 0) {
        for (const [key, prob] of right) addAdvance(merged, reach, key, prob, nextStage);
      } else if (leftSum > 0 && rightSum > 0) {
        for (const [leftKey, leftProb] of left) {
          let advanceProb = 0;
          for (const [rightKey, rightProb] of right) {
            const p = eloWinProb(eloByKey.get(leftKey), eloByKey.get(rightKey));
            advanceProb += leftProb * rightProb * p;
            addAdvance(merged, reach, rightKey, leftProb * rightProb * (1 - p), nextStage);
          }
          addAdvance(merged, reach, leftKey, advanceProb, nextStage);
        }
      }
      nextNodes.push(merged);
    }
    nodes = nextNodes;
  }

  const result = new Map();
  for (const [key, stageReach] of reach) {
    let expected = pointTable[stages[0]] || 0;
    for (let i = 1; i < stages.length; i += 1) {
      const prev = pointTable[stages[i - 1]] || 0;
      const curr = pointTable[stages[i]] || 0;
      expected += Math.max(0, curr - prev) * (stageReach[stages[i]] || 0);
    }
    result.set(key, {
      reach: stageReach,
      expected_points: round2(expected),
      expected_round: roundFromPoints(expected, pointTable, stages)
    });
  }
  return { stages, pointTable, result };
}

function interpolate(points, anchors) {
  const value = Number(points || 0);
  if (value <= anchors[0].points) return anchors[0].price;
  for (let i = 1; i < anchors.length; i += 1) {
    const prev = anchors[i - 1];
    const curr = anchors[i];
    if (value <= curr.points) {
      const span = Math.max(1, curr.points - prev.points);
      const t = clamp((value - prev.points) / span, 0, 1);
      const smooth = t * t * (3 - 2 * t);
      return prev.price + (curr.price - prev.price) * smooth;
    }
  }
  return anchors[anchors.length - 1].price;
}

function expectedRoundMarketPrice(player, event, simulation) {
  const key = player.player_key || canonicalPlayerKey(event.tour, player);
  const result = simulation.result.get(key);
  const expectedPoints = Number(result?.expected_points ?? player.expected_points ?? 0);
  const table = pointsFor(event);
  const winnerPoints = table.W || 2000;
  const isGrandSlam = /^(?:GS|SLAM)$/i.test(String(event.level || '')) || winnerPoints >= 2000;
  const minPrice = isGrandSlam
    ? (event.tour === 'WTA' ? 90 : 80)
    : Math.max(15, winnerPoints * (event.tour === 'WTA' ? 0.06 : 0.05));
  const maxPrice = winnerPoints * 0.65;
  let basePrice;
  if (isGrandSlam) {
    const anchors = [
      { points: 0, price: minPrice },
      { points: table.R128 ?? 10, price: minPrice },
      { points: table.R64 ?? 50, price: 165 },
      { points: table.R32 ?? 100, price: 310 },
      { points: table.R16 ?? 200, price: 470 },
      { points: table.QF ?? 400, price: 650 },
      { points: table.SF ?? 800, price: 880 },
      { points: table.F ?? 1300, price: 1160 },
      { points: winnerPoints, price: maxPrice }
    ].sort((a, b) => a.points - b.points);
    basePrice = interpolate(expectedPoints, anchors);
  } else {
    const expectedShare = clamp(expectedPoints / Math.max(1, winnerPoints), 0, 1);
    basePrice = minPrice + (maxPrice - minPrice) * (expectedShare ** 0.68);
  }
  const scores = player.scores || {};
  const strength = (Number(scores.base ?? 50) * 0.42)
    + (Number(scores.surface ?? 50) * 0.38)
    + (Number(scores.form ?? 50) * 0.20);
  const modifier = 1 + clamp((strength - 60) / 160, -0.12, 0.15);
  return {
    price: roundTo5(clamp(basePrice * modifier, minPrice, maxPrice)),
    expected_points: round2(expectedPoints),
    expected_round: result?.expected_round || player.expected_round || roundFromPoints(expectedPoints, table, simulation.stages),
    effective_elo: round2(expectedPricingElo(player))
  };
}

function marketPrice(totalScore, expectedPoints, event) {
  const table = pointsFor(event);
  const winner = table.W || 500;
  const minPrice = event.tour === 'WTA' ? Math.max(15, winner * 0.06) : Math.max(15, winner * 0.05);
  const maxPrice = winner * 0.65;
  const scorePart = (clamp(totalScore) / 100) ** 2.35;
  const expectedPart = clamp(expectedPoints / Math.max(1, winner), 0, 1) ** 0.9;
  const raw = minPrice + (maxPrice - minPrice) * (scorePart * 0.68 + expectedPart * 0.32);
  return roundTo5(clamp(raw, minPrice, maxPrice));
}

function updateEventPrices(event, rankings, elos, warnings, snapshotDate, aliases = {}, sourceOverrides = {}) {
  if (!event.players?.length) {
    return {
      event,
      priceRows: [],
      warnings: [`${event.event_key} has no players yet; skipped pricing until draw is published.`]
    };
  }

  const tour = event.tour;
  const surfaceEloField = surfaceField(event.surface);
  const rankingMaps = buildMatchMaps(rankings, aliases);
  const eloMaps = buildMatchMaps(elos, aliases);
  const proxyRows = buildRankEloProxyRows(rankings, elos, aliases, tour, surfaceEloField);
  const sourceWarnings = [];
  const facts = event.players.map((player) => {
    const playerKey = canonicalPlayerKey(tour, player);
    const override = sourceOverrideFor(playerKey, sourceOverrides);
    const ranking = rankingOverrideRow(player, playerKey, tour, override, snapshotDate) || findRow(player, rankingMaps, tour, aliases);
    const directElo = findRow(player, eloMaps, tour, aliases);
    const elo = directElo || proxyEloFromRank({ player, ranking, proxyRows, tour, surfaceEloField, snapshotDate });
    const overallElo = eloValue(elo, 'overall_elo');
    const surfaceElo = eloValue(elo, surfaceEloField);
    const peakElo = eloValue(elo, 'peak_elo');
    const peakMonth = elo?.peak_month || null;
    const peakCloseScore = peakClosenessScore(overallElo, peakElo);
    const peakFreshScore = peakRecencyScore(peakMonth, snapshotDate);
    return {
      playerKey,
      ranking,
      elo,
      rank: ranking?.rank || player.rank || null,
      official_points: ranking?.points || player.points || null,
      overall_elo: overallElo,
      surface_elo: surfaceElo,
      surface_bonus: Number.isFinite(surfaceElo) && Number.isFinite(overallElo) ? surfaceElo - overallElo : null,
      peak_elo: peakElo,
      peak_month: peakMonth,
      peak_close_score: peakCloseScore,
      peak_fresh_score: peakFreshScore,
      elo_is_proxy: Boolean(!directElo && elo)
    };
  });
  const factsByKey = new Map(facts.map((fact) => [fact.playerKey, fact]));
  const officialRankPercentiles = scorePercentileMap(facts, 'rank', { highGood: false, keyField: 'playerKey' });
  const overallEloPercentiles = scorePercentileMap(facts, 'overall_elo', { highGood: true, keyField: 'playerKey' });
  const surfaceEloPercentiles = scorePercentileMap(facts, 'surface_elo', { highGood: true, keyField: 'playerKey' });
  const surfaceBonusPercentiles = scorePercentileMap(facts, 'surface_bonus', { highGood: true, keyField: 'playerKey' });

  const actualSimulation = simulateExpectedPoints(event, event.players, factsByKey);
  const drawRawRows = [];
  for (const player of event.players) {
    const key = canonicalPlayerKey(tour, player);
    const actual = actualSimulation.result.get(key)?.expected_points ?? 0;
    const bucket = playerBucket(player, event);
    const eligiblePositions = event.players
      .filter((candidate) => candidate.draw_position && playerBucket(candidate, event) === bucket)
      .map((candidate) => candidate.draw_position);
    const baselineValues = [];
    for (const position of eligiblePositions.slice(0, 32)) {
      const swapped = withSwappedPosition(event.players, key, position, tour);
      const sim = simulateExpectedPoints(event, swapped, factsByKey);
      baselineValues.push(sim.result.get(key)?.expected_points ?? actual);
    }
    const baseline = baselineValues.length ? baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length : actual;
    drawRawRows.push({
      playerKey: key,
      actual,
      baseline,
      draw_bonus: actual - baseline,
      bucket,
      baseline_sample_count: baselineValues.length
    });
  }
  const drawBonusScores = scorePercentileMap(drawRawRows, 'draw_bonus', { highGood: true, keyField: 'playerKey' });
  const drawRowsByKey = new Map(drawRawRows.map((row) => [row.playerKey, row]));

  let updatedPlayers = event.players.map((player) => {
    const key = canonicalPlayerKey(tour, player);
    const fact = factsByKey.get(key) || {};
    const actual = actualSimulation.result.get(key) || {};
    const baseScore = round2((overallEloPercentiles.get(key) ?? 50) * 0.65 + (officialRankPercentiles.get(key) ?? 50) * 0.35);
    const surfaceScore = round2((surfaceEloPercentiles.get(key) ?? baseScore ?? 50) * 0.70 + (surfaceBonusPercentiles.get(key) ?? 50) * 0.30);
    const drawScore = round2(drawBonusScores.get(key) ?? 50);
    const closeScore = Number.isFinite(Number(fact.peak_close_score)) ? Number(fact.peak_close_score) : baseScore;
    const freshScore = Number.isFinite(Number(fact.peak_fresh_score)) ? Number(fact.peak_fresh_score) : 50;
    const formScore = round2(closeScore * 0.70 + freshScore * 0.30);
    const manualScore = toNum(player.scores?.manual) || 0;
    let scores = {
      base: baseScore,
      surface: surfaceScore,
      draw: drawScore,
      form: formScore,
      manual: manualScore
    };
    let totalScore = scoreTotal(scores);
    let price = marketPrice(totalScore, actual.expected_points || 0, event);
    let tier = priceTier(price, event);
    let breakeven = breakevenRound(price, actualSimulation.pointTable, actualSimulation.stages);
    const drawFacts = drawRowsByKey.get(key) || {};
    if (!fact.ranking && !player.is_qualifier_placeholder) sourceWarnings.push(`${player.name_en || player.name_zh}: missing official ranking.`);
    if (fact.elo_is_proxy && !player.is_qualifier_placeholder) sourceWarnings.push(`${player.name_en || player.name_zh}: TA current Elo unavailable; used ranking proxy score.`);
    if (!fact.elo && !player.is_qualifier_placeholder) sourceWarnings.push(`${player.name_en || player.name_zh}: missing TA Elo, used neutral/proxy score.`);
    const computedPricingDetail = {
      formula_version: 'build-prices-v1',
      weights: WEIGHTS,
      point_table: actualSimulation.pointTable,
      ranking_source: fact.ranking?.source_url || 'missing_official_ranking',
      elo_source: fact.elo?.source_url || 'missing_or_event_proxy',
      surface_elo_field: surfaceEloField,
      elo_source_kind: fact.elo_is_proxy ? 'rank_proxy' : (fact.elo ? 'tennis_abstract' : 'missing'),
      peak_elo: round2(fact.peak_elo),
      peak_month: fact.peak_month || null,
      peak_close_score: round2(fact.peak_close_score),
      peak_recency_score: round2(fact.peak_fresh_score),
      draw_bonus_raw: round2(drawFacts.draw_bonus),
      draw_actual_expected_points: round2(drawFacts.actual),
      draw_same_bucket_baseline_points: round2(drawFacts.baseline),
      draw_bucket: drawFacts.bucket,
      draw_baseline_sample_count: drawFacts.baseline_sample_count,
      score_explanation: {
        base: '65% TA overall Elo percentile + 35% official ranking inverse percentile.',
        surface: '70% surface Elo percentile + 30% surface bonus percentile.',
        draw: 'Same-bucket draw bonus percentile: actual expected points minus average after swapping into legal comparable draw slots.',
        form: '70% current TA overall Elo closeness to personal Peak Elo + 30% Peak Month recency, linearly fading to 0 over 48 months.',
        manual: 'Manual correction defaults to 0.'
      }
    };
    let pricingDetail = computedPricingDetail;
    const preR1Substitution = player.pre_r1_substitution || null;
    const inheritedPrice = Number(player.price);
    if (preR1Substitution && Number.isFinite(inheritedPrice) && inheritedPrice > 0) {
      scores = player.scores || scores;
      totalScore = player.total_score ?? scoreTotal(scores);
      price = inheritedPrice;
      tier = player.tier || priceTier(price, event);
      breakeven = player.breakeven_round || breakevenRound(price, actualSimulation.pointTable, actualSimulation.stages);
      pricingDetail = {
        ...(player.pricing_detail || {}),
        formula_version: player.pricing_detail?.formula_version || 'pre-r1-substitution-inherited-price',
        contract_price_policy: 'keep_original_contract_price',
        inherited_from_player_key: preR1Substitution.out_player_key || null,
        inherited_from_name_en: preR1Substitution.out_name_en || null,
        inherited_from_name_zh: preR1Substitution.out_name_zh || null,
        original_contract_price: preR1Substitution.original_contract_price ?? price,
        replacement_pricing_reference: computedPricingDetail
      };
    }
    return {
      ...player,
      player_key: key,
      profile_id: player.profile_id || fact.ranking?.raw?.profile_id || null,
      photo_url: player.photo_url || fact.ranking?.raw?.photo_url || null,
      country_code: player.country_code || fact.ranking?.raw?.country_code || null,
      rank: fact.rank || null,
      points: fact.official_points || player.points || null,
      overall_elo: round2(fact.overall_elo),
      surface_elo: round2(fact.surface_elo),
      peak_elo: round2(fact.peak_elo),
      peak_month: fact.peak_month || null,
      expected_points: actual.expected_points || null,
      expected_round: actual.expected_round || null,
      breakeven_round: breakeven,
      scores,
      total_score: totalScore,
      price,
      tier,
      pricing_detail: pricingDetail
    };
  });
  const expectedPricingSimulation = simulateExpectedPricing({ ...event, players: updatedPlayers }, updatedPlayers);
  updatedPlayers = updatedPlayers.map((player) => {
    const result = expectedRoundMarketPrice(player, event, expectedPricingSimulation);
    const preserveInheritedPrice = player.pre_r1_substitution
      && player.pricing_detail?.contract_price_policy === 'keep_original_contract_price';
    const price = preserveInheritedPrice ? player.price : result.price;
    return {
      ...player,
      expected_points: result.expected_points,
      expected_round: result.expected_round,
      breakeven_round: breakevenRound(price, expectedPricingSimulation.pointTable, expectedPricingSimulation.stages),
      price,
      tier: priceTier(price, event),
      pricing_detail: {
        ...(player.pricing_detail || {}),
        preview_formula_version: 'preview-expected-round-v2',
        preview_generated_at: new Date().toISOString(),
        preview_notes: preserveInheritedPrice
          ? 'Effective Elo bracket simulation was run, but pre-R1 substitution keeps original inherited contract price.'
          : 'Effective Elo bracket simulation; price is primarily mapped from expected points as a share of champion points, with a small strength/form modifier.',
        expected_pricing_effective_elo: result.effective_elo
      }
    };
  });

  return {
    event: {
      ...event,
      pricing_formula: {
        ...WEIGHTS,
        formula_version: 'build-prices-v1',
        generated_at: new Date().toISOString(),
        preview_formula_version: 'preview-expected-round-v2',
        preview_generated_at: new Date().toISOString()
      },
      players: updatedPlayers
    },
    warnings: [...new Set(sourceWarnings)].slice(0, 40)
  };
}

function snapshotFor(active, events, sourceStatus, warnings) {
  return {
    generated_at: new Date().toISOString(),
    preview_formula_version: 'preview-expected-round-v2',
    station_key: active.station_key,
    station_name: active.station_name,
    season: active.season,
    source_status: sourceStatus,
    warnings,
    events: events.map(({ item, event }) => ({
      tour: event.tour || item.tour,
      event_key: event.event_key,
      name: event.name,
      name_zh: event.name_zh,
      level: event.level,
      surface: event.surface,
      draw_size: event.draw_size,
      draw_status: event.draw_status,
      market_status: event.market_status,
      players: (event.players || []).map((player) => ({
        player_key: player.player_key || canonicalPlayerKey(event.tour || item.tour, player),
        name_en: player.name_en,
        name_zh: player.name_zh,
        profile_id: player.profile_id || null,
        photo_url: player.photo_url || null,
        full_body_url: player.full_body_url || player.body_url || player.photo_full_url || null,
        rank: player.rank || null,
        points: player.points || null,
        seed: player.seed || null,
        draw_position: player.draw_position || null,
        first_round: player.first_round || null,
        overall_elo: player.overall_elo || null,
        surface_elo: player.surface_elo || null,
        scores: player.scores || {},
        total_score: player.total_score || scoreTotal(player.scores || {}),
        expected_points: player.expected_points || null,
        expected_round: player.expected_round || null,
        breakeven_round: player.breakeven_round || null,
        price: player.price || 0,
        tier: player.tier || priceTier(player.price || 0, event),
        pricing_detail: player.pricing_detail || null,
        is_qualifier_placeholder: !!player.is_qualifier_placeholder,
        pre_r1_substitution: player.pre_r1_substitution || null,
        qualifier_replacement: player.qualifier_replacement || null
      }))
    }))
  };
}

function collectUnresolvedSources(events) {
  const unresolved = [];
  for (const { event } of events) {
    for (const player of event.players || []) {
      if (player.is_qualifier_placeholder) continue;
      const detail = player.pricing_detail || {};
      const missing = [];
      if (!detail.ranking_source || detail.ranking_source === 'event_file_fallback') missing.push('official_ranking');
      if (!detail.elo_source || detail.elo_source === 'missing_or_event_proxy') missing.push('tennis_abstract_elo');
      if (!missing.length) continue;
      unresolved.push({
        event_key: event.event_key,
        tour: event.tour,
        player_key: player.player_key || canonicalPlayerKey(event.tour, player),
        name_en: player.name_en,
        name_zh: player.name_zh,
        missing
      });
    }
  }
  return unresolved;
}

function defaultPriceVersion(date = new Date()) {
  const yy = String(date.getUTCFullYear()).slice(2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  return Number(`${yy}${mm}${dd}${hh}`);
}

async function main() {
  const args = parseArgs();
  const activeFile = args.active || 'data/manager/active_events.json';
  const snapshotFile = args.snapshot || 'data/manager/market_snapshot.json';
  const photoFile = args.photos || 'data/manager/player_photos.json';
  const snapshotDate = args.date || new Date().toISOString().slice(0, 10);
  const rankingDate = args['ranking-date'] || snapshotDate;
  const priceVersion = args['price-version'] || defaultPriceVersion();
  const priceStatus = args['price-status'] || 'draft';
  const aliasesFile = args.aliases || 'data/manager/player_aliases.json';
  const aliases = await readJson(aliasesFile).catch(() => ({}));
  const sourceOverridesFile = args['source-overrides'] || 'data/manager/player_source_overrides.json';
  const sourceOverrides = await readJson(sourceOverridesFile).catch(() => ({}));
  const strictSources = Boolean(args['strict-sources']);
  const dryRun = Boolean(args['dry-run']) || !process.env.SUPABASE_SERVICE_ROLE_KEY;
  const writeEvents = args['no-write-events'] ? false : true;
  const warnings = [];

  const { active, events } = await loadActiveStation(activeFile);
  const tours = [...new Set(events.map(({ item, event }) => event.tour || item.tour).filter(Boolean))];
  const rankingRowsByTour = new Map();
  const eloRowsByTour = new Map();
  const sourceStatus = {};

  for (const tour of tours) {
    const rankingRows = await loadRankingRows({ tour, args, warnings, rankingDate, snapshotDate });
    const eloRows = await loadEloRows({ tour, args, warnings, snapshotDate });
    rankingRowsByTour.set(tour, rankingRows);
    eloRowsByTour.set(tour, eloRows);
    sourceStatus[tour] = {
      ranking_rows: rankingRows.length,
      elo_rows: eloRows.length,
      ranking_source: args[`${tour.toLowerCase()}-ranking-file`] ? 'file' : (args[`${tour.toLowerCase()}-ranking-url`] || RANKING_URLS[tour]),
      elo_source: args[`${tour.toLowerCase()}-elo-file`] ? 'file' : ELO_URLS[tour]
    };
  }

  const generatedEvents = [];
  for (const entry of events) {
    const tour = entry.event.tour || entry.item.tour;
    const { event, warnings: eventWarnings } = updateEventPrices(
      entry.event,
      rankingRowsByTour.get(tour) || [],
      eloRowsByTour.get(tour) || [],
      warnings,
      snapshotDate,
      aliases,
      sourceOverrides
    );
    warnings.push(...eventWarnings);
    generatedEvents.push({ ...entry, event });
  }

  if (writeEvents) {
    for (const { item, event } of generatedEvents) {
      await writeJson(`data/manager/${item.data_file}`, event);
    }
  }

  const snapshot = snapshotFor(active, generatedEvents, sourceStatus, [...new Set(warnings)]);
  await writeJson(snapshotFile, snapshot);
  const unresolvedSources = collectUnresolvedSources(generatedEvents);
  const unresolvedFile = `outputs/manager-sync/${active.station_key}-source-unresolved.json`;
  await writeJson(unresolvedFile, {
    generated_at: new Date().toISOString(),
    station_key: active.station_key,
    unresolved: unresolvedSources
  });
  if (strictSources && unresolvedSources.length) {
    throw new Error(`Source data unresolved for ${unresolvedSources.length} non-qualifier players. See ${unresolvedFile}.`);
  }

  const photos = await readJson(photoFile).catch(() => ({ players: {} }));
  const payload = buildStationPayload({
    active,
    events: generatedEvents,
    photoMap: photos.players || {},
    priceVersion,
    priceStatus
  });
  payload.priceVersionRow.formula_version = 'build-prices-v1';
  payload.priceVersionRow.weights = WEIGHTS;
  payload.priceVersionRow.generated_from = {
    ...payload.priceVersionRow.generated_from,
    snapshot_file: snapshotFile,
    source_status: sourceStatus,
    warnings: [...new Set(warnings)]
  };

  if (dryRun) {
    const out = `outputs/manager-sync/${active.station_key}-build-prices.json`;
    await writeJson(out, {
      snapshot,
      rankingRows: Object.fromEntries([...rankingRowsByTour.entries()].map(([tour, rows]) => [tour, rows])),
      eloRows: Object.fromEntries([...eloRowsByTour.entries()].map(([tour, rows]) => [tour, rows])),
      unresolvedSources,
      payload
    });
    console.log(`Dry run. Wrote ${snapshotFile} and ${out}`);
    console.log(`events=${payload.eventRows.length} market_players=${payload.eventPlayerRows.length} price_rows=${payload.priceRows.length}`);
    if (unresolvedSources.length) console.log(`unresolved_sources=${unresolvedSources.length} (${unresolvedFile})`);
    for (const warning of [...new Set(warnings)].slice(0, 20)) console.log(`warning: ${warning}`);
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) console.log('Set SUPABASE_SERVICE_ROLE_KEY to sync ranking/Elo/prices to Supabase.');
    return;
  }

  const client = new SupabaseRestClient({ dryRun: false });
  const rankingRows = [...rankingRowsByTour.values()].flat();
  const rankingRowsForSync = uniqueRankingRowsForSync(rankingRows);
  const eloRows = [...eloRowsByTour.values()].flat();
  await replaceRankingSnapshots(client, rankingRowsForSync);
  await upsertCompat(client, 'tour_manager_ranking_snapshots', rankingRowsForSync, 'tour,ranking_type,ranking_date,player_key');
  await upsertCompat(client, 'tour_manager_elo_snapshots', eloRows, 'tour,snapshot_date,player_key');
  await upsertCompat(client, 'tour_manager_events', payload.eventRows, 'event_key');
  await upsertCompat(client, 'tour_manager_players', payload.playerRows, 'tour,player_key');
  await upsertCompat(client, 'tour_manager_draw_entries', payload.drawRows, 'event_key,draw_version,draw_position');
  await upsertCompat(client, 'tour_manager_event_players', payload.eventPlayerRows, 'event_key,player_key');

  const versionRows = await upsertCompat(
    client,
    'tour_manager_price_versions',
    [payload.priceVersionRow],
    'station_key,season,version'
  );
  const priceVersionId = versionRows[0]?.id;
  if (!priceVersionId) throw new Error('Supabase did not return price_version id.');
  await upsertCompat(
    client,
    'tour_manager_price_version_players',
    payload.priceRows.map((row) => ({ ...row, price_version_id: priceVersionId })),
    'price_version_id,event_key,player_key'
  );

  console.log(`Synced build-prices for ${active.station_key}`);
  console.log(`ranking_rows=${rankingRowsForSync.length}/${rankingRows.length} elo_rows=${eloRows.length} price_rows=${payload.priceRows.length}`);
  for (const warning of [...new Set(warnings)].slice(0, 20)) console.log(`warning: ${warning}`);
}

function uniqueRankingRowsForSync(rows) {
  const rankKeys = new Set();
  const playerKeys = new Set();
  const out = [];
  let omitted = 0;
  for (const row of rows) {
    const rankingType = row.ranking_type || 'singles';
    const rankKey = [row.tour, rankingType, row.ranking_date, row.rank].join('|');
    const playerKey = [row.tour, rankingType, row.ranking_date, row.player_key].join('|');
    if (rankKeys.has(rankKey) || playerKeys.has(playerKey)) {
      omitted += 1;
      continue;
    }
    rankKeys.add(rankKey);
    playerKeys.add(playerKey);
    out.push(row);
  }
  if (omitted) console.log(`ranking-sync: omitted ${omitted} duplicate ranking rows for current schema compatibility.`);
  return out;
}

async function replaceRankingSnapshots(client, rows) {
  const keys = new Set();
  for (const row of rows) {
    if (!row.tour || !row.ranking_date) continue;
    keys.add([row.tour, row.ranking_type || 'singles', row.ranking_date].join('|'));
  }
  for (const key of keys) {
    const [tour, rankingType, rankingDate] = key.split('|');
    await client.delete('tour_manager_ranking_snapshots', {
      tour: `eq.${tour}`,
      ranking_type: `eq.${rankingType}`,
      ranking_date: `eq.${rankingDate}`
    });
  }
}

async function upsertCompat(client, table, rows, conflict, options = {}) {
  if (!rows.length) return [];
  let current = rows.map((row) => ({ ...row }));
  const omitted = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const result = await client.upsert(table, current, conflict, options);
      if (omitted.length) console.log(`schema-compat: ${table} omitted columns: ${omitted.join(', ')}`);
      return result;
    } catch (error) {
      const column = String(error.message).match(/Could not find the '([^']+)' column/)?.[1];
      if (!column || !current.some((row) => Object.hasOwn(row, column))) throw error;
      current = current.map((row) => {
        const clone = { ...row };
        delete clone[column];
        return clone;
      });
      omitted.push(column);
    }
  }
  throw new Error(`${table} upsert failed after schema compatibility retries.`);
}

await main();
