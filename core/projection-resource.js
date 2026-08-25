'use strict';

function normalizeProjectionResponse(response, cachedPayload = null) {
  if (response && typeof response === 'object'
    && ('notModified' in response || 'statusCode' in response || 'headers' in response)) {
    return {
      value: response.notModified ? cachedPayload : response.data,
      etag: response.etag || '',
      notModified: response.notModified === true
    };
  }
  return { value: response, etag: '', notModified: false };
}

function readTrustedProjection(cache, resourceKey, schemaVersion) {
  if (!cache || !resourceKey) return null;
  try {
    const entry = cache.read(resourceKey, schemaVersion);
    return entry?.payload ? entry : null;
  } catch {
    return null;
  }
}

async function loadProjectionResource(options) {
  const {
    http,
    cache,
    resourceKey,
    schemaVersion,
    path,
    requestOptions = {},
    validate,
    metadata = {},
    force = false
  } = options || {};
  if (!http || typeof http.request !== 'function') throw new Error('projection_http_missing');
  if (!path) throw new Error('projection_path_missing');
  const cached = force ? null : readTrustedProjection(cache, resourceKey, schemaVersion);
  const response = await http.request(path, {
    authMode: 'none',
    allowNotModified: true,
    returnResponse: true,
    ...requestOptions,
    ifNoneMatch: force ? '' : cached?.etag
  });
  const normalized = normalizeProjectionResponse(response, cached?.payload);
  const value = typeof validate === 'function'
    ? validate(normalized.value)
    : normalized.value;
  if (!normalized.notModified && cache && resourceKey && value && typeof value === 'object') {
    cache.write(resourceKey, {
      schemaVersion,
      projectionVersion: value.projectionVersion,
      dataAsOf: metadata.dataAsOf ? metadata.dataAsOf(value) : value.dataAsOf || '',
      etag: normalized.etag || value.etag || '',
      payload: value
    });
  }
  return Object.freeze({
    value,
    cached,
    notModified: normalized.notModified,
    etag: normalized.etag || cached?.etag || '',
    source: normalized.notModified ? 'cache-not-modified' : 'network'
  });
}

module.exports = Object.freeze({
  loadProjectionResource,
  normalizeProjectionResponse,
  readTrustedProjection
});
