'use strict';
const { DateTime, IANAZone } = require('luxon');
const bad = message => { throw Object.assign(new Error(message), { status: 400 }); };
function number(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) bad(`Check ${label}: expected ${min}–${max}.`);
  return value;
}
function instant(value, zone) {
  if (typeof value !== 'string') bad('Enter a valid date and time.');
  const date = DateTime.fromISO(value, { zone });
  if (!date.isValid || (!/[zZ]|[+-]\d\d:\d\d$/.test(value) && date.toFormat("yyyy-MM-dd'T'HH:mm") !== value.slice(0, 16))) bad('That local time does not exist. Choose another time.');
  if (!/[zZ]|[+-]\d\d:\d\d$/.test(value) && date.getPossibleOffsets().length > 1) bad('That time occurs twice. Supply an explicit UTC offset.');
  return date.toMillis();
}
function validate(input, now = Date.now()) {
  const s = structuredClone(input);
  if (!s || !IANAZone.isValidZone(s.timezone)) bad('Choose a valid IANA timezone.');
  if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 150) bad('Enter an exam name.');
  s.deadline = instant(s.examAt, s.timezone) - number(s.travelMinutes ?? 60, 0, 360, 'exam preparation buffer') * 60000;
  if (s.deadline <= now || s.deadline > now + 366 * 86400000) bad('Choose a future exam within one year.');
  number(s.sessionMinutes, 15, 90, 'session length'); number(s.breakMinutes, 5, 30, 'break length');
  if (!['balanced', 'sprint', 'deep'].includes(s.strategy)) bad('Choose a planning strategy.');
  if (!Array.isArray(s.availability) || !s.availability.length || s.availability.length > 366) bad('Enter daily availability.');
  const dates = new Set();
  s.windows = s.availability.map(a => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || dates.has(a.date)) bad('Use one availability window per date.');
    dates.add(a.date);
    if (!/^\d\d:\d\d$/.test(a.start) || !/^\d\d:\d\d$/.test(a.end) || a.start < '07:00' || a.end > '22:00') bad('Keep availability between 07:00 and 22:00 to protect overnight rest.');
    const start = instant(a.date + 'T' + a.start, s.timezone), end = instant(a.date + 'T' + a.end, s.timezone);
    if (end <= start) bad('Availability must end after it starts.');
    return { start: Math.max(now, start), end: Math.min(s.deadline, end), max: number(a.maxHours, 0, 8, 'daily study hours') * 60, date: a.date };
  }).sort((a,b) => a.start-b.start);
  if (!Array.isArray(s.topics) || !s.topics.length || s.topics.length > 100) bad('Add 1–100 topics.');
  const ids = new Set();
  for (const t of s.topics) {
    if (typeof t.id !== 'string' || ids.has(t.id) || typeof t.title !== 'string' || !t.title.trim() || t.title.length > 240) bad('Check topic names and identifiers.');
    ids.add(t.id); number(t.minutes, 15, 600, 'topic estimate'); number(t.priority, 1, 3, 'priority');
    if(t.confidence && !['new','weak','comfortable'].includes(t.confidence)) bad('Choose a valid topic confidence.');
    if (!Array.isArray(t.prerequisites) || t.prerequisites.some(x => typeof x !== 'string')) bad('Check prerequisites.');
  }
  for (const t of s.topics) if (t.prerequisites.some(id => !ids.has(id) || id === t.id)) bad('Prerequisites must refer to other selected topics.');
  const ordered = [], pending = [...s.topics].sort((a,b) => b.priority-a.priority);
  while (pending.length) {
    const i = pending.findIndex(t => t.prerequisites.every(id => ordered.some(x => x.id === id)));
    if (i < 0) bad('Prerequisites contain a cycle.');
    ordered.push(pending.splice(i,1)[0]);
  }
  s.topics = ordered;
  return s;
}
function work(s) {
  const units = [];
  for (const t of s.topics) {
    const total = Math.ceil(t.minutes * (s.strategy === 'deep' ? 1.4 : s.strategy === 'sprint' ? .75 : 1) * (t.confidence==='weak'?1.25:t.confidence==='comfortable'?.85:1));
    for (const [activity, ratio] of [['learn', t.kind==='problem'?.35:.45], ['practice', t.kind==='problem'?.3:.2], ['recall', .1], ['revision', .15], ['mock', .1]]) {
      let remaining = Math.max(5, Math.ceil(total * ratio)), index = 0;
      while (remaining > 0) {
        const minutes = Math.min(s.sessionMinutes, remaining);
        units.push({ id: `${t.id}:${activity}:${index++}`, topicId: t.id, title: t.title, module: t.module || '', sourceId: t.sourceId || null, activity, priority: t.priority, minutes });
        remaining -= minutes;
      }
    }
  }
  return units;
}
function schedule(input, commitments = [], completed = [], now = Date.now(), remainingUnits) {
  const s = validate(input, now), done = new Set(completed.map(u => u.id));
  const queue = (remainingUnits || work(s)).filter(u => !done.has(u.id));
  const blocks = [], uncovered = [], busy = [...commitments,...completed.map(b=>({...b,study:true}))].map(c => ({ start: instant(c.start, s.timezone), end: instant(c.end, s.timezone)+(c.study?s.breakMinutes*60000:0) }));
  const windows = s.windows.map(w => ({ ...w, max:Math.min(w.max,480-commitments.filter(c=>c.study&&DateTime.fromISO(c.start).setZone(s.timezone).toISODate()===w.date).reduce((n,c)=>n+(Date.parse(c.end)-Date.parse(c.start))/60000,0)), cursor: w.start, used: completed.filter(b => DateTime.fromISO(b.start).setZone(s.timezone).toISODate() === w.date).reduce((n,b) => n+b.minutes, 0) }));
  let earliest = Math.ceil(now / 60000) * 60000 + 5 * 60000;
  const blocked = new Set();
  for (const u of queue) {
    const topic = s.topics.find(t => t.id === u.topicId);
    if (blocked.has(u.topicId) || topic?.prerequisites.some(id => blocked.has(id))) { blocked.add(u.topicId); uncovered.push(u); continue; }
    let placed = false;
    for (const w of windows) {
      if (w.used + u.minutes > w.max) continue;
      // Exam day is reserved for recall/revision, never large new learning blocks.
      if (w.date === DateTime.fromISO(s.examAt, { zone: s.timezone }).toISODate() && !['recall','revision'].includes(u.activity)) continue;
      let start = Math.max(w.cursor, earliest), end = start + u.minutes * 60000;
      while (true) {
        const conflict = busy.find(b => start < b.end && end + s.breakMinutes*60000 > b.start);
        if (!conflict) break;
        start = conflict.end; end = start + u.minutes*60000;
      }
      if (end > w.end) continue;
      const block = { ...u, start: new Date(start).toISOString(), end: new Date(end).toISOString(), status: 'scheduled' };
      blocks.push(block); w.used += u.minutes; w.cursor = end + s.breakMinutes*60000; earliest = w.cursor; placed = true; break;
    }
    if (!placed) { uncovered.push(u); blocked.add(u.topicId); }
  }
  return { blocks: [...completed, ...blocks], uncovered, estimatedMinutes: queue.reduce((n,u) => n+u.minutes,0), scheduledMinutes: blocks.reduce((n,u) => n+u.minutes,0), explanation: 'Approximate estimates. Topic order respects prerequisites; each topic includes learning, practice, recall and revision. Unplaced work remains visible. Availability protects 22:00–07:00 rest and an eight-hour daily maximum.' };
}
module.exports = { validate, schedule, work, instant };
