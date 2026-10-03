import { applyTimers, type Room } from "./declare-engine";
import { playComputerTurns } from "./declare-cpu";

export function advanceRoom(room: Room, now = Date.now()): boolean {
  const timed = applyTimers(room, now);
  const played = playComputerTurns(room, now);
  return timed || played;
}
