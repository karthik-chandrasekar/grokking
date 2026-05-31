import Stripe from "stripe";
import { json } from "../lib/http.js";
import { getSession } from "../lib/auth.js";
import { getUser, markPaid } from "../lib/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Called right after the Stripe redirect so the user unlocks instantly,
// without waiting for the (authoritative) webhook to land.
export async function GET(request) {
  const sess = getSession(request);
  if (!sess?.sub) return json({ error: "Please log in first." }, { status: 401 });

  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) return json({ error: "Missing session_id." }, { status: 400 });

  let checkout;
  try {
    checkout = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return json({ paid: false }, { status: 400 });
  }

  const email = checkout?.metadata?.email || checkout?.client_reference_id;
  const paidNow = checkout?.payment_status === "paid";

  // Only credit the logged-in user, and only if the session belongs to them.
  if (paidNow && email && email === sess.sub) {
    await markPaid(sess.sub, {
      stripeSessionId: sessionId,
      stripeCustomerId: checkout.customer || null,
    });
    return json({ paid: true });
  }

  const user = await getUser(sess.sub);
  return json({ paid: !!user?.paid });
}
