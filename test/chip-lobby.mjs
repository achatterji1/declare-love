import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { leaveSeat } from "../src/lib/declare-engine.ts";
import { TIERS } from "../src/lib/declare-chips.ts";
import {
  getOrCreateWallet,
  insertRoom,
  listChipRooms,
  loadRoom,
  loadWallet,
  mutateRoom,
  saveWallet,
} from "../src/lib/declare-store.server.ts";
import { leaveLobbySeat, listTables, sitDown } from "../src/lib/declare-table.server.ts";

if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Refusing to run chip lobby tests against a live database.");
}

rmSync("/tmp/declare-chip-store.json", { force: true });

function id() {
  return crypto.randomUUID();
}

async function testOpeningATableDoesNotTakeChips() {
  const player = id();
  const sat = await sitDown({ playerId: player, name: "Ann", tier: "bronze" });
  assert.equal(TIERS.bronze.buyIn, 500);
  assert.equal(sat.state.waiting, true);
  assert.equal(sat.state.pot, 0);
  assert.equal(sat.wallet.chips, 10000);
  const room = await loadRoom(sat.code);
  assert.equal(room.status, "lobby");
  assert.equal(room.pot, 0);
  assert.equal(room.stakes.length, 0);
  assert.equal(room.seats[sat.seat].playerId, player);
  assert.equal((await loadWallet(player)).chips, 10000);
  return { player, sat };
}

async function testLeaveBeforeTheHandRefundsAndClearsTheTable(open) {
  await mutateRoom(open.sat.code, (room) => leaveSeat(room, open.sat.seat));
  assert.equal((await loadWallet(open.player)).chips, 10000);
  const gone = await loadRoom(open.sat.code);
  assert.equal(gone.status, "abandoned");
  assert.equal(gone.pot, 0);
  assert.equal(gone.stakes.length, 0);
  assert.ok(gone.seats.every((seat) => seat == null));
  const listed = (await listChipRooms()).filter((room) => room.code === open.sat.code);
  assert.equal(listed.length, 0);
}

async function testLegacyBuyInIsRefundedOnLobbyLeave() {
  const player = id();
  const created = await getOrCreateWallet(player);
  created.chips = 7500;
  await saveWallet(created);
  await insertRoom({
    code: "1111",
    n: 4,
    cardsN: 4,
    seats: [{ name: "Ann", token: "tok", playerId: player }, null, null, null],
    status: "lobby",
    G: null,
    version: 0,
    tier: "gold",
    pot: 2500,
    buyIn: 2500,
    actMs: 30000,
    stakes: [{ playerId: player, seat: 0, amount: 2500 }],
    payouts: null,
  });
  await mutateRoom("1111", (room) => leaveSeat(room, 0));
  assert.equal((await loadWallet(player)).chips, 10000);
  const gone = await loadRoom("1111");
  assert.equal(gone.status, "abandoned");
  assert.equal(gone.pot, 0);
  assert.equal(gone.stakes.length, 0);
  assert.ok(gone.seats.every((seat) => seat == null));
}

async function testStartedHandStillForfeitsOnQuit() {
  const players = [id(), id(), id(), id()];
  let code = "";
  for (let i = 0; i < 3; i++) {
    const sat = await sitDown({ playerId: players[i], name: "P" + i, tier: "bronze" });
    code = sat.code;
    assert.equal(sat.state.waiting, true);
    assert.equal(sat.wallet.chips, 10000);
    assert.equal((await loadRoom(code)).pot, 0);
  }
  const last = await sitDown({ playerId: players[3], name: "P3", tier: "bronze" });
  assert.equal(last.code, code);
  assert.equal(last.state.waiting, false);
  assert.equal(last.state.pot, 2000);
  assert.equal(last.wallet.chips, 9500);
  for (const player of players) assert.equal((await loadWallet(player)).chips, 9500);
  const playing = await loadRoom(code);
  assert.equal(playing.status, "playing");
  assert.equal(playing.stakes.length, 4);
  await mutateRoom(code, (room) => leaveSeat(room, 1));
  const after = await loadRoom(code);
  assert.equal(after.status, "playing");
  assert.equal(after.pot, 2000);
  assert.equal(after.seats[1], null);
  assert.equal(after.stakes.find((stake) => stake.playerId === players[1]).forfeited, true);
  assert.equal((await loadWallet(players[1])).chips, 9500);
  assert.equal(after.seats.filter(Boolean).length, 3);
}

async function testSecondTableDoesNotKeepTheFirstSeat() {
  const player = id();
  const first = await sitDown({ playerId: player, name: "Ann", tier: "bronze" });
  const second = await sitDown({ playerId: player, name: "Ann", tier: "silver" });
  assert.notEqual(second.code, first.code);
  assert.equal(second.state.waiting, true);
  assert.equal(second.wallet.chips, 10000);
  const old = await loadRoom(first.code);
  assert.equal(old.status, "abandoned");
  assert.equal(old.pot, 0);
  assert.equal(old.stakes.length, 0);
  assert.ok(old.seats.every((seat) => seat == null));
  assert.equal((await loadRoom(second.code)).seats[second.seat].playerId, player);
}

async function testBrokePlayerIsNotSeated() {
  const player = id();
  const opened = await getOrCreateWallet(player);
  opened.chips = 400;
  await saveWallet(opened);
  await assert.rejects(sitDown({ playerId: player, name: "Broke", tier: "bronze" }), /afford/);
  assert.equal((await loadWallet(player)).chips, 400);
  const held = (await listChipRooms()).filter((room) => room.seats.some((seat) => seat && seat.playerId === player));
  assert.equal(held.length, 0);
}

async function testLobbyListLeaveKeepsAnUnchargedWallet() {
  const player = id();
  const other = id();
  const sat = await sitDown({ playerId: player, name: "Ann", tier: "bronze" });
  const listed = await listTables(player);
  const row = listed.tables.find((table) => table.code === sat.code);
  assert.ok(row);
  assert.equal(row.yours, true);
  assert.equal(listed.wallet.chips, 10000);
  const stranger = await listTables(other);
  assert.equal(stranger.tables.find((table) => table.code === sat.code).yours, false);
  const left = await leaveLobbySeat({ playerId: player, code: sat.code });
  assert.equal(left.wallet.chips, 10000);
  assert.equal((await loadWallet(player)).chips, 10000);
  const gone = await loadRoom(sat.code);
  assert.equal(gone.status, "abandoned");
  assert.equal(gone.pot, 0);
  assert.equal(gone.stakes.length, 0);
  assert.equal((await listTables(player)).tables.some((table) => table.code === sat.code), false);
}

async function testLobbyListLeaveRefundsARecordedStake() {
  const player = id();
  const created = await getOrCreateWallet(player);
  created.chips = 14500;
  await saveWallet(created);
  await insertRoom({
    code: "PH8Q",
    n: 4,
    cardsN: 4,
    seats: [{ name: "arpan9879", token: "lost-on-refresh", playerId: player }, null, null, null],
    status: "lobby",
    G: null,
    version: 2,
    tier: "bronze",
    pot: 500,
    buyIn: 500,
    actMs: 30000,
    stakes: [{ playerId: player, seat: 0, amount: 500 }],
    payouts: null,
  });
  const listed = await listTables(player);
  const row = listed.tables.find((table) => table.code === "PH8Q");
  assert.equal(row.yours, true);
  assert.equal(row.pot, 500);
  assert.equal(row.buyIn, 500);
  assert.equal(listed.wallet.chips, 14500);
  const left = await leaveLobbySeat({ playerId: player, code: "ph8q" });
  assert.equal(left.wallet.chips, 15000);
  const gone = await loadRoom("PH8Q");
  assert.equal(gone.status, "abandoned");
  assert.equal(gone.pot, 0);
  assert.equal(gone.stakes.length, 0);
  assert.ok(gone.seats.every((seat) => seat == null));
  assert.equal((await listTables(player)).tables.some((table) => table.code === "PH8Q"), false);
}

async function testReenterWaitingViewThenLeaveKeepsTheWallet() {
  const player = id();
  const created = await getOrCreateWallet(player);
  created.chips = 0;
  await saveWallet(created);
  await insertRoom({
    code: "BACK",
    n: 4,
    cardsN: 4,
    seats: [{ name: "Ann", token: "keep-me", playerId: player }, null, null, null],
    status: "lobby",
    G: null,
    version: 1,
    tier: "silver",
    pot: 0,
    buyIn: 1000,
    actMs: 30000,
    stakes: [],
    payouts: null,
  });
  const again = await sitDown({ playerId: player, name: "Ann", code: "BACK" });
  assert.equal(again.code, "BACK");
  assert.equal(again.seat, 0);
  assert.equal(again.token, "keep-me");
  assert.equal(again.state.waiting, true);
  assert.equal(again.wallet.chips, 0);
  assert.equal((await loadRoom("BACK")).pot, 0);
  assert.equal((await loadRoom("BACK")).stakes.length, 0);
  assert.equal((await loadRoom("BACK")).seats.filter(Boolean).length, 1);
  await mutateRoom(again.code, (room) => leaveSeat(room, again.seat));
  assert.equal((await loadWallet(player)).chips, 0);
  assert.equal((await loadRoom("BACK")).status, "abandoned");
  assert.equal((await listTables(player)).tables.some((table) => table.code === "BACK"), false);
}

async function testReenterRefundsARecordedStakeFromTheWaitingView() {
  const player = id();
  const created = await getOrCreateWallet(player);
  created.chips = 14500;
  await saveWallet(created);
  await insertRoom({
    code: "WAIT",
    n: 4,
    cardsN: 4,
    seats: [{ name: "Ann", token: "seat-tok", playerId: player }, null, null, null],
    status: "lobby",
    G: null,
    version: 1,
    tier: "bronze",
    pot: 500,
    buyIn: 500,
    actMs: 30000,
    stakes: [{ playerId: player, seat: 0, amount: 500 }],
    payouts: null,
  });
  const again = await sitDown({ playerId: player, name: "Ann", code: "WAIT" });
  assert.equal(again.state.waiting, true);
  assert.equal(again.seat, 0);
  assert.equal(again.token, "seat-tok");
  assert.equal(again.wallet.chips, 14500);
  assert.equal((await loadRoom("WAIT")).pot, 500);
  assert.equal((await loadRoom("WAIT")).stakes.length, 1);
  await mutateRoom(again.code, (room) => leaveSeat(room, again.seat));
  assert.equal((await loadWallet(player)).chips, 15000);
  const gone = await loadRoom("WAIT");
  assert.equal(gone.status, "abandoned");
  assert.equal(gone.pot, 0);
  assert.equal(gone.stakes.length, 0);
  assert.equal((await listTables(player)).tables.some((table) => table.code === "WAIT"), false);
}

async function testLobbyLeaveKeepsATableThatStillHasSomeone() {
  const ann = id();
  const bo = id();
  const first = await sitDown({ playerId: ann, name: "Ann", tier: "gold" });
  const second = await sitDown({ playerId: bo, name: "Bo", code: first.code });
  assert.equal(second.state.waiting, true);
  assert.equal((await loadWallet(ann)).chips, 10000);
  await leaveLobbySeat({ playerId: ann, code: first.code });
  const room = await loadRoom(first.code);
  assert.equal(room.status, "lobby");
  assert.equal(room.pot, 0);
  assert.equal(room.seats[second.seat].playerId, bo);
  assert.equal(room.seats.filter(Boolean).length, 1);
  assert.equal((await loadWallet(ann)).chips, 10000);
  assert.equal((await loadWallet(bo)).chips, 10000);
  const listed = await listTables(bo);
  const row = listed.tables.find((table) => table.code === first.code);
  assert.equal(row.yours, true);
  assert.equal(row.openSeats, 3);
}

async function testStartedHandStillForfeitsAndLobbyLeaveRefuses() {
  const players = [id(), id(), id(), id()];
  let code = "";
  for (let i = 0; i < 4; i++) {
    const sat = await sitDown({ playerId: players[i], name: "P" + i, tier: "vip" });
    code = sat.code;
  }
  assert.equal((await loadRoom(code)).status, "playing");
  assert.equal((await loadWallet(players[0])).chips, 5000);
  await assert.rejects(leaveLobbySeat({ playerId: players[0], code }), /already started/);
  await assert.rejects(sitDown({ playerId: players[0], name: "P0", code }), /already started/);
  const still = await loadRoom(code);
  assert.equal(still.status, "playing");
  assert.equal(still.pot, 20000);
  assert.equal(still.seats[0].playerId, players[0]);
  assert.ok(!still.stakes.find((stake) => stake.playerId === players[0]).forfeited);
  assert.equal((await loadWallet(players[0])).chips, 5000);
  await mutateRoom(code, (room) => leaveSeat(room, 0));
  const after = await loadRoom(code);
  assert.equal(after.status, "playing");
  assert.equal(after.pot, 20000);
  assert.equal(after.seats[0], null);
  assert.equal(after.stakes.find((stake) => stake.playerId === players[0]).forfeited, true);
  assert.equal((await loadWallet(players[0])).chips, 5000);
}

const opened = await testOpeningATableDoesNotTakeChips();
await testLeaveBeforeTheHandRefundsAndClearsTheTable(opened);
await testLegacyBuyInIsRefundedOnLobbyLeave();
await testStartedHandStillForfeitsOnQuit();
await testSecondTableDoesNotKeepTheFirstSeat();
await testBrokePlayerIsNotSeated();
await testLobbyListLeaveKeepsAnUnchargedWallet();
await testLobbyListLeaveRefundsARecordedStake();
await testReenterWaitingViewThenLeaveKeepsTheWallet();
await testReenterRefundsARecordedStakeFromTheWaitingView();
await testLobbyLeaveKeepsATableThatStillHasSomeone();
await testStartedHandStillForfeitsAndLobbyLeaveRefuses();
console.log("chip lobby ok");
