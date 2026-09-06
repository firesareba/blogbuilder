"use strict";
const crypto = require("crypto");

const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-secret";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "password";

function sign(data) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
}

function createSession(username) {
  const payload = JSON.stringify({ username, iat: Date.now() });
  const sig = sign(payload);
  return Buffer.from(payload).toString("base64") + "." + sig;
}

function verifySession(token) {
  if (!token) return null;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  const payload = Buffer.from(b64, "base64").toString("utf8");
  const expected = sign(payload);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(payload);
  // ponytail: no expiry, add when sessions revocable needed
  return data;
}

function authRequired(req, res, next) {
  const token = req.cookies && req.cookies.session;
  const user = verifySession(token);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  req.user = user;
  next();
}

module.exports = { createSession, verifySession, authRequired, ADMIN_USER, ADMIN_PASS };
