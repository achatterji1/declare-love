// Pure TypeScript port of server.js game logic. No sockets, no timers:
// setTimeout callbacks become deadline timestamps (memorizeEndsAt /
// keepBothEndsAt / peekEndsAt / actEndsAt) advanced by applyTimers().
// Callers persist the room and broadcast per-seat views after every mutation.

export const MEMORIZE_MS = 30000;
export const ACT_MS = 30000;
export const KEEP_BOTH_MS = 4000;
export const PEEK_MS = 1300;

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["H", "D", "C", "S"];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface Card {
  r: string;
  s: string;
  known: boolean[];
}

export interface Player {
  id: number;
  slots: (Card | null)[];
  declared: boolean;
  name: string;
}

export interface Game {
  n: number;
  cols: number;
  cardsN: number;
  deck: { r: string; s: string }[];
  pile: { r: string; s: string }[];
  players: Player[];
  turn: number;
  phase: string;
  declarer: number | null;
  queue: number[];
  intent: string | null;
  pick: string[];
  free: boolean;
  dumpGive: { actor: number; oppPid: number; emptiedI: number; rank: string } | null;
  power: string | null;
  powerStep: string | null;
  powerTarget: { pid: number; i: number } | null;
  powerMine: { pid: number; i: number } | null;
  chainPid: number | null;
  chainRank: string | null;
  // false = skipping this one-shot must not make the center card pickable (used 10).
  chainSkipFree: boolean | null;
  // Pick / Pass / Swap waiting for Yes. Null once confirmed or cancelled.
  pending: string | null;
  // Older confirm deadline. Absorbed into the move clock so cancelling cannot stall.
  actEndsAt: number | null;
  // Deadline for the current move, including Yes/No. Timeout keeps a center card.
  turnEndsAt?: number | null;
  turnWaitKey?: string | null;
  memorizeReady: boolean[] | null;
  memorizeEndsAt: number | null;
  // These live on the saved game. The room copies are lost when a tick reloads from the database.
  keepBothEndsAt?: number | null;
  peekEndsAt?: number | null;
  keepBoth: { pid: number; handI: number; placedI: number; priorHandKnown: boolean } | null;
  peekReveal: {
    peeker: number;
    targetPid: number;
    i: number;
    next: string;
    priorKnown: boolean;
  } | null;
  log: string;
}

export interface Seat {
  name: string;
  token: string;
}

export interface Room {
  code: string;
  n: number;
  cardsN: number;
  seats: (Seat | null)[];
  status: string;
  G: Game | null;
  version: number;
  keepBothEndsAt?: number | null;
  peekEndsAt?: number | null;
}

export function makeCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function val(card: { r: string; s: string } | null): number {
  if (!card) return 0;
  if (card.r === "A") return 1;
  if (card.r === "K" && (card.s === "H" || card.s === "D")) return -1;
  if (card.r === "J") return 11;
  if (card.r === "Q") return 12;
  if (card.r === "K") return 13;
  return Number(card.r);
}

function label(card: { r: string; s: string }): string {
  const g: Record<string, string> = { H: "♥", D: "♦", C: "♣", S: "♠" };
  return card.r + g[card.s];
}

function isPowerRank(r: string): boolean {
  return r === "10" || r === "J" || r === "Q" || r === "K";
}

function powerHint(r: string): string {
  if (r === "10") return "10: peek one of your cards.";
  if (r === "J") return "J: peek one opponent card.";
  if (r === "Q") return "Q: blind-trade one of your cards with an opponent card.";
  if (r === "K") return "K: peek one of your cards, then one opponent card, then Trade or Skip.";
  return "";
}

function pileTop(G: Game): { r: string; s: string } | null {
  return G.pile.length ? G.pile[G.pile.length - 1] : null;
}

function handLocked(G: Game, pid: number): boolean {
  return G.declarer !== null && pid === G.declarer;
}

function hasUnlockedOppCards(G: Game, me: number): boolean {
  for (let p = 0; p < G.n; p++) {
    if (p === me || handLocked(G, p)) continue;
    if (G.players[p].slots.some((c) => !!c)) return true;
  }
  return false;
}

function fillPowerPicks(G: Game): void {
  G.pick = [];
  const me = G.turn;
  if (G.powerStep === "peek-own" || G.powerStep === "q-mine" || G.powerStep === "k-peek-own") {
    G.players[me].slots.forEach((c, i) => {
      if (c) G.pick.push(me + ":" + i);
    });
  }
  if (G.powerStep === "peek-opp" || G.powerStep === "q-theirs" || G.powerStep === "k-peek-opp") {
    for (let p = 0; p < G.n; p++) {
      if (p === me || handLocked(G, p)) continue;
      G.players[p].slots.forEach((c, i) => {
        if (c) G.pick.push(p + ":" + i);
      });
    }
  }
  // k-trade: no card picks — Trade / Skip buttons only
}

function matchRankForDump(G: Game): string | null {
  const top = pileTop(G);
  if (G.phase === "chain" && G.chainRank) return G.chainRank;
  if (G.phase === "dumpGive" && G.dumpGive) return G.dumpGive.rank;
  if (G.phase === "act" && top) return top.r;
  if (G.phase === "draw" && G.free && top) return top.r;
  if (G.phase === "pick" && G.intent === "discard" && top) return top.r;
  return null;
}

function addDumpPicks(G: Game, actor: number | null): void {
  const rank = matchRankForDump(G);
  if (!rank || actor == null) return;
  // During an open dump, every unlocked opponent card is legal: a match succeeds, a miss keeps both.
  for (let p = 0; p < G.n; p++) {
    if (p === actor || handLocked(G, p)) continue;
    G.players[p].slots.forEach((c, i) => {
      if (c) {
        const key = p + ":" + i;
        if (G.pick.indexOf(key) < 0) G.pick.push(key);
      }
    });
  }
}

// After a swap or peek the center card was just placed. Only a matching opponent card may be dumped.
function addChainOppPicks(G: Game, actor: number, rank: string): void {
  for (let p = 0; p < G.n; p++) {
    if (p === actor || handLocked(G, p)) continue;
    G.players[p].slots.forEach((c, i) => {
      if (c && c.r === rank) {
        const key = p + ":" + i;
        if (G.pick.indexOf(key) < 0) G.pick.push(key);
      }
    });
  }
}

function writeKeepBothDeadline(room: Room, endsAt: number | null): void {
  room.keepBothEndsAt = endsAt;
  if (room.G) room.G.keepBothEndsAt = endsAt;
}

function writePeekDeadline(room: Room, endsAt: number | null): void {
  room.peekEndsAt = endsAt;
  if (room.G) room.G.peekEndsAt = endsAt;
}

function refreshActDumpPicks(G: Game): void {
  if (!G) return;
  if (G.phase === "act" || (G.phase === "draw" && G.free && G.declarer === null)) {
    G.pick = [];
    addDumpPicks(G, G.turn);
  }
}

function placeCardInHandPrefer(G: Game, pid: number, card: Card, preferI: number | null): number {
  const slots = G.players[pid].slots;
  if (preferI != null && preferI >= 0 && preferI < slots.length && !slots[preferI]) {
    slots[preferI] = card;
    return preferI;
  }
  const empty = slots.findIndex((c) => !c);
  if (empty >= 0) {
    slots[empty] = card;
    return empty;
  }
  slots.push(card);
  return slots.length - 1;
}

function placeDrawnInHand(G: Game, pid: number, card: Card): number {
  return placeCardInHandPrefer(G, pid, card, null);
}

function clearDecisionTimer(G: Game): void {
  G.actEndsAt = null;
  G.pending = null;
}

function choiceVerb(choice: string): string {
  if (choice === "pass") return "Pass";
  if (choice === "swap") return "Swap in";
  if (choice === "claim") return "Pick";
  return "Choose";
}

function score(p: Player): number {
  let s = 0;
  for (const c of p.slots) if (c) s += val(c);
  return s;
}

export function makeDeal(n: number, cardsN: number): Game {
  const deck: { r: string; s: string }[] = [];
  const packs = Math.max(1, Math.ceil((n * cardsN + 10) / 52));
  for (let p = 0; p < packs; p++) for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  shuffle(deck);
  const cols = cardsN === 6 ? 3 : 2;
  const players: Player[] = [];
  for (let id = 0; id < n; id++) {
    const slots: Card[] = [];
    for (let k = 0; k < cardsN; k++) {
      const c = deck.pop()!;
      const known = Array(n).fill(false);
      slots.push({ r: c.r, s: c.s, known });
    }
    // Bottom two stay unknown; memorize phase reveals them temporarily
    players.push({ id, slots, declared: false, name: "P" + (id + 1) });
  }
  return {
    n,
    cols,
    cardsN,
    deck,
    pile: [],
    players,
    turn: 0,
    phase: "memorize",
    declarer: null,
    queue: [],
    intent: null,
    pick: [],
    free: false,
    dumpGive: null,
    power: null,
    powerStep: null,
    powerTarget: null,
    powerMine: null,
    chainPid: null,
    chainRank: null,
    chainSkipFree: null,
    pending: null,
    actEndsAt: null,
    turnEndsAt: null,
    turnWaitKey: null,
    memorizeReady: Array(n).fill(false),
    memorizeEndsAt: Date.now() + MEMORIZE_MS,
    keepBothEndsAt: null,
    peekEndsAt: null,
    keepBoth: null,
    peekReveal: null,
    log: "Memorize your bottom two cards. Click Ready when done (or wait for the timer).",
  };
}

export function publicState(room: Room, viewerId: number): Record<string, unknown> {
  if (room.status === "abandoned") {
    return {
      status: "abandoned",
      dismissed: true,
      code: room.code,
      version: room.version,
      n: room.n,
      you: viewerId,
      waiting: false,
      log: "A player left the table.",
    };
  }
  const G = room.G;
  if (!G) {
    return {
      status: room.status,
      code: room.code,
      version: room.version,
      n: room.n,
      cardsN: room.cardsN,
      players: room.seats.map((s, i) => ({ id: i, name: s ? s.name : null, ready: !!s })),
      you: viewerId,
      waiting: true,
    };
  }
  const top = pileTop(G);
  return {
    status: room.status,
    code: room.code,
    version: room.version,
    waiting: false,
    you: viewerId,
    turn: G.turn,
    phase: G.phase,
    free: G.free,
    declarer: G.declarer,
    intent: G.intent,
    pick: G.pick,
    power: G.power || null,
    powerStep: G.powerStep || null,
    chainRank: G.chainRank || null,
    dumpGive: G.dumpGive || null,
    powerMine: G.powerMine || null,
    powerTarget: G.powerTarget || null,
    keepBoth:
      G.phase === "keepBoth" && G.keepBoth
        ? { pid: G.keepBoth.pid, handI: G.keepBoth.handI, placedI: G.keepBoth.placedI }
        : null,
    pending: G.pending || null,
    actEndsAt: G.actEndsAt || null,
    turnEndsAt: G.turnEndsAt || null,
    phaseEndsAt:
      G.phase === "keepBoth"
        ? G.keepBothEndsAt ?? room.keepBothEndsAt ?? null
        : G.phase === "peekReveal"
          ? G.peekEndsAt ?? room.peekEndsAt ?? null
          : null,
    memorizeEndsAt: G.phase === "memorize" ? G.memorizeEndsAt : null,
    memorizeReady: G.phase === "memorize" && G.memorizeReady ? G.memorizeReady.slice() : null,
    log: G.log,
    deckCount: G.deck.length,
    pileCount: G.pile.length,
    pileTop: top ? { r: top.r, s: top.s } : null,
    pileUnder: G.pile.length > 1 ? { r: G.pile[G.pile.length - 2].r, s: G.pile[G.pile.length - 2].s } : null,
    players: G.players.map((p) => ({
      id: p.id,
      name: p.name,
      declared: p.declared,
      memorizeReady: G.phase === "memorize" ? !!(G.memorizeReady && G.memorizeReady[p.id]) : null,
      score: G.phase === "reveal" ? score(p) : null,
      slots: p.slots.map((c, i) => {
        if (!c) return null;
        const isBottomTwo = i >= G.cols && i < G.cols + 2;
        const memorizeReveal = G.phase === "memorize" && p.id === viewerId && isBottomTwo;
        const kb = G.keepBoth;
        const keepFlash =
          G.phase === "keepBoth" && !!kb && kb.pid === p.id && (i === kb.handI || i === kb.placedI);
        const known = G.phase === "reveal" || c.known[viewerId] || memorizeReveal || keepFlash;
        return known ? { r: c.r, s: c.s, known: true } : { known: false };
      }),
    })),
  };
}

// --- Timer replacements: deadlines advanced by applyTimers() ---

export function endMemorize(room: Room): void {
  const G = room.G;
  if (!G || G.phase !== "memorize") return;
  G.phase = "draw";
  G.memorizeReady = null;
  G.memorizeEndsAt = null;
  G.log = "Cards are face-down — remember them. Draw, Pick a passed/discarded center card, or Discard a match.";
}

function startPeekReveal(room: Room, peeker: number, targetPid: number, i: number, next: string, prefix?: string): void {
  const G = room.G!;
  const card = G.players[targetPid].slots[i];
  if (!card) return;
  const priorKnown = !!card.known[peeker];
  card.known[peeker] = true;
  G.phase = "peekReveal";
  G.peekReveal = { peeker, targetPid, i, next, priorKnown };
  G.pick = [];
  G.log = (prefix || "Peeked ") + label(card) + ". Memorize it — it flips face-down again.";
  writePeekDeadline(room, Date.now() + PEEK_MS);
}

export function endPeekReveal(room: Room): void {
  const G = room.G;
  if (!G || G.phase !== "peekReveal") return;
  writePeekDeadline(room, null);
  if (!G.peekReveal) {
    G.phase = "draw";
    return;
  }
  const pr = G.peekReveal;
  const card = G.players[pr.targetPid] && G.players[pr.targetPid].slots[pr.i];
  // Peek is temporary for UI — restore only pre-existing knowledge (e.g. card you gave them)
  if (card) card.known[pr.peeker] = !!pr.priorKnown;
  G.peekReveal = null;
  if (pr.next === "k-peek-opp") {
    G.phase = "power";
    G.powerStep = "k-peek-opp";
    G.powerMine = { pid: pr.targetPid, i: pr.i };
    fillPowerPicks(G);
    if (!G.pick.length) {
      G.log = "No opponent card to peek — King power ends. K stays pickable for next.";
      G.free = true;
      G.power = null;
      G.powerStep = null;
      G.powerTarget = null;
      G.powerMine = null;
      G.pick = [];
      return finish(room);
    }
    G.log = "Memorize your card. Now tap one opponent card to peek.";
    return;
  }
  if (pr.next === "k-trade") {
    G.phase = "power";
    G.powerStep = "k-trade";
    G.powerTarget = { pid: pr.targetPid, i: pr.i };
    G.pick = [];
    G.log = "Memorize both peeks. Trade (swap those two cards) or Skip trade.";
    return;
  }
  G.free = false;
  if (pr.next === "ten-match") {
    G.power = null;
    G.powerStep = null;
    G.powerTarget = null;
    G.powerMine = null;
    G.pick = [];
    const top = pileTop(G);
    // Drawn 10 stays on center. A peeked card of the same rank can be discarded once.
    if (card && top && card.r === top.r) {
      const rank = card.r;
      beginChain(room, pr.peeker, rank, true, {
        keepCenter: true,
        log:
          "Peeked a matching " +
          rank +
          " — discard that " +
          rank +
          " from your hand (or dump an opponent " +
          rank +
          "), or Done. One only.",
      });
      return;
    }
    G.free = false;
    finish(room);
    return;
  }
  G.power = null;
  G.powerStep = null;
  G.powerTarget = null;
  G.powerMine = null;
  G.pick = [];
  finish(room);
}

export function endKeepBothReveal(room: Room): void {
  const G = room.G;
  if (!G || G.phase !== "keepBoth") return;
  writeKeepBothDeadline(room, null);
  if (!G.keepBoth) {
    G.phase = "draw";
    return;
  }
  const kb = G.keepBoth;
  const hand = G.players[kb.pid].slots[kb.handI];
  const kept = G.players[kb.pid].slots[kb.placedI];
  if (hand) hand.known[kb.pid] = !!kb.priorHandKnown;
  if (kept) kept.known[kb.pid] = false;
  G.keepBoth = null;
  finish(room);
}

function turnWaiting(G: Game): boolean {
  if (G.pending) return false;
  return (
    G.phase === "draw" ||
    G.phase === "act" ||
    G.phase === "pick" ||
    G.phase === "chain" ||
    G.phase === "power" ||
    G.phase === "dumpGive"
  );
}

function turnWaitKey(G: Game): string {
  return [G.turn, G.phase, G.powerStep || "", G.intent || "", G.chainRank || ""].join("|");
}

// Start a fresh 30s move clock when the decision in front of the player changes.
// Yes/No is the same decision: the deadline keeps running, and cancelling does not refresh it.
function syncTurnClock(room: Room, now = Date.now()): void {
  const G = room.G;
  if (!G) return;
  if (room.status !== "playing") {
    G.turnEndsAt = null;
    G.turnWaitKey = null;
    return;
  }
  const deciding = !!G.pending || turnWaiting(G);
  if (deciding && G.turnEndsAt == null && G.actEndsAt != null) {
    G.turnEndsAt = G.actEndsAt;
    if (G.turnWaitKey == null) G.turnWaitKey = turnWaitKey(G);
  }
  if (deciding && G.turnEndsAt != null) G.actEndsAt = null;
  if (G.pending) return;
  if (!turnWaiting(G)) {
    G.turnEndsAt = null;
    G.turnWaitKey = null;
    return;
  }
  const key = turnWaitKey(G);
  if (G.turnEndsAt != null && (G.turnWaitKey === key || G.turnWaitKey == null)) {
    if (G.turnWaitKey == null) G.turnWaitKey = key;
    return;
  }
  G.turnWaitKey = key;
  G.turnEndsAt = now + ACT_MS;
}

function clearMoveState(G: Game): void {
  G.intent = null;
  G.pick = [];
  G.pending = null;
  G.actEndsAt = null;
  G.chainPid = null;
  G.chainRank = null;
  G.chainSkipFree = null;
  G.dumpGive = null;
  G.power = null;
  G.powerStep = null;
  G.powerTarget = null;
  G.powerMine = null;
}

// Take the center card into the current player's hand. The keep-both flash ends the turn.
function keepCenterCard(room: Room, now = Date.now()): void {
  const G = room.G!;
  const drawn = pileTop(G);
  if (!drawn) return;
  const pid = G.turn;
  clearMoveState(G);
  G.free = false;
  const extra: Card = { r: drawn.r, s: drawn.s, known: Array(G.n).fill(false) };
  extra.known[pid] = true;
  const placedI = placeDrawnInHand(G, pid, extra);
  G.pile.pop();
  G.phase = "keepBoth";
  G.keepBoth = { pid, handI: placedI, placedI, priorHandKnown: false };
  G.log = "Time's up. You keep " + label(drawn) + " — remember where it is.";
  writeKeepBothDeadline(room, now + KEEP_BOTH_MS);
}

// The move clock ran out. A center card is taken and the turn ends. With no center card, the turn still advances.
function autoPass(room: Room, now = Date.now()): void {
  const G = room.G!;
  G.turnEndsAt = null;
  G.turnWaitKey = null;
  G.pending = null;
  G.actEndsAt = null;
  const top = pileTop(G);
  if (top) return keepCenterCard(room, now);
  if (G.phase === "draw" && !G.deck.length) return reveal(room);
  clearMoveState(G);
  G.free = false;
  G.log = "Time's up. Passed.";
  return finish(room);
}

// Advance any expired deadline timers. Returns true if anything changed.
export function applyTimers(room: Room, now = Date.now()): boolean {
  const G = room.G;
  if (!G || room.status !== "playing") return false;
  let changed = false;
  if (G.phase === "memorize" && G.memorizeEndsAt != null && now >= G.memorizeEndsAt) {
    endMemorize(room);
    changed = true;
  } else if (G.phase === "keepBoth") {
    // A missing deadline is a room reloaded before the timestamp was saved. Finish it.
    const ends = G.keepBothEndsAt ?? room.keepBothEndsAt;
    if (ends == null || now >= ends) {
      endKeepBothReveal(room);
      changed = true;
    }
  } else if (G.phase === "peekReveal") {
    const ends = G.peekEndsAt ?? room.peekEndsAt;
    if (ends == null || now >= ends) {
      endPeekReveal(room);
      changed = true;
    }
  } else if (
    (G.pending || turnWaiting(G)) &&
    ((G.turnEndsAt != null && now >= G.turnEndsAt) ||
      (G.turnEndsAt == null && G.actEndsAt != null && now >= G.actEndsAt))
  ) {
    // Yes/No uses the same deadline. Timing out keeps a center card and ends the turn.
    autoPass(room, now);
    changed = true;
  } else if (G.actEndsAt != null && now >= G.actEndsAt) {
    G.actEndsAt = null;
    changed = true;
  }
  const prevEnd = G.turnEndsAt ?? null;
  const prevKey = G.turnWaitKey ?? null;
  const prevAct = G.actEndsAt ?? null;
  syncTurnClock(room, now);
  if (
    (G.turnEndsAt ?? null) !== prevEnd ||
    (G.turnWaitKey ?? null) !== prevKey ||
    (G.actEndsAt ?? null) !== prevAct
  )
    changed = true;
  return changed;
}

function wrongDiscardKeepBoth(room: Room, pid: number, slotI: number): void {
  const G = room.G!;
  const card = G.players[pid].slots[slotI];
  const drawn = pileTop(G);
  if (!card || !drawn) return;
  clearDecisionTimer(G);
  G.free = false;
  G.intent = null;
  G.pick = [];
  G.chainPid = null;
  G.chainRank = null;
  G.dumpGive = null;
  const priorHandKnown = !!card.known[pid];
  const extra: Card = { r: drawn.r, s: drawn.s, known: Array(G.n).fill(false) };
  // Actor remembers the attempt; every viewer sees both faces via keepBoth, then they flip down.
  card.known[pid] = true;
  extra.known[pid] = true;
  const placedI = placeDrawnInHand(G, pid, extra);
  G.pile.pop();
  G.phase = "keepBoth";
  G.keepBoth = { pid, handI: slotI, placedI, priorHandKnown };
  G.log = "Not a match. You keep " + label(drawn) + " and " + label(card) + " — remember where they are.";
  writeKeepBothDeadline(room, Date.now() + KEEP_BOTH_MS);
}

function wrongOppDumpKeepBoth(room: Room, actor: number, oppPid: number, slotI: number): void {
  const G = room.G!;
  const card = G.players[oppPid].slots[slotI];
  const drawn = pileTop(G);
  if (!card || !drawn) return;
  clearDecisionTimer(G);
  G.free = false;
  G.intent = null;
  G.pick = [];
  G.chainPid = null;
  G.chainRank = null;
  G.dumpGive = null;
  // Opponent loses the mis-clicked card; actor keeps it AND the center/drawn card
  G.players[oppPid].slots[slotI] = null;
  const taken: Card = { r: card.r, s: card.s, known: Array(G.n).fill(false) };
  const kept: Card = { r: drawn.r, s: drawn.s, known: Array(G.n).fill(false) };
  taken.known[actor] = true;
  kept.known[actor] = true;
  const handI = placeDrawnInHand(G, actor, taken);
  const placedI = placeDrawnInHand(G, actor, kept);
  G.pile.pop();
  G.phase = "keepBoth";
  G.keepBoth = { pid: actor, handI, placedI, priorHandKnown: false };
  G.log = "Wrong opponent dump. You take " + label(card) + " and keep " + label(drawn) + " — remember where they are.";
  writeKeepBothDeadline(room, Date.now() + KEEP_BOTH_MS);
}

function swapIntoHand(G: Game, pid: number, i: number): Card {
  const card = G.players[pid].slots[i]!;
  const drawn = pileTop(G)!;
  // Swapped-in center cards stay face-down in hand (unknown to everyone including owner)
  const taken: Card = { r: drawn.r, s: drawn.s, known: Array(G.n).fill(false) };
  G.players[pid].slots[i] = taken;
  G.pile[G.pile.length - 1] = card;
  G.free = false;
  return taken;
}

// One discard/dump per turn overall. After swap/pick, or after a 10 peek of the
// same rank: allowOne offers a single matching discard/dump, then ends (no multi-chain).
// keepCenter: skipping must leave a used power card non-pickable.
function beginChain(
  room: Room,
  pid: number,
  rank: string,
  allowOne?: boolean,
  opts?: { keepCenter?: boolean; log?: string },
): void {
  const G = room.G!;
  const keepCenter = !!(opts && opts.keepCenter);
  clearDecisionTimer(G);
  G.intent = null;
  G.pick = [];
  G.dumpGive = null;
  G.chainPid = null;
  G.chainRank = null;
  G.chainSkipFree = null;
  if (pileTop(G)) G.free = true; // discarded/dumped/swapped top Pickable for next
  if (!allowOne) return finish(room);

  // Post-swap / Pick-swap / post-10-peek: only if that rank is still in hand
  const hasOwn = G.players[pid].slots.some((c) => c && c.r === rank);
  if (!hasOwn) {
    if (keepCenter) G.free = false;
    return finish(room);
  }

  G.phase = "chain";
  G.chainPid = pid;
  G.chainRank = rank;
  G.players[pid].slots.forEach((c, i) => {
    if (c && c.r === rank) G.pick.push(pid + ":" + i);
  });
  addChainOppPicks(G, pid, rank);
  if (keepCenter) {
    G.free = false;
    G.chainSkipFree = false;
  }
  G.log =
    (opts && opts.log) ||
    "You put " +
      rank +
      " on center — discard one matching " +
      rank +
      " from hand (or dump an opponent " +
      rank +
      "), or Done. One only — not a chain.";
}

function startDumpGive(room: Room, actor: number, oppPid: number, emptiedI: number, rank: string): void {
  const G = room.G!;
  clearDecisionTimer(G);
  G.dumpGive = { actor, oppPid, emptiedI, rank };
  G.phase = "dumpGive";
  G.intent = null;
  G.pick = [];
  G.players[actor].slots.forEach((c, i) => {
    if (c) G.pick.push(actor + ":" + i);
  });
  // keep G.free (dump already set true) so next player can Pick after turn
  G.log = "Give them a card — tap one of yours to hand over to " + G.players[oppPid].name + ".";
}

function completeDumpGive(room: Room, giveI: number): void {
  const G = room.G!;
  const dg = G.dumpGive;
  if (!dg) return;
  const actor = dg.actor;
  const card = G.players[actor].slots[giveI];
  if (!card) return;
  G.players[actor].slots[giveI] = null;
  // A dumped/given card is face-down for everyone in its destination slot.
  card.known = Array(G.n).fill(false);
  placeCardInHandPrefer(G, dg.oppPid, card, dg.emptiedI);
  const rank = dg.rank;
  const oppName = G.players[dg.oppPid].name;
  G.dumpGive = null;
  G.log = "Gave a card to " + oppName + ". One match action done — turn ends.";
  return beginChain(room, actor, rank);
}

function tryDumpOpponent(room: Room, actor: number, oppPid: number, i: number): boolean {
  const G = room.G!;
  if (oppPid === actor || handLocked(G, oppPid)) return false;
  const rank = matchRankForDump(G);
  if (!rank) return false;
  const key = oppPid + ":" + i;
  if (G.pick.indexOf(key) < 0) return false;
  const card = G.players[oppPid].slots[i];
  if (!card) return false;
  if (card.r !== rank) {
    // After a swap or peek, the center card was just placed. A mismatched
    // follow-up dump must not take that card plus the opponent card.
    if (G.phase === "chain") return false;
    wrongOppDumpKeepBoth(room, actor, oppPid, i);
    return true;
  }
  if (!G.players[actor].slots.some((c) => !!c)) {
    G.log = "Need a card to give them after dumping.";
    return true;
  }
  G.players[oppPid].slots[i] = null;
  G.pile.push(card);
  G.free = true; // dumped center card Pickable by next after this turn
  G.log = "Dumped " + label(card) + " from " + G.players[oppPid].name + " onto the center.";
  startDumpGive(room, actor, oppPid, i, rank);
  return true;
}

export function startGame(room: Room): void {
  room.keepBothEndsAt = null;
  room.peekEndsAt = null;
  room.G = makeDeal(room.n, room.cardsN);
  for (let i = 0; i < room.n; i++) {
    if (room.seats[i]) room.G.players[i].name = room.seats[i]!.name;
  }
  room.status = "playing";
}

export function finish(room: Room): void {
  const G = room.G!;
  clearDecisionTimer(G);
  G.pick = [];
  G.intent = null;
  G.dumpGive = null;
  G.chainPid = null;
  G.chainRank = null;
  G.chainSkipFree = null;
  if (G.declarer !== null) G.queue = G.queue.filter((id) => id !== G.turn);
  nextTurn(room);
}

export function nextTurn(room: Room): void {
  const G = room.G!;
  clearDecisionTimer(G);
  if (G.declarer !== null && !G.queue.length) return reveal(room);
  G.turn = G.declarer !== null ? G.queue[0] : (G.turn + 1) % G.n;
  G.phase = "draw";
  refreshActDumpPicks(G);
}

export function reveal(room: Room): void {
  const G = room.G!;
  G.phase = "reveal";
  const scores = G.players.map(score);
  const low = Math.min(...scores);
  let text = scores.map((s, i) => G.players[i].name + " " + s).join(", ") + ". ";
  const winners = G.players.filter((_, i) => scores[i] === low).map((p) => p.name);
  text += winners.length > 1 ? "Tie." : winners[0] + " wins.";
  G.log = text;
  room.status = "ended";
}

function dragDiscard(room: Room, pid: number, i: number): boolean {
  const G = room.G!;
  const card = G.players[pid] && G.players[pid].slots[i];
  const drawn = pileTop(G);
  if (!card || !drawn || pid !== G.turn) return false;
  if (G.phase === "chain") {
    if (G.pick.indexOf(pid + ":" + i) < 0) return false;
    if (card.r !== G.chainRank) return false;
    const afterPeek = G.chainSkipFree === false;
    G.players[pid].slots[i] = null;
    G.pile.push(card);
    G.free = true;
    G.chainSkipFree = null;
    G.log =
      "Discarded matching " +
      label(card) +
      (afterPeek ? " after the peek." : " after swap.") +
      " Turn ends; next can Pick it.";
    G.pick = [];
    G.chainPid = null;
    G.chainRank = null;
    finish(room);
    return true;
  }
  const allowed =
    G.phase === "act" || (G.phase === "draw" && G.free) || (G.phase === "pick" && G.intent === "discard");
  if (!allowed) return false;
  if (card.r === drawn.r) {
    G.players[pid].slots[i] = null;
    G.pile.push(card);
    G.free = true;
    G.log =
      "Discarded " +
      label(card) +
      " on top of " +
      label(drawn) +
      ". One match action — turn ends; next can Pick it.";
    beginChain(room, pid, card.r);
    return true;
  }
  wrongDiscardKeepBoth(room, pid, i);
  return true;
}

function dragDump(room: Room, pid: number, oppPid: number, i: number): boolean {
  const G = room.G!;
  if (oppPid === pid || handLocked(G, oppPid)) return false;
  if (!pileTop(G)) return false;
  const allowed =
    G.phase === "act" ||
    (G.phase === "draw" && G.free) ||
    G.phase === "chain" ||
    (G.phase === "pick" && G.intent === "discard");
  if (!allowed || pid !== G.turn) return false;
  if ((G.phase === "act" || (G.phase === "draw" && G.free)) && G.pick.indexOf(oppPid + ":" + i) < 0) {
    addDumpPicks(G, pid);
  }
  return !!tryDumpOpponent(room, pid, oppPid, i);
}

function dragQueen(room: Room, pid: number, myI: number, oppPid: number, oppI: number): boolean {
  const G = room.G!;
  if (G.phase !== "power" || G.power !== "Q" || pid !== G.turn) return false;
  if (G.powerStep !== "q-mine" && G.powerStep !== "q-theirs") return false;
  if (oppPid == null || oppI == null || oppPid === pid || handLocked(G, oppPid)) return false;
  const mine = G.players[pid].slots[myI];
  const theirs = G.players[oppPid].slots[oppI];
  if (!mine || !theirs) return false;
  G.players[pid].slots[myI] = theirs;
  G.players[oppPid].slots[oppI] = mine;
  G.players[pid].slots[myI]!.known = Array(G.n).fill(false);
  G.players[oppPid].slots[oppI]!.known = Array(G.n).fill(false);
  G.log = "Blind-traded with " + G.players[oppPid].name + ".";
  G.free = false;
  G.power = null;
  G.powerStep = null;
  G.powerTarget = null;
  G.powerMine = null;
  G.pick = [];
  finish(room);
  return true;
}

function applyKingTrade(room: Room, pid: number): boolean {
  const G = room.G!;
  const mine = G.powerMine;
  const opp = G.powerTarget;
  if (!mine || !opp) return false;
  const myCard = G.players[mine.pid].slots[mine.i];
  const oppCard = G.players[opp.pid].slots[opp.i];
  if (!myCard || !oppCard) {
    G.log = "Trade failed — a peeked card is gone. K stays pickable for next.";
    G.free = true;
    G.power = null;
    G.powerStep = null;
    G.powerTarget = null;
    G.powerMine = null;
    G.pick = [];
    finish(room);
    return true;
  }
  G.players[mine.pid].slots[mine.i] = oppCard;
  G.players[opp.pid].slots[opp.i] = myCard;
  G.players[mine.pid].slots[mine.i]!.known = Array(G.n).fill(false);
  G.players[opp.pid].slots[opp.i]!.known = Array(G.n).fill(false);
  G.log = G.players[pid].name + " traded after King peeks. K stays pickable for next.";
  G.free = true;
  G.power = null;
  G.powerStep = null;
  G.powerTarget = null;
  G.powerMine = null;
  G.pick = [];
  finish(room);
  return true;
}

function dragKing(room: Room, pid: number, p: number, i: number, tp: number | null, ti: number | null): boolean {
  const G = room.G!;
  if (G.phase !== "power" || G.powerStep !== "k-trade" || pid !== G.turn) return false;
  const mine = G.powerMine;
  const opp = G.powerTarget;
  if (!mine || !opp) return false;
  const forward = p === mine.pid && i === mine.i && tp === opp.pid && ti === opp.i;
  const back = p === opp.pid && i === opp.i && tp === mine.pid && ti === mine.i;
  if (!forward && !back) return false;
  return applyKingTrade(room, pid);
}

// Drag chooses the same move the buttons used to arm. It does not add rules.
function handleDrag(room: Room, pid: number, msg: { action: string; [k: string]: unknown }): boolean {
  const G = room.G;
  if (!G || room.status !== "playing") return false;
  if (G.phase === "reveal" || G.phase === "memorize" || G.phase === "keepBoth" || G.phase === "peekReveal") return false;
  if (pid !== G.turn) return false;

  const gesture = msg.gesture as string;
  const i = Number(msg.i);
  const p = msg.p != null ? Number(msg.p) : pid;
  const ti = msg.ti != null ? Number(msg.ti) : null;
  const tp = msg.tp != null ? Number(msg.tp) : null;
  if (!Number.isInteger(i) || i < 0) return false;

  if (gesture === "swap" || gesture === "claim") {
    if (gesture === "swap" && G.phase !== "act") return false;
    if (gesture === "claim" && !(G.phase === "draw" && G.free && pileTop(G))) return false;
    if (p !== pid) return false;
    const card = G.players[pid].slots[i];
    const drawn = pileTop(G);
    if (!card || !drawn) return false;
    const taken = swapIntoHand(G, pid, i);
    const dumped = pileTop(G);
    G.log = (gesture === "claim" ? "Picked " : "Swapped in ") + label(taken) + " — " + label(dumped!) + " on center.";
    beginChain(room, pid, dumped!.r, true);
    return true;
  }

  if (gesture === "discard") {
    if (p !== pid) return false;
    return dragDiscard(room, pid, i);
  }

  if (gesture === "dump") return dragDump(room, pid, p, i);

  if (gesture === "give") {
    if (G.phase !== "dumpGive" || !G.dumpGive || G.dumpGive.actor !== pid) return false;
    if (p !== pid) return false;
    if (G.pick.indexOf(pid + ":" + i) < 0) return false;
    completeDumpGive(room, i);
    return true;
  }

  if (gesture === "qtrade") {
    const myI = p === pid ? i : ti;
    const oppPid = p === pid ? tp : p;
    const oppI = p === pid ? ti : i;
    if (myI == null || oppPid == null || oppI == null) return false;
    return dragQueen(room, pid, myI, oppPid, oppI);
  }

  if (gesture === "ktrade") return dragKing(room, pid, p, i, tp, ti);
  return false;
}

export function handleAction(room: Room, pid: number, msg: { action: string; [k: string]: unknown }): boolean | void {
  const result = runHandleAction(room, pid, msg);
  const now = Date.now();
  syncTurnClock(room, now);
  const G = room.G;
  if (
    G &&
    room.status === "playing" &&
    G.turnEndsAt != null &&
    now >= G.turnEndsAt &&
    (G.pending || turnWaiting(G))
  ) {
    autoPass(room, now);
    syncTurnClock(room, now);
  }
  return result;
}

function runHandleAction(room: Room, pid: number, msg: { action: string; [k: string]: unknown }): boolean | void {
  const G = room.G;
  const act = msg.action;

  if (act === "quit") {
    room.status = "abandoned";
    return;
  }

  // A finished round is phase "reveal" and status "ended". Those used to
  // return before this action was read, so New Deal never dealt again.
  if (act === "redeal") {
    if (room.seats.filter(Boolean).length < room.n) return;
    const roundOver = !!G && (G.phase === "reveal" || room.status === "ended");
    if (!roundOver) return;
    startGame(room);
    return;
  }

  if (!G || room.status !== "playing") return;
  if (G.phase === "reveal") return;
  if (G.phase === "keepBoth" || G.phase === "peekReveal") return;

  if (G.phase === "dumpGive" && act !== "card" && act !== "drag") return;

  if (G.phase === "memorize") {
    if (act === "ready") {
      if (!G.memorizeReady || G.memorizeReady[pid]) return;
      G.memorizeReady[pid] = true;
      const waiting = G.memorizeReady.filter((r) => !r).length;
      G.log = G.players[pid].name + " is ready." + (waiting ? " Waiting for " + waiting + " more…" : "");
      if (G.memorizeReady.every(Boolean)) return endMemorize(room);
      return;
    }
    return;
  }

  if (
    pid !== G.turn &&
    !(
      (G.phase === "pick" || G.phase === "power" || G.phase === "chain") &&
      G.pick.some((x) => x.startsWith(pid + ":"))
    )
  )
    return;

  if (G.pending && pid === G.turn && act !== "confirm" && act !== "cancel" && act !== "pending") return;

  if (act === "drag") return handleDrag(room, pid, msg);

  if (act === "draw") {
    if (G.phase !== "draw" || pid !== G.turn) return;
    if (!G.deck.length) return reveal(room);
    G.free = false;
    const card = G.deck.pop()!;
    G.pile.push(card);
    G.phase = "act";
    G.pick = [];
    G.pending = null;
    G.actEndsAt = null;
    addDumpPicks(G, pid);
    G.log =
      "Drew " +
      label(card) +
      ". " +
      (isPowerRank(card.r) ? powerHint(card.r) + " " : "") +
      "Pass leaves it for others to Pick. Dump an opponent match (wrong card = you take theirs + keep center). 30 seconds to move — if time runs out you keep the center card.";
    return;
  }

  if (act === "pending") {
    if (pid !== G.turn) return;
    const choice = msg.choice as string;
    const top = pileTop(G);
    if ((choice === "pass" || choice === "swap") && G.phase === "act" && top) {
      G.pending = choice;
    } else if (choice === "claim" && G.phase === "draw" && G.free && top) {
      G.pending = choice;
    } else return;
    G.log = choiceVerb(choice) + " " + label(top!) + "? Yes to confirm, No to choose again.";
    return;
  }

  if (act === "cancel") {
    if (pid !== G.turn || !G.pending) return;
    G.pending = null;
    G.log = "Cancelled. Choose Pick, Pass, or Swap again.";
    return;
  }

  if (act === "confirm") {
    if (pid !== G.turn || !G.pending) return;
    const choice = G.pending;
    const top = pileTop(G);
    G.pending = null;
    if (choice === "pass") {
      if (G.phase !== "act" || !top) return;
      G.free = true;
      G.log = "Passed. " + label(top) + " stays in the center — next player can Pick it or Discard a match.";
      clearDecisionTimer(G);
      return finish(room);
    }
    if (choice === "swap") {
      if (G.phase !== "act" || !top) return;
      G.intent = "swap";
      G.phase = "pick";
      G.pick = [];
      G.players[pid].slots.forEach((c, i) => {
        if (c) G.pick.push(pid + ":" + i);
      });
      G.log = "Tap the card you are giving up.";
      return;
    }
    if (choice === "claim") {
      if (!(G.phase === "draw" && G.free && top)) return;
      G.intent = "claim";
      G.phase = "pick";
      G.pick = [];
      G.players[pid].slots.forEach((c, i) => {
        if (c) G.pick.push(pid + ":" + i);
      });
      G.log = "Pick " + label(top) + ": tap the card in your hand you are giving up.";
      return;
    }
    return;
  }

  if (act === "pass") {
    if (G.phase !== "act" || pid !== G.turn) return;
    G.free = true;
    G.log = "Passed. " + label(pileTop(G)!) + " stays in the center — next player can Pick it or Discard a match.";
    return finish(room);
  }

  if (act === "arm") {
    const intent = msg.intent as string;
    if (intent === "discard" && G.phase === "draw" && G.free && pileTop(G) && pid === G.turn) {
      G.intent = "discard";
      G.phase = "pick";
      G.pick = [];
      G.players[pid].slots.forEach((c, i) => {
        if (c) G.pick.push(pid + ":" + i);
      });
      addDumpPicks(G, pid);
      G.log =
        "Tap a matching card (yours or an opponent " +
        pileTop(G)!.r +
        "). Wrong own/opponent card: you keep both / take theirs+center.";
      return;
    }
    if (G.phase !== "act" || pid !== G.turn) return;
    if (intent !== "swap" && intent !== "discard") return;
    G.intent = intent;
    G.phase = "pick";
    G.pick = [];
    G.players[pid].slots.forEach((c, i) => {
      if (c) G.pick.push(pid + ":" + i);
    });
    if (intent === "discard") addDumpPicks(G, pid);
    G.log =
      intent === "discard"
        ? "Tap a matching card (yours or an opponent " +
          pileTop(G)!.r +
          "). Wrong own/opponent card: you keep both / take theirs+center."
        : "Tap the card you are giving up.";
    return;
  }

  if (act === "claim") {
    if (!(G.phase === "draw" && G.free && pileTop(G) && pid === G.turn)) return;
    G.intent = "claim";
    G.phase = "pick";
    G.pick = [];
    G.players[pid].slots.forEach((c, i) => {
      if (c) G.pick.push(pid + ":" + i);
    });
    G.log = "Pick " + label(pileTop(G)!) + ": tap the card in your hand you are giving up.";
    return;
  }

  if (act === "card") {
    const i = msg.i as number;
    const targetPid = msg.p != null ? (msg.p as number) : pid;
    const key = targetPid + ":" + i;
    if (G.phase === "dumpGive") {
      if (pid !== G.turn || !G.dumpGive || G.dumpGive.actor !== pid) return;
      if (G.pick.indexOf(pid + ":" + i) < 0) return;
      return completeDumpGive(room, i);
    }
    if (G.phase === "act" || (G.phase === "draw" && G.free)) {
      if (pid !== G.turn) return;
      if (targetPid !== pid && tryDumpOpponent(room, pid, targetPid, i)) return;
    }
    if (G.phase === "chain") {
      // Post-swap or post-10-peek one-shot match only (allowOne). After this action, turn ends.
      if (pid !== G.turn) return;
      if (G.pick.indexOf(key) < 0) return;
      if (targetPid !== pid) {
        if (tryDumpOpponent(room, pid, targetPid, i)) return;
        return;
      }
      const ch = G.players[pid].slots[i];
      if (!ch || ch.r !== G.chainRank) return;
      const afterPeek = G.chainSkipFree === false;
      G.players[pid].slots[i] = null;
      G.pile.push(ch);
      G.free = true;
      G.chainSkipFree = null;
      G.log =
        "Discarded matching " +
        label(ch) +
        (afterPeek ? " after the peek." : " after swap.") +
        " Turn ends; next can Pick it.";
      G.pick = [];
      G.chainPid = null;
      G.chainRank = null;
      return finish(room);
    }
    if (G.phase === "power") {
      if (pid !== G.turn) return;
      if (G.pick.indexOf(key) < 0) return;
      const me = G.turn;
      if (G.powerStep === "peek-own") {
        return startPeekReveal(room, me, targetPid, i, "ten-match", "Peeked your card: ");
      }
      if (G.powerStep === "peek-opp") {
        if (handLocked(G, targetPid)) return;
        return startPeekReveal(room, me, targetPid, i, "finish", "Peeked opponent card: ");
      }
      if (G.powerStep === "q-mine") {
        G.powerTarget = { pid: targetPid, i };
        G.powerStep = "q-theirs";
        fillPowerPicks(G);
        if (!G.pick.length) {
          G.log = "Declarer's hand is locked — no trade target. Power cancelled.";
          G.free = false;
          G.power = null;
          G.powerStep = null;
          G.powerTarget = null;
          G.powerMine = null;
          G.pick = [];
          return finish(room);
        }
        G.log = "Blind trade: tap an opponent card to swap with.";
        return;
      }
      if (G.powerStep === "q-theirs") {
        if (handLocked(G, targetPid)) return;
        const a = G.powerTarget!;
        const mine = G.players[a.pid].slots[a.i]!;
        const theirs = G.players[targetPid].slots[i]!;
        G.players[a.pid].slots[a.i] = theirs;
        G.players[targetPid].slots[i] = mine;
        G.players[a.pid].slots[a.i]!.known = Array(G.n).fill(false);
        G.players[targetPid].slots[i]!.known = Array(G.n).fill(false);
        G.log = "Blind-traded with " + G.players[targetPid].name + ".";
        G.free = false;
        G.power = null;
        G.powerStep = null;
        G.powerTarget = null;
        G.powerMine = null;
        G.pick = [];
        return finish(room);
      }
      if (G.powerStep === "k-peek-own") {
        if (targetPid !== me) return;
        return startPeekReveal(room, me, targetPid, i, "k-peek-opp", "Peeked your card: ");
      }
      if (G.powerStep === "k-peek-opp") {
        if (handLocked(G, targetPid)) return;
        return startPeekReveal(room, me, targetPid, i, "k-trade", "Peeked opponent card: ");
      }
      // k-trade uses confirmTrade / skipTrade buttons, not card taps
      return;
    }
    if (G.phase !== "pick") return;
    if (pid !== G.turn) return;
    if (G.pick.indexOf(key) < 0) return;
    if (G.intent === "discard" && targetPid !== pid) {
      if (tryDumpOpponent(room, pid, targetPid, i)) return;
      return;
    }
    if (targetPid !== pid) return;
    const card = G.players[pid].slots[i]!;
    const drawn = pileTop(G)!;
    if (G.intent === "discard") {
      if (card.r === drawn.r) {
        G.players[pid].slots[i] = null;
        G.pile.push(card);
        G.free = true; // discarded top is Pickable by next player
        G.log =
          "Discarded " +
          label(card) +
          " on top of " +
          label(drawn) +
          ". One match action — turn ends; next can Pick it.";
        return beginChain(room, pid, card.r);
      }
      // Wrong rank: no do-over — keep both cards, brief reveal, end turn
      return wrongDiscardKeepBoth(room, pid, i);
    }
    const taken = swapIntoHand(G, pid, i);
    const dumped = G.pile[G.pile.length - 1];
    const verb = G.intent === "claim" ? "Picked " : "Swapped in ";
    G.log = verb + label(taken) + " — " + label(dumped) + " on center.";
    // After swap/pick: one optional match of the rank put on center, then end
    return beginChain(room, pid, dumped.r, true);
  }

  if (act === "power") {
    if (G.phase !== "act" || pid !== G.turn) return;
    const top = pileTop(G);
    if (!top || !isPowerRank(top.r)) return;
    const needsOpp = top.r === "J" || top.r === "Q" || top.r === "K";
    if (needsOpp && !hasUnlockedOppCards(G, pid)) {
      G.log = "Declarer's hand is locked — no J/Q/K target available. Pass, discard, or swap instead.";
      return;
    }
    clearDecisionTimer(G);
    G.power = top.r;
    G.phase = "power";
    G.powerStep = top.r === "10" ? "peek-own" : top.r === "J" ? "peek-opp" : top.r === "Q" ? "q-mine" : "k-peek-own";
    G.powerTarget = null;
    G.powerMine = null;
    fillPowerPicks(G);
    G.log = powerHint(top.r) + " Tap a highlighted card.";
    return;
  }

  if (act === "passChain") {
    if (G.phase !== "chain" || pid !== G.turn) return;
    const keepCenter = G.chainSkipFree === false;
    G.pick = [];
    G.chainPid = null;
    G.chainRank = null;
    G.chainSkipFree = null;
    if (keepCenter) {
      G.free = false;
      G.log = "Done — skipped matching discard after the peek.";
    } else {
      if (pileTop(G)) G.free = true;
      G.log = "Done — skipped extra match after swap. Next can Pick center.";
    }
    return finish(room);
  }

  if (act === "skipTrade") {
    if (G.phase !== "power" || G.powerStep !== "k-trade" || pid !== G.turn) return;
    // After Use power on K, K stays on center pickable for next (same as Pass)
    G.free = true;
    // Peeks were temporary UI only; priorKnown already restored after each peekReveal
    G.log = "Skipped trade. K stays pickable for next.";
    G.power = null;
    G.powerStep = null;
    G.powerTarget = null;
    G.powerMine = null;
    G.pick = [];
    return finish(room);
  }

  if (act === "confirmTrade") {
    if (G.phase !== "power" || G.powerStep !== "k-trade" || pid !== G.turn) return;
    applyKingTrade(room, pid);
    return;
  }

  if (act === "declare") {
    if (G.phase !== "draw" || G.declarer !== null || pid !== G.turn) return;
    G.players[pid].declared = true;
    G.declarer = pid;
    G.queue = [];
    for (let i = 0; i < G.n; i++) if (i !== pid) G.queue.push(i);
    G.log =
      G.players[pid].name +
      " declared. Their hand is locked — no dumps, peeks, or trades against it. Final turns: draw/discard/pick on your own hand & center only.";
    return nextTurn(room);
  }

}
