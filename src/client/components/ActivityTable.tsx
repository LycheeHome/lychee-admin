import type { ReactNode } from "react";
import type { ActivityPayload } from "../../shared/activity";
import { RailLink } from "../clientNav";
import { shortAge } from "../../views/activityModel";
import {
  ACTIVITY_ALERT_SLOT,
  ACTIVITY_HEADING,
  ACTIVITY_KIND_TAG,
  ACTIVITY_NOTE,
  ACTIVITY_OUTCOME,
  ACTIVITY_SCROLL,
  ACTIVITY_SUBJECT,
  ACTIVITY_SUBJECT_LINK,
  ACTIVITY_TABLE,
  ACTIVITY_TD,
  ACTIVITY_TH,
} from "../../views/overviewModel";
import { BOARD_ALERT } from "./BoardRows";

const COLUMNS = ["when", "who", "kind", "subject", "outcome"] as const;

/** The heading's id, which names the table (one activity table per page). */
const HEADING_ID = "recent-activity";

/** The one line under the table when exactly one source could not be read. */
function sourceLine(sources: ActivityPayload["sources"]): string | null {
  if (!sources.reconciler)
    return "Reconciler history couldn't be read; showing app actions only.";
  if (!sources.app)
    return "The audit log couldn't be read; showing reconciler events only.";
  return null;
}

/**
 * Recent activity: the last events, newest first, as a table. With neither
 * source readable it is one sentence alone; with one, the table (or nothing
 * to tabulate) and a line naming what is missing. `alert` is a failed
 * re-read's line, shown under the last good table until the next good read.
 */
export function ActivityTable({
  payload,
  alert,
}: {
  payload: ActivityPayload | null;
  alert: string | null;
}) {
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
                    <tr key={`${e.at}:${e.who}:${e.subject}:${i}`}>
                      <td className={ACTIVITY_TD}>
                        <time
                          dateTime={e.at}
                          title={new Date(e.at).toLocaleString()}
                        >
                          {shortAge(e.at, now)}
                        </time>
                      </td>
                      <td className={ACTIVITY_TD}>{e.who}</td>
                      <td className={ACTIVITY_TD}>
                        <span className={ACTIVITY_KIND_TAG}>{e.kind}</span>
                      </td>
                      <td className={ACTIVITY_TD}>
                        {e.href ? (
                          <RailLink
                            href={e.href}
                            className={ACTIVITY_SUBJECT_LINK}
                          >
                            {e.subject}
                          </RailLink>
                        ) : (
                          <span className={ACTIVITY_SUBJECT}>{e.subject}</span>
                        )}
                      </td>
                      <td className={ACTIVITY_TD}>
                        <span className={ACTIVITY_OUTCOME[e.tone]}>
                          {e.outcome}
                        </span>
                      </td>
                    </tr>
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
