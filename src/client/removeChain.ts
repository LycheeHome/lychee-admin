import { showToast } from "./toast";

/*
 * The remove chain, ported step for step from public/app.js's
 * #confirm-remove-submit handler and its helpers (retireDeclaration,
 * deleteSiteFiles, filesFailureMessage, offerDeclarationRetry,
 * isRemovalSettled, hostStateMessage), with its endpoints, bodies, order and
 * strings unchanged. Each step is its own request, and each runs only if the
 * one before it succeeded: a failed Caddy/tunnel removal never cascades into
 * a retired container or deleted files, and files are never deleted while
 * their container is still declared running.
 *
 * Everything the chain shows goes through `ui`, which RemoveDialog supplies;
 * the chain holds no state of its own between runs. Whether a removal has
 * settled reaches the dialog as setBusy's keepSubmitDisabled, which it keeps
 * for as long as the page lives, as app.js kept removalSettled.
 */

export type StepStatus = "ok" | "failed" | "skipped" | "not-run";
export type StepResult = { id: string; status: StepStatus | string };

export interface RemoveUi {
  markSteps(steps: StepResult[] | undefined): void;
  resetSteps(): void;
  setOutcome(text: string, isError: boolean): void;
  /**
   * Disables both buttons while busy. keepSubmitDisabled is separate: once a
   * removal has settled (isRemovalSettled), Confirm stays disabled after the
   * request resolves, while Cancel stays usable.
   */
  setBusy(busy: boolean, keepSubmitDisabled: boolean): void;
  close(): void;
  toast: typeof showToast;
  /** Where the chain lands once every step has run; window.location.assign by default. */
  go?(href: string): void;
}

type DeleteResult = {
  ok?: boolean;
  error?: string;
  removed?: boolean;
  rolledBack?: boolean;
  needsFileConfirm?: boolean;
  steps?: StepResult[];
};

const defaultGo = (href: string) => window.location.assign(href);

/**
 * True once retrying would risk destroying the only record of a partially-
 * or fully-completed removal: the config removal itself succeeded
 * (`removed: true`), or the caddy/cloudflared steps — which only ever run
 * once Caddy has actually reloaded — reported "ok". A failure at or before
 * the caddy step is always rolled back server-side, so retrying from there
 * is still safe.
 */
export function isRemovalSettled(result: DeleteResult | null | undefined): boolean {
  if (result?.removed) return true;
  return (result?.steps ?? []).some(
    (step) => (step.id === "caddy" || step.id === "cloudflared") && step.status === "ok",
  );
}

/**
 * What actually happened on the host for a failed /delete. If the rollback
 * itself failed, result.error already explains it in full, and "Caddy had
 * already reloaded" would misstate it, since in that branch Caddy never did.
 */
export function hostStateMessage(result: DeleteResult): string {
  if (result.rolledBack) {
    return "The original Caddyfile and tunnel config were restored.";
  }
  const caddyStep = (result.steps ?? []).find((step) => step.id === "caddy");
  if (caddyStep?.status === "ok") {
    return "Caddy had already reloaded, so the edited config is live and was left in place.";
  }
  return "";
}

/** POST /detach. Resolves { ok, reason } and never throws, so the chain and the toast's Retry handle one shape. */
export async function retireDeclaration(hostname: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const response = await fetch(`/sites/${encodeURIComponent(hostname)}/detach`, { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
    if (response.ok && body.ok) return { ok: true };
    return { ok: false, reason: body.reason ?? `HTTP ${response.status}` };
  } catch {
    return { ok: false, reason: "could not reach the server" };
  }
}

/**
 * POST /delete-files, a separate request so its failure cannot be confused
 * with the already-completed config removal. Resolves the error text, or null.
 */
export async function deleteSiteFiles(hostname: string): Promise<string | null> {
  try {
    const response = await fetch(`/sites/${encodeURIComponent(hostname)}/delete-files`, { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return response.ok ? null : (body.error ?? "unknown error");
  } catch {
    return "could not reach the server";
  }
}

export function filesFailureMessage(hostname: string, error: string): string {
  return `Removed ${hostname} from Caddy and the sites tunnel, but deleting its files failed:\n${error}\n\nThe site is no longer served. Its files are still on disk.`;
}

const removedHref = (hostname: string) => `/?removed=${encodeURIComponent(hostname)}`;

/**
 * The site is gone from Caddy and the tunnel, but its container is still
 * declared running. The dialog closes, because a modal makes everything
 * beneath it inert, the toast included; the toast then carries the one thing
 * left to do. Retry re-posts /detach and, once it lands, resumes the chain
 * where it stopped: file deletion, if it was asked for, then the list.
 */
export function offerDeclarationRetry(
  hostname: string,
  needsFileConfirm: boolean | undefined,
  reason: string,
  ui: Pick<RemoveUi, "close" | "toast" | "go">,
): void {
  ui.close();
  ui.toast(`Site removed, but its container is still declared running: ${reason}`, "error", {
    label: "Retry",
    run: async () => {
      ui.toast(`Retiring ${hostname}'s container declaration…`, "info");
      const detached = await retireDeclaration(hostname);
      if (!detached.ok) {
        offerDeclarationRetry(hostname, needsFileConfirm, detached.reason, ui);
        return;
      }
      const filesError = needsFileConfirm ? await deleteSiteFiles(hostname) : null;
      if (filesError) {
        ui.toast(filesFailureMessage(hostname, filesError), "error");
        return;
      }
      (ui.go ?? defaultGo)(removedHref(hostname));
    },
  });
  document.getElementById("flash-banner-action")?.focus();
}

/**
 * The confirm handler: /delete, then /detach for an attached site, then
 * /delete-files when the server says the box was ticked, then the list.
 * `attached` is whether the dialog lists the declaration step (one
 * predicate, siteDetailModel's removeDeclaration, decides both).
 */
export async function runRemoveChain(
  hostname: string,
  { attached, deleteFiles }: { attached: boolean; deleteFiles: boolean },
  ui: RemoveUi,
): Promise<void> {
  let settled = false;
  ui.setBusy(true, false);
  ui.resetSteps();
  ui.setOutcome(`Removing ${hostname}…`, false);
  try {
    const response = await fetch(`/sites/${encodeURIComponent(hostname)}/delete`, {
      method: "POST",
      body: new URLSearchParams({ deleteFiles: deleteFiles ? "on" : "" }),
    });
    const result = (await response.json()) as DeleteResult;
    ui.markSteps(result.steps);
    if (isRemovalSettled(result)) settled = true;

    if (!response.ok) {
      // The dialog stays open: it stated the steps, so it is where the outcome belongs.
      const state = hostStateMessage(result);
      const message = state
        ? `${result.error ?? "Failed to remove site"}\n\n${state}`
        : (result.error ?? "Failed to remove site");
      ui.setOutcome(message, true);
      return;
    }

    // A resource-backed site's declaration is retired in its own request, sent
    // only now that the Caddy/tunnel removal has succeeded. If it fails,
    // nothing after it runs: file deletion waits until the container has
    // actually been told to stop.
    if (attached) {
      ui.setOutcome(`Retiring ${hostname}'s container declaration…`, false);
      const detached = await retireDeclaration(hostname);
      ui.markSteps([{ id: "declaration", status: detached.ok ? "ok" : "failed" }]);
      if (!detached.ok) {
        offerDeclarationRetry(hostname, result.needsFileConfirm, detached.reason, ui);
        return;
      }
    }

    const filesError = result.needsFileConfirm ? await deleteSiteFiles(hostname) : null;
    if (filesError) {
      ui.setOutcome(filesFailureMessage(hostname, filesError), true);
      return;
    }
    (ui.go ?? defaultGo)(removedHref(hostname));
  } catch (error) {
    ui.setOutcome(error instanceof Error ? error.message : String(error), true);
  } finally {
    ui.setBusy(false, settled);
  }
}
