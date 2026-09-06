"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const content = require("../server/engine/contentEngine");
const builder = require("../server/engine/builderEngine");
const { publishSite } = require("../server/engine/renderer");

let repo;
function seedRepo() {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "bb-test-"));
  fs.mkdirSync(path.join(repo, "content", "posts"), { recursive: true });
  fs.mkdirSync(path.join(repo, "theme"), { recursive: true });
  fs.mkdirSync(path.join(repo, "assets"), { recursive: true });
  fs.writeFileSync(path.join(repo, "content", "config.json"), JSON.stringify({
    title: "Test", theme: "theme/index.html",
    collections: { posts: { dir: "content/posts", route: "/blog" } },
  }));
  fs.writeFileSync(path.join(repo, "theme", "index.html"),
    '<html><body><h1 data-builder-id="headline">hi</h1><div data-builder-id="latest-posts" data-builder-collection="posts"></div></body></html>');
  fs.writeFileSync(path.join(repo, "content", "overrides.json"), JSON.stringify({ overrides: {}, added: [] }));
}

beforeEach(seedRepo);
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe("contentEngine", () => {
  it("creates, updates, publishes a post", () => {
    const p = content.createPost(repo, { title: "Hello" });
    assert.equal(p.slug, "hello");
    const u = content.updatePost(repo, "hello", { title: "Hello World" });
    assert.equal(u.title, "Hello World");
    const pub = content.setPublished(repo, "hello", true);
    assert.equal(pub.published, true);
  });
  it("rejects duplicate slugs", () => {
    content.createPost(repo, { title: "Dup" });
    assert.throws(() => content.createPost(repo, { title: "Dup" }), /already exists/);
  });
});

describe("builderEngine", () => {
  it("lists theme elements and updates text", () => {
    const els = builder.getElements(repo);
    assert.ok(Array.isArray(els));
    builder.updateText(repo, "headline", "new headline");
    const el = builder.getElement(repo, "headline");
    assert.equal(el.text, "new headline");
  });
});

describe("renderer", () => {
  it("publishes homepage + post pages", () => {
    content.createPost(repo, { title: "P1" });
    content.setPublished(repo, "p1", true);
    const r = publishSite(repo);
    assert.equal(r.pagesWritten, 2);
    assert.ok(fs.existsSync(path.join(repo, "dist", "index.html")));
  });
});
