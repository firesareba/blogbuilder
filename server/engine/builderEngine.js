"use strict";
/**
 * Builder Engine
 * --------------
 * The ONE place where site mutations happen. The HTTP API is a thin wrapper
 * around these functions; the CLI talks to the HTTP API; the AI copilot
 * produces operations in this same shape and they are executed through this
 * same engine. Nothing else is allowed to write to overrides.json or the
 * posts directory directly.
 */

const fs = require("fs");
const path = require("path");
const { nanoid } = require("nanoid");
const {
  loadSite, saveOverrides, postsDir, slugify,
} = require("./siteModel");
const { classify, STYLE_KEYS } = require("./themeParser");

const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

class BuilderError extends Error {
  constructor(message, code = "BUILDER_ERROR") {
    super(message);
    this.code = code;
  }
}

function assertValidNewId(site, id) {
  if (!ID_RE.test(id)) {
    throw new BuilderError(
      `Invalid element id "${id}". Use lowercase letters, numbers and hyphens (2-64 chars).`,
      "INVALID_ID",
    );
  }
  if (site.effective[id]) {
    throw new BuilderError(`Element id "${id}" already exists.`, "DUPLICATE_ID");
  }
}

function getNode(site, id) {
  const node = site.effective[id];
  if (!node) throw new BuilderError(`No element with id "${id}"`, "NOT_FOUND");
  return node;
}

function getOverrideEntry(site, id) {
  if (!site.overridesObj.overrides[id]) site.overridesObj.overrides[id] = {};
  return site.overridesObj.overrides[id];
}

function persist(site) {
  saveOverrides(site.repoPath, site.overridesObj);
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

function getElements(repoPath) {
  const site = loadSite(repoPath);
  return site.topLevel.map((id) => serializeTree(site, id));
}

function serializeTree(site, id) {
  const node = site.effective[id];
  return {
    id: node.id,
    tag: node.tag,
    kind: node.kind,
    text: node.text,
    src: node.src,
    alt: node.alt,
    href: node.href,
    style: node.style,
    visible: node.visible,
    locked: node.locked,
    collection: node.collection,
    origin: node.origin,
    children: node.children.map((cid) => serializeTree(site, cid)),
  };
}

function getElement(repoPath, id) {
  const site = loadSite(repoPath);
  return serializeTree(site, id);
}

// ---------------------------------------------------------------------------
// Mutations - style / text / image / link / visibility
// ---------------------------------------------------------------------------

function updateText(repoPath, id, value) {
  const site = loadSite(repoPath);
  const node = getNode(site, id);
  if (node.kind !== "text" && node.kind !== "link") {
    throw new BuilderError(`Element "${id}" (${node.tag}) does not support text edits`, "UNSUPPORTED");
  }
  if (node.origin === "added") {
    const added = site.overridesObj.added.find((a) => a.id === id);
    added.text = value;
  } else {
    getOverrideEntry(site, id).text = value;
  }
  persist(site);
  return getElement(repoPath, id);
}

function updateImage(repoPath, id, { src, alt }) {
  const site = loadSite(repoPath);
  const node = getNode(site, id);
  if (node.kind !== "image") throw new BuilderError(`Element "${id}" is not an image`, "UNSUPPORTED");
  if (node.origin === "added") {
    const added = site.overridesObj.added.find((a) => a.id === id);
    if (src !== undefined) added.src = src;
    if (alt !== undefined) added.alt = alt;
  } else {
    const o = getOverrideEntry(site, id);
    if (src !== undefined) o.src = src;
    if (alt !== undefined) o.alt = alt;
  }
  persist(site);
  return getElement(repoPath, id);
}

function updateLink(repoPath, id, href) {
  const site = loadSite(repoPath);
  const node = getNode(site, id);
  if (node.kind !== "link" && node.tag !== "button") {
    throw new BuilderError(`Element "${id}" does not support links`, "UNSUPPORTED");
  }
  if (node.origin === "added") {
    site.overridesObj.added.find((a) => a.id === id).href = href;
  } else {
    getOverrideEntry(site, id).href = href;
  }
  persist(site);
  return getElement(repoPath, id);
}

function updateStyle(repoPath, id, styleObj) {
  const site = loadSite(repoPath);
  const node = getNode(site, id);
  const clean = {};
  for (const [k, v] of Object.entries(styleObj || {})) {
    if (!STYLE_KEYS.includes(k)) continue;
    clean[k] = v;
  }
  if (node.origin === "added") {
    const added = site.overridesObj.added.find((a) => a.id === id);
    added.style = { ...(added.style || {}), ...clean };
  } else {
    const o = getOverrideEntry(site, id);
    o.style = { ...(o.style || {}), ...clean };
  }
  persist(site);
  return getElement(repoPath, id);
}

function parsePx(val) {
  const n = parseFloat(String(val || "0").replace("px", ""));
  return Number.isFinite(n) ? n : 0;
}

function moveElement(repoPath, id, dx, dy) {
  const site = loadSite(repoPath);
  const node = getNode(site, id);
  const current = node.style.transform || "";
  const m = current.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  const curX = m ? parseFloat(m[1]) : 0;
  const curY = m ? parseFloat(m[2]) : 0;
  const newX = curX + parsePx(dx);
  const newY = curY + parsePx(dy);
  return updateStyle(repoPath, id, { transform: `translate(${newX}px, ${newY}px)` });
}

function resizeElement(repoPath, id, widthPct, heightPct) {
  const site = loadSite(repoPath);
  const node = getNode(site, id);
  // Interpreted relative to current rendered box; since this is a headless
  // engine (no real layout), we track it as a scale transform layered on
  // top of any translate already present - simple and reversible for v1.
  const current = node.style.transform || "";
  const translateMatch = current.match(/translate\([^)]*\)/);
  const translatePart = translateMatch ? translateMatch[0] : "";
  const scaleX = (widthPct || 100) / 100;
  const scaleY = (heightPct || 100) / 100;
  const transform = `${translatePart} scale(${scaleX}, ${scaleY})`.trim();
  return updateStyle(repoPath, id, { transform });
}

function setVisibility(repoPath, id, visible) {
  const site = loadSite(repoPath);
  getNode(site, id);
  if (site.effective[id].origin === "added") {
    site.overridesObj.added.find((a) => a.id === id).style = {
      ...(site.overridesObj.added.find((a) => a.id === id).style || {}),
    };
  }
  getOverrideEntry(site, id).visible = !!visible;
  persist(site);
  return getElement(repoPath, id);
}

// ---------------------------------------------------------------------------
// Structural mutations - create / delete / duplicate / reorder
// ---------------------------------------------------------------------------

const CREATE_DEFAULTS = {
  text: { tag: "p", kind: "text", text: "New text" },
  heading: { tag: "h2", kind: "text", text: "New heading" },
  button: { tag: "button", kind: "text", text: "Click me", href: "#" },
  image: { tag: "img", kind: "image", src: "/assets/placeholder.svg", alt: "Placeholder image" },
  link: { tag: "a", kind: "link", text: "Link text", href: "#" },
  container: { tag: "div", kind: "container" },
};

function createElement(repoPath, { type, id, parent, text, src, alt, href }) {
  const site = loadSite(repoPath);
  const preset = CREATE_DEFAULTS[type];
  if (!preset) {
    throw new BuilderError(`Unknown element type "${type}". Supported: ${Object.keys(CREATE_DEFAULTS).join(", ")}`, "UNKNOWN_TYPE");
  }
  const newId = id || `${type}-${nanoid(6).toLowerCase()}`;
  assertValidNewId(site, newId);
  if (parent && !site.effective[parent]) {
    throw new BuilderError(`Parent element "${parent}" does not exist`, "NOT_FOUND");
  }
  if (parent && site.effective[parent].kind !== "container") {
    throw new BuilderError(`Element "${parent}" is not a container and cannot accept children`, "INVALID_PARENT");
  }
  site.overridesObj.added.push({
    id: newId,
    tag: preset.tag,
    kind: preset.kind,
    parent: parent || null,
    text: text !== undefined ? text : preset.text,
    src: src !== undefined ? src : preset.src,
    alt: alt !== undefined ? alt : preset.alt,
    href: href !== undefined ? href : preset.href,
    style: {},
  });
  persist(site);
  return getElement(repoPath, newId);
}

function deleteElement(repoPath, id) {
  const site = loadSite(repoPath);
  const node = getNode(site, id);
  if (node.locked) throw new BuilderError(`Element "${id}" is locked and cannot be deleted`, "LOCKED");
  if (node.origin === "added") {
    site.overridesObj.added = site.overridesObj.added.filter((a) => a.id !== id);
  } else {
    getOverrideEntry(site, id).deleted = true;
  }
  persist(site);
  return { deleted: id };
}

function duplicateElement(repoPath, id) {
  const site = loadSite(repoPath);
  const node = getNode(site, id);
  let n = 2;
  let newId = `${id}-copy`;
  while (site.effective[newId]) {
    newId = `${id}-copy-${n}`;
    n += 1;
  }
  site.overridesObj.added.push({
    id: newId,
    tag: node.tag,
    kind: node.kind,
    parent: node.parentId,
    text: node.text,
    src: node.src,
    alt: node.alt,
    href: node.href,
    style: { ...node.style },
  });
  persist(site);
  return getElement(repoPath, newId);
}

function reorderElement(repoPath, id, direction) {
  const site = loadSite(repoPath);
  const node = getNode(site, id);
  if (!node.parentId) throw new BuilderError(`Top-level element "${id}" cannot be reordered`, "UNSUPPORTED");
  const parent = getNode(site, node.parentId);
  const order = [...parent.children];
  const idx = order.indexOf(id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= order.length) return getElement(repoPath, node.parentId);
  [order[idx], order[swapWith]] = [order[swapWith], order[idx]];
  getOverrideEntry(site, node.parentId).order = order;
  persist(site);
  return getElement(repoPath, node.parentId);
}

function setElementId(repoPath, oldId, newId) {
  const site = loadSite(repoPath);
  const node = getNode(site, oldId);
  if (node.locked) throw new BuilderError(`Element "${oldId}" is locked`, "LOCKED");
  assertValidNewId(site, newId);
  if (node.origin === "added") {
    const added = site.overridesObj.added.find((a) => a.id === oldId);
    added.id = newId;
    for (const a of site.overridesObj.added) {
      if (a.parent === oldId) a.parent = newId;
    }
  } else {
    throw new BuilderError(
      "Renaming theme-defined elements isn't supported in v1 - only elements you added through the builder can be renamed.",
      "UNSUPPORTED",
    );
  }
  persist(site);
  return getElement(repoPath, newId);
}

module.exports = {
  BuilderError,
  getElements,
  getElement,
  updateText,
  updateImage,
  updateLink,
  updateStyle,
  moveElement,
  resizeElement,
  setVisibility,
  createElement,
  deleteElement,
  duplicateElement,
  reorderElement,
  setElementId,
};
