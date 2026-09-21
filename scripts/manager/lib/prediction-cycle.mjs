export function shiftOfficialDate(date, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid official date');
  if(new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Invalid official date');
  return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
}

// raw.date is the source result page's official schedule day, not a converted
// timestamp. The latest day with live/results evidence is D even if other
// matches are unfinished. Only unstarted prediction games block publication.
export function predictionCycle(events, matches, now = new Date()) {
  const days=new Map();
  for (const match of matches) {
    const day=String(match.raw?.date||'');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!days.has(day)) days.set(day,[]);
    days.get(day).push(match);
  }
  const ordered=[...days.keys()].sort();
  if (!ordered.length) return null;
  let settledDay=null;
  for (const day of ordered) {
    if(days.get(day).some(m=>['live','completed','walkover','retired'].includes(m.status)
      && (!m.scheduled_at||Date.parse(m.scheduled_at)<=new Date(now).getTime())))settledDay=day;
  }
  return { throughDate:settledDay||shiftOfficialDate(ordered[0],-1),
    contestDate:settledDay?shiftOfficialDate(settledDay,1):ordered[0] };
}
