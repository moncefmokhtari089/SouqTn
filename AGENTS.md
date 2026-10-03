<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## SouqTN
- `src/components/souq-app.tsx` is the whole app shell, rendered from `__root`; route files only supply head() metadata and keep URLs valid. Why: faithful port of the original single-file Replit app.
- Photos live in private storage buckets readable via a storage policy; DB stores paths and the client resolves signed URLs (`src/lib/supabase.ts`). Why: workspace blocks public buckets.
- Profiles are created client-side on first sign-in from sign-up metadata (no auth-schema triggers). Why: auth schema is off-limits.
- Public seller data is read only through the `get_public_profiles` security-definer RPC (safe columns); `profiles` RLS stays owner-only. Why: keeps phone/bio private without column-level policies.
- Favorites and notifications live in the database (`src/hooks/use-member-data.ts`); notifications are inserted only server-side (triggers). Why: clients may only read/mark-read their own.
- Messaging, orders, payments and wallet logic live in security-definer Postgres functions (create_order, update_order_status, confirm_cod_payment, start_conversation, request_withdrawal); clients only read via RLS. Why: sensitive state changes are validated server-side.
- Wallet balance is always derived from wallet_transactions (unique reference per entry), never stored. Why: ledger stays the single source of truth.
- Online payment settlement goes only through service-role settle_payment, called by a verified provider webhook. Why: never trust browser payment status.
