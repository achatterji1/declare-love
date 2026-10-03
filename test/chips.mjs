import assert from "node:assert/strict";
import {
  ACT_MS,
  GIVE_MS,
  applyTimers,
  handleAction,
  makeDeal,
  moveClockMs,
  publicState,
  reveal,
  startGame,
} from "../src/lib/declare-engine.ts";
import {
  CLAIM_AMOUNT,
  CLAIM_INTERVAL_MS,
  STARTING_CHIPS,
  TIERS,
  applyClaim,
  computePayouts,
  createWallet,
  credit,
  fillEmptySeats,
  humanDisplayName,
  trySit,
} from "../src/lib/declare-chips.ts";

function card(r, s, n, seen) {
  return { r, s, known: Array(n).fill(false), seen: seen || Array(n).fill(false), id: r + s };
}

function room4() {
  const G = makeDeal(4, 4);
  G.phase = "act";
  G.turn = 0;
  G.free = false;
  G.intent = null;
  G.pick = [];
  G.pending = null;
  G.memorizeReady = null;
  G.memorizeEndsAt = null;
  G.pile = [{ r: "7", s: "H" }];
  G.players[0].slots = [card("A", "S", 4), card("3", "D", 4), card("9", "C", 4), card("K", "C", 4)];
  G.players[1].slots = [card("7", "C", 4), card("7", "D", 4), card("Q", "S", 4), card("4", "H", 4)];
  G.players[2].slots = [card("2", "C", 4), card("5", "D", 4), card("8", "S", 4), card("J", "H", 4)];
  G.players[3].slots = [card("6", "C", 4), card("9", "H", 4), card("10", "D", 4), card("K", "S", 4)];
  // Only player 2 has seen player 1's first 7. Nobody has seen the second 7 or the queen.
  G.players[1].slots[0].seen = [false, false, true, false];
  return {
    code: "FOUR",
    n: 4,
    cardsN: 4,
    status: "playing",
    version: 3,
    seats: [
      { name: "Ann", token: "a", playerId: "ann" },
      { name: "Bo", token: "b", playerId: "bo" },
      { name: "Cy", token: "c", playerId: "cy" },
      { name: "Dee", token: "d", playerId: "dee" },
    ],
    G,
    tier: "bronze",
    pot: 2000,
    buyIn: 500,
    actMs: 30000,
    stakes: [],
    payouts: null,
  };
}

function lobby(tier) {
  return {
    status: "lobby",
    seats: [null, null, null, null],
    pot: 0,
    buyIn: TIERS[tier].buyIn,
    stakes: [],
  };
}

function testWalletStartsAtTenThousand() {
  const wallet = createWallet("player-1");
  assert.equal(wallet.chips, STARTING_CHIPS);
  assert.equal(wallet.chips, 10000);
  assert.equal(wallet.claimAvailableAt, null);
}

function testClaimTimerStartsOnlyWhenClaimed() {
  const wallet = createWallet("player-1");
  const opened = 1_000_000;
  const first = applyClaim(wallet, opened);
  assert.equal(first.claimed, true);
  assert.equal(first.wallet.chips, 10000 + CLAIM_AMOUNT);
  assert.equal(first.wallet.claimAvailableAt, opened + CLAIM_INTERVAL_MS);

  // Time passing without a claim does not pay and does not move the window.
  const untouched = first.wallet;
  const tenHoursLater = opened + 10 * 60 * 60 * 1000;
  assert.equal(untouched.chips, 15000);
  assert.equal(untouched.claimAvailableAt, opened + CLAIM_INTERVAL_MS);

  const early = applyClaim(untouched, untouched.claimAvailableAt - 1);
  assert.equal(early.claimed, false);
  assert.equal(early.wallet.chips, 15000);
  assert.equal(early.wallet.claimAvailableAt, opened + CLAIM_INTERVAL_MS);

  const late = applyClaim(untouched, tenHoursLater);
  assert.equal(late.claimed, true);
  assert.equal(late.wallet.chips, 20000);
  assert.equal(late.wallet.claimAvailableAt, tenHoursLater + CLAIM_INTERVAL_MS);
}

function testBuyInAndWinnerTakesPot() {
  const table = lobby("bronze");
  const ann = createWallet("ann");
  const bo = createWallet("bo");
  const broke = createWallet("broke");
  broke.chips = 400;
  const refused = trySit(table, broke, "Broke", "nope");
  assert.equal(refused.ok, false);
  assert.equal(refused.wallet.chips, 400);
  assert.equal(table.pot, 0);
  assert.ok(table.seats.every((seat) => seat == null));

  const satAnn = trySit(table, ann, "Ann", "a");
  const satBo = trySit(table, bo, "Bo", "b");
  assert.equal(satAnn.ok, true);
  assert.equal(satBo.ok, true);
  assert.equal(satAnn.wallet.chips, 9500);
  assert.equal(satBo.wallet.chips, 9500);
  assert.equal(table.pot, 1000);

  const room = room4();
  room.pot = 1000;
  room.seats[0].playerId = "ann";
  room.seats[1].playerId = "bo";
  room.G.players[0].name = "Ann";
  room.G.players[0].slots = [card("A", "S", 4)];
  room.G.players[1].slots = [card("K", "C", 4)];
  room.G.players[2].slots = [card("K", "S", 4)];
  room.G.players[3].slots = [card("Q", "H", 4)];
  reveal(room);
  assert.equal(room.pot, 0);
  assert.equal(room.payouts.length, 1);
  assert.equal(room.payouts[0].playerId, "ann");
  assert.equal(room.payouts[0].amount, 1000);
  assert.match(room.G.log, /Pot 1000\. Ann wins\.$/);
  const paid = credit(satAnn.wallet, room.payouts[0].amount, room.payouts[0].key);
  assert.equal(paid.chips, 10500);
  assert.equal(credit(paid, room.payouts[0].amount, room.payouts[0].key).chips, 10500);

  const split = computePayouts({
    pot: 1000,
    scores: [5, 5, 9, 9],
    seats: [
      { playerId: "ann" },
      { playerId: "bo" },
      { playerId: "cy" },
      { playerId: "dee" },
    ],
    key: "split",
  });
  assert.equal(split.reduce((sum, row) => sum + row.amount, 0), 1000);
  assert.deepEqual(split.map((row) => row.playerId).sort(), ["ann", "bo"]);
}

function testComputerWinDoesNotPayAWallet() {
  const room = room4();
  room.pot = 500;
  room.seats[0] = { name: "Computer", token: "", computer: true };
  room.G.players[0].name = "Computer";
  room.G.players[0].slots = [card("A", "S", 4)];
  room.G.players[1].slots = [card("K", "C", 4)];
  room.G.players[2].slots = [card("K", "S", 4)];
  room.G.players[3].slots = [card("Q", "H", 4)];
  reveal(room);
  assert.equal(room.pot, 0);
  assert.equal(room.payouts, null);
  assert.match(room.G.log, /Computer wins\.$/);
}

function testComputerSeatsAreLabeledComputer() {
  assert.equal(humanDisplayName("Computer"), "Player");
  const room = {
    code: "COMP",
    n: 4,
    cardsN: 4,
    status: "lobby",
    version: 1,
    G: null,
    seats: [null, null, null, null],
    tier: "gold",
    pot: 2500,
    buyIn: 2500,
    actMs: TIERS.gold.actMs,
    stakes: [],
    payouts: null,
  };
  room.seats[0] = { name: "Ann", token: "t", playerId: "ann" };
  assert.equal(fillEmptySeats(room), 3);
  startGame(room);
  const view = publicState(room, 0);
  assert.equal(view.players[0].name, "Ann");
  assert.equal(view.players[0].computer, false);
  for (let i = 1; i < 4; i++) {
    assert.equal(view.players[i].name, "Computer");
    assert.equal(view.players[i].computer, true);
  }
}

function testTierClocks() {
  assert.equal(TIERS.bronze.actMs, 30000);
  assert.equal(TIERS.silver.actMs, 30000);
  assert.equal(TIERS.gold.actMs, 30000);
  assert.equal(TIERS.vip.actMs, 15000);
  assert.equal(TIERS.bronze.buyIn, 500);
  assert.equal(TIERS.silver.buyIn, 1000);
  assert.equal(TIERS.gold.buyIn, 2500);
  assert.equal(TIERS.vip.buyIn, 5000);
  assert.equal(moveClockMs({ actMs: TIERS.bronze.actMs }), ACT_MS);
  assert.equal(moveClockMs({ actMs: TIERS.silver.actMs }), ACT_MS);
  assert.equal(moveClockMs({ actMs: TIERS.gold.actMs }), ACT_MS);
  assert.equal(moveClockMs({ actMs: TIERS.vip.actMs }), 15000);
  assert.equal(moveClockMs({}), ACT_MS);
}

function clockRoom(actMs) {
  const room = room4();
  room.n = 2;
  room.G.n = 2;
  room.actMs = actMs;
  room.G.phase = "draw";
  room.G.free = false;
  room.G.pile = [];
  room.G.turnEndsAt = null;
  room.G.turnWaitKey = null;
  room.G.deck.push({ r: "9", s: "C" });
  return room;
}

function testMoveClockByTierKeepsCenterCard() {
  const vip = clockRoom(TIERS.vip.actMs);
  handleAction(vip, 0, { action: "draw" });
  assert.equal(vip.G.phase, "act");
  assert.equal(vip.G.pile[vip.G.pile.length - 1].r, "9");
  const vipLeft = vip.G.turnEndsAt - Date.now();
  assert.ok(vipLeft <= 15000 && vipLeft >= 14000, "VIP move clock is 15 seconds, left " + vipLeft);
  assert.equal(applyTimers(vip, vip.G.turnEndsAt - 1), false);
  assert.equal(vip.G.phase, "act");
  assert.equal(applyTimers(vip, vip.G.turnEndsAt), true);
  assert.equal(vip.G.phase, "keepBoth");
  assert.equal(vip.G.turn, 0);
  assert.ok(vip.G.players[0].slots.some((c) => c && c.r === "9" && c.s === "C"));
  assert.equal(vip.G.pile.some((c) => c.r === "9" && c.s === "C"), false);

  for (const tier of ["bronze", "silver", "gold"]) {
    const room = clockRoom(TIERS[tier].actMs);
    handleAction(room, 0, { action: "draw" });
    const left = room.G.turnEndsAt - Date.now();
    assert.ok(left <= 30000 && left >= 29000, tier + " move clock stays 30 seconds, left " + left);
    applyTimers(room, room.G.turnEndsAt);
    assert.equal(room.G.phase, "keepBoth");
    assert.ok(room.G.players[0].slots.some((c) => c && c.r === "9"));
  }
}

function hiddenRank(state, pid, slot) {
  const cardView = state.players[pid].slots[slot];
  return cardView && cardView.r;
}

function testOffTurnKnownMatchOnly() {
  const room = room4();
  const unseenBefore = JSON.stringify(publicState(room, 2).players[1].slots[1]);
  const queenBefore = JSON.stringify(publicState(room, 2).players[1].slots[2]);
  const logBefore = room.G.log;
  assert.equal(handleAction(room, 2, { action: "offDiscard", p: 1, i: 1 }), false);
  assert.equal(room.G.phase, "act");
  assert.equal(room.G.players[1].slots[1].r, "7");
  assert.equal(JSON.stringify(publicState(room, 2).players[1].slots[1]), unseenBefore);
  assert.equal(hiddenRank(publicState(room, 2), 1, 1), undefined);
  assert.equal(room.G.log, logBefore);

  const two = room4();
  two.n = 2;
  two.G.n = 2;
  assert.equal(handleAction(two, 1, { action: "offDiscard", p: 0, i: 0 }), false);

  const legal = room4();
  const sibling = JSON.stringify(publicState(legal, 2).players[1].slots[2]);
  assert.equal(handleAction(legal, 2, { action: "offDiscard", p: 1, i: 0 }), true);
  assert.equal(legal.G.phase, "dumpGive");
  assert.equal(legal.G.turn, 0);
  assert.equal(legal.G.dumpGive.offTurn, true);
  assert.equal(legal.G.dumpGive.actor, 2);
  assert.ok(legal.G.dumpGive.endsAt - Date.now() <= GIVE_MS);
  assert.ok(legal.G.dumpGive.endsAt - Date.now() >= GIVE_MS - 1000);
  assert.equal(legal.G.players[1].slots[0], null);
  assert.equal(legal.G.pile[legal.G.pile.length - 1].r, "7");
  assert.equal(legal.G.pile[legal.G.pile.length - 1].s, "C");
  assert.equal(hiddenRank(publicState(legal, 2), 1, 2), undefined);
  assert.equal(JSON.stringify(publicState(legal, 2).players[1].slots[2]), sibling);
  assert.equal(hiddenRank(publicState(legal, 0), 1, 1), undefined);
  assert.equal(hiddenRank(publicState(legal, 3), 1, 2), undefined);

  const beforeGive = legal.G.turn;
  assert.equal(handleAction(legal, 2, { action: "drag", gesture: "give", p: 2, i: 0 }), true);
  assert.equal(legal.G.phase, "act");
  assert.equal(legal.G.turn, beforeGive);
  assert.equal(legal.G.players[1].slots[0].r, "2");
  assert.ok(legal.G.players[1].slots[0].known.every((flag) => flag === false));
  assert.ok(legal.G.players[1].slots[0].seen.every((flag) => flag === false));
}

function testOffTurnGiveTimeoutPicksACard() {
  const room = room4();
  assert.equal(handleAction(room, 2, { action: "drag", gesture: "offDump", p: 1, i: 0 }), true);
  const ends = room.G.dumpGive.endsAt;
  const queenView = JSON.stringify(publicState(room, 2).players[1].slots[2]);
  assert.equal(applyTimers(room, ends - 1), false);
  assert.equal(room.G.phase, "dumpGive");
  assert.equal(room.G.players[2].slots[0].r, "2");
  assert.equal(applyTimers(room, ends), true);
  assert.equal(room.G.phase, "act");
  assert.equal(room.G.turn, 0);
  assert.equal(room.G.players[2].slots[0], null);
  assert.equal(room.G.players[1].slots[0].r, "2");
  assert.ok(room.G.players[1].slots[0].seen.every((flag) => flag === false));
  assert.equal(JSON.stringify(publicState(room, 2).players[1].slots[2]), queenView);
  assert.equal(hiddenRank(publicState(room, 2), 1, 2), undefined);
}

testWalletStartsAtTenThousand();
testClaimTimerStartsOnlyWhenClaimed();
testBuyInAndWinnerTakesPot();
testComputerWinDoesNotPayAWallet();
testComputerSeatsAreLabeledComputer();
testTierClocks();
testMoveClockByTierKeepsCenterCard();
testOffTurnKnownMatchOnly();
testOffTurnGiveTimeoutPicksACard();
console.log("chip rules ok");
