import type { ReactNode } from "react";
import type { ActivityPayload } from "../../shared/activity";
import { ActivityRow } from "./ActivityRow";
import {
  ACTIVITY_ALERT_SLOT,
  ACTIVITY_HEADING,
  ACTIVITY_NOTE,
  ACTIVITY_SCROLL,
  ACTIVITY_TABLE,
  ACTIVITY_TH,
} from "../../views/overviewModel";
import { BOARD_ALERT } from "./BoardRows";

const COLUMNS = ["when", "who", "kind", "subject", "outcome"] as const;

/** The heading's id, which names the table (one activity table per page). */
const HEADING_ID = "recent-activity";

/** The one line under the table when exactly one source could not be read. */
function sourceLine(sources: ActivityPayload["sources"]): string | null {
  if (!sources.reconciler) return "Reconciler history couldn't be read; showing app actions only.";
  if (!sources.app) return "The audit log couldn't be read; showing reconciler events only.";
  return null;
}

/**
 * Recent activity: the last events, newest first, as a table. With neither
 * source readable it is one sentence alone; with one, the table (or nothing
 * to tabulate) and a line naming what is missing. `alert` is a failed
 * re-read's line, shown under the last good table until the next good read.
 */
export function ActivityTable({ payload, alert }: { payload: ActivityPayload | null; alert: string | null }) {
  const alertLine = alert ? (
    <div className={ACTIVITY_ALERT_SLOT}>
      <p role="alert" className={BOARD_ALERT}>
        {alert}
      </p>
    </div>
  ) : null;
  let body: ReactNode = null;
  if (payload) {
    const { events, sources } = payload;
    const now = new Date(payload.now);
    const missing = sourceLine(sources);
    if (!sources.app && !sources.reconciler) {
      body = <p className={ACTIVITY_NOTE}>Activity couldn't be read.</p>;
    } else {
      body = (
        <>
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
                <tbody>
                  {events.map((e, i) => (
                    <ActivityRow key={`${e.at}:${e.who}:${e.subject}:${i}`} event={e} now={now} showDetail={false} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : missing === null ? (
            <p className={ACTIVITY_NOTE}>Nothing recorded yet.</p>
          ) : null}
          {missing ? <p className={ACTIVITY_NOTE}>{missing}</p> : null}
        </>
      );
    }
  }
  if (!payload && !alert) return null;
  return (
    <section data-activity="">
      <h3 id={HEADING_ID} className={ACTIVITY_HEADING}>
        Recent activity
      </h3>
      {body}
      {alertLine}
    </section>
  );
}
