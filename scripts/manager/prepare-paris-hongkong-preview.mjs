import { readFile } from 'node:fs/promises';
import { parseDrawPlayersFromAjax } from './lib/live-tennis-current-station.mjs';
import { readJson, writeJson } from './lib/manager-utils.mjs';

const previous = await readJson('data/manager/active_events.json');
if (previous.station_key !== '2026-w44-basel-vienna-tokyo') throw new Error('Expected Basel/Vienna/Tokyo baseline');
const stationKey = '2026-w45-paris-hongkong';
const name = 'ATP 巴黎1000 + WTA 香港250';
const now = new Date().toISOString();
const cutoff = '2026-11-02T11:00:00+08:00';
const items = [];
for (const d of [
  {slug:'paris',id:'20352',tour:'ATP',name:'Rolex Paris Masters',zh:'巴黎',level:'1000',size:56,surface:'hard_in',timezone:'Europe/Paris',country:'France'},
  {slug:'hongkong',id:'31074',tour:'WTA',name:'Hong Kong Tennis Open',zh:'香港',level:'250',size:32,surface:'hard_out',timezone:'Asia/Hong_Kong',country:'China'}
]) {
  const key = `${d.tour.toLowerCase()}-2026-w45-${d.slug}`;
  const source = `https://www.live-tennis.cn/zh/draw/ajax/${d.id}/2026/device/0/horizontal/true`;
  const players = parseDrawPlayersFromAjax(await readFile(`/tmp/${d.slug}-draw-20261031.html`,'utf8'),{tour:d.tour,season:2026,draw_size:d.size},source);
  for (const player of players) if (player.is_qualifier_placeholder) player.player_key = `${d.tour}|qualifier-${d.slug}-${player.draw_position}`;
  if (players.length !== d.size || new Set(players.map(p=>p.player_key)).size !== players.length) throw new Error(`Invalid ${d.slug} draw`);
  await writeJson(`data/manager/events/${key}.json`,{
    season:2026,station_key:stationKey,event_key:key,tour:d.tour,event_id:d.id,
    name:d.name,short_name:d.slug,name_zh:d.zh,display_name:`${d.tour} ${d.zh}`,
    level:d.level,surface:d.surface,draw_size:d.size,city:d.slug,country:d.country,timezone:d.timezone,
    start_date:'2026-11-02',end_date:'2026-11-08',draw_status:'published',market_status:'open',submission_status:'open',
    submission_opens_at:now,submission_cutoff_at:cutoff,submission_closes_at:cutoff,manual_schedule_windows:true,
    schedule_status:'oop_pending',main_draw_first_match_at:null,round2_first_match_at:null,
    allow_submission_after_first_match:false,cross_tour_transfer:true,transfer_fee_rate:0.15,
    transfer_window_opens_at:null,transfer_window_closes_at:null,transfer_welfare_discount:false,
    source_urls:[`https://www.live-tennis.cn/zh/draw/${d.id}/2026`,source],
    market_message:`${d.tour} ${d.zh}${d.level}，11/02 11:00截止。`,players
  });
  items.push({tour:d.tour,event_key:key,data_file:`events/${key}.json`,active:true});
}
const rewards={R16:50,QF:150,SF:250,F:400,W:550};
await writeJson('data/manager/active_events.json',{
  season:2026,station_key:stationKey,station_name:name,survivor_aligned:false,status:'open',updated_at:now,
  announcement:'ATP 巴黎1000 + WTA 香港250 已开售，签约金700，本站可选1–5人，11/02 11:00截止！',
  settlement:{overlap_previous:true,income_by_date:true},
  rules:{station_grant:700,cross_tour_transfer:true,transfer_fee_rate:0.15,transfer_welfare_discount:false,
    combo_version:'canada_2026_v1',combo_design_status:'confirmed',combo:{
      total_cap:1000,steady:{min_players:3,qualifying_round:'R16',qf_ratio:0.5,gross_rate:0.1,cap:300},
      dual_tour:{grouping:'tour',...rewards},value_pick:{max_price:120,max_triggers:1,...rewards},
      village_hope:{selection:'user_selected_at_submission',...rewards},
      welfare:{principal_max:500,min_players:3,discount_rate:0.2,cap:300,max_uses_per_season:3,season_start:'2026-01-01',season_end:'2026-12-31',excluded_from_combo_cap:true}
    }},
  pricing:{market_prices_locked:false,publication_version:1,price_version:26103101},
  daily_prediction:{starts_on:'2026-11-02',event_groups:items.map(x=>({tour:x.tour,event_key:x.event_key,source_station_key:stationKey}))},
  display_groups:{current:{label:name,station_keys:[stationKey]},previous:{label:previous.station_name,station_keys:[previous.station_key]}},
  opening_notice:{key:'paris_hongkong_2026_opening',rpc:'tour_manager_take_paris_hongkong_opening_notice',closes_at:cutoff,message:'经纪人新站ATP巴黎+WTA香港开售！快来选购吧。'},
  previous_station:{station_key:previous.station_key,station_name:previous.station_name,publication_file:`publications/${previous.station_key}-v1.json`,publication_version:1,events:previous.events.map(x=>({...x,active:false}))},
  continuing_stations:[],display_events:[],events:items
});
console.log('Prepared Paris/Hong Kong locally; no database writes');
