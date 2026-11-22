(() => {
  "use strict";
  const sections = { summary: "Profil", experience: "Expérience professionnelle", education: "Formation", skills: "Compétences" };
  const accents = { copper: ["#a85d3a", "#152f40", "#d9aa88"], jade: ["#147c75", "#103d43", "#a8d9d1"], plum: ["#754a7d", "#302942", "#d7bddb"], blue: ["#305e9c", "#1b3453", "#b7cde8"], gold: ["#f5b800", "#191919", "#fff0a6"] };
  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value != null) element.textContent = value;
    return element;
  }
  function lines(value) { return String(value || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean); }
  function renderEntries(value) {
    const wrap = node("div", "cv-entry-list");
    for (const block of String(value || "").trim().split(/\n\s*\n/).filter(Boolean)) {
      const row = lines(block);
      const entry = node("div", "cv-entry");
      const first = row.shift() || "";
      const matched = first.match(/^(.*?)\s*[·|]\s*((?:19|20)\d{2}.*|.*(?:présent|aujourd'hui).*)$/i);
      if (/^[•●\-*]/.test(first) || (first.length > 100 && !matched) || (!matched && row.length === 0 && first.includes(" "))) {
        entry.append(node("p", "cv-sheet-prose", [first, ...row].join("\n")));
        wrap.append(entry);
        continue;
      }
      const heading = node("div", "cv-entry-heading");
      heading.append(node("strong", "", matched ? matched[1] : first));
      if (matched) heading.append(node("span", "cv-entry-dates", matched[2]));
      entry.append(heading);
      if (row.length && !/^[•●\-*]/.test(row[0])) entry.append(node("div", "cv-entry-organization", row.shift()));
      const bullets = row.filter(item => /^[•●\-*]/.test(item));
      const prose = row.filter(item => !/^[•●\-*]/.test(item));
      if (prose.length) entry.append(node("p", "", prose.join("\n")));
      if (bullets.length) {
        const list = node("ul", "cv-entry-bullets");
        bullets.forEach(item => list.append(node("li", "", item.replace(/^[•●\-*]\s*/, ""))));
        entry.append(list);
      }
      wrap.append(entry);
    }
    return wrap;
  }
  function renderSkills(value) {
    const wrap = node("div", "cv-skill-list");
    lines(value).flatMap(line => line.split(/\s*[;|]\s*/)).filter(Boolean).forEach(item => wrap.append(node("span", "cv-skill", item)));
    return wrap;
  }
  function render(target, fields, options = {}) {
    const template = ["classic", "modern", "compact"].includes(fields.template) ? fields.template : "classic";
    const accent = accents[fields.accent] ? fields.accent : "copper";
    const paper = node("article", "cv-sheet cv-sheet-" + template + " cv-font-" + (fields.font === "sans" ? "sans" : "editorial"));
    paper.dataset.template = template;
    paper.style.setProperty("--cv-accent", accents[accent][0]);
    paper.style.setProperty("--cv-deep", accents[accent][1]);
    paper.style.setProperty("--cv-soft", accents[accent][2]);
    const head = node("header", "cv-sheet-head");
    const identity = node("div", "cv-sheet-identity");
    identity.append(node("h1", "", fields.name?.trim() || (options.placeholder ? "Votre nom" : "")));
    identity.append(node("p", "cv-sheet-role", fields.title?.trim() || (options.placeholder ? "Votre métier" : "")));
    head.append(identity);
    if (/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(fields.photo || "") && fields.photo.length < 100000) {
      const portrait = node("img", "cv-sheet-photo");
      portrait.alt = "Photo du candidat";
      portrait.src = fields.photo;
      head.append(portrait);
    }
    const contact = fields.contact?.trim();
    const contactBlock = contact ? node("div", "cv-sheet-contact") : null;
    if (contactBlock) lines(contact).forEach(item => contactBlock.append(node("span", "", item)));
    const content = node("div", "cv-sheet-content");
    const mainColumn = template === "modern" ? node("div", "cv-sheet-main") : null;
    const sideColumn = template === "modern" ? node("div", "cv-sheet-side") : null;
    for (const [key, label] of Object.entries(sections)) {
      const value = fields[key]?.trim();
      if (!value && !options.placeholder) continue;
      const section = node("section", "cv-sheet-section cv-sheet-" + key);
      section.append(node("h2", "", label));
      const sample = { summary: "Une présentation de votre parcours.", experience: "Votre poste · 2022–2026\nEntreprise, ville\n• Un résultat concret et mesurable.", education: "Votre diplôme · 2022\nÉtablissement", skills: "Une compétence\nUne langue" };
      const text = value || sample[key];
      section.append(key === "experience" || key === "education" ? renderEntries(text) : key === "skills" ? renderSkills(text) : node("p", "cv-sheet-prose", text));
      (template === "modern" ? (key === "education" || key === "skills" ? sideColumn : mainColumn) : content).append(section);
    }
    if (template === "modern") content.append(mainColumn, sideColumn);
    paper.append(head);
    if (contactBlock) paper.append(contactBlock);
    paper.append(content);
    target.replaceChildren(paper);
    return paper;
  }
  window.CP_CV_RENDER = Object.freeze({ render });
})();
