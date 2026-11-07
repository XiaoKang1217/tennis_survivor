import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchText, liveTennisDrawAjaxUrl } from './live-tennis-current-station.mjs';

export function parseFinalsSource(html) {
  const result = spawnSync('python3', [fileURLToPath(new URL('./parse-finals.py', import.meta.url))], {
    input: html, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`Finals source rejected: ${result.stderr || result.error}`);
  return JSON.parse(result.stdout);
}

export async function fetchFinalsProgress(event) {
  const url = liveTennisDrawAjaxUrl(event.event_id, event.season);
  const parsed = parseFinalsSource(await fetchText(url));
  return event.players.map(player => {
    const row = parsed.find(p => p.source_id === String(player.profile_id));
    if (!row) throw new Error(`Finals contracted player missing from source: ${player.player_key}`);
    return {
      season: event.season, station_key: event.station_key, event_key: event.event_key,
      player_key: player.player_key, rr_wins: row.rr_wins, stage: row.stage, eliminated: row.eliminated,
      source: { url, source_id: row.source_id, rr_losses: row.rr_losses }, updated_at: new Date().toISOString()
    };
  });
}
