import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import type { ActionState, BoardPayload, BoardRow, ServiceBoard, ServiceGroup } from "../../shared/board";
import type { BoardControlsApi } from "../mutations";
import { HostActions } from "./HostActions";
import { summarizeRow } from "../../views/boardFacts";
import {
  GROUP_LABELS,
  SITE_NAME_LINK,
  boardContent,
  groupNoneSentence,
  inventoryFreshness,
  rowOffer,
  rowPill,
  showsPrune,
  siteLinkHost,
  unavailableSentence,
  unknownSentence,
} from "../../views/boardRowModel";
import {
  BODY,
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
 * The services board's markup in JSX. It was ported element for element from
 * the server board (renderServicesPage and its row helpers, now retired); the
 * parity tests compare it with that board's output, frozen in
 * src/dev/fixtures/board/. It takes every decision from the same
 * node-free modules (boardFacts.ts, boardRowModel.ts) as the server-rendered
 * site page, whose offer, requested line and Prune control are still
 * renderOfferLine, renderRequestedLine and renderPruneControl in
 * src/views/html.ts: a change to one of those three belongs in both
 * (BoardMarkup.test.tsx checks the offer and Prune line are the same DOM).
 *
 * The controls render as the server's do (same data-* attributes, classes and
 * text) and are wired through `controls`: Deploy, Prune and the host actions
 * (the strip is HostActions.tsx). Without `controls` they are inert.
 */

/** The board's writes. Absent, or a member absent, that control renders as inert markup, byte for byte what it is wired. */
export type BoardControls = Partial<BoardControlsApi>;

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
function OfferLine({ name, tag, controls }: { name: string; tag: string; controls?: BoardControls }) {
  const deploy = controls?.deploy;
  return (
    <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-offer="">
      <span className="font-mono text-[0.8rem] text-rose-300">{`${tag} available`}</span>
      <button
        type="button"
        className={BUTTON_OFFER}
        data-deploy={name}
        data-deploy-tag={tag}
        disabled={controls?.busy?.has(name) || undefined}
        onClick={deploy ? () => deploy(name, tag) : undefined}
      >
        {`Deploy ${tag}`}
      </button>
    </p>
  );
}

/** html.ts's renderRequestedLine: the offer's place once its tag is in the declaration. */
function RequestedLine({ tag, name, controls }: { tag: string; name?: string; controls?: BoardControls }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const wanted = name !== undefined && controls?.focusRequested === name;
  const focused = controls?.focused;
  // A Deploy's button is gone once this line replaces the offer: focus goes
  // here, as app.js's line.focus() did.
  useEffect(() => {
    if (!wanted) return;
    ref.current?.focus();
    focused?.();
  }, [wanted, focused]);
  return (
    <p
      ref={ref}
      className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5"
      data-requested=""
      role="status"
      tabIndex={-1}
    >
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
function PruneLine({ name, controls }: { name: string; controls?: BoardControls }) {
  const prune = controls?.prune;
  return (
    <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-prune-line="">
      <button
        type="button"
        className={BUTTON_SECONDARY_COMPACT}
        data-prune={name}
        disabled={controls?.busy?.has(name) || undefined}
        onClick={prune ? () => prune(name) : undefined}
      >
        Prune old declaration
      </button>
      <span className="font-mono text-[0.72rem] text-stone-400 break-all">
        {`deletes ${name}.yml from lychee-resources${NBSP}`}
        <span className="whitespace-nowrap">· once its container is confirmed down</span>
      </span>
    </p>
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
  controls?: BoardControls;
};

/** Own properties only, as the server reads them: a row named `toString` has no run. */
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function ServiceRow({ row, ctx }: { row: BoardRow; ctx: RowContext }) {
  const { board, now, domain, prunable, managed } = ctx;
  const payloadRun = own(ctx.lastRuns, row.name);
  // A host action this row is following (HostActions sets it from a 202 and
  // each poll answer) outranks the payload until the run settles and the
  // board has been re-read: a board read mid-run can still show the last run.
  const [live, setLive] = useState<ActionState | null>(null);
  const run = live ?? payloadRun;
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
        {offer ? offer.requested ? <RequestedLine tag={offer.tag} name={row.name} controls={ctx.controls} /> : <OfferLine name={row.name} tag={offer.tag} controls={ctx.controls} /> : null}
        {showsPrune(row.name, prunable, domain) ? <PruneLine name={row.name} controls={ctx.controls} /> : null}
        <HostActions row={row} run={payloadRun} live={live} onLive={setLive} now={now} api={ctx.controls?.hostActions} />
      </div>
    </li>
  );
}

export type BoardProps = {
  payload: BoardPayload;
  group: ServiceGroup;
  /** Absent, the controls are inert markup: nothing posts, opens or polls. BoardPage always wires them. */
  controls?: BoardControls;
  /**
   * The live page's handle on its eyebrow, which then takes focus after a
   * navigation (`tabIndex={-1}`: focusable, never in the tab order). Absent,
   * the eyebrow is exactly the server's, as the parity tests compare it.
   */
  headingRef?: Ref<HTMLHeadingElement>;
  /** A failed re-read's line, shown above the rows while the last good board stays. */
  alert?: string | null;
};

/** The add-site page's error treatment, visible. */
export const BOARD_ALERT = "font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0";

/**
 * One board page's body: eyebrow, freshness line, then the rows or the
 * explanation that stands in for them, and, when a row offers a tag, the
 * inert requested-line template the server page appends for app.js. It is
 * dead markup here, kept for parity until the server board is retired.
 */
export function Board({ payload, group, controls, headingRef, alert }: BoardProps) {
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
    controls,
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
          <h2
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0"
          >
            {GROUP_LABELS[group]}
          </h2>
          {freshness ? (
            <p className={`m-0 text-[0.8rem] text-stone-400 ${PROSE_MEASURE}`} data-inventory-age="">
              {freshness}
            </p>
          ) : null}
        </div>
        {alert ? (
          <p role="alert" className={BOARD_ALERT}>
            {alert}
          </p>
        ) : null}
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
