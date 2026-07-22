import fs from 'node:fs';
import path from 'node:path';

const serviceRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(serviceRoot, '../..');
const eventsDir = path.join(repoRoot, 'data/manager/events');
const calendarFile = path.join(repoRoot, 'data/official_calendar.json');
const playerMap = new Map();
const tournamentMap = new Map();

const rankedPlayerFallbacks = {
  'Carlos Alcaraz': '阿尔卡拉斯',
  'Victoria Mboko': '姆博科',
  'Lorenzo Musetti': '穆塞蒂'
};
const tournamentFallbacks = {
  'French Open': '法网',
  Wimbledon: '温网',
  'Finals - Turin': '都灵年终总决赛',
  'Six Kings Slam': '六王大满贯',
  'Others matches': '其他比赛'
};

for (const file of fs.readdirSync(eventsDir).filter(name => name.endsWith('.json'))) {
  const event = JSON.parse(fs.readFileSync(path.join(eventsDir, file), 'utf8'));
  if (event.name && event.name_zh) tournamentMap.set(event.name, event.name_zh);
  if (event.display_name && event.name_zh) tournamentMap.set(event.display_name, event.name_zh);
  for (const player of event.players || []) {
    if (player.name_en && player.name_zh) playerMap.set(player.name_en, player.name_zh);
  }
}

for (const [english, chinese] of Object.entries(rankedPlayerFallbacks)) {
  if (!playerMap.has(english)) playerMap.set(english, chinese);
}

try {
  const calendar = JSON.parse(fs.readFileSync(calendarFile, 'utf8'));
  for (const event of calendar.events || []) {
    if (!/[\u3400-\u9fff]/.test(event.event_key || '')) continue;
    for (const alias of [...(event.aliases || []), event.city, event.name]) {
      if (alias && !/[\u3400-\u9fff]/.test(alias)) tournamentMap.set(alias, event.event_key);
    }
  }
} catch (_) {}

for (const [english, chinese] of Object.entries(tournamentFallbacks)) {
  if (!tournamentMap.has(english)) tournamentMap.set(english, chinese);
}

const output = {
  generatedAt: new Date().toISOString(),
  players: Object.fromEntries([...playerMap].sort(([a], [b]) => a.localeCompare(b))),
  tournaments: Object.fromEntries([...tournamentMap].sort(([a], [b]) => a.localeCompare(b)))
};
fs.mkdirSync(path.join(serviceRoot, 'data'), { recursive: true });
fs.writeFileSync(path.join(serviceRoot, 'data/translations.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(`wrote ${playerMap.size} player and ${tournamentMap.size} tournament translations`);
