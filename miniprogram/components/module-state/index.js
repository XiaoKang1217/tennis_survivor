'use strict';

const { readTheme } = require('../../core/theme');

Component({
  data: { theme: 'clean-blue' },
  lifetimes: { attached() { this.setData({ theme: readTheme() }); } },
  properties: {
    state: { type: String, value: 'loading' },
    label: { type: String, value: '' },
    message: { type: String, value: '' },
    retryable: { type: Boolean, value: false },
    preservesLastTrustedContent: { type: Boolean, value: false },
    dataAsOf: { type: String, value: '' }
  },
  methods: {
    retry() { this.triggerEvent('retry'); }
  }
});
