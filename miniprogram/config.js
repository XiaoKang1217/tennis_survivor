'use strict';

module.exports = Object.freeze({
  bffBaseUrl: 'https://api.tennisapi.online',
  streamBaseUrl: 'https://stream.tennisapi.online',
  clientContractVersion: 'score-bff/3',
  presentationContractVersion: 'match-presentation/1',
  realtimeContractVersion: 'score-realtime/3',
  statisticsRealtimeContractVersion: 'match-statistics-realtime/2',
  displayTimezone: 'Asia/Shanghai',
  fallbackCalibrationMinMilliseconds: 25_000,
  fallbackCalibrationMaxMilliseconds: 35_000,
  matchDetailCalibrationMilliseconds: 20_000,
  statisticsCalibrationMilliseconds: 60_000,
  sessionRefreshSkewMilliseconds: 60_000
});
