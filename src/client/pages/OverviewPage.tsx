import { useEffect, useLayoutEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ACTIVITY_QUERY } from "../activity";
import { useClientNav } from "../clientNav";
import { useRailHealth } from "../health";
import { ActivityTable } from "../components/ActivityTable";
import { AttentionList } from "../components/AttentionList";
import { OverviewStrip } from "../components/OverviewStrip";
import { OVERVIEW_HEADING, OVERVIEW_PAGE, attentionRows, stripCells } from "../../views/overviewModel";

const failedLine = (reason: string): string => `Couldn't refresh activity: ${reason}`;

/** Focus for an in-app arrival: focusable at runtime only. */
function focusHeading(heading: HTMLHeadingElement | null): void {
  if (!heading) return;
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

/**
 * The overview at `/`: the strip, needs attention, recent activity.
 *
 * - Two queries, read independently: the rail's health poll feeds the strip
 *   and the attention block, the activity poll feeds the table. Neither one's
 *   failure hides the other's block (Review Focus 3).
 * - A failed health poll drops the strip's counts and replaces the attention
 *   block with one neutral line; a failed activity re-read keeps the last good
 *   table under an alert, until the next good read.
 * - Focus moves to the heading on an in-app arrival, as on the sites list:
 *   never on a document load, never out of a wide-screen find box.
 */
export function OverviewPage() {
  const { health, healthError, lastRead } = useRailHealth();
  const activity = useQuery(ACTIVITY_QUERY);
  const heading = useRef<HTMLHeadingElement>(null);

  // By timestamps rather than isError, and the reason kept across a retry's
  // gap, exactly as SitesPage does.
  const activityFailed = activity.errorUpdatedAt > activity.dataUpdatedAt;
  const lastReason = useRef<string | null>(null);
  useEffect(() => {
    if (activity.error) lastReason.current = activity.error.message;
  }, [activity.error]);
  const reason = activity.error?.message ?? lastReason.current;
  const alert = activityFailed && reason !== null ? failedLine(reason) : null;

  useLayoutEffect(() => {
    document.title = "overview · lychee admin";
  }, []);

  const nav = useClientNav();
  const arrivedInApp = nav !== null && !nav.documentLoad;

  // The heading exists from the first render, so the arrival's focus is once, on mount.
  useEffect(() => {
    if (!arrivedInApp) return;
    const active = document.activeElement;
    if (active?.id === "find" && !active.closest("dialog")) return;
    focusHeading(heading.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // A move that stays on this page (the wordmark, the rail's overview row)
  // does not remount it: focus goes to the heading again.
  const locationKey = nav?.locationKey;
  const shownKey = useRef(locationKey);
  useEffect(() => {
    if (locationKey === shownKey.current) return;
    shownKey.current = locationKey;
    focusHeading(heading.current);
  }, [locationKey]);

  const now = new Date();
  const healthNow = health ? new Date(health.now) : now;
  const cells = stripCells(health, healthError, healthNow);
  const rows = health && !healthError ? attentionRows(health) : null;

  return (
    <div className={OVERVIEW_PAGE}>
      <h2 ref={heading} className={OVERVIEW_HEADING}>
        Overview
      </h2>
      <OverviewStrip cells={cells} />
      <AttentionList rows={rows} failed={healthError} lastRead={lastRead} now={now} />
      <ActivityTable payload={activity.data ?? null} alert={alert} />
    </div>
  );
}
