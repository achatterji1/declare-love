import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { publicState } from "@/lib/declare-engine";
import { requireUser } from "@/lib/declare-auth.server";
import { advanceAndSave, loadWallet, seatAuthorized } from "@/lib/declare-store.server";
import { walletView } from "@/lib/declare-table.server";

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

        try {
          const user = await requireUser(request);
          const room = await advanceAndSave(code.toUpperCase());
          if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
          if (!seatAuthorized(room, seat, token)) {
            return Response.json({ error: "unauthorized" }, { status: 401 });
          }
          const sitting = room.seats[seat];
          if (sitting?.playerId && sitting.playerId !== user.id) {
            return Response.json({ error: "unauthorized" }, { status: 401 });
          }
          const playerId = room.seats[seat]?.playerId;
          const wallet = playerId ? await loadWallet(playerId) : null;
          return Response.json({ state: publicState(room, seat), wallet: wallet ? walletView(wallet) : null });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unauthorized";
          return Response.json({ error: msg }, { status: msg === "unauthorized" ? 401 : 400 });
        }
      },
    },
  },
});
