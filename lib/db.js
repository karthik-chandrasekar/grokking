// User store backed by Upstash Redis (REST). Works with both env var schemes:
//  - Vercel Marketplace auto-injects KV_REST_API_URL / KV_REST_API_TOKEN
//  - Upstash native / manual setup uses UPSTASH_REDIS_REST_URL / _TOKEN
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const redis = new Redis({ url, token });

const key = (email) => `user:${String(email).trim().toLowerCase()}`;

export async function getUser(email) {
  if (!email) return null;
  return await redis.get(key(email)); // @upstash/redis auto-parses JSON
}

// Creates a user only if one doesn't already exist (atomic via NX).
// Returns the new record, or null if the email is already taken.
export async function createUser({ email, passwordHash }) {
  const record = {
    email: String(email).trim().toLowerCase(),
    passwordHash,
    paid: false,
    createdAt: Date.now(),
    paidAt: null,
    stripeSessionId: null,
    stripeCustomerId: null,
  };
  const ok = await redis.set(key(email), record, { nx: true });
  return ok ? record : null;
}

export async function updateUser(email, patch) {
  const k = key(email);
  const cur = await redis.get(k);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  await redis.set(k, next);
  return next;
}

export async function markPaid(email, extra = {}) {
  return await updateUser(email, { paid: true, paidAt: Date.now(), ...extra });
}
