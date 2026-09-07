"use strict";
/**
 * Git Layer
 * ---------
 * Thin, isolated wrapper around simple-git. This is the ONLY module allowed
 * to run git commands. Kept separate from the builder engine so a future
 * alternative backend (e.g. a hosted git provider) could be swapped in
 * without touching engine code.
 */

const simpleGit = require("simple-git");

function repoGit(repoPath) {
  return simpleGit({ baseDir: repoPath });
}

async function ensureRepo(repoPath) {
  const git = repoGit(repoPath);
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    await git.init();
    await git.addConfig("user.name", "BlogBuilder", false, "local").catch(() => {});
    await git.addConfig("user.email", "blogbuilder@localhost", false, "local").catch(() => {});
  }
  return git;
}

async function status(repoPath) {
  const git = await ensureRepo(repoPath);
  const s = await git.status();
  return {
    current: s.current,
    tracking: s.tracking,
    ahead: s.ahead,
    behind: s.behind,
    staged: s.staged,
    modified: s.modified,
    created: s.created,
    deleted: s.deleted,
    not_added: s.not_added,
    conflicted: s.conflicted,
    isClean: s.isClean(),
  };
}

async function diff(repoPath, file) {
  const git = await ensureRepo(repoPath);
  return file ? git.diff(["--", file]) : git.diff();
}

async function commit(repoPath, message) {
  const git = await ensureRepo(repoPath);
  await git.add(["-A"]);
  const s = await git.status();
  if (s.staged.length === 0 && s.files.length === 0) {
    return { committed: false, reason: "Nothing to commit - working tree clean" };
  }
  const result = await git.commit(message || "Update site via BlogBuilder");
  return { committed: true, commit: result.commit, summary: result.summary };
}

async function log(repoPath, n = 20) {
  const git = await ensureRepo(repoPath);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) return [];
  try {
    const result = await git.log({ maxCount: n });
    return result.all.map((c) => ({
      hash: c.hash, date: c.date, message: c.message, author: c.author_name,
    }));
  } catch {
    return []; // no commits yet
  }
}

async function push(repoPath, { remote = "origin", branch } = {}) {
  const git = await ensureRepo(repoPath);
  const remotes = await git.getRemotes(true);
  if (!remotes.find((r) => r.name === remote)) {
    return { pushed: false, reason: `No git remote named "${remote}" configured` };
  }
  const currentBranch = branch || (await git.status()).current;
  try {
    await git.push(remote, currentBranch, ["--set-upstream"]);
    return { pushed: true, remote, branch: currentBranch };
  } catch (e) {
    let reason = e.message;
    if (/could not read Username/i.test(reason)) {
      reason += " — git had no credential helper (gh CLI not wired). Reconnect GitHub in the Git tab, or restart the container to re-run setup.";
    }
    return { pushed: false, reason };
  }
}

async function pull(repoPath, { remote = "origin", branch } = {}) {
  const git = await ensureRepo(repoPath);
  try {
    const currentBranch = branch || (await git.status()).current;
    const result = await git.pull(remote, currentBranch);
    return { pulled: true, summary: result.summary };
  } catch (e) {
    return { pulled: false, reason: e.message };
  }
}

async function setRemote(repoPath, url, remote = "origin") {
  const git = await ensureRepo(repoPath);
  const remotes = await git.getRemotes(true);
  if (remotes.find((r) => r.name === remote)) {
    await git.remote(["set-url", remote, url]);
  } else {
    await git.addRemote(remote, url);
  }
  return { remote, url: url.replace(/:\/\/[^@]*@/, "://***@") };
}

module.exports = {
  ensureRepo, status, diff, commit, log, push, pull, setRemote,
};
