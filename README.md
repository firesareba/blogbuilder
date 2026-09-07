# BlogBuilder

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

## Auth (first run)

No user exists on first launch — opening `/` shows a **create-account screen**.
Submitting saves `ADMIN_USER` + scrypt-hashed password to `AUTH_ENV`
(`/data/auth.env` in Docker, survives rebuilds) for all future sign-ins.
Sign-in afterwards is username + password with a signed `HttpOnly` session cookie.

The same setup screen (and later Settings / Git tab) covers:
- **GitHub**: approve via browser device code (`gh auth login --web`) or paste
  a token once. Auth lives in the `gh` CLI credential helper (`/data/gh`) —
  no token is ever embedded in git config. Pre-seed via env if you prefer.
- **AI key (BYOK)**: optionally saved server-side to the same env file and
  used when the browser has no key set. Browser key still wins when present.

Env overrides (optional, checked before the env file): `ADMIN_USER`,
`ADMIN_PASS` (plaintext, legacy), `ADMIN_PASS_HASH`, `AI_PROVIDER`,
`AI_MODEL`, `AI_API_KEY`, `SESSION_SECRET`, `COOKIE_SECURE=1` (HTTPS only).
