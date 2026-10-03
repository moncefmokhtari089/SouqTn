import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// STATIC checks on the SQL text. They guard against accidental regressions of the
// hardening but do NOT execute SQL: behaviour is verified by supabase/tests/security.sql.
const sql = readFileSync(path.resolve(__dirname, "../../drizzle/migrations/0003_security_hardening.sql"), "utf8");
const gitignore = readFileSync(path.resolve(__dirname, "../../.gitignore"), "utf8");

describe("0003 security hardening (static)", () => {
  it("guards listing status and seller_id at the database level", () => {
    expect(sql).toMatch(/create trigger listings_guard_status before update on public\.listings/);
    expect(sql).toMatch(/old\.status = 'sold'/);
    expect(sql).toMatch(/new\.status = 'sold'/);
    expect(sql).toMatch(/new\.seller_id is distinct from old\.seller_id/);
  });

  it("restricts expire_unpaid_orders and settle_payment to service_role", () => {
    expect(sql).toMatch(/revoke all on function public\.expire_unpaid_orders\(integer\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.expire_unpaid_orders\(integer\) to service_role/);
    expect(sql).toMatch(/grant execute on function public\.settle_payment\(text, text, text, jsonb\) to service_role/);
    expect(sql).not.toMatch(/grant execute on function public\.(expire_unpaid_orders|settle_payment)[^;]*authenticated;/);
  });

  it("only expires pending online orders awaiting payment, and never paid ones", () => {
    expect(sql).toMatch(/o\.status = 'pending' and o\.payment_status = 'awaiting_payment'/);
    expect(sql).toMatch(/payment_method not in \('cod', 'wallet'\)/);
    expect(sql).toMatch(/t\.status = 'succeeded'/);
    expect(sql).toMatch(/skip locked/);
  });

  it("flags late payments instead of completing or dropping them", () => {
    expect(sql).toMatch(/late_payment_flagged/);
    expect(sql).toMatch(/payment_status = 'refund_pending'/);
  });

  it("blocks refund_pending/refunded from returning to paid", () => {
    expect(sql).toMatch(/create trigger orders_guard_payment_status/);
  });

  it("rate-limits messages and conversations server-side", () => {
    expect(sql).toMatch(/create trigger messages_guard_rate before insert on public\.messages/);
    expect(sql).toMatch(/>= 15/);
    expect(sql).toMatch(/>= 3/);
  });

  it("tightens storage: own-folder writes, path depth, extensions, bucket limits", () => {
    expect(sql).toMatch(/file_size_limit = 5242880/);
    expect(sql).toMatch(/array_length\(storage\.foldername\(name\), 1\) = 2/);
    expect(sql).toMatch(/lower\(storage\.extension\(name\)\) in \('jpg', 'jpeg', 'png', 'webp'\)/);
    expect(sql).not.toMatch(/create policy "Anyone can view avatars and listing photos"/);
  });

  it("ignores .env files", () => {
    expect(gitignore).toMatch(/^\.env$/m);
  });
});
