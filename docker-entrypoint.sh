#!/bin/sh
set -e

if [ ! -f "$BLOG_REPO_PATH/content/config.json" ]; then
  echo "No repo found at $BLOG_REPO_PATH - seeding with the example site."
  mkdir -p "$BLOG_REPO_PATH"
  cp -r /app/example-site-seed/. "$BLOG_REPO_PATH/"
fi

exec "$@"
