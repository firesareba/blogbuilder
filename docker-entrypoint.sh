#!/bin/sh
set -e
# Runs as root: fix volume ownership left over from root-era containers,
# then drop to the unprivileged node user for the actual server.

BLOG_REPO_PATH="${BLOG_REPO_PATH:-/data/site}"
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-/data/gh}"
export AUTH_ENV="${AUTH_ENV:-/data/auth.env}"

mkdir -p "$BLOG_REPO_PATH" /data/site /data/gh
touch "$AUTH_ENV" 2>/dev/null || true

if [ ! -f "$BLOG_REPO_PATH/content/config.json" ]; then
  echo "No repo found at $BLOG_REPO_PATH - seeding with the example site."
  cp -r /app/example-site-seed/. "$BLOG_REPO_PATH/"
fi

chown -R node:node /data /app/uploads 2>/dev/null || true
chmod 600 "$AUTH_ENV" 2>/dev/null || true

# Git refuses repos owned by another uid ("dubious ownership") - the volume
# is root-owned on the host, so mark it safe for the node user.
su-exec node git config --global --add safe.directory "$BLOG_REPO_PATH" 2>/dev/null || true
su-exec node git config --global --add safe.directory /data/site 2>/dev/null || true

exec su-exec node "$@"
