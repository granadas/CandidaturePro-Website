(() => {
  'use strict';
  const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const encoder = new TextEncoder();
  function xml(value) {
    return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function textRuns(value) {
    return String(value).split(/(\t|\r?\n)/).map(part => part === '\t' ? '<w:tab/>' : /\r?\n/.test(part) ? '<w:br/>' : '<w:t xml:space="preserve">' + xml(part) + '</w:t>').join('');
  }
  function paragraph(value, style = 'Normal') {
    return '<w:p><w:pPr><w:pStyle w:val="' + style + '"/></w:pPr><w:r>' + textRuns(value) + '</w:r></w:p>';
  }
  function dimensions(bytes, png) {
    let width = 0, height = 0;
    if (png && bytes.length >= 24) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      width = view.getUint32(16); height = view.getUint32(20);
    } else if (!png) {
      for (let offset = 2; offset + 8 < bytes.length;) {
        if (bytes[offset] !== 255) break;
        const marker = bytes[offset + 1];
        if (marker === 255) { offset++; continue; }
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
        const size = bytes[offset + 2] * 256 + bytes[offset + 3];
        if (size < 2 || offset + 2 + size > bytes.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          height = bytes[offset + 5] * 256 + bytes[offset + 6]; width = bytes[offset + 7] * 256 + bytes[offset + 8]; break;
        }
        offset += 2 + size;
      }
    }
    if (!width || !height || width > 4096 || height > 4096) throw Error('Les dimensions de la photo ne sont pas reconnues. Réimportez la photo dans le formulaire.');
    const scale = Math.min(914400 / width, 1143000 / height);
    return { cx: Math.round(width * scale), cy: Math.round(height * scale) };
  }
  function imageEntry(photo) {
    if (!photo) return null;
    if (typeof photo !== 'string' || photo.length > 100000 || !/^data:image\/(jpeg|png);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(photo)) throw Error('La photo du CV n’est pas valide. Retirez-la puis réessayez.');
    const png = photo.startsWith('data:image/png;'), content = atob(photo.slice(photo.indexOf(',') + 1));
    const bytes = Uint8Array.from(content, char => char.charCodeAt(0));
    if (png ? bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71 : bytes.length < 3 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw Error('La photo du CV n’est pas reconnue.');
    return { name: 'word/media/photo.' + (png ? 'png' : 'jpg'), extension: png ? 'png' : 'jpg', type: png ? 'image/png' : 'image/jpeg', bytes, ...dimensions(bytes, png) };
  }
  function create(fields) {
    for (const [key, maximum] of [['name', 120], ['title', 120], ['contact', 240], ['summary', 2000], ['experience', 6000], ['education', 3000], ['skills', 3000]]) {
      if (typeof fields[key] !== 'string' || fields[key].length > maximum) throw Error('Un champ du CV est absent ou dépasse sa limite.');
    }
    if (!fields.name.trim() || !fields.title.trim()) throw Error('Complétez le nom et le titre professionnel avant d’exporter le CV.');
    const legacyTemplate = { modern: 'signature', compact: 'elegance' };
    fields = { ...fields, template: legacyTemplate[fields.template] || fields.template };
    if (!['classic', 'elegance', 'prestige', 'signature'].includes(fields.template)) throw Error('Le modèle de CV n’est pas reconnu.');
    const palettes = { copper: 'A85D3A', jade: '147C75', plum: '754A7D', blue: '305E9C', gold: 'F5B800' };
    const color = palettes[fields.accent] || 'A85D3A';
    const compact = fields.template === 'elegance', split = fields.template === 'signature';
    const identityMark = ['initials', 'photo', 'none'].includes(fields.identityMark) ? fields.identityMark : (fields.photo ? 'photo' : 'initials');
    const image = identityMark === 'photo' ? imageEntry(fields.photo) : null;
    const fontName = fields.font === 'editorial' ? 'Georgia' : 'Aptos';
    let body = paragraph(fields.name.trim(), 'CandidateName') + paragraph(fields.title.trim(), 'CandidateTitle');
    if (identityMark === 'initials') body += paragraph(fields.name.trim().split(/\s+/u).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('fr-CH'), 'CandidateMark');
    if (fields.contact.trim()) body += paragraph(fields.contact.trim(), 'Contact');
    if (image) body += '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + image.cx + '" cy="' + image.cy + '"/><wp:docPr id="1" name="Photo du candidat"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Photo"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="photo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + image.cx + '" cy="' + image.cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    let mainSections = '', sideSections = '';
    for (const [key, label] of [['summary', 'Profil'], ['experience', 'Expériences'], ['education', 'Formation'], ['skills', 'Compétences et langues']]) {
      const value = fields[key].trim();
      if (!value) continue;
      let sectionBody = paragraph(label, 'SectionHeading');
      if (key === 'experience' || key === 'education') {
        for (const block of value.split(/\n\s*\n/)) {
          const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
          if (!lines.length) continue;
          sectionBody += paragraph(lines.shift(), 'EntryHeading');
          for (const line of lines) sectionBody += paragraph(line.replace(/^[•●\-*]\s*/, '• '), /^[•●\-*]/.test(line) ? 'EntryBullet' : 'EntryDetail');
        }
      } else if (key === 'skills') {
        for (const line of value.split(/\r?\n/).flatMap(item => item.split(/\s*[;|]\s*/)).map(item => item.trim()).filter(Boolean)) sectionBody += paragraph(line, 'EntryDetail');
      } else sectionBody += paragraph(value);
      if (split) {
        if (key === 'education' || key === 'skills') sideSections += sectionBody;
        else mainSections += sectionBody;
      } else body += sectionBody;
    }
    if (split && (mainSections || sideSections)) {
      const cell = (content, width, shade) => '<w:tc><w:tcPr><w:tcW w:w="' + width + '" w:type="dxa"/><w:shd w:fill="' + shade + '"/><w:tcMar><w:top w:w="140" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="140" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar></w:tcPr>' + (content || paragraph('', 'Normal')) + '</w:tc>';
      body += '<w:tbl><w:tblPr><w:tblW w:w="9706" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:bottom w:val="nil"/><w:left w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="6500"/><w:gridCol w:w="3206"/></w:tblGrid><w:tr>' + cell(mainSections, 6500, 'FFFFFF') + cell(sideSections, 3206, 'F1F5F9') + '</w:tr></w:tbl>';
    }
    const section = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1100" w:bottom="1000" w:left="1100" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr>';
    const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const styles = header + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + fontName + '" w:hAnsi="' + fontName + '"/><w:sz w:val="' + (compact ? '20' : '22') + '"/><w:lang w:val="fr-CH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="' + (compact ? '80' : '140') + '" w:line="260" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="CandidateName"><w:name w:val="Nom du candidat"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="' + color + '"/><w:sz w:val="40"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="CandidateTitle"><w:name w:val="Titre professionnel"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="CandidateMark"><w:name w:val="Initiales du candidat"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="' + color + '"/><w:sz w:val="30"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Contact"><w:name w:val="Coordonnées"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="52617A"/><w:sz w:val="20"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="SectionHeading"><w:name w:val="Titre de rubrique"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="' + color + '"/><w:sz w:val="24"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="EntryHeading"><w:name w:val="Fonction ou diplôme"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="140" w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="EntryDetail"><w:name w:val="Détail du parcours"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:color w:val="52617A"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="EntryBullet"><w:name w:val="Réalisation"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="300"/><w:spacing w:after="50"/></w:pPr></w:style></w:styles>';
    const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships', relation = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    const documents = [
      { name: '[Content_Types].xml', text: header + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + (image ? '<Default Extension="' + image.extension + '" ContentType="' + image.type + '"/>' : '') + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
      { name: '_rels/.rels', text: header + '<Relationships xmlns="' + relNs + '"><Relationship Id="document" Type="' + relation + 'officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/document.xml', text: header + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="' + relation.slice(0,-1) + '" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body + section + '</w:body></w:document>' },
      { name: 'word/styles.xml', text: styles },
      { name: 'word/_rels/document.xml.rels', text: header + '<Relationships xmlns="' + relNs + '"><Relationship Id="styles" Type="' + relation + 'styles" Target="styles.xml"/>' + (image ? '<Relationship Id="photo" Type="' + relation + 'image" Target="media/photo.' + image.extension + '"/>' : '') + '</Relationships>' }
    ];
    const entries = documents.map(item => ({ name: item.name, bytes: encoder.encode(item.text) }));
    if (image) entries.push({ name: image.name, bytes: image.bytes });
    return new Blob([window.CP_BACKUP.buildArchive(entries)], { type: mime });
  }
  window.CP_CV_WORD = Object.freeze({ create });
})();
