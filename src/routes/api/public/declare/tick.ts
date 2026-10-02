import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applyTimers } from "@/lib/declare-engine";
import { loadRoom, saveRoom, writeViews } from "@/lib/declare-store.server";

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
        const code = parsed.data.code.toUpperCase();
        const room = await loadRoom(code);
        if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
        if (applyTimers(room)) {
          try {
            await saveRoom(room);
            await writeViews(room);
          } catch {
            // Concurrent writer won; timers are idempotent, so this is fine.
          }
        }
        return Response.json({ ok: true });
      },
    },
  },
});
