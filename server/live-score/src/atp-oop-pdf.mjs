import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

function multiply(left, right) {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f
  ];
}

function point(matrix, x, y) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5]
  };
}

function pdfObjects(buffer) {
  const source = buffer.toString('latin1');
  const objects = new Map();
  const starts = [...source.matchAll(/(?:^|[\r\n])(\d+)\s+0\s+obj\b/g)];
  starts.forEach((entry, index) => {
    const id = Number(entry[1]);
    const start = entry.index + entry[0].length;
    const next = starts[index + 1]?.index ?? source.length;
    const end = source.lastIndexOf('endobj', next);
    if (end < start) return;
    const raw = source.slice(start, end);
    const streamMatch = raw.match(/stream\r?\n/);
    let stream = null;
    if (streamMatch) {
      const streamStart = start + streamMatch.index + streamMatch[0].length;
      const streamEnd = source.indexOf('endstream', streamStart);
      if (streamEnd >= streamStart) {
        let bytes = buffer.subarray(streamStart, streamEnd);
        while (bytes.length && (bytes.at(-1) === 10 || bytes.at(-1) === 13)) bytes = bytes.subarray(0, -1);
        try {
          stream = /\/FlateDecode\b/.test(raw) ? inflateSync(bytes) : bytes;
        } catch (_) {
          stream = null;
        }
      }
    }
    objects.set(id, { raw, stream });
  });
  return objects;
}

function unicodeString(hex) {
  const bytes = Buffer.from(hex, 'hex');
  let output = '';
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    output += String.fromCharCode(bytes.readUInt16BE(index));
  }
  return output;
}

function cmapForObject(object) {
  const source = object?.stream?.toString('latin1') || '';
  const map = new Map();
  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(entry[1].toUpperCase(), unicodeString(entry[2]));
    }
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const entry of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]+)\])/g)) {
      const first = Number.parseInt(entry[1], 16);
      const last = Number.parseInt(entry[2], 16);
      const width = entry[1].length;
      const explicit = entry[4] ? [...entry[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map(item => item[1]) : null;
      const base = entry[3] ? Number.parseInt(entry[3], 16) : 0;
      for (let code = first; code <= last; code += 1) {
        const destination = explicit?.[code - first]
          || (base + code - first).toString(16).padStart(entry[3]?.length || 4, '0');
        if (destination) map.set(code.toString(16).padStart(width, '0').toUpperCase(), unicodeString(destination));
      }
    }
  }
  return map;
}

function fontMaps(objects) {
  const maps = new Map();
  for (const object of objects.values()) {
    for (const entry of object.raw.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
      const font = objects.get(Number(entry[2]));
      const cmapId = Number(font?.raw.match(/\/ToUnicode\s+(\d+)\s+0\s+R/)?.[1] || 0);
      if (cmapId) maps.set(entry[1], cmapForObject(objects.get(cmapId)));
    }
  }
  return maps;
}

function decodeHex(hex, cmap) {
  if (!cmap?.size) return '';
  const widths = [...new Set([...cmap.keys()].map(key => key.length))].sort((a, b) => b - a);
  let output = '';
  for (let index = 0; index < hex.length;) {
    const width = widths.find(candidate => cmap.has(hex.slice(index, index + candidate).toUpperCase()));
    if (!width) {
      index += widths.at(-1) || 2;
      continue;
    }
    output += cmap.get(hex.slice(index, index + width).toUpperCase());
    index += width;
  }
  return output;
}

function decodeLiteral(value) {
  return value
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([\\()])/g, '$1');
}

function tokenizeContent(source) {
  const pattern = /-?(?:\d+\.\d+|\d+|\.\d+)|\/[A-Za-z0-9._-]+|<[\dA-Fa-f\s]+>|\((?:\\.|[^\\)])*\)|\[(?:[^\]]|\](?!\s*TJ))*\]|BT|ET|Tf|Tm|Td|TD|Tj|TJ|cm|q|Q/g;
  return source.match(pattern) || [];
}

function textChunks(content, maps) {
  const tokens = tokenizeContent(content);
  const stack = [];
  const operands = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let textMatrix = [1, 0, 0, 1, 0, 0];
  let font = '';
  const chunks = [];
  const show = value => {
    const map = maps.get(font);
    let text = '';
    if (value.startsWith('<')) text = decodeHex(value.replace(/[<>\s]/g, ''), map);
    else if (value.startsWith('(')) text = decodeLiteral(value.slice(1, -1));
    else if (value.startsWith('[')) {
      for (const item of value.matchAll(/<([\dA-Fa-f\s]+)>|\((?:\\.|[^\\)])*\)/g)) {
        text += item[1] ? decodeHex(item[1].replace(/\s/g, ''), map) : decodeLiteral(item[0].slice(1, -1));
      }
    }
    if (!text) return;
    const location = point(ctm, textMatrix[4], textMatrix[5]);
    chunks.push({ ...location, text: text.replace(/\s+/g, ' '), font });
  };

  for (const token of tokens) {
    if (!['q', 'Q', 'cm', 'BT', 'ET', 'Tf', 'Tm', 'Td', 'TD', 'Tj', 'TJ'].includes(token)) {
      operands.push(token);
      continue;
    }
    if (token === 'q') stack.push([...ctm]);
    else if (token === 'Q') ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (token === 'cm') {
      const values = operands.splice(-6).map(Number);
      if (values.every(Number.isFinite)) ctm = multiply(ctm, values);
    } else if (token === 'BT') {
      textMatrix = [1, 0, 0, 1, 0, 0];
    } else if (token === 'Tf') {
      font = String(operands.at(-2) || '').replace(/^\//, '');
      operands.splice(-2);
    } else if (token === 'Tm') {
      const values = operands.splice(-6).map(Number);
      if (values.every(Number.isFinite)) textMatrix = values;
    } else if (token === 'Td' || token === 'TD') {
      const values = operands.splice(-2).map(Number);
      if (values.every(Number.isFinite)) {
        textMatrix[4] += values[0];
        textMatrix[5] += values[1];
      }
    } else if (token === 'Tj' || token === 'TJ') {
      show(operands.pop() || '');
    }
    operands.length = 0;
  }
  return chunks.filter(chunk => chunk.text.trim());
}

export function extractPdfTextLayout(buffer) {
  const objects = pdfObjects(buffer);
  const maps = fontMaps(objects);
  const chunks = [];
  const pageObjects = [...objects.entries()].filter(([, object]) =>
    /\/Type\s*\/Page\b/.test(object.raw));
  const pageOrder = [...objects.values()]
    .map(object => object.raw.match(/\/Type\s*\/Pages\b[\s\S]*?\/Kids\s*\[([^\]]+)\]/)?.[1] || '')
    .find(Boolean);
  const orderedIds = pageOrder
    ? [...pageOrder.matchAll(/(\d+)\s+0\s+R/g)].map(match => Number(match[1]))
    : pageObjects.map(([id]) => id);
  const pageById = new Map(pageObjects);
  orderedIds.forEach((pageId, page) => {
    const object = pageById.get(pageId);
    if (!object) return;
    const contents = object.raw.match(/\/Contents\s*(?:\[((?:.|\n|\r)*?)\]|(\d+)\s+0\s+R)/);
    const contentIds = contents?.[2]
      ? [Number(contents[2])]
      : [...(contents?.[1] || '').matchAll(/(\d+)\s+0\s+R/g)].map(match => Number(match[1]));
    const streams = contentIds.length
      ? contentIds.map(id => objects.get(id)?.stream).filter(Boolean)
      : [object.stream].filter(Boolean);
    streams.forEach(stream => {
      const content = stream.toString('latin1');
      if (!content.includes('BT') || !content.includes(' Tj')) return;
      chunks.push(...textChunks(content, maps).map(chunk => ({ ...chunk, page })));
    });
  });
  if (!chunks.length) {
    let page = 0;
    for (const object of objects.values()) {
      const content = object.stream?.toString('latin1') || '';
      if (!content.includes('BT') || !content.includes(' Tj')) continue;
      chunks.push(...textChunks(content, maps).map(chunk => ({ ...chunk, page })));
      page += 1;
    }
  }
  return chunks;
}

export function pdfSha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function layoutLines(chunks) {
  const rows = [];
  [...chunks].sort((first, second) =>
    (first.page || 0) - (second.page || 0)
    || second.y - first.y
    || first.x - second.x).forEach(chunk => {
    const page = chunk.page || 0;
    let row = rows.find(candidate =>
      candidate.page === page && Math.abs(candidate.y - chunk.y) < 0.8);
    if (!row) {
      row = { page, y: chunk.y, chunks: [] };
      rows.push(row);
    }
    row.chunks.push(chunk);
  });
  return rows.flatMap(row => {
    row.chunks.sort((first, second) => first.x - second.x);
    const segments = [];
    row.chunks.forEach(chunk => {
      let segment = segments.at(-1);
      if (!segment || chunk.x - segment.lastX > 105) {
        segment = { y: row.y, x: chunk.x, lastX: chunk.x, chunks: [] };
        segments.push(segment);
      }
      segment.chunks.push(chunk);
      segment.lastX = chunk.x;
    });
    return segments.map(segment => ({
      page: row.page,
      y: segment.y,
      x: segment.x,
      text: segment.chunks.map(chunk => chunk.text).join('').replace(/\s+/g, ' ').trim()
    }));
  });
}

const MONTHS = new Map([
  ['january', 1], ['february', 2], ['march', 3], ['april', 4],
  ['may', 5], ['june', 6], ['july', 7], ['august', 8],
  ['september', 9], ['october', 10], ['november', 11], ['december', 12]
]);

function isoDateFromHeader(text) {
  const match = text.match(/ORDER OF PLAY\s*-\s*[A-Z]+,\s*([A-Z]+)\s+(\d{1,2}),\s*(\d{4})/i);
  if (!match) return '';
  const month = MONTHS.get(match[1].toLowerCase());
  if (!month) return '';
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
}

function localDateTime(scheduleDate, time, timeZone) {
  if (!scheduleDate || !time || !timeZone) return { date: scheduleDate, time: '' };
  const [year, month, day] = scheduleDate.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  // Resolve the tournament-local wall clock without a timezone package.
  let timestamp = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    const observed = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute)
    );
    timestamp += target - observed;
  }
  const value = new Date(timestamp);
  return {
    date: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(value),
    time: new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(value)
  };
}

function stripPlayerLine(value) {
  return value
    .replace(/^\s*\[[^\]]+\]\s*/, '')
    .replace(/\s*\([A-Z]{3}\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function alternatives(value) {
  // ATP PDFs are visually spaced, but their text layer is not. The same
  // placeholder may therefore be encoded as "A or B", "A (ARG)or/B" or
  // "A/or/B". Treat only those explicit separators as alternatives; a plain
  // slash continues to mean a doubles team.
  return String(value)
    .split(/\s+or\s+|\s*\/\s*or\s*\/\s*|(?<=\([A-Z]{3}\))\s*or\s*\/?/i)
    .map(stripPlayerLine)
    .filter(Boolean);
}

function teamFromLines(lines) {
  const names = lines.map(line => stripPlayerLine(line.text)).filter(Boolean);
  const name = names.join('/');
  const choices = alternatives(name);
  return {
    name: choices[0] || name,
    alternatives: choices.length > 1 ? choices : [],
    ids: [],
    countries: [...new Set(lines.flatMap(line =>
      [...line.text.matchAll(/\(([A-Z]{3})\)/g)].map(match => match[1])
    ))]
  };
}

function parseClock(value) {
  const match = value.match(/(?:Starts?\s+At|Not\s+Before)\s+(\d{1,2}):(\d{2})/i);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

function courtName(value) {
  const compact = value.replace(/\s+/g, '').toUpperCase();
  const known = {
    CENTERCOURT: 'Center Court',
    CENTRECOURT: 'Centre Court',
    GRANDSTAND: 'Grandstand',
    ESTADIOMILLENNIUM: 'Estadio Millennium',
    COURTCASCAIS: 'Court Cascais',
    COURTCTE: 'Court CTE'
  };
  return known[compact] || value.replace(/\bCOURT\b/gi, 'Court').trim();
}

const SIDE_EVENT_PATTERN = /\b(?:RISING|JUNIOR|JUNIORS|EXHIBITION|INVITATIONAL|LEGENDS?|RACE\s+TO|U[-\s]?(?:12|14|15|16|18))\b/i;
const SECTION_PATTERN = /\b(?:SINGLES|DOUBLES|QUALIFYING|QUALIFICATION|FINAL|SEMI(?:FINAL)?S?|QUARTER(?:FINAL)?S?|RISING|JUNIOR|JUNIORS|EXHIBITION|INVITATIONAL|LEGENDS?|RACE\s+TO|U[-\s]?(?:12|14|15|16|18))\b/i;

function sectionForMatch(pageLines, versusLine, firstY, courtLine) {
  const candidates = pageLines
    .filter(line =>
      line.y > firstY
      && line.y < courtLine - 2
      && Math.abs(line.x - versusLine.x) < 160
      && SECTION_PATTERN.test(line.text))
    .map(line => ({
      line,
      // Centred PDF labels often expose their text origin near the right edge,
      // so column boundaries are unreliable. Score both horizontal proximity
      // to the "vs" anchor and vertical proximity to this match instead.
      score: Math.abs(line.x - versusLine.x) * 2 + Math.abs(line.y - firstY)
    }))
    .sort((first, second) => first.score - second.score);
  return candidates[0]?.line?.text || '';
}

function kindFromSection(section = '') {
  if (/\bDOUBLES\b/i.test(section)) return 'MD';
  if (/\bSINGLES\b/i.test(section)) return 'MS';
  return '';
}

export function parseAtpOopLayout(chunks, registry, sha256 = '') {
  const lines = layoutLines(chunks);
  const allText = lines.map(line => line.text).join('\n');
  const scheduleDate = isoDateFromHeader(allText);
  const location = lines.find(line =>
    line.y > 790 && line.y < 815 && /,\s*[A-Za-z]/.test(line.text))?.text || '';
  const [headerCity = '', headerCountry = ''] = location.split(',').map(value => value.trim());
  const detail = lines.find(line => line.y > 785 && /\|\s*(?:Clay|Hard|Grass)\b/i.test(line.text))?.text || '';
  const surfaceEn = detail.match(/\|\s*(Clay|Hard|Grass)\b/i)?.[1] || '';
  const title = lines.find(line => line.y > 810 && line.y < 830)?.text || registry?.name || '';
  const headerLines = lines.filter(line => /ORDER OF PLAY/i.test(line.text));
  if (!scheduleDate || !headerLines.length) {
    throw new Error('ATP OOP PDF header or official schedule date is missing');
  }

  const matches = [];
  const parseFailures = [];
  const pageNumbers = [...new Set(lines.map(line => line.page || 0))].sort((a, b) => a - b);
  for (const page of pageNumbers) {
    const pageLines = lines.filter(line => (line.page || 0) === page);
    const headerLine = pageLines.find(line => /ORDER OF PLAY/i.test(line.text));
    if (!headerLine) {
      if (pageLines.some(line => /^vs\.?$/i.test(line.text))) {
        parseFailures.push(`page-${page + 1}:missing-header`);
      }
      continue;
    }
    const courtLine = Math.max(...pageLines.filter(line =>
      line.y < headerLine.y && line.y > headerLine.y - 40
    ).map(line => line.y), 0);
    const courtParts = pageLines.filter(line => Math.abs(line.y - courtLine) < 0.8);
    const courts = courtParts
      .filter(line => line.text.length > 2 && !/^Starts?\b/i.test(line.text))
      .map(line => ({ x: line.x, name: courtName(line.text) }));
    if (!courts.length) {
      parseFailures.push(`page-${page + 1}:missing-courts`);
      continue;
    }
    courts.sort((first, second) => first.x - second.x);
    const boundaries = courts.map((court, index) => ({
      ...court,
      min: index ? (courts[index - 1].x + court.x) / 2 : -Infinity,
      max: index + 1 < courts.length ? (court.x + courts[index + 1].x) / 2 : Infinity,
      order: page * 100 + index
    }));

    for (const [courtIndex, court] of boundaries.entries()) {
      const columnLines = pageLines.filter(line =>
        line.x >= court.min && line.x < court.max
        && line.y < courtLine - 5 && line.y > 190);
      const versus = columnLines.filter(line => /^vs\.?$/i.test(line.text));
      versus.forEach((versusLine, matchIndex) => {
        const firstLines = columnLines.filter(line =>
          line.y > versusLine.y + 1 && line.y <= versusLine.y + 35
          && !/^(?:Starts?|Not Before|Followed By)\b/i.test(line.text)
          && !/^\d+\.*$/.test(line.text));
        const secondLines = columnLines.filter(line =>
          line.y < versusLine.y - 1 && line.y >= versusLine.y - 35
          && !/^\d+\.*$/.test(line.text));
        if (!firstLines.length || !secondLines.length) {
          parseFailures.push(`${court.name}@${versusLine.y}`);
          return;
        }
        firstLines.sort((first, second) => second.y - first.y);
        secondLines.sort((first, second) => second.y - first.y);
        const section = sectionForMatch(
          pageLines,
          versusLine,
          firstLines[0].y,
          courtLine
        );
        if (SIDE_EVENT_PATTERN.test(section)) return;
        const first = teamFromLines(firstLines);
        const second = teamFromLines(secondLines);
        if (!first.name || !second.name) {
          parseFailures.push(`${court.name}@${versusLine.y}`);
          return;
        }
        const timeLine = columnLines
          .filter(line => line.y > firstLines[0].y && line.y - firstLines[0].y < 120)
          .sort((first, second) => first.y - second.y)
          .find(line => /^(?:Starts?|Not Before|Followed By)\b/i.test(line.text));
        const localTime = parseClock(timeLine?.text || '');
        const clock = localDateTime(scheduleDate, localTime, registry?.timeZone);
        const kind = kindFromSection(section)
          || (first.name.includes('/') || second.name.includes('/') ? 'MD' : 'MS');
        matches.push({
          id: `atp-oop:${registry?.atpId || 'unknown'}:${scheduleDate}:${page}:${courtIndex}:${matchIndex}`,
          kind,
          first,
          second,
          court: court.name,
          courtOrder: court.order,
          scheduleOrder: court.order * 100 + matchIndex,
          scheduleDate,
          date: clock.date || scheduleDate,
          time: clock.time,
          round: section,
          provisional: Boolean(first.alternatives.length || second.alternatives.length),
          officialMainTour: true,
          status: 'scheduled',
          statusText: 'Scheduled',
          winner: '',
          sets: []
        });
      });
    }
  }
  if (parseFailures.length) {
    throw new Error(`ATP OOP PDF has ${parseFailures.length} unparsed match rows`);
  }
  if (!matches.length) throw new Error('ATP OOP PDF contains no tour matches');
  return {
    date: scheduleDate,
    title,
    city: headerCity,
    country: headerCountry,
    surfaceEn,
    surface: ({ Clay: '红土', Hard: '硬地', Grass: '草地' })[surfaceEn] || surfaceEn || '',
    releasedAt: allText.match(/Released:\s*([^\n]+)/i)?.[1]?.trim() || '',
    matches,
    sha256
  };
}

export function parseAtpOopPdf(buffer, registry) {
  return parseAtpOopLayout(
    extractPdfTextLayout(buffer),
    registry,
    pdfSha256(buffer)
  );
}
