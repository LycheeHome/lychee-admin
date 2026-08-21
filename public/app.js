let deleteInFlight = false;

const portOwners = JSON.parse(document.getElementById("port-owners-data")?.textContent ?? "{}");

const confirmRemoveDialog = document.getElementById("confirm-remove-dialog");
const confirmRemoveDeleteFilesCheckbox = document.getElementById("confirm-remove-delete-files");

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

const removedHostname = new URLSearchParams(window.location.search).get("removed");
if (removedHostname) {
  showBanner(`Removed ${removedHostname}. Remember to remove the DNS record in Cloudflare manually.`, "success");
  history.replaceState(null, "", "/");
}

if (new URLSearchParams(window.location.search).has("created")) {
  history.replaceState(null, "", window.location.pathname);
}

document.getElementById("confirm-remove-submit")?.addEventListener("click", async (event) => {
  if (deleteInFlight) return;
  confirmRemoveDialog?.close();
  const hostname = event.currentTarget.dataset.hostname;
  if (!hostname) return;

  const deleteFilesChecked = confirmRemoveDeleteFilesCheckbox?.checked ?? false;

  deleteInFlight = true;
  showBanner(`Removing ${hostname}…`, "info");
  try {
    const response = await fetch(`/sites/${encodeURIComponent(hostname)}/delete`, {
      method: "POST",
      body: new URLSearchParams({ deleteFiles: deleteFilesChecked ? "on" : "" }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Failed to remove site");

    if (!result.needsFileConfirm) {
      window.location.href = `/?removed=${encodeURIComponent(hostname)}`;
      return;
    }

    // Site removal already succeeded at this point — files deletion is a
    // separate request specifically so a failure here can't be confused
    // with the (already-completed) config removal.
    const filesResponse = await fetch(`/sites/${encodeURIComponent(hostname)}/delete-files`, { method: "POST" });
    const filesResult = await filesResponse.json();
    if (!filesResponse.ok) {
      showBanner(`Removed ${hostname}, but failed to delete its files: ${filesResult.error ?? "unknown error"}`, "error");
      return;
    }
    window.location.href = `/?removed=${encodeURIComponent(hostname)}`;
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

const frameworkField = document.getElementById("framework-field");
const healthcheckFieldWrapper = document.getElementById("healthcheck-field-wrapper");

function syncFrameworkFields() {
  const isNextjs = frameworkField?.value === "nextjs";
  if (healthcheckFieldWrapper) healthcheckFieldWrapper.style.display = isNextjs ? "flex" : "none";
}

frameworkField?.addEventListener("change", syncFrameworkFields);
syncFrameworkFields();

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

const addSiteForm = document.getElementById("add-site-form");
const addSiteError = document.getElementById("add-site-error");
let addSiteInFlight = false;

addSiteForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (addSiteInFlight) return;

  const formData = new FormData(addSiteForm);
  const hostname = String(formData.get("hostname") ?? "").trim();
  const type = formData.get("type");
  const port = String(formData.get("port") ?? "").trim();
  const framework = String(formData.get("framework") ?? "").trim();
  const healthcheckPath = String(formData.get("healthcheckPath") ?? "").trim();

  addSiteInFlight = true;
  addSiteError?.classList.add("hidden");
  try {
    const response = await fetch("/sites", {
      method: "POST",
      body: new URLSearchParams({ hostname, type, port, framework, healthcheckPath }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Failed to add site");

    // Land on the new site's own page: its Manual steps already states the
    // DNS command permanently, and a full navigation leaves the rail's
    // switcher listing the site we just created.
    window.location.href = `/sites/${encodeURIComponent(result.hostname)}?created=1`;
    return;
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

document.querySelectorAll("[data-copy-target]").forEach((button) => {
  const idleIcon = button.querySelector('[data-copy-icon="idle"]');
  const copiedIcon = button.querySelector('[data-copy-icon="copied"]');
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.textContent ?? "");
      button.setAttribute("aria-label", "Copied!");
      idleIcon?.classList.add("hidden");
      copiedIcon?.classList.remove("hidden");
    } catch {
      // Insecure context (plain http over the LAN, which is how this app is
      // actually deployed — see CLAUDE.md) or clipboard permission denied.
      // navigator.clipboard is undefined outside secure contexts, so even
      // accessing .writeText throws synchronously; select the text so the
      // user can still copy it manually with Ctrl+C. No icon change here —
      // the selected/highlighted text is the real signal for this case.
      window.getSelection()?.selectAllChildren(target);
      button.setAttribute("aria-label", "Press Ctrl+C to copy");
    }
    setTimeout(() => {
      button.setAttribute("aria-label", "Copy to clipboard");
      idleIcon?.classList.remove("hidden");
      copiedIcon?.classList.add("hidden");
    }, 1500);
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
