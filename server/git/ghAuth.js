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
};

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
  const child = spawn("gh", ["auth", "login", "--web"], { env: { ...GH_ENV, BROWSER: "true" } });
  const flow = {
    done: false, ok: false, code: null, url: "https://github.com/login/device",
    output: "", error: null, startedAt: Date.now(),
  };
  activeFlow = flow;
  flow.public = { url: flow.url, code: null, startedAt: flow.startedAt };

  const timer = setTimeout(() => {
    if (!flow.done) { flow.done = true; flow.error = "Timed out waiting for approval"; try { child.kill(); } catch {} }
  }, 10 * 60 * 1000);
  if (timer.unref) timer.unref();

  child.stdout.on("data", (d) => {
    flow.output += d.toString();
    const m = flow.output.match(/one-time code:\s*([A-Z0-9-]+)/i);
    if (m && !flow.code) {
      flow.code = m[1].trim();
      flow.public.code = flow.code;
      try { child.stdin.write("\n"); } catch {}
    }
  });
  child.stderr.on("data", (d) => { flow.output += d.toString(); });
  child.on("close", async (exitCode) => {
    clearTimeout(timer);
    if (exitCode === 0) {
      try {
        await setupGit();
        const st = await ghStatus();
        flow.done = true; flow.ok = st.loggedIn;
        if (!st.loggedIn) flow.error = "gh login exited but status check failed";
      } catch (e) { flow.done = true; flow.error = e.message; }
    } else if (!flow.done) {
      flow.done = true; flow.error = "gh exited (" + exitCode + "): " + flow.output.trim().slice(-500);
    }
  });
  child.on("error", (e) => { flow.done = true; flow.error = e.message; });
  return flow.public;
}

async function pollDeviceFlow() {
  if (!activeFlow) return { active: false };
  const f = activeFlow;
  if (f.done && f.ok) {
    const st = await ghStatus();
    activeFlow = null;
    return { active: false, done: true, ok: true, user: st.user };
  }
  if (f.done) { activeFlow = null; return { active: false, done: true, ok: false, error: f.error }; }
  return { active: true, code: f.code, url: f.url };
}

module.exports = { runGh, ghStatus, loginWithToken, setupGit, startDeviceFlow, pollDeviceFlow, GH_ENV };
