import { canonicalPlayerKey } from './manager-utils.mjs';

export function collectQualifierPlacements(entries, { includeDerived = true } = {}) {
  const placements = [];
  const seen = new Set();

  for (const { item, event } of entries || []) {
    const tour = event.tour || item?.tour;
    for (const player of event.players || []) {
      if (player.is_qualifier_placeholder) continue;
      const replacement = player.qualifier_replacement;
      if (!replacement && player.pre_r1_substitution) continue;
      const replacementPlayerKey = replacement?.replacement_player_key || canonicalPlayerKey(tour, player);
      const placeholderPlayerKey = replacement?.placeholder_player_key
        || (includeDerived && player.draw_position ? `${tour}|qualifier-${player.draw_position}` : null);
      if (!placeholderPlayerKey || placeholderPlayerKey === replacementPlayerKey) continue;

      const dedupeKey = `${event.event_key}|${placeholderPlayerKey}|${replacementPlayerKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      placements.push({
        event_key: event.event_key,
        station_key: event.station_key || null,
        tour,
        draw_position: Number(replacement?.draw_position || player.draw_position || 0) || null,
        placeholder_player_key: placeholderPlayerKey,
        placeholder_name_en: replacement?.placeholder_name_en || null,
        placeholder_name_zh: replacement?.placeholder_name_zh || null,
        placeholder_profile_id: replacement?.placeholder_profile_id || null,
        replacement_player_key: replacementPlayerKey,
        replacement_name_en: replacement?.replacement_name_en || player.name_en || null,
        replacement_name_zh: replacement?.replacement_name_zh || player.name_zh || null,
        replacement_profile_id: replacement?.replacement_profile_id || player.profile_id || null,
        source_url: replacement?.source_url || player.source || null,
        derived_from_draw_position: !replacement?.placeholder_player_key
      });
    }
  }

  return placements;
}

export function collectPreR1Substitutions(entries) {
  const substitutions = [];
  const seen = new Set();

  for (const { item, event } of entries || []) {
    const tour = event.tour || item?.tour;
    for (const player of event.players || []) {
      const replacement = player.pre_r1_substitution;
      if (!replacement) continue;
      const outPlayerKey = replacement.out_player_key;
      const inPlayerKey = replacement.replacement_player_key || canonicalPlayerKey(tour, player);
      if (!outPlayerKey || !inPlayerKey || outPlayerKey === inPlayerKey) continue;

      const dedupeKey = `${event.event_key}|${outPlayerKey}|${inPlayerKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      substitutions.push({
        event_key: event.event_key,
        station_key: event.station_key || null,
        tour,
        draw_position: Number(replacement.draw_position || player.draw_position || 0) || null,
        out_player_key: outPlayerKey,
        out_name_en: replacement.out_name_en || null,
        out_name_zh: replacement.out_name_zh || null,
        out_profile_id: replacement.out_profile_id || null,
        replacement_player_key: inPlayerKey,
        replacement_name_en: replacement.replacement_name_en || player.name_en || null,
        replacement_name_zh: replacement.replacement_name_zh || player.name_zh || null,
        replacement_profile_id: replacement.replacement_profile_id || player.profile_id || null,
        reason: replacement.reason || 'pre_r1_withdrawal',
        source_url: replacement.source_url || player.source || null,
        contract_price_policy: 'keep_original_contract_price',
        main_draw_first_match_at: event.main_draw_first_match_at || null
      });
    }
  }

  return substitutions;
}
