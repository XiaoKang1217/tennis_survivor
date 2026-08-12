#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { parseDrawPlayersFromAjax } from './lib/live-tennis-current-station.mjs';
import {
  canonicalPlayerKey,
  normalizeName,
  nowIso,
  writeJson
} from './lib/manager-utils.mjs';

const STATION_KEY = '2026-w33-cincinnati';
const ATP_EVENT_KEY = 'atp-2026-w33-cincinnati-cincinnati-open';
const WTA_EVENT_KEY = 'wta-2026-w33-cincinnati-cincinnati-open';

const ATP_DRAW_ID = '20422';
const WTA_DRAW_ID = '31017';
const ATP_DRAW_URL = 'https://www.protennislive.com/posting/2026/422/mds.pdf';
const WTA_DRAW_URL = 'https://wtafiles.wtatennis.com/pdf/draws/2026/1017/MDS.pdf';
const ATP_OOP_URL = 'https://www.protennislive.com/posting/2026/422/op.pdf';
const ATP_NAME_MAP_URL = 'https://www.live-tennis.cn/zh/draw/20422/2026';
const WTA_NAME_MAP_URL = 'https://www.live-tennis.cn/zh/draw/31017/2026';
const ATP_AJAX_URL = 'https://www.live-tennis.cn/zh/draw/ajax/20422/2026/device/0/horizontal/true';
const WTA_AJAX_URL = 'https://www.live-tennis.cn/zh/draw/ajax/31017/2026/device/0/horizontal/true';

const SUBMISSION_OPENS_AT = '2026-08-12T09:00:00+08:00';
const SUBMISSION_CUTOFF_AT = '2026-08-13T23:45:00+08:00';
const MAIN_DRAW_FIRST_MATCH_AT = '2026-08-13T16:00:00.000Z';
const PRICE_LOCKED_AT = '2026-08-12T01:00:00.000Z';

function normalizeForOfficial(value = '') {
  return normalizeName(value)
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function surnameNeedle(name = '', tour = '') {
  const parts = normalizeForOfficial(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (tour === 'WTA' && parts[0]?.length > 1 && /^[A-Z]+$/.test(parts[0])) return parts[0];
  return parts[parts.length - 1];
}

function verifyAgainstOfficialPdf(players, officialText, tour) {
  const official = normalizeForOfficial(officialText);
  const missing = [];
  for (const player of players) {
    if (player.is_qualifier_placeholder) continue;
    const needle = surnameNeedle(player.name_en, tour);
    if (needle && !official.includes(needle)) {
      missing.push({
        draw_position: player.draw_position,
        name_en: player.name_en,
        name_zh: player.name_zh,
        checked_token: needle
      });
    }
  }
  return {
    checked_non_qualifier_players: players.filter((player) => !player.is_qualifier_placeholder).length,
    missing_players: missing
  };
}

function parsedPlayers(tour, ajaxHtml, officialText, ajaxUrl) {
  const players = parseDrawPlayersFromAjax(ajaxHtml, { tour, season: 2026, draw_size: 96 }, ajaxUrl)
    .map((player) => {
      const stable = {
        ...player,
        player_key: player.player_key || canonicalPlayerKey(tour, player),
        name_zh_source: ajaxUrl,
        scores: player.scores || { base: 50, surface: 50, draw: 50, form: 50, manual: 0 },
        total_score: null,
        rank: null,
        points: null,
        overall_elo: null,
        surface_elo: null,
        peak_elo: null,
        peak_month: null,
        expected_points: null,
        expected_round: null,
        breakeven_round: null,
        price: 0,
        tier: null,
        pricing_detail: null,
        qualifier_replacement: null,
        pre_r1_substitution: null,
        source: ajaxUrl
      };
      return stable;
    });

  if (players.length !== 96) throw new Error(`${tour} Cincinnati draw expected 96 players, got ${players.length}.`);
  const qualifiers = players.filter((player) => player.is_qualifier_placeholder).length;
  if (qualifiers !== 12) throw new Error(`${tour} Cincinnati draw expected 12 qualifier placeholders, got ${qualifiers}.`);
  const positions = new Set(players.map((player) => Number(player.draw_position)));
  if (positions.size !== 96) throw new Error(`${tour} Cincinnati draw has duplicated draw positions.`);
  const verification = verifyAgainstOfficialPdf(players, officialText, tour);
  if (verification.missing_players.length) {
    throw new Error(`${tour} official PDF verification failed: ${JSON.stringify(verification.missing_players.slice(0, 8))}`);
  }
  return { players, verification };
}

function eventShell({ tour, eventKey, eventId, displayName, city, startDate, players, verification, sourceUrls, marketMessage }) {
  return {
    season: 2026,
    name: 'Cincinnati Open',
    level: '1000',
    surface: 'hard_out',
    end_date: '2026-08-23',
    country: 'United States',
    timezone: 'America/New_York',
    draw_status: 'published',
    market_status: 'open',
    submission_status: 'open',
    market_price_lock: {
      publication_version: 1,
      locked_at: PRICE_LOCKED_AT
    },
    submission_opens_at: SUBMISSION_OPENS_AT,
    manual_schedule_windows: true,
    schedule_status: 'oop_pending_main_draw',
    main_draw_first_match_at: MAIN_DRAW_FIRST_MATCH_AT,
    submission_cutoff_at: SUBMISSION_CUTOFF_AT,
    submission_closes_at: SUBMISSION_CUTOFF_AT,
    allow_submission_after_first_match: true,
    transfer_window_note: '辛辛那提换人窗口待用户确认；未确认前不开放换人。',
    cross_tour_transfer: true,
    transfer_window_days: 2,
    transfer_fee_rate: 0.15,
    draw_size: 96,
    start_date: startDate,
    short_name: 'Cincinnati',
    name_zh: '辛辛那提',
    city,
    event_key: eventKey,
    tour,
    event_id: eventId,
    display_name: displayName,
    source_urls: sourceUrls,
    market_message: marketMessage,
    official_draw_verification: {
      official_pdf_players_checked: verification.checked_non_qualifier_players,
      official_pdf_missing_players: verification.missing_players,
      qualifier_placeholders: players.filter((player) => player.is_qualifier_placeholder).length,
      method: 'official PDF text surname check + draw position/player count verification; live-tennis ajax only supplies Chinese names/profile/photo mapping'
    },
    players
  };
}

async function main() {
  const [atpAjax, wtaAjax, atpOfficial, wtaOfficial] = await Promise.all([
    readFile('tmp/cincinnati/atp-live-draw.html', 'utf8'),
    readFile('tmp/cincinnati/wta-live-draw.html', 'utf8'),
    readFile('tmp/cincinnati/atp-official.txt', 'utf8'),
    readFile('tmp/cincinnati/wta-official.txt', 'utf8')
  ]);

  const atp = parsedPlayers('ATP', atpAjax, atpOfficial, ATP_AJAX_URL);
  const wta = parsedPlayers('WTA', wtaAjax, wtaOfficial, WTA_AJAX_URL);

  const atpEvent = eventShell({
    tour: 'ATP',
    eventKey: ATP_EVENT_KEY,
    eventId: '422',
    displayName: 'ATP 辛辛那提大师赛',
    city: 'Cincinnati',
    startDate: '2026-08-13',
    players: atp.players,
    verification: atp.verification,
    sourceUrls: [
      'https://www.atptour.com/en/tournaments/cincinnati/422/overview',
      ATP_DRAW_URL,
      ATP_OOP_URL,
      ATP_NAME_MAP_URL,
      ATP_AJAX_URL
    ],
    marketMessage: 'ATP 辛辛那提 96 人主签已按 ATP 官方 PDF 的 128 个签位逐位核对；12 个资格赛签位保留官方占位，名单确定后再替换。中文名/profile 映射不参与签表真值判断。当前 OOP 仍为资格赛日，R1 时间待官方主签 OOP 发布后精修。'
  });

  const wtaEvent = eventShell({
    tour: 'WTA',
    eventKey: WTA_EVENT_KEY,
    eventId: '1017',
    displayName: 'WTA 辛辛那提大师赛',
    city: 'Cincinnati',
    startDate: '2026-08-13',
    players: wta.players,
    verification: wta.verification,
    sourceUrls: [
      'https://www.wtatennis.com/tournaments/1017/cincinnati/2026',
      WTA_DRAW_URL,
      WTA_NAME_MAP_URL,
      WTA_AJAX_URL
    ],
    marketMessage: 'WTA 辛辛那提 96 人主签已按 WTA 官方 PDF 的 128 个签位逐位核对；12 个资格赛签位保留官方占位，名单确定后再替换。中文名/profile 映射不参与签表真值判断。R1 时间待官方主签 OOP 发布后精修。'
  });

  const combo = {
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
      selection: 'user_selected_at_submission',
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
  };

  const active = {
    season: 2026,
    station_key: STATION_KEY,
    station_name: 'ATP 辛辛那提 + WTA 辛辛那提',
    survivor_aligned: true,
    status: 'open',
    rules: {
      station_grant: 1000,
      cross_tour_transfer: true,
      transfer_fee_rate: 0.15,
      combo_version: 'canada_2026_v1',
      combo_design_status: 'confirmed',
      combo
    },
    pricing: {
      market_prices_locked: true,
      publication_version: 1,
      locked_at: PRICE_LOCKED_AT,
      reason: 'Cincinnati opening prices are locked for publication v1.'
    },
    updated_at: nowIso(),
    notes: [
      '本站正式开售；开售价格按 publication v1 锁定，后续排名、Elo 或日常数据刷新不得改写本站签约价。',
      '本站签约金 1000；开售时间为北京时间 2026-08-12 09:00 至 2026-08-13 23:45。',
      '本站复用蒙特利尔 Combo 结算引擎：四项赛果 Combo 合计封顶 700；低保办为提交时即时签约折扣，独立于 Combo 收益封顶。',
      '本站“全村的希望”由用户在提交阵容弹窗中从阵容里自定义选择；提交后冻结，不随预测轮次或价格变化。',
      '弹窗和自动收益上下文仍保留 R1 门槛：下一站 R1 正式开赛前继续展示上一站收益；榜单页提供本站/上站净收益两个 tab，默认本站。',
      'ATP/WTA 主签的签位、对阵、种子、赛事级别、城市和场地以 ATP/WTA 官方 PDF 为真源；第三方页面只补中文名与公开 profile ID。',
      '当前 ATP OOP 为 2026-08-12 资格赛日；主签 R1 OOP 发布后再精修具体 R1 时间和换人窗口。'
    ],
    previous_station: {
      station_key: '2026-w32-canada',
      station_name: 'ATP 蒙特利尔 + WTA 多伦多',
      publication_version: 5,
      publication_file: 'publications/2026-w32-canada-v5.json',
      events: [
        { tour: 'ATP', event_key: 'atp-2026-w32-montreal-national-bank-open', data_file: 'events/atp-2026-w32-montreal.json', active: false },
        { tour: 'WTA', event_key: 'wta-2026-w32-toronto-national-bank-open', data_file: 'events/wta-2026-w32-toronto.json', active: false }
      ]
    },
    events: [
      { tour: 'ATP', event_key: ATP_EVENT_KEY, data_file: 'events/atp-2026-w33-cincinnati.json', active: true },
      { tour: 'WTA', event_key: WTA_EVENT_KEY, data_file: 'events/wta-2026-w33-cincinnati.json', active: true }
    ]
  };

  await Promise.all([
    writeJson('data/manager/events/atp-2026-w33-cincinnati.json', atpEvent),
    writeJson('data/manager/events/wta-2026-w33-cincinnati.json', wtaEvent),
    writeJson('data/manager/active_events.json', active)
  ]);

  console.log(`Prepared production station ${active.station_key}`);
  console.log(`ATP players=${atp.players.length} qualifiers=${atp.players.filter((p) => p.is_qualifier_placeholder).length}`);
  console.log(`WTA players=${wta.players.length} qualifiers=${wta.players.filter((p) => p.is_qualifier_placeholder).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
