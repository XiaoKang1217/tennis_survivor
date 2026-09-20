// Updates product configuration only. Never writes wallets, ownership, lineups or ledgers.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { SupabaseRestClient } from './lib/supabase-rest.mjs';

export const release = JSON.parse(await readFile(new URL('../../assets/manager/badges/ui-v20/catalog.json', import.meta.url), 'utf8'));
export const legacyPrices = JSON.parse(await readFile(new URL('../../assets/manager/badges/ui-v20/legacy-prices.json', import.meta.url), 'utf8'));
const unchangedKeys = ['who-is-leather', 'rotten-cabbage', 'luwang-friend'];
const productFields = ['badge_key','title','formal_name','subtitle','description','story','serial_number','category','motifs','price','image_url','thumb_url','rarity','is_active','sort_order','available_from','available_until','metadata'];

export function makeProducts(existing = []) {
  const byKey = new Map(existing.map(x => [x.badge_key, x]));
  return release.themes.map(t => ({
    badge_key:t.badge_key,title:t.title,formal_name:t.formal_name,subtitle:t.category_label,
    description:t.description,story:t.story,serial_number:t.serial_number,category:t.category,
    motifs:t.motifs,price:t.price,image_url:t.assets.badge,thumb_url:t.assets.thumb,
    rarity:'limited',is_active:true,sort_order:t.sort_order,available_from:t.available_from,
    available_until:null,
    metadata:{...(byKey.get(t.badge_key)?.metadata||{}),theme:t.theme,category_label:t.category_label,
      sale_status:'for_sale',release:release.release,site_palette_label:t.site_palette_label,
      site_palette:t.site_palette,shape:t.shape}
  }));
}

export async function publish(client, {write=false}={}) {
  const before=await client.select('tour_manager_badges',{select:'*',order:'sort_order'});
  for(const key of [...Object.keys(legacyPrices),...unchangedKeys]) {
    if(!before.some(x=>x.badge_key===key))throw new Error(`Missing existing product: ${key}; no changes applied`);
  }
  const products=makeProducts(before);
  for(const product of products){
    const collision=before.find(x=>x.serial_number===product.serial_number&&x.badge_key!==product.badge_key);
    if(collision)throw new Error(`Serial conflict: ${product.serial_number}; no changes applied`);
  }
  const summary={release:release.release,newProducts:products.map(x=>({badge_key:x.badge_key,price:x.price})),legacyPrices,untouched:unchangedKeys};
  if(!write)return {...summary,dryRun:true};
  // One upsert is a transaction for all nine new product records. Existing metadata is merged above.
  await client.upsert('tour_manager_badges',products,'badge_key');
  for(const price of new Set(Object.values(legacyPrices))){
    const keys=Object.keys(legacyPrices).filter(k=>legacyPrices[k]===price);
    await client.update('tour_manager_badges',{price},{badge_key:`in.(${keys.join(',')})`});
  }
  const after=await client.select('tour_manager_badges',{select:'*',order:'sort_order'});
  for(const [key,price] of Object.entries(legacyPrices)){
    const prev=before.find(x=>x.badge_key===key),next=after.find(x=>x.badge_key===key);
    if(next?.price!==price)throw new Error(`Price verification failed: ${key}`);
    for(const field of Object.keys(prev).filter(k=>!['price','updated_at'].includes(k))) {
      if(JSON.stringify(prev[field])!==JSON.stringify(next[field]))throw new Error(`Unexpected legacy product change: ${key}.${field}`);
    }
  }
  for(const product of products){
    const row=after.find(x=>x.badge_key===product.badge_key);
    // JSONB object key order is not significant.
    for(const field of productFields.filter(k=>!['metadata','available_from'].includes(k))){
      if(JSON.stringify(row?.[field])!==JSON.stringify(product[field]))throw new Error(`Product verification failed: ${product.badge_key}.${field}`);
    }
    if(Date.parse(row.available_from)!==Date.parse(product.available_from)||row.metadata?.sale_status!=='for_sale'||row.metadata?.theme!==product.metadata.theme)throw new Error(`Metadata verification failed: ${product.badge_key}`);
  }
  for(const row of before.filter(x=>!Object.hasOwn(legacyPrices,x.badge_key)&&!products.some(p=>p.badge_key===x.badge_key))){
    if(JSON.stringify(row)!==JSON.stringify(after.find(x=>x.badge_key===row.badge_key)))throw new Error(`Unexpected protected product change: ${row.badge_key}`);
  }
  return {...summary,verified:true,productCount:after.length};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const write=process.argv.includes('--write');
  const client=new SupabaseRestClient();
  console.log(JSON.stringify(await publish(client,{write}),null,2));
}
