import { escapeHtml } from "./shared";

export function layout(title: string, body: string): string {
  const mainClass = "max-w-[1080px] mx-auto py-6 pb-8 flex flex-col gap-6";

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
  <header class="max-w-[1080px] mx-auto py-10 pb-12">
    <h1 class="font-display text-2xl font-semibold tracking-wide text-stone-50 m-0">lyly<span class="text-rose-400">.</span>admin</h1>
  </header>
  <main class="${mainClass}">
    <div id="flash-banner" class="hidden fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[min(480px,calc(100vw-2rem))] font-mono text-[0.85rem] text-stone-50 rounded-md px-4 py-3 border shadow-lg shadow-black/40 flex items-center justify-between gap-3" role="status" aria-live="polite">
      <span id="flash-banner-message"></span>
      <button type="button" id="flash-banner-close" class="hidden shrink-0 text-stone-400 hover:text-stone-50 bg-transparent border-none cursor-pointer text-base leading-none" aria-label="Dismiss">&times;</button>
    </div>
    ${body}
  </main>
  <script src="/app.js"></script>
</body>
</html>`;
}
