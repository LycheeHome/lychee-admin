import type { ReactNode } from "react";
import type { BoardRow, ServiceBoard } from "../../shared/board";
import { summarizeRow } from "../../views/boardFacts";
import {
  BODY,
  CODE_LINE,
  COPY_BUTTON,
  COPY_IN_LINE,
  FRAME_WIDTH,
  MONO_FACT,
  PROSE_MEASURE,
  SERVICE_DETAIL,
  SERVICE_NAME,
  SERVICE_ROW,
  TONE_PILL,
  TONE_TEXT,
  formatAge,
} from "../../views/shared";

/*
 * The services board's markup in JSX, for the groups React renders. It
 * mirrors renderServicesPage and renderServiceRow in src/views/html.ts
 * element for element — the parity test compares the two — so a change to
 * either belongs in both until the server page is retired.
 *
 * Not rendered here, because no infrastructure row carries them: a Deploy
 * offer, Prune, and the host-action strip. A row that lists actions renders
 * without the strip.
 */

function Dot() {
  return <span aria-hidden="true">{"●"}</span>;
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      className="w-[1em] h-[1em] shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** html.ts's commandBlock without a cwd caption: a command box and its copy button. */
function CommandBlock({ id, value, label }: { id: string; value: string; label: string }) {
  return (
    <div className="relative">
      <pre id={id} className={CODE_LINE}>
        {value}
      </pre>
      <button type="button" className={`${COPY_BUTTON} ${COPY_IN_LINE}`} data-copy-target={id} aria-label={label}>
        <span data-copy-icon="idle">
          <Svg>
            <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          </Svg>
        </span>
        <span data-copy-icon="copied" className="hidden">
          <Svg>
            <path d="M20 6 9 17l-5-5" />
          </Svg>
        </span>
      </button>
    </div>
  );
}

/** html.ts's failureLine: a failed deploy's tag, step and journal. */
function FailureLine({ row, extraClass, commandId }: { row: BoardRow; extraClass: string; commandId: string }) {
  if (row.result !== "failed") return null;
  const tail = row.failedStep ? " at this step:" : ".";
  const what = row.target ? (
    <>
      Deploying <span className={MONO_FACT}>{row.target}</span> failed{tail}
    </>
  ) : (
    `The last deploy failed${tail}`
  );
  const retry = row.target
    ? "The reconciler retries this tag on every run; its log for the last hour shows each attempt:"
    : "The reconciler's log for the last hour has the latest attempt:";
  return (
    <div className={`flex flex-col gap-2 ${extraClass}`} data-deploy-failed="">
      <p className={BODY}>{what}</p>
      {row.failedStep ? (
        <p className={`${SERVICE_DETAIL} text-stone-300`} data-failed-step="">
          {row.failedStep}
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

export function ServiceRow({ row, board, now }: { row: BoardRow; board: ServiceBoard; now: Date }) {
  // The row's words come from the same builder the HTML board uses.
  const { labels, trouble, gate, facts } = summarizeRow(row, board, now);

  return (
    <li className={SERVICE_ROW} id={`service-${row.name}`} data-service={row.name}>
      <div className="pt-px" data-row-pill="">
        <span className={TONE_PILL[labels.tone]}>
          <Dot /> {labels.pill}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        {/* Plain text: an infrastructure unit is never a managed site. */}
        <p className={SERVICE_NAME}>{row.name}</p>
        {trouble ? (
          <p className="font-mono text-[0.8rem] leading-relaxed m-0" data-deploy-state="">
            <span className={TONE_TEXT[trouble.tone]}>
              <Dot /> deploy {trouble.word}
            </span>
            {gate !== null || trouble.reason === `deploy ${trouble.word}` ? null : (
              <>
                {" "}
                <span className="text-stone-400">· {trouble.reason}</span>
              </>
            )}
          </p>
        ) : null}
        {facts.length > 0 ? <p className={SERVICE_DETAIL}>{facts.join(" · ")}</p> : null}
        {labels.pill === "unknown" ? (
          <p className={SERVICE_DETAIL}>
            {row.kind === "container"
              ? "lychee-admin couldn't read this container's state."
              : "lychee-admin couldn't read this unit's state from systemd."}
          </p>
        ) : null}
        {gate ? (
          <p className={`${SERVICE_DETAIL} text-stone-300`} data-gate="">
            {gate}
          </p>
        ) : null}
        <FailureLine row={row} extraClass="mt-1.5" commandId={`cmd-reconcile-log-${row.name}`} />
      </div>
    </li>
  );
}

/**
 * The /infrastructure page body: eyebrow, freshness line, then the rows or
 * the explanation that stands in for them. `boardEmpty` is whether the WHOLE
 * board had no groups, which the API's narrowing to one group would otherwise
 * hide: an empty board gets the unavailable explanation on every page.
 */
export function InfrastructureBoard({ board, boardEmpty, now }: { board: ServiceBoard; boardEmpty: boolean; now: Date }) {
  const written = formatAge(board.generated, now);
  const freshness = board.inventoryAvailable
    ? written
      ? `Inventory written ${written}`
      : "Inventory write time unknown"
    : "";
  const rows = board.groups.find((g) => g.group === "infrastructure")?.rows ?? [];

  let content: ReactNode;
  if (!board.inventoryAvailable || boardEmpty) {
    content = (
      <p
        id="inventory-unavailable"
        className="m-0 max-w-[62ch] text-[0.9rem] leading-relaxed text-stone-300 border border-stone-700 rounded-md px-4 py-3"
      >
        There are no infrastructure units to show: the inventory could not be read, or it declares none this page
        recognises. Without it there is no list of what should be running and nothing to check live state against. It is
        published by the reconciler on each tick; if it has never run, or the file was removed, this page stays empty.
      </p>
    );
  } else if (rows.length > 0) {
    content = (
      <ul className="list-none m-0 p-0 flex flex-col">
        {rows.map((r) => (
          <ServiceRow key={r.name} row={r} board={board} now={now} />
        ))}
      </ul>
    );
  } else {
    content = (
      <p id="group-empty" className="m-0 text-[0.9rem] leading-relaxed text-stone-300">
        The inventory lists no infrastructure units.
      </p>
    );
  }

  return (
    <div className={`${FRAME_WIDTH} flex flex-col gap-8`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0">Infrastructure</h2>
        {freshness ? (
          <p className={`m-0 text-[0.8rem] text-stone-400 ${PROSE_MEASURE}`} data-inventory-age="">
            {freshness}
          </p>
        ) : null}
      </div>
      {content}
    </div>
  );
}
