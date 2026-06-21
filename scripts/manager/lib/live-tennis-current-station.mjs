import { canonicalPlayerKey, normalizeName, slugify } from './manager-utils.mjs';

export const LIVE_TENNIS_BASE_URL = 'https://www.live-tennis.cn';

export function decodeHtml(value = '') {
  return String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

export function cleanText(value = '') {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function comparableText(value = '') {
  return cleanText(value)
    .toLowerCase()
    .replace(/\bpowered\s+by\b.*$/i, '')
    .replace(/\bopen\b/gi, '')
    .replace(/[\s'’`.\-_/()]+/g, '')
    .trim();
}

export function attr(value = '', name) {
  const match = String(value || '').match(new RegExp(`${name}=["']([^"']*)["']`, 'i'));
  return match ? decodeHtml(match[1]) : '';
}

export async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9',
      'user-agent': 'Mozilla/5.0 tour-manager-current-station/1.0'
    }
  });
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  return res.text();
}

export function extractLiveTennisDrawId(url = '') {
  return String(url || '').match(/live-tennis\.cn\/zh\/draw\/([^/]+)\/(\d{4})/)?.[1] || '';
}

export function liveTennisDrawUrl(drawId, season) {
  return `${LIVE_TENNIS_BASE_URL}/zh/draw/${drawId}/${season}`;
}

export function liveTennisDrawAjaxUrl(drawId, season) {
  return `${LIVE_TENNIS_BASE_URL}/zh/draw/ajax/${drawId}/${season}/device/0/horizontal/true`;
}

export function eventNameNeedles(event) {
  return [event.name_zh, event.short_name, event.city, event.name]
    .filter(Boolean)
    .map(comparableText)
    .filter(Boolean);
}

export function recordMatchesEventName(event, record) {
  const haystack = comparableText(record.event_name || '');
  if (!haystack) return false;
  return eventNameNeedles(event).some((needle) => needle && haystack.includes(needle));
}

export function eventTourPart(event) {
  return String(event.tour || '').toUpperCase() === 'ATP' ? 'MS' : 'WS';
}

export function bracketSizeFor(drawSize = 32) {
  const n = Number(drawSize) || 32;
  if (n <= 32) return 32;
  if (n <= 64) return 64;
  return 128;
}

export function roundKeysForEvent(event) {
  const size = bracketSizeFor(event.draw_size);
  if (size >= 128) return ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', 'W'];
  if (size >= 64) return ['R64', 'R32', 'R16', 'QF', 'SF', 'F', 'W'];
  return ['R32', 'R16', 'QF', 'SF', 'F', 'W'];
}

export function roundOrder(event, roundKey) {
  const keys = roundKeysForEvent(event);
  const idx = keys.indexOf(String(roundKey || '').toUpperCase());
  return idx >= 0 ? idx + 1 : null;
}

export function normalizeRoundKey(rawRound = '', event = {}) {
  const raw = cleanText(rawRound).toUpperCase();
  const keys = roundKeysForEvent(event);
  if (/\bR128\b|1\/64|ROUND\s*OF\s*128/.test(raw)) return 'R128';
  if (/\bR64\b|1\/32|ROUND\s*OF\s*64/.test(raw)) return 'R64';
  if (/\bR32\b|1\/16|ROUND\s*OF\s*32/.test(raw)) return 'R32';
  if (/\bR16\b|1\/8|ROUND\s*OF\s*16/.test(raw)) return 'R16';
  if (/\bQF\b|QUARTER|1\/4|四分之一|八强/.test(raw)) return 'QF';
  if (/\bSF\b|SEMI|半决/.test(raw)) return 'SF';
  if (/\bF\b|FINAL|决赛/.test(raw)) return 'F';
  if (/^1R$|ROUND\s*1|第一轮|首轮/.test(raw)) return keys[0];
  if (/^2R$|ROUND\s*2|第二轮/.test(raw)) return keys[1] || keys[0];
  if (/^3R$|ROUND\s*3|第三轮/.test(raw)) return keys[2] || keys[keys.length - 2];
  return keys.find((key) => raw.includes(key)) || keys[0];
}

export function addMinutes(value, minutes) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + minutes * 60000).toISOString();
}

export function minIso(values) {
  const clean = values.map((v) => new Date(v)).filter((d) => !Number.isNaN(d.getTime()));
  if (!clean.length) return null;
  return new Date(Math.min(...clean.map((d) => d.getTime()))).toISOString();
}

export function maxIso(values) {
  const clean = values.map((v) => new Date(v)).filter((d) => !Number.isNaN(d.getTime()));
  if (!clean.length) return null;
  return new Date(Math.max(...clean.map((d) => d.getTime()))).toISOString();
}

export function profilePhotoUrl(profileId) {
  return profileId && !['0', 'QUAL', 'TBD', 'COMEUP'].includes(String(profileId))
    ? `https://static.live-tennis.cn/pic/ts/${profileId}`
    : null;
}

export async function discoverDrawUrls(events, season) {
  const direct = new Map();
  for (const { event } of events) {
    const url = (event.source_urls || []).find((item) => /live-tennis\.cn\/zh\/draw\//.test(String(item)));
    if (url) direct.set(event.event_key, url);
  }

  const missing = events.filter(({ event }) => !direct.has(event.event_key));
  if (!missing.length) return direct;

  let html = '';
  try {
    html = await fetchText(`${LIVE_TENNIS_BASE_URL}/zh/draw/list`);
  } catch {
    return direct;
  }

  const anchors = [];
  for (const match of html.matchAll(/<a\b([^>]*)class=["'][^"']*cMenuDrawTour[^"']*["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = `${match[1]} ${match[2]}`;
    const href = attr(attrs, 'href');
    const text = cleanText(match[3]);
    const raw = match[0] || '';
    if (href && href.includes(`/${season}`)) anchors.push({ href, text, raw });
  }

  for (const { event } of missing) {
    const names = eventNameNeedles(event);
    const tourNeedle = event.tour === 'ATP' ? /\[M|ATP|男/i : /\[W|WTA|女/i;
    const found = anchors.find((anchor) => {
      const tourHaystack = `${anchor.raw} ${anchor.text}`;
      const nameHaystack = comparableText(anchor.text);
      return tourNeedle.test(tourHaystack) && names.some((name) => name && nameHaystack.includes(name));
    });
    if (found) direct.set(event.event_key, found.href);
  }
  return direct;
}

export async function fetchDrawPlayers(event, drawUrl) {
  const drawId = extractLiveTennisDrawId(drawUrl);
  if (!drawId) return { players: [], source_url: drawUrl, warnings: ['missing live-tennis draw id'] };
  const ajaxUrl = liveTennisDrawAjaxUrl(drawId, event.season || new Date().getUTCFullYear());
  const html = await fetchText(ajaxUrl);
  return {
    players: parseDrawPlayersFromAjax(html, event, ajaxUrl),
    source_url: ajaxUrl,
    warnings: []
  };
}

export function parseDrawPlayersFromAjax(html, event, sourceUrl = '') {
  const part = eventTourPart(event);
  const partStart = html.search(new RegExp(`<div\\b[^>]*class=["'][^"']*cDrawPart[^"']*["'][^>]*data-id=["']${part}["']`, 'i'));
  if (partStart < 0) return [];
  const nextPart = html.slice(partStart + 1).search(/<div\b[^>]*class=["'][^"']*cDrawPart[^"']*["'][^>]*data-id=["']/i);
  const segment = nextPart >= 0 ? html.slice(partStart, partStart + 1 + nextPart) : html.slice(partStart);
  const slots = [];

  for (const row of segment.matchAll(/<tr>\s*<td[^>]*class=["'][^"']*cDrawSeq[^"']*["'][^>]*>\s*(\d+)\s*<\/td>([\s\S]*?)<\/tr>/gi)) {
    const drawPosition = Number(row[1]);
    const rowHtml = row[2];
    const firstGrid = rowHtml.match(/<td[^>]*class=["'][^"']*cDrawGrid[^"']*cDrawGridSideBorder[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)
      || rowHtml.match(/<td[^>]*class=["'][^"']*cDrawGrid[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    if (!firstGrid) continue;
    const pname = firstGrid[1].match(/<pname\b([^>]*)>([\s\S]*?)<\/pname>/i);
    if (!pname) continue;
    const attrs = pname[1];
    const inner = pname[2];
    const profileId = attr(attrs, 'data-id');
    const nameEnRaw = normalizeName(attr(attrs, 'alt'));
    const seedRaw = inner.match(/<span[^>]*class=["']?entrySign["']?[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '';
    const seedLabel = cleanText(seedRaw);
    const nameZh = cleanText(inner.replace(/<span[^>]*class=["']?entrySign["']?[^>]*>[\s\S]*?<\/span>/i, ''));
    const countryCode = firstGrid[1].match(/class=playerFlag[^>]*alt=["']([^"']+)/i)?.[1] || null;
    const isBye = profileId === '0' || /^(bye|轮空)$/i.test(nameEnRaw) || nameZh === '轮空';
    const isQualifier = profileId === 'QUAL' || /qualifier|资格/.test(`${nameEnRaw} ${nameZh}`.toLowerCase());

    slots.push({
      draw_position: drawPosition,
      profile_id: profileId || null,
      name_en: nameEnRaw,
      name_zh: nameZh,
      country_code: countryCode,
      seed_label: seedLabel,
      seed: /^\d+$/.test(seedLabel) ? Number(seedLabel) : null,
      entry_type: isQualifier ? 'qualifier' : (seedLabel === 'W' ? 'wildcard' : 'direct_acceptance'),
      is_bye: isBye,
      is_qualifier_placeholder: isQualifier
    });
  }

  const byPosition = new Map(slots.map((slot) => [slot.draw_position, slot]));
  let qualifierIndex = 0;
  const players = [];
  for (const slot of slots) {
    if (slot.is_bye) continue;
    const pairPosition = slot.draw_position % 2 === 1 ? slot.draw_position + 1 : slot.draw_position - 1;
    const opponent = byPosition.get(pairPosition);
    const firstRound = !opponent || opponent.is_bye
      ? 'BYE'
      : (opponent.name_zh || opponent.name_en || 'TBD');
    const isQualifier = slot.is_qualifier_placeholder;
    if (isQualifier) qualifierIndex += 1;
    const nameEn = isQualifier ? `Qualifier Q${qualifierIndex}` : slot.name_en;
    const nameZh = isQualifier ? `资格赛选手 Q${qualifierIndex}` : (slot.name_zh || slot.name_en);
    const player = {
      name_en: nameEn,
      name_zh: nameZh,
      profile_id: isQualifier ? `QUAL-${qualifierIndex}` : slot.profile_id,
      country_code: isQualifier ? null : slot.country_code,
      seed: slot.seed,
      entry_type: slot.entry_type,
      draw_position: slot.draw_position,
      first_round: firstRound,
      path_note: firstRound === 'BYE' ? '首轮轮空，直接进入下一轮。' : `首轮对阵 ${firstRound}。`,
      photo_url: isQualifier ? null : profilePhotoUrl(slot.profile_id),
      is_qualifier_placeholder: isQualifier,
      source: sourceUrl || 'live-tennis.cn draw ajax'
    };
    player.player_key = canonicalPlayerKey(event.tour, player);
    players.push(player);
  }

  return players.sort((a, b) => Number(a.draw_position || 0) - Number(b.draw_position || 0));
}

export function mergeDrawPlayers(event, parsedPlayers, sourceUrl = '') {
  const existing = event.players || [];
  const byKey = new Map();
  const byProfile = new Map();
  const byName = new Map();
  for (const player of existing) {
    const key = player.player_key || canonicalPlayerKey(event.tour, player);
    byKey.set(key, player);
    if (player.profile_id) byProfile.set(String(player.profile_id), player);
    byName.set(slugify(player.name_en || player.name_zh || ''), player);
  }

  return parsedPlayers.map((player) => {
    const key = player.player_key || canonicalPlayerKey(event.tour, player);
    const old = byKey.get(key)
      || byProfile.get(String(player.profile_id || ''))
      || byName.get(slugify(player.name_en || player.name_zh || ''))
      || {};
    const stableKey = old.player_key || key;
    return {
      ...old,
      ...player,
      player_key: stableKey,
      name_en: old.name_en || player.name_en,
      name_zh: old.name_zh || player.name_zh,
      rank: old.rank ?? player.rank ?? null,
      points: old.points ?? player.points ?? null,
      overall_elo: old.overall_elo ?? null,
      surface_elo: old.surface_elo ?? null,
      peak_elo: old.peak_elo ?? null,
      peak_month: old.peak_month ?? null,
      expected_points: old.expected_points ?? null,
      expected_round: old.expected_round ?? null,
      breakeven_round: old.breakeven_round ?? null,
      scores: old.scores || { base: 50, surface: 50, draw: 50, form: 50, manual: 0 },
      total_score: old.total_score ?? null,
      price: old.price ?? 0,
      tier: old.tier ?? null,
      pricing_detail: old.pricing_detail ?? null,
      source: sourceUrl || player.source || old.source || 'live-tennis.cn draw ajax'
    };
  });
}

export function parseOpenStatArgs(raw = '') {
  return [...String(raw || '').matchAll(/&quot;([^&]*)&quot;|"([^"]*)"/g)].map((m) => decodeHtml(m[1] || m[2] || ''));
}

export function unixToIso(raw) {
  const ts = Number(String(raw || '').trim());
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts * 1000).toISOString();
}

export async function fetchResultDate(dateKey) {
  const url = `${LIVE_TENNIS_BASE_URL}/zh/result/${dateKey}`;
  const html = await fetchText(url);
  return parseResultDateHtml(html, dateKey, url);
}

export function parseResultDateHtml(html, dateKey, sourceUrl) {
  const records = [];
  const blocks = [...html.matchAll(/id=["']iResult([^"']+)["']/gi)];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const start = block.index || 0;
    const end = i + 1 < blocks.length ? (blocks[i + 1].index || html.length) : html.length;
    const segment = html.slice(start, end);
    const eventName = cleanText(segment.match(/<div class=["']cResultTourInfoCity[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || block[1]);

    for (const stat of segment.matchAll(/open_stat\(([\s\S]*?)\)/g)) {
      const args = parseOpenStatArgs(stat[1]);
      if (args.length < 8) continue;
      const [eventId, tourCode, matchId, year, p1Id, p2Id, p1Name, p2Name] = args;
      const matchStart = segment.lastIndexOf('<div class="cResultMatch', stat.index || 0);
      const matchEnd = segment.indexOf('</table>', (stat.index || 0));
      if (matchStart < 0 || matchEnd < 0) continue;
      const matchHtml = segment.slice(matchStart, matchEnd);
      if (/is-double=["']?1["']?/i.test(matchHtml)) continue;
      const genderText = cleanText(matchHtml.match(/<div class=cResultMatchGender>([\s\S]*?)<\/div>/i)?.[1] || '');
      const roundText = cleanText(matchHtml.match(/<div class=cResultMatchRound>([\s\S]*?)<\/div>/i)?.[1] || '');
      if (/Q|资格/.test(roundText)) continue;
      const tour = genderText === '男单' ? 'ATP' : (genderText === '女单' ? 'WTA' : '');
      if (!tour) continue;
      const scheduledAt = unixToIso(matchHtml.match(/<div class=cResultMatchTime>(\d+)<\/div>/i)?.[1] || '');
      const statusCode = matchHtml.match(/match-status=["']?(\d+)/i)?.[1] || '';
      const status = statusCode === '2' ? 'completed' : (statusCode === '1' ? 'live' : 'scheduled');
      const rowClasses = [...matchHtml.matchAll(/<tr class=["']([^"']*)["']/gi)].map((m) => m[1] || '');
      let winnerName = null;
      let winnerProfileId = null;
      if (rowClasses[0]?.includes('cResultMatchMidTableRowWinner')) {
        winnerName = p1Name;
        winnerProfileId = p1Id;
      } else if (rowClasses[1]?.includes('cResultMatchMidTableRowWinner')) {
        winnerName = p2Name;
        winnerProfileId = p2Id;
      }
      const score = cleanText(matchHtml.match(/<td[^>]*class=["'][^"']*cResultMatchScore[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || '');
      records.push({
        date: dateKey,
        source_url: sourceUrl,
        source_event_id: String(eventId || ''),
        source_match_id: String(matchId || ''),
        tour,
        tour_code: tourCode,
        year,
        event_name: eventName,
        round_text: roundText,
        scheduled_at: scheduledAt,
        status,
        player1_profile_id: String(p1Id || ''),
        player1_name: cleanText(p1Name),
        player2_profile_id: String(p2Id || ''),
        player2_name: cleanText(p2Name),
        winner_profile_id: winnerProfileId ? String(winnerProfileId) : null,
        winner_name: winnerName ? cleanText(winnerName) : null,
        score,
        raw_status_code: statusCode
      });
    }
  }
  return records;
}

export function matchRowsForEvent(event, resultRecords, drawUrl = '') {
  const liveId = extractLiveTennisDrawId(drawUrl)
    || (event.source_urls || []).map(extractLiveTennisDrawId).find(Boolean)
    || '';
  const profileToPlayer = new Map();
  for (const player of event.players || []) {
    if (player.profile_id) {
      profileToPlayer.set(String(player.profile_id).replace(/^QUAL-/, 'QUAL'), player);
    }
  }

  const rows = [];
  for (const record of resultRecords) {
    if (record.tour !== event.tour) continue;
    const sameEvent = liveId
      ? record.source_event_id === liveId
      : recordMatchesEventName(event, record);
    if (!sameEvent) continue;
    const roundKey = normalizeRoundKey(record.round_text, event);
    const p1 = profileToPlayer.get(record.player1_profile_id);
    const p2 = profileToPlayer.get(record.player2_profile_id);
    const winner = record.winner_profile_id ? profileToPlayer.get(record.winner_profile_id) : null;
    const player1Key = p1?.player_key || (p1 ? canonicalPlayerKey(event.tour, p1) : null);
    const player2Key = p2?.player_key || (p2 ? canonicalPlayerKey(event.tour, p2) : null);
    const winnerKey = winner?.player_key || (winner ? canonicalPlayerKey(event.tour, winner) : null);
    rows.push({
      event_key: event.event_key,
      match_key: `${event.event_key}:${record.source_match_id || `${record.date}:${record.player1_profile_id}:${record.player2_profile_id}`}`,
      tour: event.tour,
      round_key: roundKey,
      round_order: roundOrder(event, roundKey),
      match_order: Number(record.source_match_id) || null,
      scheduled_at: record.scheduled_at,
      court: null,
      player1_key: player1Key,
      player1_name: p1?.name_zh || record.player1_name,
      player2_key: player2Key,
      player2_name: p2?.name_zh || record.player2_name,
      winner_key: winnerKey,
      winner_name: winner?.name_zh || record.winner_name,
      score: record.score || null,
      status: record.status,
      source_url: record.source_url,
      raw: record
    });
  }
  return rows;
}

export function dateRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const out = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function deriveEventWindows(event, matchRows, fetchedAt = new Date()) {
  const firstRound = matchRows.filter((row) => row.round_order === 1 && row.scheduled_at);
  const secondRound = matchRows.filter((row) => row.round_order === 2 && row.scheduled_at);
  const mainDrawFirstMatchAt = minIso(firstRound.map((row) => row.scheduled_at));
  const round2FirstMatchAt = minIso(secondRound.map((row) => row.scheduled_at));
  const completedR1 = firstRound.filter((row) => ['completed', 'walkover', 'retired'].includes(row.status));
  const expectedR1 = expectedRoundOneMatches(event);
  const allR1Complete = expectedR1 > 0 && completedR1.length >= expectedR1;
  let round1CompletedAt = null;
  if (allR1Complete) {
    const latestR1Start = maxIso(completedR1.map((row) => row.scheduled_at));
    const estimate = addMinutes(latestR1Start, 180) || fetchedAt.toISOString();
    if (round2FirstMatchAt && new Date(estimate) >= new Date(round2FirstMatchAt)) {
      round1CompletedAt = addMinutes(round2FirstMatchAt, -1);
    } else {
      round1CompletedAt = estimate;
    }
  }

  return {
    schedule_status: matchRows.length ? 'published' : (event.schedule_status || 'pending'),
    main_draw_first_match_at: mainDrawFirstMatchAt || event.main_draw_first_match_at || null,
    submission_cutoff_at: mainDrawFirstMatchAt ? addMinutes(mainDrawFirstMatchAt, -15) : (event.submission_cutoff_at || null),
    submission_closes_at: mainDrawFirstMatchAt ? addMinutes(mainDrawFirstMatchAt, -15) : (event.submission_closes_at || null),
    round1_completed_at: round1CompletedAt || event.round1_completed_at || null,
    round2_first_match_at: round2FirstMatchAt || event.round2_first_match_at || null,
    transfer_window_opens_at: round1CompletedAt || event.transfer_window_opens_at || null,
    transfer_window_closes_at: round2FirstMatchAt || event.transfer_window_closes_at || null
  };
}

export function expectedRoundOneMatches(event) {
  const players = event.players || [];
  if (!players.length) return 0;
  let count = 0;
  for (const player of players) {
    if (!player.draw_position || player.first_round === 'BYE') continue;
    count += 1;
  }
  return Math.floor(count / 2);
}
