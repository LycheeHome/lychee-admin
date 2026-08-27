let deleteInFlight = false;
// Once true, the confirm button stays disabled for the rest of this page
// load — see setRemoveBusy's keepSubmitDisabled param and isRemovalSettled
// below. A removal that's reached this point has an accurate report on
// screen (steps ok through caddy or cloudflared, or removed:true); retrying
// it would call caddyfile.removeSite on a hostname that's already gone,
// which throws "No Caddyfile block found" and overwrites that report with a
// misleading one.
let removalSettled = false;

const portOwners = JSON.parse(document.getElementById("port-owners-data")?.textContent ?? "{}");

const confirmRemoveDialog = document.getElementById("confirm-remove-dialog");
const confirmRemoveDeleteFilesCheckbox = document.getElementById("confirm-remove-delete-files");

const flashBanner = document.getElementById("flash-banner");
const flashBannerMessage = document.getElementById("flash-banner-message");
const flashBannerProgress = document.getElementById("flash-banner-progress");
const flashBannerClose = document.getElementById("flash-banner-close");
let flashBannerTimeout = null;

function showBanner(message, kind) {
  if (!flashBanner || !flashBannerMessage || !flashBannerClose) return;
  clearTimeout(flashBannerTimeout);
  flashBanner.classList.remove("hidden", "bg-red-950/60", "border-red-400/70", "bg-rose-950", "border-rose-400/70");
  // Only the "info" tone is ever in-flight (see the add form's submit
  // handler, the one caller today) — the pulsing dot says "still working",
  // which is never true of a terminal error or success state.
  flashBannerProgress?.classList.toggle("hidden", kind !== "info");
  if (kind === "error") {
    flashBanner.classList.add("bg-red-950/60", "border-red-400/70");
    flashBannerClose.classList.remove("hidden");
  } else if (kind === "info") {
    flashBanner.classList.add("bg-rose-950", "border-rose-400/70");
    flashBannerClose.classList.add("hidden");
    // No auto-dismiss: the caller replaces this banner with a terminal
    // success/error banner once the in-flight operation resolves.
  } else {
    flashBanner.classList.add("bg-rose-950", "border-rose-400/70");
    flashBannerClose.classList.add("hidden");
    flashBannerTimeout = setTimeout(hideBanner, 4000);
  }
  // Written last, after the region is visible and toned: a mutation inside a
  // display:none subtree is not announced, and revealing an element that
  // already holds its text generally isn't either — the same ordering
  // #port-error, #add-site-error and #confirm-remove-outcome all use.
  flashBannerMessage.textContent = message;
}

function hideBanner() {
  clearTimeout(flashBannerTimeout);
  flashBanner?.classList.add("hidden");
  flashBannerProgress?.classList.add("hidden");
}

flashBannerClose?.addEventListener("click", hideBanner);

// The server-rendered page notice (?created=1) is a different element: it sits
// in the content column and takes layout space, so dismissing it removes it
// rather than hiding it — there is nothing to bring back.
const pageNotice = document.getElementById("page-notice");
document.getElementById("page-notice-close")?.addEventListener("click", () => pageNotice?.remove());

// The DNS reminder itself is server-rendered as #page-notice now (see
// renderSiteList in src/views/html.ts) — this just strips the query param so
// a refresh doesn't re-trigger anything and the URL doesn't linger dirty.
if (new URLSearchParams(window.location.search).has("removed")) {
  history.replaceState(null, "", window.location.pathname);
}

if (new URLSearchParams(window.location.search).has("created")) {
  history.replaceState(null, "", window.location.pathname);
}

const STEP_MARKS = { ok: "✓", failed: "✗", skipped: "—", "not-run": "·" };
const STEP_MARK_CLASSES = {
  ok: "text-green-300",
  failed: "text-red-300",
  skipped: "text-stone-400",
  "not-run": "text-stone-400",
};

// Takes the list id (rather than hard-coding the remove dialog's) so the
// add-site form's own step list can reuse this unchanged.
function markSteps(listId, steps) {
  for (const step of steps ?? []) {
    const row = document.querySelector(`#${listId} [data-step-id="${step.id}"]`);
    const mark = row?.querySelector(".step-mark");
    if (!mark) continue;
    mark.textContent = STEP_MARKS[step.status] ?? "";
    mark.className = `step-mark ml-auto shrink-0 ${STEP_MARK_CLASSES[step.status] ?? ""}`;
  }
}

function resetSteps(listId) {
  document.querySelectorAll(`#${listId} .step-mark`).forEach((mark) => {
    mark.textContent = "";
    mark.className = "step-mark ml-auto shrink-0";
  });
}

// Disables both dialog buttons and flags the dialog busy for assistive tech.
// Deliberately does not touch either button's contents: the submit button
// renders an icon plus the hostname (see html.ts), so overwriting
// textContent here would destroy the icon irrecoverably, and restoring it
// from the button's own (already-overwritten) textContent afterward would
// leave the label frozen at "Removing…" forever. Progress and outcome text
// live in #confirm-remove-outcome instead.
//
// keepSubmitDisabled is separate from busy: once a removal has settled (see
// isRemovalSettled), the confirm button must stay disabled even after the
// in-flight request resolves and busy goes back to false, while Cancel stays
// usable so the operator can still dismiss the dialog.
function setRemoveBusy(busy, keepSubmitDisabled = false) {
  const submit = document.getElementById("confirm-remove-submit");
  const cancel = document.querySelector('[data-close-dialog="confirm-remove-dialog"]');
  if (submit) submit.disabled = busy || keepSubmitDisabled;
  if (cancel) cancel.disabled = busy;
  confirmRemoveDialog?.setAttribute("aria-busy", busy ? "true" : "false");
}

// True once retrying would risk destroying the only record of a partially-
// or fully-completed removal: the config removal itself succeeded
// (`removed: true`), or the caddy/cloudflared steps — which only ever run
// once Caddy has actually reloaded — reported "ok". A failure at or before
// the caddy step, by contrast, is always rolled back server-side (see
// hostStateMessage), so retrying from there is still safe.
function isRemovalSettled(result) {
  if (result?.removed) return true;
  return (result?.steps ?? []).some(
    (step) => (step.id === "caddy" || step.id === "cloudflared") && step.status === "ok",
  );
}

const OUTCOME_NEUTRAL_CLASSES = ["text-stone-400"];
const OUTCOME_ERROR_CLASSES = [
  "text-red-300",
  "bg-red-950/40",
  "border",
  "border-red-800/50",
  "rounded-md",
  "px-2.5",
  "py-2",
];

// The outcome region is a progress surface first (plain muted text while a
// step is running) and becomes a failure surface only once a failure
// actually lands — never styled red for an in-flight or successful removal.
//
// The message text lives in a nested span (#confirm-remove-outcome-text)
// rather than directly in #confirm-remove-outcome, because the pulsing
// progress dot is a sibling of that span: overwriting the parent's
// textContent on every call would delete the dot the next time this runs.
// The dot itself only ever shows for the in-flight (non-error) message —
// "still working" is never true once a failure has actually landed.
function setOutcome(message, isError) {
  const outcome = document.getElementById("confirm-remove-outcome");
  const outcomeText = document.getElementById("confirm-remove-outcome-text");
  const progress = document.getElementById("confirm-remove-progress");
  if (!outcome || !outcomeText) return;
  outcome.classList.remove(...OUTCOME_NEUTRAL_CLASSES, ...OUTCOME_ERROR_CLASSES);
  if (!message) {
    outcomeText.textContent = "";
    outcome.classList.add("hidden");
    progress?.classList.add("hidden");
    return;
  }
  // Unhide and set tone before writing text: a mutation inside a
  // display:none subtree is not announced, and revealing an element that
  // already holds its text generally isn't either — see the same fix
  // beside #port-error and #add-site-error.
  outcome.classList.remove("hidden");
  outcome.classList.add(...(isError ? OUTCOME_ERROR_CLASSES : OUTCOME_NEUTRAL_CLASSES));
  progress?.classList.toggle("hidden", isError);
  outcomeText.textContent = message;
}

// Describes what actually happened on the host for a failed /delete call.
// Mirrors src/routes/sites.ts's own logic rather than assuming every
// non-rolled-back failure means Caddy already reloaded: if the rollback
// attempt itself failed, result.error already explains that in full (and
// where the backups are), and appending "Caddy had already reloaded" on top
// would misstate what happened, since in that branch Caddy never reloaded.
function hostStateMessage(result) {
  if (result.rolledBack) {
    return "The original Caddyfile and tunnel config were restored.";
  }
  const caddyStep = (result.steps ?? []).find((step) => step.id === "caddy");
  if (caddyStep?.status === "ok") {
    return "Caddy had already reloaded, so the edited config is live and was left in place.";
  }
  return "";
}

// Escape fires "cancel" before "close" on a <dialog>; block it while a
// delete is in flight for the same reason the outside-click handler below
// does — the dialog is the only place the outcome is shown, so dismissing
// it mid-mutation would discard the result the operator is waiting on.
confirmRemoveDialog?.addEventListener("cancel", (event) => {
  if (deleteInFlight) event.preventDefault();
});

document.getElementById("confirm-remove-submit")?.addEventListener("click", async (event) => {
  if (deleteInFlight || removalSettled) return;
  const hostname = event.currentTarget.dataset.hostname;
  if (!hostname) return;

  const deleteFilesChecked = confirmRemoveDeleteFilesCheckbox?.checked ?? false;

  deleteInFlight = true;
  setRemoveBusy(true);
  resetSteps("confirm-remove-steps");
  setOutcome(`Removing ${hostname}…`, false);
  try {
    const response = await fetch(`/sites/${encodeURIComponent(hostname)}/delete`, {
      method: "POST",
      body: new URLSearchParams({ deleteFiles: deleteFilesChecked ? "on" : "" }),
    });
    const result = await response.json();
    markSteps("confirm-remove-steps", result.steps);
    if (isRemovalSettled(result)) removalSettled = true;

    if (!response.ok) {
      // The dialog stays open: it stated the four steps, so it is where the
      // outcome belongs.
      const state = hostStateMessage(result);
      const message = state
        ? `${result.error ?? "Failed to remove site"}\n\n${state}`
        : (result.error ?? "Failed to remove site");
      setOutcome(message, true);
      return;
    }

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
      setOutcome(
        `Removed ${hostname} from Caddy and the sites tunnel, but deleting its files failed:\n${filesResult.error ?? "unknown error"}\n\nThe site is no longer served. Its files are still on disk.`,
        true,
      );
      return;
    }
    window.location.href = `/?removed=${encodeURIComponent(hostname)}`;
  } catch (error) {
    setOutcome(error.message, true);
  } finally {
    deleteInFlight = false;
    setRemoveBusy(false, removalSettled);
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
    // Unhide before writing: a mutation inside a display:none subtree is not
    // announced, and revealing an element that already holds its text
    // generally isn't either — see the same fix beside #add-site-error.
    portError.classList.remove("hidden");
    portError.textContent = `Already in use by ${owner}`;
  } else {
    portField.setCustomValidity("");
    portError.classList.add("hidden");
    portError.textContent = "";
  }
}

portField?.addEventListener("input", validatePortField);

const addSiteForm = document.getElementById("add-site-form");

// --- Add-site preview -----------------------------------------------------
// Fetches what POST /sites would write and renders it beside the form. The
// endpoint calls the same appendSite/addIngressRule the submit does, so this
// panel cannot describe an edit that differs from the one performed.

const composedHostname = document.getElementById("composed-hostname");
const previewBody = document.getElementById("preview-body");
const previewError = document.getElementById("preview-error");
const previewDomain = composedHostname?.dataset.domain ?? "";

// Responses can land out of order — a slow early request must never overwrite
// a fast later one. Only the newest sequence number is allowed to render.
let previewSequence = 0;
let previewTimer;

function composeHostname(label) {
  const trimmed = label.trim().replace(/\.+$/, "");
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const domainLower = previewDomain.toLowerCase();
  return lower === domainLower || lower.endsWith(`.${domainLower}`) ? trimmed : `${trimmed}.${previewDomain}`;
}

function renderComposedHostname(hostname) {
  if (!composedHostname) return;
  if (!hostname) {
    composedHostname.textContent = "Add a site";
    return;
  }
  const suffix = `.${previewDomain}`;
  if (hostname.toLowerCase().endsWith(suffix.toLowerCase()) && hostname.length > suffix.length) {
    const label = hostname.slice(0, hostname.length - suffix.length);
    composedHostname.textContent = "";
    composedHostname.append(label);
    const dim = document.createElement("span");
    dim.className = "text-stone-600";
    dim.textContent = hostname.slice(hostname.length - suffix.length);
    composedHostname.append(dim);
    return;
  }
  composedHostname.textContent = hostname;
}

function previewLines(lines, className) {
  const pre = document.createElement("pre");
  pre.className = `font-mono text-[0.72rem] leading-[1.55] text-stone-50 bg-stone-900 border border-stone-700 rounded-md p-2.5 m-0 overflow-x-auto whitespace-pre [tab-size:4] ${className ?? ""}`;
  pre.textContent = lines.join("\n");
  return pre;
}

function previewSection(pathText, lines, contextAfter) {
  const section = document.createElement("div");
  section.className = "flex flex-col gap-1.5";

  const label = document.createElement("p");
  label.className = "font-mono text-[0.6875rem] font-medium tracking-[0.02em] text-stone-400 m-0 break-all";
  label.textContent = pathText;
  section.append(label);

  const body = lines.slice();
  if (contextAfter) body.push(contextAfter);
  const pre = previewLines(body);
  // Everything but the trailing context line is an addition. Colouring rather
  // than prefixing with "+" keeps a YAML list dash from reading as a deletion.
  if (contextAfter) {
    pre.textContent = "";
    const added = document.createElement("span");
    added.className = "text-green-300";
    added.textContent = `${lines.join("\n")}\n`;
    const context = document.createElement("span");
    context.className = "text-stone-600";
    context.textContent = contextAfter;
    pre.append(added, context);
  } else {
    pre.className += " text-green-300";
  }
  section.append(pre);
  return section;
}

function markSkips(listId, steps) {
  for (const step of steps ?? []) {
    const row = document.querySelector(`#${listId} [data-step-id="${step.id}"]`);
    const mark = row?.querySelector(".step-mark");
    if (!mark) continue;
    mark.textContent = step.willRun ? "" : STEP_MARKS.skipped;
    mark.className = `step-mark ml-auto shrink-0 ${step.willRun ? "" : STEP_MARK_CLASSES.skipped}`;
  }
}

function renderPreviewEmpty(message) {
  if (!previewBody) return;
  previewBody.textContent = "";
  const line = document.createElement("p");
  line.className = "text-stone-400 text-[0.8rem] leading-snug m-0";
  line.textContent = message;
  previewBody.append(line);
  markSkips("add-site-steps", []);
  resetSteps("add-site-steps");
}

function renderPreview(preview) {
  if (!previewBody) return;
  previewBody.textContent = "";
  previewBody.append(previewSection(preview.caddy.path, preview.caddy.added, null));
  previewBody.append(previewSection(preview.tunnel.path, preview.tunnel.added, preview.tunnel.contextAfter));

  if (preview.files) {
    previewBody.append(previewSection(preview.files.path, preview.files.creates, null));
  }

  markSkips("add-site-steps", preview.steps);
}

async function refreshPreview() {
  if (!previewBody || !addSiteForm) return;

  const data = new FormData(addSiteForm);
  const hostname = composeHostname(String(data.get("hostname") ?? ""));
  renderComposedHostname(hostname);

  const sequence = ++previewSequence;
  try {
    const response = await fetch("/sites/preview", {
      method: "POST",
      body: new URLSearchParams({
        hostname,
        type: String(data.get("type") ?? "static"),
        port: String(data.get("port") ?? "").trim(),
        framework: String(data.get("framework") ?? "").trim(),
        healthcheckPath: String(data.get("healthcheckPath") ?? "").trim(),
      }),
    });
    if (sequence !== previewSequence) return;
    if (!response.ok) return;

    const result = await response.json();
    if (sequence !== previewSequence) return;

    if (result.ready) {
      previewError?.classList.add("hidden");
      renderPreview(result.preview);
      return;
    }

    if (result.error) {
      // Unhide before writing, for the same reason #add-site-error does:
      // role="status" does not announce a mutation inside a hidden subtree.
      previewError?.classList.remove("hidden");
      if (previewError) previewError.textContent = result.error;
      renderPreviewEmpty("Fix the problem above and the block appears here.");
      return;
    }

    previewError?.classList.add("hidden");
    renderPreviewEmpty("Name the site and the exact block and route appear here, before anything is written.");
  } catch {
    // A failed preview is a failed read. Keep the last good render and let the
    // submit's own validation be the gate — never block adding a site on it.
  }
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 250);
}

document.getElementById("hostname-field")?.addEventListener("input", schedulePreview);
portField?.addEventListener("input", schedulePreview);
frameworkField?.addEventListener("change", schedulePreview);
document.getElementById("healthcheck-field")?.addEventListener("input", schedulePreview);
typeInputs.forEach((input) => input.addEventListener("change", schedulePreview));
if (document.getElementById("add-site-form")) refreshPreview();

const addSiteError = document.getElementById("add-site-error");
let addSiteInFlight = false;

addSiteForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (addSiteInFlight) return;

  const formData = new FormData(addSiteForm);
  // The field only carries the subdomain label; the domain is rendered as a
  // fixed affix beside it (see #hostname-suffix in html.ts) so the managed
  // domain is structural rather than only a placeholder. Someone pasting a
  // full hostname (e.g. "blog.lyly.dev") into the label field must not have
  // the domain doubled onto it, and trailing "."s from a copy-pasted FQDN
  // must not survive to become "blog..lyly.dev". The doubling check compares
  // case-insensitively (the server lowercases before validating, so a pasted
  // "BLOG.LYLY.DEV" must be recognized as already-full the same as
  // "blog.lyly.dev" would be) while composing with the label's original
  // casing, since the server normalizes case anyway.
  const domain = document.getElementById("hostname-suffix")?.textContent?.replace(/^\./, "") ?? "";
  const label = String(formData.get("hostname") ?? "").trim().replace(/\.+$/, "");
  if (!label) {
    // Native `required` only rejects a zero-length value, so a whitespace-only
    // entry (e.g. a single space) still passes it. Stop here rather than
    // composing a bare ".lyly.dev" and letting the server reject it with a
    // less legible error.
    resetSteps("add-site-steps");
    if (addSiteError) {
      addSiteError.classList.remove("hidden");
      addSiteError.textContent = "Enter a hostname.";
    }
    return;
  }
  const labelLower = label.toLowerCase();
  const domainLower = domain.toLowerCase();
  const hostname =
    labelLower === domainLower || labelLower.endsWith(`.${domainLower}`) ? label : `${label}.${domain}`;
  const type = formData.get("type");
  const port = String(formData.get("port") ?? "").trim();
  const framework = String(formData.get("framework") ?? "").trim();
  const healthcheckPath = String(formData.get("healthcheckPath") ?? "").trim();

  addSiteInFlight = true;
  resetSteps("add-site-steps");
  addSiteError?.classList.add("hidden");
  const submitButton = addSiteForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  showBanner(`Adding ${hostname} — reloading Caddy and restarting cloudflared-sites…`, "info");
  try {
    const response = await fetch("/sites", {
      method: "POST",
      body: new URLSearchParams({ hostname, type, port, framework, healthcheckPath }),
    });
    const result = await response.json();
    if (!response.ok) {
      markSteps("add-site-steps", result.steps);
      throw new Error(result.error ?? "Failed to add site");
    }

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
    if (submitButton) submitButton.disabled = false;
    hideBanner();
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
// later click would be swallowed by the guard above with no error shown. The
// restored DOM also carries the in-flight submit button and banner from the
// submission that navigated away, since the success path deliberately leaves
// both alone rather than resetting them before window.location.href — so a
// bfcache restore has to undo those too, or the form comes back with a
// permanently disabled button and a stuck "Adding…" banner.
// event.persisted is only true on a bfcache restore, so this cannot reopen the
// double-submit window on a live page.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  addSiteInFlight = false;
  const submitButton = document.getElementById("add-site-submit");
  if (submitButton) submitButton.disabled = false;
  hideBanner();
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
    const originalLabel = button.getAttribute("aria-label") ?? "Copy to clipboard";
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
      button.setAttribute("aria-label", originalLabel);
      if (copyStatus) copyStatus.textContent = "";
      idleIcon?.classList.remove("hidden");
      copiedIcon?.classList.add("hidden");
    }, 1500);
  });
});

document.querySelectorAll("dialog.modal").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    // The confirm-remove dialog is the progress/result surface for an
    // in-flight delete; an outside click must not discard it mid-mutation.
    if (dialog === confirmRemoveDialog && deleteInFlight) return;
    const rect = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) dialog.close();
  });

  // A modal <dialog> confines focus to the document, but it does not wrap Tab
  // at its own edges: tabbing past the last focusable lands on <body> for one
  // stop before re-entering, once per lap. Harmless on an ordinary form and
  // expensive here — this is the app's one irreversible screen, and an
  // operator tabbing fast to the confirm button can fire Enter into nothing.
  //
  // Focusables are re-queried on every keystroke rather than cached, because
  // setRemoveBusy() changes the set mid-removal: both buttons disable while a
  // delete is in flight, leaving only the checkbox, and on a site with no
  // files to delete it leaves nothing at all. A cached list would trap focus
  // onto a disabled button.
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;

    const focusables = [...dialog.querySelectorAll("button, input, select, textarea, a[href]")].filter(
      (el) => !el.disabled,
    );

    // Mid-removal on a site with no delete-files checkbox: nothing in here can
    // hold focus, so the only way to keep it inside is to refuse the key.
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    // Wrapping at the edges is what keeps focus in: intercept the step that
    // would have landed on <body>, and it never gets there.
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
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
