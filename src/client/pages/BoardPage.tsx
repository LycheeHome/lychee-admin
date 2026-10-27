import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useClientNav } from "../clientNav";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { ServiceGroup } from "../../shared/board";
import { boardQueryKey, fetchBoard } from "../api";
import { boardInProgress } from "../board";
import { useBoardControls } from "../mutations";
import { BOARD_ALERT, Board } from "../components/BoardRows";
import { GROUP_LABELS } from "../../views/boardRowModel";
import { FRAME_WIDTH } from "../../views/shared";

/** The board's re-read while a row is in progress (a moved pin, a requested tag, a running action). */
export const BOARD_FAST_MS = 3_000;
/** The board's re-read otherwise: the rail's own cadence. */
export const BOARD_SLOW_MS = 15_000;

/**
 * One group's board query: the route loader primes it and the page observes
 * it. It re-reads every 15s, every 3s while anything on this group's board is
 * in progress, pauses while the tab is hidden and re-reads on focus.
 *
 * `staleTime` covers the read the loader has just made: without it the page
 * would mount on that fresh answer and fetch the same board again at once.
 * Cached data older than that is shown at once and refreshed on mount. The
 * interval and every write's invalidation ignore it.
 */
export function boardQuery(group: ServiceGroup) {
  return queryOptions({
    queryKey: boardQueryKey(group),
    queryFn: () => fetchBoard(group),
    refetchInterval: (q) => (q.state.data && boardInProgress(q.state.data) ? BOARD_FAST_MS : BOARD_SLOW_MS),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 2_000,
  });
}

const failedLine = (reason: string): string => `Couldn't refresh the services board: ${reason}`;

/** The element the URL's hash names, or null for none (or an undecodable one). */
function hashTarget(): HTMLElement | null {
  const hash = window.location.hash;
  if (!hash) return null;
  try {
    return document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    return null;
  }
}

/**
 * Focuses a row a move named: focusable at runtime only (the rendered markup
 * stays the server's), and already scrolled into view by the router.
 */
function focusRow(row: HTMLElement): void {
  if (!row.hasAttribute("tabindex")) row.tabIndex = -1;
  row.focus({ preventScroll: true });
}

/**
 * A board page: /services, /reconciler or /infrastructure, one group each.
 *
 * - It wires its own controls, so no page can render a Deploy, Prune or
 *   host-action button that does nothing.
 * - A failed re-read keeps the last good board and says so above its rows,
 *   until the next good read. A failed first read shows that line alone.
 * - On mount it takes the server's title for the page. An in-app navigation
 *   moves focus to its eyebrow, so it is announced the way a page load is; a
 *   document load takes none. Never out of the find box, where the operator
 *   may still be typing.
 *
 * Nothing renders while the first answer is on its way: a skeleton is the
 * redesign's call.
 */
export function BoardPage({ group }: { group: ServiceGroup }) {
  const query = useQuery(boardQuery(group));
  const controls = useBoardControls();
  const heading = useRef<HTMLHeadingElement>(null);

  // "The latest read failed", by timestamps rather than isError: TanStack
  // clears a data-less query's error while it re-reads, which would blink the
  // first-load alert off for the length of every retry. The reason is kept
  // across that gap.
  const latestFailed = query.errorUpdatedAt > query.dataUpdatedAt;
  const lastReason = useRef<string | null>(null);
  useEffect(() => {
    if (query.error) lastReason.current = query.error.message;
  }, [query.error]);
  const reason = query.error?.message ?? lastReason.current;
  const alert = latestFailed && reason !== null ? failedLine(reason) : null;

  // In the commit that shows the page, so the title never names the last one.
  useLayoutEffect(() => {
    document.title = GROUP_LABELS[group];
  }, [group]);

  // Once, when the eyebrow first exists. A first read that failed gives the
  // move up: a board that turns up on a later poll is not a navigation, and
  // focus may be anywhere by then.
  const hasBoard = query.data !== undefined;
  const focused = useRef(false);
  // A `#service-` hash the document itself loaded with: the browser looked
  // for its row before there was one, so the page scrolls to it once the
  // rows are in. An in-app move's hash is the router's to scroll to.
  const nav = useClientNav();
  const [loadHash] = useState(() => (nav?.documentLoad ? window.location.hash : ""));
  const arrivedInApp = nav !== null && !nav.documentLoad;
  useEffect(() => {
    if (focused.current) return;
    if (!hasBoard) {
      if (latestFailed) focused.current = true;
      return;
    }
    focused.current = true;
    if (loadHash) {
      try {
        document.getElementById(decodeURIComponent(loadHash.slice(1)))?.scrollIntoView();
      } catch {
        // An undecodable hash names no row.
      }
    }
    // A document load (or a mount outside the router) takes no focus, as on
    // the other pages: the browser announces a page load itself, and taking
    // focus drew its default ring on the eyebrow (critique 2026-10-26).
    if (!arrivedInApp) return;
    // A find box inside the drawer is not one being typed in: the move came
    // from it, and the drawer has just closed.
    const active = document.activeElement;
    if (active?.id === "find" && !active.closest("dialog")) return;
    // Scrolling is done: to the top, a saved position, or a #service- row.
    // A move that names a row lands on it, as a move within the page does
    // (find's Enter on another group's unit; critique 2026-10-27).
    const row = hashTarget();
    if (row) {
      focusRow(row);
      return;
    }
    heading.current?.focus({ preventScroll: true });
  }, [hasBoard, latestFailed, loadHash, arrivedInApp]);

  // A move that stays on this page (find's Enter on one of its rows, the
  // rail's link to it) does not remount it, so the focus above does not run
  // again. Focus goes to the row the hash names, made focusable at runtime
  // only (the rendered markup stays the server's), or to the heading when
  // there is no hash or no such row. From the drawer this is what keeps focus
  // off <body>: its close returns focus nowhere on an in-app move.
  const locationKey = nav?.locationKey;
  const shownKey = useRef(locationKey);
  useEffect(() => {
    if (locationKey === shownKey.current) return;
    shownKey.current = locationKey;
    const target = hashTarget();
    if (target) {
      focusRow(target);
      return;
    }
    heading.current?.focus({ preventScroll: true });
  }, [locationKey]);

  if (!query.data) {
    if (!alert) return null;
    return (
      <div className={`${FRAME_WIDTH} flex flex-col gap-8`}>
        <p role="alert" className={BOARD_ALERT}>
          {alert}
        </p>
      </div>
    );
  }
  return <Board payload={query.data} group={group} controls={controls} headingRef={heading} alert={alert} />;
}
