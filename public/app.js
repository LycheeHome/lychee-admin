// What is left here is the add-site page's: the add form with its preview and
// the flash toast it shows. Copy buttons and the two closes are the client's
// (src/client/sharedBindings.ts). Every other page — the sites list, a site's page and the board —
// is the client bundle's (src/client/), writes included.

const portOwners = JSON.parse(document.getElementById("port-owners-data")?.textContent ?? "{}");

const flashBanner = document.getElementById("flash-banner");
const flashBannerMessage = document.getElementById("flash-banner-message");
const flashBannerProgress = document.getElementById("flash-banner-progress");
const flashBannerClose = document.getElementById("flash-banner-close");
let flashBannerTimeout = null;

const flashBannerAction = document.getElementById("flash-banner-action");
let flashBannerActionHandler = null;

flashBannerAction?.addEventListener("click", () => {
  const handler = flashBannerActionHandler;
  if (handler) handler();
});

// `action` ({ label, onClick }) is optional and only meaningful on an error:
// a recovery the operator can take from the toast itself. Every call resets
// it, so an action can never outlive the message it was offered with. No
// caller here passes one any more (the remove chain that did is the
// client's, src/client/removeChain.ts); it stays because src/client/toast.ts
// is held to this function's markup, action included (toast.test.ts).
function showBanner(message, kind, action) {
  if (!flashBanner || !flashBannerMessage || !flashBannerClose) return;
  clearTimeout(flashBannerTimeout);
  flashBannerActionHandler = action?.onClick ?? null;
  if (flashBannerAction) {
    flashBannerAction.textContent = action?.label ?? "";
    flashBannerAction.classList.toggle("hidden", !action);
  }
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
  // #port-error and #add-site-error use.
  flashBannerMessage.textContent = message;
}

function hideBanner() {
  clearTimeout(flashBannerTimeout);
  flashBannerActionHandler = null;
  flashBannerAction?.classList.add("hidden");
  flashBanner?.classList.add("hidden");
  flashBannerProgress?.classList.add("hidden");
}

// The toast's close button and the page notice's close are the client's
// (installSharedBindings, src/client/sharedBindings.ts).

// `?removed` (the list's DNS reminder) and `?created=1` (a new site's notice),
// both server-rendered as #page-notice, are stripped by the client bundle
// before its router starts (stripNoticeParams in src/client/router.tsx),
// keeping the URL's other parameters, its hash and the router's history state.
// This script runs first, and stripping them here would drop all three.

const STEP_MARKS = { ok: "✓", failed: "✗", skipped: "—", "not-run": "·" };
const STEP_MARK_CLASSES = {
  ok: "text-green-300",
  failed: "text-red-300",
  skipped: "text-stone-400",
  "not-run": "text-stone-400",
};

// Takes the list id, which today is only the add-site form's own step list
// (the remove dialog's is the client's: src/client/removeChain.ts).
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

const typeInputs = document.querySelectorAll('input[name="type"]');
const portFieldWrapper = document.querySelector(".port-input");
const portField = document.getElementById("port-field");
const portError = document.querySelector(".port-error");

function syncPortField() {
  const isProxy = document.querySelector('input[name="type"]:checked')?.value === "reverse-proxy";
  if (portFieldWrapper) portFieldWrapper.style.display = isProxy ? "flex" : "none";
  if (portField) {
    portField.required = isProxy;
    // A display:none control is still a constraint-validation candidate: an
    // out-of-range port (rangeOverflow) or a lingering setCustomValidity from
    // validatePortField would keep the whole form invalid with no visible
    // control to explain why, so the submit event would never fire. Disabling
    // the field (not just hiding it) is what exempts it from constraint
    // validation and drops it from FormData — which is correct regardless,
    // since the server ignores `port` for a static site.
    portField.disabled = !isProxy;
    // Switching back to reverse proxy must re-check the current value so a
    // conflict typed before the switch away is reported again, not forgotten.
    if (isProxy) validatePortField();
  }
}

typeInputs.forEach((input) => input.addEventListener("change", syncPortField));
syncPortField();

const frameworkField = document.getElementById("framework-field");
const healthcheckFieldWrapper = document.getElementById("healthcheck-field-wrapper");

const proxyDescription = document.getElementById("type-proxy-description");
const proxyDescriptionNextjs = document.getElementById("type-proxy-description-nextjs");
const proxyRadio = document.querySelector('input[name="type"][value="reverse-proxy"]');

function syncFrameworkFields() {
  const isNextjs = frameworkField?.value === "nextjs";
  if (healthcheckFieldWrapper) healthcheckFieldWrapper.style.display = isNextjs ? "flex" : "none";
  // The plain-proxy sentence ("won't start, stop, or restart that process") is
  // false for Next.js, where the reconciler runs the container. Swap which one
  // is visible, and which one the radio's description points at, so a screen
  // reader hears the true one too.
  if (proxyDescription && proxyDescriptionNextjs) {
    proxyDescription.classList.toggle("hidden", isNextjs);
    proxyDescriptionNextjs.classList.toggle("hidden", !isNextjs);
    proxyRadio?.setAttribute("aria-describedby", isNextjs ? "type-proxy-description-nextjs" : "type-proxy-description");
  }
}

frameworkField?.addEventListener("change", syncFrameworkFields);
syncFrameworkFields();

function validatePortField() {
  if (!portField || !portError) return;
  // The server's finished sentence (portConflictMessage), shown as is: the
  // preview panel reports the same conflict in the same words, so the client
  // adds no wording of its own.
  const sentence = portOwners[portField.value];
  if (sentence) {
    portField.setCustomValidity(sentence);
    // Unhide before writing: a mutation inside a display:none subtree is not
    // announced, and revealing an element that already holds its text
    // generally isn't either — see the same fix beside #add-site-error.
    portError.classList.remove("hidden");
    portError.textContent = sentence;
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

// The server already rendered the empty state, including the two paths this
// page edits. Clone it once before anything mutates the panel, so returning to
// empty restores exactly what the server sent — the client never duplicates
// that markup, and never needs the path strings, which only the server knows.
const previewEmptyState = previewBody?.cloneNode(true);

// Responses can land out of order — a slow early request must never overwrite
// a fast later one. Only the newest sequence number is allowed to render.
let previewSequence = 0;
let previewTimer;

// The field only carries the subdomain label; the domain is rendered as a
// fixed affix beside it (see #hostname-suffix and #composed-hostname's
// data-domain in html.ts) so the managed domain is structural rather than
// only a placeholder. Someone pasting a full hostname (e.g. "blog.lychee.land")
// into the label field must not have the domain doubled onto it, and
// trailing "."s from a copy-pasted FQDN must not survive to become
// "blog..lychee.land". The doubling check compares case-insensitively (the
// server lowercases before validating, so a pasted "BLOG.LYLY.DEV" must be
// recognized as already-full the same as "blog.lychee.land" would be) while
// composing with the label's original casing, since the server normalizes
// case anyway. Both the preview and the submit handler call this so they can
// never derive two different hostnames from the same input.
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
    dim.className = "text-stone-500";
    dim.textContent = hostname.slice(hostname.length - suffix.length);
    composedHostname.append(dim);
    return;
  }
  composedHostname.textContent = hostname;
}

function previewLines(lines, contextAfter) {
  const pre = document.createElement("pre");
  // No text colour on the <pre> itself: every child span sets its own, and a
  // colour here would compete with them by stylesheet order rather than losing
  // cleanly (Tailwind resolves competing utilities by their order in the
  // generated stylesheet, not by class-attribute order, so appending a colour
  // class after another one is not reliably an override).
  pre.className =
    "font-mono text-[0.72rem] leading-[1.55] bg-stone-900 border border-stone-700 rounded-md p-2.5 m-0 overflow-x-auto whitespace-pre [tab-size:4]";

  // Everything but the trailing context line is an addition. Colouring rather
  // than prefixing with "+" keeps a YAML list dash from reading as a deletion.
  const added = document.createElement("span");
  added.className = "text-green-300";
  added.textContent = contextAfter ? `${lines.join("\n")}\n` : lines.join("\n");
  pre.append(added);

  if (contextAfter) {
    const context = document.createElement("span");
    context.className = "text-stone-400";
    context.textContent = contextAfter;
    pre.append(context);
  }
  return pre;
}

function previewSection(pathText, lines, contextAfter) {
  const section = document.createElement("div");
  section.className = "flex flex-col gap-1.5";

  const label = document.createElement("p");
  label.className = "font-mono text-[0.6875rem] font-medium tracking-[0.02em] text-stone-400 m-0 break-all";
  label.textContent = pathText;
  section.append(label);

  section.append(previewLines(lines, contextAfter));
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

function restorePreviewEmpty() {
  if (!previewBody || !previewEmptyState) return;
  previewBody.replaceChildren(...previewEmptyState.cloneNode(true).childNodes);
  resetSteps("add-site-steps");
}

function renderPreviewMessage(message) {
  if (!previewBody) return;
  const line = document.createElement("p");
  line.className = "text-stone-400 text-[0.8rem] leading-snug m-0";
  line.textContent = message;
  previewBody.replaceChildren(line);
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

// aria-disabled, not `disabled`: the button stays focusable and clickable, so a
// keyboard or screen-reader user can reach it and be taken to the reason
// (#preview-error) instead of meeting a dead control. The native `disabled`
// attribute keeps its one other job, the in-flight submit. Only the value
// "true" styles it, and clearing means removing the attribute.
function setSubmitBlocked(blocked) {
  const button = document.getElementById("add-site-submit");
  if (!button) return;
  const tokens = (button.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  const rest = tokens.filter((token) => token !== "preview-error");
  if (blocked) {
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("aria-describedby", [...rest, "preview-error"].join(" "));
    return;
  }
  button.removeAttribute("aria-disabled");
  if (rest.length) button.setAttribute("aria-describedby", rest.join(" "));
  else button.removeAttribute("aria-describedby");
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
    if (!response.ok) {
      // Not an answer, so not a rejection: a failed read never blocks.
      setSubmitBlocked(false);
      return;
    }

    const result = await response.json();
    if (sequence !== previewSequence) return;

    if (result.ready) {
      setSubmitBlocked(false);
      previewError?.classList.add("hidden");
      renderPreview(result.preview);
      return;
    }

    if (result.error) {
      // A rejection is the server answering "no" to exactly this input, and it
      // is the only thing that blocks. Set here, after both sequence checks, so
      // a stale rejection can never re-block a newer valid input.
      setSubmitBlocked(true);
      // Unhide before writing, for the same reason #add-site-error does:
      // role="status" does not announce a mutation inside a hidden subtree.
      previewError?.classList.remove("hidden");
      if (previewError) previewError.textContent = result.error;
      renderPreviewMessage("Fix the problem above and the block appears here.");
      return;
    }

    setSubmitBlocked(false);
    previewError?.classList.add("hidden");
    restorePreviewEmpty();
  } catch {
    // A failed preview is a failed read. Keep the last good render and let the
    // submit's own validation be the gate — never block adding a site on it.
    // A throw from a stale request must not unblock a newer rejection.
    if (sequence === previewSequence) setSubmitBlocked(false);
  }
}

function schedulePreview() {
  // Any edit makes the last rejection about input that no longer exists, so
  // lift it at once rather than after the debounce: typing a fix and pressing
  // Enter immediately must submit. The next answer re-blocks if it is still no.
  setSubmitBlocked(false);
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
  // Blocked by an explicit preview rejection: send the reader to the reason
  // rather than posting what the server already said no to. No banner, no fetch.
  if (addSiteForm.querySelector("#add-site-submit")?.getAttribute("aria-disabled") === "true") {
    previewError?.focus();
    return;
  }
  if (addSiteInFlight) return;

  const formData = new FormData(addSiteForm);
  // Reuses the preview's own composeHostname (defined above) instead of
  // re-deriving the domain and repeating its trim / doubling-check logic
  // here, so submit and preview can never disagree on what "blog" becomes.
  const hostname = composeHostname(String(formData.get("hostname") ?? ""));
  if (!hostname) {
    // Native `required` only rejects a zero-length value, so a whitespace-only
    // entry (e.g. a single space) still passes it; composeHostname trims and
    // returns "" for that case too. Stop here rather than composing a bare
    // ".lychee.land" and letting the server reject it with a less legible error.
    resetSteps("add-site-steps");
    if (addSiteError) {
      addSiteError.classList.remove("hidden");
      addSiteError.textContent = "Enter a hostname.";
    }
    return;
  }
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
    // DNS command permanently, and a full navigation leaves the rail listing
    // the site we just created. addSiteInFlight is
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
    // A debounced preview can have fired while the POST was in flight and read
    // the half-written state ("already exists"). The add has failed and rolled
    // back, so ask the server again rather than leave the form blocked on it.
    refreshPreview();
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
  // The restored heap may hold a rejection about input the form no longer
  // shows (or the reverse); ask again rather than trust it.
  refreshPreview();
});
