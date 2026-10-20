import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../public/declare/trial.js", import.meta.url), "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const { guestGate, explainMove } = sandbox.DeclareTrial;

function testGuestMayPlayComputerAndTrial() {
  for (const action of ["trial", "computer", "local"]) {
    const gate = guestGate(action, false);
    assert.equal(gate.ok, true, action);
    assert.equal(gate.prompt, "");
  }
  assert.equal(guestGate("trial", true).ok, true);
  assert.equal(guestGate("computer", true).ok, true);
}

function testGuestIsPromptedForRoomsAndChips() {
  for (const action of ["online", "create", "join", "chips", "claim", "sit", "wallet", "leave"]) {
    const gate = guestGate(action, false);
    assert.equal(gate.ok, false, action);
    assert.match(gate.prompt, /Sign in or create an account/i);
    assert.match(gate.prompt, /Trial Game/);
    assert.equal(guestGate(action, true).ok, true, action + " signed in");
    assert.equal(guestGate(action, true).prompt, "");
  }
  assert.match(guestGate("chips", false).prompt, /chip tables/i);
  assert.match(guestGate("create", false).prompt, /multiplayer/i);
}

function testDrawDiscardAndPowers() {
  const draw = explainMove({ kind: "draw", actor: "you", card: { r: "7", s: "H" }, seen: true, power: "" });
  assert.match(draw, /drew 7♥/);
  assert.match(draw, /Only one discard or dump is allowed on top/);

  const discard = explainMove({
    kind: "discard",
    actor: "computer",
    card: { r: "7", s: "C" },
    other: { r: "7", s: "H" },
    seen: true,
    otherSeen: true,
  });
  assert.match(discard, /discarded 7♣ on top of 7♥/);
  assert.match(discard, /Only one discard or dump/);

  for (const power of ["10", "J", "Q", "K"]) {
    const text = explainMove({ kind: "power", actor: "you", power });
    assert.match(text, /can still be matched/, power);
  }
  assert.match(explainMove({ kind: "power", actor: "you", power: "K" }), /may pick it/);
}

function testHiddenComputerPeekDoesNotLeak() {
  const peeked = { r: "9", s: "D" };
  for (const power of ["10", "J", "K"]) {
    const text = explainMove({
      kind: "peek",
      actor: "computer",
      power,
      hidden: true,
      seen: false,
      card: peeked,
    });
    assert.equal(text.includes("9"), false, power + " rank leaked: " + text);
    assert.equal(text.includes("♦"), false, power + " suit leaked: " + text);
    assert.match(text, /not shown|does not name/i);
    assert.match(text, /can still be matched/);
  }

  const chain = explainMove({
    kind: "chain",
    actor: "computer",
    hidden: true,
    rankPublic: false,
    rank: "4",
    card: { r: "4", s: "S" },
    seen: false,
  });
  assert.equal(chain.includes("4"), false, chain);
  assert.equal(chain.includes("♠"), false, chain);
  assert.match(chain, /not told whether a hidden card matched/i);

  const skipped = explainMove({
    kind: "chain-skip",
    actor: "computer",
    hidden: true,
    rankPublic: false,
    rank: "4",
  });
  assert.equal(skipped.includes("4"), false, skipped);
  assert.match(skipped, /stays matchable|can still be matched/);
}

function testPublicComputerPlayCanNameSeenCards() {
  const dumped = explainMove({
    kind: "dump",
    actor: "computer",
    card: { r: "5", s: "C" },
    other: { r: "5", s: "H" },
    seen: true,
    otherSeen: true,
  });
  assert.match(dumped, /dumped 5♣ onto 5♥/);
  assert.match(dumped, /Only one discard or dump/);
}

function testPenaltiesDeclareAndScore() {
  const wrong = explainMove({
    kind: "wrong-dump",
    actor: "you",
    card: { r: "8", s: "S" },
    other: { r: "3", s: "D" },
    seen: true,
    otherSeen: true,
  });
  assert.match(wrong, /penalty for a wrong dump/i);
  assert.match(wrong, /8♠/);
  assert.match(wrong, /3♦/);
  assert.match(wrong, /turn ends/);

  const own = explainMove({
    kind: "wrong-discard",
    actor: "you",
    card: { r: "K", s: "C" },
    other: { r: "2", s: "H" },
    seen: true,
    otherSeen: true,
  });
  assert.match(own, /keep both cards/);
  assert.match(own, /2♥ and K♣/);

  const declared = explainMove({ kind: "declare", actor: "you" });
  assert.match(declared, /declared before drawing/);
  assert.match(declared, /locks the declaring hand/);
  assert.match(declared, /lowest score wins/i);

  const score = explainMove({ kind: "score", lines: "You 6, Computer 40", winner: "You", tie: false });
  assert.match(score, /You 6, Computer 40/);
  assert.match(score, /You wins/);
  assert.match(score, /red kings count as −1/);
  assert.match(score, /lowest score wins/i);
}

function testPageWiresGuestGateAndTrial() {
  const html = readFileSync(new URL("../public/declare/index.html", import.meta.url), "utf8");
  assert.match(html, /src="trial\.js"/);
  assert.match(html, /id="trialBtn"/);
  assert.match(html, /deal\(2,\s*true\)/);
  assert.match(html, /id="trialPanel"/);
  assert.match(html, /id="trialNext"/);
  assert.match(html, /Exit trial/);
  assert.match(html, /guestGate\(/);
  assert.match(html, /explainMove\(/);
  assert.match(html, /function deal\(n, asTrial\)/);
  assert.doesNotMatch(html, /function deal\(n, asTrial\)[\s\S]{0,120}requirePlay/);
  for (const kind of ["draw", "pick", "swap", "discard", "dump", "wrong-dump", "declare", "score", "peek", "queen"]) {
    assert.match(html, new RegExp('kind: "' + kind + '"'), "missing note for " + kind);
  }
  assert.match(html, /requireAccount\("create"\)/);
  assert.match(html, /requireAccount\("join"\)/);
  assert.match(html, /requireAccount\("sit"\)/);
  assert.match(html, /requireAccount\("claim"\)/);
}

function testServerStillRequiresAccount() {
  for (const file of ["chips.ts", "create.ts", "join.ts", "action.ts", "leave.ts", "state.ts", "tick.ts"]) {
    const src = readFileSync(new URL("../src/routes/api/public/declare/" + file, import.meta.url), "utf8");
    assert.match(src, /requireUser\(request\)/, file);
  }
}

testGuestMayPlayComputerAndTrial();
testGuestIsPromptedForRoomsAndChips();
testDrawDiscardAndPowers();
testHiddenComputerPeekDoesNotLeak();
testPublicComputerPlayCanNameSeenCards();
testPenaltiesDeclareAndScore();
testPageWiresGuestGateAndTrial();
testServerStillRequiresAccount();
console.log("trial tests ok");
