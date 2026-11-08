import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFinalsSource} from '../lib/finals-source.mjs';
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
