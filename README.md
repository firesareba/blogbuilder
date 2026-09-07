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

#Photos
<img width="2314" height="1119" alt="Screenshot 2026-09-06 at 10 58 35 PM" src="https://github.com/user-attachments/assets/563718e9-0185-49ee-8fc0-ccc0587679ba" />
<img width="1755" height="981" alt="Screenshot 2026-09-06 at 10 59 07 PM" src="https://github.com/user-attachments/assets/007234aa-40cf-43a4-806b-fe9cdbf836fd" />
<img width="1573" height="1247" alt="Screenshot 2026-09-06 at 11 00 15 PM" src="https://github.com/user-attachments/assets/49179aa9-5946-48c1-a183-881f0fb163c2" />
<img width="1763" height="1095" alt="Screenshot 2026-09-06 at 11 00 00 PM" src="https://github.com/user-attachments/assets/ecdde4a1-a7de-48a8-bd51-195983ba6ed6" />
<img width="1713" height="1181" alt="Screenshot 2026-09-06 at 10 59 47 PM" src="https://github.com/user-attachments/assets/38d1a5eb-009f-421b-b37d-23b7556aa9e5" />
<img width="1263" height="797" alt="Screenshot 2026-09-06 at 10 59 26 PM" src="https://github.com/user-attachments/assets/4e128943-89a4-480b-9d8e-189cb4fa46ff" />


