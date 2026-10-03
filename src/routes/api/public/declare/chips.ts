import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { claimBonus, listTables, openWallet, sitDown } from "@/lib/declare-table.server";

const Body = z
  .object({
    op: z.enum(["wallet", "claim", "lobby", "sit", "fill"]),
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
          if (body.op === "wallet") {
            return Response.json({ wallet: await openWallet(body.playerId) });
          }
          if (body.op === "claim") {
            if (!body.playerId) return Response.json({ error: "Wallet not found." }, { status: 400 });
            return Response.json(await claimBonus(body.playerId));
          }
          if (body.op === "lobby") {
            const listed = await listTables(body.playerId);
            return Response.json(listed);
          }
          if (body.op === "sit") {
            if (!body.playerId) return Response.json({ error: "Wallet not found." }, { status: 400 });
            return Response.json(await sitDown({ playerId: body.playerId, name: body.name || "Player", tier: body.tier, code: body.code }));
          }
          if (body.op === "fill") {
            return Response.json({ error: "Chip tables wait for players." }, { status: 400 });
          }
          return Response.json({ error: "Invalid chip request." }, { status: 400 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Could not update chips.";
          if (msg === "unauthorized") return Response.json({ error: msg }, { status: 401 });
          const status = msg === "Room not found." ? 404 : 400;
          return Response.json({ error: msg }, { status });
        }
      },
    },
  },
});
