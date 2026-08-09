let pendingDeleteForm = null;
let deleteInFlight = false;

const portOwners = JSON.parse(document.getElementById("port-owners-data")?.textContent ?? "{}");

const confirmRemoveDialog = document.getElementById("confirm-remove-dialog");
const confirmRemoveHostname = document.getElementById("confirm-remove-hostname");
const confirmRemoveDeleteFilesLabel = document.getElementById("confirm-remove-delete-files-label");
const confirmRemoveDeleteFilesCheckbox = document.getElementById("confirm-remove-delete-files");
const confirmRemovePath = document.getElementById("confirm-remove-path");

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
  } else if (kind === "info") {
    flashBanner.classList.add("bg-rose-950/60", "border-rose-400/70");
    flashBannerClose.classList.add("hidden");
    // No auto-dismiss: the caller replaces this banner with a terminal
    // success/error banner once the in-flight operation resolves.
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

function removeCard(card, hostname) {
  if (hostname) {
    for (const [port, owner] of Object.entries(portOwners)) {
      if (owner === hostname) delete portOwners[port];
    }
  }
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

    const isStatic = trigger.dataset.siteType === "static";
    confirmRemoveDeleteFilesLabel?.classList.toggle("hidden", !isStatic);
    if (confirmRemoveDeleteFilesCheckbox) confirmRemoveDeleteFilesCheckbox.checked = false;
    if (confirmRemovePath) confirmRemovePath.textContent = trigger.dataset.sitePath ?? "";

    confirmRemoveDialog?.showModal();
  });
});

document.getElementById("confirm-remove-submit")?.addEventListener("click", async () => {
  if (deleteInFlight) return;
  confirmRemoveDialog?.close();
  const form = pendingDeleteForm;
  pendingDeleteForm = null;
  if (!form) return;

  const hostname = decodeURIComponent(form.getAttribute("action").split("/")[2]);
  const deleteFilesChecked = confirmRemoveDeleteFilesCheckbox?.checked ?? false;
  const card = form.closest("article");

  deleteInFlight = true;
  showBanner(`Removing ${hostname}…`, "info");
  try {
    const response = await fetch(form.getAttribute("action"), {
      method: "POST",
      body: new URLSearchParams({ deleteFiles: deleteFilesChecked ? "on" : "" }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Failed to remove site");

    if (!result.needsFileConfirm) {
      removeCard(card, hostname);
      showBanner(`Removed ${hostname}. Remember to remove the DNS record in Cloudflare manually.`, "success");
      return;
    }

    // Site removal already succeeded at this point, so the card comes out
    // of the DOM regardless of whether the follow-up file deletion below
    // succeeds — it's a separate request specifically so a failure here
    // can't be confused with the (already-completed) config removal.
    const filesResponse = await fetch(`/sites/${encodeURIComponent(hostname)}/delete-files`, { method: "POST" });
    const filesResult = await filesResponse.json();
    removeCard(card, hostname);
    if (!filesResponse.ok) {
      showBanner(`Removed ${hostname}, but failed to delete its files: ${filesResult.error ?? "unknown error"}`, "error");
      return;
    }
    showBanner(`Removed ${hostname} and deleted its files. Remember to remove the DNS record in Cloudflare manually.`, "success");
  } catch (error) {
    showBanner(error.message, "error");
  } finally {
    deleteInFlight = false;
  }
});

const typeInputs = document.querySelectorAll('input[name="type"]');
const portFieldWrapper = document.querySelector(".port-input");
const portField = document.getElementById("port-field");
const portError = document.querySelector(".port-error");

function syncPortField() {
  const isProxy = document.querySelector('input[name="type"]:checked')?.value === "reverse-proxy";
  if (portFieldWrapper) portFieldWrapper.style.display = isProxy ? "flex" : "none";
  if (portField) portField.required = isProxy;
}

typeInputs.forEach((input) => input.addEventListener("change", syncPortField));
syncPortField();

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
