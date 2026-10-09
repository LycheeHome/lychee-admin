import { escapeHtml, BUTTON_OFFER, DETAIL_WIDTH, FOCUS_RING } from "./shared";

export interface Nav {
  /** Which header item is current. Absent on a site detail page. */
  page?: "sites" | "new" | "services";
}

export interface Banner {
  message: string;
}

export interface LayoutOptions {
  nav: Nav;
  banner?: Banner;
}

const HEADER_ITEM =
  `font-mono text-[0.85rem] no-underline text-stone-400 rounded-md px-2 py-1 ` +
  `hover:text-stone-50 ` +
  `aria-[current=page]:text-stone-50 aria-[current=page]:bg-stone-700 ` +
  `aria-[current=page]:border-l-2 aria-[current=page]:border-l-rose-800 ${FOCUS_RING}`;

function headerItem(href: string, label: string, current: boolean): string {
  return `<a href="${href}" class="${HEADER_ITEM}"${current ? ` aria-current="page"` : ""}>${escapeHtml(label)}</a>`;
}

/**
 * Host-level navigation, identical on every page. A header item's destination
 * never changes with location: the moment "sites" means something different
 * depending on where you stand, it is a control you have to read the URL to
 * understand. Per-site movement lives on the detail page's breadcrumb.
 *
 * Order is a judgment call, not a rule: "sites" and "services" are both
 * "what exists here" pages, so they sit adjacent and the parallel reads;
 * "add site" is the only action and goes last.
 *
 * "add site" is here as well as on the list page's primary button. Same label
 * in both places, quiet here and ember there: this one navigates, that one
 * acts, and with zero sites that button is the entire call to action.
 */
function renderHeader(nav: Nav): string {
  return `
  <header id="site-header" class="max-w-[1080px] mx-auto flex items-center gap-6 py-4">
    <h1 class="m-0 text-base font-normal leading-none">
      <a href="/" class="font-display text-2xl font-semibold tracking-wide text-stone-50 m-0 no-underline ${FOCUS_RING}">lyly<span class="text-rose-400">.</span>admin</a>
    </h1>
    <nav class="flex items-center gap-1" aria-label="Sections">
      ${headerItem("/", "sites", nav.page === "sites")}
      ${headerItem("/services", "services", nav.page === "services")}
      ${headerItem("/sites/new", "add site", nav.page === "new")}
    </nav>
  </header>`;
}

const DISMISS_BUTTON =
  `shrink-0 text-stone-400 hover:text-stone-50 bg-transparent border-none cursor-pointer text-base leading-none ${FOCUS_RING}`;

/**
 * The transient client toast: empty and hidden until showBanner() in
 * public/app.js fills it. It is viewport-anchored on purpose — "Removing
 * blog.lychee.land…" fires from the Remove button at the bottom of a long detail
 * page, and an in-flow notice at the top of the column would be scrolled out
 * of sight at the moment it matters. Page-load notices are the other case, and
 * they get renderPageNotice() below instead.
 *
 * No tone classes are set here: showBanner() supplies them, and strips
 * bg-rose-950 and border-rose-400/70 (and the error tone's own classes)
 * before applying its own, so a second banner on the same page cannot
 * inherit the first one's colour. The info/default tone's background is
 * opaque (bg-rose-950, no /60) so it fully covers whatever it sits over —
 * this banner is fixed and can overlap page content.
 *
 * #flash-banner-progress is a quiet pulsing dot, shown only for the "info"
 * (in-flight) tone — the alternative to a static, motionless ellipsis for
 * the length of a `systemctl restart`. It is a sibling of the message span,
 * not nested inside it, because showBanner() replaces the message text
 * wholesale; nesting it would delete it the next time the banner fires.
 * motion-safe: means a reduced-motion viewer sees a plain static dot rather
 * than a moving one, the same gating every other motion in this app uses.
 *
 * #flash-banner-action is the toast's one optional recovery control (today
 * only Retry, after a site was removed but its declaration was not retired).
 * showBanner() labels and reveals it, and hides it again on every other call,
 * so an action can never outlive the message it belongs to.
 */
function renderFlashBanner(): string {
  const base =
    "fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[min(480px,calc(100vw-2rem))] font-mono text-[0.85rem] text-stone-50 rounded-md px-4 py-3 border shadow-lg shadow-black/40 flex items-center justify-between gap-3";

  return `<div id="flash-banner" class="hidden ${base}" role="status" aria-live="polite">
        <span class="flex items-center gap-2 min-w-0">
          <span id="flash-banner-progress" class="hidden shrink-0 h-1.5 w-1.5 rounded-full bg-stone-50 motion-safe:animate-pulse" aria-hidden="true"></span>
          <span id="flash-banner-message"></span>
        </span>
        <span class="flex items-center gap-2 shrink-0">
          <button type="button" id="flash-banner-action" class="hidden ${BUTTON_OFFER}"></button>
          <button type="button" id="flash-banner-close" class="hidden ${DISMISS_BUTTON}" aria-label="Dismiss">&times;</button>
        </span>
      </div>`;
}

/**
 * The server-rendered notice a page arrives carrying — today only the
 * ?created=1 message. In flow, above the page body, so it pushes the content
 * down instead of covering the heading the way the fixed toast did. Same rose
 * treatment as the toast, minus its shadow: this one is not floating over
 * anything, and a shadow would say it is.
 *
 * Width is DETAIL_WIDTH so it lines up with the cards beneath it on the page
 * that actually sends a banner, and so a three-line message keeps a readable
 * measure rather than running the full 1080px column.
 */
function renderPageNotice(banner?: Banner): string {
  if (!banner) return "";

  return `<div id="page-notice" class="${DETAIL_WIDTH} bg-rose-950/60 border border-rose-400/70 font-mono text-[0.85rem] text-stone-50 rounded-md px-4 py-3 flex items-start justify-between gap-3" role="status">
        <span id="page-notice-message">${escapeHtml(banner.message)}</span>
        <button type="button" id="page-notice-close" class="${DISMISS_BUTTON}" aria-label="Dismiss">&times;</button>
      </div>`;
}

export function layout(title: string, body: string, opts: LayoutOptions): string {
  return `<!doctype html>
<html lang="en" class="[color-scheme:dark]">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Poetsen+One&family=Nunito:ital,wght@0,400;0,500;0,600;0,700;1,500&family=DM+Mono:wght@300;400;500&display=swap"
    rel="stylesheet"
  />
  <link rel="stylesheet" href="/style.css" />
</head>
<body class="min-h-screen bg-stone-900 font-sans text-stone-50 m-0 px-6 pb-16">
  ${renderHeader(opts.nav)}
  <main class="max-w-[1080px] mx-auto py-6 pb-8 flex flex-col gap-6">
    ${renderFlashBanner()}
    <!--
      Copying is confirmed visually by the icon swapping to a check, which
      says nothing to a screen reader. The button's own aria-label changes
      too, but a label change on the focused element is not reliably
      announced — so the outcome goes here instead. It matters most in the
      fallback case, where the user has to be told to press Ctrl+C: on plain
      HTTP, that is every case.
    -->
    <span id="copy-status" class="sr-only" role="status" aria-live="polite"></span>
    ${renderPageNotice(opts.banner)}
    ${body}
  </main>
  <script src="/app.js"></script>
</body>
</html>`;
}
