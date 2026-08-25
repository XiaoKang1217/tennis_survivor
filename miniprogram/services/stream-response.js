'use strict';

function statusCode(response) {
  const value = Number(response?.statusCode);
  return Number.isInteger(value) && value >= 100 && value <= 599
    ? value : null;
}

function headerValue(response, expectedName) {
  const headers = response?.header;
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) {
    return '';
  }
  const expected = String(expectedName).toLocaleLowerCase('en-US');
  const entry = Object.entries(headers).find(([name]) =>
    String(name).toLocaleLowerCase('en-US') === expected);
  return entry === undefined ? '' : String(entry[1] ?? '');
}

/**
 * WeChat's RequestTask.onHeadersReceived callback is a header event, not the
 * final wx.request response and on real devices it need not contain
 * statusCode. The BFF's SSE content type is therefore the positive handshake
 * signal; the final success callback still owns non-2xx/401 handling.
 */
function isEventStreamHandshake(response) {
  const contentType = headerValue(response, 'content-type')
    .split(';')[0]?.trim().toLocaleLowerCase('en-US');
  if (contentType === 'text/event-stream') return true;
  return statusCode(response) === 200;
}

function isSuccessfulResponse(response) {
  const status = statusCode(response);
  return status !== null && status >= 200 && status < 300;
}

module.exports = Object.freeze({
  statusCode,
  headerValue,
  isEventStreamHandshake,
  isSuccessfulResponse
});
