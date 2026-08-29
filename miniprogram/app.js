'use strict';

const { AuthSession } = require('./services/auth-session');
const { wxRequest, HttpClient } = require('./services/http-client');
const { ScoreStore } = require('./core/score-store');
const { ScoreClient } = require('./services/score-client');
const { FollowService } = require('./services/follow-service');
const { FollowStore } = require('./services/follow-store');
const { AccountService } = require('./services/account-service');
const { SocialService } = require('./services/social-service');
const { EntryService } = require('./services/entry-service');
const { readTheme, syncNativeTheme } = require('./core/theme');

App({
  onLaunch() {
    // Paint the native host window before the first page (including a
    // subpackage page) is created. Page-level page-meta then inherits the
    // exact same persisted canvas token on its first render.
    syncNativeTheme(readTheme());
    const request = options => wxRequest(wx, options);
    const auth = new AuthSession(wx, request);
    const http = new HttpClient(wx, auth);
    const account = new AccountService(wx, auth, http);
    const scoreStore = new ScoreStore();
    const scoreClient = new ScoreClient(wx, auth, http, scoreStore);
    const followStore = new FollowStore(wx, auth);
    const follow = new FollowService(wx, auth, http, account, followStore);
    const social = new SocialService(wx, auth, http, account);
    const entries = new EntryService(wx, http);
    this.services = Object.freeze({ auth, http, account, scoreStore, scoreClient, followStore, follow, social, entries });
    this.accountReady = account.refresh().catch(() => account.currentProfile());
  },

  onShow() {
    // WeChat may recreate its host surface while the mini program is in the
    // background, so restore the persisted native canvas before pages resume.
    syncNativeTheme(readTheme());
    this.services?.scoreClient.onShow();
  },

  onHide() {
    this.services?.scoreClient.onHide();
  },

  services: null,
  accountReady: null
});
