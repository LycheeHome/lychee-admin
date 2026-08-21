import type { Site } from "../lib/caddyfile";
import { escapeHtml, icon, FOCUS_RING } from "./shared";

export interface Nav {
  /** Every managed site, for the switcher. Read by renderSwitcher. */
  sites: Site[];
  /** Hostname of the site being viewed, if any — highlights it in the switcher. */
  active?: string;
  /** Which flat nav item is current. Absent on a site detail page. */
  page?: "sites" | "new";
}

export interface LayoutOptions {
  nav: Nav;
}

const NAV_ITEM =
  `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.85rem] no-underline text-stone-400 ` +
  `hover:bg-stone-700/60 hover:text-stone-50 ` +
  `aria-[current=page]:bg-rose-950/60 aria-[current=page]:text-rose-300 ${FOCUS_RING}`;

function navItem(href: string, label: string, iconName: "layoutGrid" | "plus", current: boolean): string {
  return `<a href="${href}" class="${NAV_ITEM}"${current ? ` aria-current="page"` : ""}>${icon(iconName)}${escapeHtml(label)}</a>`;
}

function renderRail(nav: Nav): string {
  return `
  <aside id="site-nav" class="w-[220px] shrink-0 self-start sticky top-0 h-screen bg-stone-800 border-r border-stone-700 flex flex-col gap-4 px-3 py-4" aria-label="Site navigation">
    <nav id="nav-pages" class="flex flex-col gap-0.5" aria-label="Pages">
      ${navItem("/", "All sites", "layoutGrid", nav.page === "sites")}
      ${navItem("/sites/new", "Add site", "plus", nav.page === "new")}
    </nav>
    <div class="border-t border-dashed border-stone-700 mx-1" aria-hidden="true"></div>
    <div class="flex-1"></div>
    <p class="font-display text-[0.8rem] text-stone-500 m-0 px-2.5">lyly<span class="text-rose-400">.</span>admin</p>
  </aside>`;
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
<body class="min-h-screen bg-stone-900 font-sans text-stone-50 m-0 flex">
  ${renderRail(opts.nav)}
  <div class="flex-1 min-w-0 px-6 pb-16">
    <main class="max-w-[1080px] mx-auto py-6 pb-8 flex flex-col gap-6">
      <div id="flash-banner" class="hidden fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[min(480px,calc(100vw-2rem))] font-mono text-[0.85rem] text-stone-50 rounded-md px-4 py-3 border shadow-lg shadow-black/40 flex items-center justify-between gap-3" role="status" aria-live="polite">
        <span id="flash-banner-message"></span>
        <button type="button" id="flash-banner-close" class="hidden shrink-0 text-stone-400 hover:text-stone-50 bg-transparent border-none cursor-pointer text-base leading-none" aria-label="Dismiss">&times;</button>
      </div>
      ${body}
    </main>
  </div>
  <script src="/app.js"></script>
</body>
</html>`;
}
