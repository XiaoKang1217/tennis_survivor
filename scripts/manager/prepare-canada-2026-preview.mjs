#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  canonicalPlayerKey,
  normalizeName,
  nowIso,
  readJson,
  writeJson
} from './lib/manager-utils.mjs';

const ATP_EVENT_KEY = 'atp-2026-w32-montreal-national-bank-open';
const WTA_EVENT_KEY = 'wta-2026-w32-toronto-national-bank-open';
const ATP_DRAW_URL = 'https://www.protennislive.com/posting/2026/421/mds.pdf';
const WTA_DRAW_URL = 'https://wtafiles.wtatennis.com/pdf/draws/2026/806/MDS.pdf';
const ATP_NAME_MAP_URL = 'https://www.live-tennis.cn/zh/draw/20421/2026';
const WTA_NAME_MAP_URL = 'https://www.live-tennis.cn/zh/draw/30806/2026';

const ATP_SLOTS = [
  [1, 'Alexander ZVEREV', 'GER', 1],
  [3, 'Lorenzo SONEGO', 'ITA'],
  [4, 'Tallon GRIEKSPOOR', 'NED'],
  [5, null, null, null, 'Q'],
  [6, 'Fabian MAROZSAN', 'HUN'],
  [8, 'Matteo ARNALDI', 'ITA', 30],
  [9, 'Ugo HUMBERT', 'FRA', 24],
  [11, 'Daniel MERIDA', 'ESP'],
  [12, 'Liam DRAXL', 'CAN', null, 'WC'],
  [13, 'Alex MICHELSEN', 'USA'],
  [14, 'Jan-Lennard STRUFF', 'GER'],
  [16, 'Francisco CERUNDOLO', 'ARG', 16],
  [17, 'Learner TIEN', 'USA', 12],
  [19, 'Kamil MAJCHRZAK', 'POL'],
  [20, 'Gael MONFILS', 'FRA', null, 'WC'],
  [21, 'Pablo CARRENO BUSTA', 'ESP'],
  [22, 'Valentin ROYER', 'FRA'],
  [24, 'Tommy PAUL', 'USA', 17],
  [25, 'Raphael COLLIGNON', 'BEL', 32],
  [27, null, null, null, 'Q'],
  [28, 'Roman Andres BURRUCHAGA', 'ARG'],
  [29, null, null, null, 'Q'],
  [30, 'Thiago Agustin TIRANTE', 'ARG'],
  [32, 'Taylor FRITZ', 'USA', 7],
  [33, 'Daniil MEDVEDEV', null, 4],
  [35, 'Giovanni MPETSHI PERRICARD', 'FRA'],
  [36, 'Botic VAN DE ZANDSCHULP', 'NED'],
  [37, 'Hubert HURKACZ', 'POL', null, 'PR'],
  [38, null, null, null, 'Q'],
  [40, 'Alejandro TABILO', 'CHI', 25],
  [41, 'Karen KHACHANOV', null, 21],
  [43, 'Terence ATMANE', 'FRA'],
  [44, 'Jack DRAPER', 'GBR', null, 'WC'],
  [45, null, null, null, 'Q'],
  [46, 'Adrian MANNARINO', 'FRA'],
  [48, 'Jakub MENSIK', 'CZE', 13],
  [49, 'Casper RUUD', 'NOR', 9],
  [51, 'Juan Manuel CERUNDOLO', 'ARG'],
  [52, 'Hamad MEDJEDOVIC', 'SRB'],
  [53, null, null, null, 'Q'],
  [54, null, null, null, 'Q'],
  [56, 'Joao FONSECA', 'BRA', 22],
  [57, 'Zizou BERGS', 'BEL', 31],
  [59, 'Sebastian BAEZ', 'ARG'],
  [60, 'Mattia BELLUCCI', 'ITA'],
  [61, null, null, null, 'Q'],
  [62, 'Jenson BROOKSBY', 'USA'],
  [64, 'Ben SHELTON', 'USA', 5],
  [65, 'Jiri LEHECKA', 'CZE', 8],
  [67, 'Alexis GALARNEAU', 'CAN', null, 'WC'],
  [68, 'Vit KOPRIVA', 'CZE'],
  [69, 'Jaume MUNAR', 'ESP'],
  [70, 'Rinky HIJIKATA', 'AUS'],
  [72, 'Alexander BLOCKX', 'BEL', 27],
  [73, 'Rafael JODAR', 'ESP', 20],
  [75, 'Marton FUCSOVICS', 'HUN'],
  [76, 'Corentin MOUTET', 'FRA'],
  [77, null, null, null, 'Q'],
  [78, 'Martin LANDALUCE', 'ESP'],
  [80, 'Lorenzo MUSETTI', 'ITA', 11],
  [81, 'Valentin VACHEROT', 'MON', 14],
  [83, 'Matteo BERRETTINI', 'ITA'],
  [84, 'Mariano NAVONE', 'ARG'],
  [85, 'Zachary SVAJDA', 'USA'],
  [86, 'Denis SHAPOVALOV', 'CAN'],
  [88, 'Arthur FILS', 'FRA', 18],
  [89, 'Ignacio BUSE', 'PER', 29],
  [91, 'Camilo UGO CARABELLI', 'ARG'],
  [92, 'Cameron NORRIE', 'GBR'],
  [93, 'James DUCKWORTH', 'AUS'],
  [94, null, null, null, 'Q'],
  [96, 'Alex DE MINAUR', 'AUS', 3],
  [97, 'Flavio COBOLLI', 'ITA', 6],
  [99, null, null, null, 'Q'],
  [100, 'Yannick HANFMANN', 'GER'],
  [101, 'Aleksandar KOVACEVIC', 'USA'],
  [102, 'Nuno BORGES', 'POR'],
  [104, 'Tomas Martin ETCHEVERRY', 'ARG', 26],
  [105, 'Luciano DARDERI', 'ITA', 19],
  [107, 'Gabriel DIALLO', 'CAN', null, 'WC'],
  [108, null, null, null, 'Q'],
  [109, 'Adolfo Daniel VALLEJO', 'PAR'],
  [110, 'Juncheng SHANG', 'CHN', null, 'PR'],
  [112, 'Andrey RUBLEV', null, 10],
  [113, 'Frances TIAFOE', 'USA', 15],
  [115, null, null, null, 'Q'],
  [116, 'Marin CILIC', 'CRO'],
  [117, null, null, null, 'Q'],
  [118, 'Miomir KECMANOVIC', 'SRB'],
  [120, 'Arthur RINDERKNECH', 'FRA', 23],
  [121, 'Brandon NAKASHIMA', 'USA', 28],
  [123, null, null, null, 'Q'],
  [124, 'Daniel ALTMAIER', 'GER'],
  [125, 'Luca VAN ASSCHE', 'FRA'],
  [126, null, null, null, 'Q'],
  [128, 'Felix AUGER-ALIASSIME', 'CAN', 2]
];

const WTA_SLOTS = [
  [1, 'Aryna SABALENKA', null, 1],
  [3, null, null, null, 'Q'],
  [4, 'Cristina BUCSA', 'ESP'],
  [5, 'Yulia PUTINTSEVA', 'KAZ'],
  [6, 'Shuai ZHANG', 'CHN'],
  [8, 'Jelena OSTAPENKO', 'LAT', 26],
  [9, 'Maja CHWALINSKA', 'POL', 18],
  [11, 'Talia GIBSON', 'AUS'],
  [12, 'Elisabetta COCCIARETTO', 'ITA'],
  [13, null, null, null, 'Q'],
  [14, 'Camila OSORIO', 'COL'],
  [16, 'Ekaterina ALEXANDROVA', null, 16],
  [17, 'Elina SVITOLINA', 'UKR', 9],
  [19, 'Jessica BOUZAS MANEIRO', 'ESP'],
  [20, 'Ariana ARSENEAULT', 'CAN', null, 'WC'],
  [21, 'Elena-Gabriela RUSE', 'ROU'],
  [22, 'Peyton STEARNS', 'USA'],
  [24, 'Anastasia POTAPOVA', 'AUT', 24],
  [25, 'Clara TAUSON', 'DEN', 27],
  [27, 'Nikola BARTUNKOVA', 'CZE'],
  [28, 'Bianca ANDREESCU', 'CAN', null, 'WC'],
  [29, null, null, null, 'Q'],
  [30, null, null, null, 'Q'],
  [32, 'Amanda ANISIMOVA', 'USA', 8],
  [33, 'Jessica PEGULA', 'USA', 3],
  [35, 'Magdalena FRECH', 'POL'],
  [36, null, null, null, 'Q'],
  [37, 'Kamilla RAKHIMOVA', 'UZB'],
  [38, 'Venus WILLIAMS', 'USA', null, 'WC'],
  [40, 'Katerina SINIAKOVA', 'CZE', 32],
  [41, 'Anna KALINSKAYA', null, 17],
  [43, 'McCartney KESSLER', 'USA'],
  [44, 'Cadence BRACE', 'CAN', null, 'WC'],
  [45, null, null, null, 'Q'],
  [46, null, null, null, 'Q'],
  [48, 'Diana SHNAIDER', null, 15],
  [49, 'Marta KOSTYUK', 'UKR', 10],
  [51, null, null, null, 'Q'],
  [52, 'Katherine SEBOV', 'CAN', null, 'WC'],
  [53, null, null, null, 'Q'],
  [54, 'Antonia RUZIC', 'CRO'],
  [56, 'Madison KEYS', 'USA', 19],
  [57, 'Donna VEKIC', 'CRO', 31],
  [59, 'Kimberly BIRRELL', 'AUS'],
  [60, 'Viktorija GOLUBIC', 'SUI'],
  [61, 'Xiyu WANG', 'CHN'],
  [62, 'Sara BEJLEK', 'CZE'],
  [64, 'Iga SWIATEK', 'POL', 7],
  [65, 'Linda NOSKOVA', 'CZE', 6],
  [67, null, null, null, 'Q'],
  [68, 'Caty MCNALLY', 'USA'],
  [69, null, null, null, 'Q'],
  [70, 'Alycia PARKS', 'USA'],
  [72, 'Alexandra EALA', 'PHI', 25],
  [73, 'Marie BOUZKOVA', 'CZE', 21],
  [75, 'Tereza VALENTOVA', 'CZE'],
  [76, 'Taylor TOWNSEND', 'USA'],
  [77, 'Solana SIERRA', 'ARG'],
  [78, null, null, null, 'Q'],
  [80, 'Belinda BENCIC', 'SUI', 12],
  [81, 'Iva JOVIC', 'USA', 13],
  [83, 'Carol ZHAO', 'CAN', null, 'WC'],
  [84, 'Magda LINETTE', 'POL'],
  [85, null, null, null, 'Q'],
  [86, null, null, null, 'Q'],
  [88, 'Emma NAVARRO', 'USA', 23],
  [89, 'Maria SAKKARI', 'GRE', 29],
  [91, 'Rebecca MARINO', 'CAN', null, 'WC'],
  [92, 'Zeynep SONMEZ', 'TUR'],
  [93, 'Diane PARRY', 'FRA'],
  [94, null, null, null, 'Q'],
  [96, 'Coco GAUFF', 'USA', 4],
  [97, 'Mirra ANDREEVA', null, 5],
  [99, 'Oleksandra OLIYNYKOVA', 'UKR'],
  [100, 'Karolina PLISKOVA', 'CZE'],
  [101, 'Renata ZARAZUA', 'MEX'],
  [102, 'Tamara KORPATSCH', 'GER'],
  [104, 'Leylah FERNANDEZ', 'CAN', 30],
  [105, 'Elise MERTENS', 'BEL', 20],
  [107, 'Anhelina KALININA', 'UKR'],
  [108, 'Anna BONDAR', 'HUN'],
  [109, 'Panna UDVARDY', 'HUN'],
  [110, 'Eva LYS', 'GER'],
  [112, 'Naomi OSAKA', 'JPN', 11],
  [113, 'Sorana CIRSTEA', 'ROU', 14],
  [115, 'Yuliia STARODUBTSEVA', 'UKR'],
  [116, null, null, null, 'Q'],
  [117, 'Janice TJEN', 'INA'],
  [118, 'Liudmila SAMSONOVA', null],
  [120, 'Barbora KREJCIKOVA', 'CZE', 22],
  [121, 'Ann LI', 'USA', 28],
  [123, 'Katie BOULTER', 'GBR'],
  [124, 'Kayla CROSS', 'CAN', null, 'WC'],
  [125, 'Xinyu WANG', 'CHN'],
  [126, 'Daria KASATKINA', 'AUS'],
  [128, 'Elena RYBAKINA', 'KAZ', 2]
];

function decodeHtml(value = '') {
  return String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function personKey(value = '') {
  return normalizeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function reversedPersonKey(value = '') {
  const parts = personKey(value).split(' ').filter(Boolean);
  return parts.length >= 2 ? [...parts].reverse().join(' ') : '';
}

function parseNameMap(html = '') {
  const map = new Map();
  for (const match of html.matchAll(/<div class="d-flex align-center[^>]*>([\s\S]*?)<\/div>/gi)) {
    const block = match[1];
    const pname = block.match(/<pname\b([^>]*)>([\s\S]*?)<\/pname>/i);
    if (!pname) continue;
    const nameEn = decodeHtml(pname[1].match(/\balt=["']([^"']+)["']/i)?.[1] || '');
    if (!nameEn || /^(bye|qualifier)$/i.test(nameEn)) continue;
    const profileId = pname[1].match(/\bdata-id=["']([^"']+)["']/i)?.[1] || null;
    const nameZh = decodeHtml(pname[2].replace(/<span\b[^>]*entrySign[^>]*>[\s\S]*?<\/span>/gi, ''));
    const countryCode = block.match(/playerFlag[^>]+alt=["']([^"']+)["']/i)?.[1] || null;
    const key = personKey(nameEn);
    if (!key || map.has(key)) continue;
    map.set(key, { name_en: nameEn, name_zh: nameZh, profile_id: profileId, country_code: countryCode });
  }
  return map;
}

async function previousPlayerMap() {
  const map = new Map();
  const directory = 'data/manager/events';
  const files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort();
  for (const file of files) {
    const event = await readJson(path.join(directory, file));
    for (const player of event.players || []) {
      if (!player.name_en || player.is_qualifier_placeholder) continue;
      map.set(personKey(player.name_en), player);
    }
  }
  return map;
}

function entryType(code) {
  return ({ Q: 'qualifier', WC: 'wildcard', PR: 'protected_ranking' })[code] || 'direct_acceptance';
}

function buildPlayers({ tour, slots, officialUrl, zhUrl, nameMap, oldMap }) {
  const slotByPosition = new Map(slots.map((row) => [row[0], row]));
  let qualifierIndex = 0;
  const prelim = slots.map(([position, nameEn, countryCode, seed, code]) => {
    if (code === 'Q') {
      qualifierIndex += 1;
      const label = `Qualifier Q${qualifierIndex}`;
      return {
        name_en: label,
        name_zh: `资格赛选手 Q${qualifierIndex}`,
        profile_id: `QUAL-${qualifierIndex}`,
        country_code: null,
        seed: null,
        entry_type: 'qualifier',
        draw_position: position,
        photo_url: '',
        is_qualifier_placeholder: true,
        source: officialUrl,
        player_key: canonicalPlayerKey(tour, { name_en: label, draw_position: position, is_qualifier_placeholder: true }),
        name_zh_source: 'official draw qualifier placeholder',
        scores: { base: 50, surface: 50, draw: 50, form: 50, manual: 0 },
        price: 0
      };
    }

    const mapped = nameMap.get(personKey(nameEn)) || nameMap.get(reversedPersonKey(nameEn)) || {};
    const previous = oldMap.get(personKey(nameEn)) || {};
    const nameZh = mapped.name_zh || previous.name_zh || nameEn;
    const profileId = mapped.profile_id || previous.profile_id || null;
    const photoUrl = profileId ? `https://static.live-tennis.cn/pic/ts/${profileId}` : (previous.photo_url || '');
    return {
      name_en: nameEn,
      name_zh: nameZh,
      profile_id: profileId,
      country_code: countryCode || previous.country_code || null,
      seed: seed || null,
      entry_type: entryType(code),
      draw_position: position,
      photo_url: photoUrl,
      is_qualifier_placeholder: false,
      source: officialUrl,
      player_key: canonicalPlayerKey(tour, { name_en: nameEn }),
      name_zh_source: mapped.name_zh ? zhUrl : (previous.name_zh_source || previous.source || 'local reviewed history'),
      scores: { base: 50, surface: 50, draw: 50, form: 50, manual: 0 },
      price: 0
    };
  });

  const displayByPosition = new Map(prelim.map((player) => [player.draw_position, player.name_zh]));
  return prelim.map((player) => {
    const opponentPosition = player.draw_position % 2 ? player.draw_position + 1 : player.draw_position - 1;
    const opponent = displayByPosition.get(opponentPosition) || 'BYE';
    return {
      ...player,
      first_round: opponent,
      path_note: opponent === 'BYE' ? '首轮轮空。' : `首轮对阵 ${opponent}。`
    };
  });
}

async function main() {
  const [atpHtml, wtaHtml, oldMap] = await Promise.all([
    readFile('tmp/canada-atp-competitor-draw.html', 'utf8'),
    readFile('tmp/canada-wta-competitor-draw.html', 'utf8'),
    previousPlayerMap()
  ]);
  const atpNameMap = parseNameMap(atpHtml);
  const wtaNameMap = parseNameMap(wtaHtml);
  const atpPlayers = buildPlayers({
    tour: 'ATP', slots: ATP_SLOTS, officialUrl: ATP_DRAW_URL, zhUrl: ATP_NAME_MAP_URL,
    nameMap: atpNameMap, oldMap
  });
  const wtaPlayers = buildPlayers({
    tour: 'WTA', slots: WTA_SLOTS, officialUrl: WTA_DRAW_URL, zhUrl: WTA_NAME_MAP_URL,
    nameMap: wtaNameMap, oldMap
  });

  if (atpPlayers.length !== 96 || wtaPlayers.length !== 96) {
    throw new Error(`Official draw size mismatch: ATP=${atpPlayers.length}, WTA=${wtaPlayers.length}`);
  }
  for (const [tour, players] of [['ATP', atpPlayers], ['WTA', wtaPlayers]]) {
    const missingZh = players.filter((player) => !player.is_qualifier_placeholder && player.name_zh === player.name_en);
    if (missingZh.length) {
      console.warn(`${tour} Chinese names unresolved: ${missingZh.map((player) => player.name_en).join(', ')}`);
    }
  }

  const common = {
    season: 2026,
    name: 'National Bank Open presented by Rogers',
    level: '1000',
    surface: 'hard_out',
    end_date: '2026-08-13',
    country: 'Canada',
    timezone: 'America/Toronto',
    draw_status: 'published',
    market_status: 'open',
    submission_status: 'open',
    market_price_lock: {
      publication_version: 1,
      locked_at: '2026-08-01T07:24:33Z'
    },
    submission_opens_at: '2026-08-01T00:00:00+08:00',
    manual_schedule_windows: true,
    schedule_status: 'pending',
    main_draw_first_match_at: null,
    submission_cutoff_at: '2026-08-02T23:15:00+08:00',
    submission_closes_at: '2026-08-02T23:15:00+08:00',
    allow_submission_after_first_match: true,
    transfer_window_opens_at: '2026-08-04T12:30:00+08:00',
    transfer_window_closes_at: '2026-08-04T22:59:00+08:00',
    transfer_window_note: '本站换人窗口为 08/04 12:30 - 08/04 22:59；ATP/WTA 同一窗口开放，男女可互换，手续费 15%。',
    cross_tour_transfer: true,
    transfer_window_days: 2,
    transfer_fee_rate: 0.15,
    draw_size: 96
  };

  const atpEvent = {
    ...common,
    start_date: '2026-08-02',
    short_name: 'Montreal',
    name_zh: '蒙特利尔',
    city: 'Montreal',
    event_key: ATP_EVENT_KEY,
    tour: 'ATP',
    event_id: '421',
    display_name: 'ATP 加拿大大师赛·蒙特利尔',
    source_urls: [
      'https://www.atptour.com/en/tournaments/montreal/421/overview',
      ATP_DRAW_URL,
      ATP_NAME_MAP_URL
    ],
    market_message: 'ATP 蒙特利尔 96 人主签已按 ATP 官方 PDF 的 128 个签位逐位核对；16 个资格赛签位保留官方占位，名单确定后再替换。中文名/profile 映射不参与签表真值判断。',
    players: atpPlayers
  };

  const wtaEvent = {
    ...common,
    start_date: '2026-08-01',
    short_name: 'Toronto',
    name_zh: '多伦多',
    city: 'Toronto',
    event_key: WTA_EVENT_KEY,
    tour: 'WTA',
    event_id: '806',
    display_name: 'WTA 加拿大大师赛·多伦多',
    source_urls: [
      'https://www.wtatennis.com/tournaments/806/toronto/2026',
      WTA_DRAW_URL,
      WTA_NAME_MAP_URL
    ],
    market_message: 'WTA 多伦多 96 人主签已按 WTA 官方 PDF 的 128 个签位逐位核对；16 个资格赛签位保留官方占位，名单确定后再替换。中文名/profile 映射不参与签表真值判断。',
    players: wtaPlayers
  };

  const active = {
    season: 2026,
    station_key: '2026-w32-canada',
    station_name: 'ATP 蒙特利尔 + WTA 多伦多',
    survivor_aligned: true,
    status: 'open',
    rules: {
      station_grant: 1000,
      cross_tour_transfer: true,
      transfer_fee_rate: 0.15,
      combo_version: 'canada_2026_v1',
      combo_design_status: 'confirmed',
      combo: {
        total_cap: 700,
        steady: {
          min_players: 3,
          qf_ratio: 0.5,
          gross_rate: 0.1,
          cap: 300
        },
        dual_tour: { R16: 50, QF: 100, SF: 250, F: 450, W: 700 },
        value_pick: {
          max_price: 150,
          max_triggers: 1,
          R16: 150,
          QF: 250,
          SF: 350,
          F: 550,
          W: 700
        },
        village_hope: {
          selection: 'highest_original_price_at_submission',
          R16: 50,
          QF: 100,
          SF: 250,
          F: 400,
          W: 700
        },
        welfare: {
          principal_max: 500,
          min_players: 3,
          discount_rate: 0.2,
          cap: 300,
          max_uses_per_season: 3,
          excluded_from_combo_cap: true
        }
      }
    },
    pricing: {
      market_prices_locked: true,
      publication_version: 1,
      locked_at: '2026-08-01T07:24:33Z',
      reason: 'Canada opening prices were locked for publication v1.'
    },
    updated_at: nowIso(),
    notes: [
      '本站已正式开售；开售价格已按 publication v1 锁定，后续排名、Elo 或日常数据刷新不得改写本站签约价。',
      '本站签约金 1000；开售时间为北京时间 2026-08-01 00:00 至 2026-08-02 23:15。',
      '本站换人窗口为北京时间 2026-08-04 12:30 - 22:59；ATP/WTA 同一窗口开放，男女可互换，手续费为换入球员价格的 15%。',
      '本站四项赛果 Combo 合计封顶 700；低保办为提交时即时签约折扣，独立于 Combo 收益封顶。',
      'ATP/WTA 主签的签位、对阵、种子、赛事级别、城市和场地以 ATP/WTA 官方 PDF 为真源；第三方页面只补中文名与公开 profile ID。',
      'ATP、WTA 各有 16 个资格赛待定签位，当前按官方签位独立保留，资格赛完成后再逐位替换。'
    ],
    previous_station: {
      station_key: '2026-w31-washington',
      station_name: 'ATP Washington + WTA Washington',
      publication_version: 4,
      publication_file: 'publications/2026-w31-washington-v4.json',
      events: [
        { tour: 'ATP', event_key: 'atp-2026-w31-washington-mubadala-citi-dc-open', data_file: 'events/atp-2026-w31-washington.json', active: false },
        { tour: 'WTA', event_key: 'wta-2026-w31-washington-mubadala-citi-dc-open', data_file: 'events/wta-2026-w31-washington.json', active: false }
      ]
    },
    events: [
      { tour: 'ATP', event_key: ATP_EVENT_KEY, data_file: 'events/atp-2026-w32-montreal.json', active: true },
      { tour: 'WTA', event_key: WTA_EVENT_KEY, data_file: 'events/wta-2026-w32-toronto.json', active: true }
    ]
  };

  await Promise.all([
    writeJson('data/manager/events/atp-2026-w32-montreal.json', atpEvent),
    writeJson('data/manager/events/wta-2026-w32-toronto.json', wtaEvent),
    writeJson('data/manager/active_events.json', active)
  ]);

  console.log(`Prepared production station ${active.station_key}`);
  console.log(`ATP players=${atpPlayers.length} qualifiers=${atpPlayers.filter((p) => p.is_qualifier_placeholder).length}`);
  console.log(`WTA players=${wtaPlayers.length} qualifiers=${wtaPlayers.filter((p) => p.is_qualifier_placeholder).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
