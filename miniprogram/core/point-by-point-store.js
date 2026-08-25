'use strict';

const {
  CompletionStatisticsStore
} = require('./completion-statistics-store');

class PointByPointStore extends CompletionStatisticsStore {}

module.exports = Object.freeze({ PointByPointStore });
