import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applyTimers, publicState } from "@/lib/declare-engine";
import { loadRoom, saveRoom, seatAuthorized, writeViews } from "@/lib/declare-store.server";

const Body = z.object({
  code: z.string().trim().min(1).max(8),
  seat: z.number().int().min(0).max(7),
  token: z.string().min(1),
});

export const Route = createFileRoute("/api/public/declare/state")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid state request." }, { status: 400 });
        }
        const { code, seat, token } = parsed.data;

        const room = await loadRoom(code.toUpperCase());
        if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
        if (!seatAuthorized(room, seat, token)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        if (applyTimers(room)) {
          try {
            await saveRoom(room);
            await writeViews(room);
          } catch {
            // A concurrent writer won; reload and serve its state.
            const fresh = await loadRoom(room.code);
            if (fresh) return Response.json({ state: publicState(fresh, seat) });
          }
        }
        return Response.json({ state: publicState(room, seat) });
      },
    },
  },
});
