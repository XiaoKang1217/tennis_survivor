import { readJson, writeJson } from './lib/manager-utils.mjs';
const active = await readJson('data/manager/active_events.json');
if (active.station_key !== '2026-w41-shanghai' || active.pricing.market_prices_locked) throw new Error('Expected unpublished Shanghai pricing');
const event = await readJson('data/manager/'+active.events[0].data_file);
if (event.players.length!==96 || event.players.some(p=>!Number.isFinite(p.price)||p.price<=0)) throw new Error('Incomplete market');
const prices=event.players.filter(p=>!p.is_qualifier_placeholder).map(p=>p.price).sort((a,b)=>a-b);
const threshold=prices[Math.ceil(prices.length*0.4)-1];
active.rules.combo.value_pick.max_price=threshold;
active.rules.combo.value_pick.threshold_basis={method:'opening_non_qualifier_price_40th_percentile',players:prices.length,threshold};
active.pricing={...active.pricing,market_prices_locked:true,locked_at:new Date().toISOString(),reason:'Opening Shanghai prices frozen, including qualifier slots'};
event.market_price_lock={publication_version:active.pricing.publication_version,locked_at:active.pricing.locked_at};
await writeJson('data/manager/'+active.events[0].data_file,event);
active.notes=[
  '上海单独购买1-4人，签约金700；北京WTA保留北京站原合同、原价格和原Combo。',
  `慧眼识珠阈值${threshold}：按开售时84名非资格赛占位球员价格的40%分位确定。`,
  '排名读取于2026-10-06；Tennis Abstract当前最新Elo为2026-09-28。Rune不在该Elo榜内，沿用既有排名代理算法并明确标注。',
  '仅本地预览，尚未执行上海人数特例migration或同步线上。'
];
await writeJson('data/manager/active_events.json',active);
await writeJson('outputs/manager-sync/shanghai-opening-source-summary.json',{
  fetched_at:new Date().toISOString(),rank_source_updated:'2026-10-06 09:09:12',
  elo_source_updated:'2026-09-28',rank_rows:1200,elo_rows:557,
  draw_players:event.players.length,qualifier_slots:event.players.filter(p=>p.is_qualifier_placeholder).length,
  value_pick_threshold:threshold,value_pick_named_players:prices.filter(p=>p<=threshold).length,
  elo_proxy_players:event.players.filter(p=>p.pricing_detail?.elo_source_kind!=='tennis_abstract'&&!p.is_qualifier_placeholder).map(p=>p.name_en)
});
console.log(`Locked Shanghai prices; value-pick threshold=${threshold}`);
