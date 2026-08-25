'use strict';

const SIZE_ORDER = Object.freeze(['96', '240', '720', 'original']);
const SIZE_ALIASES = Object.freeze({
  96: ['96', 'small', 'thumbnail', 'thumb', 'list', 'avatar', 'portrait96'],
  240: ['240', 'medium', 'detail', 'profile', 'portrait240'],
  720: ['720', 'large', 'share', 'hero', 'hd', 'portrait720']
});

function unwrap(candidate) {
  if (!candidate) return null;
  if (typeof candidate !== 'object') return candidate;
  if (candidate.state === 'available' || candidate.state === 'known') return candidate.value;
  return candidate;
}

function cleanUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//iu.test(text) || text.startsWith('/')) return text;
  return '';
}

function directUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return cleanUrl(value);
  if (typeof value !== 'object') return '';
  return cleanUrl(value.publicUrl)
    || cleanUrl(value.url)
    || cleanUrl(value.cdnUrl)
    || cleanUrl(value.edgeOneUrl)
    || cleanUrl(value.cosUrl)
    || cleanUrl(value.src)
    || cleanUrl(value.href)
    || cleanUrl(value.publicAssetKey);
}

function variantSource(value, size) {
  if (!value || typeof value !== 'object') return null;
  const aliases = SIZE_ALIASES[size] || [String(size)];
  const pools = [
    value.variants,
    value.sizes,
    value.urls,
    value.publicUrls,
    value.images,
    value.sources
  ].filter(item => item && typeof item === 'object');
  for (const pool of pools) {
    for (const key of aliases) {
      if (pool[key]) return pool[key];
    }
  }
  for (const key of aliases) {
    const urlKey = `${key}Url`;
    const publicUrlKey = `${key}PublicUrl`;
    if (value[urlKey]) return value[urlKey];
    if (value[publicUrlKey]) return value[publicUrlKey];
  }
  return null;
}

function preferredSizes(size) {
  const requested = String(size || '240');
  if (requested === '96') return ['96', '240', '720', 'original'];
  if (requested === '720') return ['720', '240', '96', 'original'];
  return ['240', '96', '720', 'original'];
}

function mediaUrl(candidate, options = {}) {
  const value = unwrap(candidate);
  const fallback = cleanUrl(options.fallback);
  if (!value) return fallback;
  const source = directUrl(value);
  if (source) return source;
  if (typeof value !== 'object') return fallback;
  for (const size of preferredSizes(options.size)) {
    const variant = variantSource(value, size);
    const url = directUrl(variant);
    if (url) return url;
  }
  for (const size of SIZE_ORDER) {
    const variant = variantSource(value, size);
    const url = directUrl(variant);
    if (url) return url;
  }
  return fallback;
}

function playerPortraitUrl(source, options = {}) {
  return mediaUrl(source?.portrait, options)
    || mediaUrl(source?.portraitUrl, options)
    || mediaUrl(source?.portraitAvailability, options)
    || mediaUrl(source, options);
}

function playerHeroImageUrl(source, options = {}) {
  return mediaUrl(source?.heroImage, options)
    || mediaUrl(source?.heroImageUrl, options)
    || playerPortraitUrl(source, options);
}

module.exports = Object.freeze({
  mediaUrl,
  playerHeroImageUrl,
  playerPortraitUrl
});
