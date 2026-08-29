# Pnyxy edge functions

Deno edge functions deployed to Supabase. Shared code lives in `_shared/`:

- `deno-shim.ts`: the `Deno` global declaration for editor type-checking (import once per function).
- `http.ts`: `buildCorsHeaders(origin, methods)`, `corsFor(req)`, `handleOptions(req)`, `json(status, body, cors)`, `jsonError(status, code, message, cors)`, `jsonErrorPublic(status, code, cors)` (never echoes internal error text), `sanitizeErrorForClient(err)` (reduces a caught error to a safe code).
- `auth.ts`: `requireUser(req, { onError, persistSession })` resolves the signed-in user (or returns the caller's own error Response).
- `tokens.ts`: `estimateTokens`, `hashIp` (HMAC-SHA256), `ipHashSalt` (fails closed if `IP_HASH_SALT` unset), `getClientIp` for the anonymous AI quota path; `GROUNDED_REQUEST_SURCHARGE_TOKENS` flat token surcharge for grounded chat requests.
- `safe-fetch.ts`: `assertPublicHttpUrl(url)` and `safeFetch(url, init)`, an SSRF-safe fetch (blocks private/loopback/link-local IPs and DNS-rebinding, follows redirects with the check re-applied, enforces a byte cap on the streamed body and a timeout covering the whole operation). Used by `fetch-url-proxy` and `catalog-fetch`.

## CORS policy

Browser-facing functions no longer send `Access-Control-Allow-Origin: *`. The request `Origin` is reflected only when it is on the allow-list, otherwise the header is omitted and the browser blocks the read. `Vary: Origin` is always set.

The allow-list comes from the `ALLOWED_ORIGINS` secret (comma-separated). When unset, the default is:

```
https://pnyxy.com,https://www.pnyxy.com,http://localhost:5173,http://localhost:4173,tauri://localhost,http://tauri.localhost
```

Add preview/staging origins with:

```
supabase secrets set ALLOWED_ORIGINS="https://pnyxy.com,https://www.pnyxy.com,http://localhost:5173,http://localhost:4173,tauri://localhost,http://tauri.localhost,https://staging.example"
```

`stripe-webhook` is server-to-server (Stripe calls it) and sends no CORS headers.

## Platform env vars

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are auto-populated on every function. Everything else is set with `supabase secrets set KEY=value`.

## Functions

### ai-chat-proxy

- Purpose: streams LLM responses to the browser as Anthropic-style SSE while enforcing per-user (or per-IP) daily quotas tracked in Postgres (`check_and_record_ai_usage_user` / `_anon`). OpenAI-compatible upstreams are tried in priority order (Gemini Flash-Lite, Gemini Flash, OpenAI, Gemini 3), Anthropic is the last fallback. Tool-use mode (`tools` + `toolMessages`) walks the same OpenAI-compat chain with function calling (the OpenAI `tool_calls` stream is converted to Anthropic-style `content_block_start` / `input_json_delta` / `content_block_stop` events, tool blocks at index 1+n) and falls back to Anthropic, whose SSE is forwarded verbatim; a `preferredModel` pin narrows tool turns the same way as plain ones. All upstreams are normalised to one SSE shape.
- Auth: optional. Signed-in users are billed against their own quota. Anonymous callers are bucketed by a salted hash of their IP. `verify_jwt = false` in `config.toml`.
- Web search: Google Search grounding runs on the Gemini-3 tier through Gemini's **native** `streamGenerateContent` (`tools: [{ google_search: {} }]`); the OpenAI-compat endpoint rejects the tool for chat models (`Unknown name "tools" at 'extra_body.google'`), which used to 400 every grounded attempt. It is automatic for standalone chats (empty `documentTitle`, no cheaper-model pin) and forced by the body's `webSearch: true` (composer toggle) in every chat, pin or not; the grounded attempt is pre-billed with `GROUNDED_REQUEST_SURCHARGE_TOKENS`.
- Direct-video mode: when the body carries `videoContext: { url, startSec?, endSec?, durationSec? }` (the YouTube resource side-chat's "Video (Gemini)" option) the request bypasses the OpenAI-compat chain and calls Gemini's native `streamGenerateContent` with a `file_data` part referencing the YouTube URL (clipped via `video_metadata` start/end offsets, `MEDIA_RESOLUTION_LOW`). Only YouTube hosts are accepted; only Gemini tiers are tried (a Gemini pin narrows to that model, other pins are ignored) and there is no Anthropic/OpenAI fallback. The clip length (or the whole video, capped at 3600 s) is pre-billed at 100 tokens/s on top of the usual estimate.
- Anonymous IP resolution: `cf-connecting-ip`, else the LAST element of `x-forwarded-for` (the hop appended by the trusted proxy; the first element is client-supplied and spoofable), else `x-real-ip`. When no IP can be derived the request falls into one shared `no-ip` bucket instead of being rejected.
- Env vars:
  - `GEMINI_API_KEY`: Google AI Studio key, OpenAI-compatible endpoint, cheapest, tried first.
  - `OPENAI_API_KEY`: OpenAI key, next fallback.
  - `ANTHROPIC_API_KEY`: Anthropic key, final fallback for plain chat and tool-use mode.
  - At least one of the three must be set.
  - `IP_HASH_SALT`: secret salt for hashing anonymous IPs (HMAC-SHA256). Required: `ipHashSalt()` now fails closed (throws) when unset, instead of falling back to `SUPABASE_SERVICE_ROLE_KEY`, so the anonymous path 500s until it is set. Set it with `supabase secrets set IP_HASH_SALT=$(openssl rand -hex 32)` before enabling `ALLOW_ANON_CHAT`. Note: changing the salt resets the anonymous buckets (old hashes no longer match).
  - `ALLOWED_ORIGINS`: see CORS policy.
- Deploy: `supabase functions deploy ai-chat-proxy`

### catalog-fetch

- Purpose: server-side CORS bypass for downloading public-domain books from Project Gutenberg / Internet Archive / Standard Ebooks / MEK when the upstream does not send permissive CORS headers. Tight host whitelist (not a general proxy), HEAD size sanity check (50 MB cap), streams the body back with the upstream content type.
- Auth: required (Bearer JWT, checked in the function). Default `verify_jwt` (true).
- Env vars: `ALLOWED_ORIGINS` (optional).
- Deploy: `supabase functions deploy catalog-fetch`

### fetch-url-proxy

- Purpose: URL to file proxy used when the browser's direct fetch in `url-to-file.ts` fails on CORS. SSRF guard on private / loopback / link-local IPs, 100 MB cap matching the client, 30 s timeout, mime allow-list (PDF / EPUB / TXT / MD).
- Auth: required (Bearer JWT, checked in the function). Default `verify_jwt` (true).
- Env vars: `ALLOWED_ORIGINS` (optional).
- Deploy: `supabase functions deploy fetch-url-proxy`

### ingest-url

- Purpose: turns a URL into a library "resource" (beta). YouTube links resolve to title / author / thumbnail via the public oEmbed API, plus a best-effort caption transcript (`transcript`: `[{start, dur, text}]`, `transcript_lang`; migration 00074) scraped from the watch page's caption track list (preferring hu, then en, human over auto-generated; capped at 6000 cues). The scrape has no official API behind it and can be blocked for datacenter IPs, in which case `transcript` is null and the resource is still saved (the viewer offers a retry). Other pages are reduced to markdown via Jina Reader (`r.jina.ai`, keyless free tier, rate-limited). Content is capped at 200k chars. The client degrades to saving a bare link if this function is absent.
- Auth: `verify_jwt = true` in `config.toml` (gateway enforces a signed-in caller); the function additionally calls `requireUser()` for a verified user id. Rate limited to 30 ingests/day per user via `bump_rate_limit` (migration 00073), key `ingest:<uid>`; over the cap returns `429 rate_limited`.
- Env vars: none beyond `ALLOWED_ORIGINS` (optional).
- Deploy: `supabase functions deploy ingest-url`

### send-feedback

- Purpose: relays a subject + body from the browser to the feedback inbox via Resend, attaching the signed-in user's email + id (as `reply_to`) when a session is present.
- Auth: optional; anonymous feedback is accepted. Note that `config.toml` does not override `verify_jwt` for this function, so the gateway default applies. Rate limited via `bump_rate_limit` (migration 00073): 10/day for a signed-in user (key `feedback:<uid>`), 2/day for anonymous senders keyed by a salted hash of their IP (key `feedback:<hash>`). Anonymous senders are rejected (`403 sign_in_required`) when `IP_HASH_SALT` isn't set, since there's no safe way to bucket them otherwise.
- Env vars:
  - `RESEND_API_KEY`: required, from https://resend.com/api-keys.
  - `FEEDBACK_FROM`: `"Name <sender@verified-domain>"` (default `Pnyxy Feedback <onboarding@resend.dev>`, the Resend sandbox; swap for a verified domain).
  - `FEEDBACK_TO`: destination inbox (default `feedback@pnyxy.com`).
  - `IP_HASH_SALT`: required for anonymous feedback to be rate limited (see `tokens.ts` above); signed-in feedback doesn't need it.
  - `ALLOWED_ORIGINS` (optional).
- Deploy: `supabase functions deploy send-feedback`

### stripe-checkout

- Purpose: creates a Stripe Checkout Session (subscription mode) for the signed-in user. Reuses the existing Stripe customer from `profiles.stripe_customer_id` so repeat upgrades do not create duplicates, attaches `user_id` as metadata on both the session and the resulting subscription (`subscription_data[metadata]`) so every later webhook event maps back to the account, and returns `{ url }` for the browser to redirect to Stripe's hosted checkout. Card data never touches our code.
- Auth: required. `verify_jwt = true`; the function re-reads the JWT for the user id + email.
- Env vars:
  - `STRIPE_SECRET_KEY`: the `sk_...` secret key (test or live).
  - `STRIPE_PRICE_ID`: the recurring Price id for Premium (`price_...`).
  - `SITE_URL`: optional fallback origin for success / cancel URLs when the request body carries no usable `origin`.
  - `ALLOWED_ORIGINS` (optional).
- Deploy: `supabase functions deploy stripe-checkout`

### stripe-portal

- Purpose: creates a Stripe Billing Customer Portal session for the signed-in premium user (cancel, switch plan, update card, view invoices, all hosted by Stripe) and returns `{ url }`. On cancel Stripe fires `customer.subscription.updated` / `.deleted`, which `stripe-webhook` translates back to `storage_tier = 'free'`. The Customer Portal must be enabled once in the Stripe dashboard (Settings, Billing, Customer portal) or the API errors about a missing configuration.
- Auth: required. `verify_jwt = true`.
- Env vars: `STRIPE_SECRET_KEY`, `SITE_URL` (optional fallback for the return URL), `ALLOWED_ORIGINS` (optional).
- Deploy: `supabase functions deploy stripe-portal`

### stripe-webhook

- Purpose: Stripe (Managed Payments) subscription webhook. Stripe is the Merchant of Record (sells to the customer, remits VAT / sales tax, handles disputes) and notifies us when a subscription changes; we translate those events into `profiles.storage_tier` (`free` | `premium`) plus billing bookkeeping columns. Flow: verify the `Stripe-Signature` header (`t=<unix>` plus `v1=<hex>` HMAC-SHA256 over `${t}.${rawBody}` with the webhook secret, 5 minute replay tolerance), read `event.type` + `event.data.object`, resolve our user from `metadata.user_id` (fallback: lookup by `stripe_customer_id`), then update the profile with the service role, which bypasses RLS and the `protect_billing_columns` trigger (migration 00049). `active` / `trialing` / `past_due` keep premium; everything else maps to free.
- Auth: Stripe signature, not a user JWT. `verify_jwt = false` in `config.toml`. No CORS headers (server-to-server).
- Env vars:
  - `STRIPE_WEBHOOK_SECRET`: the `whsec_...` signing secret shown when creating the endpoint in the Stripe dashboard.
  - `SUPABASE_SERVICE_ROLE_KEY`: platform-provided, needed to write the protected columns.
- Deploy: `supabase functions deploy stripe-webhook --no-verify-jwt`

## Deploy everything

```
supabase functions deploy
```

(`config.toml` carries the per-function `verify_jwt` settings, so a bare deploy applies them.)
