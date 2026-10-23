import { useEffect, useRef } from "react";
import { BUTTON_OFFER, BUTTON_PRIMARY_COMPACT, BUTTON_SECONDARY_COMPACT } from "../../views/shared";

/*
 * The deploy lines the services board and the site page share, element for
 * element what html.ts writes: the offer and its Deploy control
 * (renderOfferLine), the requested line that takes its place once the tag is
 * in the declaration (renderRequestedLine), and Prune (renderPruneControl).
 * One component each, so the board's row and the site's repository card can
 * never render them differently.
 *
 * The controls render as the server's do (same data-* attributes, classes and
 * text) and are wired through `controls`; without it they are inert.
 */

/**
 * What the lines need from a page's writes. The board's BoardControls and the
 * site page's SiteWrites both satisfy it. A member absent leaves that control
 * inert.
 */
export type DeployLineControls = {
  deploy?: (name: string, tag: string) => void;
  prune?: (name: string) => void;
  /** Names with a write in flight: their buttons are disabled. */
  busy?: ReadonlySet<string>;
  /** The name whose requested line should take focus now, until `focused` is called. */
  focusRequested?: string | null;
  focused?: () => void;
};

/** html.ts's renderOfferLine: the board's quiet offer, or the page's Primary while a first deploy is next. */
export function OfferLine({
  name,
  tag,
  emphasis = "offer",
  controls,
}: {
  name: string;
  tag: string;
  emphasis?: "offer" | "primary";
  controls?: DeployLineControls;
}) {
  const deploy = controls?.deploy;
  return (
    <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-offer="">
      <span className="font-mono text-[0.8rem] text-rose-300">{`${tag} available`}</span>
      <button
        type="button"
        className={emphasis === "primary" ? BUTTON_PRIMARY_COMPACT : BUTTON_OFFER}
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
export function RequestedLine({ tag, name, controls }: { tag: string; name?: string; controls?: DeployLineControls }) {
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

/**
 * html.ts's renderPruneControl: Secondary on the board, where a row is
 * housekeeping; Primary under a site page's retired warning, where it is the
 * way forward.
 */
export function PruneLine({
  name,
  emphasis = "secondary",
  controls,
}: {
  name: string;
  emphasis?: "secondary" | "primary";
  controls?: DeployLineControls;
}) {
  const prune = controls?.prune;
  return (
    <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-prune-line="">
      <button
        type="button"
        className={emphasis === "primary" ? BUTTON_PRIMARY_COMPACT : BUTTON_SECONDARY_COMPACT}
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
