import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { publicState, startGame } from "@/lib/declare-engine";
import { requireUser } from "@/lib/declare-auth.server";
import { playerFacingError } from "@/lib/declare-chips";
import { mutateRoom } from "@/lib/declare-store.server";

const Body = z.object({
  code: z.string().trim().min(1).max(8),
  name: z.string().trim().min(1).max(16),
});

export const Route = createFileRoute("/api/public/declare/join")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid join request." }, { status: 400 });
        }
        const code = parsed.data.code.toUpperCase();
        const name = parsed.data.name;

        try {
          await requireUser(request);
          const { room, result } = await mutateRoom(code, (r) => {
            if (r.tier) throw new Error("Join this table from the chip lobby.");
            if (r.status !== "lobby") throw new Error("That game has already started.");
            const idx = r.seats.findIndex((s) => s === null);
            if (idx < 0) throw new Error("Room is full.");
            r.seats[idx] = { name, token: crypto.randomUUID() };
            if (r.seats.every(Boolean)) startGame(r);
            return { seat: idx, token: r.seats[idx]!.token };
          });
          return Response.json({
            code,
            seat: result.seat,
            token: result.token,
            state: publicState(room, result.seat),
          });
        } catch (e) {
          const raw = e instanceof Error ? e.message : "Could not join.";
          if (raw === "unauthorized") return Response.json({ error: raw }, { status: 401 });
          const msg = playerFacingError(raw, "Could not join.");
          const status = msg === "Room not found." ? 404 : 400;
          return Response.json({ error: msg }, { status });
        }
      },
    },
  },
});
