#!/bin/sh
set -e
# Runs as root: fix volume ownership left over from root-era containers,
# then drop to the unprivileged node user for the actual server.

BLOG_REPO_PATH="${BLOG_REPO_PATH:-/data/site}"
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-/data/gh}"
export AUTH_ENV="${AUTH_ENV:-/data/auth.env}"
# All HOME-dependent config (git global config, gh setup) must land in the
# persisted /data dir for BOTH the root entrypoint and the node server.
# su-exec keeps the caller's env, so without this the git config below
# silently went to /root/.gitconfig while the server read /data/.gitconfig
# (which stayed missing) - leaving git with no credential helper and every
# push failing with "could not read Username".
export HOME=/data

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

# Re-wire the gh credential helper every boot: if the user is gh-authed but
# /data/.gitconfig lost the helper entry, pushes fail with
# "could not read Username". Cheap to re-run, no-op when already set.
if su-exec node gh auth status >/dev/null 2>&1; then
  su-exec node gh auth setup-git >/dev/null 2>&1 || true
fi

exec su-exec node "$@"
