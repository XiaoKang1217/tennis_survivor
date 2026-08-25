'use strict';

const { readTheme } = require('../../core/theme');

Component({
  properties: {
    state: { type: String, value: 'checking' },
    message: { type: String, value: '' },
    dataAsOf: { type: String, value: '' },
    compact: { type: Boolean, value: false }
  },
  data: { displayTime: '', theme: 'clean-blue' },
  lifetimes: { attached() { this.setData({ theme: readTheme() }); } },
  observers: {
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
