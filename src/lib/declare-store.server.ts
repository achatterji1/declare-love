import { getSupabaseAdmin } from "@/integrations/supabase/client.server";
import { applyTimers, publicState, type Room, type Seat } from "./declare-engine";

interface RoomRow {
  code: string;
  n: number;
  cards_n: number;
  seats: unknown;
  status: string;
  state: unknown;
  version: number;
}

function rowToRoom(row: RoomRow): Room {
  return {
    code: row.code,
    n: row.n,
    cardsN: row.cards_n,
    seats: (row.seats ?? []) as (Seat | null)[],
    status: row.status,
    G: row.state,
    version: row.version,
  };
}

export async function loadRoom(code: string): Promise<Room | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("declare_rooms")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToRoom(data as RoomRow) : null;
}

export async function roomExists(code: string): Promise<boolean> {
  const { data } = await getSupabaseAdmin()
    .from("declare_rooms")
    .select("code")
    .eq("code", code)
    .maybeSingle();
  return !!data;
}

export async function insertRoom(room: Room): Promise<void> {
  const { error } = await getSupabaseAdmin().from("declare_rooms").insert({
    code: room.code,
    n: room.n,
    cards_n: room.cardsN,
    seats: room.seats as never,
    status: room.status,
    state: room.G,
    version: room.version,
  });
  if (error) throw new Error(error.message);
}

export async function saveRoom(room: Room): Promise<void> {
  const { data, error } = await getSupabaseAdmin()
    .from("declare_rooms")
    .update({
      seats: room.seats as never,
      status: room.status,
      state: room.G,
      version: room.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("code", room.code)
    .eq("version", room.version)
    .select("version");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("conflict");
  room.version += 1;
}

export async function writeViews(room: Room): Promise<void> {
  const admin = getSupabaseAdmin();
  const rows = room.seats.map((_, seat) => ({
    code: room.code,
    seat,
    view: publicState(room, seat),
    version: room.version,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await admin.from("declare_views").upsert(rows);
  if (error) throw new Error(error.message);
}

export function seatAuthorized(room: Room, seat: number, token: string): boolean {
  const s = room.seats[seat];
  return !!s && s.token === token;
}

// Load a room, advance expired timers, run the mutation, persist, and push
// fresh per-seat views. Retries once on a concurrent-write conflict.
export async function mutateRoom<T>(
  code: string,
  fn: (room: Room) => T | Promise<T>,
): Promise<{ room: Room; result: T }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const room = await loadRoom(code);
    if (!room) throw new Error("Room not found.");
    applyTimers(room);
    const result = await fn(room);
    try {
      await saveRoom(room);
    } catch (e) {
      if (e instanceof Error && e.message === "conflict" && attempt === 0) continue;
      throw e;
    }
    await writeViews(room);
    return { room, result };
  }
  throw new Error("conflict");
}
