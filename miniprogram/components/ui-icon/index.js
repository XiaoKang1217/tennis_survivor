'use strict';

const PATHS = Object.freeze({
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  court: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14M3 12h18"/>',
  match: '<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7c4.2 4.2 8.4 8.4 12.6 12.6M18.3 5.7 5.7 18.3"/>',
  draw: '<rect x="3" y="3.5" width="6" height="4" rx="1.2"/><rect x="3" y="16.5" width="6" height="4" rx="1.2"/><rect x="15" y="10" width="6" height="4" rx="1.2"/><path d="M9 5.5h3v6.5h3M9 18.5h3V12"/>',
  entry: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.3"/><path d="M3 20c.7-4 2.7-6 6-6s5.3 2 6 6M14 15c3.6-.8 5.8.9 6.5 4.5"/>',
  matches: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',
  player: '<circle cx="12" cy="12" r="9"/><circle cx="10.5" cy="9" r="2.6"/><path d="M5.8 18c.7-3.2 2.3-4.8 4.7-4.8s4 1.6 4.7 4.8"/><circle cx="17.2" cy="7" r="2.2"/><path d="M15.8 5.4c1 1 1.8 1.8 2.8 2.8M18.7 5.5l-3 3"/>',
  follow: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  heart: '<path d="M12 20.2 4.5 13c-3.7-3.6 1.7-9.3 5.5-5.4L12 9.7l2-2.1c3.8-3.9 9.2 1.8 5.5 5.4L12 20.2Z"/>',
  profile: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="9" r="3"/><path d="M6.8 18c.7-3.2 2.4-4.8 5.2-4.8s4.5 1.6 5.2 4.8"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21c.7-4.3 3-6.5 7-6.5s6.3 2.2 7 6.5"/>',
  users: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.3"/><path d="M3 20c.7-4 2.7-6 6-6s5.3 2 6 6M14 15c3.6-.8 5.8.9 6.5 4.5"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.9 7.5-4.5M8.2 13.1l7.5 4.5"/>',
  retry: '<path d="M20 7v5h-5M4 17v-5h5M18.4 12A7 7 0 0 0 6.2 7M5.6 12A7 7 0 0 0 17.8 17"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  connection: '<path d="M4 9a11 11 0 0 1 16 0M7 12a7 7 0 0 1 10 0M10 15a3 3 0 0 1 4 0"/><circle cx="12" cy="19" r="1"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  shield: '<path d="M12 3 5 6v5c0 4.8 2.7 8.2 7 10 4.3-1.8 7-5.2 7-10V6Z"/><path d="m9 12 2 2 4-5"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  empty: '<path d="M4 8.5 7 4h10l3 4.5V20H4V8.5ZM4 9h5l1.5 2h3L15 9h5"/>',
  landscape: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m6 16 4.2-4.2 2.7 2.7 2.3-2.3L19 16M15.5 9h.1"/>',
  watch: '<path d="M4 12c2.3-4 5-6 8-6s5.7 2 8 6c-2.3 4-5 6-8 6s-5.7-2-8-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  alert: '<path d="M12 3 2.8 20h18.4L12 3ZM12 9v5M12 17.5h.1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M7 3v4M17 3v4M3 10h18M7 14h2M12 14h2M17 14h.1M7 18h2M12 18h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  collapse: '<path d="m6 15 6-6 6 6"/>',
  expand: '<path d="m6 9 6 6 6-6"/>',
  fullscreen: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  statistics: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  path: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18c7 0 3-12 10-12"/>',
  score: '<path d="M2 8h4M2 12h3"/><circle cx="14" cy="12" r="7.5"/><path d="M9.3 6.2c2.3 1.6 3.3 3.5 3.1 5.8s.8 4.2 3.1 5.8M18.7 6.2c-2.3 1.6-3.3 3.5-3.1 5.8s-.8 4.2-3.1 5.8"/>'
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
