'use strict';

const ROUTES = Object.freeze({
  matches: '/pages/scores/index',
  players: '/pages/players/index',
  following: '/pages/following/index',
  account: '/pages/account/index'
});

Component({
  properties: {
    active: { type: String, value: 'matches' },
    theme: { type: String, value: 'clean-blue' }
  },
  data: {
    activeColor: '#339cff',
    inactiveColor: '#66788a'
  },
  observers: {
    theme(value) {
      const palette = value === 'daylight'
        ? { activeColor: '#54775e', inactiveColor: '#8b8b7e' }
        : value === 'dark'
          ? { activeColor: '#38bdf8', inactiveColor: '#94a3b8' }
          : { activeColor: '#339cff', inactiveColor: '#66788a' };
      this.setData(palette);
    }
  },
  lifetimes: {
    attached() {
      const palette = this.data.theme === 'daylight'
        ? { activeColor: '#54775e', inactiveColor: '#8b8b7e' }
        : this.data.theme === 'dark'
          ? { activeColor: '#38bdf8', inactiveColor: '#94a3b8' }
          : { activeColor: '#339cff', inactiveColor: '#66788a' };
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
