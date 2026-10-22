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
} from "../../views/railModel";
import { TONE_PILL } from "../../views/shared";
import type { RailData } from "../../views/shell";
import { attentionResults, findResults, type FindGroupKey, type FindItem } from "../find";

/*
 * The ⌘K find box and its panel: a combobox over every site and unit. Closed
 * and unfocused it renders exactly the server's find box (src/views/rail.ts),
 * which the rail parity test pins. It lists places only, never actions.
 */

export interface FindPanelProps {
  /** The latest health payload, or null before the first answer (or after a failed poll). */
  health: HealthPayload | null;
  /** The rail's own site list, matched when no health has been read. */
  railSites: RailData["sites"];
  /** Opens a row. A full page load until a router exists. */
  navigate?: (href: string) => void;
  /** The managed domain, dimmed in hostnames as the rail dims it. */
  domain?: string;
  /** The printed shortcut: `⌘K` (the server's) or `Ctrl K`. */
  findHint?: string;
  /** Text typed into the server's input before this mounted over it. */
  initialQuery?: string;
  /** The server's input had focus when this mounted over it. */
  initialFocused?: boolean;
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

const defaultNavigate = (href: string): void => {
  window.location.assign(href);
};

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
  navigate = defaultNavigate,
  domain,
  findHint = "⌘K",
  initialQuery = "",
  initialFocused = false,
}: FindPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Where Escape sends focus: whatever had it before find opened.
  const returnTo = useRef<Element | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  const q = query.trim();
  const groups = useMemo(
    () => (q === "" ? attentionResults(health) : findResults(q, health, railSites)),
    [q, health, railSites],
  );
  // With nothing typed only the groups that have something are shown.
  const shown = q === "" ? groups.filter((g) => g.items.length > 0) : groups;
  const items = shown.flatMap((g) => g.items);
  const current = items.length === 0 ? -1 : Math.min(active, items.length - 1);

  // ⌘K / Ctrl+K from anywhere, inputs and textareas included.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isFindShortcut(e)) return;
      const input = inputRef.current;
      if (!input) return;
      e.preventDefault();
      if (document.activeElement !== input) returnTo.current = document.activeElement;
      input.focus();
      input.select();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // The server's input had focus: take it over, caret at the end.
  useEffect(() => {
    const input = inputRef.current;
    if (!initialFocused || !input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    // Mount-only: these describe the server input this replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Anchored beside the rail, level with the find box. Fixed, because the
  // rail's own scroll container would clip anything absolutely placed in it.
  useLayoutEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    const box = input.getBoundingClientRect();
    const rail = input.closest("aside")?.getBoundingClientRect();
    setPlace({ top: box.top, left: rail ? rail.right + 8 : box.left });
  }, [open]);

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

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
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
      if (item) navigate(item.href);
    }
  };

  const optionId = (i: number) => `find-option-${i}`;
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
        aria-activedescendant={open && current >= 0 ? optionId(current) : undefined}
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
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
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
                <div key={g.key} role="presentation" data-find-group={g.key}>
                  <p role="presentation" data-find-heading="" className={FIND_HEADING}>
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
                          id={optionId(i)}
                          role="option"
                          aria-selected={i === current}
                          className={FIND_OPTION}
                          onMouseEnter={() => setActive(i)}
                          // Keep focus in the input, so the click lands before blur closes the panel.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => navigate(item.href)}
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
