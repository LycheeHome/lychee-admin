import type { Ref } from "react";
import type { HostProblem, SitesPayload, SiteSummary } from "../../shared/sites";
import { describeStatus, splitHostnameForDisplay } from "../../lib/siteDisplay";
import { ERROR_BOX, ICON_CLASS, PLUS_PATHS, TONE_PILL, statePhrase } from "../../views/shared";
import {
  ADD_SITE_BUTTON,
  ADD_SITE_TEXT,
  EMPTY_STATE,
  EMPTY_STATE_BODY,
  EMPTY_STATE_CODE,
  EMPTY_STATE_CTA_TEXT,
  EMPTY_STATE_LEAD,
  EMPTY_STATE_TAIL,
  EMPTY_STATE_TITLE,
  EMPTY_STATE_TITLE_TEXT,
  HOST_PROBLEM_LINE,
  HOST_PROBLEM_LINK,
  HOST_PROBLEM_UNIT,
  HOST_PROBLEMS,
  SITE_ADDRESS,
  SITE_HOSTNAME,
  SITE_HOSTNAME_DIMMED,
  SITE_ROW,
  SITE_ROW_SIDE,
  SITE_ROW_TEXT,
  SITE_ROWS,
  SITES_HEADING,
  SITES_HEADING_ROW,
  SITES_HEADING_TEXT,
  SPOKEN_COMMA_CLASS,
  SPOKEN_COMMA_TEXT,
  STATUS_SLOT,
  domainPattern,
  siteAddress,
  siteHref,
} from "../../views/siteListModel";

/*
 * The sites list's markup in JSX, element for element what renderSiteList
 * (src/views/html.ts) writes; SiteListParity.test.tsx compares the two. Every
 * class string, word and the row's address come from siteListModel.ts and
 * shared.ts, which the server list renders from too.
 *
 * Every phrase the server writes as one text node is one template string
 * here, never adjacent JSX expressions: React would make those separate text
 * nodes, which sit a fraction of a pixel off the server's one (the board's
 * migration caught that in a pixel compare).
 */

function Dot() {
  return <span aria-hidden="true">{"●"}</span>;
}

function SpokenComma() {
  return <span className={SPOKEN_COMMA_CLASS}>{SPOKEN_COMMA_TEXT}</span>;
}

function PlusIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PLUS_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function ProblemLine({ problem }: { problem: HostProblem }) {
  return (
    <p className={HOST_PROBLEM_LINE}>
      {`${problem.consequence} — `}
      <span className={HOST_PROBLEM_UNIT}>
        <Dot />
        {` ${problem.name} ${statePhrase(problem.word)}`}
      </span>
      {" · "}
      <a href={problem.href} className={HOST_PROBLEM_LINK}>
        {`${problem.page} `}
        <span aria-hidden="true">{"→"}</span>
      </a>
    </p>
  );
}

function SiteRow({ site, payload }: { site: SiteSummary; payload: SitesPayload }) {
  const status = payload.statuses[site.hostname];
  const labels = status ? describeStatus(status) : null;
  const { lead, dimmed } = splitHostnameForDisplay(site.hostname, payload.domain);
  return (
    <a href={siteHref(site.hostname)} className={SITE_ROW}>
      <span className={SITE_ROW_TEXT}>
        <span className={SITE_HOSTNAME} data-hostname="">
          {lead}
          {dimmed ? <span className={SITE_HOSTNAME_DIMMED}>{dimmed}</span> : null}
        </span>
        <SpokenComma />
        <span className={SITE_ADDRESS}>{siteAddress(site)}</span>
      </span>
      <span className={SITE_ROW_SIDE} data-row-side="">
        <span className={STATUS_SLOT} data-status-slot="">
          {labels ? (
            <>
              <SpokenComma />
              <span className={TONE_PILL[labels.tone]}>
                <Dot />
                {` ${labels.pill}`}
              </span>
            </>
          ) : null}
        </span>
      </span>
    </a>
  );
}

function EmptyState({ domain }: { domain: string }) {
  return (
    <div id="empty-state" className={EMPTY_STATE}>
      <h3 className={EMPTY_STATE_TITLE}>{EMPTY_STATE_TITLE_TEXT}</h3>
      <p className={EMPTY_STATE_BODY}>
        {EMPTY_STATE_LEAD}
        <code className={EMPTY_STATE_CODE}>{domainPattern(domain)}</code>
        {EMPTY_STATE_TAIL}
      </p>
      <a id="empty-state-cta" href="/sites/new" className={ADD_SITE_BUTTON}>
        <PlusIcon />
        {EMPTY_STATE_CTA_TEXT}
      </a>
    </div>
  );
}

/**
 * The list's body: the Caddyfile error when there is one, then the heading
 * (with Ember Add site once a site exists), the host-trouble block, and the
 * rows or the empty state. An unreadable Caddyfile arrives with no sites, so
 * it renders the error box above the empty state, as the server list did.
 */
export function SiteList({
  payload,
  headingRef,
}: {
  payload: SitesPayload;
  /**
   * The live page's handle on its heading, for focus after a client
   * navigation. A ref adds nothing to the markup: the page makes the heading
   * focusable only when it moves focus there.
   */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { sites, problems, domain, caddyfileError } = payload;
  return (
    <>
      {caddyfileError ? <p className={ERROR_BOX}>{caddyfileError}</p> : null}
      <section>
        <div className={SITES_HEADING_ROW}>
          <h2 ref={headingRef} className={SITES_HEADING}>
            {SITES_HEADING_TEXT}
          </h2>
          {sites.length === 0 ? null : (
            <a href="/sites/new" className={ADD_SITE_BUTTON}>
              <PlusIcon />
              {ADD_SITE_TEXT}
            </a>
          )}
        </div>
        {problems.length === 0 ? null : (
          <div role="status" data-host-problems="" className={HOST_PROBLEMS}>
            {problems.map((problem) => (
              <ProblemLine key={`${problem.name}:${problem.word}`} problem={problem} />
            ))}
          </div>
        )}
        {sites.length === 0 ? (
          <EmptyState domain={domain} />
        ) : (
          <div className={SITE_ROWS}>
            {sites.map((site) => (
              <SiteRow key={site.hostname} site={site} payload={payload} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
