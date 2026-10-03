import type { UnitStatus } from "./unitState";

export type ContainerState = "not-created" | "running" | "exited" | "restarting" | "paused" | "unknown";
export type ContainerHealth = "healthy" | "unhealthy" | "starting";

export interface ContainerStatus {
  state: ContainerState;
  health?: ContainerHealth;
}

const STATE_MAP: Record<string, ContainerState> = {
  running: "running",
  exited: "exited",
  restarting: "restarting",
  paused: "paused",
  created: "not-created",
  dead: "exited",
};

const HEALTH_MAP: Record<string, ContainerHealth> = {
  healthy: "healthy",
  unhealthy: "unhealthy",
  starting: "starting",
};

/**
 * Parses `docker compose ps --format json` output. Compose versions differ
 * on whether this is a single JSON array or newline-delimited JSON objects
 * (NDJSON) — this handles both rather than assuming a specific Compose
 * version is installed on the host.
 */
export function parseComposePsOutput(raw: string): ContainerStatus {
  const trimmed = raw.trim();
  if (!trimmed) return { state: "not-created" };

  let entries: Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(trimmed);
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try {
      entries = trimmed.split("\n").map((line) => JSON.parse(line));
    } catch {
      return { state: "unknown" };
    }
  }

  if (entries.length === 0) return { state: "not-created" };

  const entry = entries[0];
  const rawState = String(entry.State ?? "").toLowerCase();
  const rawHealth = String(entry.Health ?? "").toLowerCase();

  return {
    state: STATE_MAP[rawState] ?? "unknown",
    health: HEALTH_MAP[rawHealth],
  };
}

/**
 * A container's state as a board-row status. Deliberately UnitStatus and not
 * UnitState: `docker compose ps` reports elapsed text ("Up 2 hours"), not a
 * timestamp, and synthesising one from that would be a fabrication. The row's
 * `since` stays null.
 */
export function toRowStatus(status: ContainerStatus): UnitStatus {
  if (status.state === "running") {
    if (status.health === "unhealthy") return "unhealthy";
    if (status.health === "starting") return "starting";
    return "running";
  }
  return status.state;
}

/** Wrapper output to a row status, through the one compose parser. */
export function parseServiceStatusOutput(raw: string): UnitStatus {
  return toRowStatus(parseComposePsOutput(raw));
}
