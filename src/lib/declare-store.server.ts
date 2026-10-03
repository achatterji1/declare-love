import fs from "node:fs";
import { getSupabaseAdmin } from "@/integrations/supabase/client.server";
import { advanceRoom } from "./declare-advance";
import {
  createWallet,
  credit,
  type Payout,
  type Stake,
  type Tier,
  type Wallet,
} from "./declare-chips";
import { publicState, type Game, type Room, type Seat } from "./declare-engine";

interface RoomRow {
  code: string;
  n: number;
  cards_n: number;
  seats: unknown;
  status: string;
  state: unknown;
  version: number;
}

interface WalletRow {
  id: string;
  chips: number;
  claim_available_at: string | null;
  version: number;
  applied_keys: unknown;
}

interface ChipEnvelope {
  v: 2;
  tier: Tier | null;
  pot: number;
  buyIn: number;
  actMs: number | null;
  stakes: Stake[];
  payouts: Payout[] | null;
  G: Game | null;
}

const MEMORY_PATH = "/tmp/declare-chip-store.json";

function supabaseReady(): boolean {
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  return !!(url && key);
}

interface MemoryStore {
  rooms: RoomRow[];
  wallets: WalletRow[];
}

function readMemory(): MemoryStore {
  try {
    const raw = fs.readFileSync(MEMORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as MemoryStore;
    return { rooms: parsed.rooms || [], wallets: parsed.wallets || [] };
  } catch {
    return { rooms: [], wallets: [] };
  }
}

function writeMemory(store: MemoryStore): void {
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(store));
}

function unpackState(state: unknown): Pick<Room, "G" | "tier" | "pot" | "buyIn" | "actMs" | "stakes" | "payouts"> {
  if (state && typeof state === "object" && (state as ChipEnvelope).v === 2) {
    const packed = state as ChipEnvelope;
    return {
      G: packed.G ?? null,
      tier: packed.tier ?? null,
      pot: packed.pot ?? 0,
      buyIn: packed.buyIn ?? 0,
      actMs: packed.actMs ?? null,
      stakes: packed.stakes ?? [],
      payouts: packed.payouts ?? null,
    };
  }
  return { G: (state as Game | null) ?? null, tier: null, pot: 0, buyIn: 0, actMs: null, stakes: [], payouts: null };
}

function packState(room: Room): unknown {
  const chipped = !!(room.tier || room.pot || room.buyIn || room.actMs || (room.stakes && room.stakes.length) || (room.payouts && room.payouts.length));
  if (!chipped) return room.G ?? null;
  const packed: ChipEnvelope = {
    v: 2,
    tier: room.tier ?? null,
    pot: room.pot ?? 0,
    buyIn: room.buyIn ?? 0,
    actMs: room.actMs ?? null,
    stakes: room.stakes ?? [],
    payouts: room.payouts ?? null,
    G: room.G,
  };
  return packed;
}

function rowToRoom(row: RoomRow): Room {
  const unpacked = unpackState(row.state);
  return {
    code: row.code,
    n: row.n,
    cardsN: row.cards_n,
    seats: (row.seats ?? []) as (Seat | null)[],
    status: row.status,
    version: row.version,
    ...unpacked,
  };
}

function walletToRow(wallet: Wallet): WalletRow {
  return {
    id: wallet.id,
    chips: wallet.chips,
    claim_available_at: wallet.claimAvailableAt == null ? null : new Date(wallet.claimAvailableAt).toISOString(),
    version: wallet.version,
    applied_keys: wallet.appliedKeys,
  };
}

function rowToWallet(row: WalletRow): Wallet {
  const keys = Array.isArray(row.applied_keys) ? row.applied_keys.filter((key) => typeof key === "string") : [];
  return {
    id: row.id,
    chips: row.chips,
    claimAvailableAt: row.claim_available_at ? Date.parse(row.claim_available_at) : null,
    version: row.version,
    appliedKeys: keys,
  };
}

export async function loadRoom(code: string): Promise<Room | null> {
  if (!supabaseReady()) {
    const row = readMemory().rooms.find((item) => item.code === code);
    return row ? rowToRoom(row) : null;
  }
  const { data, error } = await getSupabaseAdmin().from("declare_rooms").select("*").eq("code", code).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToRoom(data as RoomRow) : null;
}

export async function roomExists(code: string): Promise<boolean> {
  if (!supabaseReady()) return readMemory().rooms.some((item) => item.code === code);
  const { data } = await getSupabaseAdmin().from("declare_rooms").select("code").eq("code", code).maybeSingle();
  return !!data;
}

export async function insertRoom(room: Room): Promise<void> {
  const row: RoomRow = {
    code: room.code,
    n: room.n,
    cards_n: room.cardsN,
    seats: room.seats,
    status: room.status,
    state: packState(room),
    version: room.version,
  };
  if (!supabaseReady()) {
    const store = readMemory();
    store.rooms.push(row);
    writeMemory(store);
    return;
  }
  const { error } = await getSupabaseAdmin().from("declare_rooms").insert({
    code: room.code,
    n: room.n,
    cards_n: room.cardsN,
    seats: room.seats as never,
    status: room.status,
    state: packState(room) as never,
    version: room.version,
  });
  if (error) throw new Error(error.message);
}

export async function saveRoom(room: Room): Promise<void> {
  if (!supabaseReady()) {
    const store = readMemory();
    const row = store.rooms.find((item) => item.code === room.code && item.version === room.version);
    if (!row) throw new Error("conflict");
    row.seats = room.seats;
    row.status = room.status;
    row.state = packState(room);
    row.version = room.version + 1;
    room.version += 1;
    writeMemory(store);
    return;
  }
  const { data, error } = await getSupabaseAdmin()
    .from("declare_rooms")
    .update({
      seats: room.seats as never,
      status: room.status,
      state: packState(room) as never,
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

export async function listLobbyRooms(): Promise<Room[]> {
  if (!supabaseReady()) return readMemory().rooms.filter((row) => row.status === "lobby").map(rowToRoom);
  const { data, error } = await getSupabaseAdmin().from("declare_rooms").select("*").eq("status", "lobby");
  if (error) throw new Error(error.message);
  return ((data || []) as RoomRow[]).map(rowToRoom);
}

export async function listChipRooms(): Promise<Room[]> {
  const open = (room: Room) =>
    !!room.tier && (room.status === "lobby" || room.status === "playing" || room.status === "ended");
  if (!supabaseReady()) return readMemory().rooms.map(rowToRoom).filter(open);
  const { data, error } = await getSupabaseAdmin()
    .from("declare_rooms")
    .select("*")
    .in("status", ["lobby", "playing", "ended"]);
  if (error) throw new Error(error.message);
  return ((data || []) as RoomRow[]).map(rowToRoom).filter(open);
}

export async function writeViews(room: Room): Promise<void> {
  if (!supabaseReady()) return;
  const admin = getSupabaseAdmin();
  const rows = room.seats.map((_, seat) => ({
    code: room.code,
    seat,
    view: publicState(room, seat) as never,
    version: room.version,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await admin.from("declare_views").upsert(rows);
  if (error) throw new Error(error.message);
}

export function seatAuthorized(room: Room, seat: number, token: string): boolean {
  const s = room.seats[seat];
  if (!s || s.computer) return false;
  return !!s.token && s.token === token;
}

export async function loadWallet(id: string): Promise<Wallet | null> {
  if (!supabaseReady()) {
    const row = readMemory().wallets.find((item) => item.id === id);
    return row ? rowToWallet(row) : null;
  }
  const { data, error } = await getSupabaseAdmin().from("declare_wallets").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToWallet(data as WalletRow) : null;
}

async function insertWallet(wallet: Wallet): Promise<void> {
  const row = walletToRow(wallet);
  if (!supabaseReady()) {
    const store = readMemory();
    if (store.wallets.some((item) => item.id === wallet.id)) return;
    store.wallets.push(row);
    writeMemory(store);
    return;
  }
  const { error } = await getSupabaseAdmin().from("declare_wallets").insert({
    id: wallet.id,
    chips: wallet.chips,
    claim_available_at: row.claim_available_at,
    version: wallet.version,
    applied_keys: wallet.appliedKeys as never,
  });
  if (error) throw new Error(error.message);
}

export async function saveWallet(wallet: Wallet): Promise<void> {
  const row = walletToRow(wallet);
  if (!supabaseReady()) {
    const store = readMemory();
    const saved = store.wallets.find((item) => item.id === wallet.id && item.version === wallet.version);
    if (!saved) throw new Error("conflict");
    saved.chips = wallet.chips;
    saved.claim_available_at = row.claim_available_at;
    saved.applied_keys = wallet.appliedKeys;
    saved.version = wallet.version + 1;
    wallet.version += 1;
    writeMemory(store);
    return;
  }
  const { data, error } = await getSupabaseAdmin()
    .from("declare_wallets")
    .update({
      chips: wallet.chips,
      claim_available_at: row.claim_available_at,
      applied_keys: wallet.appliedKeys as never,
      version: wallet.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", wallet.id)
    .eq("version", wallet.version)
    .select("version");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("conflict");
  wallet.version += 1;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getOrCreateWallet(requestedId?: string): Promise<Wallet> {
  if (requestedId && UUID_RE.test(requestedId)) {
    const existing = await loadWallet(requestedId);
    if (existing) return existing;
    const created = createWallet(requestedId);
    await insertWallet(created);
    return created;
  }
  const created = createWallet(crypto.randomUUID());
  await insertWallet(created);
  return created;
}

export async function creditWalletOnce(id: string, amount: number, key: string): Promise<void> {
  if (amount <= 0) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const wallet = await loadWallet(id);
    if (!wallet) throw new Error("Wallet not found.");
    const next = credit(wallet, amount, key);
    if (next === wallet || next.appliedKeys.length === wallet.appliedKeys.length) return;
    next.version = wallet.version;
    try {
      await saveWallet(next);
      return;
    } catch (e) {
      if (e instanceof Error && e.message === "conflict" && attempt < 2) continue;
      throw e;
    }
  }
}

export async function advanceAndSave(code: string): Promise<Room | null> {
  const room = await loadRoom(code);
  if (!room) return null;
  const changed = advanceRoom(room);
  const unpaid = !!(room.payouts && room.payouts.length);
  if (!changed && !unpaid) return room;
  try {
    await saveRoom(room);
    await writeViews(room);
    await settlePayouts(room);
  } catch {
    return loadRoom(code);
  }
  return loadRoom(code);
}

export async function settlePayouts(room: Room): Promise<void> {
  const payouts = room.payouts;
  if (!payouts || !payouts.length) {
    if (payouts && payouts.length === 0) room.payouts = null;
    return;
  }
  for (const payout of payouts) await creditWalletOnce(payout.playerId, payout.amount, payout.key);
  room.payouts = null;
  await saveRoom(room);
  await writeViews(room);
}

// Load a room, advance expired timers and computer seats, run the mutation, persist, and push
// fresh per-seat views. Retries once on a concurrent-write conflict.
export async function mutateRoom<T>(
  code: string,
  fn: (room: Room) => T | Promise<T>,
): Promise<{ room: Room; result: T }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const room = await loadRoom(code);
    if (!room) throw new Error("Room not found.");
    advanceRoom(room);
    const result = await fn(room);
    advanceRoom(room);
    try {
      await saveRoom(room);
    } catch (e) {
      if (e instanceof Error && e.message === "conflict" && attempt === 0) continue;
      throw e;
    }
    await writeViews(room);
    await settlePayouts(room);
    return { room, result };
  }
  throw new Error("conflict");
}
