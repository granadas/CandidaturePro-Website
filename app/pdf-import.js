(() => {
  'use strict';
  let library;
  function loadLibrary() {
    if (!library) library = import('./vendor/pdfjs/pdf.min.mjs').then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
      return pdfjs;
    }).catch(error => { library = null; throw error; });
    return library;
  }
  async function extract(file, onProgress = () => {}, signal) {
    if (!file || file.size > 10 * 1024 * 1024 || !/\.pdf$/i.test(file.name)) throw Error('Choisissez un PDF de 10 Mo maximum.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw Error('Ce fichier n’est pas un PDF valide.');
    if (signal?.aborted) throw new DOMException('Lecture annulée.', 'AbortError');
    const pdfjs = await loadLibrary();
    if (signal?.aborted) throw new DOMException('Lecture annulée.', 'AbortError');
    const task = pdfjs.getDocument({ data: bytes, useWasm: false, disableFontFace: true, useSystemFonts: true,
      enableXfa: false, isEvalSupported: false, isImageDecoderSupported: false, verbosity: 0 });
    let rejectStop;
    const stopped = new Promise((_, reject) => { rejectStop = reject; });
    function stop(error) { rejectStop(error); void task.destroy().catch(() => {}); }
    const abort = () => stop(new DOMException('Lecture annulée.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(Error('La lecture prend trop de temps. Essayez un PDF plus simple.')), 30000);
    task.onPassword = () => stop(Error('Ce PDF est protégé par un mot de passe. Utilisez une copie déverrouillée.'));
    try {
      return await Promise.race([stopped, (async () => {
        const pdf = await task.promise;
        if (pdf.numPages > 20) throw Error('Le CV dépasse 20 pages. Utilisez une version plus courte.');
        const pages = []; let count = 0;
        for (let number = 1; number <= pdf.numPages; number++) {
          if (signal?.aborted) throw new DOMException('Lecture annulée.', 'AbortError');
          onProgress(number, pdf.numPages);
          const page = await pdf.getPage(number), content = await page.getTextContent();
          let text = '', lastY = null;
          for (const item of content.items) {
            if (typeof item.str !== 'string') continue;
            const y = item.transform?.[5];
            if (lastY !== null && Number.isFinite(y) && Math.abs(y - lastY) > 3 && text && !text.endsWith('\n')) text += '\n';
            if (text && !/[\s]$/.test(text)) text += ' ';
            text += item.str;
            if (item.hasEOL && !text.endsWith('\n')) text += '\n';
            lastY = y;
          }
          page.cleanup(); text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
          count += text.length;
          if (count > 30000) throw Error('Le texte du CV dépasse 30 000 caractères. Utilisez une version plus courte.');
          pages.push(text);
        }
        const text = pages.filter(Boolean).join('\n\n');
        if (text.replace(/\s/g, '').length < 20) throw Error('Aucun texte exploitable n’a été trouvé. Ce PDF semble être un scan : utilisez un PDF avec du texte sélectionnable ou saisissez le contenu manuellement.');
        return { text, pages: pdf.numPages };
      })()]);
    } catch (error) {
      if (error.name === 'InvalidPDFException') throw Error('Le PDF est incomplet ou endommagé.');
      throw error;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      await task.destroy().catch(() => {});
    }
  }
  window.CP_PDF = Object.freeze({ extract });
})();
