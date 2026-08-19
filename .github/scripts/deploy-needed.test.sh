#!/usr/bin/env bash
# Tests for deploy-needed.sh. Run: bash .github/scripts/deploy-needed.test.sh
set -uo pipefail
cd "$(dirname "$0")"

pass=0; fail=0
check() { # check <expected> <label> <changed files...>
  local expected="$1" label="$2"; shift 2
  local got
  got=$(printf '%s\n' "$@" | ./deploy-needed.sh 2>&1)
  if [ "$got" = "$expected" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '  FAIL  %-52s expected=%-5s got=%s\n' "$label" "$expected" "$got"
  fi
}

# --- deploys: anything the app or the build reads ---
check true  "app source"                     src/server.ts
check true  "compiled asset source"          public/app.js
check true  "dependency manifest"            package.json
check true  "lockfile"                       package-lock.json
check true  "build tsconfig"                 tsconfig.build.json
check true  "lint config"                    eslint.config.js
check true  "host install scripts"           deploy/lyly-admin-write-config.sh
check true  "the workflow itself"            .github/workflows/deploy.yml
check true  "this predicate"                 .github/scripts/deploy-needed.sh
check true  "env template"                   .env.example

# --- skips: documentation and editor/agent tooling ---
check false "root markdown"                  CLAUDE.md
check false "readme"                         README.md
check false "nested docs markdown"           docs/superpowers/specs/a-design.md
check false "claude settings"                .claude/settings.json
check false "editor project files"           .idea/workspace.xml
check false "mcp config"                     .mcp.json
check false "gitignore"                      .gitignore
check false "several skippable at once"      CLAUDE.md README.md .mcp.json

# --- mixed changesets deploy ---
check true  "docs plus code"                 CLAUDE.md src/server.ts
check true  "code listed after docs"         docs/x.md package.json

# --- fails open: never conclude "no deploy" from a doubtful input ---
check true  "no changed files at all"         ""
check true  "lookalike, not the mcp config"  .mcp.json.bak
check true  "lookalike, not markdown"         notes.markdown
check true  "path merely containing .md"     src/lib/a.md.ts

printf '\n  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
