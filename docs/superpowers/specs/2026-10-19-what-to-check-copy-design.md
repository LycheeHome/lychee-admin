# "What to check" copy

Date: 2026-10-19. Status: approved design (approved in conversation), awaiting
written-spec review. Follows `2026-10-19-failing-site-diagnosis-design.md`,
whose entry sentences were first drafts and which named `/impeccable clarify`
as the owner of their final wording. Lands on that work's branch,
`feat/failing-site-diagnosis` (PR #95), so the copy ships with the feature.
Copy and command changes only; no layout or visual change.

## Why

Read against the code and the host on 2026-10-19:

- **The journal command misses half the reconciler.** `lychee` runs two
  reconcile units — `lychee-reconcile.service` (the full run, every 15 min)
  and `lychee-reconcile-app.service` (the app run the watcher starts). The
  failure line names only the first, so a deploy that failed in an app run is
  not in the command the page hands you.
- **And it is unbounded.** The two units write about 87,000 journal lines a
  day; `journalctl -u lychee-reconcile` with no limit is days of output.
- **"isn't running" is false** for `restarting` and `paused`, both of which
  are bad tones that produce an entry.
- **A failed first deploy has no next step.** The way out — publish a fixed
  tag, deploy it from From a repository — is not stated.
- **`docker compose … logs`** dumps the container's whole history.
- **The listen check gives no reading of its output**: `ss` prints only its
  header row when nothing is listening.
- **"Its journal says why" promises a cause** the app cannot know.

Host facts were read over read-only SSH: `systemctl list-unit-files
'lychee-*'`, and `journalctl` over both units. No site resource exists on the
host yet, so the exact journal lines of a failed site deploy cannot be seen;
filtering the command by the site's name was therefore rejected (lines such as
`fatal: [lychee]: FAILED! =>` carry no name and would be dropped silently).
The operator chose both units, bounded to the last hour: the reconciler
retries a failing tag on every run, so the last hour holds at least one
attempt.

## Design

All in `src/views/html.ts`.

### State phrase

One module-private mapping from a bad-tone status word to a phrase, used by
the tunnel, Caddy and container entries so units and containers read alike:

| Word | Phrase |
|---|---|
| `exited` | has stopped |
| `restarting` | keeps restarting |
| `paused` | is paused |
| `unhealthy` | is running but failing its health check |

The word comes from the same source the hop shows (`rowLabels(...).pill` for a
unit, `describeStatus(...).pill` for a container). Any other word — none
reaches an entry today, because only these four are bad-tone unit or
container states — falls back to `is <word>`.

### Entries

Exact copy (`<phrase>` from the table; machine facts in `mono` as today):

- **tunnel** — "The sites tunnel `<phrase>`, so Cloudflare has nowhere to send
  this site's requests. Its last 50 log lines usually show why:" →
  `journalctl -u cloudflared-sites -n 50` (unchanged).
- **caddy** — "Caddy `<phrase>`. Every site on lychee goes through it, so all
  of them are down, not only this one. Its last 50 log lines usually show
  why:" → `journalctl -u caddy -n 50` (unchanged).
- **your app, failed first deploy** — `failureLine` keeps "Deploying
  `<target>` failed at this step:" (or "The last deploy failed…") and the
  step, then reads "The reconciler retries this tag on every run; its log for
  the last hour shows each attempt:" →
  `journalctl -u lychee-reconcile -u lychee-reconcile-app --since "1 hour ago"`.
  In "What to check" only, a final sentence follows: "To recover, publish a
  fixed tag; From a repository below offers it to deploy."
- **your app, container in a bad state** — "The container `<phrase>`. Its last
  100 log lines usually show why:" → `docker compose -p <resource> logs --tail 100`.
- **your app, plain proxy not responding** — "Nothing answered on
  `localhost:<port>`. lychee-admin only routes requests to this port; whatever
  serves it is started outside the app. This shows what is listening there,
  and prints only its header row if nothing is:" →
  `ss -ltn 'sport = :<port>'` (unchanged).

`failureLine` is shared with the services board, so the board's failure line
gets the new sentence and two-unit command too — correct there as well, since
the reconciler retries a failing tag for any resource. The recovery sentence is
not added to `failureLine`: the board has no From a repository card.

Command ids are unchanged (`cmd-fix-tunnel`, `cmd-fix-caddy`,
`cmd-reconcile-log`, `cmd-logs`, `cmd-fix-listen`).

## Docs

Every place that quotes a changed command or sentence is updated: at least
`CLAUDE.md`'s site-detail paragraph (`journalctl -u lychee-reconcile`,
`docker compose -p <label>-lychee-land logs`); grep `DESIGN.md`,
`.impeccable/design.json` and `PRODUCT.md` for the old strings and update any
match. Observability prose that names both units already is left alone.

## Testing

Written first, in `src/views/html.test.ts`:

1. Each of the four state words renders its phrase in the tunnel, Caddy and
   container entries (at least one entry per word).
2. The failed-first-deploy entry shows the two-unit, last-hour command and the
   recovery sentence; step 4 still points up.
3. The services board's failure line shows the two-unit command and does not
   contain the recovery sentence.
4. The container entry's command is `docker compose -p app-lychee-land logs --tail 100`.
5. The plain-proxy entry mentions the header row.
6. No entry contains "says why" or "isn't running".

Existing assertions on the old strings are updated to the new ones.

Verification: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`; the detector on `src/views` returns `[]`; screenshots of
`/sites/broken.lychee.land` and `/sites/api.lychee.land`.
