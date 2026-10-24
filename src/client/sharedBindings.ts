/*
 * The document-level behaviour every page shares, which public/app.js used to
 * bind: copy buttons, the page notice's close and the toast's close. Copy is
 * delegated from the document so a button in markup rendered after this ran
 * (anything React renders) works the same as one the server rendered; the two
 * closes are delegated too, because the page notice and the toast live in the
 * server's shell and a route can replace neither. Strings are the retired
 * app.js's, verbatim.
 */

import { hideToast } from "./toast";

const COPY_RESET_MS = 1500;

export function installSharedBindings(doc: Document): () => void {
  // A second click while the first reset is pending must not read the first's
  // "Copied!" back as the button's own label, and must restart the clock.
  const labels = new WeakMap<Element, string>();
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  const pending = new Set<ReturnType<typeof setTimeout>>();

  const onClick = async (event: Event) => {
    const from = event.target instanceof Element ? event.target : null;
    if (!from) return;

    if (from.closest("#page-notice-close")) {
      doc.getElementById("page-notice")?.remove();
      return;
    }
    if (from.closest("#flash-banner-close")) {
      hideToast();
      return;
    }

    const button = from.closest<HTMLElement>("[data-copy-target]");
    if (!button) return;
    const idleIcon = button.querySelector('[data-copy-icon="idle"]');
    const copiedIcon = button.querySelector('[data-copy-icon="copied"]');
    const target = doc.getElementById(button.dataset.copyTarget ?? "");
    if (!target) return;
    const copyStatus = doc.getElementById("copy-status");
    if (!labels.has(button)) labels.set(button, button.getAttribute("aria-label") ?? "Copy to clipboard");
    const originalLabel = labels.get(button)!;
    try {
      await navigator.clipboard.writeText(target.textContent ?? "");
      button.setAttribute("aria-label", "Copied!");
      if (copyStatus) copyStatus.textContent = "Copied to clipboard";
      idleIcon?.classList.add("hidden");
      copiedIcon?.classList.remove("hidden");
    } catch {
      // Insecure context (plain http over the LAN) or clipboard permission
      // denied: select the text so the user can still copy it with Ctrl+C.
      doc.defaultView?.getSelection()?.selectAllChildren(target);
      button.setAttribute("aria-label", "Press Ctrl+C to copy");
      // A selection is not something a screen reader announces on its own.
      if (copyStatus) copyStatus.textContent = "Text selected — press Ctrl+C to copy";
    }
    const previous = timers.get(button);
    if (previous !== undefined) {
      clearTimeout(previous);
      pending.delete(previous);
    }
    const timer = setTimeout(() => {
      pending.delete(timer);
      labels.delete(button);
      button.setAttribute("aria-label", originalLabel);
      if (copyStatus) copyStatus.textContent = "";
      idleIcon?.classList.remove("hidden");
      copiedIcon?.classList.add("hidden");
    }, COPY_RESET_MS);
    timers.set(button, timer);
    pending.add(timer);
  };

  doc.addEventListener("click", onClick);
  return () => {
    doc.removeEventListener("click", onClick);
    for (const timer of pending) clearTimeout(timer);
    pending.clear();
  };
}
