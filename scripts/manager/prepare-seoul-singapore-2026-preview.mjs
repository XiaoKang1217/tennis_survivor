#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseDrawPlayersFromAjax } from './lib/live-tennis-current-station.mjs';
import { parseArgs, writeJson } from './lib/manager-utils.mjs';

const stationKey = '2026-w39-seoul-singapore';
const sourceDir = parseArgs()['source-dir'] || '/private/tmp';
const opensAt = '2026-09-19T20:22:42+08:00';
const cutoff = '2026-09-21T09:45:00+08:00';
const definitions = [
  { slug: 'seoul', name: 'Korea Open', zh: '首尔', level: '250', size: 32, id: '31024', official: '1024', surface: 'hard_out', timezone: 'Asia/Seoul', country: 'South Korea' },
  { slug: 'singapore', name: 'Singapore Tennis Open', zh: '新加坡', level: '500', size: 28, id: '31152', official: '1152', surface: 'hard_in', timezone: 'Asia/Singapore', country: 'Singapore' }
];
const items = [];
for (const def of definitions) {
  const eventKey = `wta-2026-w39-${def.slug}`;
  const drawUrl = `https://www.live-tennis.cn/zh/draw/${def.id}/2026`;
  const ajaxUrl = `https://www.live-tennis.cn/zh/draw/ajax/${def.id}/2026/device/0/horizontal/true`;
  const officialUrl = `https://wtafiles.wtatennis.com/pdf/draws/2026/${def.official}/MDS.pdf`;
  const html = await readFile(`${sourceDir}/${def.slug}-draw-20260919.html`, 'utf8');
  const players = parseDrawPlayersFromAjax(html, { tour: 'WTA', season: 2026, draw_size: def.size }, ajaxUrl);
  if (players.length !== def.size || players.filter(p => p.is_qualifier_placeholder).length !== 4) {
    throw new Error(`${def.slug}: unexpected draw size / qualifier count: ${players.length}`);
  }
  for (const p of players) {
    // Q slots from two WTA events must remain distinct in the client and price map.
    if (p.is_qualifier_placeholder) p.player_key = `WTA|qualifier-${def.slug}-${p.draw_position}`;
  }
  const event = {
    season: 2026, station_key: stationKey, event_key: eventKey, tour: 'WTA', event_id: def.id,
    name: def.name, short_name: def.name, name_zh: def.zh, display_name: `WTA ${def.zh}`,
    level: def.level, surface: def.surface, draw_size: def.size,
    start_date: '2026-09-21', end_date: '2026-09-27', city: def.slug === 'seoul' ? 'Seoul' : 'Singapore',
    country: def.country, timezone: def.timezone,
    draw_status: 'published', market_status: 'open', submission_status: 'open',
    submission_opens_at: opensAt, submission_cutoff_at: cutoff, submission_closes_at: cutoff,
    manual_schedule_windows: true, schedule_status: 'oop_pending',
    main_draw_first_match_at: null, round2_first_match_at: null,
    allow_submission_after_first_match: false,
    cross_tour_transfer: false, transfer_fee_rate: 0.15,
    transfer_window_opens_at: null, transfer_window_closes_at: null,
    transfer_welfare_discount: false,
    source_urls: [drawUrl, ajaxUrl, `https://www.live-tennis.cn/zh/schedule/${def.id}/2026`, officialUrl],
    official_draw_verification: { source: officialUrl, draw_players_checked: players.length, qualifier_placeholders: 4, checked_at: opensAt },
    market_message: `WTA ${def.zh} ${def.level}，签约截止北京时间 09/21 09:45。`,
    players
  };
  await writeJson(`data/manager/events/${eventKey}.json`, event);
  items.push({ tour: 'WTA', event_key: eventKey, data_file: `events/${eventKey}.json`, active: true });
}
await writeJson('data/manager/active_events.json', {
  season: 2026, station_key: stationKey, station_name: 'WTA 首尔 + WTA 新加坡',
  survivor_aligned: false, status: 'open', updated_at: opensAt,
  announcement: 'WTA 首尔250 + WTA 新加坡500 已开售，09/21 09:45 截止！',
  rules: {
    station_grant: 500, cross_tour_transfer: false, transfer_fee_rate: 0.15, transfer_welfare_discount: false,
    combo_version: 'seoul_singapore_2026_v1', combo_design_status: 'confirmed',
    combo: {
      total_cap: 700,
      steady: { min_players: 2, qf_ratio: 0.5, gross_rate: 0.08, cap: 150 },
      dual_tour: { grouping: 'event', event_keys: items.map(i => i.event_key), labels: ['首尔','新加坡'], QF: 60, SF: 120, F: 200, W: 300 },
      value_pick: { max_price: 100, max_triggers: 1, QF: 60, SF: 120, F: 200, W: 300 },
      small_budget: { max_cost: 500, gross_multipliers: [0.75,1,1.25,1.5], bonuses: [50,100,150,200] },
      welfare: { principal_max: 500, min_players: 3, discount_rate: 0.2, cap: 300, max_uses_per_season: 3, season_start: '2026-01-01', season_end: '2026-12-31', excluded_from_combo_cap: true }
    }
  },
  pricing: { market_prices_locked: false, publication_version: 1, price_version: 26091901 },
  notes: [
    '首尔按 WTA 250 定价和结算，新加坡为 WTA 500。',
    '本站为双 WTA 特例；双线经营按首尔、新加坡各至少一人判断，后续常规站仍为 ATP + WTA。',
    '签约金 500；沿用华盛顿四项 Combo 档位，合计封顶 700；低保独立于封顶。',
    '北京时间 2026-09-19 20:22:42 开售，2026-09-21 09:45 截止。',
    '首场 R1 正式开赛前，收益弹窗和默认榜单继续显示美网；具体开赛时间待正式赛程确认。',
    '低保办：提交时本金不超过500，至少3人，原价减免20%且不超过300；2026赛季最多3次。'
  ],
  previous_station: {
    station_key: '2026-w35-us-open', station_name: 'ATP 美网 + WTA 美网', publication_version: 4,
    publication_file: 'publications/2026-w35-us-open-v4.json',
    events: ['atp','wta'].map(tour => ({ tour: tour.toUpperCase(), event_key: `${tour}-2026-w35-us-open`, data_file: `events/${tour}-2026-w35-us-open.json`, active: false }))
  },
  events: items
});
console.log(`Prepared ${stationKey}: ${items.length} WTA events`);
