import { json } from "../lib/http.js";
import { getUser } from "../lib/db.js";
import { verifyPassword, createToken, sessionCookie } from "../lib/auth.js";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, { status: 400 });
  }
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  const user = await getUser(email);
  // Generic message — don't reveal whether the email exists.
  if (!user || !verifyPassword(password, user.passwordHash))
    return json({ error: "Incorrect email or password." }, { status: 401 });

  const token = createToken({ sub: email });
  return json(
    { email: user.email, paid: !!user.paid },
    { headers: { "Set-Cookie": sessionCookie(token) } }
  );
}

export function GET() {
  return json({ error: "Method not allowed." }, { status: 405 });
}
