import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseFinalsSource,finalsProgressFromHtml} from '../lib/finals-source.mjs';
import {normalizeRoundKey} from '../lib/live-tennis-current-station.mjs';
function fixture({wins=false,knockout='' }={}){
 const groups=[[1,2,3,4],[5,6,7,8]].map(ids=>'<table class=cDrawBlockRR><tbody><tr><td>group</td></tr>'+ids.map(id=>`<tr><td><pname data-id="${id}">P${id}</pname>${wins?`<table class=cDrawBlockRRSubTable><tr><td>Match</td><td>${id===1?'1-0':id===2?'0-1':'0-0'}</td></tr></table>`:''}</td></tr>`).join('')+'</tbody></table>').join('');
 return `<div class=cDrawPart data-id=WS>${groups}</div>${knockout}`;
}
test('RR single win/loss neither qualifies nor eliminates either player',()=>{
 const rows=parseFinalsSource(fixture({wins:true}));
 assert.equal(rows[0].rr_wins,1);assert.equal(rows[1].rr_losses,1);
 assert.ok(rows.every(p=>p.stage==='RR'&&!p.eliminated));
});
test('Explicit knockout participant qualifies even before semifinal starts',()=>{
 const knockout='<div class=cDrawPart data-id=WS><table class=cDrawBlock><tr><td class=cDrawSeq>1</td><td><pname data-id=1>P1</pname></td></tr></table></div>';
 const rows=parseFinalsSource(fixture({wins:true,knockout}));
 assert.equal(rows[0].stage,'SF');assert.equal(rows[0].rr_wins,1);
});
test('Source failure and incomplete groups fail closed, never pay guessed points',()=>{
 assert.throws(()=>parseFinalsSource('<html>Unavailable</html>'),/Expected two/);
});
test('Empty source spacer rows are ignored, nonempty unidentified rows still fail',()=>{
 const html=fixture().replace('<tr><td>group</td></tr>','<tr><td>group</td></tr><tr><td><div></div></td><td>&nbsp;</td></tr>');
 assert.equal(parseFinalsSource(html).length,8);
 assert.throws(()=>parseFinalsSource(html.replace('<div></div>','<div>unknown player</div>')),/Ambiguous/);
});
test('RR round mapping does not affect ordinary draws',()=>{
 assert.equal(normalizeRoundKey('小组赛',{format:'round_robin',draw_size:8}),'RR');
 assert.equal(normalizeRoundKey('半决赛',{draw_size:32}),'SF');
 assert.equal(normalizeRoundKey('第一轮',{draw_size:32}),'R32');
});
test('ATP Finals reads MS groups and ignores WS groups on the same page',()=>{
 const ms=fixture({wins:true}).replaceAll('data-id=WS','data-id=MS');
 const rows=parseFinalsSource(ms+fixture(),'ATP');
 assert.equal(rows.length,8);assert.equal(rows[0].rr_wins,1);
 assert.equal(parseFinalsSource(ms+fixture(),'WTA')[0].rr_wins,0);
});
test('Real Turin 2025 source maps RR wins, SF, final and champion to progress rows',()=>{
 // https://www.live-tennis.cn/zh/draw/ajax/20605/2025/device/0/horizontal/true
 const html=readFileSync(new URL('./fixtures/turin-2025-live-tennis.html',import.meta.url),'utf8');
 const parsed=parseFinalsSource(html,'ATP');
 const event={tour:'ATP',event_id:'20605',season:2025,station_key:'test-2025',event_key:'test-turin',players:parsed.map(p=>({profile_id:p.source_id,player_key:'ATP|'+p.source_id}))};
 const rows=finalsProgressFromHtml(event,html);
 assert.equal(rows.length,8);
 for(const [id,wins,stage] of [['S0AG',3,'W'],['A0E2',3,'F'],['DH58',1,'SF'],['AG37',2,'SF'],['S0S1',0,'RR']]){
  const p=rows.find(p=>p.player_key==='ATP|'+id);
  assert.equal(p.rr_wins,wins);assert.equal(p.stage,stage);
 }
 assert.equal(rows.filter(p=>!p.eliminated).length,1);
 assert.ok(rows.every(p=>p.source.url.includes('/20605/2025/')));
});
test('Missing pre-opening groups wait without changing prices; missing live results fail closed',()=>{
 const event={tour:'ATP',event_id:'20605',season:2026,main_draw_first_match_at:'2026-11-15T21:00:00+08:00',players:[{profile_id:'A0E2',player_key:'ATP|carlos-alcaraz',price:1000,reached_round:'RR',round_robin_wins:0}]};
 const before=JSON.stringify(event);
 assert.deepEqual(finalsProgressFromHtml(event,'<html>pending</html>',Date.parse('2026-11-13T00:00Z')),[]);
 assert.equal(JSON.stringify(event),before);
 assert.throws(()=>finalsProgressFromHtml(event,'<html>pending</html>',Date.parse('2026-11-16T00:00Z')),/Expected two/);
 event.players[0].round_robin_wins=1;
 assert.throws(()=>finalsProgressFromHtml(event,'<html>pending</html>',Date.parse('2026-11-13T00:00Z')),/Expected two/);
});
