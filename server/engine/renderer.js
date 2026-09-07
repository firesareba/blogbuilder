"use strict";
/**
 * Renderer
 * --------
 * Produces plain HTML/CSS/JS in <repo>/docs from theme + overrides + posts.
 * No React, no build tooling required to view the output - it's a normal
 * static site deployable on its own. Output goes to docs/ (not dist/)
 * because GitHub Pages only serves the repo root or /docs.
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { marked } = require("marked");
const { loadSite } = require("./siteModel");

function styleToCss(style) {
  return Object.entries(style || {})
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}: ${v};`)
    .join(" ");
}

function renderCollection(doc, containerEl, key, site) {
  containerEl.innerHTML = "";
  const posts = site.posts.filter((p) => p.published);
  const isArchive = containerEl.getAttribute("data-builder-id") === "archive";
  const list = isArchive ? posts : posts.slice(0, 3);
  if (list.length === 0) {
    const empty = doc.createElement("p");
    empty.className = "bb-empty";
    empty.textContent = "No posts published yet.";
    containerEl.appendChild(empty);
    return;
  }
  for (const post of list) {
    const card = doc.createElement("a");
    card.className = "bb-post-card";
    card.setAttribute("href", `/blog/${post.slug}/`);
    // Lets the builder canvas open this post for editing on click.
    // Benign in published output.
    card.setAttribute("data-post-slug", post.slug);
    const h = doc.createElement("h3");
    h.textContent = post.title;
    const meta = doc.createElement("p");
    meta.className = "bb-post-meta";
    meta.textContent = [post.date, post.author].filter(Boolean).join(" · ");
    const excerpt = doc.createElement("p");
    excerpt.className = "bb-post-excerpt";
    excerpt.textContent = post.excerpt;
    card.appendChild(h);
    if (meta.textContent) card.appendChild(meta);
    card.appendChild(excerpt);
    containerEl.appendChild(card);
  }
}

/** Builder ids are restricted to [a-z0-9-], but escape defensively anyway. */
function idSelector(id) {
  return `[data-builder-id="${String(id).replace(/"/g, '\\"')}"]`;
}

/** Apply the effective site model onto a fresh parse of the theme DOM. */
function applyModelToDom(doc, site) {
  // Walk every builder id in the effective tree and sync attrs/text/style.
  for (const id of Object.keys(site.effective)) {
    const node = site.effective[id];
    let el = doc.querySelector(idSelector(id));

    if (node.origin === "added" && !el) {
      const parentEl = node.parentId
        ? doc.querySelector(idSelector(node.parentId))
        : doc.body;
      if (!parentEl) continue;
      el = doc.createElement(node.tag);
      el.setAttribute("data-builder-id", id);
      parentEl.appendChild(el);
    }
    if (!el) continue;

    if (node.deleted) {
      el.remove();
      continue;
    }
    if (node.visible === false) {
      el.style.display = "none";
    }
    if ((node.kind === "text" || node.kind === "link") && node.text !== undefined) {
      el.textContent = node.text;
    }
    if (node.kind === "image") {
      if (node.src !== undefined) el.setAttribute("src", node.src);
      if (node.alt !== undefined) el.setAttribute("alt", node.alt);
    }
    if (node.href !== undefined && (node.kind === "link" || node.tag === "button")) {
      if (node.tag === "a") el.setAttribute("href", node.href);
    }
    const css = styleToCss(node.style);
    if (css) el.setAttribute("style", `${el.getAttribute("style") || ""} ${css}`.trim());
  }

  // Re-apply child ordering for containers that have an explicit order.
  for (const id of Object.keys(site.effective)) {
    const node = site.effective[id];
    if (!node.order) continue;
    const parentEl = doc.querySelector(idSelector(id));
    if (!parentEl) continue;
    for (const childId of node.order) {
      const childEl = doc.querySelector(idSelector(childId));
      if (childEl) parentEl.appendChild(childEl);
    }
  }

  // Populate collection containers (e.g. latest-posts, archive).
  for (const id of Object.keys(site.effective)) {
    const node = site.effective[id];
    if (!node.collection) continue;
    const el = doc.querySelector(idSelector(id));
    if (el) renderCollection(doc, el, node.collection, site);
  }
}

/**
 * Rewrite root-absolute local URLs (href="/theme.css", src="/assets/x")
 * into page-relative ones. Published output lives under an unknown subpath
 * (e.g. username.github.io/repo/), where a leading "/" escapes to the
 * domain root and every stylesheet/image/link 404s - the classic "raw
 * HTML" Pages deployment. Preview keeps absolute URLs (served at root).
 */
function relativizeUrls(doc, depth) {
  const prefix = "../".repeat(depth);
  for (const el of doc.querySelectorAll("[href],[src]")) {
    for (const attr of ["href", "src"]) {
      const v = el.getAttribute(attr);
      if (!v || !v.startsWith("/") || v.startsWith("//")) continue;
      const rel = v.slice(1);
      el.setAttribute(attr, prefix + (rel || "./"));
    }
  }
}

// Same treatment for url(/...) inside copied stylesheets.
function relativizeCssUrls(cssText, depth) {
  const prefix = "../".repeat(depth);
  return cssText.replace(/url\(\s*\/([^/])/g, `url(${prefix}$1`);
}

function renderPage(themeHtml, site, opts = {}) {
  const dom = new JSDOM(themeHtml);
  const doc = dom.window.document;
  applyModelToDom(doc, site);
  if (opts.relative) relativizeUrls(doc, opts.depth || 0);
  // config.json is the source of truth for the tab title, not whatever the
  // theme hardcoded - otherwise editing the title in Settings visibly
  // does nothing.
  if (site.config.title) {
    let titleEl = doc.querySelector("title");
    if (!titleEl) {
      titleEl = doc.createElement("title");
      doc.head.appendChild(titleEl);
    }
    titleEl.textContent = site.config.title;
  }
  if (site.config.description) {
    let meta = doc.querySelector('meta[name="description"]');
    if (!meta) {
      meta = doc.createElement("meta");
      meta.setAttribute("name", "description");
      doc.head.appendChild(meta);
    }
    meta.setAttribute("content", site.config.description);
  }
  return `<!DOCTYPE html>\n${dom.serialize().replace(/^<!DOCTYPE html>\n?/i, "")}`;
}

function renderPostPage(themeDir, site, post, opts = {}) {
  const postThemePath = path.join(themeDir, "post.html");
  const base = fs.existsSync(postThemePath)
    ? fs.readFileSync(postThemePath, "utf8")
    : site.theme.html; // fall back to the main theme if there's no dedicated post template

  const dom = new JSDOM(base);
  const doc = dom.window.document;
  applyModelToDom(doc, site);

  const titleEl = doc.querySelector('[data-builder-id="post-title"]');
  if (titleEl) titleEl.textContent = post.title;
  const metaEl = doc.querySelector('[data-builder-id="post-meta"]');
  if (metaEl) metaEl.textContent = [post.date, post.author].filter(Boolean).join(" · ");
  const bodyEl = doc.querySelector('[data-builder-id="post-content"]');
  if (bodyEl) bodyEl.innerHTML = marked.parse(post.body || "");
  const headEl = doc.querySelector("title");
  if (headEl) headEl.textContent = `${post.title} - ${site.config.title || "Blog"}`;
  if (opts.relative) relativizeUrls(doc, opts.depth || 0);

  return `<!DOCTYPE html>\n${dom.serialize().replace(/^<!DOCTYPE html>\n?/i, "")}`;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function publishSite(repoPath) {
  const site = loadSite(repoPath);
  // docs/, not dist/: GitHub Pages serves the repo root or /docs only,
  // so dist/ output leaves Pages with no index.html in a servable path.
  const outDir = path.join(repoPath, "docs");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // homepage (depth 0) and post pages (depth 2: blog/<slug>/) get
  // page-relative URLs so output works under any subpath.
  const homeHtml = renderPage(site.theme.html, site, { relative: true, depth: 0 });
  fs.writeFileSync(path.join(outDir, "index.html"), homeHtml, "utf8");

  // published posts
  const themeDir = path.dirname(site.theme.themePath);
  const published = site.posts.filter((p) => p.published);
  for (const post of published) {
    const postDir = path.join(outDir, "blog", post.slug);
    fs.mkdirSync(postDir, { recursive: true });
    fs.writeFileSync(path.join(postDir, "index.html"), renderPostPage(themeDir, site, post, { relative: true, depth: 2 }), "utf8");
  }

  // theme assets (css/js) and site assets
  for (const file of fs.existsSync(themeDir) ? fs.readdirSync(themeDir) : []) {
    if (file === "index.html" || file === "post.html") continue;
    const s = path.join(themeDir, file);
    if (fs.statSync(s).isDirectory()) copyDir(s, path.join(outDir, file));
    else if (file.endsWith(".css")) {
      // Theme stylesheets land flat in outDir root (depth 0).
      fs.writeFileSync(path.join(outDir, file), relativizeCssUrls(fs.readFileSync(s, "utf8"), 0), "utf8");
    }
    else fs.copyFileSync(s, path.join(outDir, file));
  }
  copyDir(path.join(repoPath, "assets"), path.join(outDir, "assets"));

  // Tell GitHub Pages to serve files as-is (no Jekyll processing).
  fs.writeFileSync(path.join(outDir, ".nojekyll"), "", "utf8");

  return {
    outDir,
    pagesWritten: 1 + published.length,
    publishedPosts: published.map((p) => p.slug),
  };
}

module.exports = { publishSite, renderPage, renderPostPage };
