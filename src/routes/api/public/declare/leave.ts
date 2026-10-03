import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
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
            if (r.status === "lobby") {
              const sitting = r.seats[seat];
              const stake = (r.stakes || []).find((row) => row.seat === seat && sitting && row.playerId === sitting.playerId);
              r.seats[seat] = null;
              if (stake) {
                r.stakes = (r.stakes || []).filter((row) => row !== stake);
                r.pot = Math.max(0, (r.pot || 0) - stake.amount);
                r.payouts = [{ playerId: stake.playerId, amount: stake.amount, key: r.code + ":leave:" + seat + ":" + r.version + ":" + stake.amount }];
              }
              return;
            }
            if (r.tier && r.status !== "ended") {
              r.payouts = (r.stakes || []).map((row) => ({
                playerId: row.playerId,
                amount: row.amount,
                key: r.code + ":abandon:" + row.seat + ":" + r.version,
              }));
              r.pot = 0;
              r.stakes = [];
            }
            // Quit (and a mid-game disconnect) sends every client back to setup.
            r.status = "abandoned";
          });
        } catch {
          // Best-effort leave (also used via sendBeacon); never error loudly.
        }
        return Response.json({ ok: true });
      },
    },
  },
});
