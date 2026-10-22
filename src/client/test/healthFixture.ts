import type { HealthPayload, UnitHealth } from "../../shared/health";

const unit = (name: string, group: UnitHealth["group"], extra: Partial<UnitHealth> = {}): UnitHealth => ({
  name,
  group,
  tone: "ok",
  label: "running",
  trouble: null,
  href: `/${group === "service" ? "services" : group}#service-${name}`,
  attention: false,
  ...extra,
});

/**
 * A health payload for the seeded sites (src/dev/testHelpers' SEEDED_RAIL_SITES):
 * two sites need attention (api, broken) and three services do, one of them a
 * running service whose deploy is blocked. Reconciler and infrastructure units
 * are all healthy, so their counts are zero.
 */
export function seedHealth(): HealthPayload {
  return {
    now: "2026-10-22T12:00:00.000Z",
    sites: [
      { hostname: "lychee.land", tone: "none", label: "", attention: false },
      { hostname: "blog.lychee.land", tone: "none", label: "", attention: false },
      { hostname: "api.lychee.land", tone: "bad", label: "not responding", attention: true },
      { hostname: "app.lychee.land", tone: "ok", label: "running", attention: false },
      { hostname: "preview.lychee.land", tone: "neutral", label: "awaiting image", attention: false },
      { hostname: "broken.lychee.land", tone: "bad", label: "failed", attention: true },
      { hostname: "gone.lychee.land", tone: "neutral", label: "not deployed", attention: false },
      { hostname: "legacy.lychee.land", tone: "neutral", label: "not deployed", attention: false },
    ],
    units: [
      unit("palworld", "service", { tone: "bad", label: "exited", attention: true }),
      unit("swee", "service", { trouble: "blocked", attention: true }),
      unit("palsave-api", "service", { tone: "bad", label: "failed", attention: true }),
      unit("ntfy", "service"),
      unit("lychee-watch", "reconciler"),
      unit("caddy", "infrastructure"),
    ],
  };
}
