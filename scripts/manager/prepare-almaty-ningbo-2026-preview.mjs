import { readFile } from 'node:fs/promises';
import { parseDrawPlayersFromAjax } from './lib/live-tennis-current-station.mjs';
import { readJson, writeJson } from './lib/manager-utils.mjs';

const previous = await readJson('data/manager/active_events.json');
if (previous.station_key !== '2026-w42-wuhan') throw new Error('Expected Wuhan baseline');
const stationKey = '2026-w43-almaty-ningbo';
const opensAt = new Date().toISOString(), cutoff = '2026-10-18T11:00:00+08:00';
const items = [];
for (const def of [
  { slug:'almaty', tour:'ATP', id:'29410', name:'Almaty Open', zh:'阿拉木图', level:'250', surface:'hard_in', timezone:'Asia/Almaty', country:'Kazakhstan', qualifiers:4 },
  { slug:'ningbo', tour:'WTA', id:'32092', name:'Ningbo Open', zh:'宁波', level:'500', surface:'hard_out', timezone:'Asia/Shanghai', country:'China', qualifiers:7 }
]) {
  const eventKey = `${def.tour.toLowerCase()}-2026-w43-${def.slug}`;
  const drawUrl = `https://www.live-tennis.cn/zh/draw/${def.id}/2026`;
  const ajaxUrl = `https://www.live-tennis.cn/zh/draw/ajax/${def.id}/2026/device/0/horizontal/true`;
  const players = parseDrawPlayersFromAjax(await readFile(`/tmp/${def.slug}-draw-20261017.html`, 'utf8'), {tour:def.tour,season:2026,draw_size:28}, ajaxUrl);
  if (players.length !== 28 || players.filter(p=>p.is_qualifier_placeholder).length !== def.qualifiers) throw new Error(`Unexpected ${def.slug} draw`);
  await writeJson(`data/manager/events/${eventKey}.json`, {
    season:2026, station_key:stationKey, event_key:eventKey, tour:def.tour, event_id:def.id,
    name:def.name, short_name:def.slug, name_zh:def.zh, display_name:`${def.tour} ${def.zh}`,
    level:def.level, surface:def.surface, draw_size:28, city:def.slug, country:def.country, timezone:def.timezone,
    start_date:'2026-10-19', end_date:'2026-10-25', draw_status:'published', market_status:'open', submission_status:'open',
    submission_opens_at:opensAt, submission_cutoff_at:cutoff, submission_closes_at:cutoff, manual_schedule_windows:true,
    schedule_status:'oop_pending', main_draw_first_match_at:null, round2_first_match_at:null,
    allow_submission_after_first_match:false, cross_tour_transfer:true, transfer_fee_rate:0.1,
    transfer_window_opens_at:null, transfer_window_closes_at:null, transfer_welfare_discount:false,
    source_urls:[drawUrl,ajaxUrl], market_message:`${def.tour} ${def.zh}${def.level}，10/18 11:00截止。`, players
  });
  items.push({tour:def.tour,event_key:eventKey,data_file:`events/${eventKey}.json`,active:true});
}
await writeJson('data/manager/active_events.json', {
  season:2026,station_key:stationKey,station_name:'ATP 阿拉木图 + WTA 宁波',survivor_aligned:false,status:'open',updated_at:opensAt,
  announcement:'ATP 阿拉木图250 + WTA 宁波500 已开售，签约金600，可选1–4人，10/18 11:00截止！',
  settlement:{overlap_previous:true,income_by_date:true},
  rules:{station_grant:600,min_players:1,max_players:4,cross_tour_transfer:true,transfer_fee_rate:0.1,transfer_welfare_discount:false,
    combo_version:'seoul_singapore_2026_v1',combo_design_status:'confirmed',
    combo:{total_cap:600,steady:{min_players:2,qf_ratio:0.5,gross_rate:0.08,cap:120},
      dual_tour:{grouping:'event',event_keys:items.map(x=>x.event_key),labels:['ATP 阿拉木图','WTA 宁波'],QF:50,SF:100,F:170,W:250},
      value_pick:{max_price:100,max_triggers:1,QF:50,SF:100,F:170,W:250},
      small_budget:{max_cost:600,gross_multipliers:[0.75,1,1.25,1.5],bonuses:[50,100,150,200]},
      welfare:{principal_max:500,min_players:3,discount_rate:0.2,cap:300,max_uses_per_season:3,season_start:'2026-01-01',season_end:'2026-12-31',excluded_from_combo_cap:true}}},
  pricing:{market_prices_locked:false,publication_version:1,price_version:26101701},
  daily_prediction:{starts_on:'2026-10-18',event_groups:items.map(x=>({tour:x.tour,event_key:x.event_key,source_station_key:stationKey}))},
  display_groups:{current:{label:'ATP 阿拉木图 + WTA 宁波',station_keys:[stationKey]},previous:{label:'ATP 上海 + WTA 武汉',station_keys:['2026-w41-shanghai','2026-w42-wuhan']}},
  opening_notice:{key:'almaty_ningbo_2026_opening',rpc:'tour_manager_take_almaty_ningbo_opening_notice',closes_at:cutoff,message:'经纪人新站ATP阿拉木图+WTA宁波开售！快来选购吧。'},
  previous_station:{station_key:previous.station_key,station_name:previous.station_name,publication_file:'publications/2026-w42-wuhan-v1.json',publication_version:1,events:previous.events.map(x=>({...x,active:false}))},
  continuing_stations:previous.continuing_stations,display_events:[],events:items
});
console.log('Prepared Almaty + Ningbo locally: 56 slots');
