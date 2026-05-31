import { json } from "../lib/http.js";
import { createUser } from "../lib/db.js";
import { hashPassword, createToken, sessionCookie } from "../lib/auth.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, { status: 400 });
  }
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  if (!EMAIL_RE.test(email))
    return json({ error: "Please enter a valid email address." }, { status: 400 });
  if (password.length < 8)
    return json({ error: "Password must be at least 8 characters." }, { status: 400 });

  const record = await createUser({ email, passwordHash: hashPassword(password) });
  if (!record)
    return json(
      { error: "An account with this email already exists. Try logging in." },
      { status: 409 }
    );

  const token = createToken({ sub: email });
  return json(
    { email, paid: false },
    { status: 201, headers: { "Set-Cookie": sessionCookie(token) } }
  );
}

export function GET() {
  return json({ error: "Method not allowed." }, { status: 405 });
}
