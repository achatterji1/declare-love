import { createFileRoute } from "@tanstack/react-router";
import { authConfig } from "@/lib/declare-auth.server";

export const Route = createFileRoute("/api/public/declare/config")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await authConfig());
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Realtime not configured.";
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
