'use strict';

const ROUTES = Object.freeze({
  matches: '/pages/scores/index',
  players: '/packages/player/pages/players/index',
  following: '/pages/following/index',
  account: '/pages/account/index'
});

Component({
  properties: {
    active: { type: String, value: 'matches' },
    theme: { type: String, value: 'clean-blue' }
  },
  data: {
    activeColor: '#1769df',
    inactiveColor: '#64758a'
  },
  observers: {
    theme(value) {
      const palette = value === 'daylight'
        ? { activeColor: '#187a59', inactiveColor: '#6a756c' }
        : value === 'dark'
          ? { activeColor: '#9bc4ff', inactiveColor: '#a7b7cb' }
          : { activeColor: '#1769df', inactiveColor: '#64758a' };
      this.setData(palette);
    }
  },
  lifetimes: {
    attached() {
      const palette = this.data.theme === 'daylight'
        ? { activeColor: '#187a59', inactiveColor: '#6a756c' }
        : this.data.theme === 'dark'
          ? { activeColor: '#9bc4ff', inactiveColor: '#a7b7cb' }
          : { activeColor: '#1769df', inactiveColor: '#64758a' };
      this.setData(palette);
    }
  },
  methods: {
    select(event) {
      const target = event.currentTarget.dataset.target;
      if (!ROUTES[target] || target === this.data.active) return;
      wx.reLaunch({ url: ROUTES[target] });
    }
  }
});
