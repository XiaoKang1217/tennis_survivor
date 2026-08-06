import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDrawPlayersFromAjax } from '../lib/live-tennis-current-station.mjs';

const event = {
  tour: 'WTA',
  season: 2026
};

test('final draw entry signs distinguish qualifiers and lucky losers', () => {
  const html = `
    <div class="cDrawPart" data-id="WS">
      <table>
        ${drawRow(1, '1', 'Clara TAUSON', '陶森', '1')}
        ${drawRow(2, '320238', 'HIBINO Nao', '日比野菜绪', 'Q')}
        ${drawRow(3, '327193', 'Sapfo SAKELLARIDI', '萨克拉里蒂', 'W')}
        ${drawRow(4, '317541', 'Miriana TONA', '托纳', 'LL')}
      </table>
    </div>
  `;

  const players = parseDrawPlayersFromAjax(html, event, 'draw-source');
  const byPosition = new Map(players.map((player) => [player.draw_position, player]));

  assert.equal(byPosition.get(1).entry_type, 'direct_acceptance');
  assert.equal(byPosition.get(2).entry_type, 'qualifier');
  assert.equal(byPosition.get(3).entry_type, 'wildcard');
  assert.equal(byPosition.get(4).entry_type, 'lucky_loser');
});

test('ATP singles parser selects the complete duplicate MS draw part', () => {
  const html = `
    <div class="cDrawPart" data-id="MS">
      <table>
        ${drawRow(1, 'COMEUP', 'Coming up', '即将开始', '')}
        ${drawRow(2, 'COMEUP', 'Coming up', '即将开始', '')}
      </table>
    </div>
    <div class="cDrawPart" data-id="MD"></div>
    <div data-id="MS" class="is-active cDrawPart horizontal">
      <table>
        ${drawRow(1, 'FAA1', 'Felix AUGER-ALIASSIME', '阿加特-阿利亚西姆', '8')}
        ${drawRow(2, 'F0F2', 'Jaime FARIA', '法里亚', 'LL')}
        ${drawRow(3, 'D0DW', 'Titouan DROGUET', '德罗盖', '')}
        ${drawRow(4, 'P004', 'Fourth PLAYER', '第四人', '')}
      </table>
    </div>
  `;

  const players = parseDrawPlayersFromAjax(html, { tour: 'ATP', season: 2026 }, 'draw-source');

  assert.equal(players.length, 4);
  assert.deepEqual(players.map((player) => player.profile_id), ['FAA1', 'F0F2', 'D0DW', 'P004']);
  assert.equal(players[1].entry_type, 'lucky_loser');
});

test('WTA singles parser selects the complete duplicate WS draw part', () => {
  const html = `
    <div class="cDrawPart" data-id="WS">
      <table>
        ${drawRow(1, 'COMEUP', 'Coming up', '即将开始', '')}
        ${drawRow(2, 'COMEUP', 'Coming up', '即将开始', '')}
      </table>
    </div>
    <div class="cDrawPart" data-id="WD"></div>
    <div data-id="WS" class="cDrawPart is-current">
      <table>
        ${drawRow(1, 'W001', 'First WTA', '女单一号', '1')}
        ${drawRow(2, 'W002', 'Second WTA', '女单二号', '')}
        ${drawRow(3, 'W003', 'Third WTA', '女单三号', 'Q')}
        ${drawRow(4, 'W004', 'Fourth WTA', '女单四号', '')}
      </table>
    </div>
  `;

  const players = parseDrawPlayersFromAjax(html, event, 'draw-source');

  assert.equal(players.length, 4);
  assert.deepEqual(players.map((player) => player.draw_position), [1, 2, 3, 4]);
  assert.equal(players[2].entry_type, 'qualifier');
});

test('equally complete duplicate singles parts prefer the later refreshed markup', () => {
  const html = `
    <div class="cDrawPart" data-id="MS">
      <table>
        ${drawRow(1, 'OLD1', 'Withdrawn PLAYER', '已退赛球员', '')}
        ${drawRow(2, 'P002', 'Second PLAYER', '二号球员', '')}
      </table>
    </div>
    <div class="cDrawPart" data-id="MS">
      <table>
        ${drawRow(1, 'NEW1', 'Replacement PLAYER', '替补球员', 'LL')}
        ${drawRow(2, 'P002', 'Second PLAYER', '二号球员', '')}
      </table>
    </div>
  `;

  const players = parseDrawPlayersFromAjax(html, { tour: 'ATP', season: 2026 }, 'draw-source');

  assert.equal(players[0].profile_id, 'NEW1');
  assert.equal(players[0].entry_type, 'lucky_loser');
});

function drawRow(position, profileId, nameEn, nameZh, entrySign) {
  return `
    <tr>
      <td class="cDrawSeq">${position}</td>
      <td class="cDrawGrid cDrawGridSideBorder">
        <pname data-id="${profileId}" alt="${nameEn}">
          ${nameZh}<span class="entrySign">${entrySign}</span>
        </pname>
      </td>
    </tr>
  `;
}
