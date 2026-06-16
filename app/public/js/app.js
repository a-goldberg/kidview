document.documentElement.classList.add("js-ready");

function setFormStatus(form, message, state) {
  const status = form.querySelector(".decision-status");

  if (!status) {
    return;
  }

  status.textContent = message;
  status.dataset.state = state;
}

async function submitDecisionForm(form, submitter) {
  const body = new URLSearchParams(new FormData(form));

  if (submitter && submitter.name) {
    body.set(submitter.name, submitter.value);
  }

  setFormStatus(form, "Saving...", "pending");

  const action =
    submitter && submitter.formAction ? submitter.formAction : form.action;
  const method =
    submitter && submitter.formMethod ? submitter.formMethod : form.method;

  const response = await fetch(action, {
    method: method || "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error("Decision request failed");
  }

  return response.json();
}

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-async-decision]");

  if (!form) {
    return;
  }

  event.preventDefault();

  const submitter = event.submitter;
  const buttons = form.querySelectorAll("button");
  buttons.forEach((button) => {
    button.disabled = true;
  });

  try {
    const result = await submitDecisionForm(form, submitter);
    const currentDecision = form.querySelector("[data-decision-current]");

    if (currentDecision && result.decision) {
      currentDecision.textContent = result.decisionLabel || result.decision;
    }

    setFormStatus(form, result.message || "Saved.", "saved");

    if (result.removeCard || form.dataset.removeOnSuccess === "true") {
      const card = form.closest("[data-decision-card]");
      if (card) {
        card.classList.add("is-resolved");
        window.setTimeout(() => {
          card.remove();
        }, 250);
      }
    }
  } catch (error) {
    setFormStatus(form, "Could not save. Try again.", "error");
    console.error(error);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-confirm]");

  if (!button) {
    return;
  }

  if (!window.confirm(button.dataset.confirm)) {
    event.preventDefault();
  }
});
