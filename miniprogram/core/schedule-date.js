'use strict';

const SHANGHAI_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;

function shanghaiDate(value = new Date()) {
  const instant = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  return Number.isFinite(instant) ? new Date(instant + SHANGHAI_OFFSET_MILLISECONDS) : null;
}

function twoDigits(value) { return String(value).padStart(2, '0'); }

function beijingDate(now = new Date()) {
  const date = shanghaiDate(now);
  if (!date) return '';
  return `${date.getUTCFullYear()}-${twoDigits(date.getUTCMonth() + 1)}`
    + `-${twoDigits(date.getUTCDate())}`;
}

function beijingClock(value, includeSeconds = true) {
  const date = shanghaiDate(value);
  if (!date) return '';
  const clock = `${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())}`;
  return includeSeconds ? `${clock}:${twoDigits(date.getUTCSeconds())}` : clock;
}

function beijingDateTime(value) {
  const date = shanghaiDate(value);
  if (!date) return '';
  return `${date.getUTCFullYear()}-${twoDigits(date.getUTCMonth() + 1)}`
    + `-${twoDigits(date.getUTCDate())} ${beijingClock(value, false)}`;
}

function moveDate(value, offset) {
  const instant = new Date(`${value}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + offset);
  return instant.toISOString().slice(0, 10);
}

function dateLabel(value) {
  return value;
}

module.exports = Object.freeze({
  beijingClock,
  beijingDate,
  beijingDateTime,
  moveDate,
  dateLabel
});
