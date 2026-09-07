"use strict";
/**
 * GitHub Layer
 * ------------
 * Deliberately minimal: v1 auth is a personal access token, not OAuth. This
 * module only knows how to turn (owner, repo, token) into an authenticated
 * git remote URL and, optionally, verify the repo/token via the REST API.
 * It never touches the builder engine or site model directly.
 */

const { setRemote } = require("./gitLayer");

function remoteUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}.git`;
}

// Auth comes from `gh` (credential helper), never embedded in the URL.
async function connect(repoPath, { owner, repo }) {
  if (!owner || !repo) throw new Error("owner and repo are required");
  const url = remoteUrl(owner, repo);
  return setRemote(repoPath, url, "origin");
}

async function verifyToken({ owner, repo, token }) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      "User-Agent": "blogbuilder",
      Authorization: token ? `Bearer ${token}` : undefined,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, message: await res.text() };
  }
  const data = await res.json();
  return {
    ok: true,
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    private: data.private,
    permissions: data.permissions,
  };
}

module.exports = { connect, verifyToken, remoteUrl };
