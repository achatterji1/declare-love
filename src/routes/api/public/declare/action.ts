import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { handleAction, publicState } from "@/lib/declare-engine";
import { requireUser } from "@/lib/declare-auth.server";
import { creditWalletOnce, loadRoom, loadWallet, mutateRoom, seatAuthorized } from "@/lib/declare-store.server";
import { chargeNextHand, walletView } from "@/lib/declare-table.server";

const Body = z
  .object({
    code: z.string().trim().min(1).max(8),
    seat: z.number().int().min(0).max(7),
    token: z.string().min(1),
    action: z.string().min(1).max(32),
  })
  .loose();

export const Route = createFileRoute("/api/public/declare/action")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid action request." }, { status: 400 });
        }
        const { code, seat, token, action, ...rest } = parsed.data;

        const upper = code.toUpperCase();
        let redealStakes: { playerId: string; seat: number; amount: number }[] | null = null;
        try {
          const user = await requireUser(request);
          if (action === "redeal") {
            const preview = await loadRoom(upper);
            const roundOver = !!preview?.G && (preview.G.phase === "reveal" || preview.status === "ended");
            if (preview?.tier && roundOver) redealStakes = await chargeNextHand(preview);
          }
          const { room, result } = await mutateRoom(upper, (r) => {
            if (!seatAuthorized(r, seat, token)) throw new Error("unauthorized");
            const sitting = r.seats[seat];
            if (sitting?.playerId && sitting.playerId !== user.id) throw new Error("unauthorized");
            if (redealStakes && r.tier) {
              const roundOver = !!r.G && (r.G.phase === "reveal" || r.status === "ended");
              if (!roundOver) throw new Error("That hand already started.");
              r.pot = redealStakes.reduce((sum, row) => sum + row.amount, 0);
              r.stakes = redealStakes;
              r.payouts = null;
            }
            const applied = handleAction(r, seat, { action, ...rest });
            if (redealStakes && r.G?.phase !== "memorize") throw new Error("Could not start the next hand.");
            return applied;
          });
          const playerId = room.seats[seat]?.playerId;
          const wallet = playerId ? await loadWallet(playerId) : null;
          const body: { state: ReturnType<typeof publicState>; applied?: boolean; wallet?: ReturnType<typeof walletView> | null } = {
            state: publicState(room, seat),
            wallet: wallet ? walletView(wallet) : null,
          };
          if (action === "drag") body.applied = result === true;
          return Response.json(body);
        } catch (e) {
          if (redealStakes) {
            for (const row of redealStakes) {
              await creditWalletOnce(row.playerId, row.amount, "refund-redeal:" + upper + ":" + row.playerId + ":" + crypto.randomUUID()).catch(() => {});
            }
          }
          const msg = e instanceof Error ? e.message : "Action failed.";
          if (msg === "unauthorized") return Response.json({ error: msg }, { status: 401 });
          return Response.json({ error: msg }, { status: msg === "Room not found." ? 404 : 400 });
        }
      },
    },
  },
});
