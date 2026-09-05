---
title: Why I built this
slug: why-i-built-this
author: Ensō
date: '2026-08-20'
tags:
  - meta
  - self-hosting
featuredImage: ''
published: true
excerpt: Every other blogging platform wanted to own my content. This one doesn't.
---

I've started and abandoned more blogs than I can count. Not because I ran out of things to say, but because every platform I tried eventually got in the way.

Hosted platforms lock your writing into someone else's database. Static site generators are great right up until you want to change a heading's color without touching a build config. Page builders are visual, but they hide your content behind a proprietary export format you can never fully leave.

So this is an attempt at something else: a builder where **git is the database**. Every edit — a moved button, a rewritten headline, a new post — is a file change in a repository you own. No lock-in, because there's nothing to lock. You can `git clone` the whole site and walk away at any time.

## How it works

The short version:

- A **theme** is just HTML with a few extra attributes marking which elements are editable.
- The builder reads that theme and gives you a real visual editor on top of it.
- Every change gets written back into the repo as plain JSON or markdown.
- Publishing renders the whole thing to plain HTML/CSS — no framework required to view it.

That's it. No hidden database, no vendor lock-in, no mystery meat.

## What's next

Themes, mostly. The current one is intentionally quiet — a little Ensō circle, some warm paper tones, nothing shouting for attention. I want to build a couple more before deciding this is "done."

If you're reading this from the published site: it worked.
