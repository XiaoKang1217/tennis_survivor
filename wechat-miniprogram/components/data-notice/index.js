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
    .replace(new RegExp(['资料', '可用性'].join(''), 'gu'), '资料状态')
    .replace(new RegExp(['资料', '完整度'].join(''), 'gu'), '资料范围')
    .replace(new RegExp([
      ['待', '确认'].join(''),
      ['待', '更新'].join('')
    ].join('|'), 'gu'), '暂缺')
    .trim();
}

Component({
  properties: {
    state: { type: String, value: 'checking' },
    message: { type: String, value: '' },
    dataAsOf: { type: String, value: '' },
    compact: { type: Boolean, value: false }
  },
  data: { displayMessage: '', displayTime: '', theme: 'clean-blue' },
  lifetimes: { attached() { this.setData({ theme: readTheme() }); } },
  observers: {
    message(value) {
      this.setData({ displayMessage: displayMessage(value) });
    },
    dataAsOf(value) {
      if (!value || !Number.isFinite(Date.parse(value))) {
        this.setData({ displayTime: '' });
        return;
      }
      const date = new Date(value);
      const displayTime = `${String(date.getHours()).padStart(2, '0')}`
        + `:${String(date.getMinutes()).padStart(2, '0')}`;
      this.setData({ displayTime });
    }
  }
});
