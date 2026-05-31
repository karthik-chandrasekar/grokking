# Grokking GenAI

A paid, auth-gated single-page e-book for **grokkinggenai.com**: an interview-prep
reference covering LLMs, VLMs, and Vision-Language-Action models — 15 topics, 750
interview questions, and 150 essential papers.

- **Minimal landing** → *"Lets hard Grok the GenAI universe"* with **Create account** / **Log in**.
- **Create account** → email + password → **one-time $100** Stripe payment → full access.
- **All chapter content is gated.** It lives on the server (`lib/content.js`) and is
  served from `/api/content` only to a signed-in, paid reader — so it is never present
  in the page source.

---

## How it works

| Concern | Approach |
| --- | --- |
| **Frontend** | One static `index.html` (hash router, reader, light/dark, KaTeX + highlight.js). No build step. |
| **Backend** | Vercel **Serverless Functions** in `/api` using the Web-API signature (`export async function POST(request)`). |
| **Accounts** | Email + password. Passwords hashed with `scrypt`; sessions are HMAC-signed tokens in an `HttpOnly` cookie. No auth library. |
| **Database** | **Upstash Redis** (`@upstash/redis`) — one record per user: `user:<email>`. |
| **Payments** | **Stripe Checkout** (`mode: payment`, $100 inline price). A webhook marks the user paid (authoritative); a post-redirect `/api/confirm` unlocks instantly. |
| **Content protection** | Chapters are sent by `/api/content?id=…` only when the session is valid **and** `paid: true` (else `401`/`402`). |

```
.
├── index.html            # the whole frontend (landing + reader)
├── package.json          # ESM; deps: stripe, @upstash/redis
├── vercel.json           # function maxDuration (no "builds" key — keeps static serving)
├── .env.example          # the variables you need to set
├── lib/
│   ├── content.js        # ← all 15 chapters (server-only)
│   ├── auth.js           # scrypt hashing, session tokens, cookies
│   ├── db.js             # Upstash Redis user store
│   └── http.js           # JSON Response helper
└── api/
    ├── signup.js  login.js  logout.js  me.js
    ├── checkout.js  confirm.js  webhook.js
    └── content.js        # gated chapter delivery
```

---

## Deploy to Vercel

### 1. Push to GitHub
Create a new repo and push this folder.

### 2. Import to Vercel
New Project → import the repo. **Framework Preset: “Other.”** Leave build/output
settings empty — Vercel serves `index.html` statically and auto-detects `/api`.

### 3. Add the database (Upstash Redis)
In the project’s **Storage** tab → **Marketplace** → **Upstash → Redis** → create/link a
database. Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically
(the code reads those *or* `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).

### 4. Set environment variables
Project → **Settings → Environment Variables**:

| Variable | Value |
| --- | --- |
| `AUTH_SECRET` | a long random string — run `openssl rand -hex 32` |
| `STRIPE_SECRET_KEY` | from Stripe → Developers → API keys (`sk_live_…` / `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | from step 5 (`whsec_…`) |

(The Upstash variables from step 3 are already there.)

### 5. Create the Stripe webhook
Stripe Dashboard → **Developers → Webhooks → Add endpoint**:
- **URL:** `https://grokkinggenai.com/api/webhook`
- **Events:** `checkout.session.completed` and `checkout.session.async_payment_succeeded`

Copy the endpoint’s **Signing secret** into `STRIPE_WEBHOOK_SECRET`, then **redeploy**
so the variable takes effect.

### 6. Connect the domain
Project → **Settings → Domains** → add `grokkinggenai.com`, then point the domain’s DNS
at Vercel per the records it shows (an `A` record for the apex, `CNAME` for `www`).

That’s it — visit the site, create an account, and pay to unlock.

> **Test it first:** use a Stripe **test** key and the test card `4242 4242 4242 4242`
> (any future expiry / any CVC). Switch to live keys when you’re ready.

---

## Local development

```bash
npm install
cp .env.example .env      # fill in the five values
npm i -g vercel
vercel dev                # serves index.html + /api on http://localhost:3000
```

For local Stripe webhooks: `stripe listen --forward-to localhost:3000/api/webhook`
and use the `whsec_…` it prints as your local `STRIPE_WEBHOOK_SECRET`.

---

## Common tasks

- **Edit / add chapters:** they’re plain Markdown strings in `lib/content.js`
  (KaTeX `$…$` math and fenced code blocks are supported). Add a matching entry to the
  `BOOK` array in `index.html` so it appears in the table of contents.
- **Change the price:** edit `PRICE_CENTS` in `api/checkout.js` (and the `$100` copy in
  `index.html`).
- **Comp someone free access:** set `paid: true` on their `user:<email>` record in the
  Upstash console.
- **Pricing model:** one-time **$100**, all content unlocked at once (no per-chapter
  free/locked split).
