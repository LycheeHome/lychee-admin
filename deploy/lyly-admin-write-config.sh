#!/bin/sh
# Installed at /usr/local/sbin/lyly-admin-write-config, owned root:root, mode 0700.
# Invoked only via the sudoers entries in sudoers.example, which pin the single
# argument to an exact path — this script is the only way the lyly-admin
# service user can write to root-owned Caddy/tunnel config files.
#
# Usage: sudo /usr/local/sbin/lyly-admin-write-config <target-path> < new-content
set -eu

target="$1"

case "$target" in
  /etc/caddy/Caddyfile | /etc/cloudflared/sites-config.yml)
    ;;
  *)
    echo "lyly-admin-write-config: refusing to write to $target" >&2
    exit 1
    ;;
esac

tmp="$(mktemp "$(dirname "$target")/.lyly-admin.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

cat > "$tmp"
chmod 644 "$tmp"
chown root:root "$tmp"
mv -f "$tmp" "$target"
trap - EXIT
