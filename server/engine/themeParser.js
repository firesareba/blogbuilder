"use strict";
/**
 * Theme Parser
 * -------------
 * Reads a theme HTML file and builds an internal representation of every
 * "builder element" - any DOM node carrying a `data-builder-id` attribute.
 *
 * This is intentionally NOT a general-purpose HTML-to-JSON converter. It only
 * understands the builder's own metadata vocabulary:
 *
 *   data-builder-id        stable, human-readable identifier (required)
 *   data-builder-locked    "true" -> element cannot be deleted/reordered
 *   data-builder-collection "posts" -> this container is auto-populated from
 *                           a named content collection at render/publish time
 *
 * Text-bearing tags expose editable `text`. <img> exposes `src`/`alt`.
 * <a>/<button> with an href expose `href`. Everything exposes `style`.
 */

const { JSDOM } = require("jsdom");

const TEXT_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "button",
  "a", "li", "blockquote", "figcaption", "label", "strong", "em",
]);

const CONTAINER_TAGS = new Set([
  "section", "div", "header", "footer", "nav", "ul", "ol",
  "article", "main", "aside", "figure", "form",
]);

const VOID_LIKE = new Set(["img"]);

const STYLE_KEYS = [
  "color", "backgroundColor", "fontSize", "fontWeight", "fontFamily",
  "textAlign", "padding", "margin", "width", "height", "maxWidth",
  "borderRadius", "borderWidth", "borderColor", "borderStyle",
  "transform", "display", "opacity", "objectFit",
];

function classify(tag) {
  if (tag === "img") return "image";
  if (tag === "a") return "link";
  if (TEXT_TAGS.has(tag)) return "text";
  if (CONTAINER_TAGS.has(tag)) return "container";
  return "generic";
}

/**
 * Parse raw theme HTML into a flat map of builder nodes + a tree of
 * top-level ids. Does not apply any overrides - this is the "base" theme
 * state as authored by the theme designer.
 */
function parseTheme(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const all = Array.from(doc.querySelectorAll("[data-builder-id]"));

  const seen = new Set();
  const nodes = {};
  const topLevel = [];

  for (const el of all) {
    const id = el.getAttribute("data-builder-id");
    if (!id) continue;
    if (seen.has(id)) {
      throw new Error(`Duplicate data-builder-id "${id}" found in theme`);
    }
    seen.add(id);

    const tag = el.tagName.toLowerCase();
    const kind = classify(tag);

    // Find nearest ancestor that is itself a builder element.
    let parent = el.parentElement;
    let parentId = null;
    while (parent) {
      if (parent.getAttribute && parent.getAttribute("data-builder-id")) {
        parentId = parent.getAttribute("data-builder-id");
        break;
      }
      parent = parent.parentElement;
    }

    const style = {};
    for (const key of STYLE_KEYS) {
      const cssKey = key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      const val = el.style ? el.style.getPropertyValue(cssKey) : "";
      if (val) style[key] = val;
    }

    nodes[id] = {
      id,
      tag,
      kind, // text | image | link | container | generic
      parentId,
      children: [], // filled below, in document order
      locked: el.getAttribute("data-builder-locked") === "true",
      collection: el.getAttribute("data-builder-collection") || null,
      text: kind === "text" && !VOID_LIKE.has(tag) ? el.textContent.trim() : undefined,
      src: tag === "img" ? el.getAttribute("src") || "" : undefined,
      alt: tag === "img" ? el.getAttribute("alt") || "" : undefined,
      href: tag === "a" ? el.getAttribute("href") || "" : undefined,
      style,
      className: el.getAttribute("class") || "",
    };

    if (parentId) {
      // deferred: attach after all nodes discovered, preserving doc order
    } else {
      topLevel.push(id);
    }
  }

  // second pass to build children arrays in document order
  for (const el of all) {
    const id = el.getAttribute("data-builder-id");
    const node = nodes[id];
    if (node.parentId) {
      nodes[node.parentId].children.push(id);
    }
  }

  return { nodes, topLevel };
}

module.exports = { parseTheme, classify, STYLE_KEYS, TEXT_TAGS, CONTAINER_TAGS };
