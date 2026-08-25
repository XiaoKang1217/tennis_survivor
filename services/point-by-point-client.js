'use strict';

const {
  CompletionStatisticsClient
} = require('./completion-statistics-client');

class PointByPointClient extends CompletionStatisticsClient {}

module.exports = Object.freeze({ PointByPointClient });
