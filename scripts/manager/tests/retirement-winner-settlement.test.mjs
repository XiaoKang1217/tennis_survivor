import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isWalkoverOrRetirementStatus,
  matchRowsForEvent,
  parseDrawWalkoverMatchesFromAjax,
  parseResultDateHtml
} from '../lib/live-tennis-current-station.mjs';

const event = {
  event_key: 'wta-2026-w32-canada',
  tour: 'WTA',
  season: 2026,
  draw_size: 64,
  source_urls: ['https://www.live-tennis.cn/zh/draw/1017/2026'],
  players: [
    {
      profile_id: '320408',
      name_en: 'Coco GAUFF',
      name_zh: '高芙',
      player_key: 'WTA|coco-gauff'
    },
    {
      profile_id: '316774',
      name_en: 'Paula BADOSA',
      name_zh: '巴多萨',
      player_key: 'WTA|paula-badosa'
    }
  ]
};

test('result parser keeps the winner when a completed match score is RET', () => {
  const records = parseResultDateHtml(resultHtml({
    p1RowClass: 'cResultMatchMidTableRowWinner',
    p2RowClass: 'cResultMatchMidTableRow',
    p1RowText: '高芙',
    p2RowText: '巴多萨',
    score: '6-1 1-0 RET'
  }), '2026-08-11', 'https://www.live-tennis.cn/zh/result/2026-08-11');

  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'retired');
  assert.equal(records[0].winner_profile_id, '320408');

  const rows = matchRowsForEvent(event, records);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].round_key, 'QF');
  assert.equal(rows[0].status, 'retired');
  assert.equal(rows[0].winner_key, 'WTA|coco-gauff');
});

test('result parser infers the winner when the loser row carries the withdrawal marker', () => {
  const records = parseResultDateHtml(resultHtml({
    p1RowClass: 'cResultMatchMidTableRow',
    p2RowClass: 'cResultMatchMidTableRow',
    p1RowText: '高芙',
    p2RowText: '巴多萨 退赛',
    score: '对手退赛'
  }), '2026-08-11', 'https://www.live-tennis.cn/zh/result/2026-08-11');

  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'walkover');
  assert.equal(records[0].winner_profile_id, '320408');

  const rows = matchRowsForEvent(event, records);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].winner_key, 'WTA|coco-gauff');
});

test('draw fallback treats retired rows as settlement-eligible advancements', () => {
  const rows = parseDrawWalkoverMatchesFromAjax(`
    <div class="cDrawPart" data-id="WS">
      <table>
        ${drawRow(1, '320408', 'Coco GAUFF', '高芙', true)}
        ${drawRow(2, '316774', 'Paula BADOSA', '巴多萨', false)}
      </table>
    </div>
  `, event, 'draw-source');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'retired');
  assert.equal(rows[0].round_key, 'R64');
  assert.equal(rows[0].winner_key, 'WTA|coco-gauff');
  assert.equal(isWalkoverOrRetirementStatus(rows[0].status), true);
});

function resultHtml({ p1RowClass, p2RowClass, p1RowText, p2RowText, score }) {
  return `
    <section id="iResult1017">
      <div class=cResultTourInfoCity>蒙特利尔</div>
      <div class="cResultMatch" match-status=2 is-double=0>
        <div class=cResultMatchGender>女单</div>
        <div class=cResultMatchRound>1/4决赛</div>
        <div class=cResultMatchTime>1786406400</div>
        <table>
          <tr class=${p1RowClass}><td>${p1RowText}</td></tr>
          <tr class=${p2RowClass}><td>${p2RowText}</td></tr>
          <tr><td class=cResultMatchScore>${score}</td></tr>
          <tr>
            <td>
              <script>
                open_stat("1017","wta","8901","2026","320408","316774","Coco GAUFF","Paula BADOSA")
              </script>
            </td>
          </tr>
        </table>
      </div>
    </section>
  `;
}

function drawRow(position, profileId, nameEn, nameZh, winnerCell) {
  const advancementCell = winnerCell
    ? `<td class="cDrawGrid cDrawGridScore"><pname data-id="${profileId}" alt="${nameEn}">${nameZh}</pname>RET</td>`
    : '<td class="cDrawGrid"></td>';
  return `
    <tr>
      <td class="cDrawSeq">${position}</td>
      <td class="cDrawGrid cDrawGridSideBorder">
        <pname data-id="${profileId}" alt="${nameEn}">${nameZh}</pname>
      </td>
      ${advancementCell}
    </tr>
  `;
}
