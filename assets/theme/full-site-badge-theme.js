(function () {
  'use strict';

  var THEMES = [
    'sinner_fox',
    'alcaraz_duck',
    'djoko_goat',
    'rublev_cat',
    'zheng_queen',
    'wang_mermaid',
    'luwang_friend',
    'wimbledon_2026'
  ];

  var ALIASES = {
    sinner: 'sinner_fox', sinner_fox: 'sinner_fox',
    alcaraz: 'alcaraz_duck', alcaraz_duck: 'alcaraz_duck',
    djokovic: 'djoko_goat', djoko_goat: 'djoko_goat',
    lubu: 'rublev_cat', rublev: 'rublev_cat', rublev_cat: 'rublev_cat',
    zheng: 'zheng_queen', zheng_queen: 'zheng_queen',
    mermaid: 'wang_mermaid', wang_mermaid: 'wang_mermaid',
    luwang: 'luwang_friend', luwang_friend: 'luwang_friend',
    wimbledon: 'wimbledon_2026', wimbledon_2026: 'wimbledon_2026'
  };

  function normalize(themeId) {
    return ALIASES[String(themeId || '').trim()] || '';
  }

  function clearTheme(options) {
    document.body.classList.remove('luwang-site-skin');
    delete document.body.dataset.siteTheme;
    document.documentElement.style.removeProperty('color-scheme');
    if (!options || options.persist !== false) {
      try { localStorage.removeItem('luwang-site-theme'); } catch (error) {}
    }
    document.dispatchEvent(new CustomEvent('luwang:site-theme-applied', { detail: { themeId: '' } }));
    return '';
  }

  function setTheme(themeId, options) {
    var normalized = normalize(themeId);
    if (!normalized) return clearTheme(options);
    document.body.classList.add('luwang-site-skin');
    document.body.dataset.siteTheme = normalized;
    document.documentElement.style.colorScheme = 'light';
    if (!options || options.persist !== false) {
      try { localStorage.setItem('luwang-site-theme', normalized); } catch (error) {}
    }
    document.dispatchEvent(new CustomEvent('luwang:site-theme-applied', { detail: { themeId: normalized } }));
    return normalized;
  }

  function themeFromPage() {
    var params = new URLSearchParams(location.search);
    var fromQuery = normalize(params.get('site-theme'));
    if (fromQuery) return fromQuery;

    var bodyTheme = normalize(document.body.dataset.equippedBadge || document.body.dataset.badge || document.body.dataset.badgeTheme);
    if (bodyTheme) return bodyTheme;

    var equipped = document.querySelector('[data-equipped-badge],[data-current-badge],[data-badge-theme]');
    if (equipped) {
      var fromDom = normalize(equipped.dataset.equippedBadge || equipped.dataset.currentBadge || equipped.dataset.badgeTheme);
      if (fromDom) return fromDom;
    }

    return normalize(document.body.dataset.siteTheme);
  }

  window.LuwangFullSiteTheme = {
    themes: THEMES.slice(),
    normalize: normalize,
    set: setTheme,
    clear: clearTheme,
    current: function () { return document.body.dataset.siteTheme || ''; }
  };

  /* 现有徽章系统切换成功后触发这个事件即可自动完成全站换肤：
     document.dispatchEvent(new CustomEvent('luwang:badge-change', {
       detail: { badgeId: equippedBadgeId }
     }));
  */
  document.addEventListener('luwang:badge-change', function (event) {
    if (event.detail && event.detail.badgeId) setTheme(event.detail.badgeId);
    else clearTheme();
  });

  /* 兼容徽章系统稍后才把已装备徽章写入 body data-* 的情况。 */
  if (window.MutationObserver) {
    new MutationObserver(function () {
      var detected = normalize(document.body.dataset.equippedBadge || document.body.dataset.badge || document.body.dataset.badgeTheme);
      if (detected && detected !== document.body.dataset.siteTheme) setTheme(detected);
    }).observe(document.body, { attributes: true, attributeFilter: ['data-equipped-badge', 'data-badge', 'data-badge-theme'] });
  }

  var initialTheme = themeFromPage();
  if (initialTheme) setTheme(initialTheme, { persist: false });
  else clearTheme({ persist: false });
}());
