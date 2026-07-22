import fs from 'node:fs';

function text(html = '') {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#183;|&middot;/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

function capture(html, pattern, fallback = '') {
  return text(html.match(pattern)?.[1] || fallback);
}

function beijingParts(seconds, scheduleDate = '') {
  if (!seconds) return { time: '', date: '', dayOffset: 0 };
  const date = new Date(Number(seconds) * 1000);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
  const beijingDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
  const base = Date.parse(`${scheduleDate || beijingDate}T00:00:00+08:00`);
  const target = Date.parse(`${beijingDate}T00:00:00+08:00`);
  const dayOffset = Number.isFinite(base) && Number.isFinite(target) ? Math.round((target - base) / 86_400_000) : 0;
  return { time, date: beijingDate, dayOffset: Math.max(0, dayOffset) };
}

function namesFromRow(row = '') {
  const beforeRank = row.split(/<sub(?:\s|>)/i)[0];
  const names = [...beforeRank.matchAll(/<span(?:\s[^>]*)?>([^<>]+)<\/span>/gi)]
    .map(match => text(match[1]))
    .filter(value => /[\p{L}\u3400-\u9fff]/u.test(value) && !/^(?:[A-ZQWLA]|LL|WC|SE|PR|Alt)$/i.test(value));
  return [...new Set(names)].join('/');
}

function rowDetails(row = '') {
  const rank = capture(row, /<sub(?:\s[^>]*)?>([\s\S]*?)<\/sub>/i).match(/\d+/)?.[0] || '';
  const odds = text(row).match(/(?:^|\s)(\d+\.\d{2})(?=\s|$)/)?.[1] || '';
  return { name: namesFromRow(row), rank, odds };
}

function h2hFromMatch(chunk = '') {
  const values = [...String(chunk).matchAll(/>\s*(\d+)\s*:\s*(\d+)\s*</g)];
  const last = values.at(-1);
  return last ? `${last[1]}:${last[2]}` : '';
}

function levelFromChunk(chunk = '') {
  const source = String(chunk);
  const image = source.match(/\/(?:ATP|WTA|GS)[^"']*?(1000|500|250|125|GS|YEC)[^"']*\.(?:png|webp|svg)/i)?.[1] || '';
  if (/^gs$/i.test(image)) return 'Grand Slam';
  if (/^yec$/i.test(image)) return 'Finals';
  return image;
}

function kindFromChinese(value = '') {
  const lower = value.toLowerCase();
  return `${value.includes('女') || lower.includes('women') || lower.includes('girls') ? 'W' : 'M'}${value.includes('双') || lower.includes('doubles') ? 'D' : 'S'}`;
}

function kindFromMatch(match) {
  const value = String(match.type || '').toLowerCase();
  return `${value.includes('women') || value.includes('wta') || value.includes('girls') ? 'W' : 'M'}${value.includes('doubles') ? 'D' : 'S'}`;
}

export function parseChineseSchedule(html, scheduleDate = '') {
  return String(html).split(/(?=<div class=["']?cResultTourTitle(?:\s|["'>]))/i).slice(1).map(chunk => {
    const city = capture(chunk, /cResultTourInfoCity[^>]*>([\s\S]*?)<\/div>/i);
    const name = capture(chunk, /cResultTourInfoName[^>]*>([\s\S]*?)<\/div>/i);
    const id = chunk.match(/tour-id=["']([^"']+)/i)?.[1] || '';
    const surface = /SurfaceClay/i.test(chunk) ? '红土' : /SurfaceGrass/i.test(chunk) ? '草地' : /SurfaceHard/i.test(chunk) ? '硬地' : '未标注';
    const level = levelFromChunk(chunk);
    const matches = [];
    const courtChunks = chunk.split(/(?=<div class=["']cResultCourt\s)/i).slice(1);
    for (const courtChunk of courtChunks) {
      const court = capture(courtChunk, /cResultCourtTitle[^>]*>([\s\S]*?)<\/div>/i, '未标注');
      for (const matchChunk of courtChunk.split(/(?=<div class=["']cResultMatch\s)/i).slice(1)) {
        const clock = beijingParts(capture(matchChunk, /cResultMatchTime[^>]*>(\d+)<\/div>/i), scheduleDate);
        const gender = capture(matchChunk, /cResultMatchGender[^>]*>([\s\S]*?)<\/div>/i);
        const rows = matchChunk.split(/<tr class=/i).slice(1, 3);
        if (!clock.time || rows.length < 2) continue;
        const first = rowDetails(rows[0]);
        const second = rowDetails(rows[1]);
        matches.push({
          time: clock.time, beijingDate: clock.date, dayOffset: clock.dayOffset,
          kind: kindFromChinese(gender), first: first.name, second: second.name,
          firstRank: first.rank, secondRank: second.rank,
          firstOdds: first.odds, secondOdds: second.odds,
          h2h: h2hFromMatch(matchChunk), court
        });
      }
    }
    return { id, city: city || name, name: name || city, surface, level, matches };
  }).filter(tour => tour.matches.length);
}

function normalized(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tournamentKey(value = '') {
  return normalized(value).replace(/^(atp|wta|itf)\s+/, '').replace(/\s+(men|women|singles|doubles)$/, '').trim();
}

function surnameKey(value = '') {
  const tokens = normalized(value).split(' ').filter(Boolean);
  return tokens.at(-1) || '';
}

function playerSurnameKeys(value = '') {
  return String(value).split('/').map(surnameKey).filter(Boolean);
}

function playerPairScore(match, candidate) {
  return multisetOverlap(playerSurnameKeys(match.first.name), playerSurnameKeys(candidate.firstEn))
    + multisetOverlap(playerSurnameKeys(match.second.name), playerSurnameKeys(candidate.secondEn));
}

function clockMinutes(value = '') {
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
}

function clockDistance(first = '', second = '') {
  const a = clockMinutes(first);
  const b = clockMinutes(second);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === Number.MAX_SAFE_INTEGER || b === Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  const direct = Math.abs(a - b);
  return Math.min(direct, 24 * 60 - direct);
}

function multisetOverlap(first, second) {
  const counts = new Map();
  second.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  let total = 0;
  for (const value of first) {
    if ((counts.get(value) || 0) > 0) { total += 1; counts.set(value, counts.get(value) - 1); }
  }
  return total;
}

function tournamentNameScore(english, tour) {
  const useful = token => token.length > 2 && !/^(?:m|w|ch)\d+$/.test(token) && !['open', 'singles', 'doubles'].includes(token);
  const source = new Set(normalized(english).split(' ').filter(useful));
  const target = new Set(normalized(`${tour.englishName || ''} ${tour.englishCity || ''} ${tour.name} ${tour.city}`).split(' ').filter(useful));
  if (!source.size || !target.size) return 0;
  let overlap = 0;
  source.forEach(token => { if (target.has(token)) overlap += 1; });
  return overlap * 100;
}

export class ChineseLocalizer {
  constructor({ cache, url, ttlMs, catalogFile }) {
    this.cache = cache;
    this.url = url;
    this.ttlMs = ttlMs;
    this.catalog = { players: {}, tournaments: {} };
    try { this.catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8')); } catch (_) {}
    this.byExact = new Map();
    this.bySurname = new Map();
    this.tournamentByExact = new Map();
    for (const [english, chinese] of Object.entries(this.catalog.players || {})) {
      this.byExact.set(normalized(english), chinese);
      const surname = surnameKey(english);
      if (!this.bySurname.has(surname)) this.bySurname.set(surname, new Set());
      this.bySurname.get(surname).add(chinese);
    }
    for (const [english, chinese] of Object.entries(this.catalog.tournaments || {})) {
      this.tournamentByExact.set(tournamentKey(english), chinese);
    }
  }

  catalogPlayer(name) {
    if (/[/&]/.test(String(name))) return '';
    const exact = this.byExact.get(normalized(name));
    if (exact) return exact;
    const candidates = this.bySurname.get(surnameKey(name));
    return candidates?.size === 1 ? [...candidates][0] : '';
  }

  async refresh(date, now = Date.now()) {
    const saved = this.cache.data.localization;
    if (saved?.version === 4 && saved?.date === date && now - saved.fetchedAt < this.ttlMs) return saved.tours || [];
    const chineseUrl = this.url.replace('{date}', date);
    const request = target => fetch(target, {
      signal: AbortSignal.timeout(12_000), headers: { accept: 'text/html', 'user-agent': 'LuWang live score localization cache' }
    }).then(async response => {
      if (!response.ok) throw new Error(`localization HTTP ${response.status}`);
      return response.text();
    });
    const [chineseHtml, englishHtml] = await Promise.all([
      request(chineseUrl),
      request(chineseUrl.replace('/zh/', '/en/')).catch(() => '')
    ]);
    const tours = parseChineseSchedule(chineseHtml, date);
    const englishTours = new Map(parseChineseSchedule(englishHtml, date).map(tour => [tour.id, tour]));
    tours.forEach(tour => {
      const english = englishTours.get(tour.id);
      if (!english) return;
      tour.englishCity = english.city;
      tour.englishName = english.name;
      tour.matches = tour.matches.map((match, index) => ({
        ...match,
        firstEn: english.matches[index]?.first || '',
        secondEn: english.matches[index]?.second || ''
      }));
    });
    this.cache.data.localization = {
      date,
      version: 4,
      fetchedAt: now,
      tours,
      translations: [3, 4].includes(saved?.version) ? saved.translations || {} : {},
      tournamentTranslations: [3, 4].includes(saved?.version) ? saved.tournamentTranslations || {} : {}
    };
    this.cache.scheduleWrite();
    return tours;
  }

  translations() {
    return this.cache.data.localization?.translations || {};
  }

  localizationData() {
    return this.cache.data.localization ||= { date: '', fetchedAt: 0, tours: [], translations: {}, tournamentTranslations: {} };
  }

  tournamentTranslations() {
    return this.cache.data.localization?.tournamentTranslations || {};
  }

  rememberTournament(english, chinese) {
    if (!english || !chinese || english === chinese) return;
    const translations = this.localizationData().tournamentTranslations ||= {};
    translations[tournamentKey(english)] = chinese;
  }

  tournamentName(english) {
    const key = tournamentKey(english);
    const exact = this.tournamentTranslations()[key] || this.tournamentByExact.get(key);
    if (exact) return exact;
    if (key.length >= 5) {
      const fuzzy = [...this.tournamentByExact].find(([candidate]) => candidate.includes(key) || key.includes(candidate));
      if (fuzzy) return fuzzy[1];
    }
    return english;
  }

  remember(player, chinese) {
    if (!player?.id || !chinese) return;
    const translations = this.localizationData().translations ||= {};
    translations[String(player.id)] = chinese;
  }

  playerName(id, english) {
    return this.translations()[String(id)] || this.catalogPlayer(english) || english;
  }

  enrich(matches) {
    const tours = this.cache.data.localization?.tours || [];
    const groups = new Map();
    for (const match of matches) {
      const key = match.tournament.id || match.tournament.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(match);
    }
    for (const group of groups.values()) {
      const signatures = group.map(match => `${match.time}:${kindFromMatch(match)}`);
      let bestIndex = -1;
      let bestScore = 0;
      for (const [index, tour] of tours.entries()) {
        const other = tour.matches.map(match => `${match.time}:${match.kind}`);
        const overlap = multisetOverlap(signatures, other);
        const score = tournamentNameScore(group[0]?.tournament?.name, tour) + overlap * 10 - Math.abs(signatures.length - other.length);
        if (score > bestScore) { bestScore = score; bestIndex = index; }
      }
      const tour = bestIndex >= 0 ? tours[bestIndex] : null;
      const used = new Set();
      for (const match of group) {
        const candidates = (tour?.matches || []).map((candidate, index) => ({ candidate, index }))
          .filter(({ candidate, index }) => !used.has(index) && candidate.kind === kindFromMatch(match))
          .map(item => ({
            ...item,
            playerScore: playerPairScore(match, item.candidate),
            timeDistance: clockDistance(match.time, item.candidate.time)
          }))
          .filter(item => item.playerScore > 0 || item.timeDistance === 0)
          .sort((a, b) => b.playerScore - a.playerScore || a.timeDistance - b.timeDistance || a.index - b.index);
        const localIndex = candidates[0]?.index ?? -1;
        const local = localIndex >= 0 ? tour.matches[localIndex] : null;
        if (local) used.add(localIndex);
        const firstName = local?.first || this.playerName(match.first.id, match.first.name);
        const secondName = local?.second || this.playerName(match.second.id, match.second.name);
        this.remember(match.first, firstName !== match.first.name ? firstName : '');
        this.remember(match.second, secondName !== match.second.name ? secondName : '');
        match.first = { ...match.first, nameEn: match.first.name, name: firstName };
        match.second = { ...match.second, nameEn: match.second.name, name: secondName };
        if (local?.firstRank) match.first.rank = local.firstRank;
        if (local?.secondRank) match.second.rank = local.secondRank;
        match.h2h = local?.h2h || '';
        if (local?.time) match.time = local.time;
        match.dayOffset = local?.dayOffset || 0;
        match.scheduleOrder = localIndex >= 0 ? localIndex : Number.MAX_SAFE_INTEGER;
        match.courtOrder = local ? tour.matches.findIndex(candidate => candidate.court === local.court) : Number.MAX_SAFE_INTEGER;
        match.scheduleDate = this.cache.data.localization?.date || match.date;
        match.officialScheduleMatch = Boolean(local);
        const tournamentName = tour?.city || this.tournamentName(match.tournament.name);
        this.rememberTournament(match.tournament.name, tournamentName);
        match.tournament = {
          ...match.tournament,
          nameEn: match.tournament.name,
          name: tournamentName,
          subtitle: tour?.name || '',
          level: tour?.level || match.tournament.level,
          sourceOrder: bestIndex >= 0 ? bestIndex : Number.MAX_SAFE_INTEGER,
          surface: tour?.surface && tour.surface !== '未标注' ? tour.surface : match.tournament.surface
        };
        if (local?.court) match.court = local.court;
      }
    }
    this.cache.scheduleWrite();
    return matches;
  }

  localizePlayerEntry(item) {
    const english = item.player_name || item.player || '';
    const chinese = this.playerName(item.player_key, english);
    return { ...item, player_name_en: english, player_name: chinese };
  }

  localizeEvent(item) {
    const first = this.playerName(item.first_player_key, item.event_first_player);
    const second = this.playerName(item.second_player_key, item.event_second_player);
    return {
      ...item,
      event_first_player_en: item.event_first_player,
      event_second_player_en: item.event_second_player,
      event_first_player: first,
      event_second_player: second,
      tournament_name_en: item.tournament_name,
      tournament_name: this.tournamentName(item.tournament_name)
    };
  }
}
