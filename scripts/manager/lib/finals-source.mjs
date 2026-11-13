import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchText, liveTennisDrawAjaxUrl } from './live-tennis-current-station.mjs';

export function parseFinalsSource(html, tour='WTA') {
  const result = spawnSync('python3', [fileURLToPath(new URL('./parse-finals.py', import.meta.url)),tour], {
    input: html, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`Finals source rejected: ${result.stderr || result.error}`);
  return JSON.parse(result.stdout);
}

export async function fetchFinalsProgress(event) {
  const url = liveTennisDrawAjaxUrl(event.event_id, event.season);
  const html = await fetchText(url);
  return finalsProgressFromHtml(event, html);
}

export function finalsProgressFromHtml(event, html, now = Date.now()) {
  const url = liveTennisDrawAjaxUrl(event.event_id, event.season);
  let parsed;
  try { parsed = parseFinalsSource(html,event.tour); }
  catch (error) {
    // An unpublished pre-opening draw must not erase progress or interrupt the previous station.
    if (/Expected two/.test(error.message)
        && now < Date.parse(event.main_draw_first_match_at || event.submission_closes_at)
        && !event.players.some(p => Number(p.round_robin_wins)>0 || ['SF','F','W'].includes(p.reached_round))) return [];
    throw error;
  }
  return event.players.map(player => {
    const row = parsed.find(p => p.source_id === String(player.profile_id));
    if (!row) throw new Error(`Finals contracted player missing from source: ${player.player_key}`);
    return {
      season: event.season, station_key: event.station_key, event_key: event.event_key,
      player_key: player.player_key, rr_wins: row.rr_wins, stage: row.stage,
      // A confirmed pre-opening replacement can temporarily inherit the outgoing row's strikeout.
      eliminated: player.confirmed_active_until && now < Date.parse(player.confirmed_active_until)
        && row.rr_wins + row.rr_losses === 0 && row.stage === 'RR' ? false : row.eliminated,
      source: { url, source_id: row.source_id, rr_losses: row.rr_losses }, updated_at: new Date(now).toISOString()
    };
  });
}
