(() => {
  const form = document.querySelector("#cv-form");
  const nav = document.querySelector(".cv-studio-nav");
  if (!form || !nav) return;
  const ids = ["cv-models", "cv-identity", "cv-story", "cv-finish"];
  const labels = ["Modèle", "Identité", "Parcours", "Finaliser"];
  const headings = ids.map(id => document.getElementById(id));
  if (headings.some(item => !item)) return;
  const sections = headings.map((heading, index) => {
    const elements = [];
    let element = heading;
    while (element && (index === ids.length - 1 || element !== headings[index + 1])) {
      elements.push(element);
      element = element.nextElementSibling;
    }
    return elements;
  });
  const layout = form.closest(".cv-studio-layout");
  const preview = layout?.querySelector(".cv-live-aside");
  const previewToggle = document.createElement("button");
  previewToggle.type = "button";
  previewToggle.className = "cv-mobile-preview-toggle secondary";
  previewToggle.textContent = "Voir l’aperçu de mon CV";
  previewToggle.setAttribute("aria-expanded", "false");
  if (preview) {
    preview.id ||= "cv-live-preview";
    previewToggle.setAttribute("aria-controls", preview.id);
    form.before(previewToggle);
    previewToggle.addEventListener("click", () => {
      const expanded = previewToggle.getAttribute("aria-expanded") !== "true";
      previewToggle.setAttribute("aria-expanded", String(expanded));
      previewToggle.textContent = expanded ? "Masquer l’aperçu" : "Voir l’aperçu de mon CV";
      layout?.classList.toggle("cv-preview-expanded", expanded);
      if (expanded) {
        preview.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start"
        });
      } else {
        previewToggle.focus({ preventScroll: true });
      }
    });
  }
  const buttons = Array.from(nav.querySelectorAll('a[href^="#cv-"]'));
  let active = 0;
  const descriptions = [
    "Choisissez la présentation qui vous correspond.",
    "Ajoutez vos coordonnées et votre photo si vous le souhaitez.",
    "Présentez vos expériences, formations et compétences.",
    "Relisez votre CV et enregistrez-le avant l’export PDF."
  ];
  const progress = document.createElement("div");
  progress.className = "cv-wizard-progress";
  progress.setAttribute("role", "status");
  progress.setAttribute("aria-live", "polite");
  progress.innerHTML = '<div class="cv-wizard-progress-top"><strong></strong><span></span></div><div class="cv-wizard-progress-track"><div class="cv-wizard-progress-fill"></div></div><p class="cv-wizard-progress-description"></p>';
  // Keep the two-column studio grid reserved for the form and live preview.
  (layout || form).before(progress);
  const progressLabel = progress.querySelector("strong");
  const progressCount = progress.querySelector(".cv-wizard-progress-top span");
  const progressFill = progress.querySelector(".cv-wizard-progress-fill");
  const progressDescription = progress.querySelector(".cv-wizard-progress-description");
  function firstInvalidInStep(index) {
    for (const element of sections[index]) {
      const fields = element.matches("input, select, textarea")
        ? [element] : Array.from(element.querySelectorAll("input, select, textarea"));
      const invalid = fields.find(field => field.willValidate && !field.checkValidity());
      if (invalid) return invalid;
    }
    return null;
  }
  function canNavigateTo(target) {
    if (target <= active) return true;
    for (let step = 0; step < target; step++) {
      const invalid = firstInvalidInStep(step);
      if (invalid) {
        show(step);
        invalid.reportValidity();
        return false;
      }
    }
    return true;
  }
  const controls = sections.map((elements, index) => {
    const bar = document.createElement("div");
    bar.className = "wide cv-step-controls";
    if (index > 0) {
      const back = document.createElement("button");
      back.type = "button"; back.className = "secondary";
      back.textContent = "← Retour";
      back.addEventListener("click", () => show(index - 1));
      bar.append(back);
    }
    if (index < sections.length - 1) {
      const next = document.createElement("button");
      next.type = "button"; next.className = "primary";
      next.textContent = "Continuer : " + labels[index + 1] + " →";
      next.addEventListener("click", () => {
        if (!canNavigateTo(index + 1)) return;
        show(index + 1);
      });
      bar.append(next);
    }
    elements[elements.length - 1].after(bar);
    return bar;
  });
  function show(index, scroll = true) {
    if (index < 0 || index >= sections.length) return;
    active = index;
    if (layout) {
      layout.dataset.cvStep = String(index + 1);
      layout.classList.remove("cv-preview-expanded");
      previewToggle.setAttribute("aria-expanded", "false");
      previewToggle.textContent = "Voir l’aperçu de mon CV";
    }
    sections.forEach((elements, step) => {
      for (const element of elements) element.hidden = step !== index;
      controls[step].hidden = step !== index;
    });
    progressLabel.textContent = labels[index];
    progressCount.textContent = "Étape " + (index + 1) + " sur " + sections.length;
    progressFill.style.width = ((index + 1) / sections.length * 100) + "%";
    progressDescription.textContent = descriptions[index];
    buttons.forEach((button, step) => {
      button.setAttribute("aria-current", step === index ? "step" : "false");
      button.classList.toggle("active", step === index);
      button.replaceChildren();
      const number = document.createElement("span");
      number.className = "cv-wizard-nav-number";
      number.textContent = step < index ? "✓" : String(step + 1);
      number.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.textContent = labels[step];
      button.append(number, name);
    });
    if (scroll) {
      // Announce the new section to keyboard and screen-reader users.
      // preventScroll keeps focus from fighting the intended scroll position.
      headings[index].setAttribute("tabindex", "-1");
      headings[index].focus({ preventScroll: true });
      headings[index].scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
    }
  }
  buttons.forEach((button, index) => button.addEventListener("click", event => {
    event.preventDefault();
    if (canNavigateTo(index)) show(index);
  }));
  // Reveal the first invalid step before the browser tries to focus a hidden field.
  // This also covers users who jump directly to Finaliser using the step navigation.
  form.querySelectorAll('button[type="submit"], input[type="submit"]').forEach(submit => {
    submit.addEventListener("click", event => {
      const invalid = Array.from(form.elements).find(field =>
        field.willValidate && !field.checkValidity()
      );
      if (!invalid) return;
      event.preventDefault();
      const step = sections.findIndex(elements =>
        elements.some(element => element === invalid || element.contains(invalid))
      );
      if (step >= 0) show(step);
      invalid.reportValidity();
    });
  });
  form.addEventListener("invalid", event => {
    const step = sections.findIndex(elements => elements.some(element => element === event.target || element.contains(event.target)));
    if (step >= 0 && step !== active) show(step);
  }, true);
  show(0, false);
})();
