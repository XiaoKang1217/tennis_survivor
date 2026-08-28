'use strict';

const ICONS = new Set([
  'live-score',
  'draw',
  'tour-calendar',
  'entry-activity',
  'matches',
  'players',
  'following',
  'profile'
]);

function iconSource(name, active, theme) {
  const safeName = ICONS.has(name) ? name : 'matches';
  const safeTheme = ['clean-blue', 'daylight', 'dark'].includes(theme) ? theme : 'clean-blue';
  return `/assets/nav/${safeTheme}/${active ? 'active' : 'default'}/${safeName}.svg`;
}

Component({
  properties: {
    name: { type: String, value: 'matches' },
    active: { type: Boolean, value: false },
    theme: { type: String, value: 'clean-blue' },
    size: { type: Number, value: 44 },
    location: { type: String, value: 'bottom' }
  },
  data: { src: '' },
  observers: {
    'name,active,theme': function update(name, active, theme) {
      this.setData({ src: iconSource(name, active, theme) });
    }
  },
  lifetimes: {
    attached() {
      this.setData({ src: iconSource(this.data.name, this.data.active, this.data.theme) });
    }
  }
});
