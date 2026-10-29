import type { ActivityEvent } from "../../shared/activity";
import { RailLink } from "../clientNav";
import { shortAge } from "../../views/activityModel";
import { ACTIVITY_DETAIL } from "../../views/activityPageModel";
import { ACTIVITY_KIND_TAG, ACTIVITY_OUTCOME, ACTIVITY_SUBJECT, ACTIVITY_SUBJECT_LINK, ACTIVITY_TD } from "../../views/overviewModel";

/**
 * One event as a table row: the overview's five cells. With `showDetail` a
 * failed row's error text follows its outcome word, in full; the overview
 * passes false, so its markup is unchanged.
 */
export function ActivityRow({ event: e, now, showDetail }: { event: ActivityEvent; now: Date; showDetail: boolean }) {
  return (
    <tr>
      <td className={ACTIVITY_TD}>
        <time dateTime={e.at} title={new Date(e.at).toLocaleString()}>
          {shortAge(e.at, now)}
        </time>
      </td>
      <td className={ACTIVITY_TD}>{e.who}</td>
      <td className={ACTIVITY_TD}>
        <span className={ACTIVITY_KIND_TAG}>{e.kind}</span>
      </td>
      <td className={ACTIVITY_TD}>
        {e.href ? (
          <RailLink href={e.href} className={ACTIVITY_SUBJECT_LINK}>
            {e.subject}
          </RailLink>
        ) : (
          <span className={ACTIVITY_SUBJECT}>{e.subject}</span>
        )}
      </td>
      <td className={ACTIVITY_TD}>
        <span className={ACTIVITY_OUTCOME[e.tone]}>{e.outcome}</span>
        {showDetail && e.detail !== null ? <span className={ACTIVITY_DETAIL}>{e.detail}</span> : null}
      </td>
    </tr>
  );
}
