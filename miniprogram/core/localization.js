'use strict';

// These dictionaries translate only provider-neutral codes already frozen by
// the BFF contracts. They must never inspect source labels, player counts or
// payload array positions to infer a business fact.
const LEVEL_LABELS = Object.freeze({
  grand_slam: '大满贯',
  masters_1000: 'ATP 1000',
  tour_500: 'ATP 500',
  tour_250: 'ATP 250',
  wta_1000: 'WTA 1000',
  wta_500: 'WTA 500',
  wta_250: 'WTA 250',
  wta_125: 'WTA 125',
  challenger_175: 'CH 175',
  challenger_125: 'CH 125',
  challenger_100: 'CH 100',
  challenger_75: 'CH 75',
  challenger_50: 'CH 50',
  itf_m25: 'M25',
  itf_m15: 'M15',
  itf_w100: 'W100',
  itf_w75: 'W75',
  itf_w50: 'W50',
  itf_w35: 'W35',
  itf_w15: 'W15',
  junior_j500: 'J500',
  junior_j300: 'J300',
  junior_j200: 'J200',
  junior_j100: 'J100',
  junior_j60: 'J60',
  junior_j30: 'J30',
  unknown: '级别暂缺'
});

const DISCIPLINE_LABELS = Object.freeze({
  singles: '单打',
  doubles: '双打',
  mixed_doubles: '混双',
  mixed: '混双',
  unknown: '项目暂缺'
});

const STAGE_LABELS = Object.freeze({
  qualifying: '资格赛',
  main_draw: '正赛',
  round_robin: '小组赛',
  playoff: '附加赛',
  unknown: '阶段暂缺'
});

const ROUND_LABELS = Object.freeze({
  Q1: '资格赛第一轮',
  Q2: '资格赛第二轮',
  Q3: '资格赛决胜轮',
  Q4: '资格赛第四轮',
  Q5: '资格赛第五轮',
  QR: '资格赛决胜轮',
  ROUND_1: '第一轮',
  ROUND_2: '第二轮',
  ROUND_3: '第三轮',
  ROUND_4: '第四轮',
  ROUND_5: '第五轮',
  R128: '128强',
  R96: '96强',
  R64: '64强',
  R48: '48强',
  R32: '32强',
  R16: '16强',
  QF: '四分之一决赛',
  SF: '半决赛',
  F: '决赛',
  BRONZE: '铜牌赛',
  RUBBER_1: '第一场',
  RUBBER_2: '第二场',
  RUBBER_3: '第三场',
  RUBBER_4: '第四场',
  RUBBER_5: '第五场',
  RR: '小组赛',
  ER: '附加轮',
  CR: '安慰赛',
  unknown: '轮次暂缺'
});

function normalizeLevelCode(value) {
  const source = String(value || '').trim().toLocaleLowerCase('en-US')
    .replace(/-/gu, '_');
  if (!source) return '';
  if (source === 'atp_1000') return 'masters_1000';
  if (source === 'atp_500' || source === 'atp_250') return source.replace('atp', 'tour');
  const challenger = /^ch_(50|75|100|125|175)$/u.exec(source);
  if (challenger) return `challenger_${challenger[1]}`;
  const itf = /^([mw])_(15|25|35|50|75|100)$/u.exec(source);
  if (itf) return `itf_${itf[1]}${itf[2]}`;
  return source;
}

function dictionaryLabel(dictionary, code) {
  const normalized = normalizeLevelCode(code);
  return typeof normalized === 'string'
    && Object.prototype.hasOwnProperty.call(dictionary, normalized)
    ? dictionary[normalized]
    : '';
}

function roundLabel(code) {
  const source = String(code || '').trim();
  if (!source) return '';
  const normalized = source.replace(/[\s-]+/gu, '_').toLocaleUpperCase('en-US');
  if (Object.prototype.hasOwnProperty.call(ROUND_LABELS, normalized)) {
    return ROUND_LABELS[normalized];
  }
  return normalized === 'UNKNOWN' ? ROUND_LABELS.unknown : '';
}

module.exports = Object.freeze({
  LEVEL_LABELS,
  DISCIPLINE_LABELS,
  STAGE_LABELS,
  ROUND_LABELS,
  normalizeLevelCode,
  levelLabel: code => dictionaryLabel(LEVEL_LABELS, code),
  disciplineLabel: code => dictionaryLabel(DISCIPLINE_LABELS, code),
  stageLabel: code => dictionaryLabel(STAGE_LABELS, code),
  roundLabel
});
