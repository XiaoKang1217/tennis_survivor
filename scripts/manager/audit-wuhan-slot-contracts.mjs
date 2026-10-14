import { SupabaseRestClient } from './lib/supabase-rest.mjs';
import { writeJson } from './lib/manager-utils.mjs';
const report = {};
const record = (key, value) => { report[key] = value; };
const client = new SupabaseRestClient();
const event = 'wta-2026-w42-wuhan';
const rows = await client.select('tour_manager_lineup_players', { event_key: `eq.${event}`, select: '*', limit: 1000 });
if (rows.length === 1000) throw new Error('Audit truncated');
const relevant = rows.filter(r => /mirra-andreeva|iva-jovic|anna-bondar|Mirra ANDREEVA|Iva JOVIC/.test(JSON.stringify(r)));
record('CONTRACTS', relevant);
if (relevant.length) {
  const ids = [...new Set(relevant.map(r => r.lineup_id))];
  record('LINEUPS', await client.select('tour_manager_lineups', { id: `in.(${ids.join(',')})`, select: 'id,status,predictions,village_hope_player_key,village_hope_player_name,submitted_at' }));
  record('SETTLEMENTS', await client.select('tour_manager_settlements', { contract_id: `in.(${relevant.map(r => r.id).join(',')})`, select: '*', limit: 1000 }));
  record('LEDGER', await client.select('tour_manager_wallet_ledger', { lineup_id: `in.(${ids.join(',')})`, station_key: 'eq.2026-w42-wuhan', select: 'id,lineup_id,type,amount,metadata,created_at', limit: 1000 }));
}
record('MATCHES', await client.select('tour_manager_matches', { event_key: `eq.${event}`, select: '*', limit: 100 }));
await writeJson('outputs/wuhan-slot-audit/report.json', report);
console.log('Audit complete; relevant contracts:', relevant.length);
