let pendingDeleteForm = null;
const confirmRemoveDialog = document.getElementById("confirm-remove-dialog");
const confirmRemoveHostname = document.getElementById("confirm-remove-hostname");

document.querySelectorAll(".delete-form").forEach((form) => {
  const trigger = form.querySelector(".delete-trigger");
  trigger?.addEventListener("click", () => {
    pendingDeleteForm = form;
    const hostname = decodeURIComponent(form.getAttribute("action").split("/")[2]);
    if (confirmRemoveHostname) confirmRemoveHostname.textContent = hostname;
    confirmRemoveDialog?.showModal();
  });
});

document.getElementById("confirm-remove-submit")?.addEventListener("click", () => {
  confirmRemoveDialog?.close();
  pendingDeleteForm?.submit();
});

const typeInputs = document.querySelectorAll('input[name="type"]');
const portFieldWrapper = document.querySelector(".port-input");

function syncPortField() {
  const isProxy = document.querySelector('input[name="type"]:checked')?.value === "reverse-proxy";
  if (portFieldWrapper) portFieldWrapper.style.display = isProxy ? "flex" : "none";
}

typeInputs.forEach((input) => input.addEventListener("change", syncPortField));
syncPortField();

const portOwners = JSON.parse(document.getElementById("port-owners-data")?.textContent ?? "{}");
const portField = document.getElementById("port-field");
const portError = document.querySelector(".port-error");

function validatePortField() {
  if (!portField || !portError) return;
  const owner = portOwners[portField.value];
  if (owner) {
    portField.setCustomValidity(`Port ${portField.value} is already in use by ${owner}`);
    portError.textContent = `Already in use by ${owner}`;
    portError.classList.remove("hidden");
  } else {
    portField.setCustomValidity("");
    portError.classList.add("hidden");
  }
}

portField?.addEventListener("input", validatePortField);

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
