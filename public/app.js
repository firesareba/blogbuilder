"use strict";

// ---------------------------------------------------------------------------
// tiny API client
// ---------------------------------------------------------------------------
async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = "/"; throw new Error("Signed out - please sign in"); }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(message, isError) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast" + (isError ? " error" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = "toast hidden"; }, 3200);
}

// ---------------------------------------------------------------------------
// settings (BYOK key lives only in localStorage)
// ---------------------------------------------------------------------------
const Settings = {
  get provider() { return localStorage.getItem("bb_ai_provider") || "anthropic"; },
  get model() { return localStorage.getItem("bb_ai_model") || ""; },
  get apiKey() { return localStorage.getItem("bb_ai_apiKey") || ""; },
  save({ provider, model, apiKey }) {
    localStorage.setItem("bb_ai_provider", provider);
    localStorage.setItem("bb_ai_model", model || "");
    localStorage.setItem("bb_ai_apiKey", apiKey || "");
  },
};

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------
function initTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}
function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== `panel-${name}`));
  if (name === "posts" && !PostsState.loaded) loadPosts();
  if (name === "media") loadMedia();
  if (name === "git") loadGit();
  if (name === "settings") loadSettingsIntoForm();
}

// ---------------------------------------------------------------------------
// status pill (top bar) - lightweight git summary, refreshed periodically
// ---------------------------------------------------------------------------
async function refreshStatusPill() {
  try {
    const s = await api("GET", "/git/status");
    const dirty = s.modified.length + s.created.length + s.deleted.length + s.not_added.length;
    document.getElementById("statusPill").textContent = dirty === 0
      ? "saved · clean working tree"
      : `unsaved changes · ${dirty} file(s)`;
  } catch {
    document.getElementById("statusPill").textContent = "git unavailable";
  }
}

// ===========================================================================
// BUILDER TAB - element tree + canvas + inspector
// ===========================================================================
const BuilderState = { elements: [], selectedId: null };

async function loadElements() {
  BuilderState.elements = await api("GET", "/elements");
  renderElementTree();
}

function renderElementTree() {
  const root = document.getElementById("elementTree");
  root.innerHTML = "";
  const build = (nodes) => {
    const ul = document.createElement("div");
    for (const n of nodes) {
      const row = document.createElement("div");
      row.className = "tree-node";
      const rowInner = document.createElement("div");
      rowInner.className = "tree-row" + (n.id === BuilderState.selectedId ? " selected" : "");
      rowInner.innerHTML = `<span>${n.locked ? "🔒 " : ""}${n.id}</span><span class="tag">${n.tag}</span>`;
      rowInner.addEventListener("click", () => selectElement(n.id));
      row.appendChild(rowInner);
      if (n.children && n.children.length) {
        const childWrap = document.createElement("div");
        childWrap.className = "tree-children";
        childWrap.appendChild(build(n.children));
        row.appendChild(childWrap);
      }
      ul.appendChild(row);
    }
    return ul;
  };
  root.appendChild(build(BuilderState.elements));
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children || [], id);
    if (found) return found;
  }
  return null;
}
function flatContainers(nodes, acc = []) {
  for (const n of nodes) {
    if (n.kind === "container") acc.push(n);
    flatContainers(n.children || [], acc);
  }
  return acc;
}

// -- canvas / iframe bridge -------------------------------------------------
function initCanvas() {
  const frame = document.getElementById("previewFrame");
  frame.addEventListener("load", () => wireCanvasClicks(frame));

  document.querySelectorAll(".vp-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".vp-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("canvasFrameWrap").className =
        "canvas-frame-wrap" + (btn.dataset.vp === "mobile" ? " mobile" : "");
    });
  });
}

function wireCanvasClicks(frame) {
  let doc;
  try { doc = frame.contentDocument; } catch { return; }
  if (!doc) return;

  // Prevent navigation inside the editor canvas.
  doc.querySelectorAll("a, button").forEach((el) => {
    el.addEventListener("click", (e) => e.preventDefault());
  });

  const style = doc.createElement("style");
  style.textContent = `
    [data-builder-id] { outline-offset: 2px; cursor: pointer; }
    [data-builder-id].bb-hover { outline: 2px dashed #263A52; }
    [data-builder-id].bb-selected { outline: 2px solid #A3323B; }
  `;
  doc.head.appendChild(style);

  doc.querySelectorAll("[data-builder-id]").forEach((el) => {
    el.addEventListener("mouseenter", () => el.classList.add("bb-hover"));
    el.addEventListener("mouseleave", () => el.classList.remove("bb-hover"));
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      selectElement(el.getAttribute("data-builder-id"));
    });
  });
  highlightSelectedInCanvas();
}

function highlightSelectedInCanvas() {
  const frame = document.getElementById("previewFrame");
  let doc;
  try { doc = frame.contentDocument; } catch { return; }
  if (!doc) return;
  doc.querySelectorAll(".bb-selected").forEach((el) => el.classList.remove("bb-selected"));
  if (BuilderState.selectedId) {
    const el = doc.querySelector(`[data-builder-id="${cssEscape(BuilderState.selectedId)}"]`);
    if (el) el.classList.add("bb-selected");
  }
}

function cssEscape(id) { return id.replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }

function reloadCanvas() {
  const frame = document.getElementById("previewFrame");
  const src = frame.getAttribute("src").split("?")[0];
  frame.setAttribute("src", `${src}?t=${Date.now()}`);
}

async function selectElement(id) {
  BuilderState.selectedId = id;
  renderElementTree();
  highlightSelectedInCanvas();
  try {
    const node = await api("GET", `/elements/${encodeURIComponent(id)}`);
    renderInspector(node);
  } catch (e) {
    toast(e.message, true);
  }
}

// -- inspector ----------------------------------------------------------
function renderInspector(node) {
  const body = document.getElementById("inspectorBody");
  const style = node.style || {};
  body.innerHTML = "";

  const header = document.createElement("div");
  header.innerHTML = `<div class="field"><label>ID</label>
    <input type="text" id="insp-id" value="${escapeAttr(node.id)}" ${node.origin === "theme" ? "disabled" : ""}></div>
    <p class="muted small">${node.tag} · ${node.kind}${node.collection ? " · auto-populated from posts" : ""}</p>`;
  body.appendChild(header);

  if (node.locked) {
    const note = document.createElement("p");
    note.className = "locked-note";
    note.textContent = "This element is locked by the theme and can't be deleted or reordered.";
    body.appendChild(note);
  }

  if (node.collection) {
    const note = document.createElement("p");
    note.className = "locked-note";
    note.textContent = `This container is auto-populated from the "${node.collection}" collection - its contents come from your published posts, not manual edits.`;
    body.appendChild(note);
  }

  if (node.kind === "text" || (node.kind === "link" && node.tag !== "img")) {
    body.appendChild(fieldTextarea("Text", node.text || "", (v) => runOp(() => api("POST", `/elements/${node.id}/text`, { value: v }))));
  }
  if (node.kind === "image") {
    body.appendChild(fieldInput("Image URL", node.src || "", (v) => runOp(() => api("POST", `/elements/${node.id}/image`, { src: v }))));
    body.appendChild(fieldInput("Alt text", node.alt || "", (v) => runOp(() => api("POST", `/elements/${node.id}/image`, { alt: v }))));
    const browseBtn = document.createElement("button");
    browseBtn.className = "btn btn-xs";
    browseBtn.textContent = "Browse media library";
    browseBtn.style.marginTop = "-6px";
    browseBtn.addEventListener("click", async () => {
      const items = await api("GET", "/media");
      if (!items.length) return toast("No media uploaded yet - use the Media tab.");
      const url = prompt(`Paste one of these URLs:\n${items.map((m) => m.url).join("\n")}`, items[0].url);
      if (url) runOp(() => api("POST", `/elements/${node.id}/image`, { src: url }));
    });
    body.appendChild(browseBtn);
  }
  if (node.kind === "link" || node.tag === "button") {
    body.appendChild(fieldInput("Link (href)", node.href || "", (v) => runOp(() => api("POST", `/elements/${node.id}/link`, { href: v }))));
  }

  // style controls
  const styleTitle = document.createElement("div");
  styleTitle.className = "inspector-section-title";
  styleTitle.textContent = "Style";
  body.appendChild(styleTitle);

  body.appendChild(styleRow([
    ["Color", "color", style.color || "#000000", "color"],
    ["Background", "backgroundColor", style.backgroundColor || "#ffffff", "color"],
  ], node.id));

  body.appendChild(fieldInput("Font size (e.g. 18px)", style.fontSize || "", (v) => runOp(() => api("POST", `/elements/${node.id}/style`, { fontSize: v }))));
  body.appendChild(fieldSelect("Text align", style.textAlign || "", ["", "left", "center", "right"], (v) => runOp(() => api("POST", `/elements/${node.id}/style`, { textAlign: v }))));
  body.appendChild(fieldInput("Padding (e.g. 12px)", style.padding || "", (v) => runOp(() => api("POST", `/elements/${node.id}/style`, { padding: v }))));
  body.appendChild(fieldInput("Margin (e.g. 12px)", style.margin || "", (v) => runOp(() => api("POST", `/elements/${node.id}/style`, { margin: v }))));
  body.appendChild(fieldInput("Width (e.g. 200px / 50%)", style.width || "", (v) => runOp(() => api("POST", `/elements/${node.id}/style`, { width: v }))));
  body.appendChild(fieldInput("Border radius", style.borderRadius || "", (v) => runOp(() => api("POST", `/elements/${node.id}/style`, { borderRadius: v }))));

  // position / size
  const posTitle = document.createElement("div");
  posTitle.className = "inspector-section-title";
  posTitle.textContent = "Position & size";
  body.appendChild(posTitle);
  const moveRow = document.createElement("div");
  moveRow.className = "field-row";
  moveRow.appendChild(numberFieldWithButton("Move X (px)", (v) => runOp(() => api("POST", `/elements/${node.id}/move`, { dx: v, dy: 0 }))));
  moveRow.appendChild(numberFieldWithButton("Move Y (px)", (v) => runOp(() => api("POST", `/elements/${node.id}/move`, { dx: 0, dy: v }))));
  body.appendChild(moveRow);
  const resizeRow = document.createElement("div");
  resizeRow.className = "field-row";
  resizeRow.appendChild(numberFieldWithButton("Width %", (v) => runOp(() => api("POST", `/elements/${node.id}/resize`, { widthPct: v, heightPct: 100 })), 100));
  resizeRow.appendChild(numberFieldWithButton("Height %", (v) => runOp(() => api("POST", `/elements/${node.id}/resize`, { widthPct: 100, heightPct: v })), 100));
  body.appendChild(resizeRow);

  // actions
  const actionsTitle = document.createElement("div");
  actionsTitle.className = "inspector-section-title";
  actionsTitle.textContent = "Actions";
  body.appendChild(actionsTitle);
  const actions = document.createElement("div");
  actions.className = "inspector-actions";

  const visBtn = document.createElement("button");
  visBtn.className = "btn btn-xs";
  visBtn.textContent = node.visible === false ? "Show" : "Hide";
  visBtn.addEventListener("click", () => runOp(() => api("POST", `/elements/${node.id}/visibility`, { visible: node.visible === false })));
  actions.appendChild(visBtn);

  const dupBtn = document.createElement("button");
  dupBtn.className = "btn btn-xs";
  dupBtn.textContent = "Duplicate";
  dupBtn.addEventListener("click", () => runOp(() => api("POST", `/elements/${node.id}/duplicate`)));
  actions.appendChild(dupBtn);

  if (node.parentId !== undefined || true) {
    const upBtn = document.createElement("button");
    upBtn.className = "btn btn-xs";
    upBtn.textContent = "Move up ↑";
    upBtn.disabled = !!node.locked;
    upBtn.addEventListener("click", () => runOp(() => api("POST", `/elements/${node.id}/reorder`, { direction: "up" })));
    actions.appendChild(upBtn);

    const downBtn = document.createElement("button");
    downBtn.className = "btn btn-xs";
    downBtn.textContent = "Move down ↓";
    downBtn.disabled = !!node.locked;
    downBtn.addEventListener("click", () => runOp(() => api("POST", `/elements/${node.id}/reorder`, { direction: "down" })));
    actions.appendChild(downBtn);
  }

  if (!node.locked) {
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-xs";
    delBtn.style.color = "#A3323B";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => {
      if (confirm(`Delete "${node.id}"?`)) runOp(() => api("DELETE", `/elements/${node.id}`));
    });
    actions.appendChild(delBtn);
  }
  body.appendChild(actions);
}

function styleRow(items, id) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = items.map((i) => i[0]).join(" / ");
  wrap.appendChild(label);
  const row = document.createElement("div");
  row.className = "swatch-row";
  for (const [, key, value] of items) {
    const input = document.createElement("input");
    input.type = "color";
    input.value = /^#/.test(value) ? value : "#000000";
    input.addEventListener("change", () => runOp(() => api("POST", `/elements/${id}/style`, { [key]: input.value })));
    row.appendChild(input);
  }
  wrap.appendChild(row);
  return wrap;
}

function fieldInput(label, value, onCommit) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  wrap.innerHTML = `<label>${label}</label>`;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.addEventListener("change", () => onCommit(input.value));
  wrap.appendChild(input);
  return wrap;
}
function fieldTextarea(label, value, onCommit) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  wrap.innerHTML = `<label>${label}</label>`;
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.addEventListener("change", () => onCommit(ta.value));
  wrap.appendChild(ta);
  return wrap;
}
function fieldSelect(label, value, options, onCommit) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  wrap.innerHTML = `<label>${label}</label>`;
  const sel = document.createElement("select");
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o; opt.textContent = o || "(default)";
    if (o === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => onCommit(sel.value));
  wrap.appendChild(sel);
  return wrap;
}
function numberFieldWithButton(label, onApply, placeholder) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  wrap.innerHTML = `<label>${label}</label>`;
  const row = document.createElement("div");
  row.style.display = "flex"; row.style.gap = "4px";
  const input = document.createElement("input");
  input.type = "number";
  if (placeholder) input.placeholder = String(placeholder);
  const btn = document.createElement("button");
  btn.className = "btn btn-xs";
  btn.textContent = "Apply";
  btn.addEventListener("click", () => onApply(Number(input.value || 0)));
  row.appendChild(input); row.appendChild(btn);
  wrap.appendChild(row);
  return wrap;
}

async function runOp(fn) {
  try {
    await fn();
    await loadElements();
    reloadCanvas();
    if (BuilderState.selectedId) {
      const node = await api("GET", `/elements/${encodeURIComponent(BuilderState.selectedId)}`).catch(() => null);
      if (node) renderInspector(node);
    }
    refreshStatusPill();
    toast("Saved");
  } catch (e) {
    toast(e.message, true);
  }
}

// -- add element --------------------------------------------------------
function initAddElement() {
  document.getElementById("addElementBtn").addEventListener("click", async () => {
    const type = prompt("Element type: text, heading, button, image, link, container", "text");
    if (!type) return;
    const containers = flatContainers(BuilderState.elements);
    let parent = null;
    if (containers.length) {
      parent = prompt(`Parent container id (blank = top level):\n${containers.map((c) => c.id).join(", ")}`, "") || null;
    }
    const text = ["text", "heading", "button", "link"].includes(type) ? prompt("Initial text", "New element") : undefined;
    try {
      await api("POST", "/elements", { type, parent, text });
      await loadElements();
      reloadCanvas();
      toast("Element added");
    } catch (e) {
      toast(e.message, true);
    }
  });
}

// ===========================================================================
// POSTS TAB
// ===========================================================================
const PostsState = { loaded: false, posts: [], currentSlug: null };

async function loadPosts() {
  PostsState.posts = await api("GET", "/posts");
  PostsState.loaded = true;
  renderPostsList();
}
function renderPostsList() {
  const list = document.getElementById("postsList");
  list.innerHTML = "";
  for (const p of PostsState.posts) {
    const row = document.createElement("div");
    row.className = "post-row" + (p.slug === PostsState.currentSlug ? " selected" : "");
    row.innerHTML = `<div class="title"><span class="pub-dot ${p.published ? "on" : "off"}"></span>${escapeHtml(p.title)}</div>
      <div class="meta">${p.date || ""} ${p.slug}</div>`;
    row.addEventListener("click", () => openPost(p.slug));
    list.appendChild(row);
  }
}

async function openPost(slug) {
  PostsState.currentSlug = slug;
  renderPostsList();
  const post = await api("GET", `/posts/${encodeURIComponent(slug)}`);
  const { html } = await api("POST", "/markdown/to-html", { markdown: post.body || "" });
  renderPostEditor(post, html);
}

function renderPostEditor(post, bodyHtml) {
  const root = document.getElementById("postEditor");
  root.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "post-meta-grid";
  grid.appendChild(labeledInput("Slug", post.slug, "meta-slug"));
  grid.appendChild(labeledInput("Author", post.author, "meta-author"));
  grid.appendChild(labeledInput("Date", post.date, "meta-date"));
  grid.appendChild(labeledInput("Tags (comma separated)", (post.tags || []).join(", "), "meta-tags"));
  grid.appendChild(labeledInput("Featured image URL", post.featuredImage, "meta-image"));
  const pubWrap = document.createElement("div");
  pubWrap.className = "field";
  pubWrap.innerHTML = `<label>Published</label>`;
  const pubToggle = document.createElement("button");
  pubToggle.className = "btn btn-xs";
  pubToggle.id = "meta-published-btn";
  pubToggle.textContent = post.published ? "Published (click to unpublish)" : "Draft (click to publish)";
  pubToggle.dataset.published = String(post.published);
  pubToggle.addEventListener("click", async () => {
    const nowPublished = pubToggle.dataset.published === "true";
    await api("POST", `/posts/${encodeURIComponent(post.slug)}/${nowPublished ? "unpublish" : "publish"}`);
    pubToggle.dataset.published = String(!nowPublished);
    pubToggle.textContent = !nowPublished ? "Published (click to unpublish)" : "Draft (click to publish)";
    await loadPosts();
    toast(!nowPublished ? "Published" : "Unpublished");
  });
  pubWrap.appendChild(pubToggle);
  grid.appendChild(pubWrap);
  root.appendChild(grid);

  const titleInput = document.createElement("input");
  titleInput.className = "post-title-input";
  titleInput.value = post.title;
  titleInput.id = "meta-title";
  root.appendChild(titleInput);

  const toolbar = buildRichTextToolbar();
  root.appendChild(toolbar);

  const editable = document.createElement("div");
  editable.className = "post-body-editable";
  editable.contentEditable = "true";
  editable.id = "postBody";
  editable.innerHTML = bodyHtml || "<p><br></p>";
  root.appendChild(editable);

  const aiRow = document.createElement("div");
  aiRow.className = "ai-inline-actions";
  const aiActions = [
    ["Continue writing", "continue"], ["Rewrite", "rewrite"], ["Shorten", "shorten"],
    ["Expand", "expand"], ["Fix grammar", "fix_grammar"], ["Change tone", "change_tone"],
    ["Brainstorm ideas", "brainstorm"], ["Generate outline", "generate_outline"], ["Suggest titles", "generate_title"],
  ];
  for (const [label, action] of aiActions) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.addEventListener("click", () => runArticleAssist(action, editable, titleInput));
    aiRow.appendChild(btn);
  }
  root.appendChild(aiRow);

  const footer = document.createElement("div");
  footer.className = "post-footer-actions";
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-primary btn-sm";
  saveBtn.textContent = "Save post";
  saveBtn.addEventListener("click", () => savePost(post.slug));
  const delBtn = document.createElement("button");
  delBtn.className = "btn btn-ghost btn-sm";
  delBtn.textContent = "Delete post";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`Delete "${post.slug}"?`)) return;
    await api("DELETE", `/posts/${encodeURIComponent(post.slug)}`);
    PostsState.currentSlug = null;
    document.getElementById("postEditor").innerHTML = '<p class="muted center-empty">Select a post, or create a new one.</p>';
    await loadPosts();
    toast("Deleted");
  });
  footer.appendChild(saveBtn);
  footer.appendChild(delBtn);
  root.appendChild(footer);
}

function labeledInput(label, value, id) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  wrap.innerHTML = `<label>${label}</label>`;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.id = id;
  wrap.appendChild(input);
  return wrap;
}

function buildRichTextToolbar() {
  const bar = document.createElement("div");
  bar.className = "post-toolbar";
  const buttons = [
    ["B", () => exec("bold")], ["I", () => exec("italic")], ["U", () => exec("underline")],
    ["H1", () => exec("formatBlock", "H1")], ["H2", () => exec("formatBlock", "H2")],
    ["¶", () => exec("formatBlock", "P")], ["“ ”", () => exec("formatBlock", "BLOCKQUOTE")],
    ["• list", () => exec("insertUnorderedList")], ["1. list", () => exec("insertOrderedList")],
    ["</>", () => exec("formatBlock", "PRE")], ["link", insertLink],
    ["↺", () => exec("undo")], ["↻", () => exec("redo")],
  ];
  for (const [label, fn] of buttons) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep selection
    btn.addEventListener("click", fn);
    bar.appendChild(btn);
  }
  return bar;
}
function exec(cmd, val) { document.getElementById("postBody").focus(); document.execCommand(cmd, false, val); }
function insertLink() {
  const url = prompt("Link URL");
  if (url) exec("createLink", url);
}

async function runArticleAssist(action, editable, titleInput) {
  const selection = window.getSelection();
  const selectedText = selection && !selection.isCollapsed && editable.contains(selection.anchorNode)
    ? selection.toString() : "";
  const fullText = editable.innerText;
  try {
    toast("Asking AI…");
    const result = await api("POST", "/ai/article-assist", {
      provider: Settings.provider, apiKey: Settings.apiKey, model: Settings.model || undefined,
      action, text: selectedText || fullText, context: titleInput.value,
    });
    const value = typeof result === "string" ? result : (result.result || JSON.stringify(result));
    if (selectedText) {
      document.execCommand("insertText", false, value);
    } else if (action === "continue") {
      editable.innerHTML += `<p>${escapeHtml(value)}</p>`;
    } else {
      if (confirm("Replace the whole post body with the AI's result?")) {
        editable.innerHTML = `<p>${escapeHtml(value).replace(/\n\n/g, "</p><p>")}</p>`;
      } else {
        alert(value);
      }
    }
    toast("Done");
  } catch (e) {
    toast(e.message, true);
  }
}

async function savePost(slug) {
  const html = document.getElementById("postBody").innerHTML;
  const markdown = htmlToMarkdown(html);
  const patch = {
    title: document.getElementById("meta-title").value,
    slug: document.getElementById("meta-slug").value,
    author: document.getElementById("meta-author").value,
    date: document.getElementById("meta-date").value,
    tags: document.getElementById("meta-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
    featuredImage: document.getElementById("meta-image").value,
    body: markdown,
  };
  try {
    const updated = await api("PUT", `/posts/${encodeURIComponent(slug)}`, patch);
    PostsState.currentSlug = updated.slug;
    await loadPosts();
    toast("Post saved");
  } catch (e) {
    toast(e.message, true);
  }
}

function initNewPost() {
  document.getElementById("newPostBtn").addEventListener("click", async () => {
    const title = prompt("Post title", "Untitled post");
    if (!title) return;
    try {
      const post = await api("POST", "/posts", { title });
      await loadPosts();
      openPost(post.slug);
      toast("Draft created");
    } catch (e) {
      toast(e.message, true);
    }
  });
}

// -- minimal HTML <-> Markdown -------------------------------------------
function htmlToMarkdown(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  const lines = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    const inner = Array.from(node.childNodes).map(walk).join("");
    switch (tag) {
      case "h1": return `\n# ${inner.trim()}\n\n`;
      case "h2": return `\n## ${inner.trim()}\n\n`;
      case "h3": return `\n### ${inner.trim()}\n\n`;
      case "p": return `${inner.trim()}\n\n`;
      case "strong": case "b": return `**${inner}**`;
      case "em": case "i": return `*${inner}*`;
      case "u": return `<u>${inner}</u>`;
      case "a": return `[${inner}](${node.getAttribute("href") || "#"})`;
      case "blockquote": return `\n> ${inner.trim().replace(/\n/g, "\n> ")}\n\n`;
      case "pre": return `\n\`\`\`\n${node.textContent}\n\`\`\`\n\n`;
      case "code": return `\`${inner}\``;
      case "img": return `![${node.getAttribute("alt") || ""}](${node.getAttribute("src") || ""})`;
      case "ul": return `\n${Array.from(node.children).map((li) => `- ${walk(li).trim()}`).join("\n")}\n\n`;
      case "ol": return `\n${Array.from(node.children).map((li, i) => `${i + 1}. ${walk(li).trim()}`).join("\n")}\n\n`;
      case "li": return inner;
      case "br": return "\n";
      case "div": return `${inner}\n`;
      default: return inner;
    }
  };
  const md = Array.from(container.childNodes).map(walk).join("");
  return md.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ===========================================================================
// MEDIA TAB
// ===========================================================================
async function loadMedia() {
  const items = await api("GET", "/media");
  const grid = document.getElementById("mediaGrid");
  grid.innerHTML = "";
  for (const m of items) {
    const el = document.createElement("div");
    el.className = "media-item";
    el.innerHTML = `<img src="${m.url}" loading="lazy">
      <div class="media-name">${m.name}</div>
      <div class="media-actions">
        <button data-act="copy">Copy URL</button>
        <button data-act="delete">Delete</button>
      </div>`;
    el.querySelector('[data-act="copy"]').addEventListener("click", () => {
      navigator.clipboard.writeText(location.origin + m.url).then(() => toast("URL copied"));
    });
    el.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      if (!confirm(`Delete ${m.name}?`)) return;
      await api("DELETE", `/media/${encodeURIComponent(m.name)}`);
      loadMedia();
    });
    grid.appendChild(el);
  }
}
function initMedia() {
  document.getElementById("mediaUploadInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    document.getElementById("mediaStatus").textContent = "Uploading…";
    const res = await fetch("/api/media", { method: "POST", body: fd });
    const data = await res.json();
    document.getElementById("mediaStatus").textContent = res.ok ? `Uploaded ${data.name}` : data.error;
    e.target.value = "";
    loadMedia();
  });
  document.getElementById("findUnusedBtn").addEventListener("click", async () => {
    const unused = await api("GET", "/media/unused");
    document.getElementById("mediaStatus").textContent = unused.length
      ? `Unused: ${unused.map((u) => u.name).join(", ")}`
      : "No unused media found.";
  });
}

// ===========================================================================
// GIT TAB
// ===========================================================================
async function loadGit() {
  try {
    const status = await api("GET", "/git/status");
    document.getElementById("gitStatus").textContent = JSON.stringify(status, null, 2);
  } catch (e) {
    document.getElementById("gitStatus").textContent = e.message;
  }
  try {
    const log = await api("GET", "/git/log");
    document.getElementById("gitLog").textContent = log.length
      ? log.map((c) => `${c.hash.slice(0, 7)}  ${c.date}\n  ${c.message}`).join("\n\n")
      : "No commits yet.";
  } catch (e) {
    document.getElementById("gitLog").textContent = e.message;
  }
}
function initGit() {
  document.getElementById("commitBtn").addEventListener("click", async () => {
    const message = document.getElementById("commitMessage").value;
    try {
      const r = await api("POST", "/git/commit", { message });
      toast(r.committed ? `Committed ${r.commit}` : r.reason);
      loadGit(); refreshStatusPill();
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById("pushBtn").addEventListener("click", async () => {
    try {
      const r = await api("POST", "/git/push", {});
      toast(r.pushed ? `Pushed to ${r.remote}/${r.branch}` : r.reason, !r.pushed);
      loadGit();
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById("pullBtn").addEventListener("click", async () => {
    try {
      const r = await api("POST", "/git/pull", {});
      toast(r.pulled ? "Pulled" : r.reason, !r.pulled);
      loadElements(); reloadCanvas(); loadGit();
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById("setRemoteBtn").addEventListener("click", async () => {
    const url = document.getElementById("remoteUrl").value;
    if (!url) return;
    try {
      const r = await api("POST", "/git/remote", { url });
      toast(`origin -> ${r.url}`);
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById("ghConnectBtn").addEventListener("click", async () => {
    const owner = document.getElementById("ghOwner").value.trim();
    const repo = document.getElementById("ghRepo").value.trim();
    if (!owner || !repo) return toast("Owner and repo are required", true);
    try {
      await api("POST", "/github/connect", { owner, repo });
      toast(`Remote set to ${owner}/${repo} (auth via gh CLI)`);
    } catch (e) { toast(e.message, true); }
  });
  refreshGhStatus();
  let ghPoll = null;
  document.getElementById("ghDeviceBtn").addEventListener("click", async () => {
    const msg = document.getElementById("ghDeviceMsg");
    msg.textContent = "Starting device flow…";
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 25000);
      let resp;
      try {
        resp = await fetch("/api/auth/github/device/start", { method: "POST", signal: c.signal });
      } finally {
        clearTimeout(t);
      }
      const r = await resp.json();
      if (r.alreadyIn) { msg.textContent = `Already connected as ${r.alreadyIn} ✓`; refreshGhStatus(); return; }
      if (r.error || !r.ok) throw new Error(r.error || "Could not start device flow");
      clearInterval(ghPoll);
      let tries = 0;
      const poll = async () => {
        const pr = await fetch("/api/auth/github/device/poll").then((x) => x.json());
        tries++;
        if (pr.code) msg.innerHTML = `Code: <b>${escapeHtml(pr.code)}</b> — enter it at <a href="https://github.com/login/device" target="_blank" rel="noopener">github.com/login/device</a>`;
        else if (tries >= 2 && pr.output) msg.textContent = "gh: " + pr.output.slice(-160);
        if (pr.done) { clearInterval(ghPoll); msg.textContent = pr.ok ? `Connected as ${pr.user} ✓` : `Failed: ${pr.error || "unknown"}`; refreshGhStatus(); }
        else if (!pr.code) msg.textContent = "Starting device flow…";
      };
      await poll();
      ghPoll = setInterval(poll, 5000);
    } catch (e) {
      msg.textContent = /abort/i.test(e.message) ? "Start timed out — click again to retry." : e.message;
      toast(e.message, true);
    }
  });
  document.getElementById("ghRepoSelect").addEventListener("change", async (e) => {
    const full = e.target.value;
    if (!full) return;
    const [owner, repo] = full.split("/");
    document.getElementById("ghOwner").value = owner || "";
    document.getElementById("ghRepo").value = repo || "";
    try {
      await api("POST", "/github/connect", { owner, repo });
      toast(`Blog repo remote set to ${full}`);
    } catch (err) { toast(err.message, true); }
  });
  document.getElementById("ghRepoRefreshBtn").addEventListener("click", loadGhRepos);
  document.getElementById("ghCreateBtn").addEventListener("click", async () => {
    const name = document.getElementById("ghNewRepo").value.trim();
    if (!name) return toast("Enter a name for the new repo", true);
    try {
      toast("Creating repo…");
      const r = await fetch("/api/auth/github/repos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Create failed");
      const full = r.output.match(/[\w.-]+\/[\w.-]+/)?.[0] || name;
      const [owner, repo] = full.includes("/") ? full.split("/") : [null, full];
      if (owner) {
        document.getElementById("ghOwner").value = owner;
        document.getElementById("ghRepo").value = repo;
        await api("POST", "/github/connect", { owner, repo });
      }
      toast(`Created ${full} and set as blog repo remote ✓`);
      document.getElementById("ghNewRepo").value = "";
      loadGhRepos();
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById("ghLogoutBtn").addEventListener("click", async () => {
    if (!confirm("Clear the saved GitHub credential from this server?")) return;
    try {
      await fetch("/api/auth/github/logout", { method: "POST" });
      document.getElementById("ghToken").value = "";
      document.getElementById("ghRepoSelect").innerHTML = '<option value="">Your repos…</option>';
      toast("GitHub credential cleared");
      refreshGhStatus();
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById("ghTokenBtn").addEventListener("click", async () => {
    const token = document.getElementById("ghToken").value.trim();
    if (!token) return toast("Paste a token first", true);
    try {
      const r = await fetch("/api/auth/github/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).then((x) => x.json());
      if (r.error || r.ok === false) throw new Error(r.error || "Failed");
      toast(`GitHub connected as ${r.user || "gh"} ✓`);
      document.getElementById("ghToken").value = "";
      refreshGhStatus();
    } catch (e) { toast(e.message, true); }
  });
}
async function refreshServerAiStatus() {
  try {
    const st = await fetch("/api/auth/ai").then((r) => r.json());
    document.getElementById("serverAiStatus").textContent =
      st.provider ? `Server: ${st.provider}${st.hasKey ? " + key ✓" : " (no key)"}` : "Server: no key saved";
  } catch {
    document.getElementById("serverAiStatus").textContent = "";
  }
}
async function refreshGhStatus() {
  try {
    const st = await fetch("/api/auth/github/status").then((r) => r.json());
    document.getElementById("ghStatusLine").textContent = st.loggedIn ? `Signed in as ${st.user} ✓` : "Not signed in to GitHub";
    if (st.loggedIn) loadGhRepos();
  } catch {
    document.getElementById("ghStatusLine").textContent = "GitHub status unavailable";
  }
}
async function loadGhRepos() {
  const sel = document.getElementById("ghRepoSelect");
  try {
    const r = await fetch("/api/auth/github/repos").then((x) => x.json());
    if (!r.ok) { sel.innerHTML = '<option value="">(sign in to GitHub first)</option>'; return; }
    sel.innerHTML = '<option value="">Your repos…</option>' + (r.repos || []).map((repo) =>
      `<option value="${escapeAttr(repo.nameWithOwner)}">${escapeHtml(repo.nameWithOwner)}${repo.isPrivate ? " (private)" : ""}</option>`).join("");
  } catch {
    sel.innerHTML = '<option value="">(could not load repos)</option>';
  }
}

// ===========================================================================
// AI COPILOT TAB (site-wide operations)
// ===========================================================================
let pendingOps = [];
function initAiPanel() {
  document.getElementById("aiAskBtn").addEventListener("click", async () => {
    const instruction = document.getElementById("aiInstruction").value.trim();
    if (!instruction) return;
    document.getElementById("aiResult").textContent = "Thinking…";
    try {
      const { operations } = await api("POST", "/ai/operations", {
        provider: Settings.provider, apiKey: Settings.apiKey, model: Settings.model || undefined, instruction,
      });
      document.getElementById("aiResult").textContent = "";
      pendingOps = operations;
      if (document.getElementById("aiAutoApply").checked) {
        await applyPendingOps();
      } else {
        showAiConfirm(operations);
      }
    } catch (e) {
      document.getElementById("aiResult").textContent = "";
      toast(e.message, true);
    }
  });
  document.getElementById("aiCancelBtn").addEventListener("click", () => {
    document.getElementById("aiConfirmModal").classList.add("hidden");
    pendingOps = [];
  });
  document.getElementById("aiApplyBtn").addEventListener("click", async () => {
    await applyPendingOps();
    document.getElementById("aiConfirmModal").classList.add("hidden");
  });
}
function describeOp(op) {
  switch (op.op) {
    case "update_text": return `Set text of "${op.id}" to "${op.value}"`;
    case "update_image": return `Update image "${op.id}"${op.src ? ` -> ${op.src}` : ""}`;
    case "update_link": return `Set link "${op.id}" -> ${op.href}`;
    case "update_style": return `Style "${op.id}": ${JSON.stringify(op.style)}`;
    case "move": return `Move "${op.id}" by (${op.dx || 0}, ${op.dy || 0})`;
    case "resize": return `Resize "${op.id}" to (${op.widthPct || 100}%, ${op.heightPct || 100}%)`;
    case "set_visibility": return `${op.visible ? "Show" : "Hide"} "${op.id}"`;
    case "create_element": return `Create a new ${op.type} in "${op.parent || "top level"}"`;
    case "delete_element": return `Delete "${op.id}"`;
    case "duplicate_element": return `Duplicate "${op.id}"`;
    case "reorder_element": return `Move "${op.id}" ${op.direction}`;
    default: return JSON.stringify(op);
  }
}
function showAiConfirm(operations) {
  const list = document.getElementById("aiOpsList");
  list.innerHTML = operations.map((op) => `<li>${escapeHtml(describeOp(op))}</li>`).join("") || "<li>(no operations proposed)</li>";
  document.getElementById("aiConfirmModal").classList.remove("hidden");
}
async function applyPendingOps() {
  if (!pendingOps.length) return toast("Nothing to apply");
  try {
    const { results } = await api("POST", "/ai/apply", { operations: pendingOps });
    const failed = results.filter((r) => !r.ok);
    toast(failed.length ? `Applied with ${failed.length} error(s)` : `Applied ${results.length} change(s)`, !!failed.length);
    document.getElementById("aiResult").innerHTML = results.map((r) => `<div>${r.ok ? "✓" : "✗"} ${escapeHtml(describeOp(r.op))}${r.error ? ` — ${escapeHtml(r.error)}` : ""}</div>`).join("");
    await loadElements();
    reloadCanvas();
  } catch (e) {
    toast(e.message, true);
  }
  pendingOps = [];
}

// ===========================================================================
// SETTINGS TAB
// ===========================================================================
let selectedThemeId = null;

function loadSettingsIntoForm() {
  document.getElementById("aiProvider").value = Settings.provider;
  document.getElementById("aiModel").value = Settings.model;
  document.getElementById("aiApiKey").value = Settings.apiKey;
  api("GET", "/site").then((s) => {
    document.getElementById("repoPathDisplay").textContent = `${s.repoPath} · ${s.postCount} posts (${s.publishedCount} published)`;
  }).catch(() => {});
  fetch("/api/auth/ai").then((r) => r.json()).then((st) => {
    if (st.provider && !localStorage.getItem("bb_ai_provider")) document.getElementById("aiProvider").value = st.provider;
    if (st.model && !localStorage.getItem("bb_ai_model")) document.getElementById("aiModel").value = st.model;
  }).catch(() => {});
  loadThemes();
}

async function loadThemes() {
  const grid = document.getElementById("themeGrid");
  grid.innerHTML = '<p class="muted small">Loading themes…</p>';
  try {
    const themes = await api("GET", "/themes");
    grid.innerHTML = "";
    for (const t of themes) {
      const card = document.createElement("div");
      card.className = "theme-card";
      card.dataset.themeId = t.id;
      card.innerHTML = `
        ${t.preview ? `<img src="${t.preview}" alt="${escapeHtml(t.name)} preview" data-hide-on-error>` : ''}
        <h3>${escapeHtml(t.name)}</h3>
        <p>${escapeHtml(t.description || "")}</p>
        <button class="btn btn-primary btn-sm apply-btn" ${selectedThemeId === t.id ? "disabled" : ""}>
          ${selectedThemeId === t.id ? "Applied" : "Apply this theme"}
        </button>
      `;
      card.querySelector(".apply-btn").addEventListener("click", () => applyTheme(t.id));
      card.querySelectorAll("[data-hide-on-error]").forEach((img) => {
        img.addEventListener("error", () => { img.style.display = "none"; });
      });
      card.addEventListener("click", (e) => {
        if (e.target.classList.contains("apply-btn")) return;
        document.querySelectorAll(".theme-card").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        selectedThemeId = t.id;
        card.querySelector(".apply-btn").disabled = false;
        card.querySelector(".apply-btn").textContent = "Apply this theme";
      });
      grid.appendChild(card);
    }
  } catch (e) {
    grid.innerHTML = `<p class="muted small" style="color: var(--danger);">Failed to load themes: ${escapeHtml(e.message)}</p>`;
  }
}

async function applyTheme(themeId) {
  if (!themeId) return;
  const btn = document.querySelector(`.theme-card[data-theme-id="${themeId}"] .apply-btn`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Applying…";
  }
  try {
    await api("POST", "/themes/apply", { themeId });
    toast(`Theme "${themeId}" applied`);
    selectedThemeId = themeId;
    document.querySelectorAll(".theme-card").forEach(c => c.classList.remove("selected"));
    const active = document.querySelector(`.theme-card[data-theme-id="${themeId}"]`);
    if (active) active.classList.add("selected");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Applied";
    }
    await loadElements();
    reloadCanvas();
    PostsState.loaded = false;
    loadSettingsIntoForm();
  } catch (e) {
    toast(e.message, true);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Apply this theme";
    }
  }
}

function initSettings() {
  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    Settings.save({
      provider: document.getElementById("aiProvider").value,
      model: document.getElementById("aiModel").value,
      apiKey: document.getElementById("aiApiKey").value,
    });
    toast("Settings saved");
  });
  document.getElementById("loadRepoBtn").addEventListener("click", async () => {
    const repoPath = document.getElementById("loadRepoPath").value.trim();
    if (!repoPath) return;
    try {
      await fetch("/api/repo/load", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repoPath }),
      }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); });
      toast("Repo loaded");
      loadElements(); reloadCanvas(); loadSettingsIntoForm();
      PostsState.loaded = false;
    } catch (e) {
      toast(e.message, true);
    }
  });
  document.getElementById("themeUploadBtn").addEventListener("click", async () => {
    const input = document.getElementById("themeUploadInput");
    const file = input.files[0];
    if (!file) return toast("Pick a .zip first", true);
    const fd = new FormData();
    fd.append("theme", file);
    toast("Uploading theme…");
    try {
      const res = await fetch("/api/themes/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast(`Theme "${data.id}" uploaded and applied`);
      await loadThemes();
      await applyTheme(data.id);
    } catch (e) {
      toast(e.message, true);
    }
  });
  document.getElementById("saveServerAiBtn").addEventListener("click", async () => {
    try {
      const r = await fetch("/api/auth/ai", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: document.getElementById("aiProvider").value,
          model: document.getElementById("aiModel").value,
          apiKey: document.getElementById("aiApiKey").value,
        }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      toast("Server AI key saved");
      refreshServerAiStatus();
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    location.href = "/";
  });
  refreshServerAiStatus();
}

// ===========================================================================
// PUBLISH
// ===========================================================================
function initPublish() {
  const btn = document.getElementById("publishBtn");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Publishing…";
    try {
      const r = await api("POST", "/publish", {});
      const parts = [`Built ${r.pagesWritten} page(s) into docs/`];
      parts.push(r.commit?.committed ? `Committed ${String(r.commit.commit || "").slice(0, 7)}` : "Nothing new to commit");
      if (r.push?.pushed) parts.push(`Pushed to ${r.push.remote}/${r.push.branch} ✓`);
      else parts.push(`Not pushed: ${r.push?.reason || "unknown"}`);
      const failed = !r.push?.pushed;
      toast(parts.join(" · "), failed);
      refreshStatusPill();
      loadGit();
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

// ===========================================================================
// boot
// ===========================================================================
window.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initCanvas();
  initAddElement();
  initNewPost();
  initMedia();
  initGit();
  initAiPanel();
  initSettings();
  initPublish();
  loadElements();
  refreshStatusPill();
  setInterval(refreshStatusPill, 8000);
});
