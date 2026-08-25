'use strict';

const config = require('../config');
const { normalizeAccountScope, stableAccountScope } = require('./auth-session');

const LEGACY_PROFILE_STORAGE_KEY = 'luwang_v2_user_profile_v1';
const PROFILE_STORAGE_PREFIX = 'luwang_v2_user_profile_v2:';
const LEGAL_VERSION = '2026-08-19';

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function maskedPhone(value) {
  const digits = String(value || '').replace(/\D/gu, '');
  if (digits.length < 7) return '';
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

function normalizeProfile(value) {
  const source = value && typeof value === 'object' ? value : {};
  const accountScope = normalizeAccountScope(source.accountScope)
    || stableAccountScope(
      source.accountId || source.userId || source.viewerId || source.subject || source.sub
    );
  const nickname = cleanText(source.nickname || source.nickName || source.displayName, 40);
  const avatarUrl = cleanText(source.avatarUrl, 2048);
  const phoneNumber = cleanText(source.phoneNumber, 32);
  const phoneMask = cleanText(source.phoneMask, 32) || maskedPhone(phoneNumber);
  const countryCode = cleanText(source.countryCode, 8);
  const completed = Boolean(nickname && avatarUrl);
  return {
    nickname,
    avatarUrl,
    phoneNumber,
    phoneMask,
    countryCode,
    completed,
    accountScope,
    updatedAt: cleanText(source.updatedAt, 40)
  };
}

function profileStorageKey(scope) {
  const accountScope = normalizeAccountScope(scope);
  return accountScope ? `${PROFILE_STORAGE_PREFIX}${accountScope}` : '';
}

function wxReadFileBase64(wxRuntime, filePath) {
  return new Promise((resolve, reject) => {
    const fileSystem = wxRuntime.getFileSystemManager?.();
    if (!fileSystem?.readFile) {
      reject(new Error('profile_avatar_read_unavailable'));
      return;
    }
    try {
      fileSystem.readFile({
        filePath,
        encoding: 'base64',
        success: result => {
          const contentBase64 = String(result?.data || '').replace(/\s+/gu, '');
          if (!contentBase64) {
            reject(new Error('profile_avatar_file_required'));
            return;
          }
          resolve(contentBase64);
        },
        fail: () => reject(new Error('profile_avatar_read_failed'))
      });
    } catch {
      reject(new Error('profile_avatar_read_failed'));
    }
  });
}

function wxCompressImage(wxRuntime, filePath) {
  return new Promise(resolve => {
    if (!wxRuntime.compressImage) {
      resolve(filePath);
      return;
    }
    try {
      wxRuntime.compressImage({
        src: filePath,
        quality: 80,
        success: result => {
          const nextPath = cleanText(result?.tempFilePath || filePath, 2048);
          resolve(nextPath || filePath);
        },
        fail: () => resolve(filePath)
      });
    } catch {
      resolve(filePath);
    }
  });
}

function savedAvatarUrl(value) {
  const source = cleanText(value, 2048);
  return source.startsWith(`${config.bffBaseUrl}/api/v1/me/avatar/files/`);
}

function avatarFilename(filePath) {
  const fallback = 'avatar.jpg';
  const filename = cleanText(String(filePath || '').split(/[\\/]/u).pop(), 120);
  return /\.[A-Za-z0-9]{2,5}$/u.test(filename) ? filename : fallback;
}

function normalizeLegalConsent(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    accepted: source.accepted === true,
    acceptedAt: cleanText(source.acceptedAt, 40),
    termsVersion: cleanText(source.termsVersion, 40) || LEGAL_VERSION,
    privacyVersion: cleanText(source.privacyVersion, 40) || LEGAL_VERSION,
    privacyContractName: cleanText(source.privacyContractName, 80)
  };
}

class AccountService {
  constructor(wxRuntime, auth, http) {
    this.wx = wxRuntime;
    this.auth = auth;
    this.http = http;
    this.listeners = new Set();
    this.activeScope = this.currentScope();
    this.profile = this.readStored(this.activeScope);
  }

  currentScope() {
    return normalizeAccountScope(this.auth?.currentAccountScope?.());
  }

  readStored(scope = this.currentScope()) {
    const key = profileStorageKey(scope);
    if (!key) return normalizeProfile(null);
    try {
      const profile = normalizeProfile(this.wx.getStorageSync(key));
      return profile.accountScope === scope ? profile : normalizeProfile(null);
    } catch {
      return normalizeProfile(null);
    }
  }

  loadCurrentScope() {
    const scope = this.currentScope();
    if (scope === this.activeScope) return this.profile;
    this.activeScope = scope;
    this.profile = this.readStored(scope);
    this.emit();
    return this.profile;
  }

  writeStored(profile, requestedScope = '') {
    const value = normalizeProfile(profile);
    const scope = normalizeAccountScope(requestedScope)
      || value.accountScope
      || this.currentScope();
    this.activeScope = scope;
    this.profile = normalizeProfile({ ...value, accountScope: scope });
    const key = profileStorageKey(scope);
    if (key) {
      try { this.wx.setStorageSync(key, this.profile); } catch { /* bounded */ }
    }
    this.emit();
    return this.profile;
  }

  clearStored(scope = this.activeScope || this.currentScope()) {
    const key = profileStorageKey(scope);
    this.profile = normalizeProfile(null);
    this.activeScope = '';
    try {
      if (key) this.wx.removeStorageSync?.(key);
      this.wx.removeStorageSync?.(LEGACY_PROFILE_STORAGE_KEY);
    } catch { /* bounded */ }
    this.emit();
    return this.profile;
  }

  logout() {
    const scope = this.activeScope || this.currentScope();
    this.clearStored(scope);
    this.auth.invalidate();
    return this.profile;
  }

  subscribe(listener) {
    this.loadCurrentScope();
    this.listeners.add(listener);
    listener(this.profile);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of [...this.listeners]) listener(this.profile);
  }

  currentProfile() {
    return this.loadCurrentScope();
  }

  isComplete(profile) {
    const value = normalizeProfile(profile === undefined ? this.loadCurrentScope() : profile);
    return Boolean(value.nickname && value.avatarUrl);
  }

  async refresh() {
    await this.auth.ensure();
    this.loadCurrentScope();
    const response = await this.http.request('/api/v1/me/profile', {
      method: 'GET',
      authRequired: true
    });
    const responseProfile = response?.profile || {};
    return this.writeStored({
      ...this.profile,
      ...responseProfile
    });
  }

  async uploadAvatar(filePath) {
    const avatarPath = cleanText(filePath, 2048);
    if (!avatarPath) throw new Error('profile_avatar_required');
    const preparedPath = await wxCompressImage(this.wx, avatarPath);
    const contentBase64 = await wxReadFileBase64(this.wx, preparedPath);
    const response = await this.http.request('/api/v1/me/avatar', {
      method: 'POST',
      data: {
        contentBase64,
        filename: avatarFilename(preparedPath)
      },
      header: { 'content-type': 'application/json' },
      timeout: 30_000,
      authRequired: true
    });
    const avatarUrl = cleanText(response?.avatarUrl, 2048);
    if (!avatarUrl) throw new Error('profile_avatar_upload_failed');
    return avatarUrl;
  }

  async completeProfile(input) {
    const nickname = cleanText(input?.nickname, 40);
    let avatarUrl = cleanText(input?.avatarUrl, 2048);
    const legalConsent = normalizeLegalConsent(input?.legalConsent);
    if (!nickname) throw new Error('profile_nickname_required');
    if (!avatarUrl) throw new Error('profile_avatar_required');
    if (!legalConsent.accepted) throw new Error('profile_legal_consent_required');
    await this.auth.ensure();
    this.loadCurrentScope();
    if (!savedAvatarUrl(avatarUrl)) {
      avatarUrl = await this.uploadAvatar(avatarUrl);
    }
    const response = await this.http.request('/api/v1/me/profile', {
      method: 'POST',
      data: { nickname, avatarUrl, legalConsent },
      header: { 'content-type': 'application/json' },
      authRequired: true
    });
    return this.writeStored({
      avatarUrl,
      ...(response?.profile || {}),
      nickname
    });
  }
}

module.exports = Object.freeze({
  AccountService,
  LEGACY_PROFILE_STORAGE_KEY,
  PROFILE_STORAGE_PREFIX,
  LEGAL_VERSION,
  profileStorageKey,
  normalizeProfile,
  normalizeLegalConsent,
  maskedPhone
});
