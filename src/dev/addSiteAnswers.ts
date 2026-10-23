import { once } from "node:events";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * The server's answers the add page's dual-run harness
 * (`src/client/test/addSiteDualRun.ts`) feeds its stubbed `fetch`, recorded
 * from the dev app — `createApp` over the seeded fakes, exactly what
 * `npm run dev:mock` serves — and saved as
 * `src/client/test/addSiteAnswers.json`.
 *
 * One fault is injected, and only one: `caddy validate` rejects, so the
 * failed submit (step 9) carries real step marks. A hostname that collides
 * with the seed would be the obvious failure, but POST /sites answers that
 * `400 { error }` before any step runs, with no `steps` to mark. Previews
 * never validate, so the fault cannot reach them, and the failed add rolls
 * back, so every request is answered from the same seeded state.
 *
 * To re-record, after a change to the seed, the validators or the preview:
 *
 *   npx tsx src/dev/addSiteAnswers.ts > src/client/test/addSiteAnswers.json
 *
 * `addSiteAnswers.test.ts` re-records on every run and fails when the saved
 * file has drifted from what the app answers now, naming this command. The
 * frozen reference in `src/dev/fixtures/add-site/` was snapshotted against
 * the saved answers, with the retired server page and app.js, and cannot be
 * re-snapshotted: a re-record that changes what a step's request receives
 * breaks the comparison with it, and needs a reason rather than a regenerate.
 */

/**
 * The settings an answer can depend on, pinned before config is loaded:
 * config.ts runs dotenv, so without these a developer's own `.env` (its
 * `PORT`, `BACKUP_DIR`) would leak into the recording and the saved file
 * would differ from what CI records. Set on import, so importing this module
 * before anything loads config is enough; `recordAddSiteAnswers` checks it.
 */
const RECORDING_ENV = {
  DOMAIN: "lychee.land",
  RESERVED_HOSTNAMES: "admin.lychee.land",
  PORT: "8787",
  BACKUP_DIR: "/etc/lychee-admin/backups",
  LOG_FILE: "/var/log/lychee-admin/actions.log",
} as const;
Object.assign(process.env, RECORDING_ENV);

export type RecordedRequest ={ url: "/sites/preview" | "/sites"; fields: Record<string, string> };

/** The fields the add page sends, in its order (the retired app.js's): the URL-encoded body is a key. */
function body(hostname: string, type: string, port: string, framework: string, healthcheckPath: string) {
  return { hostname, type, port, framework, healthcheckPath };
}

const preview = (...args: Parameters<typeof body>): RecordedRequest => ({ url: "/sites/preview", fields: body(...args) });
const submit = (...args: Parameters<typeof body>): RecordedRequest => ({ url: "/sites", fields: body(...args) });

/**
 * Every request the harness's steps make and then answer, in the order the
 * steps make them. A request a step leaves in flight (step 11's add) is not
 * here: nothing ever answers it.
 */
export const ADD_SITE_REQUESTS: RecordedRequest[] = [
  preview("", "static", "", "none", ""),
  preview("blog.lychee.land", "static", "", "none", ""),
  preview("shop.lychee.land", "static", "", "none", ""),
  preview("shop.lychee.land", "reverse-proxy", "", "none", ""),
  preview("shop.lychee.land", "reverse-proxy", "3500", "none", ""),
  preview("shop.lychee.land", "reverse-proxy", "4000", "none", ""),
  preview("shop.lychee.land", "reverse-proxy", "4000", "nextjs", ""),
  preview("shop.lychee.land", "reverse-proxy", "4000", "nextjs", "/healthz"),
  preview("shop.lychee.land", "reverse-proxy", "3500", "nextjs", "/healthz"),
  preview("blog.lychee.land", "reverse-proxy", "3500", "nextjs", "/healthz"),
  preview("", "reverse-proxy", "3500", "nextjs", "/healthz"),
  submit("shop.lychee.land", "reverse-proxy", "3500", "nextjs", "/healthz"),
  preview("shop.lychee.land", "reverse-proxy", "3600", "nextjs", "/healthz"),
  preview("shop.lychee.land", "reverse-proxy", "3700", "nextjs", "/healthz"),
];

/** A request's key in the answers: `POST <url> <body>`, as the harness logs a fetch. */
export function requestKey(request: RecordedRequest): string {
  return `POST ${request.url} ${new URLSearchParams(request.fields).toString()}`;
}

export type RecordedAnswers = Record<string, { status: number; body: unknown }>;

/**
 * Answers every request in `ADD_SITE_REQUESTS` from a fresh seeded dev app,
 * over HTTP and through the whole middleware stack. Signs in as the dev
 * user, so `ADMIN_PASSWORD_HASH` must hash "dev" (src/dev/env.ts's does; a
 * test may set a cheaper hash of it first).
 */
export async function recordAddSiteAnswers(): Promise<RecordedAnswers> {
  await import("./env");
  const { createApp } = await import("../app");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { CommandError } = await import("../lib/systemCommands");
  const { createFakes } = await import("./fakes");
  const { applySeed, SEEDED_DECLARATIONS } = await import("./seed");
  const { config } = await import("../config");
  const loaded = { domain: config.domain, port: config.port, backupDir: config.backupDir };
  const pinned = { domain: RECORDING_ENV.DOMAIN, port: Number(RECORDING_ENV.PORT), backupDir: RECORDING_ENV.BACKUP_DIR };
  if (JSON.stringify(loaded) !== JSON.stringify(pinned)) {
    throw new Error(`config was loaded before addSiteAnswers pinned it: ${JSON.stringify(loaded)}; import this module first`);
  }

  const fakes = createFakes(
    {
      validateCaddyfile: (caddyfilePath) =>
        Promise.reject(
          new CommandError(
            `Command failed: sudo /usr/bin/caddy validate --config ${caddyfilePath}`,
            "",
            "[mock] recorded failure: Error: adapting config using caddyfile: Caddyfile:52 - Error during parsing",
          ),
        ),
    },
    { declarations: SEEDED_DECLARATIONS },
  );
  applySeed(fakes.fs);
  const deps = { commands: fakes.commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
  const server: Server = createApp(deps).listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const auth = `Basic ${Buffer.from("dev:dev").toString("base64")}`;

  const post = (request: RecordedRequest) =>
    new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const payload = new URLSearchParams(request.fields).toString();
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path: request.url,
          headers: {
            Authorization: auth,
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => (text += chunk));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) });
            } catch (error) {
              reject(new Error(`${requestKey(request)} answered ${res.statusCode} with no JSON: ${text}`, { cause: error }));
            }
          });
        },
      );
      req.on("error", reject);
      req.end(payload);
    });

  try {
    const answers: RecordedAnswers = {};
    for (const request of ADD_SITE_REQUESTS) answers[requestKey(request)] = await post(request);
    return answers;
  } finally {
    server.close();
    await once(server, "close");
  }
}

if (require.main === module) {
  recordAddSiteAnswers().then(
    (answers) => process.stdout.write(`${JSON.stringify(answers, null, 2)}\n`),
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
