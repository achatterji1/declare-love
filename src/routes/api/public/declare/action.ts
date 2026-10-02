import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { handleAction, publicState } from "@/lib/declare-engine";
import { mutateRoom, seatAuthorized } from "@/lib/declare-store.server";

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

        try {
          const { room } = await mutateRoom(code.toUpperCase(), (r) => {
            if (!seatAuthorized(r, seat, token)) throw new Error("unauthorized");
            handleAction(r, seat, { action, ...rest });
          });
          return Response.json({ state: publicState(room, seat) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Action failed.";
          if (msg === "unauthorized") return Response.json({ error: msg }, { status: 401 });
          return Response.json({ error: msg }, { status: msg === "Room not found." ? 404 : 400 });
        }
      },
    },
  },
});
