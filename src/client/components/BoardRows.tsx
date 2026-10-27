import { Fragment, useState, type ReactNode, type Ref } from "react";
import type { ActionState, BoardPayload, BoardRow, ServiceBoard, ServiceGroup } from "../../shared/board";
import type { BoardControlsApi } from "../mutations";
import { HostActions } from "./HostActions";
import { RailLink } from "../clientNav";
import { FailureLine } from "./CommandBlock";
import { OfferLine, PruneLine, RequestedLine } from "./DeployLines";
import { summarizeRow } from "../../views/boardFacts";
import {
  GROUP_LABELS,
  SITE_NAME_LINK,
  boardContent,
  groupNoneSentence,
  inventoryFreshness,
  RETIRING_REASON,
  rowOffer,
  rowShown,
  siteLinkHost,
  unavailableSentence,
  unknownSentence,
} from "../../views/boardRowModel";
import {
  BODY,
  FOCUS_RING,
  FRAME_WIDTH,
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
 * node-free modules (boardFacts.ts, boardRowModel.ts) as the site page. The
 * offer, requested line and Prune control are DeployLines.tsx's, shared with
 * the React site page's repository card, so the two pages render them from
 * one component each (BoardMarkup.test.tsx checks the offer and Prune line
 * are the same DOM on both). Their server twins in html.ts are retired with
 * both server pages.
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

type RowContext = {
  board: ServiceBoard;
  now: Date;
  domain: string;
  prunable: ReadonlySet<string>;
  retiring: ReadonlySet<string>;
  managed: ReadonlySet<string>;
  requested: Readonly<Record<string, string>>;
  lastRuns: Readonly<Record<string, ActionState>>;
  controls?: BoardControls;
};

/** Own properties only, as the server reads them: a row named `toString` has no run. */
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * What a row shows: its summary, its retired treatment and its pill labels.
 * One function, so the attention summary above the rows can never name a row
 * differently from how the row itself reads.
 */
function rowState(row: BoardRow, ctx: RowContext, run: ActionState | undefined) {
  const { board, now, domain, prunable, retiring } = ctx;
  // The row's words come from the same builders the HTML board uses; its pill
  // from rowShown, which the rail's counts read too.
  const summary = summarizeRow(row, board, now);
  const { labels, retired } = rowShown(row, { prunable, retiring, domain, run });
  return { summary, retired, labels };
}

/** A row needs attention when what it shows is bad: a Scorch pill or a Scorch deploy line. */
function needsAttention(row: BoardRow, ctx: RowContext): boolean {
  const { summary, labels } = rowState(row, ctx, own(ctx.lastRuns, row.name));
  return labels.tone === "bad" || summary.trouble?.tone === "bad";
}

/** A row whose state could not be read: a neutral `unknown` pill, not already trouble. */
function isUnknownRow(row: BoardRow, ctx: RowContext): boolean {
  const { summary, labels } = rowState(row, ctx, own(ctx.lastRuns, row.name));
  return labels.pill === "unknown" && labels.tone !== "bad" && summary.trouble?.tone !== "bad";
}

/** One half of the summary: a count, then the rows it counts, each a link to its row. */
function SummaryPart({ count, names, className }: { count: string; names: string[]; className: string }) {
  return (
    <>
      <span className={`font-mono ${className}`} data-summary-count="">
        {count}
      </span>
      {": "}
      {names.map((name, i) => (
        <Fragment key={name}>
          {i > 0 ? ", " : null}
          <a href={`#service-${name}`} className={`font-mono text-stone-50 underline decoration-stone-600 underline-offset-2 ${FOCUS_RING}`}>
            {name}
          </a>
        </Fragment>
      ))}
      .
    </>
  );
}

/**
 * The board leads with trouble (critique 2026-10-26 P1): one line naming the
 * rows that need attention, then, apart and neutral, the rows whose state
 * could not be read (2026-10-27 P1), so it counts what the rail's two chips
 * count. Each name links to its row; the rows keep their inventory order.
 * Absent when there is neither.
 */
function AttentionSummary({ bad, unknown }: { bad: string[]; unknown: string[] }) {
  if (bad.length === 0 && unknown.length === 0) return null;
  return (
    <p className={`${BODY} max-w-none`} data-attention-summary="">
      {bad.length > 0 ? (
        <SummaryPart count={`${bad.length} ${bad.length === 1 ? "needs" : "need"} attention`} names={bad} className="text-red-300" />
      ) : null}
      {bad.length > 0 && unknown.length > 0 ? " " : null}
      {unknown.length > 0 ? <SummaryPart count={`${unknown.length} unknown`} names={unknown} className="text-stone-300" /> : null}
    </p>
  );
}

export function ServiceRow({ row, ctx }: { row: BoardRow; ctx: RowContext }) {
  const { now, domain, managed } = ctx;
  const payloadRun = own(ctx.lastRuns, row.name);
  // A host action this row is following (HostActions sets it from a 202 and
  // each poll answer) outranks the payload until the run settles and the
  // board has been re-read: a board read mid-run can still show the last run.
  const [live, setLive] = useState<ActionState | null>(null);
  const run = live ?? payloadRun;
  const { summary, retired, labels } = rowState(row, ctx, run);
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
            <RailLink href={`/sites/${siteHost}`} className={SITE_NAME_LINK}>
              {row.name}
            </RailLink>
          ) : (
            row.name
          )}
        </p>
        {trouble ? (
          // The key is a machine word, so mono; the reason after it is a phrase, so sans.
          <p className="text-[0.8rem] leading-relaxed m-0" data-deploy-state="">
            <span className={`font-mono ${TONE_TEXT[trouble.tone]}`}>
              {/* One text node, as the server writes it: split nodes shift the
                  word by a fraction of a pixel and change its antialiasing. */}
              <Dot />
              {` deploy ${trouble.word}`}
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
        {retired === "retiring" ? (
          <p className="text-[0.8rem] leading-relaxed m-0" data-retiring="">
            <span className={`font-mono ${TONE_TEXT.neutral}`}>
              {/* One text node, as the deploy line writes its word. */}
              <Dot />
              {" retiring"}
            </span>{" "}
            <span className="text-stone-400">· {RETIRING_REASON}</span>
          </p>
        ) : null}
        {unknown ? <p className={BODY}>{unknown}</p> : null}
        {gate ? (
          <p className={`${SERVICE_DETAIL} text-stone-300`} data-gate="">
            {gate}
          </p>
        ) : null}
        <FailureLine facts={row} extraClass="mt-1.5" commandId={`cmd-reconcile-log-${row.name}`} />
        {offer ? offer.requested ? <RequestedLine tag={offer.tag} name={row.name} controls={ctx.controls} /> : <OfferLine name={row.name} tag={offer.tag} controls={ctx.controls} /> : null}
        {retired === "down" ? <PruneLine name={row.name} controls={ctx.controls} /> : null}
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
// Sans: "Couldn't refresh …: <reason>" is a sentence (spec 2026-10-26-mono-sentences).
export const BOARD_ALERT = "text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0";

/**
 * One board page's body: eyebrow, freshness line, then the rows or the
 * explanation that stands in for them, and, when a row offers a tag, the
 * inert requested-line template the retired server board appended for
 * app.js. Nothing reads it any more (app.js's consumer went with the server
 * site page); it is kept only because the board's frozen parity fixtures
 * carry it.
 */
export function Board({ payload, group, controls, headingRef, alert }: BoardProps) {
  const { board, boardEmpty } = payload;
  const now = new Date(payload.now);
  const ctx: RowContext = {
    board,
    now,
    domain: payload.domain,
    prunable: new Set(payload.prunable),
    retiring: new Set(payload.retiring),
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
        {shown === "rows" ? <AttentionSummary
            bad={rows.filter((r) => needsAttention(r, ctx)).map((r) => r.name)}
            unknown={rows.filter((r) => isUnknownRow(r, ctx)).map((r) => r.name)}
          /> : null}
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
