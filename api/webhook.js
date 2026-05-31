import Stripe from "stripe";
import { markPaid } from "../lib/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// The Web-API signature gives us the raw body via request.text(), which is
// exactly what Stripe's signature verification needs.
export async function POST(request) {
  const sig = request.headers.get("stripe-signature");
  const raw = await request.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, webhookSecret);
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const s = event.data.object;
      const email = s.metadata?.email || s.client_reference_id || s.customer_email;
      if (email && s.payment_status === "paid") {
        await markPaid(String(email).toLowerCase(), {
          stripeSessionId: s.id,
          stripeCustomerId: s.customer || null,
        });
      }
    }
  } catch (err) {
    // Returning 500 tells Stripe to retry delivery.
    console.error("webhook handler error", err);
    return new Response("handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
