import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "@/lib/declare-auth.server";
import { advanceAndSave } from "@/lib/declare-store.server";

const Body = z.object({
  code: z.string().trim().min(1).max(8),
});

// Advances a room's deadlines. The caller must be signed in.
export const Route = createFileRoute("/api/public/declare/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid tick request." }, { status: 400 });
        }
        try {
          await requireUser(request);
        } catch {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        const room = await advanceAndSave(parsed.data.code.toUpperCase());
        if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
        return Response.json({ ok: true });
      },
    },
  },
});
