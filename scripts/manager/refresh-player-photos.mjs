#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalPlayerKey,
  nowIso,
  officialProfileUrl,
  parseArgs,
  readJson,
  slugify,
  writeJson
} from './lib/manager-utils.mjs';
import { loadActiveStation } from './lib/station-payload.mjs';

const args = parseArgs();
const activeFile = args.active || 'data/manager/active_events.json';
const photoFile = args.photos || 'data/manager/player_photos.json';
const write = Boolean(args.write);
const download = args.download !== false && args.download !== 'false';
const force = Boolean(args.force);
const liveTennisPhotoMaps = new Map();
const LIVE_TENNIS_RANK_COLUMNS = [
  'c_rank', 'point', 'full_name', 'eng_name', 'change', 'f_rank', 'highest', 'alt_point',
  'flop', 'w_point', 'engname', 'name_for_search', 'age', 'birth', 'nation', 'noc_rank',
  'id', 'ioc', 'titles', 'tour_c', 'mand_0', 'streak', 'prize', 'win', 'lose', 'win_r',
  'q_tour', 'q_point', 'w_in', 'w_tour', 'partner', 'next_oppo', 'next_h2h', 'predict_R64',
  'predict_R32', 'predict_R16', 'predict_QF', 'predict_SF', 'predict_F', 'predict_W'
];

const { active, events } = await loadActiveStation(activeFile);
const photoData = await readJson(photoFile).catch(() => ({
  updated_at: nowIso(),
  fallbacks: {
    ATP: 'assets/manager/players/fallback-atp.svg',
    WTA: 'assets/manager/players/fallback-wta.svg'
  },
  players: {}
}));

const updates = [];
const misses = [];

for (const { item, event } of events) {
  const tour = event.tour || item.tour;
  playerLoop:
  for (const player of event.players || []) {
    const playerKey = canonicalPlayerKey(tour, player);
    if (player.is_qualifier_placeholder) {
      setMissing(photoData, playerKey, tour, 'qualifier placeholder');
      continue;
    }

    const existing = photoData.players[playerKey] || photoData.players[player.player_key] || {};
    if (!force && ['ready', 'manual', 'verified'].includes(String(existing.status || '').toLowerCase())) {
      continue;
    }

    const eventCandidates = await resolveEventPhotoCandidates(player, tour);
    if (tour === 'WTA') eventCandidates.push(...await resolveWtaPhotos(player));

    let synced = false;
    for (const result of uniqueCandidates(eventCandidates)) {
      const localPath = download
        ? await downloadPhoto(result.url, tour, playerKey, result.extension).catch(() => null)
        : null;
      if (download && !localPath) continue;
      const row = {
        photo_url: localPath || result.url,
        photo_source: result.url,
        source: result.source,
        status: 'ready',
        storage_path: localPath,
        updated_at: nowIso()
      };
      photoData.players[playerKey] = row;
      updates.push({ tour, player_key: playerKey, name: player.name_en || player.name_zh, photo_url: row.photo_url });
      synced = true;
      continue playerLoop;
    }
    if (synced) continue;

    if (tour === 'WTA') {
      const candidates = await resolveWtaPhotos(player);
      for (const result of uniqueCandidates(candidates)) {
        const localPath = download
          ? await downloadPhoto(result.url, tour, playerKey, result.extension).catch(() => null)
          : null;
        if (download && !localPath) continue;
        const row = {
          photo_url: localPath || result.url,
          photo_source: result.url,
          source: result.source,
          status: 'ready',
          storage_path: localPath,
          updated_at: nowIso()
        };
        photoData.players[playerKey] = row;
        updates.push({ tour, player_key: playerKey, name: player.name_en || player.name_zh, photo_url: row.photo_url });
        continue playerLoop;
      }
    }

    if (tour === 'ATP' && player.profile_id) {
      const alias = `https://www.atptour.com/-/media/alias/player-gladiator-headshot/${player.profile_id}`;
      const localPath = download ? await downloadPhoto(alias, tour, playerKey, 'jpg').catch(() => null) : null;
      if (localPath || !download) {
        photoData.players[playerKey] = {
          photo_url: localPath || alias,
          photo_source: alias,
          source: 'ATP official alias',
          status: localPath ? 'ready' : 'remote',
          storage_path: localPath,
          updated_at: nowIso()
        };
        updates.push({ tour, player_key: playerKey, name: player.name_en || player.name_zh, photo_url: localPath || alias });
        continue;
      }
      misses.push({ tour, player_key: playerKey, name: player.name_en || player.name_zh, reason: 'ATP alias not downloaded' });
    }

    setMissing(photoData, playerKey, tour, 'no official profile id/photo');
    misses.push({ tour, player_key: playerKey, name: player.name_en || player.name_zh, reason: 'missing photo' });
  }
}

photoData.updated_at = nowIso();

if (write) {
  await writeJson(photoFile, photoData);
}

const out = {
  station_key: active.station_key,
  updated: updates.length,
  missing_or_pending: misses.length,
  updates,
  missing_or_pending_items: misses
};
await writeJson(`outputs/manager-sync/${active.station_key}-photo-refresh.json`, out);

console.log(`${write ? 'Updated' : 'Dry run'} ${photoFile}`);
console.log(`ready_updates=${updates.length} missing_or_pending=${misses.length}`);
console.log(`report=outputs/manager-sync/${active.station_key}-photo-refresh.json`);

function setMissing(photoData, playerKey, tour, source) {
  if (!photoData.players[playerKey]) {
    photoData.players[playerKey] = {
      photo_url: photoData.fallbacks?.[tour] || null,
      photo_source: source,
      status: 'missing',
      storage_path: null,
      updated_at: nowIso()
    };
  }
}

async function resolveWtaPhotos(player) {
  const candidates = [];
  if (player.profile_id) {
    const headshotUrl = `https://wtafiles.blob.core.windows.net/images/headshots/${player.profile_id}.jpg`;
    if (await imageExists(headshotUrl)) {
      candidates.push({ url: headshotUrl, source: 'WTA official headshot blob', extension: 'jpg' });
    }
  }

  const profileUrl = officialProfileUrl('WTA', player);
  if (!profileUrl) return candidates;
  const res = await fetch(profileUrl).catch(() => null);
  if (!res?.ok) return candidates;
  const html = await res.text();
  const header = html.match(/profile-header__headshot-wrap[\s\S]{0,2500}?src="([^"]+)"/i)?.[1];
  if (header) {
    candidates.push({ url: decodeHtml(header), source: profileUrl, extension: extensionFromUrl(header) });
  }
  const jsonLd = html.match(/"image"\s*:\s*"([^"]+)"/i)?.[1];
  if (jsonLd) {
    candidates.push({ url: decodeHtml(jsonLd), source: profileUrl, extension: extensionFromUrl(jsonLd) });
  }
  return candidates;
}

async function resolveEventPhotoCandidates(player, tour) {
  const candidates = [];
  const fields = [
    ['full_body_url', 'event full-body photo'],
    ['body_url', 'event full-body photo'],
    ['photo_full_url', 'event full-body photo'],
    ['photo_url', 'event player photo'],
    ['profile_image_url', 'event player photo']
  ];
  for (const [field, source] of fields) {
    const url = String(player[field] || '');
    if (!/^https?:\/\//i.test(url) || /fallback|placeholder/i.test(url)) continue;
    if (await imageExists(url)) candidates.push({ url, source, extension: extensionFromUrl(url) });
  }
  if (tour === 'ATP' && player.profile_id && !/^QUAL/i.test(String(player.profile_id))) {
    const url = `https://static.live-tennis.cn/pic/ts/${player.profile_id}`;
    if (await imageExists(url)) candidates.push({ url, source: 'Live Tennis player photo', extension: 'jpg' });
  }
  if (tour === 'WTA') {
    const url = await liveTennisPhotoUrlFor(tour, player);
    if (url && await imageExists(url)) candidates.push({ url, source: 'Live Tennis WTA ranking photo', extension: 'jpg' });
  }
  return candidates;
}

async function liveTennisPhotoUrlFor(tour, player) {
  const map = await loadLiveTennisPhotoMap(tour);
  const keys = [player.name_en, player.name, player.name_zh].filter(Boolean).map((value) => slugify(value));
  for (const key of keys) {
    if (map.has(key)) return map.get(key);
  }
  return '';
}

async function loadLiveTennisPhotoMap(tour) {
  if (liveTennisPhotoMaps.has(tour)) return liveTennisPhotoMaps.get(tour);
  const map = new Map();
  liveTennisPhotoMaps.set(tour, map);
  const tourPath = tour === 'WTA' ? 'wta' : 'atp';
  const pageUrl = `https://www.live-tennis.cn/zh/rank/${tourPath}/s/year`;
  try {
    const pageRes = await fetch(pageUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 tour-manager-photo-sync/1.0'
      }
    });
    if (!pageRes.ok) return map;
    const cookieHeader = cookieHeaderFromHeaders(pageRes.headers);
    const html = await pageRes.text();
    const csrf = html.match(/name=["']csrf-token["']\s+content=["']([^"']+)/i)?.[1] || '';
    const res = await fetch(`${pageUrl}/query`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/javascript, */*; q=0.01',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        cookie: cookieHeader,
        referer: pageUrl,
        'user-agent': 'Mozilla/5.0 tour-manager-photo-sync/1.0',
        'x-csrf-token': csrf,
        'x-requested-with': 'XMLHttpRequest'
      },
      body: liveTennisRankingBody()
    });
    if (!res.ok) return map;
    const payload = await res.json();
    for (const row of Array.isArray(payload?.data) ? payload.data : []) {
      const id = row.id ? String(row.id) : '';
      const name = row.eng_name || row.engname || row.full_name || row.name_for_search;
      if (!id || !name) continue;
      map.set(slugify(name), `https://static.live-tennis.cn/pic/ts/${id}`);
    }
  } catch {
    return map;
  }
  return map;
}

function liveTennisRankingBody() {
  const params = new URLSearchParams({
    draw: '1',
    start: '0',
    length: '500',
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

function cookieHeaderFromHeaders(headers) {
  const getSetCookie = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const raw = getSetCookie.length ? getSetCookie : String(headers.get('set-cookie') || '').split(/,(?=[^;,]+=)/);
  return raw
    .map((item) => String(item || '').split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return (candidates || []).filter((candidate) => {
    const url = String(candidate?.url || '');
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

async function imageExists(url) {
  const res = await fetch(url, { method: 'HEAD' }).catch(() => null);
  if (res?.ok && String(res.headers.get('content-type') || '').startsWith('image/')) return true;
  const get = await fetch(url, { headers: { range: 'bytes=0-64' } }).catch(() => null);
  return Boolean(get?.ok) && String(get.headers.get('content-type') || '').startsWith('image/');
}

async function downloadPhoto(url, tour, playerKey, extension) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Photo download failed ${res.status}: ${url}`);
  const contentType = String(res.headers.get('content-type') || '');
  if (!contentType.startsWith('image/')) {
    throw new Error(`Photo URL did not return image content: ${url}`);
  }
  const ext = extension || extensionFromContentType(contentType);
  const localPath = `assets/manager/players/${tour.toLowerCase()}/${slugify(playerKey)}.${ext}`;
  const target = path.resolve(process.cwd(), localPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await res.arrayBuffer()));
  return localPath;
}

function extensionFromUrl(url) {
  const clean = String(url).split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'png';
  if (clean.endsWith('.webp')) return 'webp';
  return 'jpg';
}

function extensionFromContentType(contentType) {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
