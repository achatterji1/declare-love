// Declare game engine — pure TypeScript port of server.js.
// Wall-clock setTimeout timers are replaced by deadline fields on the game
// state (memorizeEndsAt / keepBothEndsAt / peekEndsAt); applyTimers() advances
// the game past any expired deadline and is called on every read and write.

export interface Seat {
  name: string;
  token: string;
}

export interface Room {
  code: string;
  n: number;
  cardsN: number;
  seats: (Seat | null)[];
  status: string; // "lobby" | "playing"
  G: any;
  version: number;
}

const MEMORIZE_MS = 12000;
const KEEP_BOTH_MS = 10000;
const PEEK_MS = 10000;

function randInt(n: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) % n;
}

function code(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += alphabet[randInt(alphabet.length)];
  return c;
}

export function newCode(): string {
  return code();
}

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const JOKER = { r: "JOKER", s: "★" };

function cardValue(c: any): number {
  if (c.r === "JOKER") return 0;
  if (c.r === "A") return 1;
  if (c.r === "J" || c.r === "Q" || c.r === "K") return 10;
  return parseInt(c.r, 10);
}

function label(c: any): string {
  return c ? `${c.r}${c.s}` : "";
}

function newDeck(): any[] {
  const d: any[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  d.push({ ...JOKER }, { ...JOKER });
  return d;
}

function shuffle(a: any[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
}

export function makeDeal(n: number, cardsN: number): any {
  const deck = newDeck();
  shuffle(deck);
  const players = Array.from({ length: n }, () => ({
    slots: Array(cardsN).fill(null),
    total: 0,
  }));
  for (let k = 0; k < cardsN; k++)
    for (let p = 0; p < n; p++) players[p].slots[k] = deck.pop();
  const discard = [deck.pop()];
  return {
    phase: "memorize",
    players,
    deck,
    pile: discard,
    turn: 0,
    declarer: null,
    lastTurnOf: null,
    drawn: null,
    keepBoth: null,
    peekReveal: null,
    pick: [],
    chainPid: null,
    chainRank: null,
    log: [],
    free: true,
    memorizeEndsAt: Date.now() + MEMORIZE_MS,
    memorizeReady: Array(n).fill(false),
    keepBothEndsAt: null,
    peekEndsAt: null,
  };
}

export function startGame(room: Room): void {
  room.G = makeDeal(room.n, room.cardsN);
  room.status = "playing";
}

function say(room: Room, msg: string): void {
  const G = room.G;
  G.log.push(msg);
  if (G.log.length > 50) G.log.shift();
}

function isPowerRank(r: string): boolean {
  return r === "10" || r === "J" || r === "Q" || r === "K";
}

function endMemorize(room: Room): void {
  const G = room.G;
  if (G.phase !== "memorize") return;
  G.memorizeEndsAt = null;
  G.phase = "draw";
  say(room, "Memorize over. " + "Player 1 starts.");
}

function totals(G: any): void {
  for (const p of G.players) {
    p.total = p.slots.reduce((a: number, c: any) => a + (c ? cardValue(c) : 0), 0);
  }
}

function endKeepBothReveal(room: Room): void {
  const G = room.G;
  if (!G.keepBoth || G.phase !== "keepBoth") return;
  G.keepBothEndsAt = null;
  G.keepBoth = null;
  G.phase = "act";
  say(room, "Cards hidden again. Choose Swap, Discard, or Leave.");
}

function endPeekReveal(room: Room): void {
  const G = room.G;
  if (!G.peekReveal || G.phase !== "peekReveal") return;
  G.peekEndsAt = null;
  G.peekReveal = null;
  G.phase = "act";
  say(room, "Peek over. Choose Swap, Discard, or Leave.");
}

// Advance the game past any expired deadline. Returns true if anything changed.
export function applyTimers(room: Room, now: number = Date.now()): boolean {
  const G = room.G;
  if (!G) return false;
  let changed = false;
  if (G.phase === "memorize" && G.memorizeEndsAt && now >= G.memorizeEndsAt) {
    endMemorize(room);
    changed = true;
  }
  if (G.phase === "keepBoth" && G.keepBothEndsAt && now >= G.keepBothEndsAt) {
    endKeepBothReveal(room);
    changed = true;
  }
  if (G.phase === "peekReveal" && G.peekEndsAt && now >= G.peekEndsAt) {
    endPeekReveal(room);
    changed = true;
  }
  return changed;
}

function reshuffleIfNeeded(room: Room): void {
  const G = room.G;
  if (G.deck.length) return;
  const top = G.pile.pop();
  G.deck = G.pile;
  shuffle(G.deck);
  G.pile = [top];
  say(room, "Deck exhausted; discard pile reshuffled into the deck.");
}

function advanceTurn(room: Room): void {
  const G = room.G;
  if (G.declarer !== null && G.lastTurnOf === G.turn) {
    G.phase = "reveal";
    totals(G);
    say(room, "Round over. Hands revealed.");
    return;
  }
  G.turn = (G.turn + 1) % G.players.length;
  G.phase = "draw";
  G.drawn = null;
  G.keepBoth = null;
  G.peekReveal = null;
  G.keepBothEndsAt = null;
  G.peekEndsAt = null;
  G.pick = [];
  G.chainPid = null;
  G.chainRank = null;
  G.free = true;
  say(room, "Turn: Player " + (G.turn + 1));
}

function maybeFinishAfterDiscard(room: Room, pid: number): void {
  const G = room.G;
  say(room, "Player " + (pid + 1) + " discarded " + label(G.pile[G.pile.length - 1]) + ".");
  G.drawn = null;
  G.pick = [];
  G.chainPid = null;
  G.chainRank = null;
  G.free = true;
  advanceTurn(room);
}

function removeSlotToPile(room: Room, pid: number, i: number): void {
  const G = room.G;
  const c = G.players[pid].slots[i];
  if (!c) return;
  G.players[pid].slots[i] = null;
  G.pile.push(c);
}

export function handleAction(room: Room, pid: number, msg: any): void {
  const G = room.G;
  if (!G) return;
  applyTimers(room);
  const act = msg.action;

  if (G.phase === "reveal") return;

  if (G.phase === "memorize") {
    if (act === "ready") {
      if (!G.memorizeReady || G.memorizeReady[pid]) return;
      G.memorizeReady[pid] = true;
      say(room, "Player " + (pid + 1) + " is ready.");
      if (G.memorizeReady.every(Boolean)) endMemorize(room);
    }
    return;
  }

  if (act === "declare" && G.phase === "draw" && pid === G.turn && G.declarer === null) {
    G.declarer = pid;
    G.lastTurnOf = (pid + G.players.length - 1) % G.players.length;
    say(room, "Player " + (pid + 1) + " declares! Everyone else gets one final turn.");
    G.phase = "draw";
    G.drawn = null;
    G.keepBoth = null;
    G.peekReveal = null;
    G.keepBothEndsAt = null;
    G.peekEndsAt = null;
    G.pick = [];
    G.chainPid = null;
    G.chainRank = null;
    G.free = true;
    advanceTurn(room);
    return;
  }

  if (G.phase === "draw" && act === "draw" && pid === G.turn) {
    reshuffleIfNeeded(room);
    const c = G.deck.pop();
    G.drawn = c;
    G.phase = "act";
    say(room, "Player " + (pid + 1) + " drew a card.");
    return;
  }

  if (G.phase === "draw" && act === "pickup" && pid === G.turn && G.free && G.pile.length) {
    const c = G.pile.pop();
    G.drawn = c;
    G.phase = "act";
    G.free = false;
    say(room, "Player " + (pid + 1) + " picked up " + label(c) + " from the discard pile.");
    return;
  }

  if (G.phase === "act" && pid === G.turn && G.drawn) {
    if (act === "discard") {
      const c = G.drawn;
      G.pile.push(c);
      G.drawn = null;
      say(room, "Player " + (pid + 1) + " discarded " + label(c) + ".");
      if (isPowerRank(c.r)) {
        if (c.r === "10") {
          G.phase = "power10";
          say(room, "Power 10: peek one of your own cards.");
        } else if (c.r === "J") {
          G.phase = "powerJ";
          say(room, "Power J: peek one opponent card.");
        } else if (c.r === "Q") {
          G.phase = "powerQ";
          say(room, "Power Q: blind-trade one of your cards with an opponent card.");
        } else if (c.r === "K") {
          G.phase = "powerK1";
          say(room, "Power K: peek one of your cards.");
        }
      } else {
        advanceTurn(room);
      }
      return;
    }
    if (act === "leave") {
      const c = G.drawn;
      const P = G.players[pid];
      const i = P.slots.findIndex((s: any) => s === null);
      if (i >= 0) {
        P.slots[i] = c;
        G.drawn = null;
        say(room, "Player " + (pid + 1) + " kept the drawn card in an empty slot.");
        advanceTurn(room);
      }
      return;
    }
    if (act === "swap" && typeof msg.slot === "number") {
      const P = G.players[pid];
      const i = msg.slot;
      if (i < 0 || i >= P.slots.length) return;
      const old = P.slots[i];
      P.slots[i] = G.drawn;
      G.drawn = null;
      if (old) G.pile.push(old);
      say(room, "Player " + (pid + 1) + " swapped a card.");
      advanceTurn(room);
      return;
    }
  }

  if (G.phase === "power10" && pid === G.turn && act === "peekSelf" && typeof msg.slot === "number") {
    const P = G.players[pid];
    const i = msg.slot;
    if (i < 0 || i >= P.slots.length || !P.slots[i]) return;
    G.peekReveal = { kind: "single", pid, i };
    G.peekEndsAt = Date.now() + PEEK_MS;
    G.phase = "peekReveal";
    say(room, "Peeking…");
    return;
  }

  if (G.phase === "powerJ" && pid === G.turn && act === "peekOpp" && typeof msg.opp === "number" && typeof msg.slot === "number") {
    const o = msg.opp;
    const i = msg.slot;
    if (o === pid || o < 0 || o >= G.players.length) return;
    const P = G.players[o];
    if (i < 0 || i >= P.slots.length || !P.slots[i]) return;
    G.peekReveal = { kind: "single", pid: o, i };
    G.peekEndsAt = Date.now() + PEEK_MS;
    G.phase = "peekReveal";
    say(room, "Peeking…");
    return;
  }

  if (G.phase === "powerQ" && pid === G.turn && act === "blindTrade" && typeof msg.opp === "number" && typeof msg.theirSlot === "number" && typeof msg.mySlot === "number") {
    const o = msg.opp;
    const ti = msg.theirSlot;
    const mi = msg.mySlot;
    if (o === pid || o < 0 || o >= G.players.length) return;
    const A = G.players[pid];
    const B = G.players[o];
    if (mi < 0 || mi >= A.slots.length || ti < 0 || ti >= B.slots.length) return;
    if (!A.slots[mi] || !B.slots[ti]) return;
    const tmp = A.slots[mi];
    A.slots[mi] = B.slots[ti];
    B.slots[ti] = tmp;
    say(room, "Player " + (pid + 1) + " blind-traded with Player " + (o + 1) + ".");
    advanceTurn(room);
    return;
  }

  if (G.phase === "powerK1" && pid === G.turn && act === "kPeekSelf" && typeof msg.slot === "number") {
    const P = G.players[pid];
    const i = msg.slot;
    if (i < 0 || i >= P.slots.length || !P.slots[i]) return;
    G.keepBoth = { kSelf: i, kOpp: null, kOppSeat: null };
    G.keepBothEndsAt = Date.now() + KEEP_BOTH_MS;
    G.phase = "keepBoth";
    say(room, "K: your card is revealed briefly, then peek an opponent card.");
    return;
  }

  if (G.phase === "keepBoth" && pid === G.turn && act === "kPeekOpp" && typeof msg.opp === "number" && typeof msg.slot === "number") {
    const o = msg.opp;
    const i = msg.slot;
    if (o === pid || o < 0 || o >= G.players.length) return;
    const P = G.players[o];
    if (i < 0 || i >= P.slots.length || !P.slots[i]) return;
    G.keepBoth = G.keepBoth || {};
    G.keepBoth.kOpp = i;
    G.keepBoth.kOppSeat = o;
    G.phase = "kTrade";
    say(room, "K: choose Trade or Skip.");
    return;
  }

  if (G.phase === "kTrade" && pid === G.turn && act === "kConfirm") {
    const kb = G.keepBoth || {};
    if (kb.kSelf === null || kb.kSelf === undefined || kb.kOpp === null || kb.kOpp === undefined) return;
    const A = G.players[pid];
    const B = G.players[kb.kOppSeat];
    const tmp = A.slots[kb.kSelf];
    A.slots[kb.kSelf] = B.slots[kb.kOpp];
    B.slots[kb.kOpp] = tmp;
    say(room, "Player " + (pid + 1) + " traded (K power).");
    G.keepBoth = null;
    advanceTurn(room);
    return;
  }

  if (G.phase === "kTrade" && pid === G.turn && act === "kSkip") {
    say(room, "Player " + (pid + 1) + " skipped the K trade.");
    G.keepBoth = null;
    advanceTurn(room);
    return;
  }

  if (act === "discardMatch" && typeof msg.slot === "number") {
    const P = G.players[pid];
    const i = msg.slot;
    if (i < 0 || i >= P.slots.length || !P.slots[i]) return;
    if (!G.pile.length) return;
    const top = G.pile[G.pile.length - 1];
    const c = P.slots[i];
    if (c.r === top.r) {
      removeSlotToPile(room, pid, i);
      say(room, "Player " + (pid + 1) + " discarded matching " + label(c) + ".");
      if (G.chainPid !== null && G.chainPid !== pid) {
        say(room, "Chain stopped (different player discarded).");
        G.pick = [];
        G.chainPid = null;
        G.chainRank = null;
      }
    } else {
      say(room, "Player " + (pid + 1) + " failed to discard " + label(c) + " (needed " + top.r + ").");
      reshuffleIfNeeded(room);
      const pen = G.deck.pop();
      const empty = P.slots.findIndex((s: any) => s === null);
      if (empty >= 0) P.slots[empty] = pen;
      else P.slots.push(pen);
      say(room, "Penalty card added to Player " + (pid + 1) + ".");
    }
    return;
  }

  if (act === "chainPick" && typeof msg.slot === "number") {
    const P = G.players[pid];
    const i = msg.slot;
    if (i < 0 || i >= P.slots.length || !P.slots[i]) return;
    if (!G.pile.length) return;
    const top = G.pile[G.pile.length - 1];
    const c = P.slots[i];
    if (c.r !== top.r) {
      say(room, "Player " + (pid + 1) + " failed chain pick (needed " + top.r + ").");
      G.pick = [];
      G.chainPid = null;
      G.chainRank = null;
      return;
    }
    if (G.chainPid === null) {
      G.chainPid = pid;
      G.chainRank = c.r;
    } else if (G.chainPid !== pid || G.chainRank !== c.r) {
      say(room, "Chain reset (must be same player and same rank).");
      G.pick = [];
      G.chainPid = null;
      G.chainRank = null;
      return;
    }
    if (!G.pick.includes(i)) G.pick.push(i);
    say(room, "Player " + (pid + 1) + " picked slot " + (i + 1) + " for a chain (" + G.pick.length + ").");
    return;
  }

  if (act === "chainPass") {
    if (!G.pick || !G.pick.length) return;
    if (G.chainPid === null) return;
    const pid2 = G.chainPid;
    const P = G.players[pid2];
    const idxs = [...G.pick].sort((a: number, b: number) => a - b);
    const cards = idxs.map((i: number) => P.slots[i]);
    for (const i of idxs) P.slots[i] = null;
    for (const c of cards) G.pile.push(c);
    say(room, "Player " + (pid2 + 1) + " passed a chain of " + cards.length + " × " + cards[0].r + ".");
    G.pick = [];
    G.chainPid = null;
    G.chainRank = null;
    return;
  }
}

export function publicState(room: Room, viewerId: number): any {
  const G = room.G;
  const you = viewerId;
  if (!G) {
    return {
      code: room.code,
      waiting: true,
      n: room.n,
      you,
      players: room.seats.map((s) => ({ name: s ? s.name : "…", ready: !!s })),
    };
  }
  const phase = G.phase;
  const revealAll = phase === "reveal";
  const memorize = phase === "memorize";
  const keepBoth = G.keepBoth;
  const peek = G.peekReveal;

  const players = G.players.map((p: any, i: number) => {
    const mine = i === you;
    const slots = p.slots.map((c: any, j: number) => {
      if (!c) return null;
      if (revealAll) return c;
      if (mine && memorize && j >= p.slots.length - 2) return c;
      if (mine && keepBoth && phase === "keepBoth" && keepBoth.kSelf === j) return c;
      if (mine && peek && phase === "peekReveal" && peek.pid === i && peek.i === j) return c;
      return { hidden: true };
    });
    return {
      name: room.seats[i] ? room.seats[i]!.name : "Player " + (i + 1),
      count: p.slots.filter(Boolean).length,
      total: revealAll ? p.total : null,
      slots,
      memorizeReady: !!(G.memorizeReady && G.memorizeReady[i]),
    };
  });

  const drawnVisible = G.drawn && G.turn === you && (phase === "act" || phase === "power10" || phase === "powerJ" || phase === "powerQ" || phase === "powerK1" || phase === "keepBoth" || phase === "kTrade" || phase === "peekReveal");
  const phaseEndsAt =
    phase === "keepBoth" ? G.keepBothEndsAt : phase === "peekReveal" ? G.peekEndsAt : null;

  return {
    code: room.code,
    you,
    n: room.n,
    phase,
    players,
    pileTop: G.pile.length ? G.pile[G.pile.length - 1] : null,
    deckCount: G.deck.length,
    turn: G.turn,
    declarer: G.declarer,
    drawn: drawnVisible ? G.drawn : null,
    free: G.free,
    keepBoth: keepBoth
      ? {
          kSelf: keepBoth.kSelf,
          kOpp: keepBoth.kOpp,
          kOppSeat: keepBoth.kOppSeat,
          showSelf: phase === "keepBoth",
          showOpp: false,
        }
      : null,
    peekReveal: peek ? { pid: peek.pid, i: peek.i } : null,
    log: G.log.slice(-12),
    memorizeEndsAt: memorize ? G.memorizeEndsAt : null,
    memorizeReady: G.memorizeReady || null,
    phaseEndsAt,
    chainPid: G.chainPid,
    chainRank: G.chainRank,
    pick: G.pick,
  };
}
