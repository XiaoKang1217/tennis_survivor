#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { parseDrawPlayersFromAjax } from './lib/live-tennis-current-station.mjs';
import {
  canonicalPlayerKey,
  nowIso,
  writeJson
} from './lib/manager-utils.mjs';

const STATION_KEY = '2026-w35-us-open';
const ATP_EVENT_KEY = 'atp-2026-w35-us-open';
const WTA_EVENT_KEY = 'wta-2026-w35-us-open';
const DRAW_URL = 'https://www.live-tennis.cn/zh/draw/UO/2026';
const DRAW_AJAX_URL = 'https://www.live-tennis.cn/zh/draw/ajax/UO/2026/device/0/horizontal/true';
const SCHEDULE_URL = 'https://www.live-tennis.cn/zh/schedule/UO/2026';
const OFFICIAL_SCHEDULE_URL = 'https://www.usopen.org/en_US/about/eventschedule.html';

const SUBMISSION_OPENS_AT = '2026-08-28T09:15:00+08:00';
const MAIN_DRAW_FIRST_MATCH_AT = '2026-08-30T15:00:00.000Z';
const SUBMISSION_CUTOFF_AT = '2026-08-30T14:45:00.000Z';
const ROUND2_FIRST_MATCH_AT = '2026-09-02T15:00:00.000Z';
const TRANSFER_WINDOW_OPENS_AT = '2026-09-02T13:00:00+08:00';
const TRANSFER_WINDOW_CLOSES_AT = '2026-09-02T22:45:00+08:00';
const TRANSFER_WINDOW_NOTE = '本站换人窗口为 09/02 13:00 - 09/02 22:45；ATP/WTA 同一窗口开放，男女可互换，手续费 15%。换人时不管本金多少不再享受低保折扣。若换下提交时冻结的全村希望，换入球员自动继承全村希望。';

function expectedCount(tour) {
  return tour === 'ATP' ? 18 : 16;
}

function parsedPlayers(tour, ajaxHtml) {
  const players = parseDrawPlayersFromAjax(
    ajaxHtml,
    { tour, season: 2026, draw_size: 128 },
    DRAW_AJAX_URL
  ).map((player) => ({
    ...player,
    player_key: player.player_key || canonicalPlayerKey(tour, player),
    name_zh_source: DRAW_AJAX_URL,
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
    source: DRAW_AJAX_URL
  }));

  if (players.length !== 128) {
    throw new Error(`${tour} US Open draw expected 128 players, got ${players.length}.`);
  }
  const qualifierCount = players.filter((player) => player.is_qualifier_placeholder).length;
  if (qualifierCount !== expectedCount(tour)) {
    throw new Error(`${tour} US Open draw expected ${expectedCount(tour)} qualifier placeholders, got ${qualifierCount}.`);
  }
  const positions = new Set(players.map((player) => Number(player.draw_position)));
  if (positions.size !== 128) {
    throw new Error(`${tour} US Open draw has duplicated draw positions.`);
  }
  return players;
}

function eventShell({ tour, eventKey, displayName, players }) {
  return {
    season: 2026,
    name: 'US Open',
    short_name: 'US Open',
    name_zh: '美网',
    display_name: displayName,
    level: 'GS',
    surface: 'hard_out',
    draw_size: 128,
    start_date: '2026-08-30',
    end_date: '2026-09-13',
    city: 'New York',
    country: 'United States',
    timezone: 'America/New_York',
    event_key: eventKey,
    tour,
    event_id: 'UO',
    draw_status: 'published',
    market_status: 'open',
    market_price_lock: {
      publication_version: 1,
      locked_at: '2026-08-28T01:15:00.000Z'
    },
    submission_status: 'open',
    submission_opens_at: SUBMISSION_OPENS_AT,
    manual_schedule_windows: true,
    schedule_status: 'tournament_schedule_confirmed_oop_pending',
    main_draw_first_match_at: MAIN_DRAW_FIRST_MATCH_AT,
    submission_cutoff_at: SUBMISSION_CUTOFF_AT,
    submission_closes_at: SUBMISSION_CUTOFF_AT,
    round2_first_match_at: ROUND2_FIRST_MATCH_AT,
    allow_submission_after_first_match: false,
    cross_tour_transfer: true,
    transfer_window_days: 3,
    transfer_fee_rate: 0.15,
    transfer_window_opens_at: TRANSFER_WINDOW_OPENS_AT,
    transfer_window_closes_at: TRANSFER_WINDOW_CLOSES_AT,
    transfer_welfare_discount: false,
    transfer_window_note: TRANSFER_WINDOW_NOTE,
    source_urls: [
      DRAW_URL,
      DRAW_AJAX_URL,
      SCHEDULE_URL,
      OFFICIAL_SCHEDULE_URL
    ],
    market_message: `${displayName} 128 人主签已从 live-tennis 美网签表读取；资格赛占位待名单确定后替换。正赛第一比赛日按美网官方赛程为纽约 2026-08-30 11:00。`,
    official_draw_verification: {
      source: DRAW_AJAX_URL,
      draw_players_checked: players.length,
      qualifier_placeholders: players.filter((player) => player.is_qualifier_placeholder).length,
      method: 'live-tennis ajax draw position/player count verification'
    },
    players
  };
}

function usOpenCombo() {
  return {
    total_cap: 1200,
    steady: {
      min_players: 3,
      multi: {
        R32: 200,
        R16: 400,
        QF: 600,
        SF: 800
      }
    },
    dual_tour: {
      R32: 200,
      R16: 400,
      QF: 600,
      SF: 800,
      F: 1000,
      W: 1200
    },
    value_pick: {
      max_price: 300,
      max_triggers: 1,
      R32: 200,
      R16: 400,
      QF: 600,
      SF: 800,
      F: 1000,
      W: 1200
    },
    village_hope: {
      selection: 'user_selected_at_submission',
      R32: 200,
      R16: 400,
      QF: 600,
      SF: 800,
      F: 1000,
      W: 1200
    },
    welfare: {
      principal_max: 500,
      min_players: 3,
      discount_rate: 0.2,
      cap: 300,
      max_uses_per_season: 3,
      season_start: '2026-01-01',
      season_end: '2026-12-31',
      excluded_from_combo_cap: true
    }
  };
}

async function main() {
  const ajaxHtml = await readFile('tmp/usopen/live-usopen-ajax.html', 'utf8');
  const atpPlayers = parsedPlayers('ATP', ajaxHtml);
  const wtaPlayers = parsedPlayers('WTA', ajaxHtml);
  const combo = usOpenCombo();

  const atpEvent = eventShell({
    tour: 'ATP',
    eventKey: ATP_EVENT_KEY,
    displayName: 'ATP 美网',
    players: atpPlayers
  });
  const wtaEvent = eventShell({
    tour: 'WTA',
    eventKey: WTA_EVENT_KEY,
    displayName: 'WTA 美网',
    players: wtaPlayers
  });

  const active = {
    season: 2026,
    station_key: STATION_KEY,
    station_name: 'ATP 美网 + WTA 美网',
    survivor_aligned: true,
    status: 'open',
    announcement: '美网换人窗口已开启！0902 13:00-0902 22:45，手续费15%，男女可互换',
    daily_prediction: {
      starts_on: '2026-08-30',
      station_key: STATION_KEY,
      source_station_key: STATION_KEY,
      station_name: 'ATP 美网 + WTA 美网',
      events: [
        { tour: 'ATP', event_key: ATP_EVENT_KEY, data_file: 'events/atp-2026-w35-us-open.json', active: true },
        { tour: 'WTA', event_key: WTA_EVENT_KEY, data_file: 'events/wta-2026-w35-us-open.json', active: true }
      ]
    },
    rules: {
      station_grant: 2000,
      cross_tour_transfer: true,
      transfer_fee_rate: 0.15,
      transfer_welfare_discount: false,
      combo_version: 'us_open_2026_v1',
      combo_design_status: 'confirmed',
      combo
    },
    pricing: {
      market_prices_locked: true,
      publication_version: 1,
      price_version: 26082801,
      locked_at: '2026-08-28T01:15:00.000Z',
      reason: 'US Open opening prices are locked from publication v1; qualifier placements inherit the published Q-slot prices.'
    },
    updated_at: nowIso(),
    notes: [
      '本站签约金 2000；Combo 项目为双线经营、稳健经营、慧眼识珠、全村的希望，四项合计封顶 1200。',
      '提交时间从北京时间 2026-08-28 09:15 开始，截止北京时间 2026-08-30 22:45。',
      '稳健经营：阵容里≥3 人进入 R32/R16/QF/SF 分别 +200/+400/+600/+800，只取最高档。',
      '双线经营：ATP/WTA 各至少 1 人进入 R32/R16/QF/SF/F/W 分别 +200/+400/+600/+800/+1000/+1200，只取最高档。',
      '慧眼识珠：按购买价 ≤300 判断，低价球员进入 R32/R16/QF/SF/F/W 分别 +200/+400/+600/+800/+1000/+1200；单阵容最多触发 1 次，只取最高档。',
      '全村的希望由用户提交阵容时自定义选择：R32/R16/QF/SF/F/W 分别 +200/+400/+600/+800/+1000/+1200。',
      '低保办沿用提交时本金 ≤500、阵容至少 3 人、原价 20% 减免且最高 300 的规则；2026 赛季最多触发 3 次，已满 3 次不再享受。',
      '换人窗口从北京时间 2026-09-02 13:00 开放，截止北京时间 2026-09-02 22:45；ATP/WTA 同一窗口开放，男女可互换，手续费 15%；换人时不管本金多少不再享受低保折扣。',
      'Carlos Alcaraz 的状态分按运营口径人工校正为 50，并以该状态分重新定价。',
      '弹窗和自动榜单上下文仍保留 R1 门槛：美网 R1 正式开赛前继续展示辛辛那提收益；R1 开赛后切换本站。',
      'live-tennis 当前未发布正赛具体 OOP；R1 开赛闸门先按美网官方赛程 2026-08-30 11:00 New York / 2026-08-30 23:00 Beijing。'
    ],
    previous_station: {
      station_key: '2026-w33-cincinnati',
      station_name: 'ATP 辛辛那提 + WTA 辛辛那提',
      publication_version: 2,
      publication_file: 'publications/2026-w33-cincinnati-v2.json',
      events: [
        { tour: 'ATP', event_key: 'atp-2026-w33-cincinnati-cincinnati-open', data_file: 'events/atp-2026-w33-cincinnati.json', active: false },
        { tour: 'WTA', event_key: 'wta-2026-w33-cincinnati-cincinnati-open', data_file: 'events/wta-2026-w33-cincinnati.json', active: false }
      ]
    },
    events: [
      { tour: 'ATP', event_key: ATP_EVENT_KEY, data_file: 'events/atp-2026-w35-us-open.json', active: true },
      { tour: 'WTA', event_key: WTA_EVENT_KEY, data_file: 'events/wta-2026-w35-us-open.json', active: true }
    ]
  };

  await Promise.all([
    writeJson('data/manager/events/atp-2026-w35-us-open.json', atpEvent),
    writeJson('data/manager/events/wta-2026-w35-us-open.json', wtaEvent),
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
