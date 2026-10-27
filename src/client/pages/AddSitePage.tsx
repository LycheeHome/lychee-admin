import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type Ref } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { AddSitePayload } from "../../shared/addSite";
import type { SitePreview } from "../../lib/sitePreview";
import { FOCUS_RING, FRAME_WIDTH } from "../../views/shared";
import { ADD_SITE_TITLE } from "../../views/siteListModel";
import { composeHostname, headlineParts, portMessage, resultMarks, skipMarks, type StepMark } from "../addSiteModel";
import { hostnameMessage } from "../../lib/siteNames";
import { addSiteQueryKey, fetchAddSite } from "../api";
import { RailLink, useClientNav } from "../clientNav";
import { BOARD_ALERT } from "../components/BoardRows";
import { hideToast, showToast } from "../toast";
import { AddSiteForm } from "../components/AddSiteForm";
import { AddSitePreview, type PreviewPanel } from "../components/AddSitePreview";
import { CaddyfileError } from "../components/SiteDetail";

/**
 * The add page's body, ported from `renderAddSite` and the add-site block of
 * the retired `public/app.js` step for step, and held to them by the dual run
 * (AddSiteParity.test.tsx): the same elements, classes in the same token
 * order, the same inline styles, the same requests at the same times.
 *
 * Where app.js toggled a class with `classList`, the token order it left
 * behind is part of the markup (`hidden` moves to the end once it has been
 * removed and added back), so those class strings are state, changed by
 * `withToken` exactly as DOMTokenList would change them.
 */

type PreviewAnswer = { ready: true; preview: SitePreview } | { ready: false; error?: string };
type AddAnswer = { hostname?: string; error?: string; steps?: { id: string; status: string }[] };
/** Which element states a rejection: a field's own error, or the panel's box. */
type BlockedBy = "port-error" | "hostname-error" | "preview-error";

const PREVIEW_DEBOUNCE_MS = 250;
const PREVIEW_ERROR_CLASS =
  // Sans: its text is a sentence from the server (spec 2026-10-26-mono-sentences).
  "hidden text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0";
const PORT_ERROR_CLASS = "port-error hidden text-red-300 text-[0.8rem]";
const HOSTNAME_ERROR_CLASS = "hidden text-red-300 text-[0.8rem]";
const PROXY_DESCRIPTION_CLASS = "text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]";
const NEXTJS_DESCRIPTION_CLASS = "hidden text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]";

/** `classList.toggle(token, present)` on a class string: a removed token goes, an added one goes last. */
export function withToken(className: string, token: string, present: boolean): string {
  const tokens = className.split(/\s+/).filter(Boolean);
  if (tokens.includes(token) === present) return className;
  return (present ? [...tokens, token] : tokens.filter((t) => t !== token)).join(" ");
}

function assign(href: string): void {
  window.location.assign(href);
}

/**
 * The add page's facts: the route loader reads them on every arrival (with
 * `?refresh=1`, which pulls the lychee-resources clone first) and the page
 * observes them. Read once per arrival and never again while the page is
 * open: no interval, no focus or reconnect re-read, and never stale, so the
 * page does not mount on the loader's answer and fetch it again. The form
 * holds the operator's typing; a re-read has nothing to add to it, and the
 * preview and submit check the live state themselves.
 */
export function addSiteQuery() {
  return queryOptions({
    queryKey: addSiteQueryKey(),
    queryFn: () => fetchAddSite(false),
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Focus for an in-app arrival: focusable at runtime only, so the markup at rest stays the server's. */
function focusHeading(heading: HTMLHeadingElement | null): void {
  if (!heading) return;
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

/**
 * The add page at `/sites/new`.
 *
 * - Titled `Add a site` on every arrival, as the server titles the shell.
 * - On a client navigation here focus moves to the headline, as the list and
 *   a site's page do; never out of a wide-screen find box. A document load
 *   takes no focus.
 * - An unreadable Caddyfile is the shared CaddyfileError body (AddSiteBody).
 *   A read that failed outright says so, alone, as a failed first read does
 *   on the list and a site's page.
 * - A successful add is a full document load (AddSiteBody's default `go`).
 */
export function AddSitePage() {
  const query = useQuery(addSiteQuery());
  const heading = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    document.title = ADD_SITE_TITLE;
  }, []);

  const nav = useClientNav();
  const arrivedInApp = nav !== null && !nav.documentLoad;

  // Once, when the headline first exists after an in-app arrival. A read that
  // failed, or found the Caddyfile unreadable, gives the move up.
  const data = query.data;
  const hasForm = data !== undefined && data.caddyfileError === null;
  const settled = data !== undefined || query.isError;
  const focused = useRef(!arrivedInApp);
  useEffect(() => {
    if (focused.current || !settled) return;
    focused.current = true;
    if (!hasForm) return;
    const active = document.activeElement;
    if (active?.id === "find" && !active.closest("dialog")) return;
    focusHeading(heading.current);
  }, [hasForm, settled]);

  if (data) return <AddSiteBody payload={data} headingRef={heading} />;
  if (query.error)
    return (
      <p role="alert" className={BOARD_ALERT}>
        {`Couldn't load the add page: ${query.error.message}`}
      </p>
    );
  return null;
}

export type AddSiteBodyProps = {
  payload: AddSitePayload;
  /** The headline, for the routed page to focus on an in-app arrival. */
  headingRef: Ref<HTMLHeadingElement>;
  /** A full document load; a test passes its own. */
  go?: (href: string) => void;
};

export function AddSiteBody({ payload, headingRef, go = assign }: AddSiteBodyProps) {
  if (payload.caddyfileError !== null) return <CaddyfileError message={payload.caddyfileError} />;
  return <AddSiteEditor payload={payload} headingRef={headingRef} go={go} />;
}

function AddSiteEditor({ payload, headingRef, go }: Required<AddSiteBodyProps>) {
  const { domain, portOwners } = payload;

  const [type, setType] = useState("static");
  const [framework, setFramework] = useState("none");
  const [headline, setHeadline] = useState("");
  const [portErrorClass, setPortErrorClass] = useState(PORT_ERROR_CLASS);
  const [portErrorText, setPortErrorText] = useState("");
  const [proxyDescriptionClass, setProxyDescriptionClass] = useState(PROXY_DESCRIPTION_CLASS);
  const [nextjsDescriptionClass, setNextjsDescriptionClass] = useState(NEXTJS_DESCRIPTION_CLASS);
  const [panel, setPanel] = useState<PreviewPanel>({ kind: "rest" });
  const [marks, setMarks] = useState<Record<string, StepMark>>({});
  const [previewErrorClass, setPreviewErrorClass] = useState(PREVIEW_ERROR_CLASS);
  const [previewErrorText, setPreviewErrorText] = useState("");
  const [addErrorClass, setAddErrorClass] = useState(PREVIEW_ERROR_CLASS);
  const [addErrorText, setAddErrorText] = useState("");
  const [blocked, setBlockedState] = useState(false);
  // Where the rejection's reason is shown: the port field, when it already
  // states the same sentence, or the panel's box. Said once, never twice.
  const [blockedBy, setBlockedByState] = useState<BlockedBy>("preview-error");
  const [hostnameErrorClass, setHostnameErrorClass] = useState(HOSTNAME_ERROR_CLASS);
  const [hostnameErrorText, setHostnameErrorText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const portFieldRef = useRef<HTMLInputElement>(null);
  const previewErrorRef = useRef<HTMLParagraphElement>(null);
  // Refs, not state, wherever app.js read a value synchronously: the submit's
  // guards must hold within one event, before any render.
  const blockedRef = useRef(false);
  const blockedByRef = useRef<BlockedBy>("preview-error");
  const hostnameFieldRef = useRef<HTMLInputElement>(null);
  // The hostname field's own sentence as last set, read when a preview answers.
  const hostnameMessageRef = useRef("");
  // The port field's own sentence as last set, read when a preview answers.
  const portMessageRef = useRef("");
  const inFlightRef = useRef(false);
  const sequenceRef = useRef(0);
  // False once the page has gone. An add still in flight then must not act:
  // not navigate the user away from where they went, not hide a toast that
  // may belong to another page, not set state on a gone tree.
  const mountedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // aria-disabled, not `disabled`: the button stays reachable and takes the
  // reader to the reason. `disabled` keeps its one other job, the in-flight submit.
  const setBlocked = useCallback((value: boolean) => {
    blockedRef.current = value;
    setBlockedState(value);
  }, []);

  const refreshPreview = useCallback(async () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const hostname = composeHostname(String(data.get("hostname") ?? ""), domain);
    setHeadline(hostname);

    // Answers can land out of order: only the newest request may render.
    const sequence = ++sequenceRef.current;
    try {
      const response = await fetch("/sites/preview", {
        method: "POST",
        body: new URLSearchParams({
          hostname,
          type: String(data.get("type") ?? "static"),
          port: String(data.get("port") ?? "").trim(),
          framework: String(data.get("framework") ?? "").trim(),
          healthcheckPath: String(data.get("healthcheckPath") ?? "").trim(),
        }),
      });
      if (sequence !== sequenceRef.current) return;
      if (!response.ok) {
        // Not an answer, so not a rejection: a failed read never blocks.
        setBlocked(false);
        return;
      }
      const result = (await response.json()) as PreviewAnswer;
      if (sequence !== sequenceRef.current) return;

      if (result.ready) {
        setBlocked(false);
        setPreviewErrorClass((c) => withToken(c, "hidden", true));
        setPanel({ kind: "preview", preview: result.preview });
        setMarks((m) => ({ ...m, ...skipMarks(result.preview.steps ?? []) }));
        return;
      }
      if (result.error) {
        // A rejection of exactly this input, and the only thing that blocks.
        // When the port field already says the same sentence (both come from
        // portConflictMessage), the panel points up instead of repeating it.
        const owner: BlockedBy =
          result.error === portMessageRef.current
            ? "port-error"
            : result.error === hostnameMessageRef.current
              ? "hostname-error"
              : "preview-error";
        const fieldSays = owner !== "preview-error";
        setBlocked(true);
        blockedByRef.current = owner;
        setBlockedByState(owner);
        setPreviewErrorClass((c) => withToken(c, "hidden", fieldSays));
        setPreviewErrorText(result.error);
        setPanel({
          kind: "message",
          // "In the form", not "above": at desktop width the form is beside the panel.
          text: fieldSays
            ? `Fix the ${owner === "port-error" ? "port" : "hostname"} in the form and the block appears here.`
            : "Fix the problem above and the block appears here.",
        });
        setMarks({});
        return;
      }
      setBlocked(false);
      setPreviewErrorClass((c) => withToken(c, "hidden", true));
      setPanel({ kind: "rest" });
      setMarks({});
    } catch {
      // A failed read keeps the last good panel and never blocks; a throw
      // from a stale request must not unblock a newer rejection.
      if (sequence === sequenceRef.current) setBlocked(false);
    }
  }, [domain, setBlocked]);

  // Makes every request in flight stale, so its answer is dropped. The ref is
  // a counter, not a node, so reading it at cleanup reads the latest count.
  const dropAnswers = useCallback(() => {
    sequenceRef.current += 1;
  }, []);

  const schedulePreview = useCallback(() => {
    // Any edit makes the last rejection about input that no longer exists:
    // lift it at once, so typing a fix and pressing Enter submits.
    setBlocked(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void refreshPreview(), PREVIEW_DEBOUNCE_MS);
  }, [refreshPreview, setBlocked]);

  // The hostname's characters are judged here, by the validator's own
  // sentence, lowercased as the server reads it, so the two can't disagree.
  const onHostnameChange = useCallback(() => {
    const label = hostnameFieldRef.current?.value ?? "";
    const hostname = composeHostname(label, domain).toLowerCase();
    const sentence = hostname ? hostnameMessage(hostname, domain) : null;
    hostnameFieldRef.current?.setCustomValidity(sentence ?? "");
    hostnameMessageRef.current = sentence ?? "";
    setHostnameErrorClass((c) => withToken(c, "hidden", !sentence));
    setHostnameErrorText(sentence ?? "");
    schedulePreview();
  }, [domain, schedulePreview]);

  const validatePort = useCallback(
    (value: string) => {
      const sentence = portMessage(value, portOwners);
      portFieldRef.current?.setCustomValidity(sentence ?? "");
      portMessageRef.current = sentence ?? "";
      setPortErrorClass((c) => withToken(c, "hidden", !sentence));
      setPortErrorText(sentence ?? "");
    },
    [portOwners],
  );

  // A layout effect, not a passive one: its cleanup runs in the commit that
  // removes the page. A passive cleanup runs after a router move commits, so
  // an add answered in between still read the page as mounted, hid another
  // page's toast or navigated away from where the user had gone.
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The arrival preview, the bfcache restore, and leaving: a pending preview
  // is cancelled and any answer still in flight is dropped.
  useEffect(() => {
    void refreshPreview();
    const onPageShow = (event: PageTransitionEvent) => {
      // persisted is true only on a bfcache restore, so this cannot reopen
      // the double-submit window on a live page.
      if (!event.persisted) return;
      inFlightRef.current = false;
      setSubmitting(false);
      hideToast();
      void refreshPreview();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      clearTimeout(timerRef.current);
      dropAnswers();
    };
  }, [refreshPreview, dropAnswers]);

  const onTypeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setType(value);
    // Switching back to reverse proxy re-checks the port, so a conflict typed
    // before the switch away is reported again.
    if (value === "reverse-proxy") validatePort(portFieldRef.current?.value ?? "");
    schedulePreview();
  };

  const onPortChange = (event: ChangeEvent<HTMLInputElement>) => {
    validatePort(event.target.value);
    schedulePreview();
  };

  const onFrameworkChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const isNextjs = event.target.value === "nextjs";
    setFramework(event.target.value);
    setProxyDescriptionClass((c) => withToken(c, "hidden", isNextjs));
    setNextjsDescriptionClass((c) => withToken(c, "hidden", !isNextjs));
    schedulePreview();
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Blocked by a preview rejection: send the reader to the reason, post nothing.
    if (blockedRef.current) {
      if (blockedByRef.current === "port-error") portFieldRef.current?.focus();
      else if (blockedByRef.current === "hostname-error") hostnameFieldRef.current?.focus();
      else previewErrorRef.current?.focus();
      return;
    }
    if (inFlightRef.current) return;

    const data = new FormData(event.currentTarget);
    const hostname = composeHostname(String(data.get("hostname") ?? ""), domain);
    if (!hostname) {
      // `required` passes a whitespace-only value, which composes to nothing.
      setMarks({});
      setAddErrorClass((c) => withToken(c, "hidden", false));
      setAddErrorText("Enter a hostname.");
      return;
    }
    const fields = {
      hostname,
      type: String(data.get("type")),
      port: String(data.get("port") ?? "").trim(),
      framework: String(data.get("framework") ?? "").trim(),
      healthcheckPath: String(data.get("healthcheckPath") ?? "").trim(),
    };

    inFlightRef.current = true;
    setMarks({});
    setAddErrorClass((c) => withToken(c, "hidden", true));
    setSubmitting(true);
    const adding = `Adding ${hostname} — reloading Caddy and restarting cloudflared-sites…`;
    showToast(adding, "info");
    // The toast outlives this page, so an add that settles after leaving settles
    // its own message, and only if it is still the one showing.
    const settleGone = (error?: string) => {
      if (document.getElementById("flash-banner-message")?.textContent !== adding) return;
      if (error === undefined) hideToast();
      else showToast(error, "error");
    };
    try {
      const response = await fetch("/sites", { method: "POST", body: new URLSearchParams(fields) });
      const result = (await response.json()) as AddAnswer;
      if (!mountedRef.current) {
        settleGone(response.ok ? undefined : (result.error ?? "Failed to add site"));
        return;
      }
      if (!response.ok) {
        setMarks((m) => ({ ...m, ...resultMarks(result.steps ?? []) }));
        throw new Error(result.error ?? "Failed to add site");
      }
      // The in-flight guard stays set: the page is leaving, and a second click
      // before the new document loads would re-post a hostname that now exists.
      go(`/sites/${encodeURIComponent(String(result.hostname))}?created=1`);
    } catch (error) {
      if (!mountedRef.current) {
        settleGone(error instanceof Error ? error.message : String(error));
        return;
      }
      inFlightRef.current = false;
      setSubmitting(false);
      hideToast();
      setAddErrorClass((c) => withToken(c, "hidden", false));
      setAddErrorText(error instanceof Error ? error.message : String(error));
      // A preview may have read the half-written state while the add ran; the
      // add has rolled back, so ask again rather than stay blocked on it.
      void refreshPreview();
    }
  };

  const parts = headlineParts(headline, domain);
  const isProxy = type === "reverse-proxy";
  const isNextjs = framework === "nextjs";

  return (
    <div className={`${FRAME_WIDTH} flex flex-col gap-6`}>
      <div className="flex flex-col gap-3">
        {/* A block nav: the server's indentation rendered as a word space each side of the slash. */}
        <nav className="font-mono text-[0.72rem] text-stone-400 m-0" aria-label="Breadcrumb">
          <RailLink href="/" className={`text-stone-400 no-underline hover:text-stone-50 hover:underline ${FOCUS_RING}`}>
            sites
          </RailLink>{" "}
          <span className="text-stone-600 mx-1.5" aria-hidden="true">
            /
          </span>{" "}
          <span className="text-stone-50">new</span>
        </nav>

        {/* The headline is the site being composed, in its detail page's
            Headline treatment; it follows the preview, not the keystroke. */}
        <h2 ref={headingRef} className="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0">
          <span id="composed-hostname" data-domain={domain}>
            {parts === null ? (
              "Add a site"
            ) : "whole" in parts ? (
              parts.whole
            ) : (
              <>
                {parts.label}
                <span className="text-stone-500">{parts.suffix}</span>
              </>
            )}
          </span>
        </h2>
      </div>

      <div id="add-site-columns" className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6 items-start">
        <AddSiteForm
          domain={domain}
          formRef={formRef}
          portFieldRef={portFieldRef}
          isProxy={isProxy}
          isNextjs={isNextjs}
          proxyDescriptionClass={proxyDescriptionClass}
          nextjsDescriptionClass={nextjsDescriptionClass}
          portErrorClass={portErrorClass}
          portErrorText={portErrorText}
          addErrorClass={addErrorClass}
          addErrorText={addErrorText}
          blocked={blocked}
          blockedBy={blockedBy}
          submitting={submitting}
          hostnameFieldRef={hostnameFieldRef}
          hostnameErrorClass={hostnameErrorClass}
          hostnameErrorText={hostnameErrorText}
          onHostnameChange={onHostnameChange}
          onTypeChange={onTypeChange}
          onPortChange={onPortChange}
          onFrameworkChange={onFrameworkChange}
          onHealthcheckChange={schedulePreview}
          onSubmit={(event) => void onSubmit(event)}
        />

        <AddSitePreview
          paths={payload.paths}
          steps={payload.steps}
          panel={panel}
          marks={marks}
          previewErrorRef={previewErrorRef}
          previewErrorClass={previewErrorClass}
          previewErrorText={previewErrorText}
        />
      </div>
    </div>
  );
}
