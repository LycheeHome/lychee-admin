import "../test/setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { HostProblem, SitesPayload, SiteStatus, SiteSummary } from "../../shared/sites";
import { SiteList } from "./SiteList";
import { canonical } from "../test/canonical";

/*
 * The React sites list against what the server's list renderer rendered, for
 * every branch a row, the host-trouble block and the page's two empty shapes
 * can render. The renderer is retired; its output for each payload below is
 * frozen in src/dev/fixtures/sites/ (see serverRegion).
 */

const DOMAIN = "lychee.land";

function payload(extra: Partial<SitesPayload> = {}): SitesPayload {
  return { sites: [], statuses: {}, problems: [], domain: DOMAIN, caddyfileError: null, ...extra };
}

// In src/dev, not src/client: outside the design detector's scope, and like
// all of src/dev, outside the build and the release tree.
const FIXTURES = path.join(__dirname, "../../dev/fixtures/sites");
const read = new Set<string>();

/**
 * The server's list region for a fixture, frozen. Each file is exactly what
 * the retired server list renderer produced for that test's payload, sliced from
 * just after the copy-status live region to </main> (no notice was passed,
 * so there is no #page-notice in it). They were generated from the live
 * renderer and asserted byte-equal to it before it was deleted; they are
 * never regenerated, because there is nothing left to generate them from. A
 * fixture's payload is the one its test builds.
 */
function serverRegion(name: string): string {
  read.add(`${name}.html`);
  return readFileSync(path.join(FIXTURES, `${name}.html`), "utf8");
}

function clientMarkup(p: SitesPayload): string {
  return renderToStaticMarkup(<SiteList payload={p} />);
}

/** Asserts parity and returns the server region, so a test can check it reached the branch it names. */
function assertParity(name: string, p: SitesPayload, reaches: string[] = []): string {
  const server = serverRegion(name);
  const client = clientMarkup(p);
  assert.equal(canonical(client), canonical(server));
  // A space between inline siblings renders; canonical() alone drops it.
  assert.equal(canonical(client, { inlineWhitespace: true }), canonical(server, { inlineWhitespace: true }));
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

describe("SiteList parity with the frozen server list", () => {
  test("a static row has an address and no pill", () => {
    const server = assertParity("static-row", payload({ sites: [STATIC] }), ["data-status-slot></span>", "Add site"]);
    assert.ok(!server.includes("rounded-full"), "a static row must render no pill");
  });

  test("a reverse proxy that is responding", () => {
    assertParity(
      "proxy-responding",
      payload({ sites: [PROXY], statuses: { [PROXY.hostname]: { kind: "tcp", responding: true } } }),
      ["localhost:4000", "responding"],
    );
  });

  test("a reverse proxy that is not responding", () => {
    assertParity(
      "proxy-not-responding",
      payload({ sites: [PROXY], statuses: { [PROXY.hostname]: { kind: "tcp", responding: false } } }),
      ["not responding"],
    );
  });

  test("Next.js running", () => {
    assertParity("nextjs-running", nextWith({ kind: "container", state: "running", health: "healthy" }), [
      "· Next.js",
      "running",
    ]);
  });

  test("Next.js awaiting image", () => {
    assertParity("nextjs-awaiting-image", nextWith({ kind: "awaiting-image" }), ["awaiting image"]);
  });

  test("Next.js failed", () => {
    assertParity("nextjs-failed", nextWith({ kind: "failed" }), ["failed"]);
  });

  test("Next.js not deployed", () => {
    assertParity("nextjs-not-deployed", nextWith({ kind: "container", state: "not-created" }), ["not deployed"]);
  });

  test("an unknown status", () => {
    assertParity("unknown-status", nextWith({ kind: "container", state: "unknown" }), ["unknown"]);
  });

  test("a reverse-proxy row with no status entry has no pill", () => {
    const server = assertParity("proxy-no-status", payload({ sites: [PROXY] }), ["data-status-slot></span>"]);
    assert.ok(!server.includes("rounded-full"));
  });

  test("several rows keep Caddyfile order", () => {
    assertParity(
      "caddyfile-order",
      payload({
        sites: [STATIC, PROXY, NEXT],
        statuses: { [PROXY.hostname]: { kind: "tcp", responding: true }, [NEXT.hostname]: { kind: "failed" } },
      }),
    );
  });

  test("a hostname that is the domain itself is not split", () => {
    assertParity(
      "apex-hostname",
      payload({ sites: [{ hostname: DOMAIN, type: "static", target: `/var/www/${DOMAIN}` }] }),
      [`data-hostname>${DOMAIN}</span>`],
    );
  });

  test("the host-trouble block with one line", () => {
    assertParity("host-trouble-one", payload({ sites: [STATIC], problems: [CADDY_DOWN] }), [
      "data-host-problems",
      "caddy has stopped",
    ]);
  });

  test("the host-trouble block with several lines", () => {
    assertParity("host-trouble-several", payload({ sites: [STATIC], problems: [CADDY_DOWN, WATCH_DOWN] }), [
      "caddy has stopped",
      "lychee-watch-timer is unknown",
    ]);
  });

  test("the host-trouble block above the empty state", () => {
    assertParity("host-trouble-empty-list", payload({ problems: [CADDY_DOWN] }), ["data-host-problems", "empty-state"]);
  });

  test("an empty list shows the empty state and no heading button", () => {
    const server = assertParity("empty", payload(), ["empty-state", "Add your first site", `*.${DOMAIN}`]);
    assert.ok(!server.includes(">Add site<"));
  });

  test("a Caddyfile error renders the error box, then the empty state", () => {
    assertParity(
      "caddyfile-error",
      payload({ caddyfileError: "caddy read failed: permission denied\nopen /etc/caddy/Caddyfile: EACCES" }),
      ["permission denied", "empty-state"],
    );
  });

  test("markup-shaped hostnames, addresses, problems and errors escape as the server escapes them", () => {
    const evil = `a<b&c"d'.${DOMAIN}`;
    assertParity(
      "escaping-sites-and-problems",
      payload({
        sites: [{ hostname: evil, type: "static", target: `/var/www/<x>&"y"` }],
        statuses: {},
        problems: [{ ...CADDY_DOWN, name: `<cad&dy>`, consequence: `Sites "can't" <be> reached & more` }],
      }),
      ["&lt;b&amp;c", "&lt;cad&amp;dy&gt;"],
    );
    assertParity(
      "escaping-error-and-domain",
      payload({ caddyfileError: `<script>alert("x")</script> & more`, domain: `<d&"x>` }),
      ["&lt;script&gt;"],
    );
  });

  test("a 63-character label", () => {
    const label = "a".repeat(63);
    assertParity(
      "long-label",
      payload({
        sites: [{ hostname: `${label}.${DOMAIN}`, type: "reverse-proxy", target: "4100", framework: "nextjs" }],
        statuses: { [`${label}.${DOMAIN}`]: { kind: "container", state: "running", health: "unhealthy" } },
      }),
      [label, "unhealthy"],
    );
  });

  test("a mismatch is caught", () => {
    // The proxy-responding fixture's payload, compared against its frozen region.
    const p = payload({ sites: [PROXY], statuses: { [PROXY.hostname]: { kind: "tcp", responding: true } } });
    const server = serverRegion("proxy-responding");
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

/** Test name → [fixture file, payload]. "the empty state" shares the parity suite's empty fixture. */
const SHAPE_FIXTURES: Record<string, [file: string, payload: SitesPayload]> = {
  "rows of every kind": [
    "shape-rows-of-every-kind",
    payload({
      sites: [STATIC, PROXY, NEXT, { hostname: DOMAIN, type: "static", target: `/var/www/${DOMAIN}` }],
      statuses: { [PROXY.hostname]: { kind: "tcp", responding: false }, [NEXT.hostname]: { kind: "awaiting-image" } },
      problems: [CADDY_DOWN, WATCH_DOWN],
    }),
  ],
  "the empty state": ["empty", payload()],
  "a Caddyfile error": ["shape-caddyfile-error", payload({ caddyfileError: "caddy read failed\nEACCES" })],
};

describe("SiteList writes each phrase as one text node, as the server does", () => {
  for (const [name, [file, p]] of Object.entries(SHAPE_FIXTURES)) {
    test(name, () => {
      const serverHost = document.createElement("div");
      serverHost.innerHTML = serverRegion(file);
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
    const [file] = SHAPE_FIXTURES["rows of every kind"];
    const whole = document.createElement("div");
    whole.innerHTML = serverRegion(file);
    const split = document.createElement("div");
    split.innerHTML = serverRegion(file);
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

// Last in the file, so every test above has run: a frozen file no test reads
// is a branch that has quietly stopped being compared.
describe("the frozen sites fixtures", () => {
  test("every fixture file is read by a parity test", () => {
    const files = readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".html"))
      .sort();
    assert.deepEqual(files, [...read].sort());
  });
});
