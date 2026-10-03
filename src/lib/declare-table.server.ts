import { makeCode, publicState, startGame, type Room } from "./declare-engine";
import {
  TIERS,
  applyBuyIn,
  applyClaim,
  humanDisplayName,
  isTier,
  type Tier,
  type Wallet,
} from "./declare-chips";
import {
  creditWalletOnce,
  getOrCreateWallet,
  insertRoom,
  listChipRooms,
  listLobbyRooms,
  loadRoom,
  loadWallet,
  mutateRoom,
  roomExists,
  saveWallet,
} from "./declare-store.server";

export function walletView(wallet: Wallet, now = Date.now()) {
  return {
    id: wallet.id,
    chips: wallet.chips,
    claimAvailableAt: wallet.claimAvailableAt,
    claimReady: wallet.claimAvailableAt == null || now >= wallet.claimAvailableAt,
  };
}

export async function openWallet(playerId?: string) {
  const wallet = await getOrCreateWallet(playerId);
  return walletView(wallet);
}

export async function claimBonus(playerId: string, now = Date.now()) {
  const opened = await getOrCreateWallet(playerId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const wallet = await loadWallet(opened.id);
    if (!wallet) throw new Error("Wallet not found.");
    const result = applyClaim(wallet, now);
    if (!result.claimed) return { wallet: walletView(wallet, now), claimed: false };
    result.wallet.version = wallet.version;
    try {
      await saveWallet(result.wallet);
      return { wallet: walletView(result.wallet, now), claimed: true };
    } catch (e) {
      if (e instanceof Error && e.message === "conflict" && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("conflict");
}

async function debit(playerId: string, amount: number): Promise<Wallet> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wallet = await loadWallet(playerId);
    if (!wallet) throw new Error("Wallet not found.");
    const paid = applyBuyIn(wallet, amount);
    if (!paid.ok) throw new Error("You cannot afford the buy-in.");
    paid.wallet.version = wallet.version;
    try {
      await saveWallet(paid.wallet);
      return paid.wallet;
    } catch (e) {
      if (e instanceof Error && e.message === "conflict" && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("conflict");
}

function tableSummary(room: Room) {
  const tier = room.tier;
  if (!tier) return null;
  const seats = room.seats.map((seat) => ({
    name: seat ? (seat.computer ? "Computer" : seat.name) : null,
    computer: !!(seat && seat.computer),
    open: !seat,
  }));
  return {
    code: room.code,
    tier,
    label: TIERS[tier].label,
    buyIn: room.buyIn || TIERS[tier].buyIn,
    pot: room.pot || 0,
    openSeats: seats.filter((seat) => seat.open).length,
    seats,
  };
}

export async function listTables(playerId?: string) {
  const rooms = await listChipRooms();
  const tables = rooms.map(tableSummary).filter((row) => row && row.openSeats > 0);
  const wallet = playerId ? await getOrCreateWallet(playerId) : null;
  return { tables, wallet: wallet ? walletView(wallet) : null };
}

async function freshTable(tier: Tier): Promise<Room> {
  let code = makeCode();
  for (let i = 0; i < 10 && (await roomExists(code)); i++) code = makeCode();
  const spec = TIERS[tier];
  const room: Room = {
    code,
    n: 4,
    cardsN: 4,
    seats: [null, null, null, null],
    status: "lobby",
    G: null,
    version: 0,
    tier,
    pot: 0,
    buyIn: spec.buyIn,
    actMs: spec.actMs,
    stakes: [],
    payouts: null,
  };
  await insertRoom(room);
  return room;
}

export async function sitDown(input: { playerId: string; name: string; tier?: string; code?: string }) {
  const opened = await getOrCreateWallet(input.playerId);
  const playerId = opened.id;
  const wallet = await loadWallet(playerId);
  if (!wallet) throw new Error("Wallet not found.");
  let code = (input.code || "").trim().toUpperCase();
  let tier: Tier | null = null;
  let charge = true;
  if (code) {
    const found = await loadRoom(code);
    if (!found || !found.tier) throw new Error("That table is not open.");
    if (found.status !== "lobby" && found.status !== "playing" && found.status !== "ended") {
      throw new Error("That table is not open.");
    }
    if (!found.seats.some((seat) => !seat)) throw new Error("That table is full.");
    tier = found.tier;
    charge = found.status !== "ended";
  } else {
    if (!input.tier || !isTier(input.tier)) throw new Error("Choose Bronze, Silver, Gold, or VIP.");
    tier = input.tier;
    const open = (await listLobbyRooms()).find(
      (room) =>
        room.tier === tier &&
        room.status === "lobby" &&
        room.seats.some((seat) => !seat) &&
        !room.seats.some((seat) => seat && seat.playerId === playerId),
    );
    if (open) code = open.code;
    else code = (await freshTable(tier)).code;
  }
  const buyIn = TIERS[tier].buyIn;
  if (charge && wallet.chips < buyIn) throw new Error("You cannot afford the buy-in.");
  const token = crypto.randomUUID();
  if (charge) await debit(playerId, buyIn);
  try {
    const { room, result } = await mutateRoom(code, (room) => {
      const joinable = room.status === "lobby" || room.status === "playing" || room.status === "ended";
      if (!joinable || room.tier !== tier) throw new Error("That table is not open.");
      if (charge && room.status === "ended") throw new Error("That hand already ended.");
      if (!charge && room.status !== "ended") throw new Error("That table is not open.");
      if (room.seats.some((seat) => seat && seat.playerId === playerId)) {
        throw new Error("You are already seated.");
      }
      const idx = room.seats.findIndex((seat) => !seat);
      if (idx < 0) throw new Error("That table is full.");
      room.seats[idx] = { name: humanDisplayName(input.name), token, playerId, computer: false };
      if (room.status === "lobby" || room.status === "playing") {
        room.pot = (room.pot || 0) + buyIn;
        room.stakes = [...(room.stakes || []), { playerId, seat: idx, amount: buyIn }];
      }
      if (room.G && room.G.players[idx]) room.G.players[idx].name = room.seats[idx]!.name;
      if (room.status === "lobby" && room.seats.every(Boolean)) startGame(room);
      return { seat: idx, token };
    });
    const updated = await loadWallet(playerId);
    return {
      code,
      seat: result.seat,
      token: result.token,
      state: publicState(room, result.seat),
      wallet: updated ? walletView(updated) : null,
    };
  } catch (e) {
    if (charge) await creditWalletOnce(playerId, buyIn, "refund-sit:" + token);
    throw e;
  }
}

export async function chargeNextHand(room: Room): Promise<{ playerId: string; seat: number; amount: number }[]> {
  if (!room.tier || !room.buyIn) return [];
  const humans = room.seats
    .map((seat, index) => ({ seat, index }))
    .filter((row) => row.seat && !row.seat.computer && row.seat.playerId);
  for (const row of humans) {
    const wallet = await loadWallet(row.seat!.playerId!);
    if (!wallet || wallet.chips < room.buyIn) throw new Error("You cannot afford the buy-in.");
  }
  const debited: { playerId: string; seat: number; amount: number }[] = [];
  try {
    for (const row of humans) {
      await debit(row.seat!.playerId!, room.buyIn);
      debited.push({ playerId: row.seat!.playerId!, seat: row.index, amount: room.buyIn });
    }
  } catch (e) {
    for (const row of debited) {
      await creditWalletOnce(row.playerId, row.amount, "refund-redeal:" + room.code + ":" + row.playerId + ":" + crypto.randomUUID());
    }
    throw e;
  }
  return debited;
}
