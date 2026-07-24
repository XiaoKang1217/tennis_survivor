import fs from 'node:fs';

function normalized(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function surnameKey(value = '') {
  return normalized(value).split(' ').filter(Boolean).at(-1) || '';
}

/**
 * Chinese-name enrichment is deliberately a one-way presentation transform.
 *
 * Schedule facts are never accepted here. The class may translate only player
 * labels from the checked-in catalogue (and previously saved player-id
 * translations). It cannot add/remove matches or alter tournament identity,
 * date, time, court, surface, status, score, winner, serve, ordering or odds.
 */
export class ChineseLocalizer {
  constructor({ cache, catalogFile }) {
    this.cache = cache;
    this.catalog = { players: {} };
    try {
      this.catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    } catch (_) {}

    this.byExact = new Map();
    this.bySurname = new Map();
    for (const [english, chinese] of Object.entries(this.catalog.players || {})) {
      this.byExact.set(normalized(english), chinese);
      const surname = surnameKey(english);
      if (!surname) continue;
      if (!this.bySurname.has(surname)) this.bySurname.set(surname, new Set());
      this.bySurname.get(surname).add(chinese);
    }
  }

  savedTranslations() {
    const localization = this.cache.data.localization ||= {};
    localization.playerTranslations ||= {};
    return localization.playerTranslations;
  }

  catalogPlayer(name) {
    const value = String(name || '').trim();
    if (!value) return '';
    if (/[/&]/.test(value)) {
      const separator = value.includes('/') ? '/' : '&';
      const parts = value.split(separator).map(part => part.trim());
      const translated = parts.map(part => this.catalogPlayer(part) || part);
      return translated.some((part, index) => part !== parts[index])
        ? translated.join('/')
        : '';
    }
    const exact = this.byExact.get(normalized(value));
    if (exact) return exact;
    const candidates = this.bySurname.get(surnameKey(value));
    return candidates?.size === 1 ? [...candidates][0] : '';
  }

  playerName(id, english) {
    return this.savedTranslations()[String(id || '')]
      || this.catalogPlayer(english)
      || String(english || '');
  }

  preferredLocalizedName(localized, english) {
    const localParts = String(localized || '').split('/');
    const englishParts = String(english || '').split('/');
    return localParts.map((part, index) => {
      const value = part.trim();
      if (!/[A-Za-z]/.test(value)) return value;
      return this.catalogPlayer(value)
        || this.catalogPlayer(englishParts[index]?.trim())
        || value;
    }).join('/');
  }

  remember(player, chinese) {
    if (!player?.id || !chinese) return;
    this.savedTranslations()[String(player.id)] = chinese;
  }

  enrich(matches = []) {
    for (const match of matches) {
      for (const side of ['first', 'second']) {
        const player = match[side] || {};
        const english = player.nameEn || player.name || '';
        const chinese = this.playerName(player.id, english);
        if (chinese && chinese !== english) this.remember(player, chinese);
        match[side] = { ...player, nameEn: english, name: chinese || english };
      }

      // Tournament labels are deliberately untouched. Even presentation names
      // come from API Tennis or an ATP/WTA official reference, never from the
      // player-name catalogue.
    }
    this.cache.scheduleWrite();
    return matches;
  }

  localizePlayerEntry(item) {
    const english = item.player_name || item.player || '';
    return {
      ...item,
      player_name_en: english,
      player_name: this.playerName(item.player_key, english)
    };
  }

  localizeEvent(item) {
    const first = this.playerName(item.first_player_key, item.event_first_player);
    const second = this.playerName(item.second_player_key, item.event_second_player);
    return {
      ...item,
      event_first_player_en: item.event_first_player,
      event_second_player_en: item.event_second_player,
      event_first_player: first,
      event_second_player: second,
      tournament_name_en: item.tournament_name,
      tournament_name: item.tournament_name
    };
  }
}
