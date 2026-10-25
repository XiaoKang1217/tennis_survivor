import { readFile } from 'node:fs/promises';
import { parseDrawPlayersFromAjax } from './lib/live-tennis-current-station.mjs';
import { readJson, writeJson } from './lib/manager-utils.mjs';

const previous = await readJson('data/manager/active_events.json');
if (previous.station_key !== '2026-w43-almaty-ningbo') throw new Error('Expected Almaty/Ningbo baseline');
const stationKey = '2026-w44-basel-vienna-tokyo';
const name = 'ATP 巴塞尔 + ATP 维也纳 + WTA 东京';
const now = new Date().toISOString();
const cutoff = '2026-10-26T11:00:00+08:00';
const items = [];
for (const d of [
  {slug:'basel',id:'20328',tour:'ATP',name:'Swiss Indoors Basel',zh:'巴塞尔',size:32,surface:'hard_in',timezone:'Europe/Zurich',country:'Switzerland'},
  {slug:'vienna',id:'20337',tour:'ATP',name:'Erste Bank Open',zh:'维也纳',size:32,surface:'hard_in',timezone:'Europe/Vienna',country:'Austria'},
  {slug:'tokyo',id:'31056',tour:'WTA',name:'Toray Pan Pacific Open',zh:'东京',size:28,surface:'hard_out',timezone:'Asia/Tokyo',country:'Japan'}
]) {
  const key = `${d.tour.toLowerCase()}-2026-w44-${d.slug}`;
  const source = `https://www.live-tennis.cn/zh/draw/ajax/${d.id}/2026/device/0/horizontal/true`;
  const corrections = d.slug === 'basel' ? [{draw_position:2,expected_profile_id:'RH16',confirmed_position:16,
    source_url:'https://www.protennislive.com/posting/2026/328/mds.pdf',
    reason:'Official draw released 2026-10-24 21:08:21: Ruud moved to slot 16 after Bublik withdrawal',
    replacement:{profile_id:'QUAL',name_en:'Qualifier / Lucky Loser',name_zh:'资格赛／幸运落败者',seed:null,seed_label:'',country_code:null,entry_type:'qualifier',is_qualifier_placeholder:true}}] : [];
  const players = parseDrawPlayersFromAjax(await readFile(`/tmp/${d.slug}-draw-20261025.html`,'utf8'),{tour:d.tour,season:2026,draw_size:d.size,draw_source_corrections:corrections},source);
  for (const player of players) {
    if (player.is_qualifier_placeholder) player.player_key = `${d.tour}|qualifier-${d.slug}-${player.draw_position}`;
  }
  if (players.length !== d.size) throw new Error(`Incomplete ${d.slug} draw`);
  if (new Set(players.map(p=>p.player_key)).size !== players.length) throw new Error(`Duplicate identities in ${d.slug}; confirm source before pricing`);
  await writeJson(`data/manager/events/${key}.json`,{
    season:2026,station_key:stationKey,event_key:key,tour:d.tour,event_id:d.id,
    name:d.name,short_name:d.slug,name_zh:d.zh,display_name:`${d.tour} ${d.zh}`,
    level:'500',surface:d.surface,draw_size:d.size,city:d.slug,country:d.country,timezone:d.timezone,
    start_date:'2026-10-26',end_date:'2026-11-01',draw_status:'published',market_status:'open',submission_status:'open',
    submission_opens_at:now,submission_cutoff_at:cutoff,submission_closes_at:cutoff,manual_schedule_windows:true,
    schedule_status:'oop_pending',main_draw_first_match_at:null,round2_first_match_at:null,
    allow_submission_after_first_match:false,cross_tour_transfer:true,transfer_fee_rate:0.1,
    transfer_window_opens_at:null,transfer_window_closes_at:null,transfer_welfare_discount:false,
    source_urls:[`https://www.live-tennis.cn/zh/draw/${d.id}/2026`,source],
    draw_source_corrections:corrections,market_message:`${d.tour} ${d.zh}500，10/26 11:00截止。`,players
  });
  items.push({tour:d.tour,event_key:key,data_file:`events/${key}.json`,active:true});
}
await writeJson('data/manager/active_events.json',{
  season:2026,station_key:stationKey,station_name:name,survivor_aligned:false,status:'open',updated_at:now,
  announcement:'ATP 巴塞尔500 + ATP 维也纳500 + WTA 东京500 已开售，签约金700，本站可选1–6人，10/26 11:00截止！',
  settlement:{overlap_previous:true,income_by_date:true},
  rules:{station_grant:700,min_players:1,max_players:6,cross_tour_transfer:true,transfer_fee_rate:0.1,transfer_welfare_discount:false,
    combo_version:'seoul_singapore_2026_v1',combo_design_status:'confirmed',combo:{
      total_cap:1000,steady:{min_players:3,qf_ratio:0.5,gross_rate:0.1,cap:300},
      dual_tour:{grouping:'tour',QF:150,SF:250,F:350,W:450},
      value_pick:{max_price:80,max_triggers:1,QF:150,SF:250,F:350,W:450},
      small_budget:{max_cost:700,gross_multipliers:[0.75,1,1.25,1.5],bonuses:[150,200,250,300]},
      welfare:{principal_max:500,min_players:3,discount_rate:0.2,cap:300,max_uses_per_season:3,season_start:'2026-01-01',season_end:'2026-12-31',excluded_from_combo_cap:true}
    }},
  pricing:{market_prices_locked:false,publication_version:1,price_version:26102501},
  daily_prediction:{starts_on:'2026-10-26',event_groups:items.filter(x=>!x.event_key.endsWith('-basel')).map(x=>({tour:x.tour,event_key:x.event_key,source_station_key:stationKey}))},
  display_groups:{current:{label:name,station_keys:[stationKey]},previous:{label:previous.station_name,station_keys:[previous.station_key]}},
  opening_notice:{key:'basel_vienna_tokyo_2026_opening',rpc:'tour_manager_take_basel_vienna_tokyo_opening_notice',closes_at:cutoff,message:'经纪人新站ATP巴塞尔+ATP维也纳+WTA东京开售！快来选购吧。'},
  previous_station:{station_key:previous.station_key,station_name:previous.station_name,publication_file:`publications/${previous.station_key}-v1.json`,publication_version:1,events:previous.events.map(x=>({...x,active:false}))},
  continuing_stations:[],display_events:[],events:items
});
console.log('Prepared three-event station locally');
