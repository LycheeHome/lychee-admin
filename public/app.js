let pendingDeleteForm = null;
let pendingDeleteHostname = null;
let pendingDeleteCard = null;

const confirmRemoveDialog = document.getElementById("confirm-remove-dialog");
const confirmRemoveHostname = document.getElementById("confirm-remove-hostname");
const confirmDeleteFilesDialog = document.getElementById("confirm-delete-files-dialog");
const confirmDeleteFilesHostname = document.getElementById("confirm-delete-files-hostname");
const confirmDeleteFilesPath = document.getElementById("confirm-delete-files-path");

const flashBanner = document.getElementById("flash-banner");
const flashBannerMessage = document.getElementById("flash-banner-message");
const flashBannerClose = document.getElementById("flash-banner-close");
let flashBannerTimeout = null;

function showBanner(message, kind) {
  if (!flashBanner || !flashBannerMessage || !flashBannerClose) return;
  clearTimeout(flashBannerTimeout);
  flashBannerMessage.textContent = message;
  flashBanner.classList.remove("hidden", "bg-red-950/60", "border-red-400/70", "bg-rose-950/60", "border-rose-400/70");
  if (kind === "error") {
    flashBanner.classList.add("bg-red-950/60", "border-red-400/70");
    flashBannerClose.classList.remove("hidden");
  } else {
    flashBanner.classList.add("bg-rose-950/60", "border-rose-400/70");
    flashBannerClose.classList.add("hidden");
    flashBannerTimeout = setTimeout(hideBanner, 4000);
  }
}

function hideBanner() {
  clearTimeout(flashBannerTimeout);
  flashBanner?.classList.add("hidden");
}

flashBannerClose?.addEventListener("click", hideBanner);

function removeCard(card) {
  if (!card) return;
  const grid = card.closest(".sites-grid");
  card.remove();
  if (grid && !grid.querySelector("article")) {
    grid.innerHTML = `<p class="col-span-full text-stone-400 italic m-0">No sites configured yet.</p>`;
  }
}

document.querySelectorAll(".delete-form").forEach((form) => {
  const trigger = form.querySelector(".delete-trigger");
  trigger?.addEventListener("click", () => {
    pendingDeleteForm = form;
    const hostname = decodeURIComponent(form.getAttribute("action").split("/")[2]);
    if (confirmRemoveHostname) confirmRemoveHostname.textContent = hostname;
    confirmRemoveDialog?.showModal();
  });
});

document.getElementById("confirm-remove-submit")?.addEventListener("click", async () => {
  confirmRemoveDialog?.close();
  const form = pendingDeleteForm;
  pendingDeleteForm = null;
  if (!form) return;

  const hostname = decodeURIComponent(form.getAttribute("action").split("/")[2]);
  const deleteFilesChecked = form.querySelector('input[name="deleteFiles"]')?.checked ?? false;
  const card = form.closest("article");

  try {
    const response = await fetch(form.getAttribute("action"), {
      method: "POST",
      body: new URLSearchParams({ deleteFiles: deleteFilesChecked ? "on" : "" }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Failed to remove site");

    if (result.needsFileConfirm) {
      pendingDeleteHostname = hostname;
      pendingDeleteCard = card;
      if (confirmDeleteFilesHostname) confirmDeleteFilesHostname.textContent = hostname;
      if (confirmDeleteFilesPath) confirmDeleteFilesPath.textContent = result.sitePath ?? "";
      confirmDeleteFilesDialog?.showModal();
      return;
    }

    removeCard(card);
    showBanner(`Removed ${hostname}. Remember to remove the DNS record in Cloudflare manually.`, "success");
  } catch (error) {
    showBanner(error.message, "error");
  }
});

document.getElementById("confirm-delete-files-submit")?.addEventListener("click", async () => {
  confirmDeleteFilesDialog?.close();
  const hostname = pendingDeleteHostname;
  const card = pendingDeleteCard;
  pendingDeleteHostname = null;
  pendingDeleteCard = null;
  if (!hostname) return;

  try {
    const response = await fetch(`/sites/${encodeURIComponent(hostname)}/delete-files`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Failed to delete site files");

    removeCard(card);
    showBanner(`Deleted files for ${hostname}. Remember to remove the DNS record in Cloudflare manually.`, "success");
  } catch (error) {
    showBanner(error.message, "error");
  }
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
