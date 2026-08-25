'use strict';

Component({
  properties: {
    match: { type: Object, value: null },
    theme: { type: String, value: 'clean-blue' }
  },
  methods: {
    open() { this.triggerEvent('open', { matchId: this.data.match.id }); },
    toggleFollow() {
      this.triggerEvent('follow', {
        matchId: this.data.match.id,
        followed: !this.data.match.followed
      });
    }
  }
});
