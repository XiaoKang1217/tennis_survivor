'use strict';

const SIZE_ORDER = Object.freeze(['96', '240', '720', 'original']);
const SIZE_ALIASES = Object.freeze({
  96: ['96', 'small', 'thumbnail', 'thumb', 'thumb96', 'list', 'avatar', 'portrait96'],
  240: ['240', 'medium', 'detail', 'profile', 'thumb240', 'portrait240'],
  720: ['720', 'large', 'share', 'hero', 'hd', 'full720', 'portrait720']
});

const PUBLIC_MEDIA_HOSTS = Object.freeze(new Set([
  'img.tennisapi.online',
  'cdn.tennisapi.online'
]));
const BLOCKED_MEDIA_HOSTS = Object.freeze(new Set([
  'api.tennisapi.online'
]));
const WTA_BLOCKED_MEDIA_HOSTS = Object.freeze(new Set([
  'wtafiles.blob.core.windows.net',
  'photoresources.wtatennis.com'
]));

function unwrap(candidate) {
  if (!candidate) return null;
  if (typeof candidate !== 'object') return candidate;
  if (candidate.state === 'available' || candidate.state === 'known') return candidate.value;
  return candidate;
}

function isWtaMedia(options = {}) {
  return String(options.authority || options.tour || '').trim().toUpperCase() === 'WTA';
}

function httpsHostname(value) {
  const match = String(value || '').trim().match(/^https:\/\/([^/?#]+)(?:[/?#]|$)/iu);
  if (!match || match[1].includes('@') || match[1].startsWith('[')) return '';
  return match[1].split(':')[0].toLowerCase();
}

function cleanUrl(value, options = {}) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('/')) return text;
  if (/^wxfile:\/\//iu.test(text)) return text;
  const hostname = httpsHostname(text);
  if (!hostname) return '';
  if (PUBLIC_MEDIA_HOSTS.has(hostname)) return text;
  if (BLOCKED_MEDIA_HOSTS.has(hostname)) return '';
  if (isWtaMedia(options) || WTA_BLOCKED_MEDIA_HOSTS.has(hostname)) return '';
  return text;
}

function cleanDirectUrl(value, options = {}) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//iu.test(text) || text.startsWith('/') || /^wxfile:\/\//iu.test(text)) {
    return cleanUrl(text, options);
  }
  return '';
}

function directUrl(value, options = {}) {
  if (!value) return '';
  if (typeof value === 'string') return cleanDirectUrl(value, options);
  if (typeof value !== 'object') return '';
  return cleanDirectUrl(value.publicUrl, options)
    || cleanDirectUrl(value.url, options)
    || cleanDirectUrl(value.cdnUrl, options)
    || cleanDirectUrl(value.edgeOneUrl, options)
    || cleanDirectUrl(value.cosUrl, options)
    || cleanDirectUrl(value.src, options)
    || cleanDirectUrl(value.href, options)
    || cleanDirectUrl(value.publicAssetKey, options);
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
  const fallback = cleanUrl(options.fallback, options);
  if (!value) return fallback;
  if (typeof value !== 'object') return directUrl(value, options) || fallback;
  for (const size of preferredSizes(options.size)) {
    const variant = variantSource(value, size);
    const url = directUrl(variant, options);
    if (url) return url;
  }
  for (const size of SIZE_ORDER) {
    const variant = variantSource(value, size);
    const url = directUrl(variant, options);
    if (url) return url;
  }
  return directUrl(value, options) || fallback;
}

function directMediaUrl(candidate, options = {}) {
  const value = unwrap(candidate);
  const fallback = cleanUrl(options.fallback, options);
  if (!value) return fallback;
  return directUrl(value, options) || fallback;
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
  directMediaUrl,
  mediaUrl,
  playerHeroImageUrl,
  playerPortraitUrl
});
