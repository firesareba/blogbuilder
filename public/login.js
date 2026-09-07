"use strict";
const $ = (id) => document.getElementById(id);
let isSetup = false, pollTimer = null;

async function boot() {
  const st = await fetch("/api/auth/status").then((r) => r.json());
  if (st.loggedIn) { location.href = "/"; return; }
  isSetup = !!st.setupRequired;
  if (isSetup) {
    $("steps").hidden = false;
    $("title").textContent = "Welcome — create your account";
    $("subtitle").textContent = "First launch. This user is saved on the server for all future sign-ins.";
    $("credsBtn").textContent = "Create account & continue";
    $("username").setAttribute("autocomplete", "username");
    $("password").setAttribute("autocomplete", "new-password");
  }
}
async function submitCreds() {
  const u = $("username").value.trim(), p = $("password").value;
  $("credsErr").textContent = "";
  if (!u || !p) { $("credsErr").textContent = "Username and password are required."; return; }
  const url = isSetup ? "/api/auth/setup" : "/api/login";
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { $("credsErr").textContent = d.error || "Failed"; return; }
  if (isSetup) {
    document.querySelectorAll("#steps span")[1].classList.add("on");
    $("stepCreds").hidden = true;
    $("stepExtras").hidden = false;
    $("title").textContent = "Connect services (optional)";
    $("subtitle").textContent = "Saved on the server. Skip anything — change it later in Settings.";
  } else {
    location.href = "/";
  }
}
async function finishExtras() {
  const key = $("aiKey").value.trim();
  if (key) {
    await fetch("/api/auth/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: $("aiProvider").value, apiKey: key }) });
  }
  const tok = $("ghToken").value.trim();
  if (tok) {
    const r = await fetch("/api/auth/github/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: tok }) });
    if (!r.ok) { $("ghErr").textContent = (await r.json()).error || "GitHub connect failed"; return; }
  }
  location.href = "/";
}
async function postJSONTimeout(url, body, ms = 25000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}
async function deviceStart() {
  $("ghErr").textContent = "";
  $("ghStatus").textContent = "Starting device flow…";
  let r;
  try {
    r = await postJSONTimeout("/api/auth/github/device/start");
  } catch {
    $("ghStatus").textContent = "";
    $("ghErr").textContent = "Start timed out — click again to retry.";
    return;
  }
  const d = await r.json();
  if (!r.ok) { $("ghErr").textContent = d.error || "Could not start device flow"; return; }
  if (d.alreadyIn) { $("ghErr").textContent = ""; $("ghStatus").textContent = "Already connected as " + d.alreadyIn + " ✓"; return; }
  $("ghDeviceBox").hidden = false;
  clearInterval(pollTimer);
  const poll = async () => {
    const pr = await fetch("/api/auth/github/device/poll").then((x) => x.json());
    if (pr.code) $("ghCode").textContent = pr.code;
    if (pr.done) {
      clearInterval(pollTimer);
      $("ghStatus").textContent = pr.ok ? ("Connected as " + (pr.user || "GitHub") + " ✓") : ("Failed: " + (pr.error || "unknown"));
    } else {
      $("ghStatus").textContent = "Waiting for approval…";
    }
  };
  await poll();
  pollTimer = setInterval(poll, 5000);
}
$("credsBtn").addEventListener("click", submitCreds);
$("password").addEventListener("keydown", (e) => { if (e.key === "Enter") submitCreds(); });
$("finishBtn").addEventListener("click", finishExtras);
$("ghDeviceBtn").addEventListener("click", deviceStart);
$("ghTokenBtn").addEventListener("click", async () => {
  const tok = $("ghToken").value.trim();
  if (!tok) { $("ghErr").textContent = "Paste a token first."; return; }
  const r = await fetch("/api/auth/github/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: tok }) });
  const d = await r.json();
  $("ghErr").textContent = r.ok ? ("Connected as " + (d.user || "GitHub") + " ✓") : (d.error || "Failed");
});
boot();
