import { readJson, writeJson } from './lib/manager-utils.mjs';
const active=await readJson('data/manager/active_events.json');
if(active.station_key!=='2026-w42-wuhan'||active.pricing.market_prices_locked)throw new Error('Expected unlocked Wuhan');
const file='data/manager/'+active.events[0].data_file,event=await readJson(file);
if(event.players.length!==56||event.players.some(p=>!Number.isFinite(p.price)||p.price<=0))throw new Error('Incomplete prices');
const prices=event.players.filter(p=>!p.is_qualifier_placeholder).map(p=>p.price).sort((a,b)=>a-b);
const threshold=prices[Math.ceil(prices.length*0.4)-1];
active.rules.combo.value_pick.max_price=threshold;
active.rules.combo.value_pick.threshold_basis={method:'opening_non_qualifier_price_40th_percentile',players:prices.length,threshold};
active.pricing={...active.pricing,market_prices_locked:true,locked_at:new Date().toISOString(),reason:'Wuhan opening prices frozen including qualifier slots'};
event.market_price_lock={publication_version:1,locked_at:active.pricing.locked_at};
active.notes=[`慧眼识珠阈值${threshold}，按开售48名非资格赛占位球员价格40%分位确定。`,
  '2026-10-11读取1200名WTA排名及522名Elo。TA最新公布日期2026-09-28。',
  '上海与武汉各按原站合同、锁价和Combo独立结算，仅展示合并；本金本站起始值按武汉。',
  '仅本地预览，未同步线上。'];
await writeJson(file,event);await writeJson('data/manager/active_events.json',active);
console.log({threshold,players:prices.length,qualifiers:56-prices.length});
