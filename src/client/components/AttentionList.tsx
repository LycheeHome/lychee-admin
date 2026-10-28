import { RailLink } from "../clientNav";
import {
  ATTENTION_HEADING,
  ATTENTION_LIST,
  ATTENTION_PILL,
  ATTENTION_ROW,
  ATTENTION_SUBHEAD,
  ATTENTION_SUBJECT,
  ATTENTION_UNAVAILABLE,
  ATTENTION_WHERE,
  type AttentionRow,
} from "../../views/overviewModel";
import { TONE_PILL, formatAge } from "../../views/shared";

function Row({ row }: { row: AttentionRow }) {
  return (
    <li>
      <RailLink href={row.href} className={ATTENTION_ROW}>
        <span className={`${TONE_PILL[row.tone]} ${ATTENTION_PILL}`}>
          <span aria-hidden="true">{"●"}</span> {row.word}
        </span>
        <span className={ATTENTION_SUBJECT}>{row.subject}</span>
        <span className={ATTENTION_WHERE}>{row.where}</span>
      </RailLink>
    </li>
  );
}

function Rows({ rows }: { rows: AttentionRow[] }) {
  return (
    <ul role="list" className={ATTENTION_LIST}>
      {rows.map((r) => (
        <Row key={`${r.where}:${r.subject}`} row={r} />
      ))}
    </ul>
  );
}

/**
 * Needs attention: bad rows under a Scorch heading, then the unread ones under
 * a neutral subheading, each a link to where the thing lives. When the health
 * poll has failed the block is one neutral line instead, never stale rows.
 * Renders nothing when there is nothing to list.
 */
export function AttentionList({
  rows,
  failed,
  lastRead,
  now,
}: {
  rows: { bad: AttentionRow[]; unknown: AttentionRow[] } | null;
  failed: boolean;
  lastRead: string | null;
  now: Date;
}) {
  if (failed) {
    const age = formatAge(lastRead, now);
    return (
      <section data-attention="">
        <p className={ATTENTION_UNAVAILABLE}>{age === null ? "health unavailable" : `health unavailable · last read ${age}`}</p>
      </section>
    );
  }
  if (!rows || (rows.bad.length === 0 && rows.unknown.length === 0)) return null;
  const { bad, unknown } = rows;
  return (
    <section data-attention="">
      {bad.length > 0 ? (
        <>
          <h3 className={ATTENTION_HEADING}>{`${bad.length} ${bad.length === 1 ? "needs" : "need"} attention`}</h3>
          <Rows rows={bad} />
        </>
      ) : null}
      {unknown.length > 0 ? (
        <>
          <h3 className={ATTENTION_SUBHEAD}>{`${unknown.length} couldn't be read`}</h3>
          <Rows rows={unknown} />
        </>
      ) : null}
    </section>
  );
}
