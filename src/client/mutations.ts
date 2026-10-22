import { useMutation, useMutationState, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { BoardPayload } from "../shared/board";
import { BOARD_QUERY_ROOT } from "./api";
import { HEALTH_QUERY } from "./health";
import { hideToast, showToast } from "./toast";

/*
 * The board's two writes, same endpoints and same copy as the [data-deploy]
 * and [data-prune] handlers in public/app.js (which the server-rendered site
 * page still uses). Both send only the name: the server reads Deploy's tag
 * from the inventory and re-checks Prune's guards after a fresh pull.
 *
 * Unlike app.js, success does not swap markup or reload. It invalidates the
 * board and the rail's health and waits for the board to be re-read, and the
 * rows then render the requested line (or drop the prune line) from the
 * fresh payload. The mutation stays pending until that read lands, which is
 * what keeps the button disabled, so a second click for one change cannot
 * happen.
 */

/** A write the server answered and refused: its text is already the message to show. */
class Refused extends Error {}

type Answer = { ok?: boolean; reason?: string };

async function post(url: string, accepted: (status: number) => boolean, fallback: (status: number) => string): Promise<void> {
  const response = await fetch(url, { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as Answer;
  if (accepted(response.status) && body.ok) return;
  throw new Refused(body.reason ?? fallback(response.status));
}

function refresh(client: QueryClient): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: BOARD_QUERY_ROOT }),
    client.invalidateQueries({ queryKey: HEALTH_QUERY.queryKey }),
  ]);
}

/**
 * Writes between click and settle. React re-renders a disabled button a tick
 * after the click, so a second click inside that tick would otherwise send a
 * second write; this answers synchronously.
 */
const inFlightByClient = new WeakMap<QueryClient, Set<string>>();

function inFlightFor(client: QueryClient): Set<string> {
  let set = inFlightByClient.get(client);
  if (!set) inFlightByClient.set(client, (set = new Set()));
  return set;
}

function begin(client: QueryClient, key: string): boolean {
  const set = inFlightFor(client);
  if (set.has(key)) return false;
  set.add(key);
  return true;
}

/** True when a board query in the cache now says the declaration holds `tag` for `name`. */
function shows(client: QueryClient, name: string, tag: string): boolean {
  return client
    .getQueriesData<BoardPayload>({ queryKey: BOARD_QUERY_ROOT })
    .some(([, data]) => data && Object.hasOwn(data.requested, name) && data.requested[name] === tag);
}

export type DeployVars = { name: string; tag: string };

/** `onRequested` runs once the re-read board shows the requested line, so the page can move focus to it. */
export function useDeploy(onRequested?: (name: string) => void) {
  const client = useQueryClient();
  return useMutation<void, Error, DeployVars>({
    mutationKey: ["deploy"],
    onSettled: (_data, _error, { name }) => void inFlightFor(client).delete(`deploy:${name}`),
    mutationFn: ({ name, tag }) =>
      post(
        `/services/${encodeURIComponent(name)}/deploy`,
        (status) => status >= 200 && status < 300,
        (status) => `Could not request ${tag} for ${name} (HTTP ${status}).`,
      ),
    onMutate: ({ name, tag }) => showToast(`Requesting ${tag} for ${name}…`, "info"),
    onSuccess: async (_data, { name, tag }) => {
      await refresh(client);
      if (shows(client, name, tag)) {
        // The requested line is the feedback now, and it takes focus: the
        // button that had it is gone.
        hideToast();
        onRequested?.(name);
      } else {
        // The re-read failed or shows no requested line (already applied, or
        // the clone lags): never leave the operator with nothing.
        showToast(`Requested ${tag} for ${name}. The reconciler applies it on its next run.`, "success");
      }
    },
    onError: (error, { name, tag }) =>
      showToast(error instanceof Refused ? error.message : `Could not reach the server to request ${tag} for ${name}.`, "error"),
  });
}

export function usePrune() {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationKey: ["prune"],
    onSettled: (_data, _error, name) => void inFlightFor(client).delete(`prune:${name}`),
    mutationFn: (name) =>
      post(
        `/resources/${encodeURIComponent(name)}/prune`,
        (status) => status === 200,
        (status) => `HTTP ${status}`,
      ),
    onMutate: (name) => showToast(`Pruning ${name}.yml from lychee-resources…`, "info"),
    onSuccess: async () => {
      await refresh(client);
      hideToast();
    },
    onError: (error, name) =>
      showToast(
        error instanceof Refused ? `${name}.yml was not pruned: ${error.message}` : `Could not reach the server to prune ${name}.yml.`,
        "error",
      ),
  });
}

/** What the board needs to wire its controls: the writes, and which rows are mid-write. */
export type BoardControlsApi = {
  deploy: (name: string, tag: string) => void;
  prune: (name: string) => void;
  /** Names with a write in flight, until the board has been re-read. */
  busy: ReadonlySet<string>;
  /** The row whose requested line should take focus now, until `focused` is called. */
  focusRequested: string | null;
  focused: () => void;
};

export function useBoardControls(): BoardControlsApi {
  const client = useQueryClient();
  const [focusRequested, setFocusRequested] = useState<string | null>(null);
  const deploy = useDeploy(setFocusRequested);
  const prune = usePrune();
  const deploying = useMutationState({
    filters: { mutationKey: ["deploy"], status: "pending" },
    select: (m) => (m.state.variables as DeployVars).name,
  });
  const pruning = useMutationState({
    filters: { mutationKey: ["prune"], status: "pending" },
    select: (m) => m.state.variables as string,
  });
  return {
    deploy: (name, tag) => {
      if (begin(client, `deploy:${name}`)) deploy.mutate({ name, tag });
    },
    prune: (name) => {
      if (begin(client, `prune:${name}`)) prune.mutate(name);
    },
    busy: new Set([...deploying, ...pruning]),
    focusRequested,
    focused: () => setFocusRequested(null),
  };
}
