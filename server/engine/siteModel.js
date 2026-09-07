"use strict";
/**
 * Site Model
 * ----------
 * Loads everything the builder needs from a repository on disk:
 *   content/config.json     - site-level settings + collection definitions
 *   <theme>/index.html      - the theme (parsed via themeParser)
 *   content/overrides.json  - all user edits (the ONLY mutable "database" -
 *                             it lives inside the repo and is git-tracked)
 *   content/posts/*.md      - blog posts (frontmatter + markdown body)
 *
 * There is deliberately no separate database: this module just re-reads the
 * repo from disk on every call, so git is always the single source of truth.
 */

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { parseTheme } = require("./themeParser");

const DEFAULT_OVERRIDES = { overrides: {}, added: [] };

function loadConfig(repoPath) {
  const p = path.join(repoPath, "content", "config.json");
  if (!fs.existsSync(p)) {
    throw new Error(`Missing content/config.json in repo at ${repoPath}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Only whitelisted keys are writable - theme paths and collection dirs
// stay file-edited to avoid bricking the repo from the UI.
function updateConfig(repoPath, patch) {
  const allowed = ["title", "description"];
  const config = loadConfig(repoPath);
  for (const k of allowed) {
    if (patch[k] !== undefined) config[k] = patch[k];
  }
  atomicWriteFileSync(
    path.join(repoPath, "content", "config.json"),
    JSON.stringify(config, null, 2) + "\n"
  );
  return config;
}

function loadOverrides(repoPath) {
  const p = path.join(repoPath, "content", "overrides.json");
  if (!fs.existsSync(p)) return structuredClone(DEFAULT_OVERRIDES);
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return { overrides: parsed.overrides || {}, added: parsed.added || [] };
  } catch (e) {
    throw new Error(`content/overrides.json is not valid JSON: ${e.message}`);
  }
}

function atomicWriteFileSync(filePath, content) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.tmp-${path.basename(filePath)}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`);
  
  const fd = fs.openSync(tmpPath, "w");
  fs.writeFileSync(fd, content, "utf8");
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  
  fs.renameSync(tmpPath, filePath);
}

function saveOverrides(repoPath, overridesObj) {
  const p = path.join(repoPath, "content", "overrides.json");
  atomicWriteFileSync(p, JSON.stringify(overridesObj, null, 2) + "\n");
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function postsDir(repoPath, config) {
  const rel = (config.collections && config.collections.posts && config.collections.posts.dir)
    || "content/posts";
  return path.join(repoPath, rel);
}

function loadPosts(repoPath, config) {
  const dir = postsDir(repoPath, config);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  return files.map((file) => {
    const full = path.join(dir, file);
    const raw = fs.readFileSync(full, "utf8");
    const { data, content } = matter(raw);
    const slug = data.slug || file.replace(/\.md$/, "");
    return {
      slug,
      file,
      title: data.title || slug,
      author: data.author || "",
      date: data.date || "",
      tags: data.tags || [],
      featuredImage: data.featuredImage || "",
      published: !!data.published,
      excerpt: data.excerpt || (content.trim().split("\n").find((l) => l.trim()) || "").slice(0, 200),
      body: content,
    };
  }).sort((a, b) => (a.date < b.date ? 1 : -1));
}

function loadTheme(repoPath, config) {
  const themePath = path.join(repoPath, config.theme || "theme/index.html");
  if (!fs.existsSync(themePath)) {
    throw new Error(`Theme file not found: ${themePath}`);
  }
  const html = fs.readFileSync(themePath, "utf8");
  return { html, parsed: parseTheme(html), themePath };
}

/**
 * Merge base theme node + override entry -> the "effective" element as the
 * editor and renderer should see it right now.
 */
function mergeNode(baseNode, override) {
  const o = override || {};
  return {
    ...baseNode,
    text: o.text !== undefined ? o.text : baseNode.text,
    src: o.src !== undefined ? o.src : baseNode.src,
    alt: o.alt !== undefined ? o.alt : baseNode.alt,
    href: o.href !== undefined ? o.href : baseNode.href,
    style: { ...baseNode.style, ...(o.style || {}) },
    visible: o.visible !== undefined ? o.visible : true,
    deleted: !!o.deleted,
    order: o.order || null,
    origin: "theme",
  };
}

function addedToNode(added) {
  return {
    id: added.id,
    tag: added.tag,
    kind: added.kind,
    parentId: added.parent || null,
    children: [],
    locked: false,
    collection: null,
    text: added.text,
    src: added.src,
    alt: added.alt,
    href: added.href,
    style: added.style || {},
    className: "",
    visible: true,
    deleted: false,
    order: null,
    origin: "added",
  };
}

/**
 * Build the full effective element map (theme nodes merged with overrides,
 * plus any added elements), and effective parent/child ordering.
 */
function buildEffectiveTree(themeParsed, overridesObj) {
  const { overrides, added } = overridesObj;
  const effective = {};

  for (const [id, base] of Object.entries(themeParsed.nodes)) {
    effective[id] = mergeNode(base, overrides[id]);
  }
  for (const a of added) {
    if (a.deleted) continue;
    effective[a.id] = addedToNode(a);
  }

  // rebuild children lists (theme order, then added elements appended),
  // then apply any explicit "order" override on a per-parent basis.
  for (const id of Object.keys(effective)) effective[id].children = [];
  for (const id of Object.keys(effective)) {
    const node = effective[id];
    if (node.parentId && effective[node.parentId]) {
      effective[node.parentId].children.push(id);
    }
  }
  for (const id of Object.keys(effective)) {
    const node = effective[id];
    if (node.order && Array.isArray(node.order)) {
      const known = new Set(node.children);
      const ordered = node.order.filter((c) => known.has(c));
      const rest = node.children.filter((c) => !ordered.includes(c));
      node.children = [...ordered, ...rest];
    }
  }

  const topLevel = Object.values(effective)
    .filter((n) => !n.parentId)
    .map((n) => n.id);

  return { effective, topLevel };
}

function loadSite(repoPath) {
  const config = loadConfig(repoPath);
  const overridesObj = loadOverrides(repoPath);
  const theme = loadTheme(repoPath, config);
  const posts = loadPosts(repoPath, config);
  const { effective, topLevel } = buildEffectiveTree(theme.parsed, overridesObj);
  return { repoPath, config, overridesObj, theme, posts, effective, topLevel };
}

module.exports = {
  loadSite,
  loadConfig,
  updateConfig,
  loadOverrides,
  saveOverrides,
  loadPosts,
  loadTheme,
  postsDir,
  buildEffectiveTree,
  slugify,
  atomicWriteFileSync,
};
