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
