(() => {
  'use strict';
  const MAX_XML = 2 * 1024 * 1024;
  const wordNamespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let value = n; for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; crcTable[n] = value >>> 0; }
  function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
  function checkAbort(signal) { if (signal?.aborted) throw new DOMException('Lecture annulée.', 'AbortError'); }
  async function unzipWord(bytes, signal) {
    if (bytes.length < 22) throw Error('Ce fichier Word est incomplet.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
      if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
    }
    if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw Error('Format Word non pris en charge. Enregistrez le CV au format DOCX standard.');
    const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
    if (!count || count > 2000 || count !== view.getUint16(end + 8, true) || start + size !== end) throw Error('L’archive Word est invalide ou trop complexe.');
    let cursor = start, target = null;
    const names = new Set();
    for (let i = 0; i < count; i++) {
      checkAbort(signal);
      if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw Error('Le répertoire du fichier Word est endommagé.');
      const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
      const crc = view.getUint32(cursor + 16, true), compressed = view.getUint32(cursor + 20, true), length = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
      const local = view.getUint32(cursor + 42, true), next = cursor + 46 + nameLength + extra + comment;
      if (next > end || view.getUint16(cursor + 34, true) || compressed === 0xffffffff || length === 0xffffffff || local === 0xffffffff) throw Error('Structure Word non prise en charge.');
      const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (!name || /[\\\x00-\x1f\x7f:]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.') || names.has(name)) throw Error('Le fichier Word contient un chemin invalide ou en double.');
      names.add(name);
      if (name === 'word/document.xml') target = { flags, method, crc, compressed, length, local, nameLength, name };
      cursor = next;
    }
    if (cursor !== end || !target) throw Error('Le texte principal du document Word est introuvable.');
    const { flags, method, crc, compressed, length, local, nameLength, name } = target;
    if (flags & ~0x80e || ![0, 8].includes(method) || !length || length > MAX_XML || local + 30 > start ||
        view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method ||
        view.getUint16(local + 26, true) !== nameLength) throw Error('Le document Word est protégé, trop volumineux ou non pris en charge.');
    const extraLength = view.getUint16(local + 28, true), dataStart = local + 30 + nameLength + extraLength;
    if (new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + nameLength)) !== name || dataStart + compressed > start) throw Error('Le fichier Word est incomplet.');
    const content = bytes.subarray(dataStart, dataStart + compressed);
    let result;
    if (method === 0) result = content;
    else {
      let decompressor;
      try { decompressor = new DecompressionStream('deflate-raw'); }
      catch { throw Error('Ce navigateur ne peut pas lire les CV Word. Utilisez un navigateur récent ou exportez votre CV en PDF ou TXT.'); }
      const reader = new Blob([content]).stream().pipeThrough(decompressor).getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, 10000);
      try {
        const chunks = []; let total = 0;
        while (true) {
          checkAbort(signal); const chunk = await reader.read(); if (chunk.done) break;
          total += chunk.value.length;
          if (total > MAX_XML || total > length) { cancel(); throw Error('Le texte Word dépasse la taille autorisée.'); }
          chunks.push(chunk.value);
        }
        result = new Uint8Array(total); let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
    }
    checkAbort(signal);
    if (result.length !== length || crc32(result) !== crc) throw Error('Le contenu du fichier Word est endommagé.');
    return result;
  }
  function decodeText(bytes) {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    try { const value = new TextDecoder(encoding, { fatal: true }).decode(bytes); if (value.includes('\0')) throw Error(); return value; }
    catch { throw Error('L’encodage du texte n’est pas reconnu. Enregistrez le CV en TXT UTF-8 puis réessayez.'); }
  }
  function wordText(bytes) {
    const xml = decodeText(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Le fichier Word contient des déclarations XML non prises en charge.');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.getElementsByTagName('parsererror').length || !wordNamespaces.has(document.documentElement.namespaceURI) || document.documentElement.localName !== 'document') throw Error('Le texte du fichier Word est invalide.');
    const paragraphs = Array.from(document.getElementsByTagNameNS(document.documentElement.namespaceURI, 'p'));
    if (paragraphs.length > 10000) throw Error('Le document Word est trop complexe.');
    return paragraphs.map(paragraph => {
      // Text boxes can nest paragraphs: each paragraph owns only its own text.
      function collect(node) {
        if (node.nodeType !== 1) return '';
        if (node !== paragraph && wordNamespaces.has(node.namespaceURI) && ['p', 'del', 'moveFrom'].includes(node.localName)) return '';
        if (wordNamespaces.has(node.namespaceURI)) {
          if (node.localName === 't') return node.textContent;
          if (node.localName === 'tab') return '\t';
          if (['br', 'cr'].includes(node.localName)) return '\n';
        }
        return Array.from(node.children).map(collect).join('');
      }
      return collect(paragraph);
    }).join('\n');
  }
  async function extract(file, onProgress = () => {}, signal) {
    if (!file || file.size > 10 * 1024 * 1024 || !/\.(pdf|docx|txt)$/i.test(file.name)) throw Error('Choisissez un CV PDF, DOCX ou TXT de 10 Mo maximum.');
    checkAbort(signal);
    const format = file.name.split('.').at(-1).toUpperCase();
    if (format === 'PDF') return { ...await window.CP_PDF.extract(file, onProgress, signal), format };
    const bytes = new Uint8Array(await file.arrayBuffer()); checkAbort(signal); onProgress(1, 1);
    let text;
    try { text = format === 'TXT' ? decodeText(bytes) : wordText(await unzipWord(bytes, signal)); }
    catch (error) {
      if (error.name === 'TypeError') throw Error('Le document Word est endommagé ou ne peut pas être décompressé. Exportez-le en PDF ou TXT.');
      throw error;
    }
    checkAbort(signal); text = text.replace(/\r\n?/g, '\n').trim();
    if (text.length > 30000) throw Error('Le texte du CV dépasse 30 000 caractères. Utilisez une version plus courte.');
    if (text.replace(/\s/g, '').length < 20) throw Error('Aucun texte exploitable n’a été trouvé dans ce CV.');
    return { text, pages: null, format };
  }
  function partition(text) {
    const fields = { summary: [], experience: [], education: [], skills: [] }, unassigned = [];
    const headings = {
      summary: /^(?:profil(?: professionnel)?|profil personnel|resume|presentation|a propos(?: de moi)?|objectif(?: professionnel)?|summary|professional summary|profile|personal profile|perfil(?: profissional)?|resumo)(?:\s*:\s*(.*))?$/,
      experience: /^(?:experiences?(?: professionnelles?)?|parcours professionnel|emploi(?:s)?|work experience|professional experience|employment(?: history)?|career history|experiencia(?:s)?(?: profissiona(?:l|is))?)(?:\s*:\s*(.*))?$/,
      education: /^(?:formations?(?: et diplomes)?|education(?: and training)?|etudes|parcours (?:scolaire|academique)|diplomes?(?: et formations?)?|formacao(?: academica)?|habilitacoes(?: literarias)?)(?:\s*:\s*(.*))?$/,
      skills: /^(?:competences?(?: techniques| professionnelles| et langues| cles)?|langues?(?: et competences)?|skills(?: and languages)?|technical skills|languages?|competencias(?: tecnicas)?|idiomas|linguas)(?:\s*:\s*(.*))?$/
    };
    let current = null, recognized = 0;
    for (const raw of String(text).slice(0, 30000).split(/\r?\n/)) {
      const line = raw.trim(), normalized = line.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/^[•\-–—\s]+|[•\-–—\s]+$/g, '');
      let matched = false;
      for (const [key, pattern] of Object.entries(headings)) {
        const match = normalized.match(pattern);
        if (!match) continue;
        current = key; recognized++; matched = true;
        if (match[1]) fields[key].push(line.slice(line.indexOf(':') + 1).trim());
        break;
      }
      if (matched) continue;
      if (/^(?:loisirs|centres d.interet|references|interets|hobbies|interests|referencias)(?:\s*:.*)?$/.test(normalized)) current = null;
      if (line) (current ? fields[current] : unassigned).push(line);
    }
    return { fields: Object.fromEntries(Object.entries(fields).map(([key, lines]) => [key, lines.join('\n')])), recognized, unassigned: unassigned.join('\n') };
  }
  window.CP_CV_IMPORT = Object.freeze({ extract, partition });
})();
