import { readJson, writeJson } from './lib/manager-utils.mjs';
const active=await readJson('data/manager/active_events.json');
if(active.station_key!=='2026-w43-almaty-ningbo'||active.pricing.market_prices_locked)throw new Error('Expected unlocked Almaty/Ningbo');
const report=await readJson(`outputs/manager-sync/${active.station_key}-build-prices.json`);
if(report.unresolvedSources.length)throw new Error('Unresolved pricing sources');
const events=[];
for(const item of active.events){
  const event=await readJson('data/manager/'+item.data_file);
  if(event.players.length!==28||event.players.some(p=>!Number.isFinite(p.price)||p.price<=0))throw new Error('Incomplete prices');
  event.start_date='2026-10-19';
  events.push({item,event});
}
const prices=events.flatMap(x=>x.event.players).filter(p=>!p.is_qualifier_placeholder).map(p=>p.price).sort((a,b)=>a-b);
const threshold=prices[Math.ceil(prices.length*0.4)-1];
active.rules.combo.value_pick.max_price=threshold;
active.rules.combo.value_pick.threshold_basis={method:'opening_non_qualifier_price_40th_percentile',players:prices.length,threshold};
active.pricing={...active.pricing,market_prices_locked:true,locked_at:new Date().toISOString(),reason:'Opening prices frozen by original draw slot, including qualifiers'};
active.notes=[`慧眼识珠阈值${threshold}，开售非资格赛占位球员价格40%分位。`,
  '沿用250+500级别四项Combo结构，合计封顶600；低保独立且2026自然年最多3次。',
  '2026-10-17读取ATP1989名、WTA1545名排名，ATP550名、WTA519名Elo；努尔拉努利无TA Elo，使用已有排名估算方法并标记。',
  '签表来源赛期2026-10-19至2026-10-25；竞猜自10月18日起按官方赛程日选赛，无当日赛程则等待，不跨日补选。',
  '上海与武汉继续按各自原规则结算，上站展示合并。仅本地预览，尚未发布。'];
for(const {item,event} of events){event.market_price_lock={publication_version:1,locked_at:active.pricing.locked_at};await writeJson('data/manager/'+item.data_file,event);}
await writeJson('data/manager/active_events.json',active);
console.log({threshold,nonQualifiers:prices.length});
