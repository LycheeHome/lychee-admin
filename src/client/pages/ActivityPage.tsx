import { Fragment, useEffect, useLayoutEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
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

  const change = (patch: Partial<ActivityUrlFilters>) =>
    setSearch(new URLSearchParams(searchFromFilters({ ...filters, ...patch })), { replace: true });

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
    focusHeading(heading.current);
  }, [locationKey]);

  const pages = query.data?.pages ?? [];
  const newest = pages[0] ?? null;
  const events = pages.flatMap((p) => p.events);
  const now = new Date(newest?.now ?? Date.now());
  const filtered = hasFilters(filters);

  const olderFailed = query.isFetchNextPageError;
  const refreshAlert = query.isError && !olderFailed ? `Couldn't refresh activity: ${query.error.message}` : null;
  const olderAlert = olderFailed ? `Couldn't load older activity: ${query.error?.message ?? ""}` : null;

  const bothDown = newest !== null && !newest.sources.app && !newest.sources.reconciler;
  const missing = newest ? sourceLine(newest.sources) : null;

  let days: string | null = null;
  const rows = events.map((e, i) => {
    const key = dayKey(e.at);
    const heading = key !== days ? dayLabel(e.at, now) : null;
    days = key;
    return (
      <Fragment key={`${e.at}:${e.who}:${e.subject}:${i}`}>
        {heading ? (
          <tr>
            <th colSpan={COLUMNS.length} scope="colgroup" className={ACTIVITY_DAY_TH}>
              {heading}
            </th>
          </tr>
        ) : null}
        <ActivityRow event={e} now={now} showDetail />
      </Fragment>
    );
  });

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
          <RailLink href={ACTIVITY_ROUTE} className={ACTIVITY_SEE_ALL}>
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
              <table className={ACTIVITY_TABLE} aria-labelledby={HEADING_ID}>
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c} scope="col" className={ACTIVITY_TH}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>{rows}</tbody>
              </table>
            </div>
          ) : missing === null ? (
            <p className={ACTIVITY_NOTE}>{filtered ? "No activity matches these filters." : "Nothing recorded yet."}</p>
          ) : null}
          {missing ? <p className={ACTIVITY_NOTE}>{missing}</p> : null}
          {events.length > 0 || query.hasNextPage ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {query.hasNextPage ? (
                <button type="button" className={BUTTON_SECONDARY} disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  Show older
                </button>
              ) : (
                <span className={ACTIVITY_END}>Start of history</span>
              )}
              {olderAlert ? (
                <p role="alert" className={`${BOARD_ALERT} m-0`}>
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
