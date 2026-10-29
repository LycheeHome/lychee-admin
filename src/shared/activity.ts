/** Who did it: this app (the audit log) or the reconciler (its history feed). */
export type ActivityWho = "app" | "reconciler";

export type ActivityKind = "add" | "remove" | "deploy" | "attach" | "repository" | "prune" | "files" | "host" | "stop";

export const ACTIVITY_KINDS: readonly ActivityKind[] = ["add", "remove", "deploy", "attach", "repository", "prune", "files", "host", "stop"];

export const ACTIVITY_WHO: readonly ActivityWho[] = ["app", "reconciler"];

/** What the activity page narrows by; null leaves that dimension open. */
export interface ActivityFilters {
  subject: string | null;
  who: ActivityWho | null;
  kind: ActivityKind | null;
}

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
  /** The error text of a failed, refused or blocked row, shown in full; null elsewhere. Display only, never branched on. */
  detail: string | null;
}

export interface ActivityPayload {
  events: ActivityEvent[];
  /** Opaque cursor for the next older page, or null at the end. */
  next: string | null;
  /** Every distinct subject of the unfiltered history, for the subject filter. */
  subjects: string[];
  sources: { app: boolean; reconciler: boolean };
  now: string;
}
