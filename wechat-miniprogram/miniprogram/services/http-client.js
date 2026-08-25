'use strict';

const config = require('../config');

function wxRequest(wxRuntime, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let task;
    const timeoutMilliseconds = Number.isFinite(options.timeout)
      && options.timeout > 0 ? options.timeout : 10_000;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { task?.abort?.(); } catch { /* bounded */ }
      reject(new Error('network_request_timeout'));
    }, timeoutMilliseconds);
    try {
      task = wxRuntime.request({
        ...options,
        success: finish(resolve),
        fail: finish(() => reject(new Error('network_request_failed')))
      });
    } catch {
      finish(reject)(new Error('network_request_failed'));
    }
  });
}

function createIdempotencyKey(prefix = 'wx') {
  const safePrefix = String(prefix || 'wx')
    .replace(/[^A-Za-z0-9._:-]+/gu, '-')
    .slice(0, 24) || 'wx';
  const randomPart = Math.random().toString(36).slice(2, 12);
  return (safePrefix + ':' + Date.now().toString(36) + ':' + randomPart).slice(0, 128);
}

function mutationIdempotencyHeader(path, method, options) {
  const verb = String(method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(verb)) return {};
  const provided = String(options.header?.['x-idempotency-key']
    || options.header?.['X-Idempotency-Key']
    || options.idempotencyKey
    || '').trim();
  if (provided) return { 'x-idempotency-key': provided };
  options.idempotencyKey = createIdempotencyKey(verb + ':' + String(path || '').slice(0, 32));
  return { 'x-idempotency-key': options.idempotencyKey };
}

function normalizeAuthMode(options = {}) {
  const explicit = String(options.authMode || options.auth || '').toLowerCase();
  if (explicit === 'required' || options.authRequired === true) return 'required';
  if (explicit === 'optional') return 'optional';
  return 'none';
}

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, String(value)]));
}

function responseHeaders(response) { return response?.header || response?.headers || {}; }

function responseEtag(response) {
  const headers = responseHeaders(response);
  return headers.ETag || headers.Etag || headers.etag || '';
}

class HttpError extends Error {
  constructor(statusCode, code, retryable) {
    super(code);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

class HttpClient {
  constructor(wxRuntime, auth) {
    this.wx = wxRuntime;
    this.auth = auth;
  }

  async tokenForMode(authMode) {
    if (authMode === 'required') return this.auth.ensure();
    if (authMode === 'optional' && typeof this.auth.currentAccessToken === 'function') {
      return this.auth.currentAccessToken();
    }
    return '';
  }

  async request(path, options = {}, retried = false) {
    const authMode = normalizeAuthMode(options);
    const method = options.method || 'GET';
    const token = await this.tokenForMode(authMode);
    const headers = normalizeHeaders({
      'x-luwang-client-contract-version': config.clientContractVersion,
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(options.noCache === true ? {
        'cache-control': 'no-cache',
        pragma: 'no-cache'
      } : {}),
      ...(options.ifNoneMatch ? { 'If-None-Match': options.ifNoneMatch } : {}),
      ...mutationIdempotencyHeader(path, method, options),
      ...(options.header || {})
    });
    const response = await wxRequest(this.wx, {
      url: config.bffBaseUrl + path,
      method,
      data: options.data,
      timeout: options.timeout || 10_000,
      header: headers
    });
    if (response.statusCode === 304 && options.allowNotModified === true) {
      const result = {
        notModified: true,
        statusCode: 304,
        data: null,
        headers: responseHeaders(response),
        etag: responseEtag(response),
        response
      };
      return options.returnResponse === true ? result : null;
    }
    if (response.statusCode === 401 && authMode === 'required' && !retried) {
      this.auth.invalidate();
      await this.auth.refresh(true);
      return this.request(path, options, true);
    }
    if (response.statusCode === 401 && authMode === 'optional' && token && !retried) {
      this.auth.invalidate();
      return this.request(path, { ...options, authMode: 'none' }, true);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const error = response.data && response.data.error;
      throw new HttpError(
        response.statusCode,
        typeof error?.code === 'string' ? error.code : 'bff_request_failed',
        error?.retryable === true
      );
    }
    if (options.returnResponse === true) {
      return {
        notModified: false,
        statusCode: response.statusCode,
        data: response.data,
        headers: responseHeaders(response),
        etag: responseEtag(response),
        response
      };
    }
    return response.data;
  }
}

module.exports = Object.freeze({
  wxRequest,
  HttpClient,
  HttpError,
  createIdempotencyKey,
  normalizeAuthMode
});
