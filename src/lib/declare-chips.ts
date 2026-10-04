// Chip wallets and table stakes. Chips are not cash: they move from a wallet
// into a table pot, then to the winner of the hand. There is no cash-out.

export const STARTING_CHIPS = 10000;
export const CLAIM_AMOUNT = 5000;
export const CLAIM_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const VIP_ACT_MS = 15000;
export const TABLE_SEATS = 4;
export const COMPUTER_NAME = "Computer";

export const TIERS = {
  bronze: { buyIn: 500, actMs: 30000, label: "Bronze" },
  silver: { buyIn: 1000, actMs: 30000, label: "Silver" },
  gold: { buyIn: 2500, actMs: 30000, label: "Gold" },
  vip: { buyIn: 5000, actMs: VIP_ACT_MS, label: "VIP" },
} as const;

export type Tier = keyof typeof TIERS;

export interface Wallet {
  id: string;
  chips: number;
  // Null until the first claim. The next window starts only when they claim.
  claimAvailableAt: number | null;
  version: number;
  appliedKeys: string[];
}

export interface Stake {
  playerId: string;
  seat: number;
  amount: number;
  forfeited?: boolean;
}

export interface Payout {
  playerId: string;
  amount: number;
  key: string;
}

export interface SeatSlot {
  name: string;
  token: string;
  playerId?: string;
  computer?: boolean;
}

export interface Sittable {
  status: string;
  seats: (SeatSlot | null)[];
  pot: number;
  buyIn: number;
  stakes: Stake[];
}

export function isTier(value: string): value is Tier {
  return Object.prototype.hasOwnProperty.call(TIERS, value);
}

export function createWallet(id: string): Wallet {
  return { id, chips: STARTING_CHIPS, claimAvailableAt: null, version: 0, appliedKeys: [] };
}

export function claimAvailable(wallet: Wallet, now: number): boolean {
  return wallet.claimAvailableAt == null || now >= wallet.claimAvailableAt;
}

export function isMissingWalletTable(message: string): boolean {
  return /declare_wallets/i.test(message) || /schema cache/i.test(message);
}

// Players see a plain sentence. Schema-cache and PostgREST text stays on the server.
export function playerFacingError(message: string, fallback: string): string {
  if (!message || isMissingWalletTable(message) || /PGRST\d*|postgrest|Could not find the table|permission denied for table/i.test(message)) {
    return fallback;
  }
  return message;
}

export function nextClaimMessage(claimAvailableAt: number | null, now: number): string {
  if (claimAvailableAt == null || now >= claimAvailableAt) {
    return "Claim 5000 chips. The next 4-hour window starts when you claim.";
  }
  const total = Math.max(0, Math.ceil((claimAvailableAt - now) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return "Next claim in " + minutes + ":" + (seconds < 10 ? "0" : "") + seconds + ". Waiting does not refresh the window.";
}

export function googleSignInEnabled(settings: unknown): boolean {
  if (!settings || typeof settings !== "object") return false;
  const external = (settings as { external?: { google?: boolean } }).external;
  return !!(external && external.google === true);
}

// Claiming is the only thing that pays the bonus or starts the next 4-hour window.
export function applyClaim(wallet: Wallet, now: number): { wallet: Wallet; claimed: boolean } {
  if (!claimAvailable(wallet, now)) return { wallet, claimed: false };
  return {
    claimed: true,
    wallet: {
      ...wallet,
      chips: wallet.chips + CLAIM_AMOUNT,
      claimAvailableAt: now + CLAIM_INTERVAL_MS,
    },
  };
}

export function applyBuyIn(wallet: Wallet, amount: number): { ok: boolean; wallet: Wallet } {
  if (!Number.isInteger(amount) || amount < 0 || wallet.chips < amount) return { ok: false, wallet };
  return { ok: true, wallet: { ...wallet, chips: wallet.chips - amount } };
}

export function credit(wallet: Wallet, amount: number, key: string): Wallet {
  if (amount <= 0) return wallet;
  if (wallet.appliedKeys.includes(key)) return wallet;
  return {
    ...wallet,
    chips: wallet.chips + amount,
    appliedKeys: wallet.appliedKeys.concat(key),
  };
}

export function humanDisplayName(name: string): string {
  const trimmed = (name || "").trim().slice(0, 16) || "Player";
  if (trimmed.toLowerCase() === COMPUTER_NAME.toLowerCase()) return "Player";
  return trimmed;
}

// Sitting in the lobby only holds a seat. The wallet and the pot stay put until
// the hand actually starts.
export function trySit(
  room: Sittable,
  wallet: Wallet,
  name: string,
  token: string,
): { ok: boolean; wallet: Wallet; seat: number | null } {
  if (room.status !== "lobby") return { ok: false, wallet, seat: null };
  if (!room.buyIn || wallet.chips < room.buyIn) return { ok: false, wallet, seat: null };
  if (room.seats.some((s) => s && s.playerId === wallet.id)) return { ok: false, wallet, seat: null };
  const idx = room.seats.findIndex((s) => !s);
  if (idx < 0) return { ok: false, wallet, seat: null };
  room.seats[idx] = { name: humanDisplayName(name), token, playerId: wallet.id, computer: false };
  return { ok: true, wallet, seat: idx };
}

export function seatsOwingBuyIn(room: {
  status: string;
  buyIn?: number;
  seats: ({ playerId?: string; computer?: boolean } | null)[];
  stakes?: { playerId: string; seat: number; amount: number; forfeited?: boolean }[];
}): { playerId: string; seat: number; amount: number }[] {
  const buyIn = room.buyIn || 0;
  if (room.status !== "lobby" || buyIn <= 0) return [];
  const stakes = room.stakes || [];
  const owed: { playerId: string; seat: number; amount: number }[] = [];
  room.seats.forEach((seat, index) => {
    if (!seat || seat.computer || !seat.playerId) return;
    const paid = stakes.some(
      (row) => row.seat === index && row.playerId === seat.playerId && row.amount > 0 && !row.forfeited,
    );
    if (!paid) owed.push({ playerId: seat.playerId, seat: index, amount: buyIn });
  });
  return owed;
}

export function applyPaidStakes(
  room: { pot?: number; stakes?: { playerId: string; seat: number; amount: number; forfeited?: boolean }[] },
  paid: { playerId: string; seat: number; amount: number }[],
): void {
  const stakes = [...(room.stakes || [])];
  for (const row of paid) {
    if (row.amount <= 0) continue;
    if (stakes.some((stake) => stake.seat === row.seat && stake.playerId === row.playerId && !stake.forfeited)) continue;
    stakes.push({ playerId: row.playerId, seat: row.seat, amount: row.amount });
  }
  room.stakes = stakes;
  room.pot = stakes.reduce((sum, stake) => sum + stake.amount, 0);
}

export function computePayouts(input: {
  pot: number;
  scores: number[];
  seats: { playerId?: string | null; computer?: boolean }[];
  stakes?: { playerId: string; seat?: number; amount: number; forfeited?: boolean }[];
  key: string;
}): Payout[] {
  const { pot, scores, seats, stakes, key } = input;
  if (pot <= 0 || !scores.length) return [];
  const low = Math.min(...scores);
  const winners = scores.map((score, index) => index).filter((index) => scores[index] === low);
  const humans = winners.filter((index) => seats[index] && !seats[index].computer && seats[index].playerId);
  if (humans.length === 1) {
    return [{ playerId: seats[humans[0]]!.playerId!, amount: pot, key }];
  }
  if (humans.length > 1) {
    const share = Math.floor(pot / humans.length);
    let remainder = pot - share * humans.length;
    const payouts: Payout[] = [];
    humans.forEach((seat, index) => {
      const amount = share + (index === 0 ? remainder : 0);
      if (index === 0) remainder = 0;
      if (amount > 0) payouts.push({ playerId: seats[seat]!.playerId!, amount, key: key + ":" + seat });
    });
    return payouts;
  }
  return (stakes || [])
    .filter((stake) => stake.amount > 0 && stake.playerId && !stake.forfeited)
    .map((stake) => ({
      playerId: stake.playerId,
      amount: stake.amount,
      key: key + ":return:" + stake.playerId + ":" + (stake.seat ?? ""),
    }));
}
