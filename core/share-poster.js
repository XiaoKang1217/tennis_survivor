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
  const member = members.find(item =>
    cleanText(item?.portraitShareUrl)
    || cleanText(item?.heroImageUrl)
    || cleanText(item?.portraitDetailUrl)
    || cleanText(item?.portraitUrl));
  return cleanText(member?.portraitShareUrl)
    || cleanText(member?.heroImageUrl)
    || cleanText(member?.portraitDetailUrl)
    || cleanText(member?.portraitUrl);
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

function logo(ctx, x, y, light = true, compact = false) {
  fillText(ctx, '炉的网球', x, y, compact ? 17 : 20, light ? '#FFFFFF' : INK, { weight: 850 });
  ctx.setFillStyle(YELLOW);
  ctx.beginPath();
  ctx.arc(x + (compact ? 78 : 92), y + (compact ? 9 : 11), compact ? 4 : 5, 0, Math.PI * 2);
  ctx.fill();
}

function sectionLabel(ctx, value, x, y, light = true) {
  fillText(ctx, value, x, y, 13, light ? '#A9CFFF' : BRAND_BLUE, {
    weight: 800
  });
}

function drawCirclePhoto(ctx, image, x, y, diameter, label, border = '#FFFFFF') {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + diameter / 2, y + diameter / 2, diameter / 2, 0, Math.PI * 2);
  ctx.clip();
  const drawn = drawCover(ctx, image, x, y, diameter, diameter, 0);
  if (!drawn) {
    ctx.setFillStyle('#DCEAFF');
    ctx.fillRect(x, y, diameter, diameter);
    fillText(ctx, limited(label, 2), x + diameter / 2, y + diameter / 2, Math.round(diameter * 0.25), BRAND_BLUE, {
      align: 'center', baseline: 'middle', weight: 850
    });
  }
  ctx.restore();
  ctx.save();
  ctx.setStrokeStyle(border);
  ctx.setLineWidth(4);
  ctx.beginPath();
  ctx.arc(x + diameter / 2, y + diameter / 2, diameter / 2 - 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function tournamentArtwork(name, level = '', tour = '') {
  const value = cleanText(name).toLowerCase();
  if (/(us open|美网|美国网球公开赛)/u.test(value)) return '/assets/grand-slam-us-open.png';
  if (/(wimbledon|温网|温布尔登)/u.test(value)) return '/assets/grand-slam-wimbledon.png';
  if (/(roland|garros|法网|罗兰·加洛斯)/u.test(value)) return '/assets/grand-slam-roland-garros.png';
  if (/(australian open|澳网|澳大利亚网球公开赛)/u.test(value)) return '/assets/grand-slam-australian-open.png';
  const levelValue = cleanText(level).toLowerCase();
  const tourValue = cleanText(tour).toLowerCase();
  const authority = tourValue.includes('wta') ? 'wta' : 'atp';
  if (/1000/u.test(levelValue)) return `/assets/${authority}-1000.png`;
  if (/500/u.test(levelValue)) return `/assets/${authority}-500.png`;
  if (/250/u.test(levelValue)) return `/assets/${authority}-250.png`;
  if (/125/u.test(levelValue)) return '/assets/wta-125.png';
  if (/challenger|挑战赛/u.test(levelValue)) return '/assets/atp-challenger.png';
  return '';
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

function matchSetLine(match) {
  const left = Array.isArray(match?.leftScoreCells) ? match.leftScoreCells : [];
  const right = Array.isArray(match?.rightScoreCells) ? match.rightScoreCells : [];
  const parts = left.map((cell, index) => {
    const pair = right[index];
    const first = cleanText(cell?.value);
    const second = cleanText(pair?.value);
    return first && second ? `${first}-${second}` : '';
  }).filter(Boolean);
  return parts.join('  ');
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
  drawLinear(ctx, 0, 0, width, height, '#061A37', '#0B4B93');
  const names = matchNames(match);
  const score = matchScore(match);
  logo(ctx, 24, 20, true, true);
  pill(ctx, 392, 18, 84, 28, cleanText(match?.statusLabel, '比赛'), normalStatusColor(match));
  fillText(ctx, limited(matchScope(match), 30), 24, 58, 15, '#BBD8FF', { weight: 650 });
  fillRoundRect(ctx, 20, 92, 460, 236, 20, '#FFFFFF');
  drawCirclePhoto(ctx, images.first, 46, 119, 94, names[0]);
  drawCirclePhoto(ctx, images.second, 360, 119, 94, names[1]);
  fitText(ctx, names[0], 93, 224, 135, 19, 13, INK, { align: 'center' });
  fitText(ctx, names[1], 407, 224, 135, 19, 13, INK, { align: 'center' });
  fillText(ctx, match?.preMatch ? 'VS' : displayScore(score.score), 250, 135,
    match?.preMatch ? 34 : 48, BRAND_BLUE, { align: 'center', weight: 900 });
  const setLine = matchSetLine(match);
  fillText(ctx, setLine || scheduleOrCurrent(match, score), 250, 199, setLine ? 17 : 20,
    setLine ? MUTED : INK, { align: 'center', weight: 750 });
  fillText(ctx, match?.preMatch ? cleanText(match?.scheduleText, '赛程待定')
    : scheduleOrCurrent(match, score), 250, 272, 16, MUTED, { align: 'center', weight: 650 });
  fillText(ctx, '打开查看实时比分、逐分与技术统计', 24, 354, 15, '#DCEBFF', { weight: 650 });
  fillText(ctx, '微信内查看  ›', 476, 354, 15, YELLOW, { align: 'right', weight: 800 });
}

function drawMatchSquare(ctx, match, images, width, height) {
  drawLinear(ctx, 0, 0, width, height, '#04152F', '#0A3974', true);
  const names = matchNames(match);
  const score = matchScore(match);
  drawCirclePhoto(ctx, images.first, 38, 112, 142, names[0], '#7AB7FF');
  drawCirclePhoto(ctx, images.second, 320, 112, 142, names[1], '#7AB7FF');
  logo(ctx, 28, 24);
  pill(ctx, 388, 24, 84, 30, cleanText(match?.statusLabel, '比赛'), normalStatusColor(match));
  sectionLabel(ctx, limited(matchScope(match), 30), 28, 70);
  fitText(ctx, names[0], 109, 267, 180, 24, 15, '#FFFFFF', { align: 'center' });
  fitText(ctx, names[1], 391, 267, 180, 24, 15, '#FFFFFF', { align: 'center' });
  fillRoundRect(ctx, 188, 142, 124, 78, 18, 'rgba(255,255,255,0.10)');
  fillText(ctx, match?.preMatch ? 'VS' : displayScore(score.score), 250, 158,
    match?.preMatch ? 35 : 45, YELLOW, { align: 'center', weight: 900 });
  fillText(ctx, matchSetLine(match) || scheduleOrCurrent(match, score), 250, 324, 21,
    '#FFFFFF', { align: 'center', weight: 800 });
  ctx.setStrokeStyle('rgba(187,216,255,0.34)');
  ctx.beginPath(); ctx.moveTo(28, 376); ctx.lineTo(472, 376); ctx.stroke();
  fillText(ctx, '实时比分 · 逐分 · 技术统计', 28, 404, 18, '#BBD8FF', { weight: 700 });
  fillText(ctx, '微信搜索「炉的网球」', 28, 449, 16, '#FFFFFF', { weight: 650 });
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
  return cleanText(recent?.dateText) || cleanText(recent?.tournamentName);
}

function drawPlayerCard(ctx, data, image, width, height) {
  drawLinear(ctx, 0, 0, width, height, '#F7FAFF', '#DDEBFF');
  fillRoundRect(ctx, 18, 18, 464, 364, 22, '#FFFFFF');
  logo(ctx, 38, 34, false, true);
  sectionLabel(ctx, '球员资料', 38, 70, false);
  fitText(ctx, cleanText(data?.name, '球员资料'), 38, 100, 242, 38, 23, INK);
  const originalName = cleanText(data?.originalName);
  if (originalName && originalName !== cleanText(data?.name)) {
    fitText(ctx, originalName, 38, 146, 238, 17, 12, MUTED, { weight: 600 });
  }
  const rank = playerRank(data) || '—';
  fillText(ctx, `${cleanText(data?.tour, 'ATP')} 世界排名`, 38, 205, 16, MUTED, { weight: 650 });
  fillText(ctx, `#${rank}`, 38, 228, 48, BRAND_BLUE, { weight: 900 });
  const country = cleanText(data?.countryCode);
  if (country) pill(ctx, 38, 292, 70, 28, country, '#E9F2FF', BRAND_BLUE);
  const titles = seasonTitles(data);
  fillText(ctx, `本赛季 ${titles} 冠`, 122, 297, 16, INK, { weight: 750 });
  const next = nextOrRecent(data);
  if (next) fillText(ctx, `近期赛事 · ${limited(next, 15)}`, 38, 340, 15, MUTED, { weight: 650 });
  if (!drawCover(ctx, image, 292, 38, 190, 344, 18)) {
    drawEmptyPhoto(ctx, 312, 82, 150, 240, cleanText(data?.name, '球员'));
  }
}

function drawPlayerSquare(ctx, data, image, width, height) {
  drawLinear(ctx, 0, 0, width, height, '#03142E', '#0B4B93', true);
  logo(ctx, 28, 24);
  sectionLabel(ctx, '球员资料', 28, 67);
  const name = cleanText(data?.name, '球员资料');
  fitText(ctx, name, 28, 102, 286, 44, 26, '#FFFFFF');
  const originalName = cleanText(data?.originalName);
  if (originalName && originalName !== name) {
    fitText(ctx, originalName, 28, 156, 270, 18, 13, '#BBD8FF', { weight: 600 });
  }
  fillText(ctx, `${cleanText(data?.tour, 'ATP')} 世界排名`, 30, 223, 17, '#BBD8FF', { weight: 650 });
  fillText(ctx, `#${playerRank(data) || '—'}`, 28, 247, 66, YELLOW, { weight: 900 });
  const recent = nextOrRecent(data);
  if (recent) {
    sectionLabel(ctx, '近期赛事', 30, 349);
    fitText(ctx, recent, 30, 375, 255, 21, 14, '#FFFFFF', { weight: 750 });
  }
  fillText(ctx, [cleanText(data?.countryCode), `本赛季 ${seasonTitles(data)} 冠`]
    .filter(Boolean).join('  ·  '), 30, 447, 16, '#DCEBFF', { weight: 650 });
  if (!drawCover(ctx, image, 300, 56, 200, 444, 0)) {
    drawEmptyPhoto(ctx, 324, 150, 150, 260, name);
  }
}

function fieldValue(fields, label) {
  const found = (Array.isArray(fields) ? fields : [])
    .find(item => item.label === label && item.available);
  return cleanText(found?.value);
}

function tournamentFacts(detail, fallback = {}) {
  const lifecycleValue = cleanText(detail?.lifecycle?.value)
    || cleanText(detail?.status)
    || cleanText(fallback?.status);
  return {
    name: cleanText(detail?.name?.value || detail?.name, cleanText(fallback.title, '赛事详情')),
    tour: fieldValue(detail?.classification, '赛事体系'),
    level: fieldValue(detail?.classification, '赛事级别'),
    surface: fieldValue(detail?.location, '场地'),
    city: fieldValue(detail?.location, '城市'),
    start: fieldValue(detail?.dates, '开始日期'),
    end: fieldValue(detail?.dates, '结束日期'),
    lifecycle: lifecycleValue
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

function drawTournamentPoster(ctx, detail, artwork, width, height, square = false) {
  const facts = tournamentFacts(detail);
  drawLinear(ctx, 0, 0, width, height, '#04152F', '#0B4B93', true);
  logo(ctx, square ? 28 : 24, square ? 24 : 20, true, !square);
  if (square) {
    sectionLabel(ctx, '赛事详情', 28, 70);
    if (artwork) {
      fillRoundRect(ctx, 348, 24, 124, 124, 20, '#FFFFFF');
      drawCover(ctx, artwork, 360, 36, 100, 100, 12);
    }
    fitText(ctx, facts.name, 28, 112, artwork ? 300 : 430, 43, 26, '#FFFFFF');
    if (facts.level) pill(ctx, 28, 190, 110, 34, limited(facts.level, 9), BRAND_BLUE);
    if (facts.surface) pill(ctx, 148, 190, 76, 34, facts.surface, YELLOW, INK);
    fillText(ctx, shortDateRange(facts) || '赛期待定', 28, 262, 36, '#FFFFFF', { weight: 850 });
    fillText(ctx, [facts.city, facts.lifecycle].filter(Boolean).join('  ·  '), 30, 311, 18, '#BBD8FF', { weight: 650 });
    fillRoundRect(ctx, 28, 365, 444, 78, 16, 'rgba(255,255,255,0.10)');
    fillText(ctx, '赛程  ·  签表  ·  奖金积分  ·  实时比分', 250, 391, 18, '#FFFFFF', {
      align: 'center', weight: 750
    });
    fillText(ctx, '微信搜索「炉的网球」', 28, 466, 15, '#DCEBFF', { weight: 650 });
  } else {
    sectionLabel(ctx, '赛事详情', 24, 55);
    fillRoundRect(ctx, 20, 88, 460, 250, 22, '#FFFFFF');
    fitText(ctx, facts.name, 42, 112, artwork ? 278 : 410, 37, 24, INK);
    let tagX = 42;
    if (facts.level) {
      pill(ctx, tagX, 166, 106, 30, limited(facts.level, 9), '#E8F1FF', BRAND_BLUE);
      tagX += 116;
    }
    if (facts.surface) pill(ctx, tagX, 166, 76, 30, facts.surface, '#FFF5C2', INK);
    fillText(ctx, shortDateRange(facts) || '赛期待定', 42, 225, 27, BRAND_BLUE, { weight: 850 });
    fillText(ctx, [facts.city, facts.lifecycle].filter(Boolean).join('  ·  '), 42, 272, 17, MUTED, { weight: 650 });
    if (artwork) {
      fillRoundRect(ctx, 340, 112, 112, 112, 18, '#F5F8FD');
      drawCover(ctx, artwork, 352, 124, 88, 88, 12);
    }
    fillText(ctx, '打开查看赛程、签表和奖金积分', 24, 358, 15, '#DCEBFF', { weight: 650 });
    fillText(ctx, '微信内查看  ›', 476, 358, 15, YELLOW, { align: 'right', weight: 800 });
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

function matchSideName(side) {
  const members = Array.isArray(side?.members) ? side.members : [];
  return members.map(member => cleanText(member?.name)).filter(Boolean).join(' / ')
    || cleanText(side?.name)
    || '待定';
}

function drawRoundSummary(data) {
  const rounds = Array.isArray(data?.rounds) ? data.rounds : [];
  const selected = rounds.find(round => round.id === data?.selectedRoundId)
    || rounds.find(round => Array.isArray(round.matches) && round.matches.length)
    || null;
  const matches = Array.isArray(selected?.matches) ? selected.matches : [];
  return Object.freeze({
    roundTitle: cleanText(selected?.title, cleanText(data?.selectedRoundTitle, '当前轮次')),
    total: Number(data?.selectedRoundMatchCount || matches.length) || matches.length,
    matches: Object.freeze(matches.slice(0, 5).map(match => Object.freeze({
      id: cleanText(match.id, cleanText(match.matchId)),
      number: cleanText(match.matchNumber),
      first: matchSideName(match.sides?.[0]),
      second: matchSideName(match.sides?.[1]),
      status: cleanText(match.status) || cleanText(match.scoreText) || '待赛'
    })))
  });
}

function drawFactRows(ctx, rows, x, y, width, rowHeight, dark = true) {
  rows.forEach((row, index) => {
    const itemY = y + index * (rowHeight + 8);
    fillRoundRect(ctx, x, itemY, width, rowHeight, 10,
      dark ? 'rgba(1,14,34,0.44)' : '#FFFFFF');
    strokeRoundRect(ctx, x, itemY, width, rowHeight, 10,
      dark ? 'rgba(216,236,255,0.22)' : '#C9D5E4');
    fillText(ctx, row.number || String(index + 1), x + 16, itemY + 14, 13,
      dark ? YELLOW : BRAND_BLUE, { weight: 850 });
    fitText(ctx, row.first, x + 48, itemY + 12, width - 118, 16, 11,
      dark ? '#FFFFFF' : INK, { weight: 760 });
    fitText(ctx, row.second, x + 48, itemY + 36, width - 118, 16, 11,
      dark ? '#DCEBFF' : MUTED, { weight: 700 });
    fillText(ctx, limited(row.status, 4), x + width - 16, itemY + rowHeight / 2,
      13, dark ? '#DCEBFF' : MUTED, {
        align: 'right',
        baseline: 'middle',
        weight: 760
      });
  });
}

function drawDrawPoster(ctx, data, artwork, width, height, square = false) {
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
  logo(ctx, square ? 28 : 24, square ? 24 : 20, true, !square);
  const title = cleanText(data?.selectedTitle, '赛事签表');
  const draw = (Array.isArray(data?.draws) ? data.draws : [])
    .find(item => item.drawId === data?.selectedDrawId);
  const label = cleanText(draw?.label, '签表');
  const summary = drawRoundSummary(data);
  const rows = summary.matches;
  if (square) {
    sectionLabel(ctx, '赛事签表', 28, 70);
    if (artwork) {
      fillRoundRect(ctx, 376, 24, 96, 96, 18, '#FFFFFF');
      drawCover(ctx, artwork, 386, 34, 76, 76, 12);
    }
    fitText(ctx, title, 28, 112, artwork ? 330 : 430, 38, 25, '#FFFFFF');
    pill(ctx, 28, 165, 136, 34, limited(label, 10), YELLOW, INK);
    fillText(ctx, `${summary.roundTitle} · ${summary.total}场`, 180, 171, 18, '#DCEBFF', { weight: 760 });
    drawFactRows(ctx, rows.slice(0, 3), 28, 222, 444, 58, true);
    fillText(ctx, '完整签表与实时赛果，微信内查看', 28, 466, 15, '#DCEBFF', { weight: 650 });
  } else {
    sectionLabel(ctx, '赛事签表', 24, 55);
    if (artwork) {
      fillRoundRect(ctx, 400, 18, 76, 76, 14, '#FFFFFF');
      drawCover(ctx, artwork, 408, 26, 60, 60, 10);
    }
    fitText(ctx, title, 24, 90, artwork ? 360 : 440, 32, 23, '#FFFFFF');
    pill(ctx, 24, 136, 132, 30, limited(label, 10), YELLOW, INK);
    fillText(ctx, `${summary.roundTitle} · ${summary.total}场`, 170, 142, 17, '#DCEBFF', { weight: 750 });
    drawFactRows(ctx, rows.slice(0, 3), 24, 190, 452, 55, true);
    fillText(ctx, '完整签表与实时赛果', 24, 365, 14, '#DCEBFF', { weight: 650 });
    fillText(ctx, '微信内查看  ›', 476, 365, 14, YELLOW, { align: 'right', weight: 800 });
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
    const facts = tournamentFacts(data);
    const artwork = await getImageInfo(tournamentArtwork(facts.name, facts.level, facts.tour));
    return drawWithCanvas(page, width, height, ctx => {
      drawTournamentPoster(ctx, data, artwork, width, height, variant === 'timeline');
    });
  }
  const summary = data?.selectedTournamentSummary || {};
  const artwork = await getImageInfo(tournamentArtwork(
    data?.selectedTitle,
    summary.level,
    data?.selectedTour
  ));
  return drawWithCanvas(page, width, height, ctx => {
    drawDrawPoster(ctx, data, artwork, width, height, variant === 'timeline');
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
    drawRoundSummary(data).matches.map(match =>
      [match.id, match.number, match.first, match.second, match.status].join(':')).join('|')
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
