import { json } from "../lib/http.js";
import { clearCookie } from "../lib/auth.js";

export async function POST() {
  return json({ ok: true }, { headers: { "Set-Cookie": clearCookie() } });
}
