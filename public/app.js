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

// The server-rendered page notice (?created=1) is a different element: it sits
// in the content column and takes layout space, so dismissing it removes it
// rather than hiding it — there is nothing to bring back.
const pageNotice = document.getElementById("page-notice");
document.getElementById("page-notice-close")?.addEventListener("click", () => pageNotice?.remove());

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
    // DNS command permanently, and a full navigation leaves the breadcrumb
    // switcher listing the site we just created. addSiteInFlight is
    // deliberately left true here rather than reset in a `finally` — the
    // fetch already resolved, but window.location.href doesn't navigate
    // synchronously, so the form stays interactive and submittable until the
    // new document loads. Resetting the flag on this path reopened that
    // window: a second click before navigation lands would re-POST the same
    // hostname, which the server then rejects as a duplicate, on a page that
    // just succeeded. The pageshow listener below reopens the form for the one
    // case where this document does come back.
    window.location.href = `/sites/${encodeURIComponent(result.hostname)}?created=1`;
  } catch (error) {
    addSiteInFlight = false;
    if (addSiteError) {
      // Unhide before writing: role="alert" announces content changes inside a
      // visible region, and a display:none element is not exposed at all, so
      // filling it first and revealing it second can announce nothing.
      addSiteError.classList.remove("hidden");
      addSiteError.textContent = error.message;
    }
  }
});

// Back-navigation from the created site restores this page from the bfcache,
// which restores the JS heap along with the DOM — nothing here opts out of it
// (no Cache-Control: no-store). Without this the form would come back with
// addSiteInFlight still true from the submit that navigated away, and every
// later click would be swallowed by the guard above with no error shown.
// event.persisted is only true on a bfcache restore, so this cannot reopen the
// double-submit window on a live page.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) addSiteInFlight = false;
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

const copyStatus = document.getElementById("copy-status");

document.querySelectorAll("[data-copy-target]").forEach((button) => {
  const idleIcon = button.querySelector('[data-copy-icon="idle"]');
  const copiedIcon = button.querySelector('[data-copy-icon="copied"]');
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.textContent ?? "");
      button.setAttribute("aria-label", "Copied!");
      if (copyStatus) copyStatus.textContent = "Copied to clipboard";
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
      // The selection is the whole affordance in this branch, and a selection
      // is not something a screen reader announces on its own.
      if (copyStatus) copyStatus.textContent = "Text selected — press Ctrl+C to copy";
    }
    setTimeout(() => {
      button.setAttribute("aria-label", "Copy to clipboard");
      if (copyStatus) copyStatus.textContent = "";
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

const siteSwitcher = document.getElementById("hostname-switcher");

if (siteSwitcher) {
  const summary = siteSwitcher.querySelector("summary");
  const rows = () => Array.from(siteSwitcher.querySelectorAll("a"));

  const close = ({ refocus } = {}) => {
    siteSwitcher.open = false;
    if (refocus) summary?.focus();
  };

  // Not the bounding-rect check used for dialog.modal: that exists because a
  // <dialog>'s backdrop is part of the element. A dropdown has no backdrop,
  // so containment is both correct and simpler.
  document.addEventListener("click", (event) => {
    if (siteSwitcher.open && !siteSwitcher.contains(event.target)) close();
  });

  siteSwitcher.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close({ refocus: true });
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    event.preventDefault();
    if (!siteSwitcher.open) {
      siteSwitcher.open = true;
      rows()[0]?.focus();
      return;
    }
    const items = rows();
    const index = items.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    // From the summary (index -1), ArrowDown lands on the first row and
    // ArrowUp on the last.
    const next = index === -1 ? (step === 1 ? 0 : items.length - 1) : index + step;
    items[Math.max(0, Math.min(items.length - 1, next))]?.focus();
  });

  siteSwitcher.addEventListener("focusout", (event) => {
    if (!siteSwitcher.contains(event.relatedTarget)) close();
  });
}
