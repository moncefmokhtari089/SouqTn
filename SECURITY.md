# SECURITY.md — SouqTN hardening (migration 0003)

Status: **written and reviewed statically. Nothing was executed**: no Postgres, no network, no `node_modules` in the authoring sandbox (no build, no vitest, no SQL run). Apply on a staging branch first, then run the checks below.

## What 0003 changes
| Area | Change |
|---|---|
| Listings | Trigger `guard_listing_status`: clients cannot edit a sold listing, set `sold`, or change `seller_id`. Normal edits / archive / re-activate still work. `create_order`, `update_order_status`, `expire_unpaid_orders` (SECURITY DEFINER) are unaffected. |
| Expiry | `expire_unpaid_orders(minutes=30)`: only `pending` + `awaiting_payment` online orders, skips any order with a succeeded transaction, `SKIP LOCKED`, idempotent, releases a listing only if no other live order holds it, writes `order_expired` event, moves no money. Callable by `service_role` only. |
| Late payment | `settle_payment` no longer drops or completes a success arriving for a cancelled/expired/failed transaction or closed order: order → `refund_pending`, transaction keeps `cancelled` with reason `late_payment_refund_required`, event `late_payment_flagged` (once). `_apply_payment_success` also refuses `refund_pending/refunded`. |
| Refund safety | Trigger `guard_order_payment_status`: `refund_pending`/`refunded` can never return to `paid`. Explicit REVOKE of all client writes on orders, order_items, transactions, wallets, wallet_transactions, payment_events, payment_providers. Wallet refunds already have a unique reference (no duplicates). |
| Messaging | Triggers/limits in DB: messages 15/min and 300/h per user, max 3 identical bodies / 5 min per conversation; new conversations 3/h per seller, 10/h and 30/day per buyer (re-opening an existing conversation is free). |
| Storage | Bucket limits 5 MB + JPEG/PNG/WebP. Uploads: authenticated, own folder only, exact path depth (avatars 1, listings 2), safe extensions. Listing photo read: owner, photos of ACTIVE listings, photos of orders you are party to (public browsing keeps working). Avatars stay publicly readable on purpose (shown on seller cards/chats). |
| Env | `.env` added to `.gitignore`. |

## Bug found and fixed on the way
`_apply_payment_success` (0002) named `order_id` as a target column but passed no value (8 columns, 7 values). It fails at runtime for every wallet/online payment, and seller proceeds could never be matched by `order_id` on delivery/cancel. Fixed in 0003.

## Secrets scan
No hard-coded secret found (only publishable Supabase keys in `.env`, which may stay client-side). `.env` is still tracked in the archive: run `git rm --cached .env` if the repo is shared. The service-role key is read only from server env in `client.server.ts`.

## STILL REQUIRED — scheduler (not active)
`expire_unpaid_orders` does nothing until scheduled. Options:
1. **pg_cron** (preferred, no key leaves Postgres): `select cron.schedule('expire-unpaid-orders','*/5 * * * *',$$select public.expire_unpaid_orders(30)$$);` (needs the extension enabled).
2. **HTTP**: `POST /api/public/cron/expire-orders` with `Authorization: Bearer $LOVABLE_CRON_SECRET` every 5 min. The route file was written against the TanStack Start version in `package.json` but **the build was not run**; no schedule is registered.

## STILL MISSING — refunds & providers
- No refund processor. `refund_pending` orders (paid online then cancelled, or late payments) need **manual** refund by an operator, then `payment_status='refunded'` via service role.
- Providers `card`, `d17`, `flouci` are `enabled=false` and have **no integration and no webhook endpoint**. Do not enable them until a signed-webhook handler calling `settle_payment` exists.

## Remaining issues
- Orders whose payment failed stay `pending` with the listing locked (expiry deliberately handles only `awaiting_payment`).
- A buyer can still lock a listing with an unpaid COD order until cancelling it (no COD expiry).
- Avatar bucket is publicly enumerable by design; listing-photo reads are now restricted.
- Bucket MIME/size limits rely on the Storage API; direct SQL inserts bypass them.
- Messaging limits are per account: no CAPTCHA/IP limiting at signup.

## RLS review (from the policies in 0000–0002 + 0003)
Verified by reading: listings update/delete only own rows (+ new trigger); `seller_id` immutable for clients; orders/transactions/wallet tables are SELECT-only for clients; messages insert requires `sender_id = auth.uid()` and participation; profiles/wallet/payment data owner- or party-scoped; public seller data only via `get_public_profiles` / `get_public_sellers`. Nothing was weakened.

## Tests
- `supabase/tests/security.sql` — DB behaviour (sold revive, mark sold, foreign listing, seller_id, money-table writes, service-role-only RPCs, expiry + idempotence, late payment, sender spoofing, message flood, conversation limit, storage rejections). Rolled back at the end. **Not yet run.**
- `src/test/expire-orders-handler.test.ts`, `src/test/security-migration.test.ts` — `npm test`. **Not yet run.** The second is static text matching only.
