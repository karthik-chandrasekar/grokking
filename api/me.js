import { json } from "../lib/http.js";
import { getSession } from "../lib/auth.js";
import { getUser } from "../lib/db.js";

export async function GET(request) {
  const sess = getSession(request);
  if (!sess?.sub) return json({ authenticated: false });

  const user = await getUser(sess.sub);
  if (!user) return json({ authenticated: false });

  return json({ authenticated: true, email: user.email, paid: !!user.paid });
}
