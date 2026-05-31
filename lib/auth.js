// Dependency-light auth: scrypt password hashing + HMAC-signed session token
// in an httpOnly cookie. No external auth library required — only node:crypto.
import crypto from "node:crypto";

const SECRET = process.env.AUTH_SECRET || "";
export const COOKIE_NAME = "gg_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

/* ---------- password hashing (scrypt) ---------- */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ---------- minimal signed token (JWT-shaped, HS256) ---------- */
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const b64urlJSON = (obj) => b64url(JSON.stringify(obj));
const sign = (data) => crypto.createHmac("sha256", SECRET).update(data).digest("base64url");

export function createToken(payload, maxAgeSec = MAX_AGE) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlJSON({ alg: "HS256", typ: "JWT" });
  const body = b64urlJSON({ ...payload, iat: now, exp: now + maxAgeSec });
  const data = `${head}.${body}`;
  return `${data}.${sign(data)}`;
}

export function verifyToken(token) {
  if (!token || !SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(sign(data));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body;
  try {
    body = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    return null;
  }
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

/* ---------- cookie helpers ---------- */
export function sessionCookie(token) {
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE}`,
  ].join("; ");
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readToken(request) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function getSession(request) {
  return verifyToken(readToken(request));
}
