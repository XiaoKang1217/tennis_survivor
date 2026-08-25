'use strict';

const PATHS = Object.freeze({
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  court: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14M3 12h18"/>',
  match: '<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7c4.2 4.2 8.4 8.4 12.6 12.6M18.3 5.7 5.7 18.3"/>',
  draw: '<path d="M5 4h14v4H5zM5 16h14v4H5zM8 8v8M16 8v8"/>',
  entry: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="7" r="2"/><path d="M3 20c.5-4 2.3-6 5-6s4.5 2 5 6M14 13c3 0 5 2 5 5"/>',
  matches: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',
  player: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.7-5 3.2-7 7.5-7s6.8 2 7.5 7"/>',
  follow: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  heart: '<path d="M20.8 5.8c-2-2-5.2-1.7-6.9.5L12 8.7l-1.9-2.4C8.4 4.1 5.2 3.8 3.2 5.8c-2.2 2.2-2 5.7.2 7.8L12 21l8.6-7.4c2.2-2.1 2.4-5.6.2-7.8Z"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M5 21c.6-4.5 3-7 7-7s6.4 2.5 7 7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M5 21c.6-4.5 3-7 7-7s6.4 2.5 7 7"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.5-4.5M8.2 13.2l7.5 4.5"/>',
  retry: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  connection: '<path d="M4 9a11 11 0 0 1 16 0M7 12a7 7 0 0 1 10 0M10 15a3 3 0 0 1 4 0"/><circle cx="12" cy="19" r="1"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  shield: '<path d="M12 3 5 6v5c0 4.8 2.7 8.2 7 10 4.3-1.8 7-5.2 7-10V6Z"/><path d="m9 12 2 2 4-5"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  collapse: '<path d="m6 15 6-6 6 6"/>',
  expand: '<path d="m6 9 6 6 6-6"/>',
  fullscreen: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  statistics: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  path: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18c7 0 3-12 10-12"/>',
  score: '<path d="M4 5h16v14H4zM12 5v14M4 12h16"/>'
});

function source(name, color) {
  const paths = PATHS[name] || PATHS.info;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

Component({
  properties: {
    name: { type: String, value: 'info' },
    size: { type: Number, value: 20 },
    color: { type: String, value: '#61728a' }
  },
  data: { src: '' },
  observers: {
    'name,color': function update(name, color) {
      this.setData({ src: source(name, color) });
    }
  },
  lifetimes: {
    attached() {
      this.setData({ src: source(this.data.name, this.data.color) });
    }
  }
});
