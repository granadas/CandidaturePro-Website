"use strict";
// Progressive enhancement: the existing Documents panels and app handlers stay mounted.
(() => {
  const root = document.querySelector("#documents-view");
  if (!root) return;
  const tabs = [...root.querySelectorAll("[data-documents-tab]")];
  const panels = [...root.querySelectorAll("[data-documents-panel]")];
  const hint = root.querySelector("#documents-switch-hint");
  const descriptions = {
    cv: "Créez un CV ou modifiez un CV déjà enregistré.",
    analysis: "Consultez les conseils pour améliorer votre CV.",
    files: "Retrouvez vos documents PDF enregistrés."
  };
  const known = new Set(Object.keys(descriptions));
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  function selectDocumentTab(key, moveFocus = false) {
    if (!known.has(key)) return;
    tabs.forEach(tab => {
      const active = tab.dataset.documentsTab === key;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
      if (moveFocus && active) tab.focus();
    });
    panels.forEach(panel => {
      const active = panel.dataset.documentsPanel === key;
      panel.hidden = !active;
      panel.classList.remove("documents-panel-enter");
      if (active && !prefersReducedMotion.matches) {
        // Restart the entry animation only for the newly selected panel.
        void panel.offsetWidth;
        panel.classList.add("documents-panel-enter");
      }
    });
    if (hint) hint.textContent = descriptions[key];
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectDocumentTab(tab.dataset.documentsTab));
    tab.addEventListener("keydown", event => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      selectDocumentTab(tabs[next].dataset.documentsTab, true);
    });
  });
})();
