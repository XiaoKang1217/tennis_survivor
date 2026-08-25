'use strict';

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value && value.data instanceof ArrayBuffer) return new Uint8Array(value.data);
  throw new Error('SSE chunk invalid');
}

class Utf8StreamDecoder {
  constructor() {
    this.pending = new Uint8Array();
  }

  decode(chunk, final = false) {
    const incoming = bytes(chunk);
    const combined = new Uint8Array(this.pending.length + incoming.length);
    combined.set(this.pending, 0);
    combined.set(incoming, this.pending.length);
    this.pending = new Uint8Array();
    let output = '';
    for (let index = 0; index < combined.length;) {
      const first = combined[index];
      let size = 1;
      let point = first;
      if (first >= 0xc2 && first <= 0xdf) {
        size = 2; point = first & 0x1f;
      } else if (first >= 0xe0 && first <= 0xef) {
        size = 3; point = first & 0x0f;
      } else if (first >= 0xf0 && first <= 0xf4) {
        size = 4; point = first & 0x07;
      } else if (first >= 0x80) {
        output += '\ufffd'; index += 1; continue;
      }
      if (index + size > combined.length) {
        if (!final) this.pending = combined.slice(index);
        else output += '\ufffd';
        break;
      }
      let valid = true;
      for (let offset = 1; offset < size; offset += 1) {
        const continuation = combined[index + offset];
        if ((continuation & 0xc0) !== 0x80) { valid = false; break; }
        point = (point << 6) | (continuation & 0x3f);
      }
      if (!valid
        || (size === 2 && point < 0x80)
        || (size === 3 && point < 0x800)
        || (size === 4 && point < 0x10000)
        || point > 0x10ffff
        || (point >= 0xd800 && point <= 0xdfff)) {
        output += '\ufffd'; index += 1; continue;
      }
      output += String.fromCodePoint(point);
      index += size;
    }
    return output;
  }
}

class SseParser {
  constructor(onEvent) {
    if (typeof onEvent !== 'function') throw new Error('SSE listener invalid');
    this.onEvent = onEvent;
    this.decoder = new Utf8StreamDecoder();
    this.buffer = '';
  }

  feed(chunk) {
    this.buffer += this.decoder.decode(chunk).replace(/\r\n/g, '\n');
    let boundary;
    while ((boundary = this.buffer.indexOf('\n\n')) >= 0) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      this.parseBlock(block);
    }
  }

  finish() {
    this.buffer += this.decoder.decode(new Uint8Array(), true);
    if (this.buffer.trim()) this.parseBlock(this.buffer);
    this.buffer = '';
  }

  parseBlock(block) {
    let event = 'message';
    let id = null;
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':') || line.startsWith('retry:')) continue;
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      let value = separator < 0 ? '' : line.slice(separator + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'id') id = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0) this.onEvent({ event, id, data: data.join('\n') });
  }
}

module.exports = Object.freeze({ Utf8StreamDecoder, SseParser });
