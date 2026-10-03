import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const EXPIRE_AFTER_MINUTES = 30;

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Server-only handler: expires unpaid online orders. Trusted callers only
 * (Bearer LOVABLE_CRON_SECRET). The service-role client never reaches the browser.
 */
export async function handleExpireOrders(
  request: Request,
  getAdmin: () => Promise<RpcClient> = async () =>
    (await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as RpcClient,
): Promise<Response> {
  const denied = await authenticateCronRequest(request);
  if (denied) return denied;

  const admin = await getAdmin();
  const { data, error } = await admin.rpc("expire_unpaid_orders", { p_minutes: EXPIRE_AFTER_MINUTES });
  if (error) {
    console.error("[cron] expire_unpaid_orders failed:", error.message);
    return Response.json({ ok: false }, { status: 500 });
  }
  return Response.json({ ok: true, expired: Number(data ?? 0) });
}
