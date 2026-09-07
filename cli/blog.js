#!/usr/bin/env node
"use strict";
/**
 * blog - command line client for BlogBuilder.
 *
 * This talks to the SAME REST API the web GUI uses (see server/api/routes.js).
 * There is no separate "CLI engine" - if it's possible in the GUI, the exact
 * same HTTP call is available here.
 */

const { Command } = require("commander");

const BASE = process.env.BLOG_API_URL || "http://localhost:4321/api";
const fs = require("fs");
const os = require("os");
const path = require("path");
const SESSION_FILE = process.env.BLOG_SESSION_FILE || path.join(os.homedir(), ".blogbuilder-session");

function loadSession() {
  try { return fs.readFileSync(SESSION_FILE, "utf8").trim() || null; }
  catch { return null; }
}

async function api(method, urlPath, body) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  const session = loadSession();
  if (session) headers.cookie = `session=${session}`;
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`✗ ${data.error || res.statusText}${res.status === 401 ? " (hint: run `blog login` first)" : ""}`);
    process.exitCode = 1;
    return null;
  }
  return data;
}

function printTree(nodes, depth = 0) {
  for (const n of nodes) {
    const label = [
      n.id,
      `(${n.tag})`,
      n.locked ? "[locked]" : "",
      n.collection ? `[collection:${n.collection}]` : "",
      n.text ? `"${n.text.slice(0, 40)}${n.text.length > 40 ? "…" : ""}"` : "",
    ].filter(Boolean).join(" ");
    console.log(`${"  ".repeat(depth)}- ${label}`);
    if (n.children && n.children.length) printTree(n.children, depth + 1);
  }
}

const program = new Command();
program.name("blog").description("BlogBuilder CLI - a git-native visual site builder").version("0.1.0");

// -- elements -----------------------------------------------------------
program.command("elements").description("List all builder elements as a tree").action(async () => {
  const data = await api("GET", "/elements");
  if (data) printTree(data);
});

program.command("element <id>").description("Show one element in detail").action(async (id) => {
  const data = await api("GET", `/elements/${encodeURIComponent(id)}`);
  if (data) console.log(JSON.stringify(data, null, 2));
});

program.command("set-text <id> <value>").description("Set an element's text").action(async (id, value) => {
  const data = await api("POST", `/elements/${encodeURIComponent(id)}/text`, { value });
  if (data) console.log(`✓ ${id} text updated`);
});

program.command("set-image <id> <src> [alt]").description("Set an image element's src/alt").action(async (id, src, alt) => {
  const data = await api("POST", `/elements/${encodeURIComponent(id)}/image`, { src, alt });
  if (data) console.log(`✓ ${id} image updated`);
});

program.command("set-link <id> <href>").description("Set a link/button's href").action(async (id, href) => {
  const data = await api("POST", `/elements/${encodeURIComponent(id)}/link`, { href });
  if (data) console.log(`✓ ${id} link updated`);
});

// Positional negative numbers (`-4`) are ambiguous with option flags in most
// CLI arg parsers, commander included - so movement/resizing use flags,
// which can safely carry a leading "-".
program.command("move <id>")
  .description("Move an element by dx,dy pixels")
  .requiredOption("--dx <px>", "horizontal offset in px (can be negative)")
  .requiredOption("--dy <px>", "vertical offset in px (can be negative)")
  .action(async (id, opts) => {
    const data = await api("POST", `/elements/${encodeURIComponent(id)}/move`, { dx: Number(opts.dx), dy: Number(opts.dy) });
    if (data) console.log(`✓ moved ${id} by (${opts.dx}, ${opts.dy})`);
  });

program.command("resize <id>")
  .description("Resize an element (percent of current size)")
  .requiredOption("--width <pct>", "width, percent of current size")
  .requiredOption("--height <pct>", "height, percent of current size")
  .action(async (id, opts) => {
    const data = await api("POST", `/elements/${encodeURIComponent(id)}/resize`, { widthPct: Number(opts.width), heightPct: Number(opts.height) });
    if (data) console.log(`✓ resized ${id} to (${opts.width}%, ${opts.height}%)`);
  });

program.command("set-style <id> <json>").description('Merge a style object, e.g. \'{"color":"#ff0000"}\'').action(async (id, json) => {
  const style = JSON.parse(json);
  const data = await api("POST", `/elements/${encodeURIComponent(id)}/style`, style);
  if (data) console.log(`✓ ${id} style updated`);
});

program.command("hide <id>").description("Hide an element").action(async (id) => {
  const data = await api("POST", `/elements/${encodeURIComponent(id)}/visibility`, { visible: false });
  if (data) console.log(`✓ ${id} hidden`);
});
program.command("show <id>").description("Show a hidden element").action(async (id) => {
  const data = await api("POST", `/elements/${encodeURIComponent(id)}/visibility`, { visible: true });
  if (data) console.log(`✓ ${id} visible`);
});

program.command("add <type>")
  .description("Add an element: text|heading|button|image|link|container")
  .option("--id <id>", "custom element id")
  .option("--parent <parent>", "parent container id")
  .option("--text <text>", "initial text")
  .option("--href <href>", "link/button href")
  .option("--src <src>", "image src")
  .action(async (type, opts) => {
    const data = await api("POST", "/elements", {
      type, id: opts.id, parent: opts.parent, text: opts.text, href: opts.href, src: opts.src,
    });
    if (data) console.log(`✓ created "${data.id}"`);
  });

program.command("delete-element <id>").description("Delete an element").action(async (id) => {
  const data = await api("DELETE", `/elements/${encodeURIComponent(id)}`);
  if (data) console.log(`✓ deleted ${id}`);
});

program.command("duplicate-element <id>").description("Duplicate an element").action(async (id) => {
  const data = await api("POST", `/elements/${encodeURIComponent(id)}/duplicate`);
  if (data) console.log(`✓ duplicated as "${data.id}"`);
});

program.command("reorder <id> <direction>").description("Move an element up/down among its siblings").action(async (id, direction) => {
  const data = await api("POST", `/elements/${encodeURIComponent(id)}/reorder`, { direction });
  if (data) console.log(`✓ reordered`);
});

// -- posts ----------------------------------------------------------------
program.command("posts").description("List all posts").action(async () => {
  const data = await api("GET", "/posts");
  if (data) {
    for (const p of data) {
      console.log(`${p.published ? "●" : "○"} ${p.slug}  "${p.title}"  ${p.date}`);
    }
  }
});

program.command("create-post <slug>")
  .description("Create a new draft post")
  .option("--title <title>", "post title")
  .option("--author <author>", "author name")
  .action(async (slug, opts) => {
    const data = await api("POST", "/posts", { slug, title: opts.title || slug, author: opts.author });
    if (data) console.log(`✓ created draft "${data.slug}"`);
  });

program.command("edit-post <slug> <field> <value>")
  .description("Edit a post field: title|author|date|body|tags")
  .action(async (slug, field, value) => {
    const patch = { [field]: field === "tags" ? value.split(",").map((t) => t.trim()) : value };
    const data = await api("PUT", `/posts/${encodeURIComponent(slug)}`, patch);
    if (data) console.log(`✓ updated ${field} on "${slug}"`);
  });

program.command("delete-post <slug>").description("Delete a post").action(async (slug) => {
  const data = await api("DELETE", `/posts/${encodeURIComponent(slug)}`);
  if (data) console.log(`✓ deleted "${slug}"`);
});

program.command("publish-post <slug>").description("Publish a post").action(async (slug) => {
  const data = await api("POST", `/posts/${encodeURIComponent(slug)}/publish`);
  if (data) console.log(`✓ published "${slug}"`);
});

program.command("unpublish-post <slug>").description("Unpublish a post").action(async (slug) => {
  const data = await api("POST", `/posts/${encodeURIComponent(slug)}/unpublish`);
  if (data) console.log(`✓ unpublished "${slug}"`);
});

// -- media ------------------------------------------------------------------
program.command("media").description("List uploaded media").action(async () => {
  const data = await api("GET", "/media");
  if (data) for (const m of data) console.log(`${m.url}  (${m.size} bytes)`);
});

// -- publish / preview ------------------------------------------------------
program.command("publish").description("Render to docs/, commit and push (full publish pipeline)").action(async () => {
  const data = await api("POST", "/publish", {});
  if (!data) return;
  console.log(`✓ built ${data.pagesWritten} page(s) to ${data.outDir}`);
  console.log(data.commit?.committed ? `✓ committed ${data.commit.commit}` : `– ${data.commit?.reason || "nothing committed"}`);
  console.log(data.push?.pushed ? `✓ pushed to ${data.push.remote}/${data.push.branch}` : `– not pushed: ${data.push?.reason || "unknown"}`);
});

// -- auth ---------------------------------------------------------------------
program.command("login").description("Sign in (saves session cookie for later commands)").action(async () => {
  const rl = require("readline").createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q) => new Promise((r) => rl.question(q, r));
  const username = (await ask("Username: ")).trim();
  const password = await ask("Password: ");
  rl.close();
  const res = await fetch(`${BASE}/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: password.trim() }),
  });
  if (!res.ok) {
    console.error(`✗ ${((await res.json().catch(() => ({}))).error) || res.statusText}`);
    process.exitCode = 1;
    return;
  }
  const setCookie = res.headers.get("set-cookie") || "";
  const m = setCookie.match(/session=([^;]+)/);
  if (!m) { console.error("✗ no session cookie returned"); process.exitCode = 1; return; }
  fs.writeFileSync(SESSION_FILE, decodeURIComponent(m[1]), { mode: 0o600 });
  console.log("✓ signed in");
});

program.command("logout").description("Clear the saved CLI session").action(async () => {
  try { fs.unlinkSync(SESSION_FILE); } catch {}
  console.log("✓ signed out");
});

// -- git ----------------------------------------------------------------------
const gitCmd = program.command("git").description("Git operations");

gitCmd.command("status").description("Show git status").action(async () => {
  const data = await api("GET", "/git/status");
  if (data) console.log(JSON.stringify(data, null, 2));
});
gitCmd.command("log").description("Show recent commits").action(async () => {
  const data = await api("GET", "/git/log");
  if (data) for (const c of data) console.log(`${c.hash.slice(0, 7)}  ${c.date}  ${c.message}`);
});
gitCmd.command("commit [message]").description("Stage everything and commit").action(async (message) => {
  const data = await api("POST", "/git/commit", { message });
  if (data) console.log(data.committed ? `✓ committed ${data.commit}` : `– ${data.reason}`);
});
gitCmd.command("push").description("Push to the configured remote").action(async () => {
  const data = await api("POST", "/git/push", {});
  if (data) console.log(data.pushed ? `✓ pushed to ${data.remote}/${data.branch}` : `✗ ${data.reason}`);
});
gitCmd.command("pull").description("Pull from the configured remote").action(async () => {
  const data = await api("POST", "/git/pull", {});
  if (data) console.log(data.pulled ? "✓ pulled" : `✗ ${data.reason}`);
});
gitCmd.command("remote <url>").description("Set the origin remote URL").action(async (url) => {
  const data = await api("POST", "/git/remote", { url });
  if (data) console.log(`✓ origin -> ${data.url}`);
});

// -- repo ---------------------------------------------------------------------
program.command("repo").description("Show which repo is currently loaded").action(async () => {
  const res = await fetch(`${BASE.replace(/\/api$/, "")}/api/repo`);
  console.log(await res.json());
});
program.command("load-repo <path>").description("Point BlogBuilder at a different repo on disk").action(async (repoPath) => {
  const res = await fetch(`${BASE.replace(/\/api$/, "")}/api/repo/load`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repoPath }),
  });
  console.log(await res.json());
});

program.parseAsync(process.argv);
