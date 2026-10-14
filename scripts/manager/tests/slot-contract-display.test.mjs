import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('index.html','utf8');
const players=[
  {player_key:'WTA|iva-jovic',name_zh:'约维奇',draw_position:17,pre_r1_substitution:{out_player_key:'WTA|mirra-andreeva',out_name_zh:'米拉',replacement_player_key:'WTA|iva-jovic',replacement_name_zh:'约维奇'}},
  {player_key:'WTA|anna-bondar',name_zh:'邦达尔',draw_position:25,pre_r1_substitution:{out_player_key:'WTA|iva-jovic',out_name_zh:'约维奇',replacement_player_key:'WTA|anna-bondar',replacement_name_zh:'邦达尔'}}
];
function context(list){
  const c=vm.createContext({managerContestPacks:()=>[{event:{players:list}}]});
  for(const name of ['managerOriginalNameFromMeta','managerDisplayNameWithOriginal','managerCurrentReplacementInfo','managerPublicConfigPlayerName']){
    const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction ',start+1);
    vm.runInContext(html.slice(start,end),c);
  }
  return c;
}
test('hall resolves each immutable original independently, regardless of player ordering',()=>{
  for(const list of [players,[...players].reverse()]){
    const c=context(list);
    assert.equal(c.managerPublicConfigPlayerName({name_zh:'邦达尔',original_name_zh:'米拉'}),'约维奇（原米拉）');
    assert.equal(c.managerPublicConfigPlayerName({name_zh:'邦达尔',original_name_zh:'约维奇'}),'邦达尔（原约维奇）');
    assert.equal(c.managerPublicConfigPlayerName({name_zh:'约维奇'}),'约维奇');
    assert.equal(c.managerCurrentReplacementInfo({event:{players:list}},'WTA|anna-bondar','邦达尔',{
      player_key:'WTA|mirra-andreeva',draw_position:17,substituted_from_name_zh:'米拉'
    }).replacementPlayerKey,'WTA|iva-jovic');
  }
});
