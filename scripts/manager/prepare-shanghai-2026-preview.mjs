#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseDrawPlayersFromAjax } from './lib/live-tennis-current-station.mjs';
import { parseArgs, readJson, writeJson } from './lib/manager-utils.mjs';

const args = parseArgs();
const previous = await readJson('data/manager/active_events.json');
if (previous.station_key !== '2026-w40-beijing') throw new Error('Prepare only from the Beijing baseline');
const stationKey = '2026-w41-shanghai';
const eventKey = 'atp-2026-w41-shanghai';
const openedAt = new Date().toISOString();
const cutoff = '2026-10-07T11:45:00+08:00';
const drawUrl = 'https://www.live-tennis.cn/zh/draw/25014/2026';
const ajaxUrl = 'https://www.live-tennis.cn/zh/draw/ajax/25014/2026/device/0/horizontal/true';
const players = parseDrawPlayersFromAjax(await readFile(args.draw || '/tmp/shanghai-draw.html', 'utf8'), { tour: 'ATP', season: 2026, draw_size: 96 }, ajaxUrl);
if (players.length !== 96) throw new Error(`Expected 96 players, got ${players.length}`);
const event = {
  season: 2026, station_key: stationKey, event_key: eventKey, tour: 'ATP', event_id: '25014',
  name: 'Rolex Shanghai Masters', short_name: 'Shanghai', name_zh: '上海', display_name: 'ATP 上海',
  level: '1000', surface: 'hard_out', draw_size: 96, start_date: '2026-10-07', end_date: '2026-10-18',
  city: 'Shanghai', country: 'China', timezone: 'Asia/Shanghai', draw_status: 'published',
  market_status: 'open', submission_status: 'open', submission_opens_at: openedAt,
  submission_cutoff_at: cutoff, submission_closes_at: cutoff, manual_schedule_windows: true,
  schedule_status: 'oop_pending', main_draw_first_match_at: null, round2_first_match_at: null,
  allow_submission_after_first_match: false, cross_tour_transfer: false, transfer_fee_rate: 0.15,
  transfer_window_opens_at: null, transfer_window_closes_at: null, transfer_welfare_discount: false,
  source_urls: [drawUrl, ajaxUrl, 'https://www.live-tennis.cn/zh/schedule/25014/2026'],
  market_message: 'ATP 上海1000，本站限购1–4人，10/07 11:45截止。北京WTA原阵容继续结算。', players
};
await writeJson(`data/manager/events/${eventKey}.json`, event);
await writeJson('data/manager/active_events.json', {
  season: 2026, station_key: stationKey, station_name: 'ATP 上海', survivor_aligned: false,
  status: 'open', updated_at: openedAt,
  announcement: 'ATP 上海1000 已开售，签约金700，本站可选1–4人，10/07 11:45截止！北京WTA原阵容继续结算。',
  settlement: { overlap_previous: true, income_by_date: true },
  rules: {
    station_grant: 700, min_players: 1, max_players: 4, cross_tour_transfer: false,
    transfer_fee_rate: 0.15, transfer_welfare_discount: false,
    combo_version: 'canada_2026_v1', combo_design_status: 'confirmed',
    combo: {
      total_cap: 1000, steady: { min_players: 3, qf_ratio: 0.5, gross_rate: 0.15, cap: 300 },
      value_pick: { max_price: 150, max_triggers: 1, R16: 150, QF: 250, SF: 350, F: 550, W: 700 },
      village_hope: { selection: 'user_selected_at_submission', R16: 150, QF: 250, SF: 350, F: 550, W: 800 },
      welfare: previous.rules.combo.welfare
    }
  },
  pricing: { market_prices_locked: false, publication_version: 1, price_version: 26100601 },
  daily_prediction: {
    starts_on: '2026-10-07',
    event_groups: [
      { tour: 'ATP', event_key: eventKey, source_station_key: stationKey },
      { tour: 'WTA', event_key: 'wta-2026-w40-beijing', source_station_key: previous.station_key }
    ]
  },
  previous_station: {
    station_key: previous.station_key, station_name: previous.station_name,
    publication_version: 1, publication_file: 'publications/2026-w40-beijing-v1.json',
    events: previous.events.map(item => ({ ...item, active: false }))
  },
  events: [{ tour: 'ATP', event_key: eventKey, data_file: `events/${eventKey}.json`, active: true }]
});
console.log(`Prepared Shanghai: ${players.length} players; qualifiers=${players.filter(p => p.is_qualifier_placeholder).length}`);
