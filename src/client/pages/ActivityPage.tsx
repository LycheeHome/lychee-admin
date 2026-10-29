import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ACTIVITY_KINDS, ACTIVITY_WHO, type ActivityPayload } from "../../shared/activity";
import { activityPageQuery } from "../activity";
import { ACTIVITY_ROUTE, RailLink, useClientNav } from "../clientNav";
import { ActivityRow } from "../components/ActivityRow";
import { BOARD_ALERT } from "../components/BoardRows";
import {
  ACTIVITY_DAY_TH,
  ACTIVITY_END,
  ACTIVITY_FILTER_CAPTION,
  ACTIVITY_FILTER_LABEL,
  ACTIVITY_FILTERS,
  ACTIVITY_PAGE,
  ACTIVITY_PAGER,
  ACTIVITY_SEE_ALL,
  ACTIVITY_SELECT,
  dayKey,
  dayLabel,
  filtersFromSearch,
  hasFilters,
  searchFromFilters,
  type ActivityUrlFilters,
} from "../../views/activityPageModel";
import { ACTIVITY_NOTE, ACTIVITY_SCROLL, ACTIVITY_TABLE, ACTIVITY_TH, OVERVIEW_HEADING } from "../../views/overviewModel";
import { BUTTON_SECONDARY } from "../../views/shared";

const COLUMNS = ["when", "who", "kind", "subject", "outcome"] as const;
const HEADING_ID = "activity-heading";

/** Focus for an in-app arrival: focusable at runtime only. */
function focusHeading(heading: HTMLHeadingElement | null): void {
  if (!heading) return;
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

/** The line under the table when exactly one source could not be read: the overview's, with the history's own clause. */
function sourceLine(sources: ActivityPayload["sources"]): string | null {
  if (!sources.reconciler) return "Reconciler history couldn't be read; showing app actions only, so this history is incomplete.";
  if (!sources.app) return "The audit log couldn't be read; showing reconciler events only, so this history is incomplete.";
  return null;
}

/** One filter: a caption over a native select, with an unlisted URL value kept as an option so the view never lies. */
function Filter({
  name,
  emptyLabel,
  options,
  value,
  onChange,
}: {
  name: string;
  emptyLabel: string;
  options: readonly string[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const all = value !== null && !options.includes(value) ? [...options, value] : options;
  return (
    <label className={ACTIVITY_FILTER_LABEL}>
      <span className={ACTIVITY_FILTER_CAPTION}>{name}</span>
      <select className={ACTIVITY_SELECT} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{emptyLabel}</option>
        {all.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The whole merged history at `/activity`: filters in the URL, rows grouped by
 * local day, "Show older" for the next page. One infinite query keyed by the
 * filters, re-read from the newest page down every 15s.
 */
export function ActivityPage() {
  const [search, setSearch] = useSearchParams();
  const filters = filtersFromSearch(search);
  const query = useInfiniteQuery(activityPageQuery(filters));
  const heading = useRef<HTMLHeadingElement>(null);

  const qc = useQueryClient();
  const [older, setOlder] = useState<{ reason: string; errorAt: number; dataAt: number } | null>(null);

  // Every filter change starts from page one: the other views' cached pages go.
  const restart = () => qc.removeQueries({ queryKey: ["activity-page"], type: "inactive" });
  // A filter change is the page's own move: the select keeps focus.
  const selfMove = useRef(false);
  const change = (patch: Partial<ActivityUrlFilters>) => {
    restart();
    selfMove.current = true;
    setSearch(new URLSearchParams(searchFromFilters({ ...filters, ...patch })), { replace: true });
  };

  // After a good "Show older", focus follows the new rows (see the effect below).
  const olderButton = useRef<HTMLButtonElement>(null);
  const endLine = useRef<HTMLSpanElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const [focusAfter, setFocusAfter] = useState<{ from: number; need: number } | null>(null);
  const showOlder = async () => {
    if (query.isFetchingNextPage) return;
    setOlder(null);
    const before = query.data?.pages.flatMap((p) => p.events).length ?? 0;
    const r = await query.fetchNextPage();
    if (r.isError) {
      setOlder({ reason: r.error.message, errorAt: r.errorUpdatedAt, dataAt: r.dataUpdatedAt });
      return;
    }
    const after = r.data?.pages.flatMap((p) => p.events).length ?? before;
    setFocusAfter({ from: before, need: after });
  };

  useLayoutEffect(() => {
    document.title = "activity · lychee admin";
  }, []);

  const nav = useClientNav();
  const arrivedInApp = nav !== null && !nav.documentLoad;
  useEffect(() => {
    if (!arrivedInApp) return;
    const active = document.activeElement;
    if (active?.id === "find" && !active.closest("dialog")) return;
    focusHeading(heading.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // A move that stays on this page does not remount it: focus goes to the eyebrow again.
  const locationKey = nav?.locationKey;
  const shownKey = useRef(locationKey);
  useEffect(() => {
    if (locationKey === shownKey.current) return;
    shownKey.current = locationKey;
    if (selfMove.current) {
      selfMove.current = false;
      return;
    }
    focusHeading(heading.current);
  }, [locationKey]);

  const pages = query.data?.pages ?? [];
  const newest = pages[0] ?? null;
  const events = pages.flatMap((p) => p.events);

  // The pager's button blurs nothing while fetching (it is aria-disabled), but
  // when the page lands focus goes to the first new row's link, else stays on
  // the button, or lands on the end-of-history line that replaces it.
  useEffect(() => {
    if (!focusAfter || events.length < focusAfter.need) return;
    const rows = Array.from(table.current?.querySelectorAll("tbody tr") ?? []).filter((r) => !r.querySelector("th"));
    const link = rows.slice(focusAfter.from).map((r) => r.querySelector<HTMLAnchorElement>("a")).find((a) => a);
    if (link) link.focus();
    else if (olderButton.current) olderButton.current.focus();
    else endLine.current?.focus();
    setFocusAfter(null);
  }, [focusAfter, events.length]);
  const now = new Date(newest?.now ?? Date.now());
  const filtered = hasFilters(filters);

  // A failure is a newer error than the last data, by timestamps: a retry
  // clears TanStack's own error on a query with no data, and the reason is
  // kept across that gap, as OverviewPage does.
  const failed = query.errorUpdatedAt > query.dataUpdatedAt;
  const lastReason = useRef<string | null>(null);
  useEffect(() => {
    if (query.error) lastReason.current = query.error.message;
  }, [query.error]);
  const reason = query.error?.message ?? lastReason.current;

  // A failed "Show older" is told apart by the error it left: a re-read that
  // starts afterwards keeps that error until it settles, and must not read
  // as a refresh failure. It clears on the next good read.
  const olderFailed = older !== null && older.errorAt === query.errorUpdatedAt && older.dataAt === query.dataUpdatedAt;
  const refreshAlert = failed && !olderFailed && reason !== null ? `Couldn't refresh activity: ${reason}` : null;
  const olderAlert = olderFailed && older ? `Couldn't load older activity: ${older.reason}` : null;

  const bothDown = newest !== null && !newest.sources.app && !newest.sources.reconciler;
  const missing = newest ? sourceLine(newest.sources) : null;

  // One `<tbody>` per local day, headed by a rowgroup header.
  const groups: Array<{ key: string; label: string; items: Array<{ e: (typeof events)[number]; i: number }> }> = [];
  events.forEach((e, i) => {
    const key = dayKey(e.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push({ e, i });
    else groups.push({ key, label: dayLabel(e.at, now), items: [{ e, i }] });
  });
  const bodies = groups.map((g) => (
    <tbody key={g.key}>
      <tr>
        <th colSpan={COLUMNS.length} scope="rowgroup" className={ACTIVITY_DAY_TH}>
          {g.label}
        </th>
      </tr>
      {g.items.map(({ e, i }) => (
        <ActivityRow key={`${e.at}:${e.who}:${e.subject}:${i}`} event={e} now={now} showDetail />
      ))}
    </tbody>
  ));

  return (
    <div className={ACTIVITY_PAGE}>
      <h2 ref={heading} id={HEADING_ID} className={OVERVIEW_HEADING}>
        Activity
      </h2>
      <div className={ACTIVITY_FILTERS}>
        <Filter name="subject" emptyLabel="all subjects" options={newest?.subjects ?? []} value={filters.subject} onChange={(subject) => change({ subject })} />
        <Filter name="who" emptyLabel="all" options={ACTIVITY_WHO} value={filters.who} onChange={(who) => change({ who })} />
        <Filter name="kind" emptyLabel="all" options={ACTIVITY_KINDS} value={filters.kind} onChange={(kind) => change({ kind })} />
        {filtered ? (
          <RailLink href={ACTIVITY_ROUTE} className={ACTIVITY_SEE_ALL} onClick={restart}>
            clear filters
          </RailLink>
        ) : null}
      </div>
      {refreshAlert ? (
        <p role="alert" className={BOARD_ALERT}>
          {refreshAlert}
        </p>
      ) : null}
      {newest && bothDown ? <p className={ACTIVITY_NOTE}>Activity couldn't be read.</p> : null}
      {newest && !bothDown ? (
        <div>
          {events.length > 0 ? (
            <div className={ACTIVITY_SCROLL}>
              <table ref={table} className={ACTIVITY_TABLE} aria-labelledby={HEADING_ID}>
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c} scope="col" className={ACTIVITY_TH}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                {bodies}
              </table>
            </div>
          ) : missing === null ? (
            <p className={ACTIVITY_NOTE}>{filtered ? "No activity matches these filters." : "Nothing recorded yet."}</p>
          ) : null}
          {missing ? <p className={ACTIVITY_NOTE}>{missing}</p> : null}
          {events.length > 0 || query.hasNextPage ? (
            <div className={ACTIVITY_PAGER}>
              {query.hasNextPage ? (
                <button
                  ref={olderButton}
                  type="button"
                  className={BUTTON_SECONDARY}
                  aria-disabled={query.isFetchingNextPage}
                  onClick={() => void showOlder()}
                >
                  Show older
                </button>
              ) : (
                <span ref={endLine} tabIndex={-1} className={ACTIVITY_END}>
                  Start of history
                </span>
              )}
              {olderAlert ? (
                <p role="alert" className={BOARD_ALERT}>
                  {olderAlert}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
