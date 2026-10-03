import { createFileRoute } from "@tanstack/react-router";

// Server route (POST only). Requires "Authorization: Bearer <LOVABLE_CRON_SECRET>".
// UNVERIFIED in this repo: no scheduler is registered yet and the build was not run. See SECURITY.md.
export const Route = createFileRoute("/api/public/cron/expire-orders")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { handleExpireOrders } = await import("@/lib/expire-orders.server");
        return handleExpireOrders(request);
      },
    },
  },
});
