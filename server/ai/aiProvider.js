"use strict";
/**
 * AI Provider
 * -----------
 * The AI is BYOK: the caller supplies { provider, apiKey } on every request,
 * falling back to server-saved keys when present. The AI never touches
 * HTML/files directly - for site edits it can ONLY emit a JSON array of
 * builder operations, which the caller must review and apply through the
 * normal builder API (see server/api/routes.js `/ai/apply`). This keeps the
 * AI as "just another client" of the builder engine, same as the GUI/CLI.
 */

const anthropic = require("./providers/anthropic");
const openai = require("./providers/openai");
const google = require("./providers/google");

const PROVIDERS = { anthropic, openai, google };

const OPERATION_SCHEMA_DOC = `
Valid operations (respond with a JSON array containing ONLY these shapes):
[
  {"op":"update_text","id":"<element-id>","value":"<new text>"},
  {"op":"update_image","id":"<element-id>","src":"<url>","alt":"<text>"},
  {"op":"update_link","id":"<element-id>","href":"<url>"},
  {"op":"update_style","id":"<element-id>","style":{"color":"#000","fontSize":"18px", "...": "..."}},
  {"op":"move","id":"<element-id>","dx":10,"dy":-4},
  {"op":"resize","id":"<element-id>","widthPct":110,"heightPct":110},
  {"op":"set_visibility","id":"<element-id>","visible":false},
  {"op":"create_element","type":"button|text|heading|image|link|container","parent":"<container-id or null>","text":"...","href":"...","src":"...","alt":"..."},
  {"op":"delete_element","id":"<element-id>"},
  {"op":"duplicate_element","id":"<element-id>"},
  {"op":"reorder_element","id":"<element-id>","direction":"up|down"}
]
Only reference element ids that actually exist in the provided site map. Never invent HTML or CSS outside of the "style" object's known keys.
`.trim();

const BUILDER_GUIDE = `
HOW BLOGBUILDER WORKS (read carefully - your operations must respect this):

Repo layout (git is the database - every change is a plain file edit):
  theme/index.html      the theme. Editable regions carry data-builder-id="...".
                        You NEVER edit this file; overrides do that job.
  theme/theme.css       theme stylesheet. Only changeable via update_style ops.
  content/config.json   site title + collections, e.g. posts live in content/posts.
  content/overrides.json every builder edit lands here (text/style/visibility,
                        added elements). This is what your ops actually write.
  content/posts/*.md    blog posts: YAML frontmatter + markdown body.
  assets/               uploaded images, served at /assets/<file>.

Theme anatomy:
  - data-builder-id marks every editable element. Reference these ids exactly.
  - data-builder-locked="true" elements (header/nav/footer) cannot be deleted
    or reordered. Do not emit delete/reorder ops for them.
  - data-builder-collection="posts" containers are AUTO-POPULATED from published
    posts at render time. Never create content inside them manually.

Blog model:
  - Posts have slug/title/author/date/tags/featuredImage/published/excerpt/body.
  - Only published posts appear in collection containers and in docs/ output.
  - You cannot create/edit posts with ops - only theme elements. If the user
    asks for post changes, emit NO ops (empty array) - the UI explains it.

CLI equivalent (the GUI, CLI and you all drive the same REST API):
  blog elements                       list the element tree (ids/tags/text)
  blog set-text <id> <value>          update_text
  blog set-image <id> <src> [alt]     update_image
  blog set-link <id> <href>           update_link
  blog move <id> --dx <px> --dy <px>  move
  blog publish                        render docs/ + commit + push

Workflow truths:
  - The preview iframe (/api/preview) renders theme + overrides live; edits
    appear without publishing.
  - Publishing renders docs/ (GitHub Pages serves root or /docs only),
    commits, and pushes. Remind the user to hit Publish for changes to go live.
  - Prefer a few precise ops over many speculative ones. If an id from the
    request doesn't exist in the site map, skip it rather than guessing.

Response rules:
  - Output ONLY the JSON array. No prose, no markdown fences, no commentary.
  - An empty array [] is valid when nothing in the request maps to real elements.
`.trim();

function buildSitePrompt(elements) {
  const flatten = (nodes, depth = 0) => nodes.flatMap((n) => [
    `${"  ".repeat(depth)}- ${n.id} (${n.tag}${n.kind === "container" ? ", container" : ""}${n.collection ? ", collection:" + n.collection : ""}) ${n.text ? `text="${n.text}"` : ""}`.trim(),
    ...flatten(n.children || [], depth + 1),
  ]);
  return flatten(elements).join("\n");
}

async function generateOperations({ provider, apiKey, model, instruction, elements, site }) {
  const impl = PROVIDERS[provider];
  if (!impl || typeof impl.chat !== "function") throw new Error(`Unknown AI provider "${provider}"`);
  const systemPrompt = `You are the AI copilot inside BlogBuilder, a git-native visual website builder. You can ONLY modify the site by emitting builder operations - you never write raw HTML/CSS. Respond with ONLY a JSON array (no prose, no markdown fences) of operations.\n\n${BUILDER_GUIDE}\n\n${OPERATION_SCHEMA_DOC}`;
  const siteBlock = site
    ? `Site: "${site.title || "untitled"}" - ${site.postCount || 0} posts (${site.publishedCount || 0} published).\nPublished posts:\n${(site.posts || []).map((p) => `- ${p.slug}: "${p.title}"`).join("\n") || "(none)"}\n\n`
    : "";
  const userPrompt = `${siteBlock}Current site elements:\n${buildSitePrompt(elements)}\n\nUser request: ${instruction}\n\nRespond with the JSON array of operations only.`;
  let raw;
  try {
    raw = await impl.chat({ apiKey, systemPrompt, userPrompt, model });
  } catch (e) {
    throw withContext(provider, model, e);
  }
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  let ops;
  try {
    ops = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`AI response was not valid JSON operations: ${e.message}\n---\n${raw}`);
  }
  if (!Array.isArray(ops)) throw new Error("AI response must be a JSON array of operations");
  return ops;
}

async function articleAssist({
  provider, apiKey, model, action, text, context,
}) {
  const impl = PROVIDERS[provider];
  if (!impl || typeof impl.chat !== "function") throw new Error(`Unknown AI provider "${provider}"`);
  const instructions = {
    continue: "Continue writing from where the text leaves off, matching its tone and style. Return only the new text to append.",
    rewrite: "Rewrite the given text to be clearer and more engaging, preserving meaning. Return only the rewritten text.",
    shorten: "Shorten the given text while preserving its key meaning. Return only the shortened text.",
    expand: "Expand the given text with more detail and examples. Return only the expanded text.",
    fix_grammar: "Fix grammar and spelling in the given text without changing its meaning or tone. Return only the corrected text.",
    change_tone: "Rewrite the given text in a more engaging, polished tone. Return only the rewritten text.",
    brainstorm: "Brainstorm 5 blog post ideas related to the given topic/context. Return a short bulleted list.",
    generate_outline: "Generate a clear outline (headings + bullet points) for a blog post about the given topic. Return only the outline.",
    generate_title: "Suggest 5 compelling blog post titles for the given content/topic. Return a short numbered list.",
  };
  const instruction = instructions[action];
  if (!instruction) throw new Error(`Unknown article assist action "${action}"`);
  const systemPrompt = "You are a writing assistant embedded in a blog editor. Follow the instruction exactly and return ONLY the requested text with no preamble, no explanation, and no markdown fences.";
  const userPrompt = `Instruction: ${instruction}\n\nContext: ${context || "(none)"}\n\nText:\n${text || "(empty)"}`;
  let result;
  try {
    result = await impl.chat({ apiKey, systemPrompt, userPrompt, model });
  } catch (e) {
    throw withContext(provider, model, e);
  }
  return result.trim();
}

const MODEL_HINTS = {
  anthropic: "e.g. claude-sonnet-4-6",
  openai: "e.g. gpt-4o-mini",
  google: "e.g. gemma-4-31b-it or gemini-2.5-flash",
};

function withContext(provider, model, err) {
  const msg = (err && err.message) || String(err);
  let hint = "";
  if (/not.?found|invalid.*model|does not exist/i.test(msg)) {
    hint = ` Check the model name (${MODEL_HINTS[provider] || "see provider docs"}).`;
  } else if (/invalid.*key|unauthorized|authentication|401/i.test(msg)) {
    hint = " The API key was rejected - check Settings (a bad browser key overrides the server key).";
  }
  const e = new Error(`[${provider}${model ? "/" + model : ""}] ${msg}.${hint}`);
  e.cause = err;
  return e;
}

function isAuthError(err) {
  return /invalid.*(key|api)|unauthorized|authentication|\b401\b/i.test((err && err.message) || "");
}

function isTransientError(err) {
  return /\b50[0-3]\b|internal error|overloaded|rate.?limit|429|timeout|econnreset|socket hang up/i.test((err && err.message) || "");
}

module.exports = { generateOperations, articleAssist, PROVIDERS, isAuthError, isTransientError };
