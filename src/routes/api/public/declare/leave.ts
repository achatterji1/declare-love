import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { leaveSeat } from "@/lib/declare-engine";
import { mutateRoom, seatAuthorized } from "@/lib/declare-store.server";

const Body = z.object({
  code: z.string().trim().min(1).max(8),
  seat: z.number().int().min(0).max(7),
  token: z.string().min(1),
});

export const Route = createFileRoute("/api/public/declare/leave")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ ok: true });
        const { code, seat, token } = parsed.data;
        try {
          await mutateRoom(code.toUpperCase(), (r) => {
            if (!seatAuthorized(r, seat, token)) return;
            leaveSeat(r, seat);
          });
        } catch {
          // Best-effort leave (also used via sendBeacon); never error loudly.
        }
        return Response.json({ ok: true });
      },
    },
  },
});
