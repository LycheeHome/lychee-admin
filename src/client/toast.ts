/*
 * The page's flash toast (#flash-banner, rendered by the server's shell) as
 * React code can reach it. This is the toast's implementation; public/app.js
 * keeps its own showBanner only for the add page until that script is deleted.
 * The close button's click is bound in sharedBindings.ts, and the elements are looked up at call time rather than cached, because a page
 * island can mount before or after a shell script has run.
 */

type ToastKind = "info" | "success" | "error";
type ToastAction = { label: string; run: () => void };

const SUCCESS_DISMISS_MS = 4000;

let timeout: ReturnType<typeof setTimeout> | undefined;

function parts() {
  const banner = document.getElementById("flash-banner");
  const message = document.getElementById("flash-banner-message");
  const close = document.getElementById("flash-banner-close");
  if (!banner || !message || !close) return null;
  return {
    banner,
    message,
    close,
    progress: document.getElementById("flash-banner-progress"),
    action: document.getElementById("flash-banner-action"),
  };
}

export function showToast(message: string, kind: ToastKind, action?: ToastAction): void {
  const el = parts();
  if (!el) return;
  clearTimeout(timeout);
  if (el.action) {
    // Every call resets it, so an action can never outlive the message it was offered with.
    el.action.onclick = action ? action.run : null;
    el.action.textContent = action?.label ?? "";
    el.action.classList.toggle("hidden", !action);
  }
  el.banner.classList.remove("hidden", "bg-red-950/60", "border-red-400/70", "bg-rose-950", "border-rose-400/70");
  // The pulsing dot says "still working", which is only true of the info tone.
  el.progress?.classList.toggle("hidden", kind !== "info");
  if (kind === "error") {
    el.banner.classList.add("bg-red-950/60", "border-red-400/70");
    el.close.classList.remove("hidden");
  } else if (kind === "info") {
    el.banner.classList.add("bg-rose-950", "border-rose-400/70");
    el.close.classList.add("hidden");
  } else {
    el.banner.classList.add("bg-rose-950", "border-rose-400/70");
    el.close.classList.add("hidden");
    timeout = setTimeout(hideToast, SUCCESS_DISMISS_MS);
  }
  // Written last, after the region is visible and toned: a change inside a
  // display:none subtree is not announced.
  el.message.textContent = message;
}

export function hideToast(): void {
  clearTimeout(timeout);
  const action = document.getElementById("flash-banner-action");
  if (action) {
    action.onclick = null;
    action.classList.add("hidden");
  }
  document.getElementById("flash-banner")?.classList.add("hidden");
  document.getElementById("flash-banner-progress")?.classList.add("hidden");
}
