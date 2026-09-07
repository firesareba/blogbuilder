"use strict";
/**
 * Auth
 * ----
 * First-run model: on a fresh box no user exists, so GET / serves a
 * create-user screen. Submitting writes ADMIN_USER + ADMIN_PASS_HASH
 * (scrypt) to AUTH_ENV (/data/auth.env by default, survives rebuilds),
 * which is the env source for all future sign-ins. Same file also holds
 * server-side AI keys (BYOK) saved from setup/settings.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const AUTH_ENV = process.env.AUTH_ENV
  || path.join(path.dirname(process.env.BLOG_REPO_PATH || "/data/site"), "auth.env");

const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-secret";

function loadEnvFile() {
  const out = {};
  if (!fs.existsSync(AUTH_ENV)) return out;
  for (const line of fs.readFileSync(AUTH_ENV, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function persistEnvFile(patch) {
  const cur = loadEnvFile();
  Object.assign(cur, patch);
  const body = Object.entries(cur).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  fs.mkdirSync(path.dirname(AUTH_ENV), { recursive: true });
  fs.writeFileSync(AUTH_ENV, body, { mode: 0o600 });
  try { fs.chmodSync(AUTH_ENV, 0o600); } catch {}
  Object.assign(process.env, patch);
}

function getConfiguredUser() {
  const file = loadEnvFile();
  const username = process.env.ADMIN_USER || file.ADMIN_USER || null;
  const passHash = process.env.ADMIN_PASS_HASH || file.ADMIN_PASS_HASH || null;
  const passPlain = process.env.ADMIN_PASS || file.ADMIN_PASS || null;
  if (!username || (!passHash && !passPlain)) return null;
  return { username, passHash, passPlain };
}

function isSetupRequired() {
  return getConfiguredUser() === null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  if (!stored) return false;
  if (!stored.includes(":")) {
    return crypto.timingSafeEqual(Buffer.from(password), Buffer.from(stored));
  }
  const [salt, hash] = stored.split(":");
  const h = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}

function saveCredentials(username, password) {
  if (!username || !password || password.length < 8) {
    throw new Error("Username required, password min 8 chars");
  }
  persistEnvFile({ ADMIN_USER: username, ADMIN_PASS_HASH: hashPassword(password) });
}

function getServerAI() {
  const file = loadEnvFile();
  return {
    provider: process.env.AI_PROVIDER || file.AI_PROVIDER || "",
    model: process.env.AI_MODEL || file.AI_MODEL || "",
    hasKey: !!((process.env.AI_API_KEY || file.AI_API_KEY || "")),
  };
}

function saveServerAI({ provider, model, apiKey }) {
  const patch = {};
  if (provider !== undefined) patch.AI_PROVIDER = provider;
  if (model !== undefined) patch.AI_MODEL = model;
  if (apiKey) patch.AI_API_KEY = apiKey;
  persistEnvFile(patch);
}

function getServerApiKey() {
  const file = loadEnvFile();
  return process.env.AI_API_KEY || file.AI_API_KEY || "";
}

function sign(data) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
}

function createSession(username) {
  const payload = JSON.stringify({ username, iat: Date.now() });
  const sig = sign(payload);
  return Buffer.from(payload).toString("base64") + "." + sig;
}

function verifySession(token) {
  try {
    if (!token) return null;
    const [b64, sig] = String(token).split(".");
    if (!b64 || !sig) return null;
    const payload = Buffer.from(b64, "base64").toString("utf8");
    const expected = sign(payload);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function getSessionUser(req) {
  return verifySession(req.cookies && req.cookies.session);
}

function authRequired(req, res, next) {
  if (!getSessionUser(req)) return res.status(401).json({ error: "Authentication required" });
  next();
}

module.exports = {
  AUTH_ENV,
  loadEnvFile,
  persistEnvFile,
  getConfiguredUser,
  isSetupRequired,
  hashPassword,
  checkPassword,
  saveCredentials,
  getServerAI,
  saveServerAI,
  getServerApiKey,
  createSession,
  verifySession,
  getSessionUser,
  authRequired,
};
