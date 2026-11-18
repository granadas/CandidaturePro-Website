(() => {
  'use strict';
  const MAX_BYTES = 100 * 1024 * 1024;
  const MAX_ENTRIES = 2000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }
  function validName(name) {
    return typeof name === 'string' && name.length > 0 && name.length <= 1000 &&
      !/[\\\x00-\x1f\x7f]/.test(name) && !name.includes(':') &&
      name.split('/').every(part => part && part !== '.' && part !== '..');
  }
  function header(size) { const bytes = new Uint8Array(size); return [bytes, new DataView(bytes.buffer)]; }
  function buildArchive(entries) {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) throw Error('La sauvegarde contient trop de fichiers.');
    let offset = 0, total = 0;
    const parts = [], central = [], names = new Set();
    for (const entry of entries) {
      if (!validName(entry.name) || names.has(entry.name) || !(entry.bytes instanceof Uint8Array)) throw Error('Fichier de sauvegarde invalide.');
      names.add(entry.name); total += entry.bytes.length;
      if (total > MAX_BYTES) throw Error('La sauvegarde dépasse 100 Mo.');
      const name = encoder.encode(entry.name), crc = crc32(entry.bytes);
      const [local, lv] = header(30);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
      lv.setUint16(12, 0x21, true); lv.setUint32(14, crc, true);
      lv.setUint32(18, entry.bytes.length, true); lv.setUint32(22, entry.bytes.length, true); lv.setUint16(26, name.length, true);
      parts.push(local, name, entry.bytes);
      const [record, cv] = header(46);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
      cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, entry.bytes.length, true); cv.setUint32(24, entry.bytes.length, true); cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true); central.push(record, name);
      offset += local.length + name.length + entry.bytes.length;
    }
    const centralSize = central.reduce((sum, item) => sum + item.length, 0);
    const [end, ev] = header(22);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  function readArchive(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 22 || bytes.length > MAX_BYTES + 3 * 1024 * 1024) throw Error('Choisissez une sauvegarde ZIP Candidature Pro de 100 Mo maximum.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = bytes.length - 22;
    if (view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 20, true) || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw Error('Format de sauvegarde non reconnu. Utilisez une archive créée par ce site.');
    const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
    if (!count || count > MAX_ENTRIES || count !== view.getUint16(end + 8, true) || start + size !== end) throw Error('Archive incomplète ou invalide.');
    let cursor = start, total = 0;
    const entries = new Map(), ranges = [];
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw Error('Répertoire ZIP invalide.');
      const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
      const crc = view.getUint32(cursor + 16, true), compressed = view.getUint32(cursor + 20, true), length = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
      const local = view.getUint32(cursor + 42, true);
      if (flags !== 0x800 || method !== 0 || compressed !== length || extra || comment || cursor + 46 + nameLength > end || local + 30 > start) throw Error('Format de sauvegarde non pris en charge.');
      const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (!validName(name) || entries.has(name)) throw Error('Nom de fichier non valide dans la sauvegarde.');
      if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== 0 ||
          view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== length || view.getUint32(local + 22, true) !== length ||
          view.getUint16(local + 26, true) !== nameLength || view.getUint16(local + 28, true) !== 0) throw Error('En-tête de fichier incohérent.');
      if (decoder.decode(bytes.subarray(local + 30, local + 30 + nameLength)) !== name) throw Error('Nom de fichier incohérent.');
      const dataStart = local + 30 + nameLength, dataEnd = dataStart + length;
      if (dataEnd > start) throw Error('Fichier incomplet dans la sauvegarde.');
      total += length;
      if (total > MAX_BYTES) throw Error('La sauvegarde dépasse 100 Mo.');
      const content = bytes.subarray(dataStart, dataEnd);
      if (crc32(content) !== crc) throw Error('La sauvegarde est endommagée.');
      entries.set(name, content); ranges.push([local, dataEnd]); cursor += 46 + nameLength;
    }
    if (cursor !== end) throw Error('Répertoire ZIP incomplet.');
    ranges.sort((a, b) => a[0] - b[0]);
    let previous = 0;
    for (const [from, to] of ranges) { if (from !== previous) throw Error('Structure ZIP incohérente.'); previous = to; }
    if (previous !== start) throw Error('Structure ZIP incomplète.');
    return entries;
  }
  window.CP_BACKUP = Object.freeze({ buildArchive, readArchive });
})();
