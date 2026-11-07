import fs from 'node:fs';
import {cleanText} from './lib/live-tennis-current-station.mjs';
const file='data/manager/events/wta-2026-w46-finals.json';
const event=JSON.parse(fs.readFileSync(file));
if(!process.argv[2])throw Error('Usage: node scripts/manager/score-finals.mjs <downloaded-tennisabstract-elo.html> [YYYY-MM-DD]');
const sourceDate=process.argv[3]||new Date().toISOString().slice(0,10);
const html=fs.readFileSync(process.argv[2],'utf8');
const rows=[...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(c=>cleanText(c[1]))).filter(c=>c.length>=16&&Number(c[3])>0);
const norm=s=>s.toLowerCase().replace(/[^a-z]/g,'');
const percentile=(values,v,reverse=false)=>{const lower=values.filter(n=>n<v).length,equal=values.filter(n=>n===v).length;const score=100*(lower+(equal-1)/2)/Math.max(1,values.length-1);return reverse?100-score:score;};
const round=n=>Math.round(n*100)/100;
for(const p of event.players){const row=rows.find(r=>norm(r[1])===norm(p.name_en));if(!row)throw Error('Missing Elo '+p.name_en);p.overall_elo=Number(row[3]);p.surface_elo=Number(row[6]);p.peak_elo=Number(row[12]);p.peak_month=row[13];p.rank=Number(row[15]);if(!p.rank||!p.peak_elo)throw Error('Missing source fields');}
const field=event.players;
const burdens=field.map(p=>field.filter(o=>o.group===p.group&&o.player_key!==p.player_key).reduce((s,o)=>s+o.surface_elo,0)/3);
for(const [i,p] of field.entries()){
 const months=Math.max(0,(Number(sourceDate.slice(0,4))-Number(p.peak_month.slice(0,4)))*12+Number(sourceDate.slice(5,7))-Number(p.peak_month.slice(5,7)));
 p.scores={base:round(.65*percentile(rows.map(r=>Number(r[3])),p.overall_elo)+.35*percentile(rows.map(r=>Number(r[15])).filter(n=>n>0),p.rank,true)),surface:round(percentile(rows.map(r=>Number(r[6])),p.surface_elo)),form:round(.7*Math.min(100,100*p.overall_elo/p.peak_elo)+.3*Math.max(0,100-months/48*100)),draw:round(percentile(burdens,burdens[i],true)),manual:0};
 p.pricing_detail={...p.pricing_detail,source:'https://tennisabstract.com/reports/wta_elo_ratings.html',source_date:'2026-11-07',score_explanation:{base:'65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）',surface:'硬地Elo百分位（TA覆盖球员）',form:'70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减',draw:'组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱'},group_opponent_average_elo:round(burdens[i]),price_independent_of_scores:true};
}
fs.writeFileSync(file,JSON.stringify(event,null,2)+'\n');
console.log(field.map(p=>({name:p.name_zh,scores:p.scores,price:p.price})));
