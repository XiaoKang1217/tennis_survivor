const TOURNAMENT_TIME_ZONES = new Map([
  ['1205', 'Europe/Vienna'],
  ['1206', 'Europe/Vienna'],
  ['1267', 'Europe/Lisbon'],
  ['2204', 'Europe/Lisbon'],
  ['2205', 'Europe/Prague'],
  ['2206', 'Europe/Prague'],
  ['3733', 'Europe/Berlin'],
  ['3770', 'Europe/Berlin']
]);

function dateInTimeZone(timestamp, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(timestamp));
}

function dateDistance(first, second) {
  const start = Date.parse(`${first}T00:00:00Z`);
  const end = Date.parse(`${second}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86_400_000) : 0;
}

export function tournamentTimeZone(match = {}) {
  const id = String(match.tournament?.id || '');
  if (TOURNAMENT_TIME_ZONES.has(id)) return TOURNAMENT_TIME_ZONES.get(id);
  const name = String(match.tournament?.nameEn || match.tournament?.name || '').toLowerCase();
  if (/kitzb[uü]hel/.test(name)) return 'Europe/Vienna';
  if (/estoril/.test(name)) return 'Europe/Lisbon';
  if (/prague|praha/.test(name)) return 'Europe/Prague';
  if (/hamburg/.test(name)) return 'Europe/Berlin';
  return '';
}

export function assignOfficialScheduleDate(matches = [], scheduleDate, displayTimeZone = 'Asia/Shanghai') {
  return matches.flatMap(match => {
    const timestamp = Date.parse(`${match.date}T${match.time}:00+08:00`);
    if (!Number.isFinite(timestamp)) {
      // An official order of play may say only "followed by". Keep that
      // official match on its official day with a pending display time instead
      // of deleting it merely because there is no exact clock time yet.
      if (match.officialScheduleDate === scheduleDate) {
        match.scheduleDate = scheduleDate;
        match.dayOffset = match.date ? dateDistance(scheduleDate, match.date) : 0;
        return [match];
      }
      return [];
    }
    const officialTimeZone = tournamentTimeZone(match);
    const officialDate = match.officialScheduleDate
      || (officialTimeZone ? dateInTimeZone(timestamp, officialTimeZone) : match.date);
    if (officialDate !== scheduleDate) return [];
    const displayDate = dateInTimeZone(timestamp, displayTimeZone);
    match.scheduleDate = officialDate;
    match.date = displayDate;
    match.dayOffset = dateDistance(officialDate, displayDate);
    return [match];
  });
}
