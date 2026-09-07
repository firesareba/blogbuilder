# Changelog

## Unreleased
- Publish outputs to `docs/` + `.nojekyll` (GitHub Pages serves root or `/docs` — `dist/` left Pages with no index.html)
- Publish is now the full pipeline: render → commit → push, with per-stage reporting; button shows progress and never claims success on partial completion
- CLI: `blog login`/`logout` (session file) so CLI mutations pass auth; `publish` follows the full pipeline
- Fix: fatal `public/app.js` syntax error (duplicated `initSettings` close + theme upload handler), verified with `node --check`
- Fix: unclosed `<div class="settings-scroll">` in Settings tab
- Fix: Georgia Google Fonts import → Merriweather
- Fix: theme CSS `/theme.css` 404 — serve repo `theme/` files at root
- Security: zip-slip containment in theme upload (adm-zip + `path.resolve` check), multer 1.x → 2.x, helmet, signed-cookie auth, rate limits, `/health`
- Data integrity: atomic writes (tmp + fsync + rename), per-repo write mutex, zod body validation
- AI: native Google Gemini provider registered + Settings dropdown option
- Infra: non-root `USER node`, compose `mem_limit`/`cpus`, graceful SIGTERM shutdown
- Tests/CI: `node:test` engine suite (4 tests), GitHub Actions (check + test + audit + smoke)
