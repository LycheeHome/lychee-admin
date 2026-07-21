#!/bin/sh
# Installed at /usr/local/sbin/lyly-admin-create-site-dir, owned root:root, mode 0700.
# Invoked via sudo with no argument restriction in sudoers.example (sudo's
# wildcard argument matching isn't available on every build, and is bypassable
# anyway) — this script does the hostname validation instead.
#
# Usage: sudo /usr/local/sbin/lyly-admin-create-site-dir <hostname>
set -eu

hostname="$1"

case "$hostname" in
  *[!a-zA-Z0-9.-]* | .* | *..* | *.)
    echo "lyly-admin-create-site-dir: invalid hostname: $hostname" >&2
    exit 1
    ;;
esac

case "$hostname" in
  *.lyly.dev)
    ;;
  *)
    echo "lyly-admin-create-site-dir: refusing non-lyly.dev hostname: $hostname" >&2
    exit 1
    ;;
esac

install -d -m 2775 -o web -g webdeploy "/var/www/$hostname"
