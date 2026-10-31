import { readJson, writeJson } from './lib/manager-utils.mjs';
const active = await readJson('data/manager/active_events.json');
if (active.station_key !== '2026-w45-paris-hongkong' || active.pricing.market_prices_locked) throw new Error('Expected unlocked Paris/Hong Kong');
const report = await readJson(`outputs/manager-sync/${active.station_key}-build-prices.json`);
if (report.unresolvedSources.length) throw new Error('Unresolved pricing sources');
const lockedAt=new Date().toISOString();
for(const item of active.events) {
  const event=await readJson('data/manager/'+item.data_file);
  if(event.players.length!==event.draw_size || event.players.some(p=>!Number.isFinite(p.price)||p.price<=0)) throw new Error('Incomplete prices');
  event.market_price_lock={publication_version:1,locked_at:lockedAt};
  await writeJson('data/manager/'+item.data_file,event);
}
active.pricing={...active.pricing,market_prices_locked:true,locked_at:lockedAt,reason:'Opening prices frozen by original draw slot, including qualifiers'};
active.notes=['慧眼识珠固定门槛120。稳健经营至少3人且50%进入16强，毛收益10%封顶300。',
  '混合级别沿用现有购买人数规则：最低1人，最高5人。签约金700，四项Combo封顶1000。',
  '2026-10-31读取排名与Elo。缺失当前Elo者使用现有排名估算并在来源报告标记。',
  '11月2日起严格选同一官方赛程日的巴黎和香港，无赛程则等待补生成。',
  '仅本地预览，未修改线上钱包、合同、阵容或竞猜。'];
await writeJson('data/manager/active_events.json',active);
console.log('Frozen 88 slot prices locally; value threshold remains 120.');
