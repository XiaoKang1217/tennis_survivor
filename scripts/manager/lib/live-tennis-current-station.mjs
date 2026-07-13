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
  if (/\bQF\b|QUARTER|¼|1\s*[\/⁄]\s*4|四分之一|八强/.test(raw)) return 'QF';
  if (/\bSF\b|SEMI|半决/.test(raw)) return 'SF';
  if (/^(?:F|FINAL|决赛|总决赛|冠军赛)$/.test(raw)) return 'F';
  const numericRound = raw.match(/^(\d+)R$/)
    || raw.match(/ROUND\s*(\d+)/)
    || raw.match(/第\s*(\d+)\s*轮/);
  const chineseRound = raw.match(/第\s*([一二三四五六七八])\s*轮|^(第一轮|第二轮|第三轮|第四轮|第五轮|第六轮|第七轮|第八轮)$/);
  const chineseRoundMap = {
    '一': 1,
    '二': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '七': 7,
    '八': 8,
    '第一轮': 1,
    '第二轮': 2,
    '第三轮': 3,
    '第四轮': 4,
    '第五轮': 5,
    '第六轮': 6,
    '第七轮': 7,
    '第八轮': 8
  };
  const roundNumber = numericRound
    ? Number(numericRound[1])
    : (chineseRound ? chineseRoundMap[chineseRound[1] || chineseRound[2]] : 0);
  if (roundNumber > 0) return keys[roundNumber - 1] || keys[keys.length - 2];
  if (/首轮/.test(raw)) return keys[0];
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
    walkover_matches: parseDrawWalkoverMatchesFromAjax(html, event, ajaxUrl),
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
    const entrySign = seedLabel.toUpperCase();
    const entryType = isQualifier || entrySign === 'Q'
      ? 'qualifier'
      : (entrySign === 'LL' || entrySign === 'L')
        ? 'lucky_loser'
        : entrySign === 'W'
          ? 'wildcard'
          : 'direct_acceptance';

    slots.push({
      draw_position: drawPosition,
      profile_id: profileId || null,
      name_en: nameEnRaw,
      name_zh: nameZh,
      country_code: countryCode,
      seed_label: seedLabel,
      seed: /^\d+$/.test(seedLabel) ? Number(seedLabel) : null,
      entry_type: entryType,
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
  const byDrawPosition = new Map();
  for (const player of existing) {
    const key = player.player_key || canonicalPlayerKey(event.tour, player);
    byKey.set(key, player);
    if (player.profile_id) byProfile.set(String(player.profile_id), player);
    byName.set(slugify(player.name_en || player.name_zh || ''), player);
    if (player.draw_position) byDrawPosition.set(Number(player.draw_position), player);
  }

  return parsedPlayers.map((player) => {
    const key = player.player_key || canonicalPlayerKey(event.tour, player);
    const oldByIdentity = byKey.get(key)
      || byProfile.get(String(player.profile_id || ''))
      || byName.get(slugify(player.name_en || player.name_zh || ''))
      || null;
    const oldByPosition = player.draw_position ? byDrawPosition.get(Number(player.draw_position)) : null;
    const isQualifierPlacement = Boolean(
      oldByPosition
      && oldByPosition.is_qualifier_placeholder
      && !player.is_qualifier_placeholder
    );
    const isPreR1Substitution = Boolean(
      oldByPosition
      && !oldByPosition.is_qualifier_placeholder
      && !player.is_qualifier_placeholder
      && !oldByIdentity
      && !sameDrawPlayer(event.tour, oldByPosition, player)
    );
    const old = oldByIdentity || ((isQualifierPlacement || isPreR1Substitution) ? oldByPosition : null) || {};
    const stableKey = (isQualifierPlacement || isPreR1Substitution) ? key : (old.player_key || key);
    const qualifierReplacement = isQualifierPlacement
      ? {
          placeholder_player_key: oldByPosition.player_key || canonicalPlayerKey(event.tour, oldByPosition),
          placeholder_name_en: oldByPosition.name_en || null,
          placeholder_name_zh: oldByPosition.name_zh || null,
          placeholder_profile_id: oldByPosition.profile_id || null,
          replacement_player_key: key,
          replacement_name_en: player.name_en || null,
          replacement_name_zh: player.name_zh || null,
          replacement_profile_id: player.profile_id || null,
          draw_position: Number(player.draw_position),
          source_url: sourceUrl || player.source || null
        }
      : old.qualifier_replacement || null;
    const preR1Substitution = isPreR1Substitution
      ? {
          out_player_key: oldByPosition.player_key || canonicalPlayerKey(event.tour, oldByPosition),
          out_name_en: oldByPosition.name_en || null,
          out_name_zh: oldByPosition.name_zh || null,
          out_profile_id: oldByPosition.profile_id || null,
          replacement_player_key: key,
          replacement_name_en: player.name_en || null,
          replacement_name_zh: player.name_zh || null,
          replacement_profile_id: player.profile_id || null,
          draw_position: Number(player.draw_position),
          reason: 'pre_r1_withdrawal',
          source_url: sourceUrl || player.source || null,
          contract_price_policy: 'keep_original_contract_price',
          original_contract_price: oldByPosition?.price ?? null
        }
      : old.pre_r1_substitution || null;
    return {
      ...old,
      ...player,
      player_key: stableKey,
      is_qualifier_placeholder: !!player.is_qualifier_placeholder,
      name_en: (isQualifierPlacement || isPreR1Substitution) ? player.name_en : (old.name_en || player.name_en),
      name_zh: (isQualifierPlacement || isPreR1Substitution) ? player.name_zh : (old.name_zh || player.name_zh),
      rank: isPreR1Substitution ? (player.rank ?? old.rank ?? null) : (old.rank ?? player.rank ?? null),
      points: isPreR1Substitution ? (player.points ?? old.points ?? null) : (old.points ?? player.points ?? null),
      overall_elo: isPreR1Substitution ? (player.overall_elo ?? old.overall_elo ?? null) : (old.overall_elo ?? null),
      surface_elo: isPreR1Substitution ? (player.surface_elo ?? old.surface_elo ?? null) : (old.surface_elo ?? null),
      peak_elo: isPreR1Substitution ? (player.peak_elo ?? old.peak_elo ?? null) : (old.peak_elo ?? null),
      peak_month: isPreR1Substitution ? (player.peak_month ?? old.peak_month ?? null) : (old.peak_month ?? null),
      expected_points: old.expected_points ?? null,
      expected_round: old.expected_round ?? null,
      breakeven_round: old.breakeven_round ?? null,
      scores: old.scores || { base: 50, surface: 50, draw: 50, form: 50, manual: 0 },
      total_score: old.total_score ?? null,
      price: old.price ?? 0,
      tier: old.tier ?? null,
      pricing_detail: old.pricing_detail ?? null,
      qualifier_replacement: qualifierReplacement,
      pre_r1_substitution: preR1Substitution,
      source: sourceUrl || player.source || old.source || 'live-tennis.cn draw ajax'
    };
  });
}

function sameDrawPlayer(tour, a = {}, b = {}) {
  const aKey = a.player_key || canonicalPlayerKey(tour, a);
  const bKey = b.player_key || canonicalPlayerKey(tour, b);
  if (aKey && bKey && aKey === bKey) return true;
  if (a.profile_id && b.profile_id && String(a.profile_id) === String(b.profile_id)) return true;
  const aName = slugify(a.name_en || a.name_zh || '');
  const bName = slugify(b.name_en || b.name_zh || '');
  return Boolean(aName && bName && aName === bName);
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

export function parseDrawWalkoverMatchesFromAjax(html, event, sourceUrl = '') {
  const cells = parseDrawCellsFromAjax(html, event);
  if (!cells.length) return [];
  const playerCells = cells.filter((cell) => cell.player && cell.cell_index > 0);
  const scoreCells = cells.filter((cell) => cell.is_score && walkoverStatusFromScore(cell.text));
  const rows = [];
  const seen = new Set();
  const stages = roundKeysForEvent(event);
  const firstStage = stages[0];

  for (const scoreCell of scoreCells) {
    const winnerCell = findWalkoverWinnerCell(scoreCell, playerCells, event, stages);
    if (!winnerCell) continue;
    const reachedRound = stageForCellIndex(winnerCell.cell_index, stages);
    const matchRound = previousStageKey(reachedRound, stages);
    if (!matchRound || matchRound === 'OUT') continue;
    const status = walkoverStatusFromScore(scoreCell.text);
    const participants = inferWalkoverParticipants({
      scoreCell,
      winnerCell,
      playerCells,
      event,
      stages,
      matchRound,
      firstStage
    });
    const winner = winnerCell.player;
    const loser = participants.find((player) => player && player.player_key !== winner.player_key) || null;
    const keyParts = [
      event.event_key,
      'draw',
      status,
      matchRound,
      winner.profile_id || winner.player_key,
      loser?.profile_id || loser?.player_key || scoreCell.row
    ];
    const matchKey = keyParts.map((part) => String(part || '').replace(/[^a-zA-Z0-9_|.-]+/g, '-')).join(':');
    if (seen.has(matchKey)) continue;
    seen.add(matchKey);
    rows.push({
      event_key: event.event_key,
      match_key: matchKey,
      tour: event.tour,
      round_key: matchRound,
      round_order: roundOrder(event, matchRound),
      match_order: scoreCell.row * 10 + scoreCell.cell_index,
      scheduled_at: null,
      court: null,
      player1_key: winner.player_key,
      player1_name: winner.name_zh || winner.name_en,
      player2_key: loser?.player_key || null,
      player2_name: loser ? (loser.name_zh || loser.name_en) : null,
      winner_key: winner.player_key,
      winner_name: winner.name_zh || winner.name_en,
      score: scoreCell.text,
      status,
      source_url: sourceUrl,
      raw: {
        source: 'live-tennis.cn draw ajax',
        score: scoreCell.text,
        score_row: scoreCell.row,
        score_cell_index: scoreCell.cell_index,
        winner_cell_index: winnerCell.cell_index,
        reached_round: reachedRound
      }
    });
  }
  return rows;
}

function parseDrawCellsFromAjax(html, event) {
  const part = eventTourPart(event);
  const partStart = html.search(new RegExp(`<div\\b[^>]*class=["'][^"']*cDrawPart[^"']*["'][^>]*data-id=["']${part}["']`, 'i'));
  if (partStart < 0) return [];
  const nextPart = html.slice(partStart + 1).search(/<div\b[^>]*class=["'][^"']*cDrawPart[^"']*["'][^>]*data-id=["']/i);
  const segment = nextPart >= 0 ? html.slice(partStart, partStart + 1 + nextPart) : html.slice(partStart);
  const cells = [];
  for (const row of segment.matchAll(/<tr>\s*<td[^>]*class=["'][^"']*cDrawSeq[^"']*["'][^>]*>\s*(\d+)\s*<\/td>([\s\S]*?)<\/tr>/gi)) {
    const drawPosition = Number(row[1]);
    const rowHtml = row[2];
    const tds = [...rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
    for (let i = 0; i < tds.length; i += 1) {
      const attrs = tds[i][1] || '';
      const inner = tds[i][2] || '';
      const cls = attr(attrs, 'class');
      if (!/cDrawGrid/.test(cls)) continue;
      const pname = inner.match(/<pname\b([^>]*)>([\s\S]*?)<\/pname>/i);
      const text = cleanText(inner);
      let player = null;
      if (pname) {
        const pAttrs = pname[1];
        const pInner = pname[2];
        const profileId = attr(pAttrs, 'data-id');
        const nameEn = normalizeName(attr(pAttrs, 'alt'));
        const nameZh = cleanText(pInner.replace(/<span[^>]*class=["']?entrySign["']?[^>]*>[\s\S]*?<\/span>/i, ''));
        const isBye = profileId === '0' || /^(bye|轮空)$/i.test(nameEn) || nameZh === '轮空';
        if (!isBye) {
          player = {
            profile_id: profileId || null,
            name_en: nameEn,
            name_zh: nameZh || nameEn,
            player_key: canonicalPlayerKey(event.tour, { name_en: nameEn, name_zh: nameZh || nameEn, profile_id: profileId || null })
          };
        }
      }
      cells.push({
        row: drawPosition,
        cell_index: i + 1,
        class_name: cls,
        text,
        is_score: /cDrawGridScore/.test(cls),
        player
      });
    }
  }
  return cells;
}

function walkoverStatusFromScore(score = '') {
  const text = String(score || '').trim();
  if (!text) return '';
  if (/w\s*\/?\s*o|walkover|不战|退赛|withdraw/i.test(text)) return 'walkover';
  if (/\bret\.?\b|retired|中退|伤退/i.test(text)) return 'retired';
  return '';
}

function stageForCellIndex(cellIndex, stages) {
  const idx = Math.max(0, Math.min(stages.length - 1, Number(cellIndex || 1) - 1));
  return stages[idx];
}

function previousStageKey(roundKey, stages) {
  const idx = stages.indexOf(roundKey);
  if (idx <= 0) return idx === 0 ? 'OUT' : null;
  return stages[idx - 1];
}

function findWalkoverWinnerCell(scoreCell, playerCells, event, stages) {
  const bracketSize = bracketSizeFor(event.draw_size);
  const groupStart = Math.floor((scoreCell.row - 1) / bracketSize) * bracketSize + 1;
  const groupEnd = groupStart + bracketSize - 1;
  const candidates = playerCells.filter((cell) => (
    cell.row >= groupStart
    && cell.row <= groupEnd
    && cell.cell_index >= Math.max(2, scoreCell.cell_index - 1)
    && cell.cell_index <= scoreCell.cell_index + 1
  ));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const aSame = a.cell_index === scoreCell.cell_index ? 1 : 0;
    const bSame = b.cell_index === scoreCell.cell_index ? 1 : 0;
    if (aSame !== bSame) return bSame - aSame;
    const aStage = stages.indexOf(stageForCellIndex(a.cell_index, stages));
    const bStage = stages.indexOf(stageForCellIndex(b.cell_index, stages));
    if (aStage !== bStage) return bStage - aStage;
    const aDist = Math.abs(a.row - scoreCell.row);
    const bDist = Math.abs(b.row - scoreCell.row);
    if (aDist !== bDist) return aDist - bDist;
    return a.row - b.row;
  });
  return candidates[0];
}

function inferWalkoverParticipants({ scoreCell, winnerCell, playerCells, event, stages, matchRound, firstStage }) {
  const roundIdx = stages.indexOf(matchRound);
  if (roundIdx < 0) return [winnerCell.player];
  const groupSize = Math.pow(2, roundIdx + 1);
  const halfSize = Math.max(1, groupSize / 2);
  const groupStart = Math.floor((scoreCell.row - 1) / groupSize) * groupSize + 1;
  const halves = [
    [groupStart, groupStart + halfSize - 1],
    [groupStart + halfSize, groupStart + groupSize - 1]
  ];
  const participants = halves.map(([start, end]) => (
    findParticipantForRound(playerCells, start, end, matchRound, firstStage, stages)
  )).filter(Boolean);
  if (!participants.some((player) => player.player_key === winnerCell.player.player_key)) {
    participants.unshift(winnerCell.player);
  }
  const seen = new Set();
  return participants.filter((player) => {
    if (!player || seen.has(player.player_key)) return false;
    seen.add(player.player_key);
    return true;
  });
}

function findParticipantForRound(playerCells, start, end, roundKey, firstStage, stages) {
  const targetStage = roundKey === 'OUT' ? firstStage : roundKey;
  const candidates = playerCells.filter((cell) => (
    cell.row >= start
    && cell.row <= end
    && stageForCellIndex(cell.cell_index, stages) === targetStage
  ));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (a.cell_index !== b.cell_index) return b.cell_index - a.cell_index;
    const mid = (start + end) / 2;
    return Math.abs(a.row - mid) - Math.abs(b.row - mid);
  });
  return candidates[0].player;
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
  const allR1Scheduled = expectedR1 > 0 && firstRound.length >= expectedR1;
  let round1CompletedAt = null;
  const latestR1Start = maxIso(firstRound.map((row) => row.scheduled_at));
  if (allR1Complete) {
    const fetchedIso = fetchedAt.toISOString();
    const estimate = round2FirstMatchAt && new Date(fetchedIso) < new Date(round2FirstMatchAt)
      ? fetchedIso
      : addMinutes(maxIso(completedR1.map((row) => row.scheduled_at)), 180) || fetchedIso;
    if (round2FirstMatchAt && new Date(estimate) >= new Date(round2FirstMatchAt)) {
      round1CompletedAt = addMinutes(round2FirstMatchAt, -1);
    } else {
      round1CompletedAt = estimate;
    }
  } else if (allR1Scheduled && round2FirstMatchAt && latestR1Start && new Date(latestR1Start) < new Date(round2FirstMatchAt)) {
    round1CompletedAt = latestR1Start;
  }

  return {
    schedule_status: matchRows.length ? 'partial' : (event.schedule_status || 'pending'),
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
