(function () {
  var GLYPH = { H: "\u2665", D: "\u2666", C: "\u2663", S: "\u2660" };
  var ACCOUNT = {
    online: "create or join a multiplayer room",
    create: "create or join a multiplayer room",
    join: "create or join a multiplayer room",
    chips: "use chip tables, wallets, and Claim 5000",
    claim: "use chip tables, wallets, and Claim 5000",
    sit: "use chip tables, wallets, and Claim 5000",
    wallet: "use chip tables, wallets, and Claim 5000",
    leave: "use chip tables, wallets, and Claim 5000"
  };

  function guestGate(action, signedIn) {
    var why = ACCOUNT[action];
    if (!why || signedIn) return { ok: true, prompt: "" };
    return {
      ok: false,
      prompt: "Sign in or create an account to " + why + ". A computer game and the Trial Game stay open without an account."
    };
  }

  function cardLabel(card) {
    if (!card || card.r == null || card.s == null || !GLYPH[card.s]) return "";
    return String(card.r) + GLYPH[card.s];
  }

  function escapeReg(token) {
    return String(token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function stripToken(text, token) {
    if (!token) return text;
    return text.replace(new RegExp(escapeReg(token), "g"), "");
  }

  function visible(event, flag) {
    if (event.hidden) return false;
    if (flag === false) return false;
    return true;
  }

  function powerSentence(power) {
    if (power === "10") return "A 10 lets you peek at one of your own cards. A used 10 stays on the pile and can still be matched.";
    if (power === "J") return "A jack lets you peek at one opponent card. A used jack stays on the pile and can still be matched.";
    if (power === "Q") return "A queen is a blind trade: one of your cards swaps with an opponent card, and neither rank is shown. A used queen stays on the pile and can still be matched.";
    if (power === "K") return "A king lets you peek at one of your cards, then one opponent card, then trade or skip. A used king stays on the pile, the next player may pick it, and it can still be matched.";
    return "";
  }

  function explainMove(event) {
    if (!event || !event.kind) return "";
    var you = event.actor !== "computer";
    var who = you ? "You" : "The computer";
    var showCard = visible(event, event.seen);
    var showOther = visible(event, event.otherSeen);
    var showRank = visible(event, event.rankPublic);
    var card = showCard ? cardLabel(event.card) : "";
    var other = showOther ? cardLabel(event.other) : "";
    var rank = showRank && event.rank ? String(event.rank) : "";
    var power = event.power || "";
    var text = "";

    if (event.kind === "memorize") {
      text = "Your bottom two cards are face up so you can memorize them. Tap Ready when you have them, or wait out the 30 seconds, and they flip face down. The computer memorizes its own bottom two. You are not shown the computer's cards.";
    } else if (event.kind === "memorize-end") {
      text = "Those cards are face down now. On your turn, draw one card. You may pass it, swap it into your hand, or play one match on top of it. Only what you have seen is yours to remember.";
    } else if (event.kind === "draw") {
      text = who + " drew " + (card || "a card") + " from the deck. It sits face up in the center, so this card is public. ";
      text += you
        ? "You may pass it, swap it into your hand, discard one matching card onto it, or dump one matching opponent card."
        : "The computer may pass, swap, discard one match onto it, or use it as a power. You are not shown the computer's hand.";
      text += " Only one discard or dump is allowed on top of this drawn card.";
      if (power) text += " " + powerSentence(power);
    } else if (event.kind === "pass") {
      text = who + " passed" + (event.timedOut ? " because the move clock ran out" : "") + ". ";
      text += (card || "The center card") + " stays in the center. Passing is allowed after a draw: the card is left for the other player to pick. It was not played as a match, so the next player may take it.";
    } else if (event.kind === "pick") {
      text = who + " picked " + (card || "the center card") + " from the discard pile and gave up " + (other || "a card") + ". ";
      text += "Picking is allowed when the center card was passed or discarded earlier, so it was free to take. The card given up is now on top. One matching discard or dump of that rank is allowed, then the turn ends.";
    } else if (event.kind === "swap") {
      text = who + " swapped " + (card || "the drawn card") + " into the hand and put " + (other || "a card") + " on the center. ";
      text += "A swap is allowed on the card just drawn: it replaces one card in the hand. One matching discard or dump of the rank now on the center is allowed, then the turn ends.";
      if (!you) text += " You can see both cards because the draw was public and the card given up is now face up. The rest of the computer's hand stays hidden.";
    } else if (event.kind === "discard") {
      text = who + " discarded " + (card || "a matching card") + " on top of " + (other || "the center card") + ". ";
      text += "That was allowed because the ranks matched. Only one discard or dump is allowed on top of a drawn card, so the turn ends. The next player may pick the new top card.";
    } else if (event.kind === "dump") {
      text = who + " dumped " + (card || "a matching card") + " onto " + (other || "the center card") + ". ";
      text += "A dump is allowed when that opponent card matches the center rank. It is now face up. A face-down card is given in return. Only one discard or dump is allowed on top of a drawn card.";
    } else if (event.kind === "give") {
      text = who + " gave a face-down card to replace the dumped card. Its rank is not shown. That completes the dump, and the turn ends.";
    } else if (event.kind === "wrong-discard") {
      text = "That card was not a match" + (other ? " for " + other : "") + ". The penalty is that you keep both cards" + (card && other ? " (" + other + " and " + card + ")" : "") + ". They stay face up for a moment so you can memorize them, then flip face down, and the turn ends.";
    } else if (event.kind === "wrong-dump") {
      text = "That opponent card" + (card ? " (" + card + ")" : "") + " did not match the center" + (other ? " (" + other + ")" : "") + ". The penalty for a wrong dump is that you take the opponent's card and also keep the center card. Both stay with you so you can memorize them, and the turn ends.";
    } else if (event.kind === "keep") {
      text = (event.timedOut ? "Time ran out. " : "") + who + " kept " + (card || "the center card") + ". Keeping the drawn card is what happens when the move clock expires before a pass, swap, or match. Remember where it landed.";
    } else if (event.kind === "power") {
      text = who + " used the " + (power || "power") + ". " + powerSentence(power);
    } else if (event.kind === "peek") {
      if (you && card) {
        text = "You peeked at " + card + " with the " + (power || "power card") + ". Only you are shown this, then it flips face down. ";
      } else if (you) {
        text = "You peeked at a card with the " + (power || "power card") + ". ";
      } else {
        text = "The computer peeked at a hidden card with the " + (power || "power card") + ". You are not shown that card, and this note does not name it. ";
      }
      text += powerSentence(power);
    } else if (event.kind === "queen") {
      text = who + " finished a queen trade. One card from each hand swapped places. Neither rank is shown, because a queen is a blind trade. The used queen stays on the pile and can still be matched. It is not left as a passed card for the next player to pick.";
    } else if (event.kind === "king-trade") {
      text = who + " traded the two cards peeked with the king. ";
      if (!you) text += "You are not shown those cards. ";
      else if (card || other) text += "You already saw " + [card, other].filter(Boolean).join(" and ") + ". They are face down again after the trade. ";
      text += "The king stays on the pile, so the next player may pick it, and it can still be matched.";
    } else if (event.kind === "king-skip") {
      text = who + " skipped the king trade. The peeked cards stay where they are" + (you ? "" : ", and you are not shown them") + ". The king stays on the pile, the next player may pick it, and it can still be matched.";
    } else if (event.kind === "chain") {
      if (!you && !rank) {
        text = "The computer may play one matching discard or dump, or end the turn. You are not told whether a hidden card matched, and no unseen rank is named here. Only one match is allowed.";
      } else {
        text = who + " may play one match of " + (rank || "the center rank") + ": a card of that rank already seen, discarded on top, or a seen opponent card of that rank dumped. Unseen cards are not offered. Only one, then the turn ends.";
      }
    } else if (event.kind === "chain-skip") {
      if (!you && !rank) {
        text = "The computer skipped the extra match. You are not told whether a hidden peek matched. Only one match was available, and skipping it ends the turn. A used power card stays matchable.";
      } else {
        text = who + " skipped the extra match" + (rank ? " of " + rank : "") + ". Only one match was available, and skipping it ends the turn. A used power card stays on the pile and can still be matched.";
      }
    } else if (event.kind === "declare") {
      text = who + " declared before drawing. That locks the declaring hand: nobody can dump, peek, or trade against it. Everyone else takes one last turn, then every card is shown. The lowest score wins.";
    } else if (event.kind === "score") {
      text = "The round is scored" + (event.lines ? ": " + event.lines : "") + ". ";
      text += event.tie ? "The scores are tied. " : (event.winner ? event.winner + " wins. " : "");
      text += "The lowest score wins. Aces are 1, number cards are their face value, jacks are 11, queens are 12, black kings are 13, and red kings count as \u22121.";
    } else {
      return "";
    }

    if (!showCard) {
      text = stripToken(text, cardLabel(event.card));
      if (event.card && GLYPH[event.card.s]) text = stripToken(text, GLYPH[event.card.s]);
      if (event.card && event.card.r != null && String(event.card.r) !== String(power)) {
        text = text.replace(new RegExp("\\b" + escapeReg(String(event.card.r)) + "\\b", "g"), "");
      }
    }
    if (!showOther) {
      text = stripToken(text, cardLabel(event.other));
      if (event.other && GLYPH[event.other.s]) text = stripToken(text, GLYPH[event.other.s]);
    }
    if (!showRank && event.rank && String(event.rank) !== String(power)) {
      text = text.replace(new RegExp("\\b" + escapeReg(String(event.rank)) + "\\b", "g"), "");
    }
    return text.replace(/[ ]{2,}/g, " ").replace(/ +([.,])/g, "$1").trim();
  }

  globalThis.DeclareTrial = { guestGate: guestGate, explainMove: explainMove };
})();
