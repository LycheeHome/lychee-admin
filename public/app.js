document.querySelectorAll(".delete-form").forEach((form) => {
  form.addEventListener("submit", (event) => {
    const hostname = form.getAttribute("action").split("/")[2];
    if (!confirm(`Remove ${hostname}? This removes it from Caddy and the tunnel config immediately.`)) {
      event.preventDefault();
    }
  });
});

const typeInputs = document.querySelectorAll('input[name="type"]');
const portField = document.querySelector(".port-input");

function syncPortField() {
  const isProxy = document.querySelector('input[name="type"]:checked')?.value === "reverse-proxy";
  if (portField) portField.style.display = isProxy ? "flex" : "none";
}

typeInputs.forEach((input) => input.addEventListener("change", syncPortField));
syncPortField();

document.querySelectorAll("[data-open-dialog]").forEach((trigger) => {
  trigger.addEventListener("click", () => {
    document.getElementById(trigger.dataset.openDialog)?.showModal();
  });
});

document.querySelectorAll("[data-close-dialog]").forEach((trigger) => {
  trigger.addEventListener("click", () => {
    document.getElementById(trigger.dataset.closeDialog)?.close();
  });
});

document.querySelectorAll("dialog.modal").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) dialog.close();
  });
});
