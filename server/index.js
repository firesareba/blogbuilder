"use strict";

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");

const { createRouter } = require("./api/routes");

const PORT = process.env.PORT || 4321;
const DEFAULT_REPO = path.resolve(
  process.env.BLOG_REPO_PATH || path.join(__dirname, "..", "example-site"),
);

let currentRepoPath = DEFAULT_REPO;

function getRepoPath() {
  return currentRepoPath;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// The API - everything the GUI, CLI, and AI copilot go through.
app.use("/api", createRouter({ getRepoPath }));

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
// the live preview iframe and the published dist/ output during local dev.
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
app.use("/dist", (req, res, next) => {
  express.static(path.join(currentRepoPath, "dist"))(req, res, next);
});

// The builder GUI itself.
app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`BlogBuilder running at http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Repo: ${currentRepoPath}`);
});
