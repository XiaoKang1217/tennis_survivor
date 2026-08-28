import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalPlayerKey } from '../lib/manager-utils.mjs';
import { mergeDrawPlayers, parseDrawPlayersFromAjax } from '../lib/live-tennis-current-station.mjs';

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

test('locked market refresh preserves reviewed photos for unchanged players', () => {
  const localPhoto = 'assets/manager/players/atp/atp-carlos-alcaraz.webp';
  const lockedEvent = {
    tour: 'ATP',
    market_price_lock: {
      publication_version: 1,
      locked_at: '2026-08-28T01:15:00.000Z'
    },
    players: [
      {
        profile_id: 'A0E2',
        name_en: 'Carlos ALCARAZ',
        name_zh: '阿尔卡拉斯',
        player_key: 'ATP|carlos-alcaraz',
        draw_position: 1,
        is_qualifier_placeholder: false,
        price: 865,
        photo_url: localPhoto,
        photo_source: 'manual-cache',
        scores: { base: 98, surface: 95, draw: 89, form: 50, manual: 0 }
      }
    ]
  };
  const parsedPlayers = [
    {
      profile_id: 'A0E2',
      name_en: 'Carlos ALCARAZ',
      name_zh: '阿尔卡拉斯',
      player_key: 'ATP|carlos-alcaraz',
      draw_position: 1,
      is_qualifier_placeholder: false,
      price: 0,
      photo_url: 'https://static.live-tennis.cn/pic/ts/A0E2'
    }
  ];

  const merged = mergeDrawPlayers(lockedEvent, parsedPlayers, 'draw-source');

  assert.equal(merged[0].photo_url, localPhoto);
  assert.equal(merged[0].photo_source, 'manual-cache');
  assert.equal(merged[0].price, 865);
});

test('locked qualifier placeholders keep their published key when live draw labels drift', () => {
  const lockedEvent = {
    tour: 'WTA',
    market_price_lock: {
      publication_version: 1,
      locked_at: '2026-08-12T01:00:00.000Z'
    },
    players: [
      {
        profile_id: '319998',
        name_en: 'OSAKA Naomi',
        name_zh: '大坂直美',
        player_key: 'WTA|osaka-naomi',
        draw_position: 17,
        is_qualifier_placeholder: false,
        price: 230,
        scores: { base: 80, surface: 78, draw: 75, form: 76, manual: 0 }
      },
      {
        profile_id: '320301',
        name_en: 'Katerina SINIAKOVA',
        name_zh: '西尼亚科娃',
        player_key: 'WTA|katerina-siniakova',
        draw_position: 28,
        is_qualifier_placeholder: false,
        price: 145,
        scores: { base: 60, surface: 60, draw: 60, form: 60, manual: 0 }
      },
      {
        profile_id: 'QUAL-5',
        name_en: 'Qualifier Q5',
        name_zh: '资格赛选手 Q5',
        player_key: 'WTA|qualifier-29',
        draw_position: 29,
        is_qualifier_placeholder: true,
        price: 75,
        scores: { base: 38, surface: 38, draw: 38, form: 38, manual: 0 }
      },
      {
        profile_id: 'QUAL-6',
        name_en: 'Qualifier Q6',
        name_zh: '资格赛选手 Q6',
        player_key: 'WTA|qualifier-38',
        draw_position: 38,
        is_qualifier_placeholder: true,
        price: 80,
        scores: { base: 40, surface: 40, draw: 40, form: 40, manual: 0 }
      }
    ]
  };
  const parsedPlayers = [
    {
      profile_id: '320301',
      name_en: 'Katerina SINIAKOVA',
      name_zh: '西尼亚科娃',
      player_key: 'WTA|katerina-siniakova',
      draw_position: 17,
      is_qualifier_placeholder: false,
      price: 0
    },
    {
      profile_id: 'QUAL-5',
      name_en: 'Qualifier Q5',
      name_zh: '资格赛选手 Q5',
      player_key: 'WTA|qualifier-28',
      draw_position: 28,
      is_qualifier_placeholder: true,
      price: 0
    },
    {
      profile_id: 'QUAL-6',
      name_en: 'Qualifier Q6',
      name_zh: '资格赛选手 Q6',
      player_key: 'WTA|qualifier-29',
      draw_position: 29,
      is_qualifier_placeholder: true,
      price: 0
    },
    {
      profile_id: 'QUAL-7',
      name_en: 'Qualifier Q7',
      name_zh: '资格赛选手 Q7',
      player_key: 'WTA|qualifier-38',
      draw_position: 38,
      is_qualifier_placeholder: true,
      price: 0
    }
  ];

  const merged = mergeDrawPlayers(lockedEvent, parsedPlayers, 'draw-source');
  const siniakova = merged.find((player) => player.draw_position === 17);
  const luckyLoser = merged.find((player) => player.draw_position === 28);
  const q5 = merged.find((player) => player.draw_position === 29);
  const q6 = merged.find((player) => player.draw_position === 38);
  const positions = merged.map((player) => player.draw_position);
  const playerKeys = merged.map((player) => player.player_key);

  assert.equal(siniakova.player_key, 'WTA|katerina-siniakova');
  assert.equal(siniakova.price, 230);
  assert.equal(siniakova.pre_r1_substitution.out_player_key, 'WTA|osaka-naomi');
  assert.equal(siniakova.pre_r1_substitution.locked_publication_player_key, 'WTA|osaka-naomi');
  assert.equal(siniakova.pre_r1_substitution.replacement_player_key, 'WTA|katerina-siniakova');
  assert.equal(luckyLoser.player_key, 'WTA|lucky-loser-28');
  assert.equal(canonicalPlayerKey('WTA', luckyLoser), 'WTA|lucky-loser-28');
  assert.equal(luckyLoser.entry_type, 'lucky_loser');
  assert.equal(luckyLoser.is_qualifier_placeholder, false);
  assert.equal(luckyLoser.price, 145);
  assert.equal(luckyLoser.pre_r1_substitution.out_player_key, 'WTA|katerina-siniakova');
  assert.equal(luckyLoser.pre_r1_substitution.locked_publication_player_key, 'WTA|katerina-siniakova');
  assert.equal(luckyLoser.pre_r1_substitution.replacement_player_key, 'WTA|lucky-loser-28');
  assert.equal(q5.player_key, 'WTA|qualifier-29');
  assert.equal(canonicalPlayerKey('WTA', q5), 'WTA|qualifier-29');
  assert.equal(q5.profile_id, 'QUAL-5');
  assert.equal(q5.price, 75);
  assert.equal(q6.player_key, 'WTA|qualifier-38');
  assert.equal(canonicalPlayerKey('WTA', q6), 'WTA|qualifier-38');
  assert.equal(q6.profile_id, 'QUAL-6');
  assert.equal(q6.price, 80);
  assert.equal(new Set(positions).size, positions.length);
  assert.equal(new Set(playerKeys).size, playerKeys.length);

  const secondParsedPlayers = merged.map((player) => (
    player.draw_position === 28
      ? {
          profile_id: '326160',
          name_en: 'WANG Xiyu',
          name_zh: '王曦雨',
          player_key: 'WTA|wang-xiyu',
          draw_position: 28,
          entry_type: 'qualifier',
          is_qualifier_placeholder: false,
          price: 0
        }
      : player
  ));
  const secondMerged = mergeDrawPlayers(
    { ...lockedEvent, players: merged },
    secondParsedPlayers,
    'updated-draw-source'
  );
  const wangXiyu = secondMerged.find((player) => player.draw_position === 28);

  assert.equal(wangXiyu.player_key, 'WTA|wang-xiyu');
  assert.equal(wangXiyu.price, 145);
  assert.equal(wangXiyu.pre_r1_substitution.out_player_key, 'WTA|lucky-loser-28');
  assert.equal(wangXiyu.pre_r1_substitution.locked_publication_player_key, 'WTA|katerina-siniakova');
  assert.equal(wangXiyu.pre_r1_substitution.replacement_player_key, 'WTA|wang-xiyu');
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
