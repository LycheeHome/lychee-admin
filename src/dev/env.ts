/**
 * Local development credentials, committed deliberately.
 *
 * This is a known throwaway password ("dev") for an app that binds
 * 127.0.0.1, and this whole directory ships to neither dist/ nor lychee —
 * see tsconfig.build.json and the rsync excludes in
 * .github/workflows/deploy.yml. Production reads its own .env through
 * src/server.ts, which never imports this file.
 *
 * This module exists separately from src/dev/server.ts because src/config.ts
 * calls required() at module evaluation time and import declarations are
 * hoisted — so the assignments have to live in a module that is imported
 * before config, not in a statement alongside the import.
 *
 * These use `??=` rather than `=` because dotenv runs later, inside
 * config.ts, and does not overwrite a variable that is already set — so
 * `??=` here is what lets a developer's own .env still take precedence over
 * these fallbacks instead of always losing to whichever module runs first.
 */
process.env.ADMIN_USERNAME ??= "dev";
process.env.ADMIN_PASSWORD_HASH ??= "$2b$12$X/UB7NklDWv8CQTaRZpFzOWt9lYBcJYK1UwtOG9EgG6wwegHeFmAS";
process.env.TUNNEL_ID ??= "11111111-2222-3333-4444-555555555555";
