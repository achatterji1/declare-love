import assert from "node:assert/strict";
import { makeDeal, handleAction, publicState, endKeepBothReveal, applyTimers, ACT_MS } from "../src/lib/declare-engine.ts";

function roomWith(G) {
  return {
    code: "TEST",
    n: 2,
    cardsN: 4,
    status: "playing",
    version: 1,
    seats: [
      { name: "A", token: "a" },
      { name: "B", token: "b" },
    ],
    G,
    keepBothEndsAt: null,
    peekEndsAt: null,
  };
}
function card(r, s) {
  return { r, s, known: [false, false] };
}
function base() {
  const G = makeDeal(2, 4);
  G.phase = "act";
  G.turn = 0;
  G.free = false;
  G.intent = null;
  G.pick = [];
  G.pile = [{ r: "5", s: "H" }];
  G.players[0].slots = [card("7", "C"), card("9", "D"), card("3", "S"), card("K", "C")];
  G.players[1].slots = [card("4", "H"), card("8", "S"), card("J", "D"), card("2", "C")];
  G.players[0].declared = false;
  G.players[1].declared = false;
  G.declarer = null;
  G.pending = null;
  G.memorizeReady = null;
  G.memorizeEndsAt = null;
  return roomWith(G);
}
function flashed(state) {
  const kb = state.keepBoth;
  assert.ok(kb, "keepBoth payload");
  const slots = state.players[kb.pid].slots;
  return [slots[kb.handI], slots[kb.placedI]];
}

function testWrongDiscardPublic() {
  const room = base();
  handleAction(room, 0, { action: "drag", gesture: "discard", p: 0, i: 0 });
  const G = room.G;
  assert.equal(G.phase, "keepBoth");
  assert.equal(G.turn, 0);
  assert.ok(!G.pile.some((c) => c.r === "5" && c.s === "H"), "center 5 is not left on the pile");
  const mine = G.players[0].slots.filter(Boolean).map((c) => c.r).sort();
  assert.deepEqual(mine, ["3", "5", "7", "9", "K"]);
  for (const viewer of [0, 1]) {
    const state = publicState(room, viewer);
    const pair = flashed(state);
    const rs = pair.map((c) => c && c.r).sort();
    assert.deepEqual(rs, ["5", "7"], "viewer " + viewer + " sees both cards face up");
    assert.ok(pair.every((c) => c && c.known === true));
  }
  endKeepBothReveal(room);
  assert.equal(room.G.phase, "draw");
  assert.equal(room.G.turn, 1);
  for (const viewer of [0, 1]) {
    const state = publicState(room, viewer);
    assert.equal(state.keepBoth, null);
    const fives = state.players[0].slots.filter((c) => c && c.r === "5");
    const sevens = state.players[0].slots.filter((c) => c && c.r === "7");
    assert.equal(fives.length, 0, "5 is face down for viewer " + viewer);
    assert.equal(sevens.length, 0, "7 is face down for viewer " + viewer);
  }
}

function testWrongDumpPublic() {
  const room = base();
  room.G.pile = [{ r: "7", s: "D" }];
  room.G.players[1].slots[0] = card("K", "S");
  room.G.pick = [];
  handleAction(room, 0, { action: "drag", gesture: "dump", p: 1, i: 0 });
  const G = room.G;
  assert.equal(G.phase, "keepBoth");
  assert.equal(G.players[1].slots[0], null);
  assert.deepEqual(G.pile, [], "neither card stays in the center");
  const mine = G.players[0].slots.filter(Boolean).map((c) => c.r).sort();
  assert.ok(mine.includes("7") && mine.includes("K"));
  for (const viewer of [0, 1]) {
    const pair = flashed(publicState(room, viewer)).map((c) => c && c.r).sort();
    assert.deepEqual(pair, ["7", "K"], "viewer " + viewer + " sees the wrong dump");
  }
  const before = room.G.turn;
  endKeepBothReveal(room);
  assert.equal(room.G.turn, (before + 1) % 2);
  assert.notEqual(room.G.phase, "keepBoth");
}

function testLegalDiscardAndDump() {
  const room = base();
  room.G.players[0].slots[0] = card("5", "C");
  handleAction(room, 0, { action: "drag", gesture: "discard", p: 0, i: 0 });
  assert.notEqual(room.G.phase, "keepBoth");
  assert.equal(room.G.pile[room.G.pile.length - 1].r, "5");
  assert.equal(room.G.players[0].slots[0], null);
  assert.equal(room.G.turn, 1);

  const room2 = base();
  room2.G.pile = [{ r: "7", s: "D" }];
  room2.G.players[1].slots[1] = card("7", "H");
  handleAction(room2, 0, { action: "drag", gesture: "dump", p: 1, i: 1 });
  assert.equal(room2.G.phase, "dumpGive");
  assert.equal(room2.G.players[1].slots[1], null);
  assert.equal(room2.G.pile[room2.G.pile.length - 1].r, "7");
  assert.equal(room2.G.pile[room2.G.pile.length - 1].s, "H");
  handleAction(room2, 0, { action: "drag", gesture: "give", p: 0, i: 0 });
  assert.equal(room2.G.phase, "draw");
  assert.equal(room2.G.turn, 1);
  assert.equal(room2.G.players[1].slots[1].r, "7");
  assert.ok(room2.G.players[1].slots[1].known.every((k) => k === false));
}

function testSwapAndPick() {
  const room = base();
  room.G.pile = [{ r: "A", s: "D" }];
  room.G.players[0].slots[3] = card("Q", "S");
  room.G.players[0].slots[3].known[0] = true;
  handleAction(room, 0, { action: "drag", gesture: "swap", p: 0, i: 3 });
  assert.equal(room.G.pile[room.G.pile.length - 1].r, "Q");
  assert.equal(room.G.players[0].slots[3].r, "A");
  assert.ok(room.G.players[0].slots[3].known.every((k) => k === false), "swapped-in ace is face down");

  const room2 = base();
  room2.G.phase = "draw";
  room2.G.free = true;
  room2.G.pile = [{ r: "A", s: "H" }];
  const before = room2.G.players[0].slots[2].r;
  handleAction(room2, 0, { action: "drag", gesture: "claim", p: 0, i: 2 });
  assert.equal(room2.G.pile[room2.G.pile.length - 1].r, before);
  assert.equal(room2.G.players[0].slots[2].r, "A");
  assert.ok(room2.G.players[0].slots[2].known.every((k) => k === false));
}

function testIllegalDragNoChange() {
  const room = base();
  room.G.phase = "draw";
  room.G.free = false;
  const before = JSON.stringify(room.G.players[0].slots.map((c) => c && c.r));
  const pile = room.G.pile.length;
  handleAction(room, 0, { action: "drag", gesture: "discard", p: 0, i: 0 });
  handleAction(room, 0, { action: "drag", gesture: "swap", p: 0, i: 1 });
  assert.equal(JSON.stringify(room.G.players[0].slots.map((c) => c && c.r)), before);
  assert.equal(room.G.pile.length, pile);
  assert.equal(room.G.phase, "draw");
  assert.equal(room.G.turn, 0);
}

function testChainDumpDoesNotTakeCenter() {
  const room = base();
  room.G.pile = [{ r: "A", s: "D" }];
  room.G.players[0].slots[2] = card("Q", "C");
  room.G.players[0].slots[3] = card("Q", "S");
  room.G.players[1].slots[0] = card("K", "H");
  handleAction(room, 0, { action: "drag", gesture: "swap", p: 0, i: 3 });
  assert.equal(room.G.phase, "chain");
  assert.equal(room.G.pile[room.G.pile.length - 1].r, "Q");
  const center = room.G.pile[room.G.pile.length - 1];
  const oppBefore = room.G.players[1].slots[0];
  handleAction(room, 0, { action: "drag", gesture: "dump", p: 1, i: 0 });
  assert.equal(room.G.phase, "chain");
  assert.equal(room.G.pile[room.G.pile.length - 1], center, "center card stays");
  assert.equal(room.G.players[1].slots[0], oppBefore, "opponent card stays face down in place");
  assert.equal(room.G.players[0].slots.filter(Boolean).some((c) => c.r === "K"), false);

  const legal = base();
  legal.G.pile = [{ r: "A", s: "D" }];
  legal.G.players[0].slots[2] = card("Q", "C");
  legal.G.players[0].slots[3] = card("Q", "S");
  legal.G.players[1].slots[0] = card("Q", "H");
  handleAction(legal, 0, { action: "drag", gesture: "swap", p: 0, i: 3 });
  assert.equal(legal.G.phase, "chain");
  handleAction(legal, 0, { action: "drag", gesture: "dump", p: 1, i: 0 });
  assert.equal(legal.G.phase, "dumpGive");
  assert.equal(legal.G.pile[legal.G.pile.length - 1].r, "Q");
  assert.equal(legal.G.pile[legal.G.pile.length - 1].s, "H");
  assert.equal(legal.G.pile[legal.G.pile.length - 2].s, "S", "the card just swapped onto center stays under the dump");
  assert.equal(legal.G.players[1].slots[0], null);
}

function testRedealAfterReveal() {
  const room = base();
  room.G.phase = "reveal";
  room.status = "ended";
  const old = room.G;
  handleAction(room, 1, { action: "redeal" });
  assert.equal(room.status, "playing");
  assert.notEqual(room.G, old);
  assert.equal(room.G.phase, "memorize");
  assert.equal(room.G.pile.length, 0);
  assert.equal(room.G.players[0].name, "A");
  assert.equal(room.G.players[1].name, "B");
  const mid = base();
  mid.G.phase = "act";
  handleAction(mid, 0, { action: "redeal" });
  assert.equal(mid.G.phase, "act");
  assert.equal(mid.status, "playing");
}

function persisted(room) {
  const G = JSON.parse(JSON.stringify(room.G));
  const next = roomWith(G);
  next.status = room.status;
  return next;
}

function testOnlineKeepBothFinishesAfterReload() {
  const room = base();
  const started = Date.now();
  assert.equal(handleAction(room, 0, { action: "drag", gesture: "discard", p: 0, i: 0 }), true);
  assert.equal(room.G.phase, "keepBoth");
  assert.ok(room.G.keepBothEndsAt > started);
  assert.equal(publicState(room, 1).phaseEndsAt, room.G.keepBothEndsAt);
  const loaded = persisted(room);
  assert.equal(loaded.keepBothEndsAt, null, "database reload drops the in-memory room deadline");
  assert.equal(applyTimers(loaded, room.G.keepBothEndsAt - 1), false);
  assert.equal(loaded.G.phase, "keepBoth");
  assert.equal(applyTimers(loaded, room.G.keepBothEndsAt), true);
  assert.equal(loaded.G.phase, "draw");
  assert.equal(loaded.G.turn, 1);
  assert.equal(publicState(loaded, 0).keepBoth, null);

  const dump = base();
  dump.G.pile = [{ r: "7", s: "D" }];
  dump.G.players[1].slots[0] = card("K", "S");
  handleAction(dump, 0, { action: "drag", gesture: "dump", p: 1, i: 0 });
  const reloadedDump = persisted(dump);
  assert.equal(reloadedDump.G.phase, "keepBoth");
  assert.equal(applyTimers(reloadedDump, dump.G.keepBothEndsAt), true);
  assert.equal(reloadedDump.G.turn, 1);
  assert.notEqual(reloadedDump.G.phase, "keepBoth");
}

function testStuckRevealPhasesEnd() {
  const keep = base();
  keep.G.phase = "keepBoth";
  keep.G.keepBoth = { pid: 0, handI: 0, placedI: 1, priorHandKnown: true };
  delete keep.G.keepBothEndsAt;
  assert.equal(applyTimers(keep), true);
  assert.equal(keep.G.phase, "draw");
  assert.equal(keep.G.turn, 1);

  const peek = base();
  peek.G.phase = "peekReveal";
  peek.G.peekReveal = { peeker: 0, targetPid: 1, i: 0, next: "finish", priorKnown: false };
  delete peek.G.peekEndsAt;
  assert.equal(applyTimers(peek), true);
  assert.notEqual(peek.G.phase, "peekReveal");
  assert.equal(peek.G.turn, 1);
}

function testOnlinePeekFinishesAfterReload() {
  const room = base();
  room.G.pile = [{ r: "J", s: "H" }];
  handleAction(room, 0, { action: "power" });
  assert.equal(room.G.phase, "power");
  assert.equal(handleAction(room, 0, { action: "card", p: 1, i: 0 }), undefined);
  assert.equal(room.G.phase, "peekReveal");
  assert.ok(room.G.peekEndsAt);
  assert.equal(publicState(room, 0).phaseEndsAt, room.G.peekEndsAt);
  const loaded = persisted(room);
  assert.equal(loaded.peekEndsAt, null);
  assert.equal(applyTimers(loaded, room.G.peekEndsAt - 1), false);
  assert.equal(loaded.G.phase, "peekReveal");
  assert.equal(applyTimers(loaded, room.G.peekEndsAt + 1), true);
  assert.equal(loaded.G.phase, "draw");
  assert.equal(loaded.G.turn, 1);

  const ten = base();
  ten.G.pile = [{ r: "10", s: "C" }];
  handleAction(ten, 0, { action: "power" });
  handleAction(ten, 0, { action: "card", p: 0, i: 0 });
  assert.equal(ten.G.phase, "peekReveal");
  const loadedTen = persisted(ten);
  assert.equal(applyTimers(loadedTen, ten.G.peekEndsAt + 1), true);
  assert.notEqual(loadedTen.G.phase, "peekReveal");
}

function testChainTargetsAreMatchesOnly() {
  const room = base();
  room.G.pile = [{ r: "A", s: "D" }];
  room.G.players[0].slots[2] = card("Q", "C");
  room.G.players[0].slots[3] = card("Q", "S");
  room.G.players[1].slots[0] = card("K", "H");
  room.G.players[1].slots[1] = card("Q", "D");
  handleAction(room, 0, { action: "drag", gesture: "swap", p: 0, i: 3 });
  assert.equal(room.G.phase, "chain");
  const pick = room.G.pick.slice().sort();
  assert.ok(pick.includes("0:2"), "own remaining queen stays a discard target");
  assert.ok(pick.includes("1:1"), "matching opponent queen is a dump target");
  assert.equal(pick.includes("1:0"), false, "non-matching opponent card is not a drop target");
  assert.deepEqual(publicState(room, 0).pick, room.G.pick);
  assert.equal(handleAction(room, 0, { action: "drag", gesture: "dump", p: 1, i: 0 }), false);
  assert.equal(room.G.phase, "chain");
  assert.equal(room.G.players[1].slots[0].r, "K");
}

function testRejectedDragIsNotApplied() {
  const room = base();
  room.G.phase = "draw";
  room.G.free = false;
  assert.equal(handleAction(room, 0, { action: "drag", gesture: "swap", p: 0, i: 0 }), false);
  room.G.phase = "keepBoth";
  room.G.keepBoth = { pid: 0, handI: 0, placedI: 1, priorHandKnown: false };
  room.G.keepBothEndsAt = Date.now() + 4000;
  assert.notEqual(handleAction(room, 0, { action: "drag", gesture: "discard", p: 0, i: 0 }), true);
  assert.equal(room.G.phase, "keepBoth");
}

function testQuitDismissesTable() {
  const room = base();
  handleAction(room, 0, { action: "quit" });
  assert.equal(room.status, "abandoned");
  const view = publicState(room, 1);
  assert.equal(view.dismissed, true);
  assert.equal(view.status, "abandoned");
  assert.equal(view.phase, undefined);
}

testWrongDiscardPublic();
testWrongDumpPublic();
testLegalDiscardAndDump();
testSwapAndPick();
testIllegalDragNoChange();
testChainDumpDoesNotTakeCenter();
testRedealAfterReveal();
function testMoveClockKeepsCenterCard() {
  const passed = base();
  passed.G.phase = "act";
  passed.G.pending = null;
  passed.G.actEndsAt = null;
  passed.G.pile = [{ r: "5", s: "H" }];
  passed.G.turnEndsAt = Date.now() - 20;
  passed.G.turnWaitKey = "0|act|||";
  const deck = passed.G.deck.length;
  assert.equal(applyTimers(passed, Date.now()), true);
  assert.equal(passed.G.phase, "keepBoth");
  assert.equal(passed.G.turn, 0);
  assert.equal(passed.G.deck.length, deck);
  assert.equal(passed.G.pile.some((c) => c.r === "5"), false);
  assert.ok(passed.G.players[0].slots.some((c) => c && c.r === "5"));
  passed.G.keepBothEndsAt = Date.now() - 1;
  applyTimers(passed, Date.now());
  assert.equal(passed.G.turn, 1);
  assert.equal(passed.G.phase, "draw");
  assert.ok(passed.G.players[0].slots.some((c) => c && c.r === "5"), "the kept card stays in hand");
  assert.ok(passed.G.turnEndsAt > Date.now());

  const confirm = base();
  confirm.G.phase = "act";
  confirm.G.pending = "pass";
  confirm.G.actEndsAt = Date.now() - 20;
  confirm.G.turnEndsAt = null;
  confirm.G.pile = [{ r: "5", s: "H" }];
  applyTimers(confirm, Date.now());
  assert.equal(confirm.G.phase, "keepBoth");
  assert.equal(confirm.G.turn, 0);
  assert.ok(confirm.G.players[0].slots.some((c) => c && c.r === "5"), "confirm timeout keeps the center card");
  assert.equal(confirm.G.pile.some((c) => c.r === "5"), false);

  const memorizing = base();
  memorizing.G.phase = "memorize";
  memorizing.G.memorizeReady = [false, false];
  memorizing.G.memorizeEndsAt = Date.now() - 20;
  memorizing.G.turnEndsAt = null;
  applyTimers(memorizing, Date.now());
  assert.equal(memorizing.G.phase, "draw");
  assert.equal(memorizing.G.turn, 0);
  assert.ok(memorizing.G.turnEndsAt > Date.now());
  assert.ok(memorizing.G.turnEndsAt <= Date.now() + ACT_MS);

  const drawing = base();
  drawing.G.phase = "draw";
  drawing.G.pile = [];
  drawing.G.free = false;
  drawing.G.turnEndsAt = Date.now() - 5;
  const before = drawing.G.deck.length;
  applyTimers(drawing, Date.now());
  assert.equal(drawing.G.turn, 1);
  assert.equal(drawing.G.deck.length, before, "a timed-out turn with no center card does not draw");

  const withCenter = base();
  withCenter.G.phase = "draw";
  withCenter.G.free = true;
  withCenter.G.pile = [{ r: "5", s: "H" }];
  withCenter.G.turnEndsAt = Date.now() - 5;
  applyTimers(withCenter, Date.now());
  assert.equal(withCenter.G.phase, "keepBoth");
  assert.ok(withCenter.G.players[0].slots.some((c) => c && c.r === "5"));

  const fresh = base();
  fresh.G.phase = "draw";
  fresh.G.pile = [];
  fresh.G.deck.push({ r: "9", s: "C" });
  handleAction(fresh, 0, { action: "draw" });
  assert.equal(fresh.G.phase, "act");
  assert.equal(fresh.G.actEndsAt, null);
  const deadline = fresh.G.turnEndsAt;
  assert.ok(deadline > Date.now());
  handleAction(fresh, 0, { action: "pending", choice: "pass" });
  assert.equal(fresh.G.pending, "pass");
  assert.equal(fresh.G.actEndsAt, null);
  assert.equal(fresh.G.turnEndsAt, deadline, "Yes/No keeps the same move clock");
  assert.equal(publicState(fresh, 0).turnEndsAt, deadline);

  const chain = base();
  chain.G.phase = "chain";
  chain.G.chainPid = 0;
  chain.G.chainRank = "Q";
  chain.G.pile = [{ r: "Q", s: "S" }];
  chain.G.free = true;
  chain.G.turnEndsAt = Date.now() - 5;
  applyTimers(chain, Date.now());
  assert.equal(chain.G.phase, "keepBoth");
  assert.equal(chain.G.turn, 0);
  assert.ok(chain.G.players[0].slots.some((c) => c && c.r === "Q"));
  assert.equal(chain.G.pile.some((c) => c.r === "Q"), false);
}

function testCancelDoesNotStallAndDumpGiveDoesNotGive() {
  const room = base();
  room.G.phase = "act";
  room.G.pile = [{ r: "5", s: "H" }];
  const ends = Date.now() + 12000;
  room.G.turnEndsAt = ends;
  room.G.turnWaitKey = "0|act|||";
  handleAction(room, 0, { action: "pending", choice: "swap" });
  assert.equal(room.G.pending, "swap");
  assert.equal(room.G.turnEndsAt, ends);
  handleAction(room, 0, { action: "cancel" });
  assert.equal(room.G.pending, null);
  assert.equal(room.G.phase, "act");
  assert.equal(room.G.turn, 0);
  assert.equal(room.G.turnEndsAt, ends, "cancel does not start a new 30 seconds");
  assert.equal(room.G.pile[room.G.pile.length - 1].r, "5");
  assert.equal(room.G.players[0].slots.some((c) => c && c.r === "5"), false);

  const expired = base();
  expired.G.phase = "act";
  expired.G.pending = "pick";
  expired.G.pile = [{ r: "5", s: "H" }];
  expired.G.turnEndsAt = null;
  expired.G.actEndsAt = Date.now() - 40;
  handleAction(expired, 0, { action: "cancel" });
  assert.equal(expired.G.phase, "keepBoth");
  assert.equal(expired.G.turn, 0);
  assert.ok(expired.G.players[0].slots.some((c) => c && c.r === "5"), "an expired cancel keeps the card instead of stalling");
  assert.equal(expired.G.pile.some((c) => c.r === "5"), false);

  const give = base();
  give.G.phase = "dumpGive";
  give.G.dumpGive = { actor: 0, oppPid: 1, emptiedI: 0, rank: "7" };
  give.G.players[1].slots[0] = null;
  give.G.pile = [{ r: "7", s: "D" }];
  const actorBefore = give.G.players[0].slots.map((c) => (c ? c.r + c.s : null));
  give.G.turnEndsAt = Date.now() - 20;
  give.G.turnWaitKey = "0|dumpGive|||";
  applyTimers(give, Date.now());
  assert.equal(give.G.phase, "keepBoth");
  assert.equal(give.G.dumpGive, null);
  assert.equal(give.G.players[1].slots[0], null, "timeout does not fill the opponent slot");
  assert.deepEqual(
    give.G.players[0].slots.filter((c) => c && actorBefore.includes(c.r + c.s)).map((c) => c.r + c.s),
    actorBefore,
    "timeout does not hand away the leftmost card",
  );
  assert.ok(give.G.players[0].slots.some((c) => c && c.r === "7" && c.s === "D"));
  assert.equal(give.G.log.includes("Gave a card"), false);

  const giveEmpty = base();
  giveEmpty.G.phase = "dumpGive";
  giveEmpty.G.dumpGive = { actor: 0, oppPid: 1, emptiedI: 0, rank: "7" };
  giveEmpty.G.players[1].slots[0] = null;
  giveEmpty.G.pile = [];
  const untouched = giveEmpty.G.players[0].slots.map((c) => (c ? c.r + c.s : null));
  giveEmpty.G.turnEndsAt = Date.now() - 20;
  applyTimers(giveEmpty, Date.now());
  assert.equal(giveEmpty.G.turn, 1);
  assert.equal(giveEmpty.G.phase, "draw");
  assert.equal(giveEmpty.G.dumpGive, null);
  assert.deepEqual(
    giveEmpty.G.players[0].slots.map((c) => (c ? c.r + c.s : null)),
    untouched,
  );
  assert.equal(giveEmpty.G.players[1].slots[0], null);
  assert.equal(giveEmpty.G.log, "Time's up. Passed.");
}

testQuitDismissesTable();
testMoveClockKeepsCenterCard();
testCancelDoesNotStallAndDumpGiveDoesNotGive();
testOnlineKeepBothFinishesAfterReload();
testStuckRevealPhasesEnd();
testOnlinePeekFinishesAfterReload();
testChainTargetsAreMatchesOnly();
testRejectedDragIsNotApplied();
console.log("drag rules ok");
