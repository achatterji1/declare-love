import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "@/lib/declare-auth.server";
import { playerFacingError } from "@/lib/declare-chips";
import { claimBonus, leaveLobbySeat, listTables, openWallet, sitDown } from "@/lib/declare-table.server";

const Body = z
  .object({
    op: z.enum(["wallet", "claim", "lobby", "sit", "fill", "leave"]),
    playerId: z.string().optional(),
    name: z.string().optional(),
    tier: z.string().optional(),
    code: z.string().optional(),
    seat: z.number().int().optional(),
    token: z.string().optional(),
  })
  .loose();

export const Route = createFileRoute("/api/public/declare/chips")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Invalid chip request." }, { status: 400 });
        const body = parsed.data;
        try {
          const user = await requireUser(request);
          if (body.op === "wallet") {
            return Response.json({ wallet: await openWallet(user.id) });
          }
          if (body.op === "claim") {
            return Response.json(await claimBonus(user.id));
          }
          if (body.op === "lobby") {
            const listed = await listTables(user.id);
            return Response.json(listed);
          }
          if (body.op === "sit") {
            return Response.json(await sitDown({ playerId: user.id, name: body.name || "Player", tier: body.tier, code: body.code }));
          }
          if (body.op === "leave") {
            return Response.json(await leaveLobbySeat({ playerId: user.id, code: body.code || "" }));
          }
          if (body.op === "fill") {
            return Response.json({ error: "Chip tables wait for players." }, { status: 400 });
          }
          return Response.json({ error: "Invalid chip request." }, { status: 400 });
        } catch (e) {
          const raw = e instanceof Error ? e.message : "Could not update chips.";
          if (raw === "unauthorized") return Response.json({ error: raw }, { status: 401 });
          const msg = playerFacingError(raw, "Could not update chips.");
          const status = msg === "Room not found." ? 404 : 400;
          return Response.json({ error: msg }, { status });
        }
      },
    },
  },
});
