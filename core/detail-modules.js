'use strict';

const { MODULE_IDS, MODULE_STATES } = require('./contracts');

const MODULE_ICONS = Object.freeze({
  statistics: 'statistics',
  point_by_point: 'score',
  h2h: 'history',
  progression_path: 'path'
});
const MODULE_LABELS = Object.freeze({
  statistics: '比赛统计',
  point_by_point: '逐分',
  h2h: 'H2H',
  progression_path: '晋级路径'
});

function fallbackModule(id) {
  return Object.freeze({
    id,
    label: MODULE_LABELS[id],
    state: 'loading',
    message: null,
    retryable: true,
    preservesLastTrustedContent: true,
    dataAsOf: null
  });
}

function displayClock(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${
    String(date.getMinutes()).padStart(2, '0')}`;
}

function moduleView(module, id) {
  if (!MODULE_IDS.includes(id)) throw new Error('detail module id invalid');
  if (!module || module.id !== id) throw new Error('detail module contract missing');
  if (!MODULE_STATES.includes(module.state)) throw new Error('detail module state invalid');
  if (typeof module.label !== 'string' || module.label.length === 0) {
    throw new Error('detail module label invalid');
  }
  if (module.message !== null && typeof module.message !== 'string') {
    throw new Error('detail module message invalid');
  }
  if (typeof module.retryable !== 'boolean'
    || typeof module.preservesLastTrustedContent !== 'boolean') {
    throw new Error('detail module behavior invalid');
  }
  return Object.freeze({
    id,
    icon: MODULE_ICONS[id],
    label: module.label,
    state: module.state,
    message: module.message,
    retryable: module.retryable,
    preservesLastTrustedContent: module.preservesLastTrustedContent,
    dataAsOf: module.dataAsOf === null ? '' : displayClock(module.dataAsOf)
  });
}

function modulesView(modules) {
  const source = modules && typeof modules === 'object' ? modules : {};
  return Object.freeze(MODULE_IDS.map(id => moduleView(source[id] || fallbackModule(id), id)));
}

module.exports = Object.freeze({
  MODULE_ICONS,
  fallbackModule,
  moduleView,
  modulesView
});
