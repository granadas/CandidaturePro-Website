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
  const buttons = Array.from(nav.querySelectorAll('a[href^="#cv-"]'));
  let active = 0;
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
      next.addEventListener("click", () => show(index + 1));
      bar.append(next);
    }
    elements[elements.length - 1].after(bar);
    return bar;
  });
  function show(index) {
    if (index < 0 || index >= sections.length) return;
    active = index;
    sections.forEach((elements, step) => {
      for (const element of elements) element.hidden = step !== index;
      controls[step].hidden = step !== index;
    });
    buttons.forEach((button, step) => {
      button.setAttribute("aria-current", step === index ? "step" : "false");
      button.classList.toggle("active", step === index);
      button.textContent = (step + 1) + ". " + labels[step];
    });
    headings[index].scrollIntoView({ behavior: "smooth", block: "start" });
  }
  buttons.forEach((button, index) => button.addEventListener("click", event => {
    event.preventDefault();
    show(index);
  }));
  form.addEventListener("invalid", event => {
    const step = sections.findIndex(elements => elements.some(element => element === event.target || element.contains(event.target)));
    if (step >= 0 && step !== active) show(step);
  }, true);
  show(0);
})();
