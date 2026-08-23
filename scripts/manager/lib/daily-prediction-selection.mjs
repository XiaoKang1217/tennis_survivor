export const MEDIAN_SELECTION_START_DATE = '2026-08-17';
export const MEDIAN_SELECTION_METHOD = 'median_world_rank_gap_official_event_day';

function dateKeyInTimezone(value, timezone = 'UTC') {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
  }
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function matchEventDate(match, timezone = 'UTC') {
  const rawDate = String(match?.raw?.date || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
  return dateKeyInTimezone(match?.scheduled_at, timezone);
}

function numberOrMax(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

export function compareRankingGapCandidates(a, b) {
  return Number(a.ranking_gap) - Number(b.ranking_gap)
    || new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()
    || numberOrMax(a.match_order) - numberOrMax(b.match_order)
    || String(a.match_key).localeCompare(String(b.match_key));
}

// For an even number of matches, use the upper median (the larger of the two
// central ranking gaps). It is slightly easier than the lower median while
// still avoiding the most one-sided matches.
export function selectMedianRankingGapMatch(candidates = []) {
  if (!candidates.length) return null;
  const ranked = [...candidates].sort(compareRankingGapCandidates);
  return ranked[Math.floor(ranked.length / 2)];
}

function positiveRanking(value) {
  const ranking = Number(value);
  return Number.isInteger(ranking) && ranking > 0 ? ranking : null;
}

export async function refreshDailyPredictionGamesByMedian({
  client,
  stationKey,
  sourceStationKey = stationKey,
  season = 2026,
  contestDate,
  now = new Date()
}) {
  if (!stationKey || !contestDate) throw new Error('stationKey and contestDate are required');
  const nowDate = new Date(now);
  if (!Number.isFinite(nowDate.getTime())) throw new Error(`Invalid refresh time: ${now}`);

  let created = 0;
  let existing = 0;
  const missingTours = [];

  for (const tour of ['ATP', 'WTA']) {
    const games = await client.select('tour_manager_daily_prediction_games', {
      station_key: `eq.${stationKey}`,
      season: `eq.${season}`,
      contest_date: `eq.${contestDate}`,
      tour: `eq.${tour}`,
      select: 'id'
    });
    if (games.length) {
      existing += 1;
      continue;
    }

    const events = await client.select('tour_manager_events', {
      station_key: `eq.${sourceStationKey || stationKey}`,
      season: `eq.${season}`,
      tour: `eq.${tour}`,
      select: 'event_key,metadata'
    });
    const eventByKey = new Map(events.map((event) => [event.event_key, event]));
    const matchGroups = await Promise.all(events.map((event) => client.select('tour_manager_matches', {
      event_key: `eq.${event.event_key}`,
      status: 'eq.scheduled',
      scheduled_at: `gt.${nowDate.toISOString()}`,
      select: 'event_key,match_key,match_order,scheduled_at,player1_key,player1_name,player2_key,player2_name,raw'
    })));
    const upcoming = matchGroups.flat().sort((a, b) => (
      new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
      || String(a.match_key).localeCompare(String(b.match_key))
    ));
    if (!upcoming.length) {
      missingTours.push(tour);
      continue;
    }

    const firstMatch = upcoming[0];
    const firstEvent = eventByKey.get(firstMatch.event_key);
    const eventDate = matchEventDate(firstMatch, firstEvent?.metadata?.timezone || 'UTC');
    const sameEventDay = upcoming.filter((match) => {
      const event = eventByKey.get(match.event_key);
      return matchEventDate(match, event?.metadata?.timezone || 'UTC') === eventDate;
    });
    const relevantEventKeys = [...new Set(sameEventDay.map((match) => match.event_key))];
    const [playerGroups, usedGroups] = await Promise.all([
      Promise.all(relevantEventKeys.map((eventKey) => client.select('tour_manager_event_players', {
        event_key: `eq.${eventKey}`,
        select: 'event_key,player_key,name_zh,name_en,ranking'
      }))),
      Promise.all(relevantEventKeys.map((eventKey) => client.select('tour_manager_daily_prediction_games', {
        event_key: `eq.${eventKey}`,
        select: 'event_key,match_key'
      })))
    ]);
    const playerByKey = new Map(playerGroups.flat().map((player) => [
      `${player.event_key}|${player.player_key}`,
      player
    ]));
    const usedMatches = new Set(usedGroups.flat().map((game) => `${game.event_key}|${game.match_key}`));

    const candidates = sameEventDay.flatMap((match) => {
      if (!match.player1_key || !match.player2_key) return [];
      if (usedMatches.has(`${match.event_key}|${match.match_key}`)) return [];
      const player1 = playerByKey.get(`${match.event_key}|${match.player1_key}`);
      const player2 = playerByKey.get(`${match.event_key}|${match.player2_key}`);
      const player1Ranking = positiveRanking(player1?.ranking);
      const player2Ranking = positiveRanking(player2?.ranking);
      if (!player1Ranking || !player2Ranking) return [];
      return [{
        ...match,
        event_date: eventDate,
        player1,
        player2,
        player1_ranking: player1Ranking,
        player2_ranking: player2Ranking,
        ranking_gap: Math.abs(player1Ranking - player2Ranking)
      }];
    });
    const selected = selectMedianRankingGapMatch(candidates);
    if (!selected) {
      missingTours.push(tour);
      continue;
    }

    const inserted = await client.insert('tour_manager_daily_prediction_games', [{
      season,
      station_key: stationKey,
      contest_date: contestDate,
      event_date: selected.event_date,
      tour,
      event_key: selected.event_key,
      match_key: selected.match_key,
      scheduled_at: selected.scheduled_at,
      closes_at: selected.scheduled_at,
      player1_key: selected.player1_key,
      player1_name: selected.player1_name || selected.player1.name_zh || selected.player1.name_en || selected.player1_key,
      player1_ranking: selected.player1_ranking,
      player2_key: selected.player2_key,
      player2_name: selected.player2_name || selected.player2.name_zh || selected.player2.name_en || selected.player2_key,
      player2_ranking: selected.player2_ranking,
      ranking_gap: selected.ranking_gap,
      reward_amount: 10,
      selection_method: MEDIAN_SELECTION_METHOD,
      status: 'open'
    }]);
    if (inserted.length !== 1 || inserted[0].match_key !== selected.match_key) {
      throw new Error(`Median daily prediction insert failed for ${tour}`);
    }
    created += 1;
  }

  return {
    station_key: stationKey,
    source_station_key: sourceStationKey || stationKey,
    season,
    contest_date: contestDate,
    selection_method: MEDIAN_SELECTION_METHOD,
    replaced_total: 0,
    replaced_unpicked: 0,
    replaced_legacy: 0,
    created,
    existing,
    missing_tours: missingTours
  };
}
