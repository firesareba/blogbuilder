"use strict";
/**
 * Content Engine
 * --------------
 * Blog posts are plain markdown files with YAML frontmatter, stored under
 * content/posts/<slug>.md. The user never sees the raw markdown+frontmatter;
 * the API always deals in structured post objects.
 */

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { loadConfig, loadPosts, postsDir, slugify, atomicWriteFileSync } = require("./siteModel");
const { BuilderError } = require("./builderEngine");

function getPosts(repoPath) {
  const config = loadConfig(repoPath);
  return loadPosts(repoPath, config);
}

function getPost(repoPath, slug) {
  const post = getPosts(repoPath).find((p) => p.slug === slug);
  if (!post) throw new BuilderError(`No post with slug "${slug}"`, "NOT_FOUND");
  return post;
}

function postPath(repoPath, config, slug) {
  return path.join(postsDir(repoPath, config), `${slug}.md`);
}

function createPost(repoPath, { title, slug, author, tags, featuredImage, body }) {
  const config = loadConfig(repoPath);
  const dir = postsDir(repoPath, config);
  fs.mkdirSync(dir, { recursive: true });
  const finalSlug = slugify(slug || title || `post-${Date.now()}`);
  const file = postPath(repoPath, config, finalSlug);
  if (fs.existsSync(file)) {
    throw new BuilderError(`A post with slug "${finalSlug}" already exists`, "DUPLICATE_SLUG");
  }
  const frontmatter = {
    title: title || "Untitled post",
    slug: finalSlug,
    author: author || "",
    date: new Date().toISOString().slice(0, 10),
    tags: tags || [],
    featuredImage: featuredImage || "",
    published: false,
    excerpt: "",
  };
  const content = matter.stringify(body || "\n", frontmatter);
  atomicWriteFileSync(file, content);
  return getPost(repoPath, finalSlug);
}

function updatePost(repoPath, slug, patch) {
  const config = loadConfig(repoPath);
  const file = postPath(repoPath, config, slug);
  if (!fs.existsSync(file)) throw new BuilderError(`No post with slug "${slug}"`, "NOT_FOUND");
  const raw = fs.readFileSync(file, "utf8");
  const { data, content } = matter(raw);

  const newSlug = patch.slug ? slugify(patch.slug) : slug;
  const newData = {
    ...data,
    title: patch.title !== undefined ? patch.title : data.title,
    slug: newSlug,
    author: patch.author !== undefined ? patch.author : data.author,
    date: patch.date !== undefined ? patch.date : data.date,
    tags: patch.tags !== undefined ? patch.tags : data.tags,
    featuredImage: patch.featuredImage !== undefined ? patch.featuredImage : data.featuredImage,
    published: patch.published !== undefined ? patch.published : data.published,
    excerpt: patch.excerpt !== undefined ? patch.excerpt : data.excerpt,
  };
  const newBody = patch.body !== undefined ? patch.body : content;
  const cleanData = Object.fromEntries(Object.entries(newData).filter(([, v]) => v !== undefined));
  const newContent = matter.stringify(newBody, cleanData);

  if (newSlug !== slug) {
    const newFile = postPath(repoPath, config, newSlug);
    if (fs.existsSync(newFile)) throw new BuilderError(`A post with slug "${newSlug}" already exists`, "DUPLICATE_SLUG");
    fs.unlinkSync(file);
    atomicWriteFileSync(newFile, newContent);
  } else {
    atomicWriteFileSync(file, newContent);
  }
  return getPost(repoPath, newSlug);
}

function deletePost(repoPath, slug) {
  const config = loadConfig(repoPath);
  const file = postPath(repoPath, config, slug);
  if (!fs.existsSync(file)) throw new BuilderError(`No post with slug "${slug}"`, "NOT_FOUND");
  fs.unlinkSync(file);
  return { deleted: slug };
}

function setPublished(repoPath, slug, published) {
  return updatePost(repoPath, slug, { published: !!published });
}

module.exports = {
  getPosts, getPost, createPost, updatePost, deletePost, setPublished,
};
