import Stripe from "stripe";
import { json } from "../lib/http.js";
import { getSession } from "../lib/auth.js";
import { getUser } from "../lib/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PRICE_CENTS = 10000; // $100.00, one-time

export async function POST(request) {
  const sess = getSession(request);
  if (!sess?.sub) return json({ error: "Please log in first." }, { status: 401 });

  const user = await getUser(sess.sub);
  if (!user) return json({ error: "Account not found." }, { status: 401 });
  if (user.paid) return json({ alreadyPaid: true });

  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host");
  const base = process.env.SITE_URL || `${proto}://${host}`;

  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: PRICE_CENTS,
          product_data: {
            name: "Grokking GenAI — full access",
            description:
              "Lifetime access to all 15 topics: 750 interview questions and 150 essential papers.",
          },
        },
      },
    ],
    customer_email: user.email,
    client_reference_id: user.email,
    metadata: { email: user.email },
    allow_promotion_codes: true,
    success_url: `${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?checkout=cancelled`,
  });

  return json({ url: checkout.url });
}
