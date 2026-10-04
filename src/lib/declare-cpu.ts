import { handleAction, humanCanOffTurnDump, type Room } from "./declare-engine";

const SNIPE_WAIT_MS = 8000;

function computerSeat(room: Room, pid: number): boolean {
  return !!room.seats[pid]?.computer;
}

function signature(room: Room): string {
  const G = room.G;
  if (!G) return "";
  return [G.phase, G.turn, G.powerStep || "", G.pile.length, G.pick.join(",")].join(":");
}

function computerAct(room: Room, pid: number): void {
  const G = room.G;
  if (!G) return;
  const top = G.pile.length ? G.pile[G.pile.length - 1] : null;
  if (G.phase === "draw" && G.free && top) {
    handleAction(room, pid, { action: "draw" });
    return;
  }
  if (!top) {
    handleAction(room, pid, { action: "pass" });
    return;
  }
  const own = G.players[pid].slots.findIndex((c) => c && c.r === top.r);
  if (own >= 0) {
    handleAction(room, pid, { action: "drag", gesture: "discard", p: pid, i: own });
    return;
  }
  for (let p = 0; p < G.n; p++) {
    if (p === pid) continue;
    const seen = G.players[p].slots.findIndex(
      (c) => c && c.r === top.r && (!!c.known[pid] || !!(c.seen && c.seen[pid])),
    );
    if (seen >= 0 && G.players[pid].slots.some((c) => !!c)) {
      handleAction(room, pid, { action: "drag", gesture: "dump", p, i: seen });
      return;
    }
  }
  handleAction(room, pid, { action: "pass" });
}

// Plays computer seats until a human has a decision, a short snipe window is open, or a reveal timer is running.
export function playComputerTurns(room: Room, now = Date.now()): boolean {
  let changed = false;
  for (let guard = 0; guard < 64; guard++) {
    const G = room.G;
    if (!G || room.status !== "playing" || G.phase === "reveal" || G.phase === "keepBoth" || G.phase === "peekReveal") {
      break;
    }
    if (G.phase === "memorize") {
      let readied = false;
      for (let p = 0; p < G.n; p++) {
        if (computerSeat(room, p) && G.memorizeReady && !G.memorizeReady[p]) {
          handleAction(room, p, { action: "ready" });
          readied = true;
          changed = true;
        }
      }
      if (!readied) break;
      continue;
    }
    if (G.phase === "dumpGive" && G.dumpGive && computerSeat(room, G.dumpGive.actor)) {
      const before = signature(room);
      const giveI = G.players[G.dumpGive.actor].slots.findIndex((c) => c && !c.known[G.dumpGive.actor]);
      if (giveI >= 0) handleAction(room, G.dumpGive.actor, { action: "card", p: G.dumpGive.actor, i: giveI });
      changed = true;
      if (signature(room) === before) break;
      continue;
    }
    if (G.phase === "dumpGive") break;

    const pid = G.turn;
    if (!computerSeat(room, pid)) {
      if (G.snipeEndsAt) {
        G.snipeEndsAt = null;
        changed = true;
      }
      break;
    }

    if ((G.phase === "act" || (G.phase === "draw" && G.free)) && humanCanOffTurnDump(room)) {
      if (G.snipeEndsAt == null) {
        const wait = now + SNIPE_WAIT_MS;
        if (G.turnEndsAt != null && G.turnEndsAt > now) G.turnEndsAt = wait + (G.turnEndsAt - now);
        G.snipeEndsAt = wait;
        changed = true;
        break;
      }
      if (now < G.snipeEndsAt) break;
      G.snipeEndsAt = null;
    } else if (G.snipeEndsAt) {
      G.snipeEndsAt = null;
      changed = true;
    }

    const before = signature(room);
    if (G.phase === "draw") {
      if (G.players[pid].slots.every((c) => !c) && G.declarer === null) handleAction(room, pid, { action: "declare" });
      else handleAction(room, pid, { action: "draw" });
    } else if (G.phase === "act") {
      computerAct(room, pid);
    } else if (G.phase === "chain") {
      handleAction(room, pid, { action: "passChain" });
    } else if (G.phase === "power" && G.powerStep === "k-trade") {
      handleAction(room, pid, { action: "skipTrade" });
    } else if (G.phase === "power" || G.phase === "pick") {
      const key = G.pick.find((item) => item.startsWith(pid + ":")) || G.pick[0];
      if (!key) break;
      const [p, i] = key.split(":").map(Number);
      handleAction(room, pid, { action: "card", p, i });
    } else {
      break;
    }
    changed = true;
    if (signature(room) === before) break;
  }
  return changed;
}
