import { afterEach, describe, expect, it, vi } from "vitest";
import { handleExpireOrders } from "@/lib/expire-orders.server";

const req = (auth?: string) =>
  new Request("https://x.test/api/public/cron/expire-orders", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

afterEach(() => {
  delete process.env.LOVABLE_CRON_SECRET;
  vi.restoreAllMocks();
});

describe("expire-orders cron handler", () => {
  it("returns 500 when the cron secret is not configured", async () => {
    const admin = vi.fn();
    expect((await handleExpireOrders(req("Bearer abc"), admin as never)).status).toBe(500);
    expect(admin).not.toHaveBeenCalled();
  });

  it("rejects missing and wrong tokens without touching the database", async () => {
    process.env.LOVABLE_CRON_SECRET = "right-secret";
    const admin = vi.fn();
    expect((await handleExpireOrders(req(), admin as never)).status).toBe(401);
    expect((await handleExpireOrders(req("Bearer wrong"), admin as never)).status).toBe(401);
    expect(admin).not.toHaveBeenCalled();
  });

  it("calls expire_unpaid_orders(30) for a valid token", async () => {
    process.env.LOVABLE_CRON_SECRET = "right-secret";
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });
    const res = await handleExpireOrders(req("Bearer right-secret"), async () => ({ rpc }));
    expect(rpc).toHaveBeenCalledWith("expire_unpaid_orders", { p_minutes: 30 });
    expect(await res.json()).toEqual({ ok: true, expired: 2 });
  });

  it("hides database errors from the caller", async () => {
    process.env.LOVABLE_CRON_SECRET = "right-secret";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom secret detail" } });
    const res = await handleExpireOrders(req("Bearer right-secret"), async () => ({ rpc }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
  });
});
