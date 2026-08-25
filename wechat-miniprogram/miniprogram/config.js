'use strict';

module.exports = Object.freeze({
  bffBaseUrl: 'https://api.tennisapi.online',
  streamBaseUrl: 'https://stream.tennisapi.online',
  clientContractVersion: 'score-bff/3',
  presentationContractVersion: 'match-presentation/1',
  realtimeContractVersion: 'score-realtime/3',
  statisticsRealtimeContractVersion: 'match-statistics-realtime/2',
  displayTimezone: 'Asia/Shanghai',
  fallbackCalibrationMinMilliseconds: 60_000,
  fallbackCalibrationMaxMilliseconds: 120_000,
  statisticsCalibrationMilliseconds: 60_000,
  sessionRefreshSkewMilliseconds: 60_000
});
