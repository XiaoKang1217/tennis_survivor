'use strict';

const { levelLabel } = require('./localization');

const SURFACE_LABELS = Object.freeze({
  hard: '硬地',
  clay: '红土',
  grass: '草地',
  carpet: '地毯'
});

const ENVIRONMENT_LABELS = Object.freeze({
  indoor: '室内',
  outdoor: '室外'
});

const CIRCUIT_LABELS = Object.freeze({
  atp_tour: 'ATP 巡回赛',
  atp_challenger: 'ATP 挑战赛',
  wta_tour: 'WTA 巡回赛',
  wta_125: 'WTA 125',
  itf_world_tennis_tour: 'ITF 世界网球巡回赛',
  itf_junior: 'ITF 青少年巡回赛',
  grand_slam: '大满贯',
  team: '团体赛事',
  other: '其他赛事'
});

const AGE_GROUP_LABELS = Object.freeze({ adult: '成人', junior: '青少年' });
const DISCIPLINE_LABELS = Object.freeze({ singles: '单打', doubles: '双打' });
const SCOPE_LABELS = Object.freeze({
  singles: '单打',
  doubles: '双打',
  combined: '综合'
});
const AVAILABILITY_LABELS = Object.freeze({
  available: '资料可用',
  partial: '部分资料待补齐',
  stale: '显示上次可信资料',
  unavailable: '资料暂不可用',
  not_observed: '资料状态待确认'
});
const COMPLETENESS_LABELS = Object.freeze({
  complete: '完整',
  partial: '部分完整',
  unknown: '待确认'
});

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function pending(label, message) {
  return Object.freeze({
    label,
    available: false,
    value: '',
    message: text(message) || `${label}待确认`
  });
}

function productField(label, candidate, formatter = text, message = '') {
  if (candidate?.state !== 'available' || candidate.value === null) {
    return pending(label, candidate?.message || message);
  }
  const value = text(formatter(candidate.value));
  return value
    ? Object.freeze({ label, available: true, value, message: '' })
    : pending(label, message);
}

function factField(label, candidate, formatter = text, message = '') {
  if (candidate?.state !== 'known' || candidate.value === null) {
    return pending(label, message);
  }
  const value = text(formatter(candidate.value));
  return value
    ? Object.freeze({ label, available: true, value, message: '' })
    : pending(label, message);
}

function dictionary(dictionary, value) {
  const key = text(value);
  return Object.prototype.hasOwnProperty.call(dictionary, key)
    ? dictionary[key] : key === 'unknown' ? '' : key;
}

function preferred(first, second) {
  return first.available ? first : second.available ? second : first;
}

function beijingInstant(candidate) {
  const value = text(candidate);
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return '';
  const date = new Date(instant + 8 * 60 * 60 * 1000);
  const part = number => String(number).padStart(2, '0');
  return `${date.getUTCFullYear()}-${part(date.getUTCMonth() + 1)}`
    + `-${part(date.getUTCDate())} ${part(date.getUTCHours())}`
    + `:${part(date.getUTCMinutes())}`;
}

function lifecycle(presentation) {
  const display = presentation?.datesAndStatus?.displayLifecycle;
  const label = text(display?.label);
  return display?.code && display.code !== 'unknown' && label
    ? Object.freeze({
        label: '赛事状态', available: true, value: label, message: '',
        code: display.code
      })
    : Object.freeze({
        ...pending('赛事状态', label || '赛事状态待确认'),
        code: 'unknown'
      });
}

function siteView(site) {
  return Object.freeze({
    id: text(site?.venueId),
    name: productField('场馆名称', site?.displayName),
    city: productField('城市', site?.cityDisplayName),
    country: productField('国家或地区', site?.countryCode)
  });
}

function courtView(court) {
  return Object.freeze({
    id: text(court?.venueId),
    name: productField('球场名称', court?.displayName),
    surface: productField(
      '球场场地',
      court?.surface,
      value => dictionary(SURFACE_LABELS, value),
      '球场场地待确认'
    )
  });
}

function championView(champion, index) {
  const displayNames = Array.isArray(champion?.displayNames)
    ? champion.displayNames.map(text).filter(Boolean) : [];
  if (displayNames.length === 0) return null;
  const year = factField('年份', champion?.year, String, '年份待确认');
  const result = factField(
    '决赛结果', champion?.resultDisplay, text, '决赛结果待确认'
  );
  return Object.freeze({
    id: `${year.available ? year.value : 'unknown'}-${index}`,
    names: displayNames.join(' / '),
    discipline: dictionary(DISCIPLINE_LABELS, champion?.discipline)
      || '项目待确认',
    year,
    result
  });
}

function recordView(record, index) {
  const name = factField('球员', record?.displayName, text, '球员待确认');
  if (!name.available) return null;
  const matchWins = factField('胜场', record?.matchWins, String, '胜场待确认');
  const titleCount = factField(
    '冠军数', record?.titleCount, String, '冠军数待确认'
  );
  const scope = factField(
    '统计范围',
    record?.scope,
    value => dictionary(SCOPE_LABELS, value),
    '统计范围待确认'
  );
  return Object.freeze({
    id: `${name.value}-${index}`,
    name: name.value,
    matchWins,
    titleCount,
    scope
  });
}

function providerRowView(row) {
  const label = text(row?.label || row?.key);
  if (!label) return null;
  return Object.freeze({
    key: text(row?.key || label),
    label,
    available: row?.value?.state === 'available' && row.value.value !== null,
    value: text(row?.value?.value),
    message: text(row?.value?.message) || '暂无'
  });
}

function providerSectionView(section) {
  const rows = Array.isArray(section?.rows)
    ? section.rows.map(providerRowView).filter(Boolean) : [];
  if (rows.length === 0) return null;
  return Object.freeze({
    id: text(section?.id || section?.title || 'provider-fields'),
    title: text(section?.title) || '赛事信息',
    rows
  });
}

function tournamentDetailView(presentation) {
  if (!presentation || typeof presentation !== 'object'
    || !presentation.identity || !presentation.names
    || !presentation.classification || !presentation.datesAndStatus
    || !presentation.locationAndSurface || !presentation.venues
    || !presentation.history || !presentation.delivery) {
    throw new Error('tournament detail presentation invalid');
  }
  const tournamentEditionId = text(presentation.identity.tournamentEditionId);
  if (!tournamentEditionId) {
    throw new Error('tournament detail edition id invalid');
  }
  const name = preferred(
    productField('赛事名称', presentation.names.headline),
    preferred(
      productField('赛事名称', presentation.names.displayNameZh),
      productField('赛事名称', presentation.names.displayNameOriginal)
    )
  );
  const tier = preferred(
    productField('赛事级别', presentation.classification.tierDisplayName),
    productField(
      '赛事级别',
      presentation.classification.levelCode,
      value => levelLabel(text(value)) || (text(value) === 'unknown' ? '' : text(value)),
      '赛事级别待确认'
    )
  );
  const classification = Object.freeze([
    productField('赛事体系', presentation.classification.authority),
    productField(
      '巡回赛类别',
      presentation.classification.circuit,
      value => dictionary(CIRCUIT_LABELS, value),
      '巡回赛类别待确认'
    ),
    tier,
    productField(
      '年龄组',
      presentation.classification.ageGroup,
      value => dictionary(AGE_GROUP_LABELS, value),
      '年龄组待确认'
    )
  ]);
  const dates = Object.freeze([
    productField(
      '开始日期', presentation.datesAndStatus.officialStartLocalDate,
      text, '赛事开始日期待确认'
    ),
    productField(
      '结束日期', presentation.datesAndStatus.officialEndLocalDate,
      text, '赛事结束日期待确认'
    ),
    lifecycle(presentation)
  ]);
  const location = Object.freeze([
    preferred(
      productField(
        '国家或地区', presentation.locationAndSurface.countryDisplayName,
        text, '国家或地区待确认'
      ),
      productField(
        '国家或地区', presentation.locationAndSurface.countryCode,
        text, '国家或地区待确认'
      )
    ),
    productField(
      '城市', presentation.locationAndSurface.cityDisplayName,
      text, '城市待确认'
    ),
    productField(
      '场馆', presentation.locationAndSurface.venueDisplayName,
      text, '场馆待确认'
    ),
    productField(
      '场地',
      presentation.locationAndSurface.surface,
      value => dictionary(SURFACE_LABELS, value),
      '场地类型待确认'
    ),
    productField(
      '室内外',
      presentation.locationAndSurface.environment,
      value => dictionary(ENVIRONMENT_LABELS, value),
      '室内外待确认'
    )
  ]);
  const champions = Object.freeze((Array.isArray(presentation.history.pastChampions)
    ? presentation.history.pastChampions : [])
    .map(championView).filter(Boolean));
  const records = Object.freeze((Array.isArray(presentation.history.records)
    ? presentation.history.records : [])
    .map(recordView).filter(Boolean));
  const providerSections = Object.freeze((Array.isArray(
    presentation.providerFields?.sections
  ) ? presentation.providerFields.sections : [])
    .map(providerSectionView).filter(Boolean));
  const availability = text(presentation.delivery.availability);
  const completeness = text(presentation.delivery.completeness);
  const gaps = Array.isArray(presentation.delivery.coverageGaps)
    ? presentation.delivery.coverageGaps.length : 0;
  const tournamentFollow = presentation.viewerFollowState?.tournament || {};
  return Object.freeze({
    tournamentEditionId,
    followTargetId: text(tournamentFollow.targetId || presentation.identity.tournamentFollowKey)
      || tournamentEditionId,
    followed: tournamentFollow.followed === true,
    name,
    lifecycle: lifecycle(presentation),
    classification,
    dates,
    location,
    sites: Object.freeze((Array.isArray(presentation.venues.sites)
      ? presentation.venues.sites : []).map(siteView)),
    courts: Object.freeze((Array.isArray(presentation.venues.courts)
      ? presentation.venues.courts : []).map(courtView)),
    champions,
    records,
    hasHistory: champions.length > 0 || records.length > 0,
    providerSections,
    dataStatus: Object.freeze({
      availability: AVAILABILITY_LABELS[availability] || '资料状态待确认',
      completeness: COMPLETENESS_LABELS[completeness] || '待确认',
      gapMessage: gaps > 0 ? `${gaps} 项资料仍待补齐` : '',
      notice: text(presentation.delivery.dataNotice),
      dataAsOf: text(presentation.delivery.dataAsOf),
      updatedAt: beijingInstant(presentation.delivery.dataAsOf)
    })
  });
}

function noticeState(state) {
  return Object.freeze({
    current: 'live',
    delayed: 'delayed',
    stale: 'stale',
    unavailable: 'unavailable',
    checking: 'checking'
  })[state] || 'checking';
}

module.exports = Object.freeze({
  tournamentDetailView,
  noticeState
});
