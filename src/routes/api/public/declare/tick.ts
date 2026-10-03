import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { advanceAndSave } from "@/lib/declare-store.server";

const Body = z.object({
  code: z.string().trim().min(1).max(8),
});

// Idempotent deadline advancement — safe for any client to call.
export const Route = createFileRoute("/api/public/declare/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid tick request." }, { status: 400 });
        }
        const room = await advanceAndSave(parsed.data.code.toUpperCase());
        if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
        return Response.json({ ok: true });
      },
    },
  },
});
