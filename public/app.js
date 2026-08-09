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
  } else if (kind === "persistent") {
    flashBanner.classList.add("bg-rose-950/60", "border-rose-400/70");
    flashBannerClose.classList.remove("hidden");
    // No auto-dismiss: stays until the user dismisses it themselves.
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

function wireDeleteForms() {
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
}

wireDeleteForms();

// After adding a site, the freshly rendered card comes from the server
// (not hand-built here) so it can never drift from the real template —
// re-fetch the list and swap in just the grid, then re-wire the new cards.
async function refreshSitesGrid() {
  const response = await fetch("/");
  const html = await response.text();
  const newGrid = new DOMParser().parseFromString(html, "text/html").querySelector(".sites-grid");
  const currentGrid = document.querySelector(".sites-grid");
  if (!newGrid || !currentGrid) return;
  currentGrid.innerHTML = newGrid.innerHTML;
  wireDeleteForms();
}

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

const addSiteDialog = document.getElementById("add-site-dialog");
const addSiteForm = document.getElementById("add-site-form");
const addSiteError = document.getElementById("add-site-error");
let addSiteInFlight = false;

// Fires on every close (Cancel, backdrop click, Esc, or our own .close()
// after a successful add) so the dialog always starts fresh next time.
addSiteDialog?.addEventListener("close", () => {
  addSiteError?.classList.add("hidden");
  addSiteForm?.reset();
  syncPortField();
  validatePortField();
});

addSiteForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (addSiteInFlight) return;

  const formData = new FormData(addSiteForm);
  const hostname = String(formData.get("hostname") ?? "").trim();
  const type = formData.get("type");
  const port = String(formData.get("port") ?? "").trim();

  addSiteInFlight = true;
  addSiteError?.classList.add("hidden");
  try {
    const response = await fetch("/sites", {
      method: "POST",
      body: new URLSearchParams({ hostname, type, port }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Failed to add site");

    addSiteDialog?.close();
    await refreshSitesGrid();
    if (result.type === "reverse-proxy") portOwners[result.target] = result.hostname;
    showBanner(
      `Added ${result.hostname}. Don't forget to add the DNS record: cloudflared tunnel route dns ${result.tunnelId} ${result.hostname}`,
      "persistent",
    );
  } catch (error) {
    if (addSiteError) {
      addSiteError.textContent = error.message;
      addSiteError.classList.remove("hidden");
    }
  } finally {
    addSiteInFlight = false;
  }
});

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
