const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const portFlag = process.argv.indexOf("--port");
const PORT = process.env.PORT || (portFlag >= 0 ? process.argv[portFlag + 1] : null) || 8765;
const MEMORIZE_MS = 30000;
const KEEP_BOTH_MS = 1200;
const PEEK_MS = 1300;
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUITS = ["H","D","C","S"];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const rooms = new Map();

function code() {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return s;
}
function uniqueCode() {
  let c;
  do { c = code(); } while (rooms.has(c));
  return c;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function val(card) {
  if (!card) return 0;
  if (card.r === "A") return 1;
  if (card.r === "K" && (card.s === "H" || card.s === "D")) return -1;
  if (card.r === "J") return 11;
  if (card.r === "Q") return 12;
  if (card.r === "K") return 13;
  return Number(card.r);
}
function label(card) {
  const g = { H: "♥", D: "♦", C: "♣", S: "♠" };
  return card.r + g[card.s];
}

function isPowerRank(r) { return r === "10" || r === "J" || r === "Q" || r === "K"; }
function powerHint(r) {
  if (r === "10") return "10: peek one of your cards.";
  if (r === "J") return "J: peek one opponent card.";
  if (r === "Q") return "Q: blind-trade one of your cards with an opponent card.";
  if (r === "K") return "K: peek one of your cards, then one opponent card, then Trade or Skip.";
  return "";
}

// One discard/dump per turn overall. After swap/pick, or after a 10 peek of the
// same rank: allowOne offers a single matching discard/dump, then ends (no multi-chain).
// keepCenter: skipping must leave a used power card non-pickable.
function beginChain(room, pid, rank, allowOne, opts) {
  const G = room.G;
  const keepCenter = !!(opts && opts.keepCenter);
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
  addDumpPicks(G, pid);
  if (keepCenter) {
    G.free = false;
    G.chainSkipFree = false;
  }
  G.log = (opts && opts.log) || ("You put " + rank + " on center — discard one matching " + rank + " from hand (or dump an opponent " + rank + "), or Done. One only — not a chain.");
  return broadcast(room);
}

function handLocked(G, pid) {
  return G.declarer !== null && pid === G.declarer;
}
function hasUnlockedOppCards(G, me) {
  for (let p = 0; p < G.n; p++) {
    if (p === me || handLocked(G, p)) continue;
    if (G.players[p].slots.some((c) => !!c)) return true;
  }
  return false;
}
function fillPowerPicks(G) {
  G.pick = [];
  const me = G.turn;
  if (G.powerStep === "peek-own" || G.powerStep === "q-mine" || G.powerStep === "k-peek-own") {
    G.players[me].slots.forEach((c, i) => { if (c) G.pick.push(me + ":" + i); });
  }
  if (G.powerStep === "peek-opp" || G.powerStep === "q-theirs" || G.powerStep === "k-peek-opp") {
    for (let p = 0; p < G.n; p++) {
      if (p === me || handLocked(G, p)) continue;
      G.players[p].slots.forEach((c, i) => { if (c) G.pick.push(p + ":" + i); });
    }
  }
  // k-trade: no card picks — Trade / Skip buttons only
}

function pileTop(G) { return G.pile.length ? G.pile[G.pile.length - 1] : null; }

function matchRankForDump(G) {
  const top = pileTop(G);
  if (G.phase === "chain" && G.chainRank) return G.chainRank;
  if (G.phase === "dumpGive" && G.dumpGive) return G.dumpGive.rank;
  if (G.phase === "act" && top) return top.r;
  if (G.phase === "draw" && G.free && top) return top.r;
  if (G.phase === "pick" && G.intent === "discard" && top) return top.r;
  return null;
}
function addDumpPicks(G, actor) {
  const rank = matchRankForDump(G);
  if (!rank || actor == null) return;
  // Opponent cards are dump targets (except locked declarer): match = success, wrong = keep-both
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
function refreshActDumpPicks(G) {
  if (!G) return;
  if (G.phase === "act" || (G.phase === "draw" && G.free && G.declarer === null)) {
    G.pick = [];
    addDumpPicks(G, G.turn);
  }
}
function placeCardInHandPrefer(G, pid, card, preferI) {
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
function startDumpGive(room, actor, oppPid, emptiedI, rank) {
  const G = room.G;
  G.dumpGive = { actor, oppPid, emptiedI, rank };
  G.phase = "dumpGive";
  G.intent = null;
  G.pick = [];
  G.players[actor].slots.forEach((c, i) => { if (c) G.pick.push(actor + ":" + i); });
  // keep G.free (dump already set true) so next player can Pick after turn
  G.log = "Give them a card — tap one of yours to hand over to " + G.players[oppPid].name + ".";
  return broadcast(room);
}
function completeDumpGive(room, giveI) {
  const G = room.G;
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
function tryDumpOpponent(room, actor, oppPid, i) {
  const G = room.G;
  if (oppPid === actor || handLocked(G, oppPid)) return false;
  const rank = matchRankForDump(G);
  if (!rank) return false;
  const key = oppPid + ":" + i;
  if (G.pick.indexOf(key) < 0) return false;
  const card = G.players[oppPid].slots[i];
  if (!card) return false;
  if (card.r !== rank) {
    wrongOppDumpKeepBoth(room, actor, oppPid, i);
    return true;
  }
  if (!G.players[actor].slots.some((c) => !!c)) {
    G.log = "Need a card to give them after dumping.";
    broadcast(room);
    return true;
  }
  G.players[oppPid].slots[i] = null;
  G.pile.push(card);
  G.free = true; // dumped center card Pickable by next after this turn
  G.log = "Dumped " + label(card) + " from " + G.players[oppPid].name + " onto the center.";
  return startDumpGive(room, actor, oppPid, i, rank);
}

function wrongOppDumpKeepBoth(room, actor, oppPid, slotI) {
  const G = room.G;
  const card = G.players[oppPid].slots[slotI];
  const drawn = pileTop(G);
  if (!card || !drawn) return;
  G.free = false;
  G.intent = null;
  G.pick = [];
  G.chainPid = null;
  G.chainRank = null;
  G.dumpGive = null;
  // Opponent loses the mis-clicked card; actor keeps it AND the center/drawn card
  G.players[oppPid].slots[slotI] = null;
  const taken = { r: card.r, s: card.s, known: Array(G.n).fill(false) };
  const kept = { r: drawn.r, s: drawn.s, known: Array(G.n).fill(false) };
  taken.known[actor] = true;
  kept.known[actor] = true;
  const handI = placeDrawnInHand(G, actor, taken);
  const placedI = placeDrawnInHand(G, actor, kept);
  G.pile.pop();
  G.phase = "keepBoth";
  G.keepBoth = { pid: actor, handI, placedI, priorHandKnown: false };
  G.log = "Wrong opponent dump. You take " + label(card) + " and keep " + label(drawn) + " — remember where they are.";
  broadcast(room);
  clearKeepBothTimer(room);
  room.keepBothTimer = setTimeout(() => endKeepBothReveal(room), KEEP_BOTH_MS);
}

function score(p) {
  let s = 0;
  for (const c of p.slots) if (c) s += val(c);
  return s;
}

function makeDeal(n, cardsN) {
  const deck = [];
  const packs = Math.max(1, Math.ceil((n * cardsN + 10) / 52));
  for (let p = 0; p < packs; p++) for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  shuffle(deck);
  const cols = cardsN === 6 ? 3 : 2;
  const players = [];
  for (let id = 0; id < n; id++) {
    const slots = [];
    for (let k = 0; k < cardsN; k++) {
      const c = deck.pop();
      const known = Array(n).fill(false);
      slots.push({ r: c.r, s: c.s, known });
    }
    // Bottom two stay unknown; memorize phase reveals them temporarily
    players.push({ id, slots, declared: false, name: "P" + (id + 1) });
  }
  return {
    n, cols, cardsN, deck, pile: [], players,
    turn: 0, phase: "memorize", declarer: null, queue: [],
    intent: null, pick: [], free: false, dumpGive: null, power: null, powerStep: null, powerTarget: null, powerMine: null,
    chainPid: null, chainRank: null, chainSkipFree: null,
    memorizeReady: Array(n).fill(false),
    memorizeEndsAt: Date.now() + MEMORIZE_MS,
    log: "Memorize your bottom two cards. Click Ready when done (or wait for the timer)."
  };
}

function publicState(room, viewerId) {
  const G = room.G;
  if (!G) {
    return {
      status: room.status,
      code: room.code,
      n: room.n,
      cardsN: room.cardsN,
      players: room.seats.map((s, i) => ({ id: i, name: s ? s.name : null, ready: !!s })),
      you: viewerId,
      waiting: true
    };
  }
  const top = pileTop(G);
  return {
    status: room.status,
    code: room.code,
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
    memorizeEndsAt: G.phase === "memorize" ? G.memorizeEndsAt : null,
    memorizeReady: G.phase === "memorize" ? G.memorizeReady.slice() : null,
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
        const known = G.phase === "reveal" || c.known[viewerId] || memorizeReveal;
        return known ? { r: c.r, s: c.s, known: true } : { known: false };
      })
    }))
  };
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room) {
  for (let i = 0; i < room.seats.length; i++) {
    const seat = room.seats[i];
    if (!seat) continue;
    send(seat.ws, { type: "state", state: publicState(room, i) });
  }
}

function finish(room) {
  const G = room.G;
  G.pick = [];
  G.intent = null;
  G.dumpGive = null;
  G.chainPid = null;
  G.chainRank = null;
  G.chainSkipFree = null;
  if (G.declarer !== null) G.queue = G.queue.filter((id) => id !== G.turn);
  nextTurn(room);
}

function nextTurn(room) {
  const G = room.G;
  if (G.declarer !== null && !G.queue.length) return reveal(room);
  G.turn = G.declarer !== null ? G.queue[0] : (G.turn + 1) % G.n;
  G.phase = "draw";
  refreshActDumpPicks(G);
  broadcast(room);
}

function reveal(room) {
  const G = room.G;
  G.phase = "reveal";
  const scores = G.players.map(score);
  const low = Math.min(...scores);
  let text = scores.map((s, i) => G.players[i].name + " " + s).join(", ") + ". ";
  const winners = G.players.filter((_, i) => scores[i] === low).map((p) => p.name);
  text += winners.length > 1 ? "Tie." : winners[0] + " wins.";
  G.log = text;
  room.status = "ended";
  broadcast(room);
}

function endMemorize(room) {
  const G = room.G;
  if (!G || G.phase !== "memorize") return;
  if (room.memorizeTimer) {
    clearTimeout(room.memorizeTimer);
    room.memorizeTimer = null;
  }
  G.phase = "draw";
  G.memorizeReady = null;
  G.memorizeEndsAt = null;
  G.log = "Cards are face-down — remember them. Draw, Pick a passed/discarded center card, or Discard a match.";
  broadcast(room);
}

function startGame(room) {
  if (room.memorizeTimer) {
    clearTimeout(room.memorizeTimer);
    room.memorizeTimer = null;
  }
  clearKeepBothTimer(room);
  clearPeekTimer(room);
  room.G = makeDeal(room.n, room.cardsN);
  for (let i = 0; i < room.n; i++) {
    if (room.seats[i]) room.G.players[i].name = room.seats[i].name;
  }
  room.status = "playing";
  room.memorizeTimer = setTimeout(() => endMemorize(room), MEMORIZE_MS);
  broadcast(room);
}

function placeDrawnInHand(G, pid, card) {
  const slots = G.players[pid].slots;
  const empty = slots.findIndex((c) => !c);
  if (empty >= 0) {
    slots[empty] = card;
    return empty;
  }
  slots.push(card);
  return slots.length - 1;
}

function clearKeepBothTimer(room) {
  if (room.keepBothTimer) {
    clearTimeout(room.keepBothTimer);
    room.keepBothTimer = null;
  }
}

function clearPeekTimer(room) {
  if (room.peekTimer) {
    clearTimeout(room.peekTimer);
    room.peekTimer = null;
  }
}

function startPeekReveal(room, peeker, targetPid, i, next, prefix) {
  const G = room.G;
  const card = G.players[targetPid].slots[i];
  if (!card) return;
  const priorKnown = !!card.known[peeker];
  card.known[peeker] = true;
  G.phase = "peekReveal";
  G.peekReveal = { peeker, targetPid, i, next, priorKnown };
  G.pick = [];
  G.log = (prefix || "Peeked ") + label(card) + ". Memorize it — it flips face-down again.";
  broadcast(room);
  clearPeekTimer(room);
  room.peekTimer = setTimeout(() => endPeekReveal(room), PEEK_MS);
}

function endPeekReveal(room) {
  const G = room.G;
  if (!G || G.phase !== "peekReveal" || !G.peekReveal) return;
  clearPeekTimer(room);
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
      G.free = true; G.power = null; G.powerStep = null; G.powerTarget = null; G.powerMine = null; G.pick = [];
      return finish(room);
    }
    G.log = "Memorize your card. Now tap one opponent card to peek.";
    return broadcast(room);
  }
  if (pr.next === "k-trade") {
    G.phase = "power";
    G.powerStep = "k-trade";
    G.powerTarget = { pid: pr.targetPid, i: pr.i };
    G.pick = [];
    G.log = "Memorize both peeks. Trade (swap those two cards) or Skip trade.";
    return broadcast(room);
  }
  G.free = false;
  if (pr.next === "ten-match") {
    G.power = null; G.powerStep = null; G.powerTarget = null; G.powerMine = null; G.pick = [];
    const top = pileTop(G);
    // Drawn 10 stays on center. A peeked card of the same rank can be discarded once.
    if (card && top && card.r === top.r) {
      const rank = card.r;
      return beginChain(room, pr.peeker, rank, true, {
        keepCenter: true,
        log: "Peeked a matching " + rank + " — discard that " + rank + " from your hand (or dump an opponent " + rank + "), or Done. One only."
      });
    }
    return finish(room);
  }
  G.power = null;
  G.powerStep = null;
  G.powerTarget = null;
  G.powerMine = null;
  G.pick = [];
  finish(room);
}

function endKeepBothReveal(room) {
  const G = room.G;
  if (!G || G.phase !== "keepBoth" || !G.keepBoth) return;
  clearKeepBothTimer(room);
  const kb = G.keepBoth;
  const hand = G.players[kb.pid].slots[kb.handI];
  const kept = G.players[kb.pid].slots[kb.placedI];
  if (hand) hand.known[kb.pid] = !!kb.priorHandKnown;
  if (kept) kept.known[kb.pid] = false;
  G.keepBoth = null;
  finish(room);
}

function wrongDiscardKeepBoth(room, pid, slotI) {
  const G = room.G;
  const card = G.players[pid].slots[slotI];
  const drawn = pileTop(G);
  if (!card || !drawn) return;
  G.free = false;
  G.intent = null;
  G.pick = [];
  G.chainPid = null;
  G.chainRank = null;
  G.dumpGive = null;
  const priorHandKnown = !!card.known[pid];
  const extra = { r: drawn.r, s: drawn.s, known: Array(G.n).fill(false) };
  card.known[pid] = true;
  extra.known[pid] = true;
  const placedI = placeDrawnInHand(G, pid, extra);
  G.pile.pop();
  G.phase = "keepBoth";
  G.keepBoth = { pid, handI: slotI, placedI, priorHandKnown };
  G.log = "Not a match. You keep " + label(drawn) + " and " + label(card) + " — remember where they are.";
  broadcast(room);
  clearKeepBothTimer(room);
  room.keepBothTimer = setTimeout(() => endKeepBothReveal(room), KEEP_BOTH_MS);
}

function swapIntoHand(G, pid, i) {
  const card = G.players[pid].slots[i];
  const drawn = pileTop(G);
  // Swapped-in center cards stay face-down in hand (unknown to everyone including owner)
  const taken = { r: drawn.r, s: drawn.s, known: Array(G.n).fill(false) };
  G.players[pid].slots[i] = taken;
  G.pile[G.pile.length - 1] = card;
  G.free = false;
  return taken;
}

function handleAction(room, pid, msg) {
  const G = room.G;
  if (!G || room.status !== "playing") return;
  if (G.phase === "reveal") return;
  if (G.phase === "keepBoth" || G.phase === "peekReveal") return;

  const act = msg.action;
  if (G.phase === "dumpGive" && act !== "card") return;

  if (G.phase === "memorize") {
    if (act === "ready") {
      if (!G.memorizeReady || G.memorizeReady[pid]) return;
      G.memorizeReady[pid] = true;
      const waiting = G.memorizeReady.filter((r) => !r).length;
      G.log = G.players[pid].name + " is ready." + (waiting ? " Waiting for " + waiting + " more…" : "");
      if (G.memorizeReady.every(Boolean)) return endMemorize(room);
      return broadcast(room);
    }
    if (act === "redeal") {
      if (room.seats.filter(Boolean).length < room.n) return;
      return startGame(room);
    }
    return;
  }

  if (pid !== G.turn && !((G.phase === "pick" || G.phase === "power" || G.phase === "chain") && G.pick.some((x) => x.startsWith(pid + ":")))) return;

  if (act === "draw") {
    if (G.phase !== "draw" || pid !== G.turn) return;
    if (!G.deck.length) return reveal(room);
    G.free = false;
    const card = G.deck.pop();
    G.pile.push(card);
    G.phase = "act";
    G.pick = [];
    addDumpPicks(G, pid);
    G.log = "Drew " + label(card) + ". " + (isPowerRank(card.r) ? powerHint(card.r) + " " : "") + "Pass leaves it for others to Pick. Dump an opponent match (wrong card = you take theirs + keep center).";
    return broadcast(room);
  }

  if (act === "pass") {
    if (G.phase !== "act" || pid !== G.turn) return;
    G.free = true;
    G.log = "Passed. " + label(pileTop(G)) + " stays in the center — next player can Pick it or Discard a match.";
    return finish(room);
  }

  if (act === "arm") {
    const intent = msg.intent;
    if (intent === "discard" && G.phase === "draw" && G.free && pileTop(G) && pid === G.turn) {
      G.intent = "discard";
      G.phase = "pick";
      G.pick = [];
      G.players[pid].slots.forEach((c, i) => { if (c) G.pick.push(pid + ":" + i); });
      addDumpPicks(G, pid);
      G.log = "Tap a matching card (yours or an opponent " + pileTop(G).r + "). Wrong own/opponent card: you keep both / take theirs+center.";
      return broadcast(room);
    }
    if (G.phase !== "act" || pid !== G.turn) return;
    if (intent !== "swap" && intent !== "discard") return;
    G.intent = intent;
    G.phase = "pick";
    G.pick = [];
    G.players[pid].slots.forEach((c, i) => { if (c) G.pick.push(pid + ":" + i); });
    if (intent === "discard") addDumpPicks(G, pid);
    G.log = intent === "discard"
      ? "Tap a matching card (yours or an opponent " + pileTop(G).r + "). Wrong own/opponent card: you keep both / take theirs+center."
      : "Tap the card you are giving up.";
    return broadcast(room);
  }

  if (act === "claim") {
    if (!(G.phase === "draw" && G.free && pileTop(G) && pid === G.turn)) return;
    G.intent = "claim";
    G.phase = "pick";
    G.pick = [];
    G.players[pid].slots.forEach((c, i) => { if (c) G.pick.push(pid + ":" + i); });
    G.log = "Pick " + label(pileTop(G)) + ": tap the card in your hand you are giving up.";
    return broadcast(room);
  }

  if (act === "card") {
    const i = msg.i;
    const targetPid = msg.p != null ? msg.p : pid;
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
      G.log = "Discarded matching " + label(ch) + (afterPeek ? " after the peek." : " after swap.") + " Turn ends; next can Pick it.";
      G.pick = []; G.chainPid = null; G.chainRank = null;
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
          G.free = false; G.power = null; G.powerStep = null; G.powerTarget = null; G.powerMine = null; G.pick = [];
          return finish(room);
        }
        G.log = "Blind trade: tap an opponent card to swap with.";
        return broadcast(room);
      }
      if (G.powerStep === "q-theirs") {
        if (handLocked(G, targetPid)) return;
        const a = G.powerTarget;
        const mine = G.players[a.pid].slots[a.i];
        const theirs = G.players[targetPid].slots[i];
        G.players[a.pid].slots[a.i] = theirs;
        G.players[targetPid].slots[i] = mine;
        G.players[a.pid].slots[a.i].known = Array(G.n).fill(false);
        G.players[targetPid].slots[i].known = Array(G.n).fill(false);
        G.log = "Blind-traded with " + G.players[targetPid].name + ".";
        G.free = false; G.power = null; G.powerStep = null; G.powerTarget = null; G.powerMine = null; G.pick = [];
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
    const card = G.players[pid].slots[i];
    const drawn = pileTop(G);
    if (G.intent === "discard") {
      if (card.r === drawn.r) {
        G.players[pid].slots[i] = null;
        G.pile.push(card);
        G.free = true; // discarded top is Pickable by next player
        G.log = "Discarded " + label(card) + " on top of " + label(drawn) + ". One match action — turn ends; next can Pick it.";
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
      return broadcast(room);
    }
    G.power = top.r;
    G.phase = "power";
    G.powerStep = top.r === "10" ? "peek-own" : top.r === "J" ? "peek-opp" : top.r === "Q" ? "q-mine" : "k-peek-own";
    G.powerTarget = null;
    G.powerMine = null;
    fillPowerPicks(G);
    G.log = powerHint(top.r) + " Tap a highlighted card.";
    return broadcast(room);
  }

  if (act === "passChain") {
    if (G.phase !== "chain" || pid !== G.turn) return;
    const keepCenter = G.chainSkipFree === false;
    G.pick = []; G.chainPid = null; G.chainRank = null; G.chainSkipFree = null;
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
    G.power = null; G.powerStep = null; G.powerTarget = null; G.powerMine = null; G.pick = [];
    return finish(room);
  }

  if (act === "confirmTrade") {
    if (G.phase !== "power" || G.powerStep !== "k-trade" || pid !== G.turn) return;
    const mine = G.powerMine;
    const opp = G.powerTarget;
    if (!mine || !opp) return;
    const myCard = G.players[mine.pid].slots[mine.i];
    const oppCard = G.players[opp.pid].slots[opp.i];
    if (!myCard || !oppCard) {
      G.log = "Trade failed — a peeked card is gone. K stays pickable for next.";
      G.free = true; G.power = null; G.powerStep = null; G.powerTarget = null; G.powerMine = null; G.pick = [];
      return finish(room);
    }
    G.players[mine.pid].slots[mine.i] = oppCard;
    G.players[opp.pid].slots[opp.i] = myCard;
    // After trade, both slots face-down (peek knowledge does not stick as permanent known)
    G.players[mine.pid].slots[mine.i].known = Array(G.n).fill(false);
    G.players[opp.pid].slots[opp.i].known = Array(G.n).fill(false);
    // Vague log — do not reveal which cards moved; K remains pickable for next
    G.log = G.players[pid].name + " traded after King peeks. K stays pickable for next.";
    G.free = true; G.power = null; G.powerStep = null; G.powerTarget = null; G.powerMine = null; G.pick = [];
    return finish(room);
  }

  if (act === "declare") {
    if (G.phase !== "draw" || G.declarer !== null || pid !== G.turn) return;
    G.players[pid].declared = true;
    G.declarer = pid;
    G.queue = [];
    for (let i = 0; i < G.n; i++) if (i !== pid) G.queue.push(i);
    G.log = G.players[pid].name + " declared. Their hand is locked — no dumps, peeks, or trades against it. Final turns: draw/discard/pick on your own hand & center only.";
    return nextTurn(room);
  }

  if (act === "redeal") {
    if (room.seats.filter(Boolean).length < room.n) return;
    startGame(room);
  }
}

function createRoom(ws, msg) {
  let n = parseInt(msg.n, 10); if (!(n >= 2 && n <= 8)) n = 2;
  const cardsN = msg.cardsN === 6 ? 6 : 4;
  const name = String(msg.name || "P1").slice(0, 16);
  const c = uniqueCode();
  const seats = Array(n).fill(null);
  seats[0] = { ws, name, id: crypto.randomUUID() };
  const room = { code: c, n, cardsN, seats, status: "lobby", G: null };
  rooms.set(c, room);
  ws.roomCode = c;
  ws.seat = 0;
  send(ws, { type: "created", code: c, state: publicState(room, 0) });
}

function joinRoom(ws, msg) {
  const c = String(msg.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const room = rooms.get(c);
  if (!room) return send(ws, { type: "error", error: "No room with that code." });
  if (room.status !== "lobby") return send(ws, { type: "error", error: "That game already started." });
  const empty = room.seats.findIndex((s) => !s);
  if (empty < 0) return send(ws, { type: "error", error: "Room is full." });
  const name = String(msg.name || ("P" + (empty + 1))).slice(0, 16);
  room.seats[empty] = { ws, name, id: crypto.randomUUID() };
  ws.roomCode = c;
  ws.seat = empty;
  send(ws, { type: "joined", code: c, state: publicState(room, empty) });
  broadcast(room);
  if (room.seats.every(Boolean)) startGame(room);
}

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  const file = url === "/" || url === "/index.html" ? "index.html" : url.replace(/^\//, "");
  const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(__dirname, safe);
  if (!full.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(full);
    const type = ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : "text/plain";
    const headers = { "Content-Type": type };
    if (ext === ".html") {
      headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
      headers["Pragma"] = "no-cache";
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === "create") return createRoom(ws, msg);
    if (msg.type === "join") return joinRoom(ws, msg);
    if (msg.type === "action") {
      const room = rooms.get(ws.roomCode);
      if (!room || ws.seat == null) return;
      return handleAction(room, ws.seat, msg);
    }
    if (msg.type === "ping") return send(ws, { type: "pong" });
  });
  ws.on("close", () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const seat = room.seats[ws.seat];
    if (seat && seat.ws === ws) {
      room.seats[ws.seat] = null;
      if (room.status === "lobby") broadcast(room);
      else {
        room.status = "abandoned";
        if (room.memorizeTimer) { clearTimeout(room.memorizeTimer); room.memorizeTimer = null; }
        clearKeepBothTimer(room);
        clearPeekTimer(room);
        for (const s of room.seats) if (s) send(s.ws, { type: "error", error: "A player left. Start a new invite." });
      }
      if (room.seats.every((s) => !s)) {
        if (room.memorizeTimer) { clearTimeout(room.memorizeTimer); room.memorizeTimer = null; }
        rooms.delete(room.code);
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("DECLARE listening on " + PORT);
});
