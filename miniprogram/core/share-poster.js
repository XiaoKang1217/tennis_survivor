'use strict';

const CANVAS_ID = 'share-card-canvas';
const BRAND_BLUE = '#126BFF';
const BRAND_NAVY = '#061A37';
const INK = '#08152F';
const MUTED = '#67758A';
const YELLOW = '#EAF205';
const RED = '#E92828';
const imageInfoCache = Object.create(null);

function cleanText(value, fallback = '') {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  return text || fallback;
}

function limited(value, max = 16) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function firstPortrait(side) {
  const members = Array.isArray(side?.members) ? side.members : [];
  return cleanText(members.find(member => member.portraitUrl)?.portraitUrl);
}

function getImageInfo(src) {
  return new Promise(resolve => {
    const value = cleanText(src);
    const api = typeof wx !== 'undefined' ? wx : null;
    if (!value || !api?.getImageInfo) {
      resolve(null);
      return;
    }
    if (imageInfoCache[value]) {
      imageInfoCache[value].then(resolve).catch(() => resolve(null));
      return;
    }
    imageInfoCache[value] = new Promise(innerResolve => {
      api.getImageInfo({
        src: value,
        success: result => innerResolve({
          path: result.path || value,
          width: Number(result.width) || 1,
          height: Number(result.height) || 1
        }),
        fail: () => innerResolve(null)
      });
    });
    imageInfoCache[value].then(resolve).catch(() => resolve(null));
  });
}

function strokeRoundRect(ctx, x, y, width, height, radius, color, lineWidth = 1) {
  ctx.save();
  ctx.setStrokeStyle(color);
  ctx.setLineWidth(lineWidth);
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.stroke();
  ctx.restore();
}

function normalStatusColor(match) {
  if (match?.group === 'ended') return '#16824B';
  if (match?.preMatch) return BRAND_BLUE;
  return RED;
}

function scorePart(score, index) {
  return cleanText(score).split(':')[index] || '0';
}

function scheduleOrCurrent(match, score) {
  if (match?.preMatch) return cleanText(match?.scheduleText, '查看赛程');
  const setText = [currentSetLabel(match), score.current].filter(Boolean).join('  ');
  return setText || cleanText(match?.scorePlaceholder, '查看比赛详情');
}

function matchScope(match) {
  return [
    cleanText(match?.tournamentName, '炉网比赛'),
    cleanText(match?.disciplineLabel),
    cleanText(match?.roundLabel)
  ].filter(Boolean).join(' · ');
}

function displayScore(score) {
  return cleanText(score, 'VS').replace(/-/gu, ':');
}

function setFont(ctx, size, weight = 700) {
  if ('font' in ctx) ctx.font = `${weight} ${size}px sans-serif`;
  ctx.setFontSize(size);
}

function fillText(ctx, value, x, y, size, color, options = {}) {
  ctx.save();
  setFont(ctx, size, options.weight || 700);
  ctx.setFillStyle(color);
  ctx.setTextAlign(options.align || 'left');
  ctx.setTextBaseline(options.baseline || 'top');
  ctx.fillText(cleanText(value), x, y);
  ctx.restore();
}

function measure(ctx, value, size) {
  setFont(ctx, size, 700);
  try {
    return ctx.measureText(cleanText(value)).width;
  } catch {
    return cleanText(value).length * size;
  }
}

function fitText(ctx, value, x, y, maxWidth, size, minSize, color, options = {}) {
  const text = cleanText(value);
  let nextSize = size;
  while (nextSize > minSize && measure(ctx, text, nextSize) > maxWidth) nextSize -= 1;
  fillText(ctx, limited(text, Math.max(4, Math.floor(maxWidth / Math.max(nextSize * 0.72, 1)))),
    x, y, nextSize, color, options);
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, color) {
  ctx.save();
  ctx.setFillStyle(color);
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.fill();
  ctx.restore();
}

function drawCover(ctx, image, x, y, width, height, radius = 0) {
  if (!image?.path) return false;
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = Math.max(0, (image.width - sourceWidth) / 2);
  const sourceY = Math.max(0, (image.height - sourceHeight) / 2);
  ctx.save();
  if (radius > 0) {
    roundRectPath(ctx, x, y, width, height, radius);
    ctx.clip();
  }
  try {
    ctx.drawImage(
      image.path,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      x,
      y,
      width,
      height
    );
  } catch {
    ctx.restore();
    return false;
  }
  ctx.restore();
  return true;
}

function drawLinear(ctx, x, y, width, height, from, to, vertical = false) {
  const gradient = ctx.createLinearGradient(x, y, vertical ? x : x + width, vertical ? y + height : y);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  ctx.setFillStyle(gradient);
  ctx.fillRect(x, y, width, height);
}

function logo(ctx, x, y, light = true) {
  fillText(ctx, '炉网｜网球，此刻发生', x, y, 15, light ? '#FFFFFF' : BRAND_BLUE, { weight: 650 });
  ctx.setFillStyle(YELLOW);
  ctx.beginPath();
  ctx.arc(x + 162, y + 9, 6, 0, Math.PI * 2);
  ctx.fill();
}

function pill(ctx, x, y, width, height, text, color, textColor = '#FFFFFF') {
  fillRoundRect(ctx, x, y, width, height, height / 2, color);
  fillText(ctx, text, x + width / 2, y + height / 2, 14, textColor, {
    align: 'center',
    baseline: 'middle'
  });
}

function bottomLine(ctx, width, height) {
  ctx.setStrokeStyle(BRAND_BLUE);
  ctx.setLineWidth(1);
  ctx.beginPath();
  ctx.moveTo(0, height - 18);
  ctx.lineTo(width - 30, height - 18);
  ctx.stroke();
  ctx.setStrokeStyle(YELLOW);
  ctx.setLineWidth(2);
  ctx.beginPath();
  ctx.moveTo(width - 150, height - 18);
  ctx.lineTo(width - 30, height - 18);
  ctx.stroke();
  ctx.setFillStyle(YELLOW);
  ctx.beginPath();
  ctx.arc(width - 30, height - 18, 5, 0, Math.PI * 2);
  ctx.fill();
}

function setWinnerCount(first, second) {
  const firstValue = Number(first?.value);
  const secondValue = Number(second?.value);
  if (!Number.isFinite(firstValue) || !Number.isFinite(secondValue)) return 0;
  if (firstValue === secondValue) return 0;
  return firstValue > secondValue ? 1 : 2;
}

function matchScore(match) {
  const left = Array.isArray(match?.leftScoreCells) ? match.leftScoreCells : [];
  const right = Array.isArray(match?.rightScoreCells) ? match.rightScoreCells : [];
  let firstSets = 0;
  let secondSets = 0;
  let current = '';
  left.forEach((cell, index) => {
    const pair = right[index];
    if (!cell || !pair) return;
    if (cell.current || pair.current) current = `${cell.value}-${pair.value}`;
    const winner = setWinnerCount(cell, pair);
    if (winner === 1) firstSets += 1;
    if (winner === 2) secondSets += 1;
  });
  const score = left.length || right.length
    ? `${firstSets}:${secondSets}` : cleanText(match?.scorePlaceholder, 'VS');
  return {
    score,
    current: current || cleanText(match?.scorePlaceholder)
  };
}

function currentSetLabel(match) {
  const sets = Array.isArray(match?.sets) ? match.sets : [];
  const current = sets.find(set => set.current) || sets[sets.length - 1];
  const setNumber = Number(current?.setNumber);
  if (!Number.isFinite(setNumber)) return match?.group === 'upcoming' ? cleanText(match?.scheduleText) : '';
  return `第${setNumber}盘`;
}

function matchImages(match) {
  const sides = Array.isArray(match?.sides) ? match.sides : [];
  return {
    first: firstPortrait(sides[0]),
    second: firstPortrait(sides[1])
  };
}

function matchNames(match) {
  const sides = Array.isArray(match?.sides) ? match.sides : [];
  return [
    cleanText(sides[0]?.names, '球员待定'),
    cleanText(sides[1]?.names, '球员待定')
  ];
}

function drawMatchBackground(ctx, width, height) {
  drawLinear(ctx, 0, 0, width, height, '#071B3A', '#004E9F', true);
  ctx.setFillStyle('#0B5EB8');
  ctx.fillRect(0, Math.round(height * 0.22), width, Math.round(height * 0.50));
  ctx.setStrokeStyle('rgba(216,236,255,0.48)');
  ctx.setLineWidth(2);
  ctx.beginPath();
  ctx.moveTo(80, Math.round(height * 0.22));
  ctx.lineTo(width - 80, Math.round(height * 0.72));
  ctx.moveTo(width - 80, Math.round(height * 0.22));
  ctx.lineTo(80, Math.round(height * 0.72));
  ctx.moveTo(40, Math.round(height * 0.42));
  ctx.lineTo(width - 40, Math.round(height * 0.42));
  ctx.stroke();
  ctx.setFillStyle('rgba(1,14,34,0.70)');
  ctx.fillRect(0, Math.round(height * 0.72), width, Math.round(height * 0.28));
}

function drawEmptyPhoto(ctx, x, y, width, height, label) {
  fillRoundRect(ctx, x, y, width, height, 12, 'rgba(255,255,255,0.12)');
  fillText(ctx, limited(label, 8), x + width / 2, y + height / 2, 16, '#DCEBFF', {
    align: 'center',
    baseline: 'middle'
  });
}

function drawMatchCard(ctx, match, images, width, height) {
  drawMatchBackground(ctx, width, height);
  if (!drawCover(ctx, images.first, 0, 78, 188, 228, 0)) drawEmptyPhoto(ctx, 18, 95, 148, 178, matchNames(match)[0]);
  if (!drawCover(ctx, images.second, 312, 78, 188, 228, 0)) drawEmptyPhoto(ctx, 334, 95, 148, 178, matchNames(match)[1]);
  ctx.setFillStyle('rgba(2,17,43,0.28)');
  ctx.fillRect(0, 0, width, height);
  logo(ctx, 24, 22);
  fillText(ctx, limited(matchScope(match), 22), width / 2, 62, 16, '#FFFFFF', { align: 'center' });
  pill(ctx, width / 2 - 42, 94, 84, 30, cleanText(match?.statusLabel, '比赛'), normalStatusColor(match));
  const names = matchNames(match);
  const score = matchScore(match);
  fitText(ctx, names[0], 112, 177, 100, 19, 14, '#FFFFFF', { align: 'center' });
  fillText(ctx, scorePart(score.score, 0), 229, 160, 58, YELLOW, { align: 'center' });
  fillText(ctx, ':', 268, 168, 42, '#FFFFFF', { align: 'center' });
  fillText(ctx, scorePart(score.score, 1), 312, 160, 52, '#FFFFFF', { align: 'center' });
  fitText(ctx, names[1], 388, 177, 112, 19, 14, '#FFFFFF', { align: 'center' });
  fillText(ctx, scheduleOrCurrent(match, score), width / 2, 238, 19, '#FFFFFF', { align: 'center' });
  ctx.setFillStyle('rgba(1,14,34,0.74)');
  ctx.fillRect(0, 320, width, 60);
  ['实时比分', '逐分', '技术统计'].forEach((item, index) => {
    const x = [116, 250, 382][index];
    ctx.setFillStyle('#58A9FF');
    fillRoundRect(ctx, x - 38, 344, 16, 16, 3, '#58A9FF');
    fillText(ctx, item, x - 10, 340, 15, '#FFFFFF', { weight: 650 });
  });
  bottomLine(ctx, width, height);
}

function drawMatchSquare(ctx, match, images, width, height) {
  drawMatchBackground(ctx, width, height);
  drawCover(ctx, images.first, 0, 0, width / 2, 252, 0);
  drawCover(ctx, images.second, width / 2, 0, width / 2, 252, 0);
  ctx.setFillStyle('rgba(0,13,32,0.44)');
  ctx.fillRect(0, 0, width, height);
  logo(ctx, 22, 22);
  const names = matchNames(match);
  const score = matchScore(match);
  fillText(ctx, limited(`${names[0]} vs`, 12), 40, 270, 40, '#FFFFFF');
  fillText(ctx, limited(names[1], 12), 40, 322, 40, '#FFFFFF');
  fillText(ctx, `${names[0]}  `, 42, 398, 18, '#FFFFFF');
  fillText(ctx, displayScore(score.score), 128, 391, 29, BRAND_BLUE);
  fillText(ctx, `  ${names[1]}`, 198, 398, 18, '#FFFFFF');
  pill(ctx, 42, 432, 80, 30, cleanText(match?.statusLabel, '比赛'), normalStatusColor(match));
  fillText(ctx, limited(matchScope(match), 18), width - 42, 438, 16, '#FFFFFF', { align: 'right', weight: 650 });
}

function playerImage(data) {
  return cleanText(data?.heroImageUrl) || cleanText(data?.portraitUrl);
}

function playerRank(data) {
  return cleanText(data?.position) || cleanText(data?.season?.rank);
}

function seasonTitles(data) {
  return cleanText(data?.season?.titles, '暂无');
}

function nextOrRecent(data) {
  const recent = Array.isArray(data?.recentEvents) ? data.recentEvents[0] : null;
  return cleanText(recent?.dateText) || cleanText(recent?.tournamentName) || cleanText(data?.dataAsOf);
}

function drawPlayerCard(ctx, data, image, width, height) {
  drawLinear(ctx, 0, 0, width, height, '#FFFFFF', '#EEF6FF');
  logo(ctx, 24, 22, false);
  fitText(ctx, cleanText(data?.name, '球员资料'), 44, 94, 210, 42, 25, INK);
  fillText(ctx, cleanText(data?.countryCode, ''), 88, 168, 18, INK);
  fillRoundRect(ctx, 46, 168, 34, 18, 2, '#E52828');
  fillText(ctx, `${cleanText(data?.tour, 'ATP')} 世界第`, 48, 222, 22, INK);
  fillText(ctx, playerRank(data) || '—', 196, 216, 34, BRAND_BLUE);
  ctx.setStrokeStyle('#D7DEE8');
  ctx.beginPath();
  ctx.moveTo(48, 270);
  ctx.lineTo(224, 270);
  ctx.stroke();
  fillText(ctx, '本赛季', 48, 312, 20, INK);
  fillText(ctx, seasonTitles(data), 132, 304, 34, BRAND_BLUE);
  fillText(ctx, '冠', 176, 312, 20, INK);
  const next = nextOrRecent(data);
  if (next) fillText(ctx, `近期 · ${limited(next, 12)}`, 48, 356, 18, INK);
  ctx.setFillStyle('#C7D5E8');
  fillText(ctx, playerRank(data) || '', 372, 68, 148, 'rgba(8,21,47,0.18)', { align: 'center' });
  drawLinear(ctx, 302, 0, 198, height, 'rgba(255,255,255,0)', '#061A37');
  if (!drawCover(ctx, image, 288, 28, 212, 372, 0)) drawEmptyPhoto(ctx, 318, 74, 150, 260, cleanText(data?.name, '球员'));
  bottomLine(ctx, width, height);
}

function drawPlayerSquare(ctx, data, image, width, height) {
  drawLinear(ctx, 0, 0, width, height, '#03142E', '#071F47');
  logo(ctx, 22, 22);
  fillText(ctx, limited(cleanText(data?.name, '球员资料'), 8), 42, 116, 45, '#FFFFFF');
  fillText(ctx, '球员资料', 42, 170, 34, '#FFFFFF');
  fillText(ctx, playerRank(data) || '', 214, 226, 170, 'rgba(18,107,255,0.35)', { align: 'center' });
  fillText(ctx, `${cleanText(data?.tour, 'ATP')} 世界第 ${playerRank(data) || '—'}`, 52, 330, 22, '#FFFFFF');
  const recent = nextOrRecent(data);
  if (recent) pill(ctx, 52, 382, 132, 36, limited(recent, 10), BRAND_BLUE);
  if (cleanText(data?.countryCode)) fillText(ctx, cleanText(data.countryCode), 106, 450, 17, '#FFFFFF');
  if (!drawCover(ctx, image, 296, 58, 204, 442, 0)) drawEmptyPhoto(ctx, 320, 160, 150, 260, cleanText(data?.name, '球员'));
}

function fieldValue(fields, label) {
  const found = (Array.isArray(fields) ? fields : [])
    .find(item => item.label === label && item.available);
  return cleanText(found?.value);
}

function tournamentFacts(detail, fallback = {}) {
  return {
    name: cleanText(detail?.name?.value || detail?.name, cleanText(fallback.title, '赛事详情')),
    level: fieldValue(detail?.classification, '赛事级别'),
    surface: fieldValue(detail?.location, '场地'),
    city: fieldValue(detail?.location, '城市'),
    start: fieldValue(detail?.dates, '开始日期'),
    end: fieldValue(detail?.dates, '结束日期')
  };
}

function shortDateRange(facts) {
  const normalize = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(cleanText(value));
    return match ? `${Number(match[2])}.${Number(match[3])}` : cleanText(value);
  };
  const start = normalize(facts.start);
  const end = normalize(facts.end);
  return start && end ? `${start}-${end}` : start || end || '';
}

function drawTournamentPoster(ctx, detail, bg, width, height, square = false) {
  if (!drawCover(ctx, bg, 0, 0, width, height, 0)) drawLinear(ctx, 0, 0, width, height, '#02152F', '#06316D', true);
  ctx.setFillStyle('rgba(0,13,32,0.38)');
  ctx.fillRect(0, 0, width, height);
  logo(ctx, square ? 22 : 24, 22);
  const facts = tournamentFacts(detail);
  const nameLines = square ? [limited(facts.name, 9), '要开始了'] : [limited(facts.name, 9), ''];
  if (square) {
    fillText(ctx, `${nameLines[0]}，`, 42, 138, 43, '#FFFFFF');
    fillText(ctx, nameLines[1], 42, 192, 43, '#FFFFFF');
    fillText(ctx, facts.name, 44, 282, 25, '#FFFFFF');
    if (facts.level) pill(ctx, 44, 328, 82, 32, facts.level, BRAND_BLUE);
    if (facts.surface) pill(ctx, 138, 328, 66, 32, facts.surface, YELLOW, INK);
    fillText(ctx, shortDateRange(facts), 44, 404, 27, '#FFFFFF');
  } else {
    fitText(ctx, facts.name, 46, 92, 205, 36, 27, '#FFFFFF');
    if (facts.level) pill(ctx, 48, 202, 88, 30, facts.level, BRAND_BLUE);
    fillText(ctx, [facts.surface, facts.city].filter(Boolean).join(' · '), 48, 252, 21, '#FFFFFF');
    fillText(ctx, shortDateRange(facts), 48, 320, 22, YELLOW);
    fillText(ctx, '赛程 · 签表 · 实时比分', 48, 356, 16, '#FFFFFF', { weight: 650 });
    bottomLine(ctx, width, height);
  }
}

function drawParticipants(ctx, names, x, y, width, height, activeIndex = -1, dark = false) {
  names.slice(0, 8).forEach((name, index) => {
    const row = Math.floor(index % 4);
    const right = index >= 4;
    const itemWidth = Math.floor((width - 44) / 2);
    const itemX = right ? x + width - itemWidth : x;
    const itemY = y + row * (height + 8);
    const active = index === activeIndex;
    const bg = active ? YELLOW : dark ? 'rgba(255,255,255,0.12)' : '#FFFFFF';
    const border = active ? YELLOW : dark ? 'rgba(216,236,255,0.28)' : '#AFC0D3';
    const textColor = active ? INK : dark ? '#FFFFFF' : INK;
    fillRoundRect(ctx, itemX, itemY, itemWidth, height, 7, bg);
    strokeRoundRect(ctx, itemX, itemY, itemWidth, height, 7, border);
    fillText(ctx, String(index + 1), itemX + 14, itemY + height / 2, 12, textColor, {
      baseline: 'middle',
      weight: 800
    });
    fitText(ctx, name, itemX + 42, itemY + height / 2 - 8, itemWidth - 52, 15, 11, textColor, { weight: 760 });
  });
}

function drawBracketLines(ctx, x, y, width, square = false, color = BRAND_BLUE) {
  ctx.setStrokeStyle(color);
  ctx.setLineWidth(square ? 3 : 2);
  const itemWidth = Math.floor((width - 44) / 2);
  const rowStep = square ? 40 : 36;
  const leftX = x + itemWidth;
  const midX = x + width / 2;
  const rightX = x + width - itemWidth;
  [0, rowStep, rowStep * 2, rowStep * 3].forEach(offset => {
    ctx.beginPath();
    ctx.moveTo(leftX, y + offset + 15);
    ctx.lineTo(leftX + 52, y + offset + 15);
    ctx.moveTo(rightX, y + offset + 15);
    ctx.lineTo(rightX - 52, y + offset + 15);
    ctx.stroke();
  });
  [[15, rowStep + 15], [rowStep * 2 + 15, rowStep * 3 + 15]].forEach(pair => {
    ctx.beginPath();
    ctx.moveTo(leftX + 52, y + pair[0]);
    ctx.lineTo(leftX + 52, y + pair[1]);
    ctx.moveTo(rightX - 52, y + pair[0]);
    ctx.lineTo(rightX - 52, y + pair[1]);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.moveTo(leftX + 52, y + rowStep - 3);
  ctx.lineTo(midX - 18, y + rowStep - 3);
  ctx.lineTo(midX - 18, y + rowStep * 3 - 3);
  ctx.lineTo(leftX + 52, y + rowStep * 3 - 3);
  ctx.moveTo(rightX - 52, y + rowStep - 3);
  ctx.lineTo(midX + 18, y + rowStep - 3);
  ctx.lineTo(midX + 18, y + rowStep * 3 - 3);
  ctx.lineTo(rightX - 52, y + rowStep * 3 - 3);
  ctx.moveTo(midX - 18, y + rowStep * 2 - 3);
  ctx.lineTo(midX + 18, y + rowStep * 2 - 3);
  ctx.stroke();
}

function drawNamesFromColumns(data) {
  const firstColumn = (Array.isArray(data?.columns) ? data.columns : [])
    .find(column => Array.isArray(column.matches) && column.matches.length);
  const names = [];
  for (const match of firstColumn?.matches || []) {
    names.push(cleanText(match.first));
    names.push(cleanText(match.second));
    if (names.length >= 8) break;
  }
  return names.filter(Boolean);
}

function drawDrawPoster(ctx, data, width, height, square = false) {
  drawLinear(ctx, 0, 0, width, height, '#051C3C', '#0B5EB8', true);
  ctx.setFillStyle('rgba(1,14,34,0.24)');
  ctx.fillRect(0, 0, width, height);
  ctx.setStrokeStyle('rgba(216,236,255,0.28)');
  ctx.setLineWidth(2);
  ctx.beginPath();
  ctx.moveTo(58, square ? 222 : 190);
  ctx.lineTo(width - 58, square ? 222 : 190);
  ctx.moveTo(58, square ? 360 : 314);
  ctx.lineTo(width - 58, square ? 360 : 314);
  ctx.moveTo(width / 2, square ? 206 : 178);
  ctx.lineTo(width / 2, square ? 382 : 330);
  ctx.stroke();
  logo(ctx, square ? 22 : 24, 22);
  const title = cleanText(data?.selectedTitle, '赛事签表');
  const draw = (Array.isArray(data?.draws) ? data.draws : [])
    .find(item => item.drawId === data?.selectedDrawId);
  const label = cleanText(draw?.label, '签表');
  const names = drawNamesFromColumns(data);
  if (square) {
    fillText(ctx, '签表', width - 42, 88, 70, 'rgba(234,242,5,0.88)', { align: 'right', weight: 900 });
    fitText(ctx, title, 42, 130, 310, 41, 28, '#FFFFFF');
    pill(ctx, 42, 196, 124, 34, limited(label, 8), YELLOW, INK);
    fillRoundRect(ctx, 32, 254, 436, 174, 16, 'rgba(1,14,34,0.42)');
    drawParticipants(ctx, names, 48, 276, 404, 31, 0, true);
    drawBracketLines(ctx, 48, 276, 404, true, 'rgba(234,242,5,0.92)');
  } else {
    fillText(ctx, '签表', width - 36, 66, 58, 'rgba(234,242,5,0.88)', { align: 'right', weight: 900 });
    fitText(ctx, title, 40, 92, 310, 34, 25, '#FFFFFF');
    pill(ctx, 40, 142, 126, 32, limited(label, 8), YELLOW, INK);
    fillText(ctx, names.length ? '参赛签位 · 晋级路径' : '签表信息', 40, 188, 18, '#DCEBFF', { weight: 700 });
    fillRoundRect(ctx, 28, 224, 444, 120, 16, 'rgba(1,14,34,0.42)');
    drawParticipants(ctx, names, 44, 246, 412, 28, 0, true);
    drawBracketLines(ctx, 44, 246, 412, false, 'rgba(234,242,5,0.92)');
    bottomLine(ctx, width, height);
  }
}

function posterSize(variant) {
  return variant === 'timeline' ? { width: 500, height: 500 } : { width: 500, height: 400 };
}

function exportCanvas(page, width, height) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const api = typeof wx !== 'undefined' ? wx : null;
      if (!api?.canvasToTempFilePath) {
        reject(new Error('share_canvas_unavailable'));
        return;
      }
      api.canvasToTempFilePath({
        canvasId: CANVAS_ID,
        x: 0,
        y: 0,
        width,
        height,
        destWidth: width,
        destHeight: height,
        fileType: 'jpg',
        quality: 0.92,
        success: result => resolve(cleanText(result?.tempFilePath)),
        fail: reject
      }, page);
    }, 80);
  });
}

function drawWithCanvas(page, width, height, draw) {
  return new Promise((resolve, reject) => {
    const api = typeof wx !== 'undefined' ? wx : null;
    if (!api?.createCanvasContext || !api?.canvasToTempFilePath) {
      reject(new Error('share_canvas_unavailable'));
      return;
    }
    const ctx = api.createCanvasContext(CANVAS_ID, page);
    draw(ctx);
    ctx.draw(false, () => {
      exportCanvas(page, width, height).then(resolve).catch(reject);
    });
  });
}

async function createPoster(page, kind, data, variant) {
  const { width, height } = posterSize(variant);
  if (kind === 'match') {
    const sources = matchImages(data);
    const images = {
      first: await getImageInfo(sources.first),
      second: await getImageInfo(sources.second)
    };
    return drawWithCanvas(page, width, height, ctx => {
      if (variant === 'timeline') drawMatchSquare(ctx, data, images, width, height);
      else drawMatchCard(ctx, data, images, width, height);
    });
  }
  if (kind === 'player') {
    const image = await getImageInfo(playerImage(data));
    return drawWithCanvas(page, width, height, ctx => {
      if (variant === 'timeline') drawPlayerSquare(ctx, data, image, width, height);
      else drawPlayerCard(ctx, data, image, width, height);
    });
  }
  if (kind === 'tournament') {
    return drawWithCanvas(page, width, height, ctx => {
      drawTournamentPoster(ctx, data, null, width, height, variant === 'timeline');
    });
  }
  return drawWithCanvas(page, width, height, ctx => {
    drawDrawPoster(ctx, data, width, height, variant === 'timeline');
  });
}

function posterKey(kind, data) {
  if (kind === 'match') {
    const names = matchNames(data).join('|');
    const score = matchScore(data);
    return [kind, data?.id, names, score.score, score.current, data?.statusLabel].join('|');
  }
  if (kind === 'player') {
    return [kind, data?.playerId, data?.tour, data?.name, playerRank(data), playerImage(data), nextOrRecent(data)].join('|');
  }
  if (kind === 'tournament') {
    const facts = tournamentFacts(data);
    return [kind, facts.name, facts.level, facts.surface, facts.city, facts.start, facts.end].join('|');
  }
  return [
    kind,
    data?.selectedTournamentId,
    data?.selectedDrawId,
    data?.selectedTitle,
    drawNamesFromColumns(data).join('|')
  ].join('|');
}

async function updatePageShareImages(page, kind, data) {
  if (!page || !data) return;
  const key = posterKey(kind, data);
  if (!key || page.__sharePosterKey === key || page.__sharePosterPendingKey === key) return;
  page.__sharePosterPendingKey = key;
  try {
    const card = await createPoster(page, kind, data, 'card');
    const timeline = await createPoster(page, kind, data, 'timeline');
    if (page.__sharePosterPendingKey !== key) return;
    page.__sharePosterKey = key;
    page.__sharePosterPendingKey = '';
    page.setData({
      shareCardImageUrl: card,
      shareTimelineImageUrl: timeline
    });
  } catch {
    if (page.__sharePosterPendingKey === key) page.__sharePosterPendingKey = '';
  }
}

module.exports = Object.freeze({
  updatePageShareImages
});
