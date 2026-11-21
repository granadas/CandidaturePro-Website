(() => {
  "use strict";
  const sections = {
    summary: "Profil",
    experience: "Expériences",
    education: "Formation",
    skills: "Compétences et langues"
  };
  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value != null) element.textContent = value;
    return element;
  }
  function render(target, fields, options = {}) {
    const template = ["classic", "modern", "compact"].includes(fields.template) ? fields.template : "classic";
    const paper = node("article", "cv-sheet cv-sheet-" + template);
    paper.dataset.template = template;
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
    const contactBlock = contact ? node("p", "cv-sheet-contact", contact) : null;
    const content = node("div", "cv-sheet-content");
    for (const [key, label] of Object.entries(sections)) {
      const value = fields[key]?.trim();
      if (!value && !options.placeholder) continue;
      const section = node("section", "cv-sheet-section cv-sheet-" + key);
      section.append(node("h2", "", label), node("p", "", value || ({ summary: "Une présentation de votre parcours.", experience: "Vos réalisations professionnelles.", education: "Vos études et certifications.", skills: "Vos compétences et langues." }[key])));
      content.append(section);
    }
    paper.append(head);
    if (contactBlock) paper.append(contactBlock);
    paper.append(content);
    target.replaceChildren(paper);
    return paper;
  }
  window.CP_CV_RENDER = Object.freeze({ render });
})();
