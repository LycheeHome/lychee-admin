import "../test/setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { HostProblem, SitesPayload, SiteStatus, SiteSummary } from "../../shared/sites";
import { renderSiteList } from "../../views/html";
import { testShell } from "../../dev/testHelpers";
import { SiteList } from "./SiteList";
import { canonical } from "../test/canonical";

/*
 * The React sites list against the server's renderSiteList, for every branch
 * a row, the host-trouble block and the page's two empty shapes can render.
 * Task 5 freezes the server side into fixtures before renderSiteList is
 * deleted; until then it is compared live.
 */

const DOMAIN = "lychee.land";

function payload(extra: Partial<SitesPayload> = {}): SitesPayload {
  return { sites: [], statuses: {}, problems: [], domain: DOMAIN, caddyfileError: null, ...extra };
}

/**
 * The server's list region: everything layout() puts after the copy-status
 * live region and before </main>, which is the body renderSiteList hands it
 * (no notice is passed, so there is no #page-notice in between).
 */
function serverRegion(p: SitesPayload): string {
  const page = renderSiteList(
    p.sites,
    p.statuses,
    p.domain,
    p.caddyfileError ?? undefined,
    undefined,
    p.problems,
    testShell({ current: { page: "sites" } }),
  );
  const start = page.indexOf('aria-live="polite"></span>');
  const end = page.indexOf("</main>");
  assert.ok(start > 0 && end > start, "could not find the list region");
  return page.slice(start + 'aria-live="polite"></span>'.length, end);
}

function clientMarkup(p: SitesPayload): string {
  return renderToStaticMarkup(<SiteList payload={p} />);
}

/** Asserts parity and returns the server region, so a test can check it reached the branch it names. */
function assertParity(p: SitesPayload, reaches: string[] = []): string {
  const server = serverRegion(p);
  assert.equal(canonical(clientMarkup(p)), canonical(server));
  for (const branch of reaches) assert.ok(server.includes(branch), `fixture never reached ${branch}`);
  return server;
}

const STATIC: SiteSummary = { hostname: `blog.${DOMAIN}`, type: "static", target: `/var/www/blog.${DOMAIN}` };
const PROXY: SiteSummary = { hostname: `api.${DOMAIN}`, type: "reverse-proxy", target: "4000" };
const NEXT: SiteSummary = { hostname: `app.${DOMAIN}`, type: "reverse-proxy", target: "3000", framework: "nextjs" };

const CADDY_DOWN: HostProblem = {
  name: "caddy",
  word: "exited",
  consequence: "Sites can't be reached",
  page: "infrastructure",
  href: "/infrastructure",
};
const WATCH_DOWN: HostProblem = {
  name: "lychee-watch-timer",
  word: "unknown",
  consequence: "Changes wait for the 15-minute run",
  page: "reconciler",
  href: "/reconciler",
};

const nextWith = (status: SiteStatus): SitesPayload => payload({ sites: [NEXT], statuses: { [NEXT.hostname]: status } });

describe("SiteList parity with renderSiteList", () => {
  test("a static row has an address and no pill", () => {
    const server = assertParity(payload({ sites: [STATIC] }), ["data-status-slot></span>", "Add site"]);
    assert.ok(!server.includes("rounded-full"), "a static row must render no pill");
  });

  test("a reverse proxy that is responding", () => {
    assertParity(payload({ sites: [PROXY], statuses: { [PROXY.hostname]: { kind: "tcp", responding: true } } }), [
      "localhost:4000",
      "responding",
    ]);
  });

  test("a reverse proxy that is not responding", () => {
    assertParity(payload({ sites: [PROXY], statuses: { [PROXY.hostname]: { kind: "tcp", responding: false } } }), [
      "not responding",
    ]);
  });

  test("Next.js running", () => {
    assertParity(nextWith({ kind: "container", state: "running", health: "healthy" }), ["· Next.js", "running"]);
  });

  test("Next.js awaiting image", () => {
    assertParity(nextWith({ kind: "awaiting-image" }), ["awaiting image"]);
  });

  test("Next.js failed", () => {
    assertParity(nextWith({ kind: "failed" }), ["failed"]);
  });

  test("Next.js not deployed", () => {
    assertParity(nextWith({ kind: "container", state: "not-created" }), ["not deployed"]);
  });

  test("an unknown status", () => {
    assertParity(nextWith({ kind: "container", state: "unknown" }), ["unknown"]);
  });

  test("a reverse-proxy row with no status entry has no pill", () => {
    const server = assertParity(payload({ sites: [PROXY] }), ["data-status-slot></span>"]);
    assert.ok(!server.includes("rounded-full"));
  });

  test("several rows keep Caddyfile order", () => {
    assertParity(
      payload({
        sites: [STATIC, PROXY, NEXT],
        statuses: { [PROXY.hostname]: { kind: "tcp", responding: true }, [NEXT.hostname]: { kind: "failed" } },
      }),
    );
  });

  test("a hostname that is the domain itself is not split", () => {
    assertParity(payload({ sites: [{ hostname: DOMAIN, type: "static", target: `/var/www/${DOMAIN}` }] }), [
      `data-hostname>${DOMAIN}</span>`,
    ]);
  });

  test("the host-trouble block with one line", () => {
    assertParity(payload({ sites: [STATIC], problems: [CADDY_DOWN] }), ["data-host-problems", "caddy has stopped"]);
  });

  test("the host-trouble block with several lines", () => {
    assertParity(payload({ sites: [STATIC], problems: [CADDY_DOWN, WATCH_DOWN] }), [
      "caddy has stopped",
      "lychee-watch-timer is unknown",
    ]);
  });

  test("the host-trouble block above the empty state", () => {
    assertParity(payload({ problems: [CADDY_DOWN] }), ["data-host-problems", "empty-state"]);
  });

  test("an empty list shows the empty state and no heading button", () => {
    const server = assertParity(payload(), ["empty-state", "Add your first site", `*.${DOMAIN}`]);
    assert.ok(!server.includes(">Add site<"));
  });

  test("a Caddyfile error renders the error box, then the empty state", () => {
    assertParity(payload({ caddyfileError: "caddy read failed: permission denied\nopen /etc/caddy/Caddyfile: EACCES" }), [
      "permission denied",
      "empty-state",
    ]);
  });

  test("markup-shaped hostnames, addresses, problems and errors escape as the server escapes them", () => {
    const evil = `a<b&c"d'.${DOMAIN}`;
    assertParity(
      payload({
        sites: [{ hostname: evil, type: "static", target: `/var/www/<x>&"y"` }],
        statuses: {},
        problems: [{ ...CADDY_DOWN, name: `<cad&dy>`, consequence: `Sites "can't" <be> reached & more` }],
      }),
      ["&lt;b&amp;c", "&lt;cad&amp;dy&gt;"],
    );
    assertParity(payload({ caddyfileError: `<script>alert("x")</script> & more`, domain: `<d&"x>` }), ["&lt;script&gt;"]);
  });

  test("a 63-character label", () => {
    const label = "a".repeat(63);
    assertParity(
      payload({
        sites: [{ hostname: `${label}.${DOMAIN}`, type: "reverse-proxy", target: "4100", framework: "nextjs" }],
        statuses: { [`${label}.${DOMAIN}`]: { kind: "container", state: "running", health: "unhealthy" } },
      }),
      [label, "unhealthy"],
    );
  });

  test("a mismatch is caught", () => {
    const p = payload({ sites: [PROXY], statuses: { [PROXY.hostname]: { kind: "tcp", responding: true } } });
    const server = serverRegion(p);
    const tampered = server.replace(">localhost:4000<", ">localhost:4001<");
    assert.ok(tampered !== server, "the negative case never changed the server markup");
    assert.notEqual(canonical(clientMarkup(p)), canonical(tampered));
  });
});

/**
 * The element tree's shape with every non-whitespace text node in place, for
 * a live React render and the parsed server markup. Whitespace-only text is
 * dropped (it renders nothing between these blocks); every other text node
 * keeps its exact value, so a phrase React split into two nodes shows up as
 * two entries where the server has one.
 */
function shape(node: Node): string {
  if (node.nodeType === 3) {
    const text = node.nodeValue ?? "";
    return /^\s*$/.test(text) ? "" : `#text(${JSON.stringify(text)})`;
  }
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const children = Array.from(el.childNodes).map(shape).filter(Boolean);
  return `${el.tagName.toLowerCase()}[${children.join(",")}]`;
}

const LIVE_FIXTURES: Record<string, SitesPayload> = {
  "rows of every kind": payload({
    sites: [STATIC, PROXY, NEXT, { hostname: DOMAIN, type: "static", target: `/var/www/${DOMAIN}` }],
    statuses: { [PROXY.hostname]: { kind: "tcp", responding: false }, [NEXT.hostname]: { kind: "awaiting-image" } },
    problems: [CADDY_DOWN, WATCH_DOWN],
  }),
  "the empty state": payload(),
  "a Caddyfile error": payload({ caddyfileError: "caddy read failed\nEACCES" }),
};

describe("SiteList writes each phrase as one text node, as the server does", () => {
  for (const [name, p] of Object.entries(LIVE_FIXTURES)) {
    test(name, () => {
      const serverHost = document.createElement("div");
      serverHost.innerHTML = serverRegion(p);
      const clientHost = document.createElement("div");
      document.body.append(clientHost);
      const root = createRoot(clientHost);
      flushSync(() => root.render(<SiteList payload={p} />));
      try {
        assert.equal(shape(clientHost), shape(serverHost));
      } finally {
        root.unmount();
        clientHost.remove();
      }
    });
  }

  test("a phrase split into two text nodes is caught", () => {
    const p = LIVE_FIXTURES["rows of every kind"];
    const whole = document.createElement("div");
    whole.innerHTML = serverRegion(p);
    const split = document.createElement("div");
    split.innerHTML = serverRegion(p);
    const pill = split.querySelector("[data-status-slot] > span:last-child");
    const text = pill?.lastChild;
    assert.ok(text && text.nodeType === 3, "no pill text to split");
    // " not responding" -> " not", " responding": the same characters in two
    // nodes, as adjacent JSX expressions would write them.
    (text as Text).splitText(4);
    assert.equal(split.textContent, whole.textContent);
    assert.notEqual(shape(split), shape(whole));
  });
});
