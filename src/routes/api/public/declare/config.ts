import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/declare/config")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
        const key =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
        if (!url || !key) {
          return Response.json({ error: "Realtime not configured." }, { status: 500 });
        }
        return Response.json({ url, key });
      },
    },
  },
});
