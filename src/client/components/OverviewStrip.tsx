import { RailLink } from "../clientNav";
import { STRIP, STRIP_CELL, STRIP_LABEL, STRIP_NOTE, STRIP_TOTAL, type StripCell } from "../../views/overviewModel";
import { RAIL_COUNT_BAD, RAIL_COUNT_UNKNOWN } from "../../views/railModel";

/**
 * The overview's strip: one flat card of four count lines, each a link to its
 * page. A chip shows only when its count is non-zero, Scorch for bad and
 * neutral for unread, with its word for a screen reader, as the rail's are.
 * No Ember: the page's interactive emphasis is the attention rows.
 */
export function OverviewStrip({ cells }: { cells: StripCell[] }) {
  return (
    <nav aria-label="Host summary" className={STRIP} data-strip="">
      {cells.map((cell) => (
        <RailLink key={cell.page} href={cell.href} className={STRIP_CELL}>
          <span className={STRIP_LABEL}>{cell.page}</span>
          <span className={STRIP_TOTAL}>
            {cell.total}
            {cell.bad > 0 ? (
              <span data-count-bad="" className={RAIL_COUNT_BAD}>
                {cell.bad}
                <span className="sr-only">{cell.bad === 1 ? " needs attention" : " need attention"}</span>
              </span>
            ) : null}
            {cell.unknown > 0 ? (
              <span data-count-unknown="" className={RAIL_COUNT_UNKNOWN}>
                {cell.unknown}
                <span className="sr-only"> unknown</span>
              </span>
            ) : null}
          </span>
          <span className={STRIP_NOTE}>{cell.note}</span>
        </RailLink>
      ))}
    </nav>
  );
}
