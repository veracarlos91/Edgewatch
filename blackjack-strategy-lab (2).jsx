import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from "recharts";
import {
  Settings2, Play, PenLine, Table2, BarChart3, Rewind, Download, Upload,
  ChevronLeft, ChevronRight, Plus, Trash2, RotateCcw, AlertTriangle,
  CheckCircle2, XCircle, Gauge, PauseCircle, PlayCircle, Info
} from "lucide-react";

/* =========================================================================
   DESIGN TOKENS (injected once)
   ========================================================================= */
const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');`;

const T = {
  bg: "#0A0D12",
  panel: "#12161D",
  panelAlt: "#171C24",
  border: "#232B36",
  borderSoft: "#1A2029",
  text: "#E6E9EE",
  dim: "#8B95A5",
  faint: "#5B6472",
  accent: "#37D6B8",
  accentDim: "#1E8C79",
  amber: "#F2B33D",
  win: "#3FBF7F",
  loss: "#F0555A",
  push: "#8A93A3",
};

/* =========================================================================
   CARD / SHOE PRIMITIVES
   ========================================================================= */
const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const SUITS = ["♠","♥","♦","♣"];
const RED_SUITS = new Set(["♥","♦"]);

function rankValue(rank) {
  if (rank === "A") return 11;
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  return parseInt(rank, 10);
}

function buildDecks(numDecks) {
  const cards = [];
  for (let d = 0; d < numDecks; d++) {
    for (const r of RANKS) for (const s of SUITS) cards.push({ rank: r, suit: s });
  }
  return cards;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeShoe(numDecks) {
  const cards = shuffle(buildDecks(numDecks));
  return { cards, total: cards.length };
}

function ensureShoe(shoeRef, settings) {
  const s = shoeRef.current;
  const reserve = Math.floor(s.total * (1 - settings.penetration));
  if (!s.cards || s.cards.length < Math.max(reserve, 15)) {
    shoeRef.current = makeShoe(settings.numDecks);
    shoeRef.current.reshuffled = true;
  }
}

function drawFromShoe(shoeRef) {
  return shoeRef.current.cards.pop();
}

function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    total += rankValue(c.rank);
    if (c.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

function cardStr(c) { return `${c.rank}${c.suit}`; }
function handStr(cards) { return cards.map(cardStr).join(" "); }

/* =========================================================================
   BASIC STRATEGY (multi-deck, configurable H17/S17, DAS, surrender)
   Columns for all tables: dealer up = [2,3,4,5,6,7,8,9,10,A]
   ========================================================================= */
function dealerColIndex(rank) {
  if (rank === "A") return 9;
  const v = rankValue(rank) === 10 ? 10 : parseInt(rank, 10);
  return v - 2;
}

const HARD_TABLE = {
  9:  ["H","D","D","D","D","H","H","H","H","H"],
  10: ["D","D","D","D","D","D","D","D","H","H"],
  12: ["H","H","S","S","S","H","H","H","H","H"],
  13: ["S","S","S","S","S","H","H","H","H","H"],
  14: ["S","S","S","S","S","H","H","H","H","H"],
  15: ["S","S","S","S","S","H","H","H","R","H"],
  16: ["S","S","S","S","S","H","H","R","R","R"],
};

const SOFT_TABLE = {
  13: ["H","H","H","D","D","H","H","H","H","H"],
  14: ["H","H","H","D","D","H","H","H","H","H"],
  15: ["H","H","D","D","D","H","H","H","H","H"],
  16: ["H","H","D","D","D","H","H","H","H","H"],
  17: ["H","D","D","D","D","H","H","H","H","H"],
  18: ["S","D","D","D","D","S","S","H","H","H"],
  19: ["S","S","S","S","S","S","S","S","S","S"],
  20: ["S","S","S","S","S","S","S","S","S","S"],
};

function shouldSplit(rank, dIdx, das) {
  const in_ = (set) => set.includes(dIdx);
  switch (rank) {
    case "A": return true;
    case "10": case "J": case "Q": case "K": return false;
    case "9": return in_([0,1,2,3,4,6,7]);
    case "8": return true;
    case "7": return in_([0,1,2,3,4,5]);
    case "6": return das ? in_([0,1,2,3,4]) : in_([1,2,3,4]);
    case "5": return false;
    case "4": return das ? in_([3,4]) : false;
    case "3": return das ? in_([0,1,2,3,4,5]) : in_([2,3,4,5]);
    case "2": return das ? in_([0,1,2,3,4,5]) : in_([2,3,4,5]);
    default: return false;
  }
}

function getBasicStrategyAction(cards, dealerUpRank, ctx) {
  const { canDouble, canSplit, canSurrender, settings } = ctx;
  const dIdx = dealerColIndex(dealerUpRank);

  if (cards.length === 2 && cards[0].rank === cards[1].rank) {
    if (canSplit && shouldSplit(cards[0].rank, dIdx, settings.doubleAfterSplit)) {
      return "P";
    }
  }

  const { total, soft } = handValue(cards);

  if (soft && total >= 13 && total <= 20) {
    let action = SOFT_TABLE[total][dIdx];
    if (action === "D" && !canDouble) action = total === 18 ? "S" : "H";
    return action;
  }

  if (total >= 17) return "S";
  if (total <= 8) return "H";

  if (total === 11) {
    let action = settings.dealerHitsSoft17 ? "D" : (dIdx === 9 ? "H" : "D");
    if (action === "D" && !canDouble) action = "H";
    return action;
  }

  const row = HARD_TABLE[total] ? HARD_TABLE[total].slice() : Array(10).fill("H");
  let action = row[dIdx];
  if (total === 15 && dIdx === 9) action = settings.dealerHitsSoft17 ? "R" : "H";
  if (action === "R" && !canSurrender) action = "H";
  if (action === "D" && !canDouble) action = "H";
  return action;
}

const ACTION_LABEL = { H: "Hit", S: "Stand", D: "Double", P: "Split", R: "Surrender" };

/* =========================================================================
   ROUND ENGINE
   ========================================================================= */
function playDealer(dealerCards, draw, dealerHitsSoft17) {
  let cards = dealerCards.slice();
  while (true) {
    const { total, soft } = handValue(cards);
    if (total > 21) break;
    if (total < 17) { cards.push(draw()); continue; }
    if (total === 17 && soft && dealerHitsSoft17) { cards.push(draw()); continue; }
    break;
  }
  return cards;
}

// Plays one full round (including splits) with a flat starting bet. Always follows basic strategy.
function playRound(draw, settings, bet) {
  const playerStart = [draw(), draw()];
  const dealerCards = [draw(), draw()];
  const dealerUp = dealerCards[0];
  const playerBJ = isBlackjack(playerStart);
  const dealerBJ = isBlackjack(dealerCards);

  if (playerBJ || dealerBJ) {
    let net, result;
    if (playerBJ && dealerBJ) { net = 0; result = "Push"; }
    else if (playerBJ) { net = bet * settings.blackjackPayout; result = "Blackjack"; }
    else { net = -bet; result = "Loss"; }
    return {
      playerStart, dealerUp, dealerCards, dealerPlayed: false,
      hands: [{ cards: playerStart, bet, actions: [], busted: false, doubled: false, surrendered: false, net, result }],
      net, totalBet: bet, naturals: true,
    };
  }

  let queue = [{ cards: playerStart, bet, splitCount: 0, isAceStub: false }];
  const resolved = [];

  while (queue.length > 0) {
    const h = queue.shift();
    if (h.isAceStub) {
      resolved.push({ cards: h.cards, bet: h.bet, actions: ["Stand (split ace)"], busted: false, doubled: false, surrendered: false });
      continue;
    }
    let cards = h.cards.slice();
    let betH = h.bet;
    const actions = [];
    let busted = false, doubled = false, surrendered = false, split = false;

    while (true) {
      const canDouble = cards.length === 2 && (h.splitCount === 0 || settings.doubleAfterSplit);
      const canSplit = cards.length === 2 && cards[0].rank === cards[1].rank && h.splitCount < settings.maxSplitHands - 1;
      const canSurrender = cards.length === 2 && actions.length === 0 && h.splitCount === 0 && settings.surrenderAllowed;
      const action = getBasicStrategyAction(cards, dealerUp.rank, { canDouble, canSplit, canSurrender, settings });

      if (action === "P") {
        const cardA = cards[0], cardB = cards[1];
        const isAceSplit = cardA.rank === "A" && !settings.resplitAces;
        queue.push({ cards: [cardA, draw()], bet: betH, splitCount: h.splitCount + 1, isAceStub: isAceSplit });
        queue.push({ cards: [cardB, draw()], bet: betH, splitCount: h.splitCount + 1, isAceStub: isAceSplit });
        actions.push("Split");
        split = true;
        break;
      } else if (action === "H") {
        actions.push("Hit"); cards.push(draw());
        if (handValue(cards).total > 21) { busted = true; break; }
      } else if (action === "D") {
        actions.push("Double"); betH *= 2; doubled = true; cards.push(draw());
        if (handValue(cards).total > 21) busted = true;
        break;
      } else if (action === "R") {
        actions.push("Surrender"); surrendered = true; break;
      } else {
        actions.push("Stand"); break;
      }
    }
    if (!split) resolved.push({ cards, bet: betH, actions, busted, doubled, surrendered });
  }

  const needsDealer = resolved.some((rh) => !rh.busted && !rh.surrendered);
  const finalDealerCards = needsDealer ? playDealer(dealerCards, draw, settings.dealerHitsSoft17) : dealerCards;
  const dealerTotal = handValue(finalDealerCards).total;
  const dealerBusted = dealerTotal > 21;

  let net = 0, totalBet = 0;
  for (const rh of resolved) {
    totalBet += rh.bet;
    if (rh.surrendered) { rh.net = -rh.bet / 2; rh.result = "Surrender"; }
    else if (rh.busted) { rh.net = -rh.bet; rh.result = "Loss"; }
    else if (dealerBusted) { rh.net = rh.bet; rh.result = "Win"; }
    else {
      const pt = handValue(rh.cards).total;
      if (pt > dealerTotal) { rh.net = rh.bet; rh.result = "Win"; }
      else if (pt < dealerTotal) { rh.net = -rh.bet; rh.result = "Loss"; }
      else { rh.net = 0; rh.result = "Push"; }
    }
    net += rh.net;
  }

  return { playerStart, dealerUp, dealerCards: finalDealerCards, dealerPlayed: needsDealer, hands: resolved, net, totalBet, naturals: false };
}

/* =========================================================================
   BET PROGRESSION STATE MACHINE
   ========================================================================= */
let uidCounter = 0;
function uid(prefix) { uidCounter += 1; return `${prefix}-${uidCounter}-${Math.random().toString(36).slice(2, 6)}`; }

function makeStep(label, units) {
  const id = uid("step");
  return { id, label, units, onWin: id, onLoss: id, onPush: id };
}

function templateFlat() {
  const s1 = makeStep("Flat", 1);
  return { steps: [s1], startStepId: s1.id };
}
function templateMartingale() {
  const s1 = makeStep("1x", 1), s2 = makeStep("2x", 2), s3 = makeStep("4x", 4), s4 = makeStep("8x (cap)", 8);
  s1.onWin = s1.id; s1.onLoss = s2.id; s1.onPush = s1.id;
  s2.onWin = s1.id; s2.onLoss = s3.id; s2.onPush = s2.id;
  s3.onWin = s1.id; s3.onLoss = s4.id; s3.onPush = s3.id;
  s4.onWin = s1.id; s4.onLoss = s4.id; s4.onPush = s4.id;
  return { steps: [s1, s2, s3, s4], startStepId: s1.id };
}
function templateParoli() {
  const s1 = makeStep("1x (base)", 1), s2 = makeStep("2x (1 win)", 2), s3 = makeStep("4x (2 wins)", 4);
  s1.onWin = s2.id; s1.onLoss = s1.id; s1.onPush = s1.id;
  s2.onWin = s3.id; s2.onLoss = s1.id; s2.onPush = s2.id;
  s3.onWin = s1.id; s3.onLoss = s1.id; s3.onPush = s3.id;
  return { steps: [s1, s2, s3], startStepId: s1.id };
}
function templateOneThreeTwoSix() {
  const s1 = makeStep("1", 1), s2 = makeStep("3", 3), s3 = makeStep("2", 2), s4 = makeStep("6", 6);
  s1.onWin = s2.id; s1.onLoss = s1.id; s1.onPush = s1.id;
  s2.onWin = s3.id; s2.onLoss = s1.id; s2.onPush = s2.id;
  s3.onWin = s4.id; s3.onLoss = s1.id; s3.onPush = s3.id;
  s4.onWin = s1.id; s4.onLoss = s1.id; s4.onPush = s4.id;
  return { steps: [s1, s2, s3, s4], startStepId: s1.id };
}
function templateDAlembert() {
  const steps = [];
  for (let i = 1; i <= 10; i++) steps.push(makeStep(`${i}x`, i));
  steps.forEach((s, i) => {
    s.onWin = steps[Math.max(0, i - 1)].id;
    s.onLoss = steps[Math.min(steps.length - 1, i + 1)].id;
    s.onPush = s.id;
  });
  return { steps, startStepId: steps[0].id };
}

const TEMPLATES = {
  flat: { label: "Flat betting", make: templateFlat },
  martingale: { label: "Martingale (double on loss)", make: templateMartingale },
  paroli: { label: "Paroli (parlay 3 wins)", make: templateParoli },
  onethreetwosix: { label: "1-3-2-6", make: templateOneThreeTwoSix },
  dalembert: { label: "D'Alembert", make: templateDAlembert },
};

function computeBetForStep(step, unitSize, tableMin, tableMax, bankroll) {
  let bet = step.units * unitSize;
  bet = Math.max(tableMin, Math.min(tableMax, bet));
  bet = Math.min(bet, Math.max(0, bankroll));
  return Math.round(bet * 100) / 100;
}

function nextStepId(step, outcome) {
  if (outcome === "win") return step.onWin;
  if (outcome === "loss") return step.onLoss;
  return step.onPush;
}

/* =========================================================================
   SIMULATION
   ========================================================================= */
function simulateHands(settings, progression, startBankroll, numHands, trailingStop, peakState) {
  const shoeRef = { current: makeShoe(settings.numDecks) };
  const draw = () => drawFromShoe(shoeRef);
  const stepsById = Object.fromEntries(progression.steps.map((s) => [s.id, s]));
  let stepId = progression.startStepId;
  let bankroll = startBankroll;
  const records = [];
  const equity = [startBankroll];
  let stopped = false, stopReason = null;

  const ts = trailingStop || { enabled: false, pct: 20, basis: "bankroll", minProfit: 0 };
  const sessionStartBankroll = peakState?.sessionStartBankroll ?? startBankroll;
  let peakBankroll = peakState?.peakBankroll ?? startBankroll;
  let peakProfit = peakState?.peakProfit ?? 0;
  let armed = peakState?.armed ?? false;

  for (let i = 0; i < numHands; i++) {
    ensureShoe(shoeRef, settings);
    const step = stepsById[stepId] || progression.steps[0];
    const bet = computeBetForStep(step, progression.unitSize, progression.tableMin, progression.tableMax, bankroll);

    if (bet < progression.tableMin || bet <= 0) { stopped = true; stopReason = "Bankroll below table minimum"; break; }

    const startBankrollHand = bankroll;
    const round = playRound(draw, settings, bet);
    bankroll += round.net;

    const outcome = round.net > 0 ? "win" : round.net < 0 ? "loss" : "push";
    const decisions = round.hands.length === 1
      ? round.hands[0].actions.join(", ") || "—"
      : round.hands.map((h, idx) => `H${idx + 1}: ${h.actions.join(", ") || "—"}`).join(" | ");
    const resultLabel = round.naturals
      ? round.hands[0].result
      : round.hands.length === 1
        ? round.hands[0].result
        : (round.hands.every((h) => h.net > 0) ? "Split Win" : round.hands.every((h) => h.net < 0) ? "Split Loss" : "Split Mixed");

    records.push({
      id: uid("hand"),
      source: "sim",
      startBankroll: startBankrollHand,
      endBankroll: bankroll,
      bet,
      dealerUpCard: cardStr(round.dealerUp),
      playerHand: handStr(round.playerStart),
      decisions,
      dealerFinal: `${handStr(round.dealerCards)} = ${handValue(round.dealerCards).total}`,
      result: resultLabel,
      net: round.net,
      matchedBasicStrategy: true,
      stepLabel: step.label,
    });
    equity.push(bankroll);

    stepId = nextStepId(step, outcome);

    const profit = bankroll - sessionStartBankroll;
    if (bankroll > peakBankroll) peakBankroll = bankroll;
    if (profit > peakProfit) peakProfit = profit;
    if (ts.enabled && !armed && profit >= ts.minProfit) armed = true;

    if (progression.stopWin > 0 && bankroll - startBankroll >= progression.stopWin) { stopped = true; stopReason = "Stop-win target reached"; break; }
    if (progression.stopLoss > 0 && startBankroll - bankroll >= progression.stopLoss) { stopped = true; stopReason = "Stop-loss limit reached"; break; }
    if (ts.enabled && armed) {
      const stopLevel = ts.basis === "bankroll"
        ? peakBankroll * (1 - ts.pct / 100)
        : sessionStartBankroll + peakProfit * (1 - ts.pct / 100);
      if (bankroll <= stopLevel) {
        stopped = true;
        stopReason = `Trailing profit stop triggered (peak ${ts.basis === "bankroll" ? "bankroll" : "profit"} ${money(ts.basis === "bankroll" ? peakBankroll : peakProfit)}, stop level ${money(stopLevel)})`;
        break;
      }
    }
    if (bankroll <= 0) { stopped = true; stopReason = "Bankroll depleted"; break; }
  }

  return {
    records, equity, endBankroll: bankroll, stopped, stopReason, finalStepId: stepId,
    peakState: { sessionStartBankroll, peakBankroll, peakProfit, armed },
  };
}

// Headless flat 1-unit baseline for EV / variance reference (always basic strategy, no progression).
function simulateBaseline(settings, trials) {
  const shoeRef = { current: makeShoe(settings.numDecks) };
  const draw = () => drawFromShoe(shoeRef);
  const outcomes = new Array(trials);
  for (let i = 0; i < trials; i++) {
    ensureShoe(shoeRef, settings);
    const round = playRound(draw, settings, 1);
    outcomes[i] = round.net;
  }
  const mean = outcomes.reduce((a, b) => a + b, 0) / trials;
  const variance = outcomes.reduce((a, b) => a + (b - mean) * (b - mean), 0) / trials;
  return { mean, variance, std: Math.sqrt(variance), trials };
}

/* =========================================================================
   STATS
   ========================================================================= */
function normCdf(z) {
  // Abramowitz-Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

function computeStreaks(records) {
  let longestWin = 0, longestLoss = 0, curWin = 0, curLoss = 0, cur = 0, curType = null;
  for (const r of records) {
    if (r.net > 0) { curWin++; curLoss = 0; longestWin = Math.max(longestWin, curWin); curType = "win"; cur = curWin; }
    else if (r.net < 0) { curLoss++; curWin = 0; longestLoss = Math.max(longestLoss, curLoss); curType = "loss"; cur = curLoss; }
    else { curWin = 0; curLoss = 0; curType = "push"; cur = 0; }
  }
  return { longestWin, longestLoss, currentStreak: cur, currentType: curType };
}

function computeDrawdown(equitySeries) {
  let peak = equitySeries[0] ?? 0, maxDD = 0, maxDDPct = 0;
  for (const v of equitySeries) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDD) maxDD = dd;
    const ddPct = peak > 0 ? dd / peak : 0;
    if (ddPct > maxDDPct) maxDDPct = ddPct;
  }
  return { maxDrawdown: maxDD, maxDrawdownPct: maxDDPct };
}

function computeStats(records, baseline) {
  const n = records.length;
  if (n === 0) return null;
  const wins = records.filter((r) => r.net > 0).length;
  const losses = records.filter((r) => r.net < 0).length;
  const pushes = records.filter((r) => r.net === 0).length;
  const blackjacks = records.filter((r) => r.result === "Blackjack").length;
  const netProfit = records.reduce((a, r) => a + r.net, 0);
  const totalWagered = records.reduce((a, r) => a + r.bet, 0);
  const mean = netProfit / n;
  const variance = records.reduce((a, r) => a + (r.net - mean) * (r.net - mean), 0) / n;
  const std = Math.sqrt(variance);
  const profitPer100 = (netProfit / n) * 100;
  const matched = records.filter((r) => r.matchedBasicStrategy).length;
  const matchPct = matched / n;

  const equity = [records[0].startBankroll, ...records.map((r) => r.endBankroll)];
  const { maxDrawdown, maxDrawdownPct } = computeDrawdown(equity);
  const streaks = computeStreaks(records);

  let sig = null;
  if (baseline) {
    const expectedProfit = baseline.mean * totalWagered;
    const varianceProfit = baseline.variance * records.reduce((a, r) => a + r.bet * r.bet, 0);
    const seProfit = Math.sqrt(Math.max(varianceProfit, 1e-9));
    const z = (netProfit - expectedProfit) / seProfit;
    const p = 2 * (1 - normCdf(Math.abs(z)));
    sig = {
      expectedProfit, netProfit, diff: netProfit - expectedProfit, z, p,
      houseEdgePct: -baseline.mean * 100,
      significant: Math.abs(z) >= 1.96,
    };
  }

  return {
    n, wins, losses, pushes, blackjacks, netProfit, totalWagered, mean, variance, std,
    profitPer100, matchPct, maxDrawdown, maxDrawdownPct, streaks, equity, sig,
    winRate: wins / n,
  };
}

/* =========================================================================
   CSV
   ========================================================================= */
const CSV_COLUMNS = [
  "index","source","stepLabel","startBankroll","endBankroll","bet","dealerUpCard",
  "playerHand","decisions","dealerFinal","result","net","matchedBasicStrategy"
];

function toCSV(records) {
  const rows = [CSV_COLUMNS.join(",")];
  records.forEach((r, i) => {
    const row = [
      i + 1, r.source, r.stepLabel ?? "", r.startBankroll, r.endBankroll, r.bet,
      r.dealerUpCard, r.playerHand, r.decisions, r.dealerFinal ?? "", r.result, r.net, r.matchedBasicStrategy,
    ].map((v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    rows.push(row.join(","));
  });
  return rows.join("\n");
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const out = [];
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim()) continue;
    // simple CSV split honoring quotes
    const fields = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQ = false; }
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ",") { fields.push(cur); cur = ""; }
        else cur += c;
      }
    }
    fields.push(cur);
    const get = (name) => fields[idx[name]];
    out.push({
      id: uid("hand"),
      source: get("source") || "real",
      stepLabel: get("stepLabel") || "",
      startBankroll: parseFloat(get("startBankroll")) || 0,
      endBankroll: parseFloat(get("endBankroll")) || 0,
      bet: parseFloat(get("bet")) || 0,
      dealerUpCard: get("dealerUpCard") || "",
      playerHand: get("playerHand") || "",
      decisions: get("decisions") || "",
      dealerFinal: get("dealerFinal") || "",
      result: get("result") || "",
      net: parseFloat(get("net")) || 0,
      matchedBasicStrategy: (get("matchedBasicStrategy") || "true") === "true",
    });
  }
  return out;
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* =========================================================================
   SMALL UI PRIMITIVES
   ========================================================================= */
function Panel({ children, style, className }) {
  return (
    <div className={className} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ eyebrow, title, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
      <div>
        {eyebrow && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", color: T.accent, textTransform: "uppercase", marginBottom: 4 }}>{eyebrow}</div>}
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 600, color: T.text }}>{title}</div>
      </div>
      {right}
    </div>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: T.panelAlt, border: `1px solid ${T.borderSoft}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: T.dim, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono', monospace" }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 600, color: color || T.text, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Badge({ children, tone = "default" }) {
  const map = {
    default: { bg: "#1B222C", fg: T.dim },
    win: { bg: "rgba(63,191,127,0.14)", fg: T.win },
    loss: { bg: "rgba(240,85,90,0.14)", fg: T.loss },
    push: { bg: "rgba(138,147,163,0.14)", fg: T.push },
    accent: { bg: "rgba(55,214,184,0.14)", fg: T.accent },
    amber: { bg: "rgba(242,179,61,0.14)", fg: T.amber },
  };
  const c = map[tone] || map.default;
  return (
    <span style={{ background: c.bg, color: c.fg, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: "2px 7px", borderRadius: 5, fontWeight: 600, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function resultTone(result) {
  if (!result) return "default";
  if (result.includes("Win") || result === "Blackjack") return "win";
  if (result.includes("Loss")) return "loss";
  if (result.includes("Push")) return "push";
  if (result === "Surrender") return "amber";
  return "default";
}

function Btn({ children, onClick, variant = "default", disabled, style, type = "button", title }) {
  const base = {
    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 13.5,
    padding: "9px 16px", borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid transparent", display: "inline-flex", alignItems: "center", gap: 7,
    opacity: disabled ? 0.45 : 1, transition: "filter 0.15s",
  };
  const variants = {
    default: { background: T.panelAlt, color: T.text, border: `1px solid ${T.border}` },
    primary: { background: T.accent, color: "#04231D" },
    ghost: { background: "transparent", color: T.dim, border: `1px solid ${T.border}` },
    danger: { background: "transparent", color: T.loss, border: `1px solid rgba(240,85,90,0.3)` },
  };
  return (
    <button type={type} title={title} onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.filter = "brightness(1.12)")}
      onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}>
      {children}
    </button>
  );
}

function Field({ label, children, hint }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12, color: T.dim, marginBottom: 5, fontFamily: "'JetBrains Mono', monospace" }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

const inputStyle = {
  width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6,
  color: T.text, padding: "8px 10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 13.5,
  outline: "none", boxSizing: "border-box",
};

function NumInput(props) { return <input type="number" style={inputStyle} {...props} />; }
function TextInput(props) { return <input type="text" style={inputStyle} {...props} />; }
function Select({ children, ...props }) { return <select style={{ ...inputStyle, cursor: "pointer" }} {...props}>{children}</select>; }
function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
      <div onClick={() => onChange(!checked)} style={{
        width: 38, height: 21, borderRadius: 11, background: checked ? T.accent : T.border,
        position: "relative", transition: "background 0.15s", flexShrink: 0,
      }}>
        <div style={{
          width: 15, height: 15, borderRadius: "50%", background: checked ? "#04231D" : T.dim,
          position: "absolute", top: 3, left: checked ? 20 : 3, transition: "left 0.15s",
        }} />
      </div>
      <span style={{ fontSize: 13.5, color: T.text }}>{label}</span>
    </label>
  );
}

function money(v) {
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}
function moneyColored(v) {
  return <span style={{ color: v > 0 ? T.win : v < 0 ? T.loss : T.push }}>{money(v)}</span>;
}

function TrailingStopStatus({ bankroll, peak, trailingStop }) {
  const status = computeTrailingStopStatus(peak.sessionStartBankroll, bankroll, peak, trailingStop);
  if (!trailingStop.enabled) {
    return (
      <Panel style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.faint, fontSize: 13 }}>
          <Info size={14} /> Trailing profit stop is off — enable it in Configuration to track it here.
        </div>
      </Panel>
    );
  }
  return (
    <Panel style={{ padding: 18 }}>
      <SectionTitle eyebrow="Live" title="Trailing Profit Stop"
        right={status.armed
          ? <Badge tone="accent">Armed</Badge>
          : <Badge tone="default">Not armed yet (needs {money(trailingStop.minProfit)} profit)</Badge>} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <StatCard label="Bankroll" value={money(bankroll)} />
        <StatCard label={trailingStop.basis === "bankroll" ? "Peak bankroll" : "Peak profit"} value={money(status.basisPeakValue)} color={T.accent} />
        <StatCard label="Stop level" value={status.stopLevel != null ? money(status.stopLevel) : "—"} color={T.amber} />
        <StatCard label="Distance to stop" value={status.distance != null ? money(status.distance) : "—"} color={status.distance != null && status.distance <= 0 ? T.loss : T.win} />
      </div>
      <div style={{ fontSize: 11.5, color: T.faint, marginTop: 10 }}>
        Trailing {trailingStop.pct}% off {trailingStop.basis === "bankroll" ? "peak bankroll" : "peak profit"}, active once profit reaches {money(trailingStop.minProfit)}.
      </div>
    </Panel>
  );
}

/* =========================================================================
   MINI CARD VISUAL
   ========================================================================= */
function PlayingCard({ code, size = "sm" }) {
  const m = code.match(/^(10|[2-9JQKA])([♠♥♦♣])$/);
  const rank = m ? m[1] : code;
  const suit = m ? m[2] : "";
  const red = RED_SUITS.has(suit);
  const dims = size === "sm" ? { w: 30, h: 42, fs: 13 } : { w: 40, h: 56, fs: 16 };
  return (
    <div style={{
      width: dims.w, height: dims.h, borderRadius: 5, background: "#F4F2EC",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      border: "1px solid #0003", boxShadow: "0 1px 2px rgba(0,0,0,0.4)", flexShrink: 0,
    }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: dims.fs, color: red ? "#C43B3B" : "#1B2027", lineHeight: 1 }}>{rank}</div>
      <div style={{ fontSize: dims.fs - 1, color: red ? "#C43B3B" : "#1B2027", lineHeight: 1, marginTop: 2 }}>{suit}</div>
    </div>
  );
}
function CardRow({ str, size }) {
  const parts = str.trim().split(/\s+/).filter(Boolean);
  return <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{parts.map((p, i) => <PlayingCard key={i} code={p} size={size} />)}</div>;
}

/* =========================================================================
   DEFAULT SETTINGS
   ========================================================================= */
function defaultSettings() {
  return {
    numDecks: 6,
    dealerHitsSoft17: false,
    doubleAfterSplit: true,
    surrenderAllowed: true,
    resplitAces: false,
    maxSplitHands: 4,
    blackjackPayout: 1.5,
    penetration: 0.75,
  };
}
function defaultProgression() {
  const t = templateFlat();
  return { ...t, unitSize: 10, tableMin: 10, tableMax: 500, stopWin: 0, stopLoss: 0 };
}
function defaultTrailingStop() {
  return { enabled: false, pct: 20, basis: "bankroll", minProfit: 0 };
}

// Computes live bankroll / peak / stop-level / distance-to-stop for on-screen display.
function computeTrailingStopStatus(sessionStartBankroll, bankroll, peakState, trailingStop) {
  const peakBankroll = peakState?.peakBankroll ?? sessionStartBankroll;
  const peakProfit = peakState?.peakProfit ?? 0;
  const armed = peakState?.armed ?? false;
  const basisPeakValue = trailingStop.basis === "bankroll" ? peakBankroll : peakProfit;
  let stopLevel = null, distance = null;
  if (trailingStop.enabled && armed) {
    stopLevel = trailingStop.basis === "bankroll"
      ? peakBankroll * (1 - trailingStop.pct / 100)
      : sessionStartBankroll + peakProfit * (1 - trailingStop.pct / 100);
    distance = bankroll - stopLevel;
  }
  return { peakBankroll, peakProfit, basisPeakValue, armed, stopLevel, distance };
}

/* =========================================================================
   MAIN APP
   ========================================================================= */
const TABS = [
  { id: "config", label: "Configuration", icon: Settings2 },
  { id: "simulate", label: "Simulate", icon: Play },
  { id: "logreal", label: "Log Real Hand", icon: PenLine },
  { id: "log", label: "Hand Log", icon: Table2 },
  { id: "analysis", label: "Analysis", icon: BarChart3 },
  { id: "replay", label: "Replay", icon: Rewind },
];

export default function App() {
  const [tab, setTab] = useState("config");
  const [settings, setSettings] = useState(defaultSettings);
  const [progression, setProgression] = useState(defaultProgression);
  const [trailingStop, setTrailingStop] = useState(defaultTrailingStop);
  const [startBankroll, setStartBankroll] = useState(2000);

  const [simRecords, setSimRecords] = useState([]);
  const [simBankroll, setSimBankroll] = useState(2000);
  const [simStepId, setSimStepId] = useState(progression.startStepId);
  const [simRunning, setSimRunning] = useState(false);
  const [simLastRun, setSimLastRun] = useState(null);
  const [simPeak, setSimPeak] = useState({ sessionStartBankroll: 2000, peakBankroll: 2000, peakProfit: 0, armed: false });

  const [realRecords, setRealRecords] = useState([]);
  const [realBankroll, setRealBankroll] = useState(2000);
  const [realStepId, setRealStepId] = useState(progression.startStepId);
  const [realPeak, setRealPeak] = useState({ sessionStartBankroll: 2000, peakBankroll: 2000, peakProfit: 0, armed: false });

  const [logFilter, setLogFilter] = useState("all");
  const [analysisMode, setAnalysisMode] = useState("all");
  const [replaySource, setReplaySource] = useState("all");
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    setSimBankroll(startBankroll);
    setSimPeak({ sessionStartBankroll: startBankroll, peakBankroll: startBankroll, peakProfit: 0, armed: false });
    setRealPeak({ sessionStartBankroll: startBankroll, peakBankroll: startBankroll, peakProfit: 0, armed: false });
  }, []); // eslint-disable-line

  const baseline = useMemo(() => simulateBaseline(settings, 20000), [
    settings.numDecks, settings.dealerHitsSoft17, settings.doubleAfterSplit,
    settings.surrenderAllowed, settings.resplitAces, settings.maxSplitHands,
    settings.blackjackPayout, settings.penetration,
  ]);

  const allRecords = useMemo(() => [...simRecords, ...realRecords].sort((a, b) => 0), [simRecords, realRecords]);

  function resetSimSession() {
    setSimRecords([]); setSimBankroll(startBankroll); setSimStepId(progression.startStepId); setSimLastRun(null);
    setSimPeak({ sessionStartBankroll: startBankroll, peakBankroll: startBankroll, peakProfit: 0, armed: false });
  }
  function resetRealSession() {
    setRealRecords([]); setRealBankroll(startBankroll); setRealStepId(progression.startStepId);
    setRealPeak({ sessionStartBankroll: startBankroll, peakBankroll: startBankroll, peakProfit: 0, armed: false });
  }

  function runSimulation(numHands) {
    setSimRunning(true);
    setTimeout(() => {
      const stepsById = Object.fromEntries(progression.steps.map((s) => [s.id, s]));
      const startStep = stepsById[simStepId] ? simStepId : progression.startStepId;
      const result = simulateHands(settings, { ...progression, startStepId: startStep }, simBankroll, numHands, trailingStop, simPeak);
      setSimRecords((prev) => [...prev, ...result.records]);
      setSimBankroll(result.endBankroll);
      setSimStepId(result.finalStepId);
      setSimPeak(result.peakState);
      setSimLastRun(result);
      setSimRunning(false);
    }, 30);
  }

  const currentSimStepLabel = useMemo(() => {
    const s = progression.steps.find((s) => s.id === simStepId);
    return s ? s.label : progression.steps[0]?.label;
  }, [simStepId, progression]);
  const currentRealStepLabel = useMemo(() => {
    const s = progression.steps.find((s) => s.id === realStepId);
    return s ? s.label : progression.steps[0]?.label;
  }, [realStepId, progression]);
  const currentRealStep = progression.steps.find((s) => s.id === realStepId) || progression.steps[0];
  const suggestedRealBet = currentRealStep ? computeBetForStep(currentRealStep, progression.unitSize, progression.tableMin, progression.tableMax, realBankroll) : progression.unitSize;

  function addRealHand(entry) {
    const newBankroll = realBankroll + entry.net;
    const outcome = entry.net > 0 ? "win" : entry.net < 0 ? "loss" : "push";
    const nextId = nextStepId(currentRealStep, outcome);
    const record = {
      id: uid("hand"), source: "real",
      startBankroll: realBankroll, endBankroll: newBankroll,
      bet: entry.bet, dealerUpCard: entry.dealerUpCard, playerHand: entry.playerHand,
      decisions: entry.decisions, dealerFinal: entry.dealerFinal || "—",
      result: entry.result, net: entry.net, matchedBasicStrategy: entry.matchedBasicStrategy,
      stepLabel: currentRealStep.label,
    };
    setRealRecords((prev) => [...prev, record]);
    setRealBankroll(newBankroll);
    setRealStepId(nextId);
    setRealPeak((prev) => {
      const profit = newBankroll - prev.sessionStartBankroll;
      const peakBankroll = Math.max(prev.peakBankroll, newBankroll);
      const peakProfit = Math.max(prev.peakProfit, profit);
      const armed = prev.armed || (trailingStop.enabled && profit >= trailingStop.minProfit);
      return { ...prev, peakBankroll, peakProfit, armed };
    });
  }

  function handleExport(which) {
    const recs = which === "sim" ? simRecords : which === "real" ? realRecords : allRecords;
    downloadFile(`blackjack-${which}-hands-${Date.now()}.csv`, toCSV(recs), "text/csv");
  }
  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCSV(String(reader.result));
      const simP = parsed.filter((r) => r.source === "sim");
      const realP = parsed.filter((r) => r.source !== "sim");
      if (simP.length) { setSimRecords((p) => [...p, ...simP]); setSimBankroll(simP[simP.length - 1].endBankroll); }
      if (realP.length) { setRealRecords((p) => [...p, ...realP]); setRealBankroll(realP[realP.length - 1].endBankroll); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const replayList = useMemo(() => {
    if (replaySource === "sim") return simRecords;
    if (replaySource === "real") return realRecords;
    return allRecords;
  }, [replaySource, simRecords, realRecords, allRecords]);

  useEffect(() => { setReplayIndex(0); }, [replaySource]);
  useEffect(() => {
    if (!replayPlaying) return;
    if (replayList.length === 0) return;
    const t = setInterval(() => {
      setReplayIndex((i) => {
        if (i >= replayList.length - 1) { setReplayPlaying(false); return i; }
        return i + 1;
      });
    }, 1300);
    return () => clearInterval(t);
  }, [replayPlaying, replayList.length]);

  return (
    <div style={{
      fontFamily: "'Space Grotesk', 'Inter', sans-serif", background: T.bg, color: T.text,
      minHeight: "100vh", width: "100%",
    }}>
      <style>{FONT_IMPORT}{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 9px; height: 9px; }
        ::-webkit-scrollbar-thumb { background: #263041; border-radius: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        input:focus, select:focus { border-color: ${T.accent} !important; }
        table { border-collapse: collapse; width: 100%; }
        th, td { text-align: left; padding: 7px 10px; font-size: 12.5px; }
        tbody tr:hover { background: ${T.panelAlt}; }
      `}</style>

      {/* HEADER */}
      <div style={{ borderBottom: `1px solid ${T.border}`, padding: "16px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: T.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Gauge size={17} color="#04231D" />
          </div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17, letterSpacing: "0.01em" }}>EDGEWATCH</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: T.dim, letterSpacing: "0.08em" }}>BLACKJACK STRATEGY LAB</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}>
          <div>
            <span style={{ color: T.dim }}>SIM </span>
            <span style={{ color: T.text, fontWeight: 600 }}>{money(simBankroll)}</span>
            <span style={{ color: T.faint }}> · {simRecords.length}h</span>
          </div>
          <div>
            <span style={{ color: T.dim }}>REAL </span>
            <span style={{ color: T.text, fontWeight: 600 }}>{money(realBankroll)}</span>
            <span style={{ color: T.faint }}> · {realRecords.length}h</span>
          </div>
        </div>
      </div>

      {/* TAB NAV */}
      <div style={{ display: "flex", gap: 4, padding: "10px 22px 0", borderBottom: `1px solid ${T.border}`, overflowX: "auto" }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "9px 14px",
              background: "transparent", border: "none", cursor: "pointer",
              color: active ? T.accent : T.dim, fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 600, fontSize: 13.5, borderBottom: active ? `2px solid ${T.accent}` : "2px solid transparent",
              whiteSpace: "nowrap",
            }}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: "22px", maxWidth: 1180, margin: "0 auto" }}>
        {tab === "config" && (
          <ConfigTab
            settings={settings} setSettings={setSettings}
            progression={progression} setProgression={setProgression}
            startBankroll={startBankroll} setStartBankroll={setStartBankroll}
            trailingStop={trailingStop} setTrailingStop={setTrailingStop}
            baseline={baseline}
          />
        )}
        {tab === "simulate" && (
          <SimulateTab
            simRecords={simRecords} simBankroll={simBankroll} simRunning={simRunning}
            currentStepLabel={currentSimStepLabel} runSimulation={runSimulation}
            resetSimSession={resetSimSession} startBankroll={startBankroll}
            simLastRun={simLastRun} baseline={baseline}
            trailingStop={trailingStop} simPeak={simPeak}
          />
        )}
        {tab === "logreal" && (
          <LogRealTab
            settings={settings} realRecords={realRecords} realBankroll={realBankroll}
            currentStepLabel={currentRealStepLabel} suggestedBet={suggestedRealBet}
            addRealHand={addRealHand} resetRealSession={resetRealSession}
            blackjackPayout={settings.blackjackPayout}
            trailingStop={trailingStop} realPeak={realPeak}
          />
        )}
        {tab === "log" && (
          <HandLogTab
            simRecords={simRecords} realRecords={realRecords} allRecords={allRecords}
            filter={logFilter} setFilter={setLogFilter}
            onExport={handleExport} fileInputRef={fileInputRef} onImportFile={handleImportFile}
          />
        )}
        {tab === "analysis" && (
          <AnalysisTab
            simRecords={simRecords} realRecords={realRecords} allRecords={allRecords}
            mode={analysisMode} setMode={setAnalysisMode} baseline={baseline}
          />
        )}
        {tab === "replay" && (
          <ReplayTab
            replaySource={replaySource} setReplaySource={setReplaySource}
            list={replayList} index={replayIndex} setIndex={setReplayIndex}
            playing={replayPlaying} setPlaying={setReplayPlaying}
          />
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   CONFIG TAB
   ========================================================================= */
function ConfigTab({ settings, setSettings, progression, setProgression, startBankroll, setStartBankroll, trailingStop, setTrailingStop, baseline }) {
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const setP = (k, v) => setProgression((p) => ({ ...p, [k]: v }));
  const setTS = (k, v) => setTrailingStop((t) => ({ ...t, [k]: v }));

  function loadTemplate(key) {
    const t = TEMPLATES[key].make();
    setProgression((p) => ({ ...p, steps: t.steps, startStepId: t.startStepId }));
  }
  function updateStep(id, patch) {
    setProgression((p) => ({ ...p, steps: p.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  }
  function addStep() {
    setProgression((p) => ({ ...p, steps: [...p.steps, makeStep(`Step ${p.steps.length + 1}`, 1)] }));
  }
  function removeStep(id) {
    setProgression((p) => {
      if (p.steps.length <= 1) return p;
      const steps = p.steps.filter((s) => s.id !== id);
      const fallback = steps[0].id;
      const fixed = steps.map((s) => ({
        ...s,
        onWin: s.onWin === id ? fallback : s.onWin,
        onLoss: s.onLoss === id ? fallback : s.onLoss,
        onPush: s.onPush === id ? fallback : s.onPush,
      }));
      return { ...p, steps: fixed, startStepId: p.startStepId === id ? fallback : p.startStepId };
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <Panel style={{ padding: 20 }}>
        <SectionTitle eyebrow="Table rules" title="Deck & Dealer Configuration" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16 }}>
          <Field label="NUMBER OF DECKS">
            <NumInput min={1} max={8} value={settings.numDecks} onChange={(e) => set("numDecks", Math.max(1, Math.min(8, parseInt(e.target.value) || 1)))} />
          </Field>
          <Field label="SHOE PENETRATION" hint={`Reshuffle at ~${Math.round((1 - settings.penetration) * 100)}% remaining`}>
            <NumInput step={0.05} min={0.4} max={0.95} value={settings.penetration} onChange={(e) => set("penetration", parseFloat(e.target.value) || 0.75)} />
          </Field>
          <Field label="BLACKJACK PAYOUT">
            <Select value={settings.blackjackPayout} onChange={(e) => set("blackjackPayout", parseFloat(e.target.value))}>
              <option value={1.5}>3 : 2</option>
              <option value={1.2}>6 : 5</option>
            </Select>
          </Field>
          <Field label="MAX HANDS AFTER SPLIT">
            <NumInput min={2} max={4} value={settings.maxSplitHands} onChange={(e) => set("maxSplitHands", Math.max(2, Math.min(4, parseInt(e.target.value) || 4)))} />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginTop: 18 }}>
          <Toggle checked={settings.dealerHitsSoft17} onChange={(v) => set("dealerHitsSoft17", v)} label="Dealer hits soft 17" />
          <Toggle checked={settings.doubleAfterSplit} onChange={(v) => set("doubleAfterSplit", v)} label="Double after split (DAS)" />
          <Toggle checked={settings.surrenderAllowed} onChange={(v) => set("surrenderAllowed", v)} label="Late surrender allowed" />
          <Toggle checked={settings.resplitAces} onChange={(v) => set("resplitAces", v)} label="Resplit aces allowed" />
        </div>
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, color: T.dim, fontSize: 12.5 }}>
          <Info size={14} />
          Insurance is never taken — basic strategy always declines it, so it can't be a source of deviation here.
        </div>
      </Panel>

      <Panel style={{ padding: 20 }}>
        <SectionTitle eyebrow="Bankroll" title="Starting Bankroll & Table Limits" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16 }}>
          <Field label="STARTING BANKROLL ($)">
            <NumInput min={0} value={startBankroll} onChange={(e) => setStartBankroll(parseFloat(e.target.value) || 0)} />
          </Field>
          <Field label="BASE UNIT SIZE ($)">
            <NumInput min={1} value={progression.unitSize} onChange={(e) => setP("unitSize", parseFloat(e.target.value) || 1)} />
          </Field>
          <Field label="TABLE MIN ($)">
            <NumInput min={0} value={progression.tableMin} onChange={(e) => setP("tableMin", parseFloat(e.target.value) || 0)} />
          </Field>
          <Field label="TABLE MAX ($)">
            <NumInput min={0} value={progression.tableMax} onChange={(e) => setP("tableMax", parseFloat(e.target.value) || 0)} />
          </Field>
          <Field label="STOP-WIN ($, 0 = off)" hint="Simulation only">
            <NumInput min={0} value={progression.stopWin} onChange={(e) => setP("stopWin", parseFloat(e.target.value) || 0)} />
          </Field>
          <Field label="STOP-LOSS ($, 0 = off)" hint="Simulation only">
            <NumInput min={0} value={progression.stopLoss} onChange={(e) => setP("stopLoss", parseFloat(e.target.value) || 0)} />
          </Field>
        </div>
      </Panel>

      <Panel style={{ padding: 20 }}>
        <SectionTitle eyebrow="Protect gains" title="Trailing Profit Stop"
          right={<Toggle checked={trailingStop.enabled} onChange={(v) => setTS("enabled", v)} label="Enabled" />} />
        <div style={{ fontSize: 12.5, color: T.dim, marginBottom: 14, lineHeight: 1.5 }}>
          Once your profit reaches the activation threshold, this tracks the peak (bankroll or profit) reached since the session started and stops the session if the bankroll falls back a set percentage from that peak — locking in a portion of the gains rather than giving them all back.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16, opacity: trailingStop.enabled ? 1 : 0.5 }}>
          <Field label="TRAIL PERCENTAGE (%)" hint="Distance from peak that triggers a stop">
            <NumInput min={1} max={95} step={1} disabled={!trailingStop.enabled} value={trailingStop.pct}
              onChange={(e) => setTS("pct", Math.max(1, Math.min(95, parseFloat(e.target.value) || 0)))} />
          </Field>
          <Field label="TRAIL BASIS">
            <Select disabled={!trailingStop.enabled} value={trailingStop.basis} onChange={(e) => setTS("basis", e.target.value)}>
              <option value="bankroll">Peak bankroll</option>
              <option value="profit">Peak profit</option>
            </Select>
          </Field>
          <Field label="MIN PROFIT TO ACTIVATE ($)" hint="Stop stays disarmed until profit reaches this">
            <NumInput min={0} disabled={!trailingStop.enabled} value={trailingStop.minProfit}
              onChange={(e) => setTS("minProfit", parseFloat(e.target.value) || 0)} />
          </Field>
        </div>
      </Panel>

      <Panel style={{ padding: 20 }}>
        <SectionTitle eyebrow="Your rules — not assumed" title="Bet Progression"
          right={
            <Select style={{ width: 240 }} onChange={(e) => e.target.value && loadTemplate(e.target.value)} value="">
              <option value="">Load a starting template…</option>
              {Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </Select>
          }
        />
        <div style={{ fontSize: 12.5, color: T.dim, marginBottom: 14, lineHeight: 1.5 }}>
          Define your own progression as a set of steps. Each step has a bet size (in units) and tells the engine which step to move to next, depending on whether the hand won, lost, or pushed. Templates are just starting points — edit freely.
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr style={{ color: T.dim, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textTransform: "uppercase", borderBottom: `1px solid ${T.border}` }}>
                <th>Start</th><th>Label</th><th>Units</th><th>$ (at unit size)</th><th>On Win →</th><th>On Loss →</th><th>On Push →</th><th></th>
              </tr>
            </thead>
            <tbody>
              {progression.steps.map((s) => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                  <td>
                    <input type="radio" checked={progression.startStepId === s.id} onChange={() => setP("startStepId", s.id)} />
                  </td>
                  <td><TextInput style={{ width: 110 }} value={s.label} onChange={(e) => updateStep(s.id, { label: e.target.value })} /></td>
                  <td><NumInput style={{ width: 70 }} min={0.1} step={0.5} value={s.units} onChange={(e) => updateStep(s.id, { units: parseFloat(e.target.value) || 0 })} /></td>
                  <td style={{ fontFamily: "'JetBrains Mono', monospace", color: T.dim }}>${(s.units * progression.unitSize).toFixed(0)}</td>
                  <td>
                    <Select style={{ width: 120 }} value={s.onWin} onChange={(e) => updateStep(s.id, { onWin: e.target.value })}>
                      {progression.steps.map((s2) => <option key={s2.id} value={s2.id}>{s2.label}</option>)}
                    </Select>
                  </td>
                  <td>
                    <Select style={{ width: 120 }} value={s.onLoss} onChange={(e) => updateStep(s.id, { onLoss: e.target.value })}>
                      {progression.steps.map((s2) => <option key={s2.id} value={s2.id}>{s2.label}</option>)}
                    </Select>
                  </td>
                  <td>
                    <Select style={{ width: 120 }} value={s.onPush} onChange={(e) => updateStep(s.id, { onPush: e.target.value })}>
                      {progression.steps.map((s2) => <option key={s2.id} value={s2.id}>{s2.label}</option>)}
                    </Select>
                  </td>
                  <td>
                    <button onClick={() => removeStep(s.id)} title="Remove step" style={{ background: "transparent", border: "none", cursor: "pointer", color: T.faint }}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12 }}>
          <Btn onClick={addStep}><Plus size={14} /> Add step</Btn>
        </div>
      </Panel>

      <Panel style={{ padding: 20 }}>
        <SectionTitle eyebrow="Reference" title="Computed House Edge For These Rules" />
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <StatCard label="House edge (flat betting, basic strategy)" value={`${(-baseline.mean * 100).toFixed(3)}%`} color={T.amber}
            sub={`from a ${baseline.trials.toLocaleString()}-hand internal baseline`} />
          <StatCard label="Std dev per hand (flat $1 bet)" value={`$${baseline.std.toFixed(3)}`} />
          <div style={{ fontSize: 12.5, color: T.dim, maxWidth: 420, lineHeight: 1.5 }}>
            This is computed live from your current rule configuration — not looked up from a fixed table — so it's the correct reference no matter what deck count or dealer rule you pick. It's recalculated automatically whenever you change a rule above.
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* =========================================================================
   SIMULATE TAB
   ========================================================================= */
function SimulateTab({ simRecords, simBankroll, simRunning, currentStepLabel, runSimulation, resetSimSession, startBankroll, simLastRun, baseline, trailingStop, simPeak }) {
  const [numHands, setNumHands] = useState(1000);
  const stats = useMemo(() => computeStats(simRecords, baseline), [simRecords, baseline]);
  const equityData = useMemo(() => (stats ? stats.equity.map((v, i) => ({ i, v })) : []), [stats]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <Panel style={{ padding: 20 }}>
        <SectionTitle eyebrow="Automated" title="Run Simulated Hands" />
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="HANDS TO SIMULATE">
            <NumInput min={1} max={500000} value={numHands} onChange={(e) => setNumHands(parseInt(e.target.value) || 0)} style={{ width: 160 }} />
          </Field>
          <Btn variant="primary" disabled={simRunning || numHands <= 0} onClick={() => runSimulation(numHands)}>
            <Play size={15} /> {simRunning ? "Simulating…" : "Run simulation"}
          </Btn>
          <Btn variant="ghost" onClick={resetSimSession}><RotateCcw size={14} /> Reset session</Btn>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 11, color: T.dim, fontFamily: "'JetBrains Mono', monospace" }}>CURRENT STEP</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{currentStepLabel}</div>
          </div>
        </div>
        {simLastRun?.stopped && (
          <div style={{ marginTop: 14, padding: "10px 12px", background: "rgba(242,179,61,0.1)", border: `1px solid rgba(242,179,61,0.3)`, borderRadius: 7, display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <AlertTriangle size={15} color={T.amber} /> Run stopped early: {simLastRun.stopReason}
          </div>
        )}
      </Panel>

      <TrailingStopStatus bankroll={simBankroll} peak={simPeak} trailingStop={trailingStop} />

      {stats ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <StatCard label="Bankroll" value={money(simBankroll)} color={simBankroll >= startBankroll ? T.win : T.loss} />
            <StatCard label="Hands played" value={stats.n.toLocaleString()} />
            <StatCard label="Net profit" value={money(stats.netProfit)} color={stats.netProfit >= 0 ? T.win : T.loss} />
            <StatCard label="Win rate" value={`${(stats.winRate * 100).toFixed(1)}%`} />
            <StatCard label="Profit / 100 hands" value={money(stats.profitPer100)} color={stats.profitPer100 >= 0 ? T.win : T.loss} />
            <StatCard label="Max drawdown" value={money(stats.maxDrawdown)} color={T.loss} />
          </div>
          <Panel style={{ padding: 20 }}>
            <SectionTitle eyebrow="Equity curve" title="Bankroll Over Simulated Hands" />
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={equityData}>
                <defs>
                  <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={T.accent} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={T.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={T.borderSoft} vertical={false} />
                <XAxis dataKey="i" tick={{ fill: T.faint, fontSize: 11 }} stroke={T.border} />
                <YAxis tick={{ fill: T.faint, fontSize: 11 }} stroke={T.border} width={70} tickFormatter={(v) => `$${v}`} />
                <Tooltip contentStyle={{ background: T.panelAlt, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12 }} formatter={(v) => money(v)} labelFormatter={(l) => `Hand ${l}`} />
                <ReferenceLine y={startBankroll} stroke={T.faint} strokeDasharray="4 4" />
                <Area type="monotone" dataKey="v" stroke={T.accent} fill="url(#eqfill)" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 12, color: T.dim, marginTop: 4 }}>Dashed line marks starting bankroll ({money(startBankroll)}).</div>
          </Panel>
        </>
      ) : (
        <Panel style={{ padding: 30, textAlign: "center", color: T.dim }}>No simulated hands yet — run a simulation above.</Panel>
      )}
    </div>
  );
}

/* =========================================================================
   LOG REAL HAND TAB
   ========================================================================= */
const RANK_OPTIONS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const ACTIONS = ["H","S","D","P","R"];
const RESULTS = ["Win","Loss","Push","Blackjack","Surrender"];

function LogRealTab({ settings, realRecords, realBankroll, currentStepLabel, suggestedBet, addRealHand, resetRealSession, blackjackPayout, trailingStop, realPeak }) {
  const [dealerRank, setDealerRank] = useState("10");
  const [c1, setC1] = useState("10");
  const [c2, setC2] = useState("9");
  const [firstAction, setFirstAction] = useState("S");
  const [decisionText, setDecisionText] = useState("Stand");
  const [result, setResult] = useState("Win");
  const [bet, setBet] = useState(suggestedBet || 10);
  const [net, setNet] = useState(suggestedBet || 10);

  useEffect(() => { setBet(suggestedBet); }, [suggestedBet]);
  useEffect(() => { setDecisionText(ACTION_LABEL[firstAction]); }, [firstAction]);

  useEffect(() => {
    let guess;
    if (result === "Win") guess = bet;
    else if (result === "Loss") guess = -bet;
    else if (result === "Push") guess = 0;
    else if (result === "Blackjack") guess = bet * blackjackPayout;
    else if (result === "Surrender") guess = -bet / 2;
    setNet(Math.round(guess * 100) / 100);
  }, [result, bet, blackjackPayout]);

  const recommended = useMemo(() => {
    const cards = [{ rank: c1, suit: "♠" }, { rank: c2, suit: "♥" }];
    const canSplit = c1 === c2;
    return getBasicStrategyAction(cards, dealerRank, { canDouble: true, canSplit, canSurrender: settings.surrenderAllowed, settings });
  }, [c1, c2, dealerRank, settings]);

  const matched = recommended === firstAction;

  function handleAdd() {
    addRealHand({
      bet, dealerUpCard: dealerRank, playerHand: `${c1} ${c2}`,
      decisions: decisionText, dealerFinal: "", result, net, matchedBasicStrategy: matched,
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <Panel style={{ padding: 20 }}>
        <SectionTitle eyebrow="Manual entry" title="Log a Hand From a Real Session"
          right={<Btn variant="ghost" onClick={resetRealSession}><RotateCcw size={14} /> Reset session</Btn>} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
          <Field label="DEALER UP CARD">
            <Select value={dealerRank} onChange={(e) => setDealerRank(e.target.value)}>
              {RANK_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="YOUR CARD 1">
            <Select value={c1} onChange={(e) => setC1(e.target.value)}>{RANK_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
          </Field>
          <Field label="YOUR CARD 2">
            <Select value={c2} onChange={(e) => setC2(e.target.value)}>{RANK_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
          </Field>
          <Field label="FIRST DECISION">
            <Select value={firstAction} onChange={(e) => setFirstAction(e.target.value)}>
              {ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
            </Select>
          </Field>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 12.5, color: T.dim }}>Basic strategy recommends:</div>
          <Badge tone="accent">{ACTION_LABEL[recommended]}</Badge>
          {matched ? (
            <Badge tone="win"><CheckCircle2 size={11} style={{ marginRight: 3, verticalAlign: -1 }} />Matched</Badge>
          ) : (
            <Badge tone="loss"><XCircle size={11} style={{ marginRight: 3, verticalAlign: -1 }} />Deviated</Badge>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginTop: 18 }}>
          <Field label="FULL DECISION LOG" hint="Edit to add follow-up actions, e.g. 'Hit, Hit, Stand'">
            <TextInput value={decisionText} onChange={(e) => setDecisionText(e.target.value)} />
          </Field>
          <Field label="RESULT">
            <Select value={result} onChange={(e) => setResult(e.target.value)}>
              {RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="BET SIZE ($)" hint={`Suggested by progression: $${suggestedBet.toFixed(2)}`}>
            <NumInput value={bet} onChange={(e) => setBet(parseFloat(e.target.value) || 0)} />
          </Field>
          <Field label="NET PROFIT / LOSS ($)" hint="Auto-filled — override for splits/doubles">
            <NumInput value={net} onChange={(e) => setNet(parseFloat(e.target.value) || 0)} />
          </Field>
        </div>

        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 14 }}>
          <Btn variant="primary" onClick={handleAdd}><Plus size={15} /> Add hand to log</Btn>
          <div style={{ fontSize: 12.5, color: T.dim }}>
            Current step: <span style={{ color: T.text, fontFamily: "'JetBrains Mono', monospace" }}>{currentStepLabel}</span>
            {"  ·  "}Bankroll: <span style={{ color: T.text, fontFamily: "'JetBrains Mono', monospace" }}>{money(realBankroll)}</span>
          </div>
        </div>
      </Panel>

      <TrailingStopStatus bankroll={realBankroll} peak={realPeak} trailingStop={trailingStop} />

      <Panel style={{ padding: 20 }}>
        <SectionTitle eyebrow="Most recent" title="Real Hands Logged This Session" />
        {realRecords.length === 0 ? (
          <div style={{ color: T.dim, fontSize: 13, padding: "10px 0" }}>No real hands logged yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr style={{ color: T.dim, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textTransform: "uppercase", borderBottom: `1px solid ${T.border}` }}>
                <th>#</th><th>Dealer</th><th>Hand</th><th>Decision</th><th>Bet</th><th>Result</th><th>Net</th><th>BS</th>
              </tr></thead>
              <tbody>
                {realRecords.slice(-10).reverse().map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                    <td style={{ color: T.faint }}>{realRecords.length - i}</td>
                    <td>{r.dealerUpCard}</td>
                    <td>{r.playerHand}</td>
                    <td style={{ color: T.dim }}>{r.decisions}</td>
                    <td>${r.bet.toFixed(0)}</td>
                    <td><Badge tone={resultTone(r.result)}>{r.result}</Badge></td>
                    <td>{moneyColored(r.net)}</td>
                    <td>{r.matchedBasicStrategy ? <CheckCircle2 size={14} color={T.win} /> : <XCircle size={14} color={T.loss} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* =========================================================================
   HAND LOG TAB
   ========================================================================= */
function HandLogTab({ simRecords, realRecords, allRecords, filter, setFilter, onExport, fileInputRef, onImportFile }) {
  const list = filter === "sim" ? simRecords : filter === "real" ? realRecords : allRecords;
  const shown = list.slice(-300).reverse();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel style={{ padding: 18 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {["all", "sim", "real"].map((f) => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "7px 14px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer",
                background: filter === f ? T.accent : "transparent", color: filter === f ? "#04231D" : T.dim,
                fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 13,
              }}>{f === "all" ? "All" : f === "sim" ? "Simulated" : "Real"}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={() => onExport(filter)}><Download size={14} /> Export CSV</Btn>
            <Btn variant="ghost" onClick={() => fileInputRef.current?.click()}><Upload size={14} /> Import CSV</Btn>
            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={onImportFile} />
          </div>
        </div>
      </Panel>

      <Panel style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto", maxHeight: 620, overflowY: "auto" }}>
          <table>
            <thead style={{ position: "sticky", top: 0, background: T.panel, zIndex: 1 }}>
              <tr style={{ color: T.dim, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textTransform: "uppercase", borderBottom: `1px solid ${T.border}` }}>
                <th>#</th><th>Src</th><th>Dealer</th><th>Hand</th><th>Decisions</th><th>Bet</th><th>Result</th><th>Net</th><th>Start→End</th><th>BS</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                  <td style={{ color: T.faint }}>{list.length - i}</td>
                  <td><Badge tone={r.source === "sim" ? "accent" : "amber"}>{r.source}</Badge></td>
                  <td>{r.dealerUpCard}</td>
                  <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{r.playerHand}</td>
                  <td style={{ color: T.dim, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.decisions}</td>
                  <td>${r.bet.toFixed(0)}</td>
                  <td><Badge tone={resultTone(r.result)}>{r.result}</Badge></td>
                  <td>{moneyColored(r.net)}</td>
                  <td style={{ color: T.faint, fontSize: 11.5 }}>{money(r.startBankroll)} → {money(r.endBankroll)}</td>
                  <td>{r.matchedBasicStrategy ? <CheckCircle2 size={14} color={T.win} /> : <XCircle size={14} color={T.loss} />}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: "center", color: T.dim, padding: 30 }}>No hands logged yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {list.length > 300 && <div style={{ padding: 10, fontSize: 11.5, color: T.faint, textAlign: "center" }}>Showing most recent 300 of {list.length} — full data is included in CSV export.</div>}
      </Panel>
    </div>
  );
}

/* =========================================================================
   ANALYSIS TAB
   ========================================================================= */
function StatsGrid({ stats }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
      <StatCard label="Total hands" value={stats.n.toLocaleString()} />
      <StatCard label="Win rate" value={`${(stats.winRate * 100).toFixed(1)}%`} sub={`${stats.wins}W / ${stats.losses}L / ${stats.pushes}P`} />
      <StatCard label="Net profit" value={money(stats.netProfit)} color={stats.netProfit >= 0 ? T.win : T.loss} />
      <StatCard label="Profit / 100 hands" value={money(stats.profitPer100)} color={stats.profitPer100 >= 0 ? T.win : T.loss} />
      <StatCard label="Std dev / hand" value={money(stats.std)} />
      <StatCard label="Variance / hand" value={stats.variance.toFixed(2)} />
      <StatCard label="Max drawdown" value={money(stats.maxDrawdown)} sub={`${(stats.maxDrawdownPct * 100).toFixed(1)}% of peak`} color={T.loss} />
      <StatCard label="Longest win streak" value={stats.streaks.longestWin} color={T.win} />
      <StatCard label="Longest loss streak" value={stats.streaks.longestLoss} color={T.loss} />
      <StatCard label="Current streak" value={`${stats.streaks.currentStreak} ${stats.streaks.currentType ?? ""}`} />
      <StatCard label="Matched basic strategy" value={`${(stats.matchPct * 100).toFixed(1)}%`} />
      <StatCard label="Total wagered" value={money(stats.totalWagered)} />
    </div>
  );
}

function SignificancePanel({ sig }) {
  if (!sig) return null;
  const verdictColor = sig.significant ? T.amber : T.win;
  return (
    <Panel style={{ padding: 20 }}>
      <SectionTitle eyebrow="Objective test" title="Deviation From Expected Value" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
        <StatCard label="House edge (baseline)" value={`${sig.houseEdgePct.toFixed(3)}%`} />
        <StatCard label="Expected profit" value={money(sig.expectedProfit)} />
        <StatCard label="Actual profit" value={money(sig.netProfit)} color={sig.netProfit >= 0 ? T.win : T.loss} />
        <StatCard label="Difference" value={money(sig.diff)} color={sig.diff >= 0 ? T.win : T.loss} />
        <StatCard label="Z-score" value={sig.z.toFixed(2)} color={verdictColor} />
        <StatCard label="p-value (two-tailed)" value={sig.p < 0.001 ? "<0.001" : sig.p.toFixed(3)} />
      </div>
      <div style={{
        padding: "14px 16px", borderRadius: 8, border: `1px solid ${sig.significant ? "rgba(242,179,61,0.35)" : "rgba(63,191,127,0.3)"}`,
        background: sig.significant ? "rgba(242,179,61,0.08)" : "rgba(63,191,127,0.08)",
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, color: verdictColor, marginBottom: 6 }}>
          {sig.significant ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          {sig.significant
            ? "Result deviates from expected value (|z| ≥ 1.96, p < 0.05)"
            : "Result is not statistically distinguishable from expected value"}
        </div>
        <div style={{ fontSize: 12.5, color: T.dim, lineHeight: 1.55 }}>
          {sig.significant
            ? "This sample's profit differs from what the house edge predicts by more than chance alone would typically produce. That can happen from ordinary variance even with a large sample, from a rule mismatch between this configuration and where the hands were actually played, or simply from a non-representative sample. It is not evidence that bet sizing changes the underlying edge — under standard rules and independent hands, no betting progression can alter expected value per dollar wagered, only the variance and risk of ruin along the way."
            : "The observed profit is within the range ordinary variance would produce under the computed house edge for these rules. This is the expected outcome for any bet progression — changing bet size changes variance and risk of ruin, not the underlying edge per dollar wagered, for a fixed-rule, independent-trial game like blackjack."}
        </div>
      </div>
    </Panel>
  );
}

function OutcomeHistogram({ records }) {
  const buckets = useMemo(() => {
    const map = new Map();
    for (const r of records) {
      const key = Math.round(r.net / Math.max(1, r.bet || 1) * 2) / 2; // in bet-units, rounded to 0.5
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ bucket: `${k > 0 ? "+" : ""}${k}x`, count: v, k }));
  }, [records]);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={buckets}>
        <CartesianGrid stroke={T.borderSoft} vertical={false} />
        <XAxis dataKey="bucket" tick={{ fill: T.faint, fontSize: 10.5 }} stroke={T.border} />
        <YAxis tick={{ fill: T.faint, fontSize: 11 }} stroke={T.border} width={40} />
        <Tooltip contentStyle={{ background: T.panelAlt, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12 }} />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {buckets.map((b, i) => <Cell key={i} fill={b.k > 0 ? T.win : b.k < 0 ? T.loss : T.push} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function AnalysisBlock({ title, records, baseline }) {
  const stats = useMemo(() => computeStats(records, baseline), [records, baseline]);
  if (!stats) return <Panel style={{ padding: 30, textAlign: "center", color: T.dim }}>No hands to analyze for {title}.</Panel>;
  const equityData = stats.equity.map((v, i) => ({ i, v }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <StatsGrid stats={stats} />
      <SignificancePanel sig={stats.sig} />
      <Panel style={{ padding: 20 }}>
        <SectionTitle eyebrow="Bankroll" title="Equity Curve" />
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={equityData}>
            <CartesianGrid stroke={T.borderSoft} vertical={false} />
            <XAxis dataKey="i" tick={{ fill: T.faint, fontSize: 11 }} stroke={T.border} />
            <YAxis tick={{ fill: T.faint, fontSize: 11 }} stroke={T.border} width={70} tickFormatter={(v) => `$${v}`} />
            <Tooltip contentStyle={{ background: T.panelAlt, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12 }} formatter={(v) => money(v)} />
            <Line type="monotone" dataKey="v" stroke={T.accent} strokeWidth={1.6} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
      <Panel style={{ padding: 20 }}>
        <SectionTitle eyebrow="Distribution" title="Per-Hand Outcome (in bet units)" />
        <OutcomeHistogram records={records} />
      </Panel>
    </div>
  );
}

function AnalysisTab({ simRecords, realRecords, allRecords, mode, setMode, baseline }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel style={{ padding: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["all", "All hands"], ["sim", "Simulated only"], ["real", "Real only"], ["compare", "Compare Sim vs Real"]].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)} style={{
              padding: "7px 14px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer",
              background: mode === k ? T.accent : "transparent", color: mode === k ? "#04231D" : T.dim,
              fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 13,
            }}>{label}</button>
          ))}
        </div>
      </Panel>

      {mode === "compare" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: T.accent, marginBottom: 10, textTransform: "uppercase" }}>Simulated</div>
            <AnalysisBlock title="simulated hands" records={simRecords} baseline={baseline} />
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: T.amber, marginBottom: 10, textTransform: "uppercase" }}>Real</div>
            <AnalysisBlock title="real hands" records={realRecords} baseline={baseline} />
          </div>
        </div>
      ) : (
        <AnalysisBlock
          title={mode === "sim" ? "simulated hands" : mode === "real" ? "real hands" : "all hands"}
          records={mode === "sim" ? simRecords : mode === "real" ? realRecords : allRecords}
          baseline={baseline}
        />
      )}
    </div>
  );
}

/* =========================================================================
   REPLAY TAB
   ========================================================================= */
function ReplayTab({ replaySource, setReplaySource, list, index, setIndex, playing, setPlaying }) {
  const rec = list[index];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel style={{ padding: 14 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {["all", "sim", "real"].map((f) => (
              <button key={f} onClick={() => setReplaySource(f)} style={{
                padding: "7px 14px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer",
                background: replaySource === f ? T.accent : "transparent", color: replaySource === f ? "#04231D" : T.dim,
                fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 13,
              }}>{f === "all" ? "All" : f === "sim" ? "Simulated" : "Real"}</button>
            ))}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: T.dim }}>
            Hand {list.length ? index + 1 : 0} of {list.length}
          </div>
        </div>
      </Panel>

      {!rec ? (
        <Panel style={{ padding: 40, textAlign: "center", color: T.dim }}>No hands to replay in this filter.</Panel>
      ) : (
        <Panel style={{ padding: 26 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
            <Badge tone={rec.source === "sim" ? "accent" : "amber"}>{rec.source === "sim" ? "Simulated" : "Real"} · {rec.stepLabel || "—"}</Badge>
            <Badge tone={resultTone(rec.result)}>{rec.result}</Badge>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
            <div>
              <div style={{ fontSize: 11, color: T.dim, textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>Dealer</div>
              <CardRow str={rec.dealerFinal ? rec.dealerFinal.split("=")[0] : rec.dealerUpCard} size="md" />
              {rec.dealerFinal && <div style={{ marginTop: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: T.dim }}>{rec.dealerFinal}</div>}
            </div>
            <div>
              <div style={{ fontSize: 11, color: T.dim, textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>Player</div>
              <CardRow str={rec.playerHand} size="md" />
            </div>
          </div>

          <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <StatCard label="Bet" value={`$${rec.bet.toFixed(0)}`} />
            <StatCard label="Net" value={money(rec.net)} color={rec.net >= 0 ? T.win : T.loss} />
            <StatCard label="Bankroll before" value={money(rec.startBankroll)} />
            <StatCard label="Bankroll after" value={money(rec.endBankroll)} />
            <StatCard label="Matched basic strategy" value={rec.matchedBasicStrategy ? "Yes" : "No"} color={rec.matchedBasicStrategy ? T.win : T.loss} />
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 11, color: T.dim, textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>Decisions</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13.5, color: T.text, background: T.panelAlt, padding: "10px 12px", borderRadius: 7, border: `1px solid ${T.borderSoft}` }}>
              {rec.decisions || "—"}
            </div>
          </div>

          <div style={{ marginTop: 24, display: "flex", gap: 10, alignItems: "center", justifyContent: "center" }}>
            <Btn variant="ghost" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}><ChevronLeft size={16} /></Btn>
            <Btn variant="ghost" onClick={() => setPlaying((p) => !p)}>
              {playing ? <PauseCircle size={16} /> : <PlayCircle size={16} />} {playing ? "Pause" : "Autoplay"}
            </Btn>
            <Btn variant="ghost" onClick={() => setIndex((i) => Math.min(list.length - 1, i + 1))} disabled={index >= list.length - 1}><ChevronRight size={16} /></Btn>
          </div>
          <input type="range" min={0} max={Math.max(0, list.length - 1)} value={index} onChange={(e) => setIndex(parseInt(e.target.value))}
            style={{ width: "100%", marginTop: 14, accentColor: T.accent }} />
        </Panel>
      )}
    </div>
  );
}
