import { useIsMutating, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type RefObject } from "react";
import type { SiteWrites } from "./components/RepositoryCard";
import { begin, end, post, refresh, Refused, useDeploy, usePrune, type DeployVars } from "./mutations";
import { hideToast, showToast } from "./toast";

/*
 * The site page's card writes (ruling R5's SiteWrites). Deploy and Prune are
 * the board's own mutations (mutations.ts), whose re-read now includes the
 * site page; Attach and Change repository are ported from public/app.js's
 * form[data-attach] and form[data-change-repository] handlers, with their
 * endpoints, bodies and copy unchanged.
 *
 * Where app.js loaded the path on success, these re-read the page and keep
 * the mutation pending until it lands, so the form stays disabled until the
 * page shows what the declaration now says. A refusal or a network failure
 * puts the progress toast away and lands in the form's own alert region.
 *
 * Focus moves to the card's heading only when the element that had it is
 * gone (the rule usePrune follows on the board), and only while the page that
 * asked is still mounted: a write that settles after the operator has left
 * finishes its toasts and touches nothing else.
 */

type SiteWriteKind = "attach" | "change-repository";

/** Every page write of this site, for useSiteWriteInFlight. */
const siteWriteKey = (hostname: string) => ["site-write", hostname] as const;

const formBody = (repo: string) => new URLSearchParams({ repo });

/** POST /sites/:hostname/attach with the repository name; settles once the re-read has landed. */
export function useAttach(hostname: string) {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationKey: siteWriteKey(hostname),
    meta: { kind: "attach" satisfies SiteWriteKind },
    onSettled: () => end(client, `attach:${hostname}`),
    mutationFn: (repo) =>
      post(
        `/sites/${encodeURIComponent(hostname)}/attach`,
        (status) => status >= 200 && status < 300,
        (status) => `Could not attach ${repo} (HTTP ${status}).`,
        formBody(repo),
      ),
    onMutate: (repo) => showToast(`Attaching ${repo} to ${hostname}…`, "info"),
    onSuccess: async () => {
      await refresh(client);
      // The re-read page is the feedback, as the reloaded page was.
      hideToast();
    },
    onError: () => hideToast(),
  });
}

/** POST /sites/:hostname/repository with the new repository name; settles once the re-read has landed. */
export function useChangeRepository(hostname: string) {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationKey: siteWriteKey(hostname),
    meta: { kind: "change-repository" satisfies SiteWriteKind },
    onSettled: () => end(client, `change-repository:${hostname}`),
    mutationFn: (repo) =>
      post(
        `/sites/${encodeURIComponent(hostname)}/repository`,
        (status) => status >= 200 && status < 300,
        (status) => `Could not change the repository to ${repo} (HTTP ${status}).`,
        formBody(repo),
      ),
    onMutate: (repo) => showToast(`Changing ${hostname}'s repository to ${repo}…`, "info"),
    onSuccess: async () => {
      await refresh(client);
      hideToast();
    },
    onError: () => hideToast(),
  });
}

/**
 * True while any write that can change this site's page is in flight,
 * including its re-read: its own Attach or Change repository, or any Deploy or
 * Prune. The page's query does not poll meanwhile.
 */
export function useSiteWriteInFlight(hostname: string): boolean {
  const own = useIsMutating({ mutationKey: siteWriteKey(hostname) });
  const deploys = useIsMutating({ mutationKey: ["deploy"] });
  const prunes = useIsMutating({ mutationKey: ["prune"] });
  return own + deploys + prunes > 0;
}

/**
 * Moves focus to the card's heading only when the control that had it is
 * gone: nothing has focus, or the focused element was removed (the write's
 * own control, `before`, which the re-read replaced). A control that
 * survived the re-read keeps focus, and so does anything the operator moved
 * focus to meanwhile, inside the card or out of it.
 *
 * Runs after React has committed the re-read (see useSiteWrites), so "gone"
 * is a fact about the DOM the operator now sees.
 */
function focusIfLost(heading: HTMLElement | null | undefined, before: Element | null): void {
  if (!heading?.isConnected) return;
  const active = document.activeElement;
  const lost =
    !active || active === document.body || !active.isConnected || (active === before && !before.isConnected);
  if (lost) heading.focus({ preventScroll: true });
}

/** A failed form write's message, as app.js wrote it into the form's alert region. */
function formError(error: Error | null, repo: string | undefined, unreachable: (repo: string) => string): string | null {
  if (!error) return null;
  return error instanceof Refused ? error.message : unreachable(repo ?? "");
}

/**
 * The card's writes for one site. `headingRef` is the card heading's ref
 * (SiteDetail's `cardHeadingRef`), where focus goes when a write's success
 * removes the control that had it.
 */
export function useSiteWrites(hostname: string, headingRef?: RefObject<HTMLHeadingElement | null>): SiteWrites {
  const client = useQueryClient();
  const [focusRequested, setFocusRequested] = useState<string | null>(null);
  const deploy = useDeploy(setFocusRequested);
  const prune = usePrune();
  const attach = useAttach(hostname);
  const changeRepository = useChangeRepository(hostname);

  const deploying = useMutationState({
    filters: { mutationKey: ["deploy"], status: "pending" },
    select: (m) => (m.state.variables as DeployVars).name,
  });
  const pruning = useMutationState({
    filters: { mutationKey: ["prune"], status: "pending" },
    select: (m) => m.state.variables as string,
  });
  // Read from the cache rather than this hook's observers, so a form stays
  // disabled for a write a previous mount of the page started.
  const ownPending = useMutationState({
    filters: { mutationKey: siteWriteKey(hostname), status: "pending" },
    select: (m) => m.options.meta?.kind as SiteWriteKind | undefined,
  });

  /*
   * The heading's focus is decided after React has committed the re-read,
   * the way Deploy defers to focusRequested. A write's success callback runs
   * once the re-read is in the cache but before React renders it, so it only
   * records the request, a task later: the cache's own notification to React
   * is already queued by then, so the render that carries the request also
   * carries the new payload, and the effect below sees the DOM it produced.
   * Per-call callbacks fire only while this page is mounted, so a write that
   * settles after the operator has left asks for nothing.
   */
  const [headingRequest, setHeadingRequest] = useState<{ before: Element | null } | null>(null);
  useEffect(() => {
    if (!headingRequest) return;
    setHeadingRequest(null);
    focusIfLost(headingRef?.current, headingRequest.before);
  }, [headingRequest, headingRef]);
  /** Remembers what had focus as the write was issued, and asks for the heading on success. */
  const thenFocusHeading = () => {
    const before = document.activeElement;
    return { onSuccess: () => void setTimeout(() => setHeadingRequest({ before }), 0) };
  };
  const focused = useCallback(() => setFocusRequested(null), []);

  return {
    deploy: (name, tag) => {
      if (begin(client, `deploy:${name}`)) deploy.mutate({ name, tag });
    },
    prune: (name) => {
      if (begin(client, `prune:${name}`)) prune.mutate(name, thenFocusHeading());
    },
    attach: (repo) => {
      if (begin(client, `attach:${hostname}`)) attach.mutate(repo, thenFocusHeading());
    },
    changeRepository: (repo) => {
      if (begin(client, `change-repository:${hostname}`)) changeRepository.mutate(repo, thenFocusHeading());
    },
    busy: new Set([...deploying, ...pruning]),
    attaching: ownPending.includes("attach"),
    changingRepository: ownPending.includes("change-repository"),
    // A new attempt resets the mutation, so its last error clears as it starts.
    attachError: formError(attach.error, attach.variables, (repo) => `Could not reach the server to attach ${repo}.`),
    changeRepositoryError: formError(
      changeRepository.error,
      changeRepository.variables,
      (repo) => `Could not reach the server to change the repository to ${repo}.`,
    ),
    focusRequested,
    focused,
  };
}
