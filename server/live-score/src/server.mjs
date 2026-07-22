import http from 'node:http';
import crypto from 'node:crypto';
import { loadConfig } from './config.mjs';
import { JsonCache } from './cache.mjs';
import { ApiTennisClient } from './api-tennis-client.mjs';
import { LivePoller } from './poller.mjs';
import { ChineseLocalizer } from './localizer.mjs';

const config = loadConfig();
const cache = new JsonCache(config.cacheFile);
await cache.load();
const client = new ApiTennisClient({ ...config, cache });
const localizer = new ChineseLocalizer({ cache, url: config.localizationUrl, ttlMs: config.localizationTtlMs, catalogFile: config.translationCatalogFile });
const poller = new LivePoller({ client, cache, config, localizer });
const streams = new Set();

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && config.origins.has(origin)) res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'Content-Type, If-None-Match');
}

function json(req, res, status, body, maxAge = 0) {
  const text = JSON.stringify(body);
  const etag = `"${crypto.createHash('sha1').update(text).digest('hex')}"`;
  cors(req, res);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', `public, max-age=${maxAge}, stale-while-revalidate=60`);
  res.setHeader('etag', etag);
  res.setHeader('x-content-type-options', 'nosniff');
  if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();
  res.writeHead(status).end(text);
}

function errorJson(req, res, error) {
  console.error('[request]', error.message);
  json(req, res, error.statusCode || 500, { error: error.publicCode || 'internal_error', message: error.statusCode === 503 ? error.message : '数据服务暂时不可用' });
}

async function cachedDetail(key, ttl, loader) {
  const saved = cache.data.details[key];
  if (saved && Date.now() - saved.savedAt < ttl) return saved.value;
  const value = await loader();
  cache.data.details[key] = { savedAt: Date.now(), value };
  cache.scheduleWrite();
  return value;
}

function liveStatistics(matchId) {
  const match = (cache.data.live || []).find(item => String(item.event_key) === String(matchId));
  return Array.isArray(match?.statistics) && match.statistics.length ? match.statistics : null;
}

function liveMatch(matchId) {
  return (cache.data.live || []).find(item => String(item.event_key) === String(matchId));
}

function addMatchPlayers(index, match) {
  const pairs = [
    [match.first_player_key, match.event_first_player, match.event_first_player_country],
    [match.second_player_key, match.event_second_player, match.event_second_player_country]
  ];
  for (const [id, name, country] of pairs) {
    if (id && name) index.set(String(id), { player_key: String(id), player_name: name, player_country: country || '', player_rank: null });
  }
}

async function searchPlayers(query) {
  const index = new Map();
  (cache.data.fixtures?.items || []).forEach(match => addMatchPlayers(index, match));
  (cache.data.live || []).forEach(match => addMatchPlayers(index, match));
  const tours = await Promise.all(['ATP', 'WTA'].map(tour =>
    cachedDetail(`standings:${tour}`, 24 * 60 * 60_000, () => client.standings(tour)).catch(() => [])
  ));
  tours.flat().forEach(item => {
    const id = item.player_key;
    const name = item.player || item.player_name;
    if (id && name) index.set(String(id), { player_key: String(id), player_name: name, player_country: item.country || item.player_country || '', player_rank: Number(item.place || item.player_rank) || null });
  });
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return [...index.values()].map(item => localizer.localizePlayerEntry(item))
    .filter(player => terms.every(term => `${player.player_name} ${player.player_name_en}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => query ? a.player_name.localeCompare(b.player_name) : (a.player_rank || 99999) - (b.player_rank || 99999) || a.player_name.localeCompare(b.player_name))
    .slice(0, 30);
}

function compactEvent(item) {
  return {
    event_key: item.event_key,
    event_date: item.event_date,
    event_time: item.event_time,
    event_first_player: item.event_first_player,
    first_player_key: item.first_player_key,
    event_second_player: item.event_second_player,
    second_player_key: item.second_player_key,
    event_final_result: item.event_final_result,
    event_winner: item.event_winner,
    event_status: item.event_status,
    event_type_type: item.event_type_type,
    tournament_name: item.tournament_name,
    tournament_key: item.tournament_key,
    tournament_round: item.tournament_round,
    tournament_season: item.tournament_season,
    scores: item.scores || []
  };
}

function compactH2H(result) {
  if (Array.isArray(result)) return result.map(compactEvent);
  return {
    H2H: (result?.H2H || []).map(compactEvent),
    firstPlayerResults: (result?.firstPlayerResults || []).map(compactEvent),
    secondPlayerResults: (result?.secondPlayerResults || []).map(compactEvent)
  };
}

poller.on('snapshot', snapshot => {
  const frame = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
  streams.forEach(res => res.write(frame));
});

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { cors(req, res); return res.writeHead(204).end(); }
    if (req.method !== 'GET') return json(req, res, 405, { error: 'method_not_allowed' });
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') return json(req, res, 200, { ok: true, apiConfigured: Boolean(config.apiKey), updatedAt: poller.snapshot.updatedAt });
    if (url.pathname === '/api/v1/live/today') return json(req, res, 200, poller.snapshot, poller.snapshot.hasLive ? 2 : 30);
    if (url.pathname === '/api/v1/live/day') {
      const date = url.searchParams.get('date') || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(req, res, 400, { error: 'invalid_date' });
      const snapshot = date === poller.snapshot.date ? poller.snapshot : cache.data.scheduleHistory?.[date];
      if (!snapshot) return json(req, res, 404, { error: 'schedule_not_saved', message: '该日期赛程尚未保存' });
      return json(req, res, 200, { ...snapshot, availableDates: poller.historyDates(poller.snapshot.date), activeDate: poller.snapshot.date }, 60);
    }
    if (url.pathname === '/api/v1/live/stream') {
      cors(req, res);
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`event: snapshot\ndata: ${JSON.stringify(poller.snapshot)}\n\n`);
      streams.add(res);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25_000);
      req.on('close', () => { clearInterval(heartbeat); streams.delete(res); });
      return;
    }
    const statsMatch = url.pathname.match(/^\/api\/v1\/matches\/([^/]+)\/stats$/);
    if (statsMatch) {
      const matchId = statsMatch[1];
      const match = liveMatch(matchId);
      const statistics = liveStatistics(matchId) || await cachedDetail(`stats:${matchId}`, 30_000, () => client.statistics(matchId));
      return json(req, res, 200, {
        matchId,
        firstPlayerId: match?.first_player_key ? String(match.first_player_key) : '',
        secondPlayerId: match?.second_player_key ? String(match.second_player_key) : '',
        statistics
      }, 15);
    }
    if (url.pathname === '/api/v1/h2h') {
      const first = url.searchParams.get('first');
      const second = url.searchParams.get('second');
      if (!first || !second) return json(req, res, 400, { error: 'player_ids_required' });
      const result = await cachedDetail(`h2h:${first}:${second}`, 6 * 60 * 60_000, () => client.h2h(first, second));
      const localized = compactH2H(result);
      localized.H2H = (localized.H2H || []).map(item => localizer.localizeEvent(item));
      return json(req, res, 200, localized, 300);
    }
    if (url.pathname === '/api/v1/players/search') {
      const query = (url.searchParams.get('q') || '').trim();
      return json(req, res, 200, await searchPlayers(query), 3600);
    }
    const historyMatch = url.pathname.match(/^\/api\/v1\/players\/([^/]+)\/history$/);
    if (historyMatch) {
      const year = Math.min(2100, Math.max(2000, Number(url.searchParams.get('year') || new Date().getFullYear())));
      const result = await cachedDetail(`history:${historyMatch[1]}:${year}`, 24 * 60 * 60_000, () => client.playerHistory(historyMatch[1], `${year}-01-01`, `${year}-12-31`));
      return json(req, res, 200, (result || []).map(compactEvent).map(item => localizer.localizeEvent(item)), 3600);
    }
    return json(req, res, 404, { error: 'not_found' });
  } catch (error) { errorJson(req, res, error); }
});

server.listen(config.port, config.host, () => {
  console.log(`[live-score] listening on http://${config.host}:${config.port}`);
  poller.start();
});

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  poller.stop();
  await cache.flush().catch(() => {});
  streams.forEach(stream => stream.destroy());
  streams.clear();
  server.close(() => process.exit(0));
});
