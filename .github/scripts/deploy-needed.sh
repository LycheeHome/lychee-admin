#!/usr/bin/env bash
#
# Decides whether a changeset requires deploying to lychee. Reads changed file
# paths on stdin, one per line; prints "true" or "false".
#
# FAILS OPEN. The dangerous outcome is skipping a deploy that was needed —
# lychee keeps serving stale code while main looks green, and nothing surfaces
# it. So this prints "true" unless it has positively confirmed that every single
# changed path is skippable, and prints "true" for empty or unclassifiable
# input rather than guessing.
#
# INVARIANT the skip list depends on: nothing matching it may be read by the
# app at runtime or by `npm run build`. If app code ever moves into one of
# these paths, deploys stop happening silently. Everything else — src/, public/,
# package manifests, tsconfigs, eslint config, deploy/, .github/, .env.example —
# deploys.
#
# Tested by deploy-needed.test.sh, which the CI test job runs.
set -uo pipefail

SKIP='^([^/]*\.md|.*/[^/]*\.md|\.claude/.+|\.impeccable/.+|\.idea/.+|\.mcp\.json|\.gitignore)$'

saw_any=0
while IFS= read -r path; do
  [ -z "$path" ] && continue
  saw_any=1
  if ! [[ "$path" =~ $SKIP ]]; then
    echo true
    exit 0
  fi
done

# Nothing to classify: cannot conclude a deploy is unnecessary.
if [ "$saw_any" -eq 0 ]; then
  echo true
  exit 0
fi

echo false
