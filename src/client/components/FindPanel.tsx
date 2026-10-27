import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { splitHostnameForDisplay } from "../../lib/siteDisplay";
import type { HealthPayload } from "../../shared/health";
import {
  FIND_EMPTY,
  FIND_HEADING,
  FIND_LIST,
  FIND_OPTION,
  FIND_PANEL,
  FIND_TROUBLE,
  RAIL_FIND,
  RAIL_FIND_HINT,
  RAIL_WIDE_QUERY,
} from "../../views/railModel";
import { TONE_PILL } from "../../views/shared";
import type { RailData } from "../../shared/rail";
import { attentionResults, findResults, type FindGroupKey, type FindItem } from "../find";
import { useOpen } from "../clientNav";

/*
 * The ⌘K find box and its panel: a combobox over every site and unit. Closed
 * and unfocused it renders exactly the retired server rail's find box, which
 * the frozen rail fixtures (src/dev/fixtures/rail/) pin. It lists places
 * only, never actions.
 */

export interface FindPanelProps {
  /** The latest health payload, or null before the first answer (or after a failed poll). */
  health: HealthPayload | null;
  /** The rail's own site list, matched when no health has been read. */
  railSites: RailData["sites"];
  /** Opens a row: by default the router's navigate between client routes, `location.assign` otherwise. */
  navigate?: (href: string) => void;
  /** The managed domain, dimmed in hostnames as the rail dims it. */
  domain?: string;
  /** The printed shortcut: `⌘K` (the default) or `Ctrl K`. */
  findHint?: string;
  /** The text the box starts with. */
  initialQuery?: string;
  /** Whether the box takes focus, open, when it mounts (the drawer opened on find). */
  initialFocused?: boolean;
  /**
   * This box is inside the narrow-screen drawer. The panel then opens below
   * the box rather than beside the rail, and Escape on a closed panel is left
   * to the drawer, so a first Escape closes find and a second the drawer.
   */
  inDrawer?: boolean;
  /**
   * Below 900px the rail, and this box with it, is collapsed: ⌘K calls this
   * with whatever had focus, and Navigation opens the rail as a drawer on find.
   */
  onNarrowShortcut?: (previous: Element | null) => void;
}

export const FIND_LIST_ID = "find-list";

const GROUP_LABEL: Record<FindGroupKey, string> = {
  sites: "sites",
  service: "services",
  reconciler: "reconciler",
  infrastructure: "infrastructure",
};

const noMatch = (key: FindGroupKey, q: string): string =>
  key === "sites"
    ? `No site matches “${q}”.`
    : key === "service"
      ? `No services match “${q}”.`
      : `No ${key} units match “${q}”.`;

/**
 * An option's id, stable per row: derived from its href, with every character
 * outside [A-Za-z0-9-] written as `_<hex>_`, so it is a valid id and two
 * different hrefs can never collide.
 */
export const optionId = (href: string): string =>
  "find-option-" +
  Array.from(href)
    .map((c) => (/[A-Za-z0-9-]/.test(c) ? c : `_${(c.codePointAt(0) ?? 0).toString(16)}_`))
    .join("");

const headingId = (key: FindGroupKey): string => `find-group-${key}`;

/** ⌘K on Apple platforms, Ctrl+K elsewhere: either opens find, from anywhere. */
const isFindShortcut = (e: globalThis.KeyboardEvent): boolean =>
  (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";

function Pill({ item }: { item: FindItem }) {
  if (!item.label || item.tone === "none") return null;
  return (
    <span className={TONE_PILL[item.tone]}>
      <span aria-hidden="true">{"●"}</span> {item.label}
    </span>
  );
}

function Row({ item, domain }: { item: FindItem; domain: string | undefined }) {
  if (item.kind === "site") {
    const { lead, dimmed } = domain ? splitHostnameForDisplay(item.hostname, domain) : { lead: item.hostname, dimmed: "" };
    return (
      <>
        <span className="min-w-0 break-all">
          <span className="text-stone-50">{lead}</span>
          {dimmed}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Pill item={item} />
        </span>
      </>
    );
  }
  return (
    <>
      <span className="min-w-0 break-all text-stone-50">{item.name}</span>
      <span className="ml-auto flex items-center gap-2">
        {item.trouble ? <span className={FIND_TROUBLE}>deploy {item.trouble}</span> : null}
        <Pill item={item} />
      </span>
    </>
  );
}

export function FindPanel({
  health,
  railSites,
  navigate: navigateProp,
  domain,
  findHint = "⌘K",
  initialQuery = "",
  initialFocused = false,
  inDrawer = false,
  onNarrowShortcut,
}: FindPanelProps) {
  // A row in another board group (`/reconciler#service-…`) opens in-app from
  // any client route, a site's page included; only a URL no route matches loads a document.
  const openHref = useOpen();
  const navigate = navigateProp ?? openHref;
  const inputRef = useRef<HTMLInputElement>(null);
  // The document listener is registered once; it reads the latest callback here.
  const narrowShortcut = useRef(onNarrowShortcut);
  useEffect(() => {
    narrowShortcut.current = onNarrowShortcut;
  });
  // Where Escape sends focus: whatever had it before find opened.
  const returnTo = useRef<Element | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  // The highlighted row, by href: a poll that reorders the list must not move
  // the highlight (and Enter) onto a different row.
  const [activeHref, setActiveHref] = useState<string | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  const q = query.trim();
  const groups = useMemo(
    () => (q === "" ? attentionResults(health) : findResults(q, health, railSites)),
    [q, health, railSites],
  );
  // With nothing typed, or once anything matches, only the groups that have
  // something are shown: three "No … match" lines pushed a single hit down
  // (critique 2026-10-26). When nothing matches anywhere, each group says so.
  const anyMatch = groups.some((g) => g.items.length > 0);
  const shown = q === "" || anyMatch ? groups.filter((g) => g.items.length > 0) : groups;
  const items = shown.flatMap((g) => g.items);
  const found = activeHref === null ? -1 : items.findIndex((item) => item.href === activeHref);
  // A highlighted row that has gone falls back to the first.
  const current = items.length === 0 ? -1 : Math.max(found, 0);
  const setActive = (i: number) => setActiveHref(items[i]?.href ?? null);

  // ⌘K / Ctrl+K from anywhere, inputs and textareas included.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isFindShortcut(e)) return;
      const input = inputRef.current;
      if (!input) return;
      const previous = document.activeElement;
      // Below 900px this box is collapsed with the rail: Navigation opens the
      // rail as a drawer and focuses find there instead.
      const narrow = narrowShortcut.current;
      if (narrow && typeof window.matchMedia === "function" && !window.matchMedia(RAIL_WIDE_QUERY).matches) {
        e.preventDefault();
        narrow(previous);
        return;
      }
      input.focus();
      // A hidden rail (below 900px) has an input that cannot take focus: then
      // find is not here to open, and the browser keeps its own shortcut.
      if (document.activeElement !== input) return;
      e.preventDefault();
      if (previous !== input) returnTo.current = previous;
      input.select();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Asked to start focused (the drawer opened on find): take focus, caret at the end.
  useEffect(() => {
    const input = inputRef.current;
    if (!initialFocused || !input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    // Mount-only: these describe how the box starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Anchored beside the rail, level with the find box. Fixed, because the
  // rail's own scroll container would clip anything absolutely placed in it.
  // In the drawer there is no room beside it, so the panel opens below the box.
  useLayoutEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    const box = input.getBoundingClientRect();
    if (inDrawer) {
      setPlace({ top: box.bottom + 6, left: box.left });
      return;
    }
    const rail = input.closest("aside")?.getBoundingClientRect();
    setPlace({ top: box.top, left: rail ? rail.right + 8 : box.left });
  }, [open, inDrawer]);

  // The box is uncontrolled (its value is the server's at rest), so clearing
  // the query clears the element too.
  const clearQuery = () => {
    setQuery("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    setOpen(false);
    const target = returnTo.current;
    returnTo.current = null;
    const input = inputRef.current;
    if (target instanceof HTMLElement && target !== input && target.isConnected && target !== document.body) {
      target.focus();
    } else {
      input?.blur();
    }
  };

  // A move is the end of a search (critique 2026-10-27): the query clears,
  // the panel closes, and focus leaves the box, so the page arrived at takes
  // focus as any in-app move's does (its heading, or the row a hash names)
  // instead of the panel covering where the operator landed.
  const go = (href: string) => {
    clearQuery();
    setOpen(false);
    returnTo.current = null;
    inputRef.current?.blur();
    navigate(href);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (inDrawer) {
        // A closed panel leaves Escape to the drawer, which closes on it.
        if (!open) return;
        // An open one closes and keeps focus in the box, inside the drawer.
        e.preventDefault();
        setOpen(false);
        clearQuery();
        return;
      }
      e.preventDefault();
      // Cleared, so the next ⌘K opens fresh rather than on the last search.
      clearQuery();
      close();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (items.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + items.length) % items.length);
      return;
    }
    if (e.key === "Enter" && open && current >= 0) {
      e.preventDefault();
      const item = items[current];
      if (item) go(item.href);
    }
  };

  const activeItem = current >= 0 ? items[current] : undefined;
  // Each shown group's first index in the flat list the arrow keys walk.
  const starts = shown.map((_, n) => shown.slice(0, n).reduce((sum, g) => sum + g.items.length, 0));

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id="find"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="find"
        aria-label="Find a site or unit"
        role="combobox"
        aria-expanded={open}
        aria-controls={FIND_LIST_ID}
        aria-autocomplete="list"
        aria-activedescendant={open && activeItem ? optionId(activeItem.href) : undefined}
        className={RAIL_FIND}
        defaultValue={initialQuery || undefined}
        onFocus={(e) => {
          if (!returnTo.current) returnTo.current = e.relatedTarget;
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          returnTo.current = null;
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveHref(null);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {/* The server's rail wrote a space here; kept so the markup is the same (the hint is absolutely placed, so it renders nothing). */}
      {" "}
      <kbd data-find-hint="" className={RAIL_FIND_HINT}>
        {findHint}
      </kbd>
      {open ? (
        <div
          className={FIND_PANEL}
          style={place ? { top: `${place.top}px`, left: `${place.left}px` } : undefined}
          data-find-panel=""
        >
          <div role="listbox" id={FIND_LIST_ID} aria-label="Find results" className={FIND_LIST}>
            {q === "" && shown.length === 0 ? (
              <p role="presentation" className={FIND_EMPTY}>
                {health ? "Nothing needs attention." : "health unavailable"}
              </p>
            ) : (
              shown.map((g, n) => (
                // A named group, so a screen reader hears each option's own group.
                <div key={g.key} role="group" aria-labelledby={headingId(g.key)} data-find-group={g.key}>
                  <p id={headingId(g.key)} role="presentation" data-find-heading="" className={FIND_HEADING}>
                    {GROUP_LABEL[g.key]}
                  </p>
                  {g.items.length === 0 ? (
                    <p role="presentation" className={FIND_EMPTY}>
                      {noMatch(g.key, q)}
                    </p>
                  ) : (
                    g.items.map((item, k) => {
                      const i = (starts[n] ?? 0) + k;
                      return (
                        <div
                          key={item.href}
                          id={optionId(item.href)}
                          role="option"
                          aria-selected={i === current}
                          className={FIND_OPTION}
                          onMouseEnter={() => setActive(i)}
                          // Keep focus in the input, so the click lands before blur closes the panel.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => go(item.href)}
                        >
                          <Row item={item} domain={domain} />
                        </div>
                      );
                    })
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
