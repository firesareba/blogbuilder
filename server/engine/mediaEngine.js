"use strict";
/**
 * Media Engine
 * ------------
 * Assets live in <repo>/assets. No processing/optimization in v1 - files are
 * stored as uploaded and served back statically. "Unused" detection is a
 * simple text-search across theme, overrides and post bodies for the asset's
 * public path.
 */

const fs = require("fs");
const path = require("path");
const { loadConfig, loadOverrides, loadPosts } = require("./siteModel");
const { BuilderError } = require("./builderEngine");

function assetsDir(repoPath) {
  return path.join(repoPath, "assets");
}

function listMedia(repoPath) {
  const dir = assetsDir(repoPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .map((f) => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, url: `/assets/${f}`, size: stat.size, modified: stat.mtime };
    });
}

function deleteMedia(repoPath, name) {
  const dir = assetsDir(repoPath);
  const file = path.join(dir, name);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(dir))) {
    throw new BuilderError("Invalid file name", "INVALID");
  }
  if (!fs.existsSync(file)) throw new BuilderError(`No such asset "${name}"`, "NOT_FOUND");
  fs.unlinkSync(file);
  return { deleted: name };
}

function findUnusedMedia(repoPath) {
  const all = listMedia(repoPath);
  const config = loadConfig(repoPath);
  const overrides = loadOverrides(repoPath);
  const posts = loadPosts(repoPath, config);
  const themeHtml = fs.readFileSync(path.join(repoPath, config.theme || "theme/index.html"), "utf8");

  const haystacks = [
    themeHtml,
    JSON.stringify(overrides),
    ...posts.map((p) => p.body),
  ].join("\n");

  return all.filter((asset) => !haystacks.includes(asset.url));
}

module.exports = { assetsDir, listMedia, deleteMedia, findUnusedMedia };
