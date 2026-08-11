#!/bin/sh
# Installed at /usr/local/sbin/lyly-admin-docker-status, owned root:root, mode 0700.
# Invoked via sudo with no argument restriction in sudoers.example, for the
# same reason lyly-admin-create-site-dir.sh is: sudo's wildcard argument
# matching isn't available on every build. This script does hostname
# validation and hardcodes the /var/www prefix itself.
#
# Usage: sudo /usr/local/sbin/lyly-admin-docker-status <hostname>
set -eu

hostname="$1"

case "$hostname" in
  *[!a-zA-Z0-9.-]* | .* | *..* | *.)
    echo "lyly-admin-docker-status: invalid hostname: $hostname" >&2
    exit 1
    ;;
esac

case "$hostname" in
  *.lyly.dev)
    ;;
  *)
    echo "lyly-admin-docker-status: refusing non-lyly.dev hostname: $hostname" >&2
    exit 1
    ;;
esac

compose_file="/var/www/$hostname/docker-compose.yml"

if [ ! -f "$compose_file" ]; then
  # No scaffold on disk (shouldn't happen — the caller only invokes this for
  # framework-scaffolded sites — but fail closed with empty output rather
  # than an ambiguous error) so the caller reads it as "not created."
  exit 0
fi

docker compose -f "$compose_file" ps --all --format json
