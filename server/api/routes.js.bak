"use strict";

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const engine = require("../engine/builderEngine");
const content = require("../engine/contentEngine");
const media = require("../engine/mediaEngine");
const { loadSite, loadConfig } = require("../engine/siteModel");
const { publishSite, renderPage, renderPostPage } = require("../engine/renderer");
const git = require("../git/gitLayer");
const github = require("../git/githubLayer");
const ai = require("../ai/aiProvider");
const { applyOperation } = require("../engine/applyOperation");

function createRouter({ getRepoPath }) {
  const router = express.Router();

  // every request resolves the *current* repo path - kept dynamic so the
  // "load a different repository" flow needs no server restart.
  router.use((req, res, next) => {
    req.repoPath = getRepoPath();
    next();
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = media.assetsDir(req.repoPath);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        cb(null, `${Date.now()}-${safe}`);
      },
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
  });

  const wrap = (fn) => (req, res) => {
    try {
      const result = fn(req, res);
      if (result instanceof Promise) {
        result.then((data) => res.json(data)).catch((err) => sendError(res, err));
      } else {
        res.json(result);
      }
    } catch (err) {
      sendError(res, err);
    }
  };

  function sendError(res, err) {
    const status = err.code === "NOT_FOUND" ? 404
      : err.code === "LOCKED" ? 403
        : err instanceof engine.BuilderError ? 400 : 500;
    // eslint-disable-next-line no-console
    console.error("[api error]", err.message);
    res.status(status).json({ error: err.message, code: err.code || "INTERNAL" });
  }

  // -- site / config -------------------------------------------------------
  router.get("/site", wrap((req) => {
    const site = loadSite(req.repoPath);
    return {
      config: site.config,
      repoPath: site.repoPath,
      postCount: site.posts.length,
      publishedCount: site.posts.filter((p) => p.published).length,
    };
  }));

  // -- elements -------------------------------------------------------------
  router.get("/elements", wrap((req) => engine.getElements(req.repoPath)));
  router.get("/elements/:id", wrap((req) => engine.getElement(req.repoPath, req.params.id)));
  router.post("/elements", wrap((req) => engine.createElement(req.repoPath, req.body)));
  router.delete("/elements/:id", wrap((req) => engine.deleteElement(req.repoPath, req.params.id)));
  router.post("/elements/:id/duplicate", wrap((req) => engine.duplicateElement(req.repoPath, req.params.id)));
  router.post("/elements/:id/text", wrap((req) => engine.updateText(req.repoPath, req.params.id, req.body.value)));
  router.post("/elements/:id/image", wrap((req) => engine.updateImage(req.repoPath, req.params.id, req.body)));
  router.post("/elements/:id/link", wrap((req) => engine.updateLink(req.repoPath, req.params.id, req.body.href)));
  router.post("/elements/:id/style", wrap((req) => engine.updateStyle(req.repoPath, req.params.id, req.body)));
  router.post("/elements/:id/move", wrap((req) => engine.moveElement(req.repoPath, req.params.id, req.body.dx, req.body.dy)));
  router.post("/elements/:id/resize", wrap((req) => engine.resizeElement(req.repoPath, req.params.id, req.body.widthPct, req.body.heightPct)));
  router.post("/elements/:id/visibility", wrap((req) => engine.setVisibility(req.repoPath, req.params.id, req.body.visible)));
  router.post("/elements/:id/reorder", wrap((req) => engine.reorderElement(req.repoPath, req.params.id, req.body.direction)));
  router.post("/elements/:id/rename", wrap((req) => engine.setElementId(req.repoPath, req.params.id, req.body.newId)));

  // -- posts ------------------------------------------------------------------
  router.get("/posts", wrap((req) => content.getPosts(req.repoPath)));
  router.get("/posts/:slug", wrap((req) => content.getPost(req.repoPath, req.params.slug)));
  router.post("/posts", wrap((req) => content.createPost(req.repoPath, req.body)));
  router.put("/posts/:slug", wrap((req) => content.updatePost(req.repoPath, req.params.slug, req.body)));
  router.delete("/posts/:slug", wrap((req) => content.deletePost(req.repoPath, req.params.slug)));
  router.post("/posts/:slug/publish", wrap((req) => content.setPublished(req.repoPath, req.params.slug, true)));
  router.post("/posts/:slug/unpublish", wrap((req) => content.setPublished(req.repoPath, req.params.slug, false)));

  // -- media --------------------------------------------------------------
  router.get("/media", wrap((req) => media.listMedia(req.repoPath)));
  router.get("/media/unused", wrap((req) => media.findUnusedMedia(req.repoPath)));
  router.post("/media", upload.single("file"), wrap((req) => {
    if (!req.file) throw new engine.BuilderError("No file uploaded", "NO_FILE");
    return { name: req.file.filename, url: `/assets/${req.file.filename}` };
  }));
  router.delete("/media/:name", wrap((req) => media.deleteMedia(req.repoPath, req.params.name)));

  // -- preview / publish ----------------------------------------------------
  // Live preview renders the CURRENT (possibly unpublished) model straight
  // from theme + overrides, so edits show up without a full publish step.
  router.get("/preview", (req, res) => {
    try {
      const site = loadSite(req.repoPath);
      res.set("Content-Type", "text/html").send(renderPage(site.theme.html, site));
    } catch (err) {
      res.status(500).send(`<pre>Preview error: ${err.message}</pre>`);
    }
  });
  router.get("/preview/blog/:slug", (req, res) => {
    try {
      const site = loadSite(req.repoPath);
      const post = site.posts.find((p) => p.slug === req.params.slug);
      if (!post) return res.status(404).send("Post not found");
      const themeDir = path.dirname(site.theme.themePath);
      res.set("Content-Type", "text/html").send(renderPostPage(themeDir, site, post));
    } catch (err) {
      res.status(500).send(`<pre>Preview error: ${err.message}</pre>`);
    }
  });

  router.post("/publish", wrap((req) => publishSite(req.repoPath)));

  // -- git --------------------------------------------------------------------
  router.get("/git/status", wrap((req) => git.status(req.repoPath)));
  router.get("/git/diff", wrap((req) => git.diff(req.repoPath, req.query.file)));
  router.get("/git/log", wrap((req) => git.log(req.repoPath)));
  router.post("/git/commit", wrap((req) => git.commit(req.repoPath, req.body.message)));
  router.post("/git/push", wrap((req) => git.push(req.repoPath, req.body)));
  router.post("/git/pull", wrap((req) => git.pull(req.repoPath, req.body)));
  router.post("/git/remote", wrap((req) => git.setRemote(req.repoPath, req.body.url, req.body.remote)));

  // -- github -----------------------------------------------------------------
  router.post("/github/connect", wrap((req) => github.connect(req.repoPath, req.body)));
  router.post("/github/verify", wrap((req) => github.verifyToken(req.body)));

  // -- AI copilot ---------------------------------------------------------
  router.post("/ai/operations", wrap(async (req) => {
    const elements = engine.getElements(req.repoPath);
    const ops = await ai.generateOperations({ ...req.body, elements });
    return { operations: ops };
  }));
  router.post("/ai/apply", wrap((req) => {
    const { operations } = req.body;
    if (!Array.isArray(operations)) throw new engine.BuilderError("operations must be an array", "INVALID");
    const results = operations.map((op) => {
      try {
        return { op, ok: true, result: applyOperation(req.repoPath, op) };
      } catch (e) {
        return { op, ok: false, error: e.message };
      }
    });
    return { results };
  }));
  router.post("/ai/article-assist", wrap((req) => ai.articleAssist(req.body)));

  // -- markdown <-> html (used by the rich text editor for loading content) --
  router.post("/markdown/to-html", wrap((req) => {
    const { marked } = require("marked");
    return { html: marked.parse(req.body.markdown || "") };
  }));

  // -- themes -----------------------------------------------------------------
  router.get("/themes", wrap(() => {
    const list = [];
    const root = path.resolve(__dirname, "../..");
    
    // Check built-in themes directory
    const themesDir = path.join(root, "themes");
    if (fs.existsSync(themesDir)) {
      for (const d of fs.readdirSync(themesDir)) {
        const jsonPath = path.join(themesDir, d, "theme.json");
        if (fs.existsSync(jsonPath)) {
          try {
            list.push(JSON.parse(fs.readFileSync(jsonPath, "utf8")));
          } catch {}
        }
      }
    }
    
    // Also include the example-site (Ensō)
    const ensoJson = path.join(root, "example-site", "theme.json");
    if (fs.existsSync(ensoJson)) {
      try {
        list.push(JSON.parse(fs.readFileSync(ensoJson, "utf8")));
      } catch {}
    }
    
    return list;
  }));

  router.post("/themes/upload", upload.single("theme"), wrap((req) => {
    if (!req.file) throw new engine.BuilderError("No theme zip file uploaded", "NO_FILE");
    const { execSync } = require("child_process");
    const themeName = path.basename(req.file.originalname, path.extname(req.file.originalname)).replace(/[^a-zA-Z0-9_-]/g, "");
    const root = path.resolve(__dirname, "../..");
    const targetDir = path.join(root, "themes", themeName);
    
    fs.mkdirSync(targetDir, { recursive: true });
    try {
      execSync(`unzip -o "${req.file.path}" -d "${targetDir}"`);
      fs.unlinkSync(req.file.path);
    } catch (e) {
      throw new engine.BuilderError(`Failed to extract theme: ${e.message}`, "EXTRACT_FAILED");
    }

    // Write a fallback theme.json if none exists
    const manifestPath = path.join(targetDir, "theme.json");
    if (!fs.existsSync(manifestPath)) {
      fs.writeFileSync(manifestPath, JSON.stringify({
        id: themeName,
        name: themeName.charAt(0).toUpperCase() + themeName.slice(1),
        description: "Custom uploaded theme",
        version: "1.0.0"
      }, null, 2) + "\n");
    }

    return { ok: true, id: themeName };
  }));

  router.post("/themes/apply", wrap((req) => {
    const { themeId } = req.body || {};
    if (!themeId) throw new engine.BuilderError("themeId is required", "INVALID");

    const root = path.resolve(__dirname, "../..");
    let srcThemeDir = null;

    if (themeId === "obsidian") {
      srcThemeDir = path.join(root, "themes", "obsidian");
    } else if (themeId === "enso") {
      srcThemeDir = path.join(root, "example-site");
    } else {
      const candidate = path.join(root, "themes", themeId);
      if (fs.existsSync(candidate)) srcThemeDir = candidate;
    }

    if (!srcThemeDir || !fs.existsSync(srcThemeDir)) {
      throw new engine.BuilderError(`Theme "${themeId}" not found`, "NOT_FOUND");
    }

    const repo = req.repoPath;
    const destTheme = path.join(repo, "theme");
    fs.mkdirSync(destTheme, { recursive: true });

    // Copy theme html/css/assets
    const srcThemeFiles = path.join(srcThemeDir, "theme");
    if (fs.existsSync(srcThemeFiles)) {
      for (const file of fs.readdirSync(srcThemeFiles)) {
        fs.copyFileSync(path.join(srcThemeFiles, file), path.join(destTheme, file));
      }
    }

    // Reset overrides to clean state for new theme
    const overridesPath = path.join(repo, "content", "overrides.json");
    fs.writeFileSync(overridesPath, JSON.stringify({ overrides: {}, added: [] }, null, 2) + "\n", "utf8");

    return { ok: true, applied: themeId };
  }));

  return router;
}

module.exports = { createRouter };
