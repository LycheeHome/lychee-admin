import { useEffect, useImperativeHandle, useRef, useState, type MouseEvent, type KeyboardEvent, type Ref } from "react";
import { flushSync } from "react-dom";
import { BUTTON_DANGER, BUTTON_SECONDARY, FOCUS_RING } from "../../views/shared";
import { runRemoveChain, type RemoveUi, type StepResult } from "../removeChain";
import { showToast } from "../toast";
import { Icon } from "./CommandBlock";

/*
 * The site page's remove dialog, the app's one destructive client flow. Its
 * markup is element for element what the retired server renderer wrote for
 * the closed dialog (SiteDetailParity.test.tsx compares it with that frozen
 * output); its behaviour is what public/app.js had, ported: the confirm
 * handler is runRemoveChain (removeChain.ts), and the open and close
 * triggers, Escape, the backdrop click and the Tab trap are app.js's former
 * generic dialog code, which went with the server page.
 *
 * Its props are read once, when it opens, and kept for as long as it is open:
 * a page re-read while a removal runs must not change the steps it is marking
 * or the declaration it is about to retire.
 *
 * Two departures from app.js, both in what the browser does for it there:
 * - React does not apply `autofocus` on a live render, so opening focuses
 *   Cancel itself.
 * - Escape ("cancel") is always prevented and the dialog closes itself when
 *   idle, so the busy rule does not depend on the browser's default.
 */

export type RemoveDialogHandle = { open(): void };

export type RemoveDialogProps = {
  hostname: string;
  /** siteDetailModel's removeSteps, in the order they run. */
  steps: { id: string; label: string }[];
  /**
   * The declaration Remove retires (siteDetailModel's removeDeclaration), or
   * null. It decides data-attached, the step-5 note and whether the chain
   * posts /detach; the same predicate decides the steps' fifth entry.
   */
  declaration: string | null;
  filesPath: string | null;
  /** Offer the delete-files checkbox: only for a directory that is actually there. */
  deletableFiles: boolean;
  /** The "stop the container first" warning beside the checkbox (a framework site's). */
  dockerWarning: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Where the chain lands; window.location.assign by default. */
  go?: (href: string) => void;
  ref?: Ref<RemoveDialogHandle>;
};

const STEP_MARKS: Record<string, string> = { ok: "✓", failed: "✗", skipped: "—", "not-run": "·" };
const STEP_MARK_CLASSES: Record<string, string> = {
  ok: "text-green-300",
  failed: "text-red-300",
  skipped: "text-stone-400",
  "not-run": "text-stone-400",
};

const OUTCOME_BASE = "font-mono text-[0.72rem] leading-snug m-0 mb-4 flex items-start gap-2";
const OUTCOME_HIDDEN = "hidden font-mono text-[0.72rem] text-stone-400 leading-snug m-0 mb-4 flex items-start gap-2";
const OUTCOME_NEUTRAL = "text-stone-400";
const OUTCOME_ERROR = "text-red-300 bg-red-950/40 border border-red-800/50 rounded-md px-2.5 py-2";
const PROGRESS = "shrink-0 mt-[0.4em] h-1.5 w-1.5 rounded-full bg-stone-400 motion-safe:animate-pulse";

const FOCUSABLE = "button, input, select, textarea, a[href]";

type Tone = "neutral" | "error";

export function RemoveDialog(props: RemoveDialogProps) {
  const { ref } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const checkboxRef = useRef<HTMLInputElement>(null);

  const propsRef = useRef(props);
  propsRef.current = props;
  /** The props as they were when it opened; null while closed. */
  const [shown, setShown] = useState<RemoveDialogProps | null>(null);
  const shownRef = useRef<RemoveDialogProps | null>(null);
  const view = shown ?? props;

  const [marks, setMarks] = useState<Record<string, string>>({});
  const [tone, setTone] = useState<Tone | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusyState] = useState<boolean | null>(null);
  const [submitLocked, setSubmitLocked] = useState(false);
  // Refs as well as state: the guards must hold between a click and the
  // re-render it causes, as app.js's deleteInFlight and removalSettled did.
  const busyRef = useRef(false);
  /** Once true, Confirm stays disabled for as long as the page lives (app.js's removalSettled). */
  const settledRef = useRef(false);

  useImperativeHandle(ref, () => ({
    open() {
      const dialog = dialogRef.current;
      if (!dialog || dialog.open) return;
      shownRef.current = propsRef.current;
      setShown(propsRef.current);
      dialog.showModal();
      cancelRef.current?.focus();
      propsRef.current.onOpenChange?.(true);
    },
  }));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Escape fires "cancel" before "close". The dialog is the only place the
    // outcome is shown, so dismissing it mid-removal would discard the result
    // the operator is waiting on.
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (!busyRef.current) dialog.close();
    };
    const onClose = () => {
      shownRef.current = null;
      setShown(null);
      propsRef.current.onOpenChange?.(false);
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
    };
  }, []);

  const ui: RemoveUi = {
    markSteps(steps: StepResult[] | undefined) {
      setMarks((current) => {
        const next = { ...current };
        for (const step of steps ?? []) next[step.id] = step.status;
        return next;
      });
    },
    resetSteps() {
      setMarks({});
    },
    setOutcome(message: string, isError: boolean) {
      if (!message) {
        setTone(null);
        setText("");
        return;
      }
      // Unhide and set the tone before writing the text, in its own commit:
      // a change inside a display:none subtree is not announced, and
      // revealing an element that already holds its text generally isn't
      // either (app.js's setOutcome orders it the same way).
      flushSync(() => setTone(isError ? "error" : "neutral"));
      setText(message);
    },
    setBusy(nextBusy: boolean, keepSubmitDisabled: boolean) {
      busyRef.current = nextBusy;
      if (keepSubmitDisabled) settledRef.current = true;
      setBusyState(nextBusy);
      setSubmitLocked(settledRef.current);
    },
    close() {
      if (dialogRef.current?.open) dialogRef.current.close();
    },
    toast: showToast,
    go: (href: string) => (propsRef.current.go ?? ((h: string) => window.location.assign(h)))(href),
  };

  const confirm = () => {
    if (busyRef.current || settledRef.current) return;
    const current = shownRef.current ?? propsRef.current;
    void runRemoveChain(
      current.hostname,
      { attached: current.declaration !== null, deleteFiles: checkboxRef.current?.checked ?? false },
      ui,
    );
  };

  const onBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    const dialog = event.currentTarget;
    // An outside click must not discard the outcome mid-removal.
    if (busyRef.current) return;
    // Only a click on the dialog itself can be on its backdrop. A click on a
    // control inside it is never one, whatever its coordinates (a keyboard
    // click reports 0,0).
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) dialog.close();
  };

  // A modal <dialog> confines focus to the document, but it does not wrap Tab
  // at its own edges: tabbing past the last focusable lands on <body> for one
  // stop. Focusables are re-queried on every keystroke, because the set
  // changes mid-removal (both buttons disable, leaving only the checkbox, or
  // nothing at all).
  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !(el as HTMLButtonElement).disabled,
    );
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  };

  const { hostname, steps, declaration, filesPath, deletableFiles, dockerWarning } = view;
  const outcomeClass = tone === null ? OUTCOME_HIDDEN : `${OUTCOME_BASE} ${tone === "error" ? OUTCOME_ERROR : OUTCOME_NEUTRAL}`;
  const progressClass = tone === "neutral" ? PROGRESS : `hidden ${PROGRESS}`;

  return (
    <dialog
      ref={dialogRef}
      id="confirm-remove-dialog"
      data-attached={declaration ? "true" : undefined}
      aria-labelledby="confirm-remove-title"
      aria-busy={busy === null ? undefined : busy ? "true" : "false"}
      className="modal font-sans bg-stone-800 text-stone-50 border border-stone-700 rounded-[10px] p-6 w-[min(420px,calc(100vw-2rem))] m-auto backdrop:bg-black/60 motion-safe:animate-modal-in"
      onClick={onBackdropClick}
      onKeyDown={onKeyDown}
    >
      <h2
        id="confirm-remove-title"
        className="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]"
      >
        Remove site
      </h2>
      <p className="m-0 mb-3 leading-relaxed">
        {"Remove "}
        <strong>{hostname}</strong>
        {"? In this order:"}
      </p>
      <ol id="confirm-remove-steps" className="font-mono text-[0.75rem] text-stone-400 m-0 mb-3 p-0 list-none grid gap-y-1.5">
        {steps.map((step, index) => {
          const status = marks[step.id];
          return (
            <li key={step.id} className="flex gap-2" data-step-id={step.id}>
              <span className="text-stone-400 shrink-0">{`${index + 1}.`}</span>
              <span>{step.label}</span>
              <span className={`step-mark ml-auto shrink-0${status ? ` ${STEP_MARK_CLASSES[status] ?? ""}` : ""}`}>
                {status ? (STEP_MARKS[status] ?? "") : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={`text-stone-400 text-[0.75rem] leading-snug m-0 ${declaration ? "mb-2" : "mb-4"}`}>
        {"If a step fails, the ones after it don't run."}
      </p>
      {declaration ? (
        <p className="text-stone-400 text-[0.75rem] leading-snug m-0 mb-4">
          {"Step 5 is what stops the container: it writes "}
          <span className="font-mono text-stone-50">state: absent</span>
          {" to "}
          <span className="font-mono text-stone-50">{`${declaration}.yml`}</span>
          {" in "}
          <span className="font-mono text-stone-50">lychee-resources</span>
          {", and the reconciler takes the container down on its next run, usually within two minutes."}
        </p>
      ) : null}
      <div id="confirm-remove-outcome" className={outcomeClass} role="status" aria-live="polite">
        <span id="confirm-remove-progress" className={progressClass} aria-hidden="true"></span>
        <span id="confirm-remove-outcome-text" className="whitespace-pre-wrap">
          {text}
        </span>
      </div>
      {deletableFiles && filesPath ? (
        <div className="flex flex-col gap-2 mb-5">
          <label className="flex flex-row items-center text-[0.8rem] text-stone-400 gap-1.5">
            <input
              ref={checkboxRef}
              type="checkbox"
              id="confirm-remove-delete-files"
              className={`accent-rose-400 ${FOCUS_RING}`}
            />
            {" Also delete files at "}
            <span className="font-mono">{filesPath}</span>
          </label>
          {dockerWarning ? (
            <p className="text-[0.75rem] text-red-300 bg-red-950/40 border border-red-800/50 rounded-md px-2.5 py-2 leading-snug m-0">
              {"If a Docker container is running from this directory, stop it first with "}
              <code className="font-mono">docker compose down</code>
              {" — deleting the files won't stop it."}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2.5">
        {/* autoFocus for parity with the server's autofocus; open() focuses it, since React does not. */}
        <button
          ref={cancelRef}
          type="button"
          autoFocus
          className={BUTTON_SECONDARY}
          data-close-dialog="confirm-remove-dialog"
          disabled={busy === true}
          onClick={() => dialogRef.current?.close()}
        >
          Cancel
        </button>
        <button
          type="button"
          id="confirm-remove-submit"
          className={BUTTON_DANGER}
          data-hostname={hostname}
          disabled={busy === true || submitLocked}
          onClick={confirm}
        >
          <Icon name="trash" />
          {`Remove ${hostname}`}
        </button>
      </div>
    </dialog>
  );
}
