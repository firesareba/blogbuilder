"use strict";
/**
 * AI Provider
 * -----------
 * The AI is BYOK: the caller supplies { provider, apiKey } on every request.
 * The server never stores keys. The AI never touches HTML/files directly -
 * for site edits it can ONLY emit a JSON array of builder operations, which
 * the caller must review and apply through the normal builder API (see
 * server/api/routes.js `/ai/apply`). This keeps the AI as "just another
 * client" of the builder engine, same as the GUI and CLI.
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

function buildSitePrompt(elements) {
  const flatten = (nodes, depth = 0) => nodes.flatMap((n) => [
    `${"  ".repeat(depth)}- ${n.id} (${n.tag}${n.kind === "container" ? ", container" : ""}${n.collection ? ", collection:" + n.collection : ""}) ${n.text ? `text="${n.text}"` : ""}`.trim(),
    ...flatten(n.children || [], depth + 1),
  ]);
  return flatten(elements).join("\n");
}

async function generateOperations({ provider, apiKey, model, instruction, elements }) {
  const impl = PROVIDERS[provider];
  if (!impl) throw new Error(`Unknown AI provider "${provider}"`);
  const systemPrompt = `You are the AI copilot inside a website builder. You can ONLY modify the site by emitting builder operations - you never write raw HTML/CSS. Respond with ONLY a JSON array (no prose, no markdown fences) of operations.\n\n${OPERATION_SCHEMA_DOC}`;
  const userPrompt = `Current site elements:\n${buildSitePrompt(elements)}\n\nUser request: ${instruction}\n\nRespond with the JSON array of operations only.`;
  const raw = await impl.chat({
    apiKey, systemPrompt, userPrompt, model,
  });
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
  if (!impl) throw new Error(`Unknown AI provider "${provider}"`);
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
  const result = await impl.chat({
    apiKey, systemPrompt, userPrompt, model,
  });
  return result.trim();
}

module.exports = { generateOperations, articleAssist, PROVIDERS };
