"use strict";
/**
 * gh CLI auth
 * ----------
 * Uses the `gh` CLI as git's credential helper so no PAT ever lands in
 * .git/config. GH_CONFIG_DIR defaults to /data/gh (persisted volume).
 * Device flow: spawn `gh auth login --web`, capture the one-time code,
 * send Enter to let it start polling GitHub while the user approves at
 * github.com/login/device in their own browser.
 */

const { execFile, spawn } = require("child_process");

const GH_ENV = {
  ...process.env,
  GH_CONFIG_DIR: process.env.GH_CONFIG_DIR || "/data/gh",
  HOME: process.env.HOME || "/data",
  // Force plain output: gh decorates the one-time code with ANSI escapes
  // when piped, which silently breaks code extraction (the code is there,
  // the regex just can't see it through the escape bytes).
  NO_COLOR: "1",
  CLICOLOR: "0",
  TERM: "dumb",
};

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
function stripAnsi(s) {
  return String(s || "").replace(ANSI_RE, "");
}

function runGh(args, { input } = {}) {
  return new Promise((resolve) => {
    execFile("gh", args, { env: GH_ENV, timeout: 20000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, output: (stderr || err.message).trim() });
      resolve({ ok: true, output: (stdout || "").trim() });
    });
    // note: execFile with input not needed here; token path uses stdin below
    void input;
  });
}

function ghStatus() {
  return new Promise((resolve) => {
    execFile("gh", ["auth", "status"], { env: GH_ENV, timeout: 15000 }, (err, stdout, stderr) => {
      const out = ((stdout || "") + (stderr || "")).trim();
      if (err) return resolve({ loggedIn: false, output: out || err.message });
      const m = out.match(/Logged in to [\w.]+ account (\S+)/);
      resolve({ loggedIn: true, user: m ? m[1] : null, output: out });
    });
  });
}

async function loginWithToken(token) {
  token = String(token || "").trim();
  if (!token) throw new Error("token is required");
  const child = spawn("gh", ["auth", "login", "--with-token"], { env: GH_ENV });
  const done = new Promise((resolve) => {
    let errOut = "";
    child.stderr.on("data", (d) => (errOut += d.toString()));
    child.on("close", (code) => resolve({ code, errOut }));
    setTimeout(() => { try { child.kill(); } catch {} resolve({ code: -1, errOut: errOut + " (timed out)" }); }, 25000);
  });
  child.stdin.write(token);
  child.stdin.end();
  const { code, errOut } = await done;
  if (code !== 0) throw new Error("gh auth login failed: " + (errOut.trim() || `exit ${code}`));
  await setupGit();
  return ghStatus();
}

function logout() {
  return new Promise((resolve) => {
    execFile("gh", ["auth", "logout", "--hostname", "github.com"], { env: GH_ENV, timeout: 15000 }, async () => {
      // Best-effort: also wipe any leftover token material so a reset is total.
      try {
        const fs = require("fs");
        const path = require("path");
        const dir = GH_ENV.GH_CONFIG_DIR;
        for (const f of ["hosts.yml", "hosts.yaml"]) {
          try { fs.unlinkSync(path.join(dir, f)); } catch {}
        }
      } catch {}
      resolve(await ghStatus().catch(() => ({ loggedIn: false })));
    });
  });
}

function setupGit() {
  return new Promise((resolve, reject) => {
    execFile("gh", ["auth", "setup-git"], { env: GH_ENV, timeout: 20000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error("gh auth setup-git failed: " + ((stderr || err.message).trim())));
      resolve((stdout || "").trim());
    });
  });
}

// --- device flow (single active flow per server) ---
let activeFlow = null;

function startDeviceFlow() {
  if (activeFlow && !activeFlow.done) return activeFlow.public;
  // Respond immediately; the already-authed short-circuit happens in poll().
  // --hostname skips the account prompt. The remaining prompts (protocol,
  // git-credential setup, "press Enter to open browser") have sane defaults,
  // which we accept by feeding newlines: with no TTY, gh would otherwise
  // block on stdin forever and the UI spins on "…" indefinitely.
  const child = spawn("gh", ["auth", "login", "--web", "--hostname", "github.com"], { env: { ...GH_ENV, BROWSER: "true" } });
  const flow = {
    done: false, ok: false, code: null, url: "https://github.com/login/device",
    output: "", error: null, startedAt: Date.now(),
  };
  activeFlow = flow;
  flow.public = { url: flow.url, code: null, startedAt: flow.startedAt };

  // Keep answering for the whole life of the child: there may be more
  // prompts after the code (browser step, keyring, etc.), and an unread
  // prompt with no TTY hangs forever while the user waits.
  const feed = setInterval(() => {
    if (flow.done) { clearInterval(feed); return; }
    try { child.stdin.write("\n"); } catch { clearInterval(feed); }
  }, 1000);
  // No code within 30s = prompts didn't resolve; fail loudly, never hang.
  const codeTimer = setTimeout(() => {
    if (!flow.code && !flow.done) {
      flow.done = true;
      flow.error = "No device code from gh after 30s. Output: " + (flow.output.trim().slice(-500) || "(none)");
      try { child.kill(); } catch {}
    }
  }, 30000);
  if (codeTimer.unref) codeTimer.unref();
  const pollTimer = setTimeout(() => {
    if (!flow.done) { flow.done = true; flow.error = "Timed out waiting for browser approval (10 min)"; try { child.kill(); } catch {} }
  }, 10 * 60 * 1000);
  if (pollTimer.unref) pollTimer.unref();

  // NOTE: gh/survey prints interactive prompts (including the code line)
  // to STDERR, not stdout — extraction must run on both streams.
  const ingest = (d) => {
    flow.output += d.toString();
    // Tolerant match: between "code:" and the XXXX-XXXX code there may be
    // color bytes or other noise even with color disabled.
    const m = stripAnsi(flow.output).match(/one-time code:[^A-Z0-9]*([A-Z0-9]{4}-[A-Z0-9]{4})/i);
    if (m && !flow.code) {
      flow.code = m[1].trim().toUpperCase();
      flow.public.code = flow.code;
      try { child.stdin.write("\n"); } catch {}
    }
  };
  child.stdout.on("data", ingest);
  child.stderr.on("data", ingest);
  child.on("close", async (exitCode) => {
    clearTimeout(pollTimer); clearTimeout(codeTimer); clearInterval(feed);
    // eslint-disable-next-line no-console
    console.log(`[gh] device flow child exited (${exitCode}). output tail: ${flow.output.trim().slice(-300)}`);
    // Re-check status regardless of exit code: the token may have been
    // written even if our bookkeeping missed it.
    try {
      const st = await ghStatus();
      if (st.loggedIn) {
        try { await setupGit(); } catch {}
        flow.done = true; flow.ok = true;
        return;
      }
    } catch {}
    if (exitCode === 0) {
      flow.done = true; flow.error = "gh login exited but status check failed";
    } else if (!flow.done) {
      flow.done = true; flow.error = "gh exited (" + exitCode + "): " + flow.output.trim().slice(-500);
    }
  });
  child.on("error", (e) => { flow.done = true; flow.error = e.message; });
  return flow.public;
}

async function pollDeviceFlow() {
  if (!activeFlow) {
    // No tracked flow (e.g. server restarted mid-approval, or the child
    // died silently): the user may still have approved, so check directly.
    const st = await ghStatus().catch(() => ({ loggedIn: false }));
    if (st.loggedIn) return { active: false, done: true, ok: true, user: st.user };
    return { active: false };
  }
  const f = activeFlow;
  // Belt and suspenders: if gh is authed now, complete no matter what.
  const st = await ghStatus().catch(() => ({ loggedIn: false }));
  if (st.loggedIn) {
    try { await setupGit(); } catch {}
    activeFlow = null;
    return { active: false, done: true, ok: true, user: st.user };
  }
  if (f.done && f.ok) {
    activeFlow = null;
    return { active: false, done: true, ok: true, user: st.user };
  }
  if (f.done) { activeFlow = null; return { active: false, done: true, ok: false, error: f.error }; }
  return { active: true, code: f.code, url: f.url, output: f.output.trim().slice(-300) };
}

function listRepos(limit = 50) {
  return new Promise((resolve) => {
    execFile("gh", ["repo", "list", "--limit", String(limit), "--json", "nameWithOwner,description,isPrivate,updatedAt"], { env: GH_ENV, timeout: 20000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: (stderr || err.message).trim() });
      try {
        resolve({ ok: true, repos: JSON.parse(stdout || "[]") });
      } catch (e) {
        resolve({ ok: false, error: "Could not parse gh output" });
      }
    });
  });
}

function setRepoVisibility(owner, repo, visibility) {
  if (!owner || !repo || !["public", "private"].includes(visibility)) {
    return Promise.resolve({ ok: false, error: "owner, repo and visibility=public|private required" });
  }
  return new Promise((resolve) => {
    execFile("gh", ["repo", "edit", `${owner}/${repo}`, "--visibility", visibility, "--accept-visibility-change-conformance"], { env: GH_ENV, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: (stderr || err.message).trim() });
      resolve({ ok: true, output: (stdout || "").trim() });
    });
  });
}

function setPagesSource(owner, repo, branch, scmPath) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ source: { branch, path: scmPath } });
    const child = require("child_process").spawn("gh",
      ["api", `repos/${owner}/${repo}/pages`, "--method", "PUT", "--input", "-"],
      { env: GH_ENV });
    let errOut = "";
    child.stderr.on("data", (d) => (errOut += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) return resolve({ ok: false, error: errOut.trim() || `exit ${code}` });
      resolve({ ok: true });
    });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.stdin.write(body);
    child.stdin.end();
  });
}

function createRepo({ name, description, isPrivate }) {
  if (!name || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name) && !/^[A-Za-z0-9_.-]+$/.test(name)) {
    return Promise.resolve({ ok: false, error: "Repo name must be 'name' or 'owner/name'" });
  }
  // NOTE: no --confirm flag (deprecated in recent gh); a name argument
  // already makes creation non-interactive.
  const args = ["repo", "create", name, isPrivate === false ? "--public" : "--private"];
  if (description) args.push("--description", description);
  return new Promise((resolve) => {
    execFile("gh", args, { env: GH_ENV, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        let msg = (stderr || err.message).trim();
        if (/not accessible by personal access token/i.test(msg)) {
          msg += " — the token needs the 'repo' scope to create repos (or create the repo on github.com and pick it from the list instead).";
        }
        return resolve({ ok: false, error: msg });
      }
      resolve({ ok: true, output: (stdout || "").trim() });
    });
  });
}

module.exports = { runGh, ghStatus, loginWithToken, logout, setupGit, startDeviceFlow, pollDeviceFlow, listRepos, createRepo, setRepoVisibility, setPagesSource, GH_ENV };
