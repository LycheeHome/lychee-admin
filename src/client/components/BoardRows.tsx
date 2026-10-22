import type { ReactNode } from "react";
import type { ActionState, BoardPayload, BoardRow, ServiceBoard, ServiceGroup } from "../../shared/board";
import type { HostAction } from "../../lib/platform";
import { summarizeRow } from "../../views/boardFacts";
import {
  ACTION_CONFIRM,
  ACTION_LABEL,
  CONFIRM_DANGER,
  CONFIRM_QUIET,
  GROUP_LABELS,
  LOG_SUMMARY,
  LOG_TAIL,
  RUNNING_DOT,
  SITE_NAME_LINK,
  actionBusy,
  actionFact,
  actionLog,
  actionTail,
  boardContent,
  groupNoneSentence,
  hasHostActions,
  inventoryFreshness,
  isRunning,
  rowOffer,
  rowPill,
  shownActions,
  showsPrune,
  siteLinkHost,
  unavailableSentence,
  unknownSentence,
} from "../../views/boardRowModel";
import {
  BODY,
  BUTTON_DANGER,
  BUTTON_OFFER,
  BUTTON_SECONDARY_COMPACT,
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
} from "../../views/shared";

/*
 * The services board's markup in JSX. It mirrors renderServicesPage,
 * renderServiceRow, renderHostActions, renderOfferLine, renderRequestedLine
 * and renderPruneControl in src/views/html.ts element for element (the
 * parity test compares the two), and takes every decision from the same
 * node-free modules (boardFacts.ts, boardRowModel.ts), so a change to the
 * markup belongs in both until the server board is retired.
 *
 * The controls render inert: the same data-* attributes, classes and text as
 * the server's, with no handlers. Tasks 3 and 4 wire them through `controls`.
 */

/** The hook point for the board's writes. Tasks 3 and 4 give it members; absent, every control is inert markup. */
export type BoardControls = Record<string, never>;

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

/** html.ts's renderOfferLine at the board's emphasis. */
function OfferLine({ name, tag }: { name: string; tag: string }) {
  return (
    <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-offer="">
      <span className="font-mono text-[0.8rem] text-rose-300">{`${tag} available`}</span>
      <button type="button" className={BUTTON_OFFER} data-deploy={name} data-deploy-tag={tag}>
        {`Deploy ${tag}`}
      </button>
    </p>
  );
}

/** html.ts's renderRequestedLine: the offer's place once its tag is in the declaration. */
function RequestedLine({ tag }: { tag: string }) {
  return (
    <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-requested="" role="status" tabIndex={-1}>
      <span className="font-mono text-[0.8rem] text-stone-50">
        <span data-requested-tag="">{tag}</span> requested
      </span>{" "}
      <span className="text-stone-400">· applies on the next run</span>
    </p>
  );
}

/** The server's `&nbsp;`, as a code point: it keeps the note's tail on the filename's line. */
const NBSP = String.fromCharCode(0xa0);

/** html.ts's renderPruneControl at the board's (secondary) emphasis. */
function PruneLine({ name }: { name: string }) {
  return (
    <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-prune-line="">
      <button type="button" className={BUTTON_SECONDARY_COMPACT} data-prune={name}>
        Prune old declaration
      </button>
      <span className="font-mono text-[0.72rem] text-stone-400 break-all">
        {`deletes ${name}.yml from lychee-resources${NBSP}`}
        <span className="whitespace-nowrap">· once its container is confirmed down</span>
      </span>
    </p>
  );
}

/** html.ts's actionFact: the last run as a fact line's content. */
function ActionFactText({ run, now }: { run: ActionState | undefined; now: Date }) {
  const fact = actionFact(run, now);
  if (!fact) return null;
  if (fact.running) {
    return (
      <>
        <span className={RUNNING_DOT} aria-hidden="true"></span>
        {`${fact.action} running${fact.started ? ` · started ${fact.started}` : ""}`}
      </>
    );
  }
  const rest = [fact.age, fact.took ? `took ${fact.took}` : null].filter((p): p is string => Boolean(p));
  return (
    <>
      {`${fact.action} `}
      <span className={TONE_TEXT[fact.tone]}>{fact.state}</span>
      {rest.map((p) => ` · ${p}`).join("")}
    </>
  );
}

/** html.ts's actionLog: a finished run's log, open when it failed. */
function ActionLog({ run }: { run: ActionState | undefined }) {
  const log = actionLog(run);
  if (!log) return null;
  if (log.body === null) {
    return (
      <p className={SERVICE_DETAIL} data-action-log="">
        log · no output
      </p>
    );
  }
  return (
    <details className="mt-0.5" data-action-log="" open={log.open}>
      <summary className={`${SERVICE_DETAIL} ${LOG_SUMMARY}`}>{`log · ${log.lines} ${log.lines === 1 ? "line" : "lines"}`}</summary>
      <pre className={LOG_TAIL}>{log.body}</pre>
    </details>
  );
}

/** One inline confirmation, hidden until its action is pressed. */
function ActionConfirm({ unit, action }: { unit: string; action: HostAction }) {
  const c = ACTION_CONFIRM[action];
  if (!c) return null;
  const textId = `action-confirm-${unit}-${action}`;
  const stop = action === "stop";
  return (
    <div className={stop ? CONFIRM_DANGER : CONFIRM_QUIET} data-action-confirm={action} role="group" aria-labelledby={textId} hidden>
      <p id={textId} className="m-0 flex-[1_1_28ch] text-[0.85rem] leading-snug text-stone-300">
        {c.copy(unit)}
      </p>
      <div className="flex items-center gap-2.5">
        <button type="button" className={BUTTON_SECONDARY_COMPACT} data-action-cancel="">
          Cancel
        </button>
        <button type="button" className={stop ? BUTTON_DANGER : BUTTON_OFFER} data-action-go={action}>
          {c.go}
        </button>
      </div>
    </div>
  );
}

/** html.ts's renderHostActions: the last run, its log, the strip and the confirmations. */
function HostActions({ row, run, now }: { row: BoardRow; run: ActionState | undefined; now: Date }) {
  if (!hasHostActions(row)) return null;
  const shown = shownActions(row);
  const running = isRunning(run);
  const fact = actionFact(run, now);
  return (
    <div
      className="flex flex-col gap-0.5"
      data-host-actions={row.name}
      data-neutral-pill={TONE_PILL.neutral}
      data-running={running ? run.action : undefined}
    >
      <p className={SERVICE_DETAIL} data-action-fact="" hidden={!fact}>
        <ActionFactText run={run} now={now} />
      </p>
      <ActionLog run={run} />
      <pre className={LOG_TAIL} data-action-tail="" aria-live="off" hidden={!running}>
        {actionTail(run)}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-2" data-action-strip="">
        {shown.map((a) => (
          <button
            key={a}
            type="button"
            className={a === "stop" ? BUTTON_DANGER : BUTTON_SECONDARY_COMPACT}
            data-host-action={a}
            disabled={running}
          >
            {ACTION_LABEL[a]}
          </button>
        ))}
        <span className="text-[0.8rem] text-stone-400" data-action-busy="" role="status" hidden={!running}>
          {actionBusy(row.name)}
        </span>
      </div>
      {shown.map((a) => (
        <ActionConfirm key={a} unit={row.name} action={a} />
      ))}
    </div>
  );
}

type RowContext = {
  board: ServiceBoard;
  now: Date;
  domain: string;
  prunable: ReadonlySet<string>;
  managed: ReadonlySet<string>;
  requested: Readonly<Record<string, string>>;
  lastRuns: Readonly<Record<string, ActionState>>;
};

/** Own properties only, as the server reads them: a row named `toString` has no run. */
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function ServiceRow({ row, ctx }: { row: BoardRow; ctx: RowContext }) {
  const { board, now, domain, prunable, managed } = ctx;
  const run = own(ctx.lastRuns, row.name);
  // The row's words come from the same builders the HTML board uses.
  const summary = summarizeRow(row, board, now);
  const labels = rowPill(summary.labels, run);
  const { trouble, gate, facts } = summary;
  const offer = rowOffer(row, own(ctx.requested, row.name));
  const siteHost = siteLinkHost(row.name, domain, managed);
  const unknown = unknownSentence(row, labels, run);

  return (
    <li className={SERVICE_ROW} id={`service-${row.name}`} data-service={row.name}>
      <div className="pt-px" data-row-pill="">
        <span className={TONE_PILL[labels.tone]}>
          <Dot /> {labels.pill}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <p className={SERVICE_NAME}>
          {siteHost ? (
            <a href={`/sites/${siteHost}`} className={SITE_NAME_LINK}>
              {row.name}
            </a>
          ) : (
            row.name
          )}
        </p>
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
        {unknown ? <p className={SERVICE_DETAIL}>{unknown}</p> : null}
        {gate ? (
          <p className={`${SERVICE_DETAIL} text-stone-300`} data-gate="">
            {gate}
          </p>
        ) : null}
        <FailureLine row={row} extraClass="mt-1.5" commandId={`cmd-reconcile-log-${row.name}`} />
        {offer ? offer.requested ? <RequestedLine tag={offer.tag} /> : <OfferLine name={row.name} tag={offer.tag} /> : null}
        {showsPrune(row.name, prunable, domain) ? <PruneLine name={row.name} /> : null}
        <HostActions row={row} run={run} now={now} />
      </div>
    </li>
  );
}

export type BoardProps = {
  payload: BoardPayload;
  group: ServiceGroup;
  /** Unread until Tasks 3 and 4: absent, the controls are inert markup. */
  controls?: BoardControls;
};

/**
 * One board page's body: eyebrow, freshness line, then the rows or the
 * explanation that stands in for them, and, when a row offers a tag, the
 * inert requested-line template the server page appends for app.js. It is
 * dead markup here, kept for parity until the server board is retired.
 */
export function Board({ payload, group }: BoardProps) {
  const { board, boardEmpty } = payload;
  const now = new Date(payload.now);
  const ctx: RowContext = {
    board,
    now,
    domain: payload.domain,
    prunable: new Set(payload.prunable),
    managed: new Set(payload.managed),
    requested: payload.requested,
    lastRuns: payload.lastRuns,
  };
  const freshness = inventoryFreshness(board, now);
  const rows = board.groups.find((g) => g.group === group)?.rows ?? [];
  const shown = boardContent(board.inventoryAvailable, boardEmpty, rows.length);
  const offers = shown === "rows" && rows.some((r) => rowOffer(r, own(payload.requested, r.name))?.requested === false);

  let content: ReactNode;
  if (shown === "unavailable") {
    content = (
      <p
        id="inventory-unavailable"
        className="m-0 max-w-[62ch] text-[0.9rem] leading-relaxed text-stone-300 border border-stone-700 rounded-md px-4 py-3"
      >
        {unavailableSentence(group)}
      </p>
    );
  } else if (shown === "rows") {
    content = (
      <ul className="list-none m-0 p-0 flex flex-col">
        {rows.map((r) => (
          <ServiceRow key={r.name} row={r} ctx={ctx} />
        ))}
      </ul>
    );
  } else {
    content = (
      <p id="group-empty" className="m-0 text-[0.9rem] leading-relaxed text-stone-300">
        {groupNoneSentence(group)}
      </p>
    );
  }

  return (
    <>
      <div className={`${FRAME_WIDTH} flex flex-col gap-8`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0">{GROUP_LABELS[group]}</h2>
          {freshness ? (
            <p className={`m-0 text-[0.8rem] text-stone-400 ${PROSE_MEASURE}`} data-inventory-age="">
              {freshness}
            </p>
          ) : null}
        </div>
        {content}
      </div>
      {offers ? (
        <template data-requested-template="">
          <RequestedLine tag="TAG" />
        </template>
      ) : null}
    </>
  );
}
