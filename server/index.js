"use strict";

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const pino = require("pino")();

const { createRouter } = require("./api/routes");
const auth = require("./middleware/auth");
const ghAuth = require("./git/ghAuth");

const PORT = process.env.PORT || 4321;
const DEFAULT_REPO = path.resolve(
  process.env.BLOG_REPO_PATH || path.join(__dirname, "..", "example-site"),
);

let currentRepoPath = DEFAULT_REPO;

function getRepoPath() {
  return currentRepoPath;
}

const app = express();
// Plain-HTTP meshnet deployment: no TLS at the container. HSTS and
// upgrade-insecure-requests are disabled so browsers don't force-https
// (which would break all styling/assets over http). Users are expected
// to reach this only over a trusted private meshnet (see README).
app.use(helmet({
  hsts: false,
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "upgrade-insecure-requests": null,
    },
  },
}));
app.use(cookieParser());
app.use(express.json({ limit: "5mb" }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true });
const generalLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true });

app.use(generalLimiter);

function sessionCookie(res, username) {
  const token = auth.createSession(username);
  res.cookie("session", token, { httpOnly: true, secure: process.env.COOKIE_SECURE === "1", sameSite: "Lax", maxAge: 24 * 3600 * 1000 });
}

app.get("/api/auth/status", async (req, res) => {
  const user = auth.getSessionUser(req);
  const gh = await ghAuth.ghStatus().catch(() => ({ loggedIn: false }));
  res.json({
    setupRequired: auth.isSetupRequired(),
    loggedIn: !!user,
    user: user ? user.username : null,
    github: gh.loggedIn ? { user: gh.user } : null,
    ai: auth.getServerAI(),
  });
});

// First-run only: create the user. Credentials persist to AUTH_ENV.
app.post("/api/auth/setup", loginLimiter, (req, res) => {
  if (!auth.isSetupRequired()) return res.status(400).json({ error: "Setup already complete" });
  const { username, password } = req.body || {};
  try {
    auth.saveCredentials(username, password);
    sessionCookie(res, username);
    pino.info("First-run setup complete");
    return res.json({ ok: true });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post("/api/login", loginLimiter, (req, res) => {
  const cfg = auth.getConfiguredUser();
  if (!cfg) return res.status(400).json({ error: "No user yet - complete setup first" });
  const { username, password } = req.body || {};
  const okUser = username === cfg.username;
  const okPass = cfg.passHash
    ? auth.checkPassword(password || "", cfg.passHash)
    : password === cfg.passPlain;
  if (okUser && okPass) {
    sessionCookie(res, username);
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Invalid credentials" });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

// Server-side AI key (BYOK persisted to AUTH_ENV). Auth required.
app.get("/api/auth/ai", auth.authRequired, (req, res) => res.json(auth.getServerAI()));
app.post("/api/auth/ai", auth.authRequired, (req, res) => {
  const { provider, model, apiKey } = req.body || {};
  auth.saveServerAI({ provider, model, apiKey });
  res.json({ ok: true, ...auth.getServerAI() });
});

// GitHub via gh CLI. Auth required (except status, which is harmless).
app.get("/api/auth/github/status", async (req, res) => {
  res.json(await ghAuth.ghStatus().catch((e) => ({ loggedIn: false, output: e.message })));
});
app.post("/api/auth/github/token", auth.authRequired, async (req, res) => {
  try {
    const st = await ghAuth.loginWithToken((req.body || {}).token);
    res.json({ ok: true, ...st });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
// Clear/reset the saved GitHub credential (PAT or device token).
app.post("/api/auth/github/logout", auth.authRequired, async (req, res) => {
  const st = await ghAuth.logout();
  res.json({ ok: !st.loggedIn, ...st });
});
app.post("/api/auth/github/device/start", auth.authRequired, (req, res) => {
  try {
    res.json({ ok: true, ...ghAuth.startDeviceFlow() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get("/api/auth/github/device/poll", auth.authRequired, async (req, res) => {
  res.json(await ghAuth.pollDeviceFlow());
});
// Blog content repos (not the blogbuilder repo itself): list + create.
app.get("/api/auth/github/repos", auth.authRequired, async (req, res) => {
  res.json(await ghAuth.listRepos());
});
// Flip visibility of the CONNECTED blog repo (owner/repo taken from the
// git remote, never from client input - making the wrong repo public
// would be a nasty surprise). Needed because free Pages requires public.
// Point GitHub Pages at /docs on the connected repo's default branch.
app.post("/api/auth/github/pages", auth.authRequired, async (req, res) => {
  try {
    const simpleGit = require("simple-git");
    const remotes = await simpleGit(getRepoPath()).getRemotes(true);
    const origin = (remotes.find((r) => r.name === "origin")?.refs?.fetch || "");
    const m = origin.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
    if (!m) return res.status(400).json({ error: "origin is not a GitHub remote" });
    const info = await ghAuth.runGh(["api", `repos/${m[1]}/${m[2]}`, "--jq", ".default_branch"]);
    const branch = (info.ok && info.output) || "main";
    const r = await ghAuth.setPagesSource(m[1], m[2], branch, "/docs");
    if (!r.ok) return res.status(400).json(r);
    res.json({ ok: true, branch, path: "/docs" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post("/api/auth/github/visibility", auth.authRequired, async (req, res) => {
  try {
    const simpleGit = require("simple-git");
    const remotes = await simpleGit(getRepoPath()).getRemotes(true);
    const origin = (remotes.find((r) => r.name === "origin")?.refs?.fetch || "");
    const m = origin.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
    if (!m) return res.status(400).json({ error: "origin is not a GitHub remote" });
    const r = await ghAuth.setRepoVisibility(m[1], m[2], (req.body || {}).visibility);
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post("/api/auth/github/repos", auth.authRequired, async (req, res) => {
  const r = await ghAuth.createRepo(req.body || {});
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

app.get("/health", (req, res) => {
  const repoOk = fs.existsSync(currentRepoPath) && fs.existsSync(path.join(currentRepoPath, "content", "config.json"));
  const diskFree = (() => { try { require("child_process").execSync("df -k ."); return true; } catch { return false; } })();
  const ok = repoOk && diskFree;
  res.status(ok ? 200 : 500).json({ ok, repoOk, diskFree });
});

// The API - everything the GUI, CLI, and AI copilot go through.
const apiRouter = createRouter({ getRepoPath });
app.use("/api/ai/operations", aiLimiter);
app.use("/api/ai/article-assist", aiLimiter);
app.use("/api", apiRouter);

// Allow switching which repository is loaded without restarting the server.
app.get("/api/repo", (req, res) => res.json({ repoPath: currentRepoPath }));
app.post("/api/repo/load", (req, res) => {
  const { repoPath } = req.body || {};
  if (!repoPath) return res.status(400).json({ error: "repoPath is required" });
  const resolved = path.resolve(repoPath);
  if (!fs.existsSync(path.join(resolved, "content", "config.json"))) {
    return res.status(400).json({
      error: `"${resolved}" doesn't look like a BlogBuilder repo (missing content/config.json)`,
    });
  }
  currentRepoPath = resolved;
  res.json({ repoPath: currentRepoPath });
});

// Serve the current repo's raw assets, e.g. /assets/photo.jpg, used by both
// the live preview iframe and the published docs/ output during local dev.
app.use("/assets", (req, res, next) => {
  express.static(path.join(currentRepoPath, "assets"))(req, res, next);
});

// Serve theme files (css, js, etc.) at the root so the preview HTML can
// link to e.g. "/theme.css" and get the current repo's theme stylesheet.
app.use((req, res, next) => {
  const p = path.join(currentRepoPath, "theme", req.path);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) {
    return res.sendFile(p);
  }
  next();
});

// Serve the published static output too, for a "view published site" tab.
// /docs is current output; /dist stays as a legacy mount for old repos.
app.use("/docs", (req, res, next) => {
  express.static(path.join(currentRepoPath, "docs"))(req, res, next);
});
app.use("/dist", (req, res, next) => {
  express.static(path.join(currentRepoPath, "dist"))(req, res, next);
});

// The builder GUI itself. Unauthenticated visitors get the login /
// first-run setup screen instead of the app.
app.get("/", (req, res, next) => {
  // Entry HTML must never cache: otherwise clients keep stale UI (missing
  // buttons) after deploys and report fixes as "didn't work".
  res.set("Cache-Control", "no-store");
  if (!auth.getSessionUser(req)) {
    return res.sendFile(path.join(__dirname, "..", "public", "login.html"));
  }
  next();
});
app.use(express.static(path.join(__dirname, "..", "public")));

const server = app.listen(PORT, () => {
  pino.info(`BlogBuilder running at http://localhost:${PORT} repo=${currentRepoPath}`);
});

function shutdown(signal) {
  pino.info(`${signal} received, shutting down`);
  server.close(() => {
    pino.info("HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
