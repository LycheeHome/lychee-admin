/**
 * Records what a mutating flow actually did, so the UI can report it without
 * ever implying a later step ran when it did not — PRODUCT.md Principle 2.
 *
 * Steps start as "not-run" rather than "ok", so a flow that throws before
 * reaching a step can never report that step as having succeeded. "skipped"
 * is deliberately distinct: it means the step did not apply (a reverse-proxy
 * site with no framework creates no directory), not that a failure blocked it.
 */

export type StepStatus = "ok" | "failed" | "skipped" | "not-run";

export interface StepDefinition {
  id: string;
  label: string;
}

export interface Step extends StepDefinition {
  status: StepStatus;
}

export interface StepReport {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  skip(id: string): void;
  steps(): Step[];
}

export function createStepReport(definitions: readonly StepDefinition[]): StepReport {
  const statuses = new Map<string, StepStatus>(definitions.map((step) => [step.id, "not-run"]));

  function assertKnown(id: string): void {
    if (!statuses.has(id)) throw new Error(`Unknown step "${id}"`);
  }

  return {
    async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
      assertKnown(id);
      try {
        const result = await fn();
        statuses.set(id, "ok");
        return result;
      } catch (error) {
        statuses.set(id, "failed");
        throw error;
      }
    },
    skip(id: string): void {
      assertKnown(id);
      statuses.set(id, "skipped");
    },
    steps(): Step[] {
      return definitions.map((step) => ({ ...step, status: statuses.get(step.id) ?? "not-run" }));
    },
  };
}

/** The four steps the remove dialog promises, in execution order. */
export const REMOVE_STEPS: readonly StepDefinition[] = [
  { id: "caddyfile", label: "Caddyfile block removed" },
  { id: "tunnel", label: "Tunnel route removed" },
  { id: "caddy", label: "Caddy validated and reloaded" },
  { id: "cloudflared", label: "cloudflared-sites restarted" },
];

/** The add flow's steps, in execution order. */
export const ADD_STEPS: readonly StepDefinition[] = [
  { id: "backup", label: "Configs backed up" },
  { id: "caddyfile", label: "Caddyfile block appended" },
  { id: "files", label: "Site directory created" },
  { id: "tunnel", label: "Tunnel route added" },
  { id: "caddy", label: "Caddy validated and reloaded" },
  { id: "cloudflared", label: "cloudflared-sites restarted" },
];
