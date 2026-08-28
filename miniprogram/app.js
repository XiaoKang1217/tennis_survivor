'use strict';

const { AuthSession } = require('./services/auth-session');
const { wxRequest, HttpClient } = require('./services/http-client');
const { ScoreStore } = require('./core/score-store');
const { ScoreClient } = require('./services/score-client');
const { FollowService } = require('./services/follow-service');
const { AccountService } = require('./services/account-service');
const { SocialService } = require('./services/social-service');

App({
  onLaunch() {
    const request = options => wxRequest(wx, options);
    const auth = new AuthSession(wx, request);
    const http = new HttpClient(wx, auth);
    const account = new AccountService(wx, auth, http);
    const scoreStore = new ScoreStore();
    const scoreClient = new ScoreClient(wx, auth, http, scoreStore);
    const follow = new FollowService(wx, auth, http, account);
    const social = new SocialService(wx, auth, http, account);
    this.services = Object.freeze({ auth, http, account, scoreStore, scoreClient, follow, social });
    this.accountReady = account.refresh().catch(() => account.currentProfile());
  },

  onShow() {
    this.services?.scoreClient.onShow();
  },

  onHide() {
    this.services?.scoreClient.onHide();
  },

  services: null,
  accountReady: null
});
