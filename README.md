# BlogBuilder

A self-hosted, **git-native** visual website and blogging builder.

You own a git repository containing your website. BlogBuilder loads that
repo, understands its theme, lets you edit the site and its content visually
(or from the CLI, or through an AI copilot), and writes every change back
into the repo as plain files. There is no separate database - git is the
single source of truth.

```
GUI / CLI / AI copilot
        ↓
   Builder API (Express)
        ↓
   Builder Engine
        ↓
  Site Model  ←→  Theme + Content (files on disk)
        ↓
   Renderer → plain HTML/CSS/JS (dist/)
        ↓
     Git repo
```

## What's actually in here

```
server/
  engine/
    themeParser.js     parses a theme's data-builder-id elements
    siteModel.js        loads config + theme + overrides + posts from disk
    builderEngine.js     the one place all site mutations happen
    contentEngine.js     blog post CRUD (markdown + frontmatter)
    mediaEngine.js        asset upload/list/delete
    applyOperation.js    executes a single {op, ...} object (used by AI)
    renderer.js           theme + overrides + posts -> static dist/ output
  git/
    gitLayer.js         isolated simple-git wrapper (status/commit/push/pull)
    githubLayer.js        PAT-based remote configuration + verification
  ai/
    aiProvider.js         BYOK provider abstraction + operation/article prompts
    providers/anthropic.js, openai.js
  api/
    routes.js              the REST API - the ONLY thing the GUI/CLI talk to
  index.js                  server entry point
cli/
  blog.js                   CLI - talks to the exact same REST API as the GUI
public/                     the builder GUI (plain HTML/CSS/JS, no build step)
example-site/                a complete example repo you can load immediately
  theme/index.html, theme.css, post.html    the "Ensō" theme
  content/config.json, overrides.json, posts/*.md
  assets/
```

The **published website** (`dist/` after you run publish) is plain HTML/CSS/JS.
No framework required to view or host it - it's deployable on its own,
independent of BlogBuilder.

## How theming works

A theme is normal HTML with `data-builder-id` attributes marking editable
elements:

```html
<section data-builder-id="hero">
  <h1 data-builder-id="headline">hello</h1>
  <button data-builder-id="clickifyouhateschoology">click if you hate schoology</button>
  <img data-builder-id="profile-image" src="/assets/me.png">
</section>
```

Optional attributes:
- `data-builder-locked="true"` - can't be deleted or reordered (used on the
  example theme's header/nav/footer).
- `data-builder-collection="posts"` - this container is auto-populated from
  a content collection at render time (used for "latest posts" and "archive").

BlogBuilder never touches the theme file itself. Every edit is stored
separately in `content/overrides.json` (text/style/visibility changes to
existing elements, plus any elements you added through the builder) and
merged with the base theme whenever the site is rendered or published.

## Local development

Requires Node 18+ and git.

```bash
npm install
cp .env.example .env      # defaults to the bundled example-site
npm start                 # http://localhost:4321
```

Then try the CLI against the running server (in another terminal):

```bash
node cli/blog.js elements
node cli/blog.js set-text headline "why i built this"
node cli/blog.js move clickifyouhateschoology --dx -4 --dy 2
node cli/blog.js create-post "hello-world" --title "Hello, world"
node cli/blog.js publish-post hello-world
node cli/blog.js publish
node cli/blog.js git status
node cli/blog.js git commit "first edits"
```

Or `npm link` to get a global `blog` command.

## Pointing it at your own repo

Your repo needs, at minimum:

```
your-site/
  theme/index.html      (with data-builder-id attributes)
  content/config.json   ({"title": "...", "theme": "theme/index.html", "collections": {"posts": {"dir": "content/posts"}}})
  content/posts/         (markdown files, created for you as you write posts)
  assets/
```

Set `BLOG_REPO_PATH` to its path (or use the "Load repo" field in the
Settings tab) and restart / reload.

## GitHub

v1 auth is a personal access token, not OAuth - set it in the Git tab
(owner/repo/token), which builds an authenticated `origin` remote and lets
you push directly. The GitHub layer (`server/git/githubLayer.js`) is
isolated behind a small interface so a proper OAuth flow can be swapped in
later without touching the builder engine.

## AI copilot (BYOK)

Paste your own Anthropic or OpenAI-compatible API key into the Settings tab.
Keys live only in your browser's localStorage and are sent directly with
each AI request - the server never stores them.

The AI **never writes raw HTML**. It can only emit a JSON array of the same
structured operations the builder API exposes (`update_text`, `move`,
`create_element`, ...), which you review and approve before they're applied
(or auto-apply, if you check the box). This makes the AI just another client
of the builder engine, same as the GUI and CLI.

## Production-ish deployment

```bash
docker compose up -d --build
```

This builds the image, seeds `./data/site` with the example site on first
boot if nothing's there yet, and serves the builder on port 4321. Put a
reverse proxy (nginx, Caddy, Nginx Proxy Manager, etc.) in front of it and
restrict access as you see fit - v1 has no built-in authentication, so don't
expose it directly to the public internet.

To use your own repo instead of the seeded example, either:
- `git clone` your repo into `./data/site` before first boot, or
- point `BLOG_REPO_PATH` at wherever you mount your repo.

## What's intentionally simplified in v1

Authentication, permissions, GitHub OAuth, advanced git conflict resolution,
responsive design tooling beyond a desktop/mobile preview toggle, asset
optimization, collaborative editing, analytics/SEO tooling, and sophisticated
undo - all left simple or out entirely. See the top of each engine file for
what it does and doesn't handle. Nothing here is faked, though: every
listed feature actually works end to end.

No license is included yet.
