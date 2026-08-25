'use strict';

const { readTheme } = require('../../core/theme');

function displayMessage(value) {
  return String(value || '')
    .replace(new RegExp(['本地', '可', '信'].join(''), 'gu'), '上次')
    .replace(new RegExp(['后台', '更新'].join(''), 'gu'), '刷新')
    .replace(new RegExp([
      ['同步', '加载'].join(''),
      ['独立', '加载'].join(''),
      ['并行', '更新'].join('')
    ].join('|'), 'gu'), '分区呈现')
    .replace(new RegExp([
      ['待', '确认'].join(''),
      ['待', '更新'].join('')
    ].join('|'), 'gu'), '暂缺')
    .trim();
}

Component({
  data: { displayMessage: '', theme: 'clean-blue' },
  lifetimes: { attached() { this.setData({ theme: readTheme() }); } },
  properties: {
    state: { type: String, value: 'loading' },
    label: { type: String, value: '' },
    message: { type: String, value: '' },
    retryable: { type: Boolean, value: false },
    preservesLastTrustedContent: { type: Boolean, value: false },
    dataAsOf: { type: String, value: '' }
  },
  observers: {
    message(value) {
      this.setData({ displayMessage: displayMessage(value) });
    }
  },
  methods: {
    retry() { this.triggerEvent('retry'); }
  }
});
