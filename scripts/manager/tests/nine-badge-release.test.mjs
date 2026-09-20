import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {release,legacyPrices,makeProducts,publish} from '../publish-nine-badge-skins.mjs';

test('nine releases have exact principal prices, unique keys/serials and only one event badge',()=>{
 const prices={rybakina:4599,zverev:3999,mensik:3999,sinner:3999,alcaraz:3999,zheng:3999,medvedev:3599,rublev:3599,usopen:2999};
 assert.equal(release.themes.length,9);
 assert.equal(new Set(release.themes.map(t=>t.badge_key)).size,9);
 assert.equal(new Set(release.themes.map(t=>t.serial_number)).size,9);
 for(const t of release.themes){assert.equal(t.price,prices[t.id]);assert.equal(t.category,t.id==='usopen'?'event':'player');}
});

test('publication writes only the catalogue, preserves old fields and unrelated products, and is repeatable',async()=>{
 let rows=Object.entries(legacyPrices).map(([badge_key])=>({badge_key,price:1999,title:badge_key,metadata:{original:true},created_at:'unchanged'}));
 rows.push({badge_key:'who-is-leather',price:599},{badge_key:'rotten-cabbage',price:199},{badge_key:'luwang-friend',price:0,metadata:{sale_status:'coming_soon'}});
 const calls=[];
 const client={
  select:async(table)=>{assert.equal(table,'tour_manager_badges');return structuredClone(rows)},
  upsert:async(table,products,key)=>{assert.equal(table,'tour_manager_badges');assert.equal(key,'badge_key');calls.push('upsert');for(const p of products){const i=rows.findIndex(x=>x.badge_key===p.badge_key);if(i<0)rows.push(structuredClone(p));else rows[i]={...rows[i],...structuredClone(p)};}},
  update:async(table,values,query)=>{assert.equal(table,'tour_manager_badges');assert.deepEqual(Object.keys(values),['price']);calls.push('update');const keys=query.badge_key.slice(4,-1).split(',');rows.forEach(x=>{if(keys.includes(x.badge_key))x.price=values.price;});}
 };
 assert.equal((await publish(client)).dryRun,true);assert.equal(calls.length,0);
 assert.equal((await publish(client,{write:true})).verified,true);
 const once=structuredClone(rows);await publish(client,{write:true});assert.deepEqual(rows,once);
 assert.equal(rows.length,24);
});

test('preflight rejects unknown baseline or serial conflict before mutation',async()=>{
 await assert.rejects(publish({select:async()=>[]},{write:true}),/Missing existing/);
 const rows=Object.keys(legacyPrices).concat(['who-is-leather','rotten-cabbage','luwang-friend']).map(badge_key=>({badge_key}));
 rows[0].serial_number=release.themes[0].serial_number;
 await assert.rejects(publish({select:async()=>rows},{write:true}),/Serial conflict/);
});

test('all optimized graphics exist, are WebP, and the release avoids embedded PNGs',()=>{
 let bytes=0;const paths=new Set(release.themes.flatMap(t=>Object.values(t.assets)));
 for(const path of paths){const data=readFileSync(new URL('../../../'+path,import.meta.url));assert.equal(data.subarray(8,12).toString(),'WEBP');bytes+=data.length;}
 assert.ok(bytes<10_000_000,`All nine skins together: ${bytes} bytes`);
 const html=readFileSync(new URL('../../../index.html',import.meta.url),'utf8');
 assert.ok(!html.includes('data:image/'));
 assert.ok(!html.includes('luwang_nine_skins_v3_preview.html'));
 assert.equal(makeProducts().filter(x=>x.metadata.sale_status==='for_sale').length,9);
});
