import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ActionState, BoardRow } from "../../shared/board";
import type { HostAction } from "../../lib/platform";
import type { HostActionsApi } from "../mutations";
import { decidePoll, type PollMemo, type PollOutcome } from "../actionPoll";
import {
  ACTION_CONFIRM,
  ACTION_LABEL,
  CONFIRM_DANGER,
  CONFIRM_QUIET,
  LOG_SUMMARY,
  LOG_TAIL,
  RUNNING_DOT,
  actionBusy,
  actionFact,
  actionLog,
  actionTail,
  hasHostActions,
  isRunning,
  shownActions,
} from "../../views/boardRowModel";
import { BUTTON_DANGER, BUTTON_OFFER, BUTTON_SECONDARY_COMPACT, SERVICE_DETAIL, TONE_PILL, TONE_TEXT } from "../../views/shared";

/*
 * The host-action strip: the retired renderHostActions (html.ts) in JSX,
 * element for element (the parity tests compare it with that markup, frozen),
 * with the behaviour of the [data-host-actions] block public/app.js had.
 *
 * Start posts at once; Stop, Restart and Update replace the strip with their
 * inline confirmation, focus on its Cancel, and Esc or Cancel gives focus back
 * to the button that opened it. A 202 puts the row into its running state
 * here (the job was only queued, so a board read now could still show the
 * previous run), and the strip polls the action's state every
 * ACTION_POLL_MS, each answer decided by decidePoll, which is what makes the
 * poll end. Where app.js reloaded the page, this re-reads the board (`settle`)
 * and the fresh payload decides the row. The poll is this component's: it is
 * a timer cleared on unmount, and an answer that lands after unmount does
 * nothing.
 *
 * Without `api` the strip is inert markup: nothing opens, nothing polls.
 */

/** The state route's poll interval, app.js's ACTION_POLL_MS. Separate from the board's own refetch. */
export const ACTION_POLL_MS = 2000;

/**
 * The poll's timers, swappable so a test can hold exactly this poll's ticks.
 * Holding every global timer of ACTION_POLL_MS also caught TanStack's stale
 * timer, which is 2000 ms too whenever a millisecond passes between a read
 * landing and the timer being set. The defaults look the globals up per call,
 * so `mock.timers` still intercepts them.
 */
export const pollTimers = {
  set: (fn: () => void, ms: number): ReturnType<typeof setTimeout> => setTimeout(fn, ms),
  clear: (id: ReturnType<typeof setTimeout> | undefined): void => clearTimeout(id),
};

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

type ConfirmProps = {
  unit: string;
  action: HostAction;
  open: boolean;
  disabled: boolean;
  onCancel: () => void;
  onGo: () => void;
};

/** One inline confirmation, hidden until its action is pressed. */
function ActionConfirm({ unit, action, open, disabled, onCancel, onGo }: ConfirmProps) {
  const c = ACTION_CONFIRM[action];
  if (!c) return null;
  const textId = `action-confirm-${unit}-${action}`;
  const stop = action === "stop";
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") onCancel();
  };
  return (
    <div
      className={stop ? CONFIRM_DANGER : CONFIRM_QUIET}
      data-action-confirm={action}
      role="group"
      aria-labelledby={textId}
      hidden={!open}
      onKeyDown={onKeyDown}
    >
      <p id={textId} className="m-0 flex-[1_1_28ch] text-[0.85rem] leading-snug text-stone-300">
        {c.copy(unit)}
      </p>
      <div className="flex items-center gap-2.5">
        <button type="button" className={BUTTON_SECONDARY_COMPACT} data-action-cancel="" disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={stop ? BUTTON_DANGER : BUTTON_OFFER} data-action-go={action} disabled={disabled} onClick={onGo}>
          {c.go}
        </button>
      </div>
    </div>
  );
}

export type HostActionsProps = {
  row: BoardRow;
  /** The row's last run as the board's payload has it. */
  run: ActionState | undefined;
  /**
   * The run this row is following, fresher than the payload's: set from a
   * 202 and from each poll answer, cleared once the run settles and the board
   * has been re-read. The row's pill reads it too, which is why the row owns
   * it.
   */
  live: ActionState | null;
  onLive: (run: ActionState | null) => void;
  /** The payload's clock. A live run's age is measured against this browser's instead, as app.js did. */
  now: Date;
  /** Absent: inert markup. */
  api?: HostActionsApi;
};

/** Where focus goes after the next commit. */
type FocusTarget = { to: "cancel" | "opener" | "strip"; action: HostAction } | { to: "fact" };

/**
 * A settled row's strip takes focus: the same action's button when it is
 * still offered (Restart after a restart), else the first one live (Start
 * after a stop), so focus never drops to <body>.
 */
function focusStrip(box: HTMLElement, action: HostAction): void {
  const enabled = (el: Element | null) => (el instanceof HTMLButtonElement && !el.disabled ? el : null);
  const el =
    enabled(box.querySelector(`[data-host-action="${action}"]`)) ??
    Array.from(box.querySelectorAll("[data-host-action]")).map(enabled).find((b) => b !== null) ??
    null;
  el?.focus();
}

/** The run's new state, read from a poll answer decidePoll called "update". */
function polledState(outcome: PollOutcome): ActionState | null {
  if (outcome.kind !== "response") return null;
  const state = (outcome.body as { state?: ActionState } | null)?.state;
  return state && typeof state === "object" ? state : null;
}

/** A finished run's state from a 2xx answer, or null (a refusal, a failure, a run still going, an idle unit). */
function settledState(outcome: PollOutcome): ActionState | null {
  if (outcome.kind !== "response" || outcome.status < 200 || outcome.status >= 300) return null;
  if ((outcome.body as { ok?: unknown } | null)?.ok !== true) return null;
  const state = polledState(outcome);
  return state && (state.state === "succeeded" || state.state === "failed") ? state : null;
}

/** One run's identity across reads: its action and when it started. */
function runKey(run: ActionState): string {
  return `${run.action}@${run.startedAt ?? ""}`;
}

export function HostActions({ row, run, live, onLive, now, api }: HostActionsProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState<HostAction | null>(null);
  const [posting, setPosting] = useState(false);
  // A run this strip asked for, and when: decidePoll waits out the previous
  // run's settled state for a run that was clicked.
  const [follow, setFollow] = useState<{ action: HostAction; clickedAt: number } | null>(null);
  const [settling, setSettling] = useState(false);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const postingRef = useRef(false);
  const mounted = useRef(false);
  // The latest callbacks, for the poll's timer: they change identity every
  // render, and the poll must not restart because of it.
  // Runs the poll has seen settle (runKey), which the board's data may still
  // show as running for a while: those are never followed again, and the
  // settled state the poll read stands in for them until the board catches up.
  const [settledKeys, setSettledKeys] = useState<readonly string[]>([]);
  const latest = useRef({ api, onLive, row, run });
  latest.current = { api, onLive, row, run };
  const stripFocus = useRef<{ row: BoardRow; action: HostAction } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Which run to poll, if any: the one this strip started, else one the
  // board shows under way (a run started elsewhere, or before this page
  // loaded), which app.js followed with clickedAt null.
  const boardRunning = isRunning(run) && !settledKeys.includes(runKey(run)) ? run : null;
  const target = !api || settling ? null : (follow ?? (boardRunning ? { action: boardRunning.action, clickedAt: null } : null));
  const targetAction = target?.action ?? null;
  const targetClickedAt = target?.clickedAt ?? null;

  // `live` stands only while it says something the board's data does not
  // yet: a run this strip is following, or one the poll saw settle that the
  // board still shows running. Once it is neither, the board decides again;
  // otherwise a run the board's own re-read showed finished (or replaced
  // with another) would leave the row running for ever, with nothing polling.
  useEffect(() => {
    if (!live || settling) return;
    const stale = isRunning(live)
      ? live.action !== targetAction
      : !(isRunning(run) && settledKeys.includes(runKey(run)));
    if (stale) onLive(null);
  }, [live, settling, targetAction, run, settledKeys, onLive]);

  useEffect(() => {
    if (targetAction === null) return;
    const unit = row.name;
    const action = targetAction;
    const clickedAt = targetClickedAt;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let memo: PollMemo = { failingSince: null, stalePolls: 0 };

    /** `settled`: the run's end as the poll read it, or null when the poll gave up or was refused. */
    const settle = (settled: ActionState | null) => {
      // Read before re-rendering: is focus still in this strip (the run fact
      // has it after a click), or nowhere at all?
      const active = document.activeElement;
      const keep = !active || active === document.body || Boolean(boxRef.current?.contains(active));
      setSettling(true);
      void Promise.resolve(latest.current.api?.settle()).finally(() => {
        if (!mounted.current) return;
        if (settled) {
          // The board's data may still show this run running (its re-read can
          // lag the state route): the poll's reading stands in until it
          // catches up, and that running entry is never followed again. The
          // run the board showed at settle time is the same run, whatever
          // start time each read carries.
          const shown = latest.current.run;
          setSettledKeys([runKey(settled), ...(isRunning(shown) ? [runKey(shown)] : [])]);
        }
        // Gave up or refused: as app.js's reload did, the board decides, and
        // a run it still shows running is followed afresh.
        latest.current.onLive(settled);
        setFollow(null);
        setSettling(false);
        if (keep) {
          stripFocus.current = { row: latest.current.row, action };
          setFocus({ to: "strip", action });
        }
      });
    };

    const tick = async () => {
      let outcome: PollOutcome;
      try {
        const response = await fetch(`/services/${encodeURIComponent(unit)}/actions/${action}/state`, {
          headers: { Accept: "application/json" },
        });
        const body: unknown = await response.json().catch(() => ({}));
        outcome = { kind: "response", status: response.status, body };
      } catch {
        outcome = { kind: "network-error" };
      }
      if (cancelled) return;
      const decision = decidePoll(outcome, memo, Date.now(), clickedAt);
      memo = decision.memo;
      if (decision.next === "reload") {
        settle(settledState(outcome));
        return;
      }
      if (decision.next === "update") {
        const state = polledState(outcome);
        if (state) latest.current.onLive(state);
      }
      timer = pollTimers.set(tick, ACTION_POLL_MS);
    };
    timer = pollTimers.set(tick, ACTION_POLL_MS);
    return () => {
      cancelled = true;
      pollTimers.clear(timer);
    };
  }, [row.name, targetAction, targetClickedAt]);

  useEffect(() => {
    if (!focus) return;
    setFocus(null);
    const box = boxRef.current;
    if (!box) return;
    if (focus.to === "strip") return focusStrip(box, focus.action);
    let el: HTMLElement | null = null;
    if (focus.to === "cancel") el = box.querySelector<HTMLElement>(`[data-action-confirm="${focus.action}"] [data-action-cancel]`);
    else if (focus.to === "opener") el = box.querySelector<HTMLElement>(`[data-host-action="${focus.action}"]`);
    else el = box.querySelector<HTMLElement>("[data-action-fact]");
    el?.focus();
  }, [focus]);

  // The re-read board can reach this row a tick after `settle` resolves (the
  // query notifies its observers later), and the strip it brings can drop
  // the button focus was just given (Stop, once the unit is down). So the
  // strip takes focus once more when the row's payload first changes after a
  // settle, unless the operator has moved focus somewhere else meanwhile.
  useEffect(() => {
    const pending = stripFocus.current;
    if (!pending || pending.row === row) return;
    stripFocus.current = null;
    const box = boxRef.current;
    const active = document.activeElement;
    if (!box || (active && active !== document.body && !box.contains(active))) return;
    focusStrip(box, pending.action);
  });

  // A live re-read can drop the action whose confirmation is open (the unit
  // went down under an open Stop or Restart). Its confirmation is no longer
  // rendered, so close it: the strip comes back, and focus goes to the
  // strip's first live button, or to the strip itself when none is left.
  const shown = shownActions(row);
  const vanished = confirming !== null && !shown.includes(confirming);
  const [vanishedFocus, setVanishedFocus] = useState(false);
  useEffect(() => {
    if (!vanished) return;
    setConfirming(null);
    setVanishedFocus(true);
  }, [vanished]);
  useEffect(() => {
    if (!vanishedFocus) return;
    setVanishedFocus(false);
    const strip = boxRef.current?.querySelector<HTMLElement>("[data-action-strip]");
    if (!strip) return;
    const first = Array.from(strip.querySelectorAll<HTMLButtonElement>("[data-host-action]")).find((b) => !b.disabled);
    if (first) return first.focus();
    // Runtime only, so the markup stays the server's.
    strip.tabIndex = -1;
    strip.focus();
  }, [vanishedFocus]);

  if (!hasHostActions(row)) return null;
  const effective = live ?? run;
  const running = isRunning(effective);
  const fact = actionFact(effective, live ? new Date() : now);

  async function request(action: HostAction) {
    const current = latest.current.api;
    if (!current || postingRef.current) return;
    postingRef.current = true;
    const clickedAt = Date.now();
    setPosting(true);
    const state = await current.request(row.name, action);
    postingRef.current = false;
    if (!mounted.current) return;
    setPosting(false);
    setConfirming(null);
    if (state) {
      latest.current.onLive({
        unit: row.name,
        action,
        state: "running",
        startedAt: state.startedAt,
        logTail: state.logTail ?? "",
      });
      setFollow({ action, clickedAt });
      // The clicked control is gone or disabled; keep focus in the row.
      setFocus({ to: "fact" });
      return;
    }
    // Refused: back to the strip, every control live again, focus on the opener.
    setFocus({ to: "opener", action });
  }

  function press(action: HostAction) {
    if (!api) return;
    if (ACTION_CONFIRM[action]) {
      setConfirming(action);
      setFocus({ to: "cancel", action });
      return;
    }
    void request(action);
  }

  function cancel(action: HostAction) {
    setConfirming(null);
    setFocus({ to: "opener", action });
  }

  return (
    <div
      ref={boxRef}
      className="flex flex-col gap-0.5"
      data-host-actions={row.name}
      data-neutral-pill={TONE_PILL.neutral}
      data-running={isRunning(effective) ? effective.action : undefined}
    >
      <p className={SERVICE_DETAIL} data-action-fact="" hidden={!fact} tabIndex={follow ? -1 : undefined}>
        <ActionFactText run={effective} now={live ? new Date() : now} />
      </p>
      <ActionLog run={effective} />
      <pre className={LOG_TAIL} data-action-tail="" aria-live="off" hidden={!running}>
        {actionTail(effective)}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-2" data-action-strip="" hidden={confirming !== null && !vanished}>
        {shown.map((a) => (
          <button
            key={a}
            type="button"
            className={a === "stop" ? BUTTON_DANGER : BUTTON_SECONDARY_COMPACT}
            data-host-action={a}
            disabled={running || posting}
            onClick={api ? () => press(a) : undefined}
          >
            {ACTION_LABEL[a]}
          </button>
        ))}
        <span className="text-[0.8rem] text-stone-400" data-action-busy="" role="status" hidden={!running}>
          {actionBusy(row.name)}
        </span>
      </div>
      {shown.map((a) => (
        <ActionConfirm
          key={a}
          unit={row.name}
          action={a}
          open={confirming === a}
          // app.js disabled every button in the box to post and never
          // re-enabled the confirmations' after a 202; a run rendered by the
          // server leaves them enabled (and hidden), as here.
          disabled={posting || follow !== null}
          onCancel={() => cancel(a)}
          onGo={() => void request(a)}
        />
      ))}
    </div>
  );
}
