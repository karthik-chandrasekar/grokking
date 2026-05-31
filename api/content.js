import { json } from "../lib/http.js";
import { getSession } from "../lib/auth.js";
import { getUser } from "../lib/db.js";
import { CHAPTERS } from "../lib/content.js";

export async function GET(request) {
  const sess = getSession(request);
  if (!sess?.sub) return json({ error: "unauthenticated" }, { status: 401 });

  const user = await getUser(sess.sub);
  if (!user) return json({ error: "unauthenticated" }, { status: 401 });
  if (!user.paid) return json({ error: "payment_required" }, { status: 402 });

  const id = new URL(request.url).searchParams.get("id");
  const markdown = CHAPTERS[id];
  if (!markdown) return json({ error: "not_found" }, { status: 404 });

  return json({ id, markdown });
}
