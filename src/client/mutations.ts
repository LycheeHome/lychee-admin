import { useMutation, useMutationState, useQueryClient, type QueryClient } from "@tanstack/react-query";
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
const inFlight = new Set<string>();

function begin(key: string): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export type DeployVars = { name: string; tag: string };

export function useDeploy() {
  const client = useQueryClient();
  return useMutation<void, Error, DeployVars>({
    mutationKey: ["deploy"],
    onSettled: (_data, _error, { name }) => void inFlight.delete(`deploy:${name}`),
    mutationFn: ({ name, tag }) =>
      post(
        `/services/${encodeURIComponent(name)}/deploy`,
        (status) => status >= 200 && status < 300,
        (status) => `Could not request ${tag} for ${name} (HTTP ${status}).`,
      ),
    onMutate: ({ name, tag }) => showToast(`Requesting ${tag} for ${name}…`, "info"),
    onSuccess: async () => {
      await refresh(client);
      // The requested line is the feedback now; the toast has nothing to add.
      hideToast();
    },
    onError: (error, { name, tag }) =>
      showToast(error instanceof Refused ? error.message : `Could not reach the server to request ${tag} for ${name}.`, "error"),
  });
}

export function usePrune() {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationKey: ["prune"],
    onSettled: (_data, _error, name) => void inFlight.delete(`prune:${name}`),
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
};

export function useBoardControls(): BoardControlsApi {
  const deploy = useDeploy();
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
      if (begin(`deploy:${name}`)) deploy.mutate({ name, tag });
    },
    prune: (name) => {
      if (begin(`prune:${name}`)) prune.mutate(name);
    },
    busy: new Set([...deploying, ...pruning]),
  };
}
