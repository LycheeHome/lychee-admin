import { splitHostnameForDisplay } from "../../lib/siteDisplay";
import type { HealthPayload, Tone } from "../../shared/health";
import {
  RAIL_ADD_SITE,
  RAIL_COUNT_BAD,
  RAIL_COUNT_ZERO,
  RAIL_DOT,
  RAIL_HEADING,
  RAIL_HEADING_LINK,
  RAIL_HINT,
  RAIL_NOTE,
  RAIL_ROW,
  attentionCounts,
} from "../../views/railModel";
import { FOCUS_RING, ICONS, formatAge } from "../../views/shared";
import type { RailCurrent, RailData } from "../../views/shell";
import { FindPanel } from "./FindPanel";

/*
 * The rail's children in JSX. It mirrors renderRail in src/views/rail.ts
 * element for element — with `health: null` its render equals the server
 * aside's inner markup, which the parity test pins — so a change to either
 * belongs in both until the server rail is retired. The aside itself stays
 * the server's: the island mounts onto it and renders only what is inside.
 */

export interface RailProps {
  rail: RailData;
  /** The latest health payload, or null before the first answer. */
  health: HealthPayload | null;
  /** The latest poll failed. Old data is never shown as current when it did. */
  healthError: boolean;
  /** When health was last read successfully (ISO), for the unavailable line. */
  lastRead: string | null;
  /** The find box's printed shortcut: `⌘K` (the server's) or `Ctrl K`. */
  findHint?: string;
  /** The reference time for "last read …"; now by default. */
  now?: Date;
  /** What the server's find box held when the island mounted over it. */
  findInitial?: { query: string; focused: boolean };
  /** Opens a find result; `location.assign` by default. */
  navigate?: (href: string) => void;
}

const isPage = (current: RailCurrent, page: string): boolean =>
  current !== null && "page" in current && current.page === page;

const isSite = (current: RailCurrent, hostname: string): boolean =>
  current !== null && "site" in current && current.site === hostname;

const ariaCurrent = (on: boolean): "page" | undefined => (on ? "page" : undefined);

function Wordmark() {
  return (
    <a
      href="/"
      aria-label="lychee-admin"
      className={`font-display text-2xl tracking-wide text-stone-50 m-0 no-underline ${FOCUS_RING}`}
    >
      lychee<span className="font-mono text-[0.85rem] tracking-[0.02em] text-stone-300 ml-[0.35em]">admin</span>
    </a>
  );
}

/** shared.ts's icon("plus"), from the same path data. */
function PlusIcon() {
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
      dangerouslySetInnerHTML={{ __html: ICONS.plus }}
    />
  );
}

/**
 * A count slot. Null renders the server's empty slot (no reading, or a
 * failed one); zero is quiet Smoke Deep; above zero is Scorch on its chip.
 */
function Count({ name, value }: { name: string; value: number | null }) {
  if (value === null) return <span data-count={name} />;
  return (
    <span data-count={name} className={value > 0 ? RAIL_COUNT_BAD : RAIL_COUNT_ZERO}>
      {value}
    </span>
  );
}

interface DotState {
  tone: Tone;
  /** The status phrase a screen reader hears in place of the dot's colour. */
  label: string;
}

const HOST_LINKS = [
  { href: "/services", label: "services", page: "services", count: "service" },
  { href: "/reconciler", label: "reconciler", page: "reconciler", count: "reconciler" },
  { href: "/infrastructure", label: "infrastructure", page: "infrastructure", count: "infrastructure" },
] as const;

export function Rail({ rail, health, healthError, lastRead, findHint = "⌘K", now, findInitial, navigate }: RailProps) {
  // A failed poll shows nothing it remembers: TanStack keeps the last data,
  // and a green dot from it would be a lie about now.
  const live = healthError ? null : health;
  const counts = live ? attentionCounts(live) : null;
  const byHost = new Map((live?.sites ?? []).map((s) => [s.hostname, s]));

  // The rail's own list decides the rows; the payload only colours them. A
  // site the payload lacks stays hollow, and one it adds gets no row.
  const dotFor = (hostname: string, hint: string): DotState => {
    if (healthError) return hint === "static" ? { tone: "none", label: "" } : { tone: "neutral", label: "unknown" };
    const entry = byHost.get(hostname);
    return entry ? { tone: entry.tone, label: entry.label } : { tone: "none", label: "" };
  };

  const age = healthError && lastRead ? formatAge(lastRead, now ?? new Date()) : null;

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 px-3 py-5">
        <h1 className="m-0 px-2 text-base font-normal leading-none">
          <Wordmark />
        </h1>
        <FindPanel
          health={live}
          railSites={rail.sites}
          domain={rail.domain}
          findHint={findHint}
          navigate={navigate}
          initialQuery={findInitial?.query}
          initialFocused={findInitial?.focused}
        />
        <nav aria-label="Sites" className="flex flex-col gap-0.5">
          <a href="/" className={RAIL_HEADING_LINK} aria-current={ariaCurrent(isPage(rail.current, "sites"))}>
            sites
            <Count name="sites" value={counts ? counts.sites : null} />
          </a>
          {rail.sites === null ? (
            <p className={RAIL_NOTE}>Can&apos;t read the Caddyfile</p>
          ) : (
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
              {rail.sites.map((site) => {
                const { lead, dimmed } = splitHostnameForDisplay(site.hostname, rail.domain);
                const dot = dotFor(site.hostname, site.hint);
                return (
                  <li key={site.hostname}>
                    <a
                      href={`/sites/${encodeURIComponent(site.hostname)}`}
                      className={RAIL_ROW}
                      data-site={site.hostname}
                      aria-current={ariaCurrent(isSite(rail.current, site.hostname))}
                    >
                      <span className={RAIL_DOT[dot.tone]} data-dot="" aria-hidden="true" />
                      <span className="min-w-0 break-all">
                        <span className="text-stone-50">{lead}</span>
                        {dimmed}
                      </span>
                      <span className="sr-only">, </span>
                      <span className={RAIL_HINT}>{site.hint}</span>
                      {dot.label ? <span className="sr-only">, {dot.label}</span> : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
          {healthError ? (
            <p className={RAIL_NOTE} data-health-unavailable="">
              {age ? `health unavailable · last read ${age}` : "health unavailable"}
            </p>
          ) : null}
        </nav>
        <nav aria-label="Host" className="flex flex-col gap-0.5">
          <p className={`${RAIL_HEADING} m-0`}>host</p>
          {HOST_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`${RAIL_ROW} justify-between`}
              aria-current={ariaCurrent(isPage(rail.current, link.page))}
            >
              {link.label}
              {rail.hostAvailable ? <Count name={link.count} value={counts ? counts[link.count] : null} /> : null}
            </a>
          ))}
          {rail.hostAvailable ? null : <p className={RAIL_NOTE}>Inventory unavailable</p>}
        </nav>
      </div>
      <div className="shrink-0 border-t border-stone-700 px-3 py-3">
        <a href="/sites/new" className={RAIL_ADD_SITE} aria-current={ariaCurrent(isPage(rail.current, "new"))}>
          <PlusIcon />
          Add site
        </a>
      </div>
    </>
  );
}
