import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { makeCode, publicState, type Room } from "@/lib/declare-engine";
import { insertRoom, roomExists, writeViews } from "@/lib/declare-store.server";

const Body = z.object({
  n: z.number().int().min(2).max(8),
  cardsN: z.number().int().min(4).max(6),
  name: z.string().trim().min(1).max(16),
});

export const Route = createFileRoute("/api/public/declare/create")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid create request." }, { status: 400 });
        }
        const { n, cardsN, name } = parsed.data;

        let code = makeCode();
        for (let i = 0; i < 10 && (await roomExists(code)); i++) code = makeCode();

        const room: Room = {
          code,
          n,
          cardsN,
          seats: Array.from({ length: n }, () => null),
          status: "lobby",
          G: null,
          version: 0,
        };
        room.seats[0] = { name, token: crypto.randomUUID() };

        await insertRoom(room);
        await writeViews(room);

        return Response.json({
          code,
          seat: 0,
          token: room.seats[0]!.token,
          state: publicState(room, 0),
        });
      },
    },
  },
});
