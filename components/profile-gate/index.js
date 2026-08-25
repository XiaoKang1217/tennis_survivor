'use strict';

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function profileSaveError(error) {
  const message = String(error?.message || error?.code || '');
  if (/profile_content_rejected/u.test(message)) {
    return '昵称未通过内容安全审核，请调整后再保存';
  }
  if (/profile_avatar_rejected/u.test(message)) {
    return '头像未通过内容安全审核，请重新选择头像';
  }
  if (/profile_avatar_upload_required|profile_avatar_upload_failed|profile_avatar_file_invalid/u
    .test(message)) {
    return '头像保存失败，请重新选择头像';
  }
  if (/profile_safety_provider_unavailable/iu.test(message)) {
    return '内容安全审核暂时不可用，请稍后再试';
  }
  if (/network_request|profile_avatar_read/u.test(message)) {
    return '资料上传失败，请检查网络后重试';
  }
  return '资料保存失败，请稍后重试';
}

Component({
  properties: {
    theme: { type: String, value: 'clean-blue' }
  },
  data: {
    open: false,
    avatarUrl: '',
    nickname: '',
    agreementAccepted: false,
    privacyContractName: '《炉网隐私政策》',
    privacyPending: false,
    nicknameFocus: false,
    submitting: false,
    errorMessage: '',
    sourceEntry: '',
    dialogTitle: '登录',
    dialogSubtitle: '选择头像和昵称后即可同步关注',
    submitLabel: '保存资料并登录'
  },

  lifetimes: {
    attached() {
      this.pendingResolve = null;
      this.nicknameFocusTimer = null;
    },
    detached() {
      if (this.nicknameFocusTimer) clearTimeout(this.nicknameFocusTimer);
    }
  },

  methods: {
    collect(options = {}) {
      if (this.pendingResolve) this.pendingResolve(false);
      const account = getApp().services.account;
      const profile = account?.currentProfile?.() || {};
      const completed = Boolean(profile.completed || (profile.nickname && profile.avatarUrl));
      const editing = options.mode === 'edit' || completed;
      this.setData({
        open: true,
        avatarUrl: cleanText(profile.avatarUrl, 2048),
        nickname: cleanText(profile.nickname, 40),
        agreementAccepted: false,
        privacyPending: false,
        nicknameFocus: false,
        submitting: false,
        errorMessage: '',
        sourceEntry: cleanText(options.sourceEntry, 80),
        dialogTitle: editing ? '编辑资料' : '登录',
        dialogSubtitle: editing
          ? '修改头像和昵称，保存前会进行内容安全审核'
          : '选择头像和昵称后即可同步关注',
        submitLabel: editing ? '保存资料' : '保存资料并登录'
      });
      this.refreshPrivacySetting();
      return new Promise(resolve => {
        this.pendingResolve = resolve;
      });
    },

    close() {
      if (this.nicknameFocusTimer) clearTimeout(this.nicknameFocusTimer);
      this.setData({
        open: false,
        submitting: false,
        nicknameFocus: false,
        errorMessage: ''
      });
      if (this.pendingResolve) this.pendingResolve(false);
      this.pendingResolve = null;
    },

    noop() {},

    refreshPrivacySetting() {
      if (!wx.getPrivacySetting) return;
      wx.getPrivacySetting({
        success: result => {
          const name = cleanText(result?.privacyContractName, 80);
          const nextData = {
            privacyPending: result?.needAuthorization === true
          };
          if (name) nextData.privacyContractName = name;
          if (result?.needAuthorization === false) nextData.agreementAccepted = true;
          this.setData(nextData);
        },
        fail: () => undefined
      });
    },

    openTerms() {
      wx.navigateTo({ url: '/pages/legal/index?type=terms' });
    },

    openPrivacy() {
      if (wx.openPrivacyContract) {
        wx.openPrivacyContract({
          fail: () => wx.navigateTo({ url: '/pages/legal/index?type=privacy' })
        });
        return;
      }
      wx.navigateTo({ url: '/pages/legal/index?type=privacy' });
    },

    onAgreePrivacyAuthorization() {
      this.setData({
        agreementAccepted: true,
        privacyPending: false,
        nicknameFocus: true,
        errorMessage: ''
      });
      if (this.nicknameFocusTimer) clearTimeout(this.nicknameFocusTimer);
      this.nicknameFocusTimer = setTimeout(() => {
        this.setData({ nicknameFocus: false });
      }, 800);
    },

    onChooseAvatar(event) {
      const avatarUrl = cleanText(event?.detail?.avatarUrl, 2048);
      if (!avatarUrl) return;
      this.setData({ avatarUrl, errorMessage: '' });
    },

    onNicknameInput(event) {
      this.setData({
        nickname: cleanText(event?.detail?.value, 40),
        errorMessage: ''
      });
    },

    onNicknameBlur() {
      this.setData({ nicknameFocus: false });
    },

    async onSubmitProfile() {
      this.setData({ agreementAccepted: true, privacyPending: false });
      const nickname = cleanText(this.data.nickname, 40);
      const avatarUrl = cleanText(this.data.avatarUrl, 2048);
      if (!avatarUrl) {
        this.setData({
          errorMessage: '请先选择微信头像'
        });
        return;
      }
      if (!nickname) {
        this.setData({
          nicknameFocus: true,
          errorMessage: '请先点击昵称输入框选择微信昵称或填写昵称'
        });
        return;
      }
      this.setData({ submitting: true, errorMessage: '' });
      try {
        await getApp().services.account.completeProfile({
          nickname,
          avatarUrl,
          legalConsent: {
            accepted: true,
            acceptedAt: new Date().toISOString(),
            termsVersion: '2026-08-19',
            privacyVersion: '2026-08-19',
            privacyContractName: this.data.privacyContractName
          },
          sourceEntry: this.data.sourceEntry
        });
        this.setData({ open: false, submitting: false });
        if (this.pendingResolve) this.pendingResolve(true);
        this.pendingResolve = null;
      } catch (err) {
        this.setData({
          submitting: false,
          errorMessage: profileSaveError(err)
        });
      }
    }
  }
});
