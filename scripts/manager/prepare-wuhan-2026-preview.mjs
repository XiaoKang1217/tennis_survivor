import { readFile } from 'node:fs/promises';
import { parseDrawPlayersFromAjax } from './lib/live-tennis-current-station.mjs';
import { readJson, writeJson } from './lib/manager-utils.mjs';

const shanghai = await readJson('data/manager/active_events.json');
if (shanghai.station_key !== '2026-w41-shanghai') throw new Error('Expected Shanghai baseline');
const stationKey = '2026-w42-wuhan', eventKey = 'wta-2026-w42-wuhan';
const openedAt = new Date().toISOString(), cutoff = '2026-10-12T11:00:00+08:00';
const drawUrl = 'https://www.live-tennis.cn/zh/draw/31075/2026';
const ajaxUrl = 'https://www.live-tennis.cn/zh/draw/ajax/31075/2026/device/0/horizontal/true';
const players = parseDrawPlayersFromAjax(await readFile('/tmp/wuhan-draw.html','utf8'), {tour:'WTA',season:2026,draw_size:56}, ajaxUrl);
if (players.length !== 56) throw new Error(`Expected 56 players, got ${players.length}`);
await writeJson(`data/manager/events/${eventKey}.json`, {
  season:2026,station_key:stationKey,event_key:eventKey,tour:'WTA',event_id:'31075',
  name:'Wuhan Open',short_name:'Wuhan',name_zh:'武汉',display_name:'WTA 武汉',
  level:'1000',surface:'hard_out',draw_size:56,start_date:'2026-10-12',end_date:'2026-10-18',
  city:'Wuhan',country:'China',timezone:'Asia/Shanghai',draw_status:'published',
  market_status:'open',submission_status:'open',submission_opens_at:openedAt,
  submission_cutoff_at:cutoff,submission_closes_at:cutoff,manual_schedule_windows:true,
  schedule_status:'oop_pending',main_draw_first_match_at:null,round2_first_match_at:null,
  allow_submission_after_first_match:false,cross_tour_transfer:false,transfer_fee_rate:0.15,
  transfer_window_opens_at:null,transfer_window_closes_at:null,transfer_welfare_discount:false,
  source_urls:[drawUrl,ajaxUrl],market_message:'WTA 武汉1000，签约金700，本站限购1–4人，10/12 11:00截止。',players
});
const continuing = {station_key:shanghai.station_key,station_name:shanghai.station_name,
  publication_file:'publications/2026-w41-shanghai-v1.json',publication_version:1,
  events:shanghai.events.map(e=>({...e,active:false}))};
await writeJson('data/manager/active_events.json', {
  season:2026,station_key:stationKey,station_name:'WTA 武汉',survivor_aligned:false,status:'open',updated_at:openedAt,
  announcement:'WTA 武汉1000 已开售，签约金700，本次可选1–4人，10/12 11:00截止！ATP上海原阵容继续结算。',
  settlement:{overlap_previous:true,income_by_date:true},
  rules:structuredClone(shanghai.rules),
  pricing:{market_prices_locked:false,publication_version:1,price_version:26101101},
  daily_prediction:{starts_on:'2026-10-12',event_groups:[
    {tour:'ATP',event_key:'atp-2026-w41-shanghai',source_station_key:shanghai.station_key},
    {tour:'WTA',event_key:eventKey,source_station_key:stationKey}
  ]},
  display_groups:{current:{label:'ATP 上海 + WTA 武汉',station_keys:[shanghai.station_key,stationKey]},
    previous:{label:'ATP 北京 + WTA 北京',station_keys:['2026-w40-beijing']}},
  opening_notice:{key:'wuhan_2026_opening',rpc:'tour_manager_take_wuhan_opening_notice',
    closes_at:cutoff,message:'经纪人新站WTA 武汉1000赛开售！快来选购吧。'},
  previous_station:shanghai.previous_station,continuing_stations:[continuing],
  display_events:shanghai.events.map(e=>({...e,read_only:true})),
  events:[{tour:'WTA',event_key:eventKey,data_file:`events/${eventKey}.json`,active:true}]
});
console.log(`Wuhan players=${players.length}; qualifiers=${players.filter(p=>p.is_qualifier_placeholder).length}`);
