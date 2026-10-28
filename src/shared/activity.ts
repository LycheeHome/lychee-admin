/** Who did it: this app (the audit log) or the reconciler (its history feed). */
export type ActivityWho = "app" | "reconciler";

export type ActivityKind = "add" | "remove" | "deploy" | "attach" | "repository" | "prune" | "files" | "host" | "stop";

export interface ActivityEvent {
  /** ISO timestamp. */
  at: string;
  who: ActivityWho;
  kind: ActivityKind;
  /** Hostname for a site or a site's container, else the inventory name. */
  subject: string;
  href: string | null;
  /** Short phrase, mono. */
  outcome: string;
  tone: "ok" | "bad" | "neutral";
}

export interface ActivityPayload {
  events: ActivityEvent[];
  sources: { app: boolean; reconciler: boolean };
  now: string;
}
