import {
  canonicalPlayerKey,
  normalizeSurface,
  officialProfileUrl,
  priceTier,
  readJson,
  scoreTotal
} from './manager-utils.mjs';

export async function loadActiveStation(activeFile = 'data/manager/active_events.json', root = process.cwd()) {
  const active = await readJson(activeFile, root);
  const events = [];
  for (const item of active.events || []) {
    if (item.active === false) continue;
    const event = await readJson(`data/manager/${item.data_file}`, root);
    events.push({ item, event });
  }
  return { active, events };
}

export function buildStationPayload({ active, events, photoMap = {}, priceVersion = 1, priceStatus = 'draft' }) {
  const eventRows = [];
  const playerRowsByKey = new Map();
  const eventPlayerRows = [];
  const drawRows = [];
  const priceRows = [];

  for (const { item, event } of events) {
    const tour = event.tour || item.tour;
    const sourceUrls = event.source_urls || [];
    eventRows.push({
      event_key: event.event_key,
      season: event.season || active.season,
      station_key: active.station_key,
      tour,
      event_id: event.event_id || null,
      name: event.name,
      name_zh: event.name_zh || event.short_name || event.name,
      level: event.level,
      surface: normalizeSurface(event.surface),
      draw_size: event.draw_size,
      start_date: event.start_date || null,
      end_date: event.end_date || null,
      draw_status: event.draw_status || 'pending',
      market_status: event.market_status || 'draw_pending',
      submission_opens_at: event.submission_opens_at || null,
      schedule_status: normalizeScheduleStatus(event.schedule_status),
      main_draw_first_match_at: event.main_draw_first_match_at || null,
      submission_cutoff_at: event.submission_cutoff_at || event.submission_closes_at || null,
      submission_closes_at: event.submission_closes_at || event.submission_cutoff_at || null,
      round1_completed_at: event.round1_completed_at || null,
      round2_first_match_at: event.round2_first_match_at || null,
      transfer_window_opens_at: event.transfer_window_opens_at || event.round1_completed_at || null,
      transfer_window_closes_at: event.transfer_window_closes_at || event.round2_first_match_at || null,
      transfer_window_note: event.transfer_window_note || null,
      transfer_window_days: event.transfer_window_days || 2,
      transfer_fee_rate: event.transfer_fee_rate == null ? 0.1 : event.transfer_fee_rate,
      source_urls: sourceUrls,
      metadata: {
        station_key: active.station_key,
        station_name: active.station_name,
        short_name: event.short_name,
        display_name: event.display_name,
        city: event.city,
        country: event.country,
        market_message: event.market_message || '',
        source_file: item.data_file
      }
    });

    for (const player of event.players || []) {
      const playerKey = canonicalPlayerKey(tour, player);
      const photo = photoMap[playerKey] || photoMap[player.player_key] || {};
      const scores = player.scores || {};
      const photoStatus = normalizePhotoStatus(photo.status, Boolean(photo.photo_url));
      const profileUrl = officialProfileUrl(tour, player);
      const preR1Substitution = player.pre_r1_substitution || null;
      const playerPrice = Number.isFinite(Number(player.price)) ? Number(player.price) : 0;

      playerRowsByKey.set(`${tour}:${playerKey}`, {
        tour,
        player_key: playerKey,
        name_en: player.name_en || player.name_zh,
        name_zh: player.name_zh || null,
        official_profile_id: player.profile_id || null,
        official_profile_url: profileUrl,
        tennis_abstract_slug: player.name_en ? player.name_en.replace(/\s+/g, '') : null,
        country_code: player.country_code || null,
        photo_url: photo.photo_url || null,
        photo_source: photo.source || null,
        photo_status: photoStatus,
        photo_storage_path: photo.storage_path || null,
        photo_updated_at: photo.updated_at || null,
        source: {
          source_urls: sourceUrls,
          source_file_player_key: player.player_key || null,
          is_qualifier_placeholder: !!player.is_qualifier_placeholder,
          pre_r1_substitution: preR1Substitution
        }
      });

      if (player.draw_position) {
        drawRows.push({
          event_key: event.event_key,
          draw_version: 1,
          draw_position: player.draw_position,
          tour,
          player_key: player.is_qualifier_placeholder ? null : playerKey,
          placeholder_key: player.is_qualifier_placeholder ? playerKey : null,
          name_en: player.name_en || null,
          name_zh: player.name_zh || null,
          seed: player.seed || null,
          entry_status: player.is_qualifier_placeholder ? 'qualifier_placeholder' : (player.seed ? 'seed' : 'direct'),
          first_round_opponent_key: null,
          path: {
            first_round: player.first_round || null,
            path_note: player.path_note || ''
          },
          source_url: sourceUrls[1] || sourceUrls[0] || null,
          raw: player
        });
      }

      const totalScore = scoreTotal(scores);
      eventPlayerRows.push({
        event_key: event.event_key,
        player_key: playerKey,
        tour,
        name_zh: player.name_zh || player.name_en,
        name_en: player.name_en || null,
        profile_id: player.profile_id || null,
        seed: player.seed || null,
        ranking: player.rank || null,
        draw_position: player.draw_position || null,
        first_round: player.first_round || null,
        is_qualifier_placeholder: !!player.is_qualifier_placeholder,
        base_score: scores.base ?? 50,
        surface_score: scores.surface ?? 50,
        draw_score: scores.draw ?? 50,
        form_score: scores.form ?? 50,
        manual_score: scores.manual ?? 0,
        price: playerPrice,
        photo_url: photo.photo_url || null,
        photo_status: photoStatus,
        photo_storage_path: photo.storage_path || null,
        photo_updated_at: photo.updated_at || null,
        source: {
          profile_id: player.profile_id || null,
          profile_url: profileUrl,
          path_note: player.path_note || '',
          source_urls: sourceUrls,
          source_file_player_key: player.player_key || null,
          pricing_detail: player.pricing_detail || null,
          pre_r1_substitution: preR1Substitution,
          contract_price_policy: preR1Substitution?.contract_price_policy || null,
          original_contract_price: preR1Substitution?.original_contract_price ?? null
        }
      });

      priceRows.push({
        event_key: event.event_key,
        player_key: playerKey,
        tour,
        name_en: player.name_en || null,
        name_zh: player.name_zh || null,
        official_rank: player.rank || null,
        official_points: player.points || null,
        overall_elo: player.overall_elo || null,
        surface_elo: player.surface_elo || null,
        base_score: scores.base ?? 50,
        surface_score: scores.surface ?? 50,
        draw_score: scores.draw ?? 50,
        form_score: scores.form ?? 50,
        manual_score: scores.manual ?? 0,
        total_score: totalScore,
        expected_points: player.expected_points || null,
        expected_round: player.expected_round || null,
        breakeven_round: player.breakeven_round || null,
        price: playerPrice,
        tier: priceTier(playerPrice, event),
        source_facts: {
          rank: player.rank || null,
          seed: player.seed || null,
          overall_elo: player.overall_elo || null,
          surface_elo: player.surface_elo || null,
          peak_elo: player.peak_elo || null,
          peak_month: player.peak_month || null,
          draw_position: player.draw_position || null,
          path_note: player.path_note || '',
          pricing_formula: event.pricing_formula || null,
          pricing_detail: player.pricing_detail || null,
          pre_r1_substitution: preR1Substitution,
          contract_price_policy: preR1Substitution?.contract_price_policy || null,
          original_contract_price: preR1Substitution?.original_contract_price ?? null
        }
      });
    }
  }

  const priceVersionRow = {
    station_key: active.station_key,
    season: active.season,
    version: Number(priceVersion),
    status: priceStatus,
    formula_version: 'v1',
    generated_from: {
      active_file: 'data/manager/active_events.json',
      source_event_count: eventRows.length,
      source_player_count: eventPlayerRows.length,
      note: 'Generated from locally reviewed manager event JSON.'
    }
  };

  const configuredGrant = Number(active.rules?.station_grant);
  const stationConfigRow = {
    station_key: active.station_key,
    season: active.season,
    station_grant: Number.isFinite(configuredGrant) ? Math.max(0, Math.round(configuredGrant)) : null,
    combo_version: active.rules?.combo_version || 'classic',
    metadata: {
      combo: active.rules?.combo || {},
      source: 'data/manager/active_events.json'
    }
  };

  return {
    active,
    stationConfigRow,
    eventRows,
    playerRows: Array.from(playerRowsByKey.values()),
    drawRows,
    eventPlayerRows,
    priceVersionRow,
    priceRows
  };
}

function normalizeScheduleStatus(status) {
  if (status === 'published') return 'partial';
  return ['pending', 'partial', 'confirmed', 'final'].includes(status) ? status : 'pending';
}

function normalizePhotoStatus(status, hasUrl) {
  const value = String(status || '').toLowerCase();
  if (value === 'verified' || value === 'ready') return 'ready';
  if (value === 'manual') return 'manual';
  if (value === 'error') return 'error';
  if (value === 'fallback' || value === 'missing') return 'missing';
  return hasUrl ? 'ready' : 'pending';
}
