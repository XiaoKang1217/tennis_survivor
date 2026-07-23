import path from 'node:path';

export function loadConfig(env = process.env) {
  return {
    apiKey: env.API_TENNIS_KEY || '',
    apiBase: env.API_TENNIS_BASE || 'https://api.api-tennis.com/tennis/',
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 8787),
    timeZone: env.TIME_ZONE || 'Asia/Shanghai',
    cacheFile: path.resolve(env.CACHE_FILE || './var/cache.json'),
    origins: new Set((env.PUBLIC_ORIGINS || 'http://127.0.0.1:4173,http://localhost:4173').split(',').map(v => v.trim()).filter(Boolean)),
    dailyLimit: Number(env.DAILY_REQUEST_LIMIT || 8000),
    fixturesTtlMs: Number(env.FIXTURES_TTL_MS || 6 * 60 * 60_000),
    oddsTtlMs: Number(env.ODDS_TTL_MS || 60 * 60_000),
    observationBeforeMs: Number(env.OBSERVATION_BEFORE_MS || 15 * 60_000),
    observationAfterMs: Number(env.OBSERVATION_AFTER_MS || 6 * 60 * 60_000),
    officialWtaBase: env.OFFICIAL_WTA_BASE || 'https://api.wtatennis.com/tennis',
    officialTtlMs: Number(env.OFFICIAL_TTL_MS || 5 * 60_000),
    localizationUrl: env.LOCALIZATION_URL || 'https://www.live-tennis.cn/zh/result/{date}',
    localizationTtlMs: Number(env.LOCALIZATION_TTL_MS || 10 * 60_000),
    translationCatalogFile: path.resolve(env.TRANSLATION_CATALOG_FILE || './data/translations.json')
  };
}
