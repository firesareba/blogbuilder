# BlogBuilder

AI-built (opencode + Muse Spark) git-native visual website &amp; blog builder. Honest status: functional prototype hardening toward production — security items first.

## Run

```bash
npm install
cp .env.example .env      # set ADMIN_USER, ADMIN_PASS, SESSION_SECRET
npm start                 # http://localhost:4321
```

Env vars: `PORT`, `BLOG_REPO_PATH`, `ADMIN_USER`, `ADMIN_PASS`, `SESSION_SECRET`, `COOKIE_SECURE=1` (only if serving HTTPS).

## Network assumption: private meshnet, no TLS at the container

This app deliberately does **not** require HTTPS. It is meant to be reached
over a trusted private meshnet (Tailscale/headscale, etc.) over plain HTTP.
HSTS and `upgrade-insecure-requests` are disabled, and the session cookie is
non-`Secure` by default so login works over `http://`.

Do **not** expose port 4321 directly to the public internet. If public access
is ever needed, terminate TLS at a reverse proxy in front of it and set
`COOKIE_SECURE=1`.

```bash
docker compose up -d --build
```

Container runs as non-root `node`, seeded from `example-site` on first boot into `./data/site`.

## Valid repo shape

```
your-site/
  theme/index.html      (data-builder-id attributes)
  theme/theme.css
  content/config.json
  content/posts/*.md
  assets/
```

## Auth

Set `ADMIN_USER`/`ADMIN_PASS` — mutating API routes return 401 without the signed session cookie. Login via `POST /api/login`.
