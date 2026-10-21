#!/usr/bin/env bash
# Assembles the runtime tree the release image carries: the built app plus its
# production dependencies, and nothing else. Run after `npm run build`.
#   scripts/assemble-release.sh <out-dir>
# --ignore-scripts is deliberate: nothing in the tree may execute install-time
# code, and bcrypt ships prebuilt binaries so it needs none. The check at the
# end is what proves that assumption still holds after a bcrypt upgrade.
set -euo pipefail

out="${1:?usage: assemble-release.sh <out-dir>}"

for f in dist/server.js public/style.css public/client/.vite/manifest.json package.json package-lock.json; do
  [ -f "$f" ] || { echo "assemble-release: missing $f (run npm run build first)" >&2; exit 1; }
done

rm -rf "$out"
mkdir -p "$out"
cp -R dist public "$out/"
cp package.json package-lock.json "$out/"

(cd "$out" && npm ci --omit=dev --ignore-scripts)

prebuild="$out/node_modules/bcrypt/prebuilds/linux-x64/bcrypt.glibc.node"
[ -f "$prebuild" ] || { echo "assemble-release: missing $prebuild" >&2; exit 1; }
