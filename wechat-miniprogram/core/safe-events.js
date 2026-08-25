'use strict';

const EVENT_CODE = /^[a-z][a-z0-9_]{1,63}$/;
const listeners = new Set();

function emit(code) {
  if (!EVENT_CODE.test(code)) throw new Error('unsafe event code');
  for (const listener of [...listeners]) listener(code);
}

function subscribe(listener) {
  if (typeof listener !== 'function') throw new Error('event listener invalid');
  listeners.add(listener);
  return () => listeners.delete(listener);
}

module.exports = Object.freeze({ emit, subscribe });
