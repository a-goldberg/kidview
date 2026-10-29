(() => {
  const selector = document.querySelector("[data-model-selector]");
  if (!selector) return;

  const key = "kidview:model-comparison:selected-models";
  const choices = [...selector.querySelectorAll('input[name="models"]')];
  const message = selector.querySelector("[data-selection-message]");
  const summary = selector.querySelector("[data-model-summary]");
  const submit = selector.closest("form").querySelector('button[type="submit"]');

  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (Array.isArray(saved) && saved.length >= 1 && saved.length <= 3 &&
        new Set(saved).size === saved.length && saved.every((id) => choices.some((choice) => choice.value === id))) {
      choices.forEach((choice) => { choice.checked = saved.includes(choice.value); });
    }
  } catch { /* Browser storage may be disabled; form defaults still work. */ }

  function update() {
    const selected = choices.filter((choice) => choice.checked).map((choice) => choice.value);
    choices.forEach((choice) => { choice.disabled = selected.length >= 3 && !choice.checked; });
    submit.disabled = selected.length === 0;
    summary.textContent = `Models: ${selected.length} selected`;
    message.textContent = selected.length === 0 ? "Choose at least one model." : `${selected.length} of 3 selected`;
    try { sessionStorage.setItem(key, JSON.stringify(selected)); } catch { /* Keep working without storage. */ }
  }

  choices.forEach((choice) => choice.addEventListener("change", () => {
    if (!choices.some((item) => item.checked)) choice.checked = true;
    update();
  }));
  update();
})();
