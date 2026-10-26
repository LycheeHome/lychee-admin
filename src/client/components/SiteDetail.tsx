import { Fragment, useRef, type ReactNode, type Ref } from "react";
import { describeStatus, splitHostnameForDisplay, visitIsForward, type StatusTone } from "../../lib/siteDisplay";
import { IMAGE_PREFIX } from "../../lib/platform";
import type { SiteDetailPayload } from "../../shared/siteDetail";
import { rowLabels } from "../../views/boardFacts";
import { FRAMEWORK_LABELS } from "../../views/siteListModel";
import {
  appFix,
  cardOrder,
  dangerSentences,
  hopFixKeys,
  manualSteps,
  removeDeclaration,
  removeSteps,
  unitPhrase,
  UNIT_FIX_COMMANDS,
  DETAIL_KEY,
  DETAIL_ROW,
  HOP_LABEL,
  HOP_VALUE,
  INLINE_CODE,
  STEP_NUMBER,
  STEP_TEXT,
  type HopFixKey,
  type Inline,
  type ManualStep,
  type StepCommand,
} from "../../views/siteDetailModel";
import {
  BODY,
  BUTTON_DANGER,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  CARD,
  CARD_LABEL,
  CARD_LABEL_BASE,
  DETAIL_WIDTH,
  ERROR_BOX,
  FOCUS_RING,
  FRAME_WIDTH,
  MONO_FACT,
  TONE_PILL,
  TONE_TEXT,
  statePhrase,
} from "../../views/shared";
import { RailLink } from "../clientNav";
import { CommandBlock, CopyButton, FailureLine, Icon } from "./CommandBlock";
import { RemoveDialog, type RemoveDialogHandle } from "./RemoveDialog";
import { RepositoryCard, type SiteWrites } from "./RepositoryCard";
import { RetiredNotice } from "./RetiredNotice";
import { resourceNameFor } from "../../lib/siteResource";

/*
 * The site page's markup in JSX, element for element what the retired
 * html.ts's renderSiteDetail wrote for the header, the request path (What to
 * check included), Manual steps and the Danger card with its closed dialog,
 * plus the not-found and Caddyfile-error bodies. Every decision is
 * siteDetailModel's; SiteDetailParity.test.tsx compares this with the
 * retired renderer's output, frozen in src/dev/fixtures/detail/, the
 * Caddyfile error included (the retired server error page's, frozen the same
 * way).
 *
 * Every phrase the server writes as one text node is one template string
 * here, never adjacent JSX expressions: React would make those separate text
 * nodes (SiteDetailMarkup.test.tsx checks it live).
 */

type DetailPayload = Extract<SiteDetailPayload, { caddyfileError: null }>;

export type SiteDetailProps = {
  /** GET /api/sites/:hostname's answer for a managed site. */
  payload: DetailPayload;
  /** On the hostname heading, so a page can move focus to it. */
  headingRef?: Ref<HTMLHeadingElement>;
  /**
   * The repository card's slot, placed where cardOrder puts it; rendered only
   * for a site that has one. Absent, it is RepositoryCard with `writes` and
   * `cardHeadingRef`.
   */
  card?: ReactNode;
  /** The repository card's writes; absent, its controls are inert. */
  writes?: SiteWrites;
  /** On the repository card's heading (it has no id), so a page can move focus to it. */
  cardHeadingRef?: Ref<HTMLHeadingElement>;
  /** Told when the remove dialog opens and closes, so the page can pause its re-reads (ruling R6). */
  onRemoveDialogChange?: (open: boolean) => void;
};

const TUNNEL_UNIT = "cloudflared-sites.service";
const CADDY_UNIT = "caddy.service";

function Dot() {
  return <span aria-hidden="true">{"●"}</span>;
}

/** path.posix.dirname for the absolute config paths the hops show. */
function dirname(p: string): string {
  const trimmed = p.length > 1 ? p.replace(/\/+$/, "") : p;
  const i = trimmed.lastIndexOf("/");
  if (i === -1) return ".";
  if (i === 0) return "/";
  return trimmed.slice(0, i);
}

function Mono({ value }: { value: string }) {
  return <span className={MONO_FACT}>{value}</span>;
}

function Header({ payload, headingRef }: { payload: DetailPayload; headingRef?: Ref<HTMLHeadingElement> }) {
  const { site, status } = payload;
  const { lead, dimmed } = splitHostnameForDisplay(site.hostname, payload.domain);
  const labels = status ? describeStatus(status) : null;
  return (
    <>
      {/* A block nav, so its children share one line box: the server's
          indentation between them rendered as a word space each side of the
          slash, on top of its mx-1.5, and the explicit spaces keep that. */}
      <nav className="font-mono text-[0.72rem] text-stone-400 m-0" aria-label="Breadcrumb">
        <RailLink href="/" className={`text-stone-400 no-underline hover:text-stone-50 hover:underline ${FOCUS_RING}`}>
          sites
        </RailLink>{" "}
        <span className="text-stone-600 mx-1.5" aria-hidden="true">
          /
        </span>{" "}
        <span className="text-stone-50">{site.hostname}</span>
      </nav>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2
              ref={headingRef}
              id="site-hostname"
              className="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0 break-all"
            >
              {lead}
              {dimmed ? <span className="text-stone-500">{dimmed}</span> : null}
            </h2>
            <CopyButton target="site-hostname" label="Copy hostname" extraClass="shrink-0" />
          </div>
          {labels ? (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className={TONE_PILL[labels.tone]} data-state-pill="">
                <Dot />
                {` ${labels.pill}`}
              </span>
            </div>
          ) : null}
        </div>
        <a
          href={`https://${site.hostname}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${visitIsForward(status) ? BUTTON_PRIMARY : BUTTON_SECONDARY} no-underline shrink-0`}
        >
          {"Visit "}
          <Icon name="externalLink" />
        </a>
      </div>
    </>
  );
}

type Hop = {
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
  subDot?: boolean;
  status?: { text: string; tone: StatusTone };
};

function HopView({ hop }: { hop: Hop }) {
  return (
    <div className="min-w-0">
      <p className={HOP_LABEL}>{hop.label}</p>
      <p className={HOP_VALUE}>{hop.value}</p>
      {hop.status ? (
        <p className={`font-mono text-[0.72rem] ${TONE_TEXT[hop.status.tone]} m-0`} data-hop-status="">
          <Dot />
          {` ${hop.status.text}`}
        </p>
      ) : null}
      {hop.sub ? (
        <p className={`font-mono text-[0.72rem] ${hop.subClass ?? "text-stone-400"} m-0 break-all`}>
          {hop.subDot ? (
            <>
              <Dot />
              {` ${hop.sub}`}
            </>
          ) : (
            hop.sub
          )}
        </p>
      ) : null}
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center text-stone-600 text-sm sm:flex-1 sm:min-w-[2rem]" aria-hidden="true">
      <span className="sm:hidden">{"↓"}</span>
      <span className="hidden sm:inline">{"→"}</span>
    </div>
  );
}

/** One What to check entry's body, from siteDetailModel's hopFixKeys and appFix. */
function FixBody({ hop, payload }: { hop: HopFixKey; payload: DetailPayload }) {
  const { site } = payload;
  if (hop === "tunnel") {
    return (
      <>
        <p className={`${STEP_TEXT} !mb-0`}>
          {`The sites tunnel ${unitPhrase(payload, TUNNEL_UNIT)}, so Cloudflare has nowhere to send this site's requests. Its last 50 log lines usually show why:`}
        </p>
        <CommandBlock id="cmd-fix-tunnel" value={UNIT_FIX_COMMANDS.tunnel} label="Copy journal command" />
      </>
    );
  }
  if (hop === "caddy") {
    return (
      <>
        <p className={`${STEP_TEXT} !mb-0`}>
          {`Caddy ${unitPhrase(payload, CADDY_UNIT)}. Every site on lychee goes through it, so all of them are down, not only this one. Its last 50 log lines usually show why:`}
        </p>
        <CommandBlock id="cmd-fix-caddy" value={UNIT_FIX_COMMANDS.caddy} label="Copy journal command" />
      </>
    );
  }
  const app = appFix(site, payload);
  if (app?.kind === "failed-first-deploy" && payload.resource) {
    // Forced, as the server forces it: the status is the page's verdict.
    return (
      <>
        <FailureLine facts={{ ...payload.resource, result: "failed" }} />
        <p className={`${STEP_TEXT} !mb-0`}>
          To recover, publish a fixed tag; From a repository below offers it to deploy.
        </p>
      </>
    );
  }
  if (app?.kind === "container" && payload.status) {
    return (
      <>
        <p className={`${STEP_TEXT} !mb-0`}>
          {`The container ${statePhrase(describeStatus(payload.status).pill)}. Its last 100 log lines usually show why:`}
        </p>
        <CommandBlock id="cmd-logs" value={app.command} label="Copy logs command" />
      </>
    );
  }
  return (
    <>
      <p className={`${STEP_TEXT} !mb-0`}>
        {"Nothing answered on "}
        <Mono value={`localhost:${site.target}`} />
        {
          ". lychee-admin only routes requests to this port; whatever serves it is started outside the app. This shows what is listening there, and prints only its header row if nothing is:"
        }
      </p>
      <CommandBlock id="cmd-fix-listen" value={app?.kind === "port" ? app.command : ""} label="Copy listen check" />
    </>
  );
}

function RequestPath({ payload }: { payload: DetailPayload }) {
  const { site, filesPath, status, unitStates, resource } = payload;
  const fixes = hopFixKeys(site, payload);
  const labels = status ? describeStatus(status) : null;
  const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;
  const lastHop: Hop =
    site.type === "static"
      ? { label: "Your files", value: "file_server", ...(filesPath ? { sub: filesPath } : {}) }
      : {
          label: "Your app",
          value: `localhost:${site.target}`,
          ...(labels ? { sub: labels.hop, subClass: TONE_TEXT[labels.tone], subDot: true } : {}),
        };
  const unitStatus = (unit: string): Hop["status"] => {
    if (!unitStates) return undefined;
    const unitLabels = rowLabels(unitStates[unit]?.status ?? "unknown");
    return { text: unitLabels.pill, tone: unitLabels.tone };
  };
  const hops: Hop[] = [
    { label: "Cloudflare DNS", value: site.hostname, sub: "manual step" },
    { label: "Tunnel", value: "cloudflared-sites", sub: dirname(payload.tunnelConfigPath), status: unitStatus(TUNNEL_UNIT) },
    { label: "Caddy", value: ":80", sub: dirname(payload.caddyfilePath), status: unitStatus(CADDY_UNIT) },
    lastHop,
  ];
  const image = resource?.repo ? `${IMAGE_PREFIX}${resource.repo}` : null;
  const rows: [string, string][] = [
    ...(frameworkLabel ? ([["framework", frameworkLabel]] as [string, string][]) : []),
    ...(site.healthcheckPath ? ([["healthcheck", site.healthcheckPath]] as [string, string][]) : []),
    ...(site.type !== "static" && filesPath && payload.filesExist ? ([["files", filesPath]] as [string, string][]) : []),
    ...(resource ? ([["resource", resource.name]] as [string, string][]) : []),
    ...(image ? ([["image", image]] as [string, string][]) : []),
  ];

  return (
    <section className={CARD}>
      <h3 className={CARD_LABEL}>Request path</h3>
      <div className="flex flex-col sm:flex-row sm:items-stretch gap-3 sm:gap-0">
        {hops.map((hop, i) => (
          <Fragment key={hop.label}>
            {i > 0 ? <Arrow /> : null}
            <HopView hop={hop} />
          </Fragment>
        ))}
      </div>
      {fixes.length ? (
        <>
          <div className="h-px bg-stone-700 my-4"></div>
          <h4 className={`${HOP_LABEL} !mb-3`}>What to check</h4>
          <div className="flex flex-col gap-4">
            {fixes.map((hop) => (
              <div key={hop} className="grid grid-cols-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <p className="font-mono text-[0.8rem] text-red-300 m-0">
                  <Dot />
                  {` ${hop}`}
                </p>
                <div className="flex flex-col gap-2 min-w-0">
                  <FixBody hop={hop} payload={payload} />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {rows.length ? (
        <>
          <div className="h-px bg-stone-700 my-4"></div>
          {rows.map(([key, value]) => (
            <p key={key} className={DETAIL_ROW}>
              <span className={DETAIL_KEY}>{key}</span>
              <span className="text-stone-50 break-all">
                {/* The resource is a row on the services board; the rest are plain facts. */}
                {key === "resource" ? (
                  <RailLink
                    href={`/services#service-${value}`}
                    className={`text-stone-50 no-underline hover:underline ${FOCUS_RING}`}
                  >
                    {value}
                  </RailLink>
                ) : (
                  value
                )}
              </span>
            </p>
          ))}
        </>
      ) : null}
    </section>
  );
}

/** A sentence's runs: each text run one text node, each machine fact inline code. */
function Runs({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((run, i) =>
        typeof run === "string" ? (
          <Fragment key={i}>{run}</Fragment>
        ) : (
          <code key={i} className={INLINE_CODE}>
            {run.code}
          </code>
        ),
      )}
    </>
  );
}

function StepCommandBlock({ command }: { command: StepCommand }) {
  return <CommandBlock id={command.id} value={command.value} label={command.label ?? "Copy DNS command"} />;
}

function ManualStepView({ step, index }: { step: ManualStep; index: number }) {
  return (
    <div className="flex gap-3">
      <span className={STEP_NUMBER}>{index + 1}</span>
      <div className="flex-1 min-w-0">
        <p className={STEP_TEXT}>
          <Runs runs={step.text} />
        </p>
        {step.command ? <StepCommandBlock command={step.command} /> : null}
        {step.then ? (
          <>
            <p className={`${BODY} mt-3 mb-2`}>
              <Runs runs={step.then.note} />
            </p>
            <StepCommandBlock command={step.then.command} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function ManualSteps({ payload }: { payload: DetailPayload }) {
  const steps = manualSteps(payload.site, payload, payload.filesPath);
  return (
    <section className={CARD}>
      <h3 className={CARD_LABEL}>Manual steps</h3>
      <p className={`${BODY} mb-4`}>Nothing on this page does these for you.</p>
      <div className="flex flex-col gap-4">
        {steps.map((step, index) => (
          <ManualStepView key={index} step={step} index={index} />
        ))}
      </div>
    </section>
  );
}

function DangerZone({
  attached,
  deletableFiles,
  onRemove,
}: {
  attached: boolean;
  deletableFiles: boolean;
  onRemove: () => void;
}) {
  return (
    <section className="border border-red-900/60 bg-red-950/20 rounded-[10px] p-5 mt-4 flex items-center justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <h3 className={`${CARD_LABEL_BASE} text-red-300 m-0 mb-1.5`}>Danger</h3>
        <p className={BODY}>{dangerSentences({ attached, deletableFiles }).join(" ")}</p>
      </div>
      <button
        type="button"
        className={`${BUTTON_DANGER} shrink-0`}
        data-open-dialog="confirm-remove-dialog"
        onClick={onRemove}
      >
        <Icon name="trash" />
        Remove site
      </button>
    </section>
  );
}

/**
 * The site page's body. `card` is the repository card's slot, placed where
 * cardOrder puts it; a site with no scaffold has no repository card.
 */
export function SiteDetail({
  payload,
  headingRef,
  card,
  writes,
  cardHeadingRef,
  onRemoveDialogChange,
}: SiteDetailProps) {
  const { site } = payload;
  const removeDialog = useRef<RemoveDialogHandle>(null);
  // One predicate decides the dialog's fifth step, its note, data-attached,
  // the Danger card's declaration sentence and whether the chain posts
  // /detach: siteDetailModel's removeDeclaration, which removeSteps uses too.
  const declaration = removeDeclaration(site, payload);
  // Offered only for a directory that is actually there.
  const deletableFiles = Boolean(payload.filesPath && payload.filesExist);
  // A retired declaration's notice and Prune sit under the header (the
  // retired-state spec): only a framework site has a declaration to retire.
  const retiredName = payload.detached && site.framework ? resourceNameFor(site.hostname, payload.domain) : null;
  const cards: Record<string, ReactNode> = {
    path: <RequestPath payload={payload} />,
    manual: <ManualSteps payload={payload} />,
    repository:
      card === undefined ? <RepositoryCard payload={payload} writes={writes} headingRef={cardHeadingRef} /> : card,
    danger: (
      <DangerZone
        attached={declaration !== null}
        deletableFiles={deletableFiles}
        onRemove={() => removeDialog.current?.open()}
      />
    ),
  };
  return (
    <>
      <div className={`${DETAIL_WIDTH} flex flex-col gap-5`}>
        <Header payload={payload} headingRef={headingRef} />
        {retiredName ? <RetiredNotice name={retiredName} controls={writes} /> : null}
        {cardOrder(payload).map((name) => (
          <Fragment key={name}>{cards[name]}</Fragment>
        ))}
      </div>
      <RemoveDialog
        ref={removeDialog}
        hostname={site.hostname}
        steps={removeSteps(site, payload)}
        declaration={declaration}
        filesPath={payload.filesPath}
        deletableFiles={deletableFiles}
        dockerWarning={Boolean(site.framework)}
        onOpenChange={onRemoveDialogChange}
      />
    </>
  );
}

/** The retired renderSiteNotFound's body. */
export function SiteNotFound({ hostname }: { hostname: string }) {
  return (
    <div className="max-w-[640px] mx-auto w-full flex flex-col gap-4">
      <h2 className="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0">Site not found</h2>
      <p className="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3">
        {`No managed site found for "${hostname}".`}
      </p>
      <p className="m-0">
        <RailLink href="/" className={`${FOCUS_RING} text-rose-400 no-underline font-mono text-[0.85rem] hover:underline`}>
          {"← Back to sites"}
        </RailLink>
      </p>
    </div>
  );
}

/**
 * The body for an unreadable Caddyfile, on a site's page and on the add page:
 * the exact message and a way back. It was the retired server error page's.
 */
export function CaddyfileError({ message }: { message: string }) {
  return (
    <div className={`${FRAME_WIDTH} flex flex-col gap-4`}>
      <p className={ERROR_BOX}>{message}</p>
      <p className="m-0">
        <RailLink
          href="/"
          className={`text-stone-400 no-underline font-mono text-[0.72rem] hover:text-stone-50 hover:underline ${FOCUS_RING}`}
        >
          {"← sites"}
        </RailLink>
      </p>
    </div>
  );
}
