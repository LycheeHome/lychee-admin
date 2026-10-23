import { Fragment, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { troubleGate } from "../../lib/siteDisplay";
import { IMAGE_PREFIX } from "../../lib/platform";
import { resourceNameFor } from "../../lib/siteResource";
import type { SiteDetailPayload } from "../../shared/siteDetail";
import {
  canChangeRepository,
  deployStep,
  offerFor,
  runbookSteps,
  CODE_FILE,
  COPY_TOP,
  DETAIL_KEY,
  DETAIL_ROW,
  STEP_DONE,
  STEP_NUMBER,
  type SiteResourceView,
} from "../../views/siteDetailModel";
import {
  BODY,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  CARD,
  CARD_LABEL,
  FOCUS_RING,
  INPUT,
  MONO_FACT,
  PATH_LABEL,
  SERVICE_DETAIL,
} from "../../views/shared";
import { CommandBlock, CopyButton, FailureLine, Icon } from "./CommandBlock";
import { OfferLine, PruneLine, RequestedLine } from "./DeployLines";

/*
 * The site page's "From a repository" card in JSX, element for element what
 * html.ts's renderRepositoryCard writes, in both shapes: the four-step runbook
 * while nothing is installed, and the installed facts with the board's offer
 * once something is. Every decision is siteDetailModel's (runbookSteps,
 * deployStep, offerFor, canChangeRepository); the offer, requested line and
 * Prune are DeployLines.tsx's, the services board's own.
 *
 * Every phrase the server writes as one text node is one template string or
 * one string run here, never adjacent JSX expressions.
 *
 * The server also appends an inert <template data-requested-template> for
 * app.js to clone after a Deploy. React never renders it (ruling R3, spec §5):
 * the requested line comes from the re-read page instead.
 */

type DetailPayload = Extract<SiteDetailPayload, { caddyfileError: null }>;

/**
 * The card's writes (ruling R5). Absent, every control renders exactly as the
 * server renders it and does nothing. The page's hook (useSiteWrites)
 * implements it.
 */
export interface SiteWrites {
  /** POST /services/:name/deploy; the route reads the tag from the inventory, `tag` is for the UI. */
  deploy(name: string, tag: string): void;
  /** POST /resources/:name/prune. */
  prune(name: string): void;
  /** POST /sites/:hostname/attach with the trimmed, non-empty repository name. */
  attach(repo: string): void;
  /** POST /sites/:hostname/repository with the trimmed, non-empty repository name. */
  changeRepository(repo: string): void;
  /** Resource names with a deploy or prune in flight: their Deploy and Prune buttons are disabled. */
  busy: ReadonlySet<string>;
  /** An Attach is in flight (or succeeded and the page is being re-read): its submit is disabled and ignored. */
  attaching: boolean;
  /** The same for Change repository. */
  changingRepository: boolean;
  /** A refused or failed Attach's message for #attach-error, verbatim; null shows nothing. */
  attachError: string | null;
  /** The same for #change-repo-error. */
  changeRepositoryError: string | null;
  /** The resource name whose requested line should take focus now (after a Deploy), until `focused` is called. */
  focusRequested: string | null;
  focused(): void;
}

export type RepositoryCardProps = {
  /** GET /api/sites/:hostname's answer for a managed site. */
  payload: DetailPayload;
  /** Absent: inert controls, byte for byte the server's markup. */
  writes?: SiteWrites;
  /**
   * On the card's "From a repository" h3, which then takes focus
   * (`tabIndex={-1}`). The server's heading has no id, so this ref is the
   * way to it. Absent, the heading is exactly the server's.
   */
  headingRef?: Ref<HTMLHeadingElement>;
};

/** A run of a sentence: plain text (one text node), or a machine fact in mono. */
type Run = string | { mono: string };

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, i) =>
        typeof run === "string" ? (
          <Fragment key={i}>{run}</Fragment>
        ) : (
          <span key={i} className={MONO_FACT}>
            {run.mono}
          </span>
        ),
      )}
    </>
  );
}

/** The runs with a space after them, merged into the last text run so the server's one node stays one. */
function withTrailingSpace(runs: Run[]): Run[] {
  const last = runs[runs.length - 1];
  return typeof last === "string" ? [...runs.slice(0, -1), `${last} `] : [...runs, " "];
}

const DONE = <span className="font-mono text-[0.72rem] font-normal text-stone-400">done</span>;

/** html.ts's runbookStep: a numbered step, or a finished one folded to its summary. */
function RunbookStep({
  step,
  title,
  extra,
  children,
}: {
  step: { n: number; done: boolean; folds: boolean };
  title: Run[];
  extra?: string;
  children: ReactNode;
}) {
  const { n, done } = step;
  if (step.folds) {
    // A finished step collapses to its summary line; the body stays in the page, one click away.
    return (
      <details className="group">
        <summary className={`flex gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden rounded-md ${FOCUS_RING}`}>
          <span className={STEP_DONE}>
            <Icon name="check" />
            <span className="sr-only">{`Step ${n}, done`}</span>
          </span>
          <span className="block text-stone-50 font-semibold text-[0.9rem] leading-snug m-0 flex-1 min-w-0">
            <Runs runs={withTrailingSpace(title)} />
            {DONE}
            {extra ? (
              <>
                {" "}
                <span className="font-mono text-[0.72rem] font-normal text-stone-400">{`· ${extra}`}</span>
              </>
            ) : null}
          </span>
          <span className="text-stone-500 shrink-0 mt-0.5 group-open:rotate-180 motion-safe:transition-transform">
            <Icon name="chevronDown" />
          </span>
        </summary>
        <div className="pl-[1.95rem] pt-2 flex flex-col gap-2">{children}</div>
      </details>
    );
  }
  return (
    <div className="flex gap-3">
      <span className={done ? STEP_DONE : STEP_NUMBER}>
        {done ? (
          <>
            <Icon name="check" />
            <span className="sr-only">{`Step ${n}, done`}</span>
          </>
        ) : (
          n
        )}
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <p className="text-stone-50 font-semibold text-[0.9rem] leading-snug m-0">
          <Runs runs={done ? withTrailingSpace(title) : title} />
          {done ? DONE : null}
        </p>
        {children}
      </div>
    </div>
  );
}

/** html.ts's fileBlock: a scaffold file in full, with its line count and copy button. */
function FileBlock({ file, index }: { file: { name: string; content: string }; index: number }) {
  const id = `scaffold-file-${index}`;
  const body = file.content.trimEnd();
  const lines = body.split("\n").length;
  return (
    <div className="flex flex-col gap-1.5">
      <p className={`${PATH_LABEL} flex justify-between gap-3`}>
        <span>{file.name}</span>
        <span className="shrink-0">{`${lines} ${lines === 1 ? "line" : "lines"}`}</span>
      </p>
      <div className="relative">
        <pre id={id} className={CODE_FILE}>
          {body}
        </pre>
        <CopyButton target={id} label={`Copy ${file.name}`} extraClass={COPY_TOP} />
      </div>
    </div>
  );
}

/** html.ts's gateLine: the gate in full, only for a blocked or failed run. */
function GateLine({ resource }: { resource: SiteResourceView }) {
  const gate = troubleGate(resource);
  return gate ? (
    <p className={`${SERVICE_DETAIL} text-stone-300`} data-gate="">
      {gate}
    </p>
  ) : null;
}

const FORM_ERROR = "font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0";
const EMPTY_REPO = "Enter the repository's name.";

/** html.ts's repoField: the fixed registry prefix joined to the input. Ids are `<id>-row`, `<id>-prefix`, `<id>-repo`. */
function RepoField({
  id,
  value,
  extraDescribedBy,
  inputRef,
}: {
  id: string;
  value: string;
  extraDescribedBy: string;
  inputRef: Ref<HTMLInputElement>;
}) {
  return (
    <span
      id={`${id}-row`}
      className="flex items-stretch min-w-0 flex-1 basis-[18rem] rounded-md focus-within:outline focus-within:outline-2 focus-within:outline-rose-400 focus-within:outline-offset-2"
    >
      <span
        id={`${id}-prefix`}
        className="font-mono text-[0.72rem] text-stone-300 bg-stone-700 border border-r-0 border-stone-700 rounded-l-md px-2.5 flex items-center shrink-0"
      >
        {IMAGE_PREFIX}
      </span>
      <input
        ref={inputRef}
        type="text"
        id={`${id}-repo`}
        name="repo"
        required
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        defaultValue={value || undefined}
        aria-describedby={`${id}-prefix${extraDescribedBy ? ` ${extraDescribedBy}` : ""}`}
        className={`${INPUT} rounded-l-none flex-1 min-w-0 focus:outline-none! disabled:text-stone-500 disabled:cursor-not-allowed`}
        placeholder="repo-name"
      />
    </span>
  );
}

/**
 * The submit handling Attach and Change repository share, as app.js had it:
 * an empty name is refused in the form (focusing the field) and never sent; a
 * pending write ignores a second submit. Without `send` the form is inert.
 */
function useRepoForm(send: ((repo: string) => void) | undefined, pending: boolean, refused: string | null | undefined) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = useState(false);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!send || pending) return;
    const repo = (inputRef.current?.value ?? "").trim();
    if (!repo) {
      setEmpty(true);
      inputRef.current?.focus();
      return;
    }
    setEmpty(false);
    send(repo);
  };
  const error = empty ? EMPTY_REPO : (refused ?? null);
  return { inputRef, onSubmit, error };
}

/** The form's alert region: hidden and empty until there is something to say. */
function FormError({ id, error }: { id: string; error: string | null }) {
  return (
    <p id={id} role="alert" className={error ? FORM_ERROR : `hidden ${FORM_ERROR}`}>
      {error}
    </p>
  );
}

/** html.ts's attachForm, with the retired declaration's warning and Prune as the Primary when detached. */
function AttachForm({
  hostname,
  resourceName,
  detached,
  writes,
}: {
  hostname: string;
  resourceName: string;
  detached: boolean;
  writes?: SiteWrites;
}) {
  const { inputRef, onSubmit, error } = useRepoForm(writes?.attach, writes?.attaching ?? false, writes?.attachError);
  return (
    <form className="flex flex-col gap-1.5" data-attach={hostname} noValidate onSubmit={onSubmit}>
      <label htmlFor="attach-repo" className="text-[0.85rem] text-stone-400">
        Repository in LycheeHome
      </label>
      <div className="flex flex-wrap items-center gap-2.5">
        <RepoField id="attach" value="" extraDescribedBy={detached ? "attach-warning" : ""} inputRef={inputRef} />
        <button
          type="submit"
          className={detached ? BUTTON_SECONDARY : BUTTON_PRIMARY}
          aria-describedby={detached ? "attach-warning" : undefined}
          disabled={writes?.attaching || undefined}
        >
          Attach repository
        </button>
      </div>
      <p className="font-mono text-[0.72rem] text-stone-400 m-0 break-all">
        {`writes ${resourceName}.yml to lychee-resources · no tag until the first deploy`}
      </p>
      {detached ? (
        <>
          <p id="attach-warning" className={`${BODY} text-stone-300`}>
            <Runs
              runs={[
                { mono: `${resourceName}.yml` },
                " is retired (",
                { mono: "state: absent" },
                ") and was still in lychee-resources when this page loaded. Attaching is refused while it is there. Prune it to re-attach; pressing Attach checks again.",
              ]}
            />
          </p>
          <PruneLine name={resourceName} emphasis="primary" controls={writes} />
        </>
      ) : null}
      <FormError id="attach-error" error={error} />
    </form>
  );
}

/** html.ts's changeRepositoryForm: step three's body once the reconciler has found nothing. */
function ChangeRepositoryForm({
  hostname,
  resource,
  writes,
}: {
  hostname: string;
  resource: SiteResourceView & { repo: string };
  writes?: SiteWrites;
}) {
  const { inputRef, onSubmit, error } = useRepoForm(
    writes?.changeRepository,
    writes?.changingRepository ?? false,
    writes?.changeRepositoryError,
  );
  return (
    <>
      <p className={BODY}>
        <Runs
          runs={[
            "No image found at ",
            { mono: `${IMAGE_PREFIX}${resource.repo}` },
            " yet. If ",
            { mono: "v0.1.0" },
            " hasn't been pushed, push it (step 2). If the repository name is wrong, change it here; the reconciler looks again on its next run.",
          ]}
        />
      </p>
      <form className="flex flex-col gap-1.5" data-change-repository={hostname} noValidate onSubmit={onSubmit}>
        <label htmlFor="change-repo-repo" className="text-[0.85rem] text-stone-400">
          Repository in LycheeHome
        </label>
        <div className="flex flex-wrap items-center gap-2.5">
          <RepoField id="change-repo" value={resource.repo} extraDescribedBy="" inputRef={inputRef} />
          <button type="submit" className={BUTTON_SECONDARY} disabled={writes?.changingRepository || undefined}>
            Change repository
          </button>
        </div>
        <p className="font-mono text-[0.72rem] text-stone-400 m-0 break-all">
          {`rewrites the image line in ${resource.name}.yml · only while it has no tag`}
        </p>
        <FormError id="change-repo-error" error={error} />
      </form>
    </>
  );
}

/** html.ts's renderOffer: the offer, or the requested line in its place once the declaration holds that tag. */
function Offer({ offer, writes }: { offer: NonNullable<ReturnType<typeof offerFor>>; writes?: SiteWrites }) {
  return offer.requested ? (
    <RequestedLine tag={offer.tag} name={offer.name} controls={writes} />
  ) : (
    <OfferLine name={offer.name} tag={offer.tag} emphasis={offer.emphasis} controls={writes} />
  );
}

/** html.ts's firstDeploy: what the Deploy step says while nothing runs yet. */
function FirstDeploy({ payload, writes }: { payload: DetailPayload; writes?: SiteWrites }) {
  const resource = payload.resource;
  const step = deployStep(resource);
  if (!resource || step === "unattached") {
    return (
      <p className={BODY}>
        <Runs
          runs={[
            "Once the repository is attached and ",
            { mono: "v0.1.0" },
            " is built, ",
            { mono: "0.1.0" },
            " is offered here. Deploying writes the tag into the declaration; the reconciler starts the container on its next run.",
          ]}
        />
      </p>
    );
  }
  if (step === "unchecked") {
    return (
      <p className={BODY}>
        Attached. The reconciler looks for the image on its next run, usually within two minutes, and offers the newest tag
        here; reload to see it.
      </p>
    );
  }
  const offer = offerFor(payload);
  if (step === "failed") {
    // The reason lives under the request path, where the red hop is.
    return (
      <>
        <p className={BODY}>
          {resource.target ? (
            <Runs
              runs={["Deploying ", { mono: resource.target }, " failed; the reason is under the request path."]}
            />
          ) : (
            "The last deploy failed; the reason is under the request path."
          )}
        </p>
        <GateLine resource={resource} />
        {offer ? <Offer offer={offer} writes={writes} /> : null}
      </>
    );
  }
  if (step === "requested" || step === "requested-blocked") {
    return (
      <>
        <p className="font-mono text-[0.8rem] text-stone-50 m-0">{`${resource.target ?? ""} requested`}</p>
        {step === "requested" ? (
          <p className={BODY}>The reconciler pulls it and starts the container on its next run.</p>
        ) : null}
        <GateLine resource={resource} />
      </>
    );
  }
  if (step === "offer" && offer) {
    return (
      <>
        <GateLine resource={resource} />
        <Offer offer={offer} writes={writes} />
      </>
    );
  }
  if (step === "awaiting-image-change") {
    return (
      <>
        <p className={BODY}>
          Nothing to deploy until the image exists; its newest tag is offered here once the reconciler finds it.
        </p>
        <GateLine resource={resource} />
      </>
    );
  }
  const image = resource.repo ? `${IMAGE_PREFIX}${resource.repo}` : "the image";
  return (
    <>
      <p className={BODY}>
        <Runs
          runs={[
            "No tag found for ",
            { mono: image },
            " yet. Push ",
            { mono: "v0.1.0" },
            "; once its build finishes, the reconciler's next run offers it here.",
          ]}
        />
      </p>
      <GateLine resource={resource} />
    </>
  );
}

function DetailRows({ rows }: { rows: [string, string][] }) {
  return (
    <>
      {rows.map(([key, value]) => (
        <p key={key} className={DETAIL_ROW}>
          <span className={DETAIL_KEY}>{key}</span>
          <span className="text-stone-50 break-all">{value}</span>
        </p>
      ))}
    </>
  );
}

/** The baked-in build and run commands that close the card in every state. */
function Baked({ scaffold }: { scaffold: { buildCommand: string; runCommand: string } }) {
  return (
    <>
      <div className="h-px bg-stone-700 my-4"></div>
      <p className={`${BODY} mb-2`}>
        Baked into the Dockerfile. These run inside the image when it builds — not commands to run yourself.
      </p>
      <DetailRows
        rows={[
          ["build", scaffold.buildCommand],
          ["run", scaffold.runCommand],
        ]}
      />
    </>
  );
}

function Heading({ headingRef }: { headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <h3 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={CARD_LABEL}>
      From a repository
    </h3>
  );
}

/**
 * The repository card, or nothing for a site that has none (no framework, no
 * scaffold, or a hostname with no resource name), as renderSiteDetail decides.
 */
export function RepositoryCard({ payload, writes, headingRef }: RepositoryCardProps) {
  const { site, resource, scaffold } = payload;
  const resourceName = site.framework ? resourceNameFor(site.hostname, payload.domain) : null;
  if (!resourceName || !scaffold) return null;

  if (resource?.version) {
    const repository = resource.repo ? `LycheeHome/${resource.repo}` : null;
    const offer = offerFor(payload);
    const rows: [string, string][] = [
      ["running", resource.version],
      ...(resource.target && resource.target !== resource.version ? ([["requested", resource.target]] as [string, string][]) : []),
      ...(repository ? ([["repository", repository]] as [string, string][]) : []),
    ];
    return (
      <section className={CARD}>
        <Heading headingRef={headingRef} />
        <p className={`${BODY} mb-3`}>
          <Runs
            runs={
              repository
                ? ["Push a newer ", { mono: "vX.Y.Z" }, " tag to ", { mono: repository }, "; it is offered here once the reconciler finds it."]
                : ["Push a newer ", { mono: "vX.Y.Z" }, " tag to the site's repository; it is offered here once the reconciler finds it."]
            }
          />
        </p>
        <DetailRows rows={rows} />
        <FailureLine facts={resource} extraClass="mt-3" />
        <GateLine resource={resource} />
        {offer ? <Offer offer={offer} writes={writes} /> : null}
        <Baked scaffold={scaffold} />
      </section>
    );
  }

  const [one, two, three, four] = runbookSteps(site, payload);
  const files = payload.scaffoldFiles ?? [];
  const scaffoldNames = files.map((f) => f.name.split("/").pop()).join(", ");

  return (
    <section className={CARD}>
      <Heading headingRef={headingRef} />
      <p className={`${BODY} mb-4`}>
        Steps 1 and 2 happen in GitHub; 3 and 4 happen here. Attaching before the first tag is pushed is fine: nothing is
        offered to deploy until the image exists.
      </p>
      <div className="flex flex-col gap-5">
        <RunbookStep step={one} title={["Commit these three files beside your app"]} extra={scaffoldNames}>
          <p className={BODY}>
            <Runs runs={["At the repository's root, next to ", { mono: "package.json" }, "."]} />
          </p>
          {files.map((file, index) => (
            <FileBlock key={index} file={file} index={index} />
          ))}
        </RunbookStep>
        <RunbookStep
          step={two}
          title={["Create the repository in ", { mono: "LycheeHome" }, ", then push tag ", { mono: "v0.1.0" }]}
        >
          <p className={BODY}>
            <Runs
              runs={[
                "It has to live in the ",
                { mono: "LycheeHome" },
                " org: the image is published as ",
                { mono: `${IMAGE_PREFIX}<repo>` },
                ", the only registry path the reconciler accepts. The tag has GitHub's own runners build and push ",
                { mono: `${IMAGE_PREFIX}<repo>:0.1.0` },
                ". Nothing runs on lychee yet.",
              ]}
            />
          </p>
          <CommandBlock id="cmd-tag" value="git tag v0.1.0 && git push origin v0.1.0" label="Copy tag command" />
        </RunbookStep>
        <RunbookStep step={three} title={["Attach the repository"]}>
          {resource ? (
            <>
              <p className="font-mono text-[0.8rem] text-stone-50 m-0 break-all">
                {`${resource.repo ? `${IMAGE_PREFIX}${resource.repo}` : resource.name} `}
                <span className="text-stone-400">{`· ${resource.name}.yml`}</span>
              </p>
              {canChangeRepository(resource) ? (
                <ChangeRepositoryForm hostname={site.hostname} resource={resource} writes={writes} />
              ) : null}
            </>
          ) : (
            <AttachForm
              hostname={site.hostname}
              resourceName={resourceName}
              detached={payload.detached === true}
              writes={writes}
            />
          )}
        </RunbookStep>
        <RunbookStep step={four} title={["Deploy"]}>
          <FirstDeploy payload={payload} writes={writes} />
        </RunbookStep>
      </div>
      <Baked scaffold={scaffold} />
    </section>
  );
}
