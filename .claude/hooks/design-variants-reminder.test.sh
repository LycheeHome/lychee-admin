#!/usr/bin/env bash
# Covers the design-variants-reminder predicate, in the spirit of
# .github/scripts/deploy-needed.test.sh: a shell predicate nothing else
# exercises is a shell predicate that silently rots. This one regressed twice
# while it was being written — "visually" stopped matching a right-anchored
# \bvisual\b, and "reference" got dropped in a rewrite — so the matrix is the
# only thing standing between a widened regex and a hook that fires on
# everything (or nothing).
#
# Run: bash .claude/hooks/design-variants-reminder.test.sh
set -uo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/design-variants-reminder.sh"
pass=0; fail=0

check() { # $1 = fire|quiet, $2 = prompt
  local out got
  out="$(printf '{"prompt":%s}' "$(printf '%s' "$2" | jq -Rs .)" | "$HOOK")"
  [ -n "$out" ] && got=fire || got=quiet
  if [ "$got" = "$1" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1)); printf 'FAIL want=%s got=%s  %s\n' "$1" "$got" "$2"
  fi
}

# Explicit design vocabulary — fires alone.
check fire "find references in mobbin for the detail page"
check fire "find references for how other tools show a request path"
check fire "give me a few variants of the status pill"
check fire "rethink the add-site page layout"
check fire "the type pills and status badge collide"
check fire "redesigning the hostname dropdown"
check fire "the styles on the manual steps card are off"
check fire "the detail page needs a visual pass"
check fire "what should the empty state look like visually"

# Natural phrasings carrying no design noun at all.
check fire "the sites list feels cramped, give me some options"
check fire "what should the empty state look like"
check fire "make the deploy section easier to scan"
check fire "i want the header to feel more like a terminal"
check fire "the remove-site modal is too busy"
check fire "the manual steps section is hard to scan"

# A UI noun with no design intent beside it is ordinary code talk.
check quiet "the form validation rejects valid ports"
check quiet "set the Authorization header on the preview request"
check quiet "what does the caddy validate error look like"
check quiet "the toast should say 'removed' not 'removing'"
check quiet "does the modal close on escape"

# Word-boundary traps: "build"/"quick" contain ui, "discard" contains card.
check quiet "build the caddyfile parser and run the tests"
check quiet "quick question about the tunnel restart timeout"
check quiet "discard the local changes and reset to main"
check quiet "we should require a port for reverse proxy sites"
check quiet "guide me through the sudoers setup on lychee"

# Not UI work.
check quiet "fix the typo in the flash banner copy"
check quiet "why did the deploy job skip on that merge"
check quiet "restart cloudflared-sites and check the logs"

# Degenerate input must never emit context or a non-zero exit.
check quiet ""
printf '%s' 'not json' | "$HOOK" >/dev/null 2>&1 && pass=$((pass + 1)) || { fail=$((fail + 1)); echo "FAIL non-JSON stdin should exit 0"; }

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
