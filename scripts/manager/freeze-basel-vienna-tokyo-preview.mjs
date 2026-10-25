import { readJson, writeJson } from './lib/manager-utils.mjs';
const active = await readJson('data/manager/active_events.json');
if (active.station_key !== '2026-w44-basel-vienna-tokyo' || active.pricing.market_prices_locked) throw new Error('Expected unlocked new station');
const report = await readJson(`outputs/manager-sync/${active.station_key}-build-prices.json`);
if (report.unresolvedSources.length) throw new Error('Unresolved pricing sources');
const events = [];
for (const item of active.events) {
  const event = await readJson('data/manager/'+item.data_file);
  if (event.players.length !== event.draw_size || event.players.some(p=>!Number.isFinite(p.price)||p.price<=0)) throw new Error('Incomplete prices');
  events.push({item,event});
}
const prices = events.flatMap(x=>x.event.players).filter(p=>!p.is_qualifier_placeholder).map(p=>p.price).sort((a,b)=>a-b);
const threshold = prices[Math.ceil(prices.length*0.4)-1];
active.rules.combo.value_pick.max_price = threshold;
active.rules.combo.value_pick.threshold_basis = {method:'opening_non_qualifier_price_40th_percentile',players:prices.length,threshold};
active.pricing = {...active.pricing,market_prices_locked:true,locked_at:new Date().toISOString(),reason:'Opening prices frozen by original draw slot, including qualifiers'};
active.notes = [`慧眼识珠阈值${threshold}，开售非资格赛占位球员价格40%分位。`,
  '三项500赛事合并本站，1–6人、签约金700；四项Combo合计封顶1000。双线按ATP/WTA统计，低保独立且2026自然年最多3次。',
  '排名与Elo于2026-10-25读取；完整来源及估算项见build-prices报告。',
  '自10月26日起按官方赛程日选ATP维也纳和WTA东京，无当日赛程则等待，不跨日期选赛。',
  '阿拉木图与宁波保留原价、原规则和累计收益，仅本地预览，尚未发布。'];
for (const {item,event} of events) {
  event.market_price_lock = {publication_version:1,locked_at:active.pricing.locked_at};
  await writeJson('data/manager/'+item.data_file,event);
}
await writeJson('data/manager/active_events.json',active);
console.log({threshold,nonQualifiers:prices.length});
