import type { FailureFacts } from "../../views/siteDetailModel";
import { BODY, CODE_LINE, COPY_BUTTON, COPY_IN_LINE, ICON_CLASS, MONO_FACT, SERVICE_DETAIL } from "../../views/shared";

/*
 * The pieces the services board and the site page share, each element for
 * element what the retired server renderers in html.ts wrote (the html.ts
 * names below are theirs): the icon set they use, the copy button
 * public/app.js binds by [data-copy-target], a single-line command box, and
 * a failed deploy's line. Every phrase the server writes as one text node is
 * one template string here.
 */

/** shared.ts's ICONS, as JSX: same paths, same order. */
const ICON_PATHS = {
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </>
  ),
  clipboard: (
    <>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  externalLink: (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** shared.ts's icon(): one text line's height, hidden from assistive tech. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/**
 * html.ts's copyButton: app.js reads the target element's textContent, and
 * falls back to selecting it where navigator.clipboard is unavailable.
 */
export function CopyButton({ target, label, extraClass = "" }: { target: string; label: string; extraClass?: string }) {
  return (
    <button type="button" className={`${COPY_BUTTON} ${extraClass}`} data-copy-target={target} aria-label={label}>
      <span data-copy-icon="idle">
        <Icon name="clipboard" />
      </span>
      <span data-copy-icon="copied" className="hidden">
        <Icon name="check" />
      </span>
    </button>
  );
}

/** html.ts's commandBlock without a cwd caption: a command box and its copy button. */
export function CommandBlock({ id, value, label }: { id: string; value: string; label: string }) {
  return (
    <div className="relative">
      <pre id={id} className={CODE_LINE}>
        {value}
      </pre>
      <CopyButton target={id} label={label} extraClass={COPY_IN_LINE} />
    </div>
  );
}

/**
 * html.ts's failureLine: a failed deploy's tag, the step the reconciler
 * recorded, and where the whole run is logged. Nothing unless `result` is
 * failed. `commandId` is per row on the board, where several can share a page.
 */
export function FailureLine({
  facts,
  extraClass = "",
  commandId = "cmd-reconcile-log",
}: {
  facts: FailureFacts;
  extraClass?: string;
  commandId?: string;
}) {
  if (facts.result !== "failed") return null;
  const tail = facts.failedStep ? " at this step:" : ".";
  const what = facts.target ? (
    <>
      {"Deploying "}
      <span className={MONO_FACT}>{facts.target}</span>
      {` failed${tail}`}
    </>
  ) : (
    `The last deploy failed${tail}`
  );
  const retry = facts.target
    ? "The reconciler retries this tag on every run; its log for the last hour shows each attempt:"
    : "The reconciler's log for the last hour has the latest attempt:";
  return (
    <div className={`flex flex-col gap-2 ${extraClass}`} data-deploy-failed="">
      <p className={BODY}>{what}</p>
      {facts.failedStep ? (
        <p className={`${SERVICE_DETAIL} text-stone-300`} data-failed-step="">
          {facts.failedStep}
        </p>
      ) : null}
      <p className={BODY}>{retry}</p>
      <CommandBlock
        id={commandId}
        value={'journalctl -u lychee-reconcile -u lychee-reconcile-app --since "1 hour ago"'}
        label="Copy journal command"
      />
    </div>
  );
}
