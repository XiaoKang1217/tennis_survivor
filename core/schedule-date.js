'use strict';

function beijingDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
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
  beijingDate,
  moveDate,
  dateLabel
});
