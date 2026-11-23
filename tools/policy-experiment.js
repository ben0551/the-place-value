/* Policy playground: pit candidate placement heuristics against each other.
 * Run: node tools/policy-experiment.js [games]
 */
'use strict';

const PV = require('../game.js');
const AI = require('../ai.js');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- candidate policies: (state, cells, value, rng) -> {r, c} ----------------

function randomPick(state, cells, value, rng) {
  return cells[Math.floor(rng() * cells.length)];
}

function scorePick(scoreFn) {
  return function (state, cells, value, rng) {
    let best = -Infinity;
    let bestCells = [];
    for (const cell of cells) {
      state.board[cell.r][cell.c] = { value: value, player: state.current };
      const score = scoreFn(state);
      state.board[cell.r][cell.c] = null;
      if (score > best) { best = score; bestCells = [cell]; }
      else if (score === best) bestCells.push(cell);
    }
    return bestCells[Math.floor(rng() * bestCells.length)];
  };
}

function widthOf(state, r, c) {
  if (state.board[r][c]) return 0;
  const iv = PV.cellInterval(state, r, c);
  const lo = Math.max(iv.lo, 0);
  const hi = Math.min(iv.hi, 100);
  let w = hi - lo - 1;
  if (iv.avoid !== undefined && iv.avoid > lo && iv.avoid < hi) w -= 1;
  return Math.max(0, w);
}

// How many of the 99 placeable values would immediately end the round in our
// favour if the opponent rolled them right now.
function killCount(state) {
  let kills = 0;
  for (let v = 1; v < 100; v++) if (PV.legalCells(state, v).length === 0) kills++;
  return kills;
}

function widths(state) {
  const out = [];
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (!state.board[r][c]) out.push(widthOf(state, r, c));
    }
  }
  return out;
}

const POLICIES = {
  random: randomPick,
  maxFlex: scorePick((s) => PV.flexibility(s)),
  maxCount: scorePick((s) => PV.feasibleCount(s)),
  minFlex: scorePick((s) => -PV.flexibility(s)),
  maxMinWidth: scorePick((s) => Math.min.apply(null, widths(s))),
  maxMedianWidth: scorePick((s) => {
    const w = widths(s).slice().sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  }),
  // Expected number of legal squares for a uniformly rolled future value.
  maxFutureOptions: scorePick((s) => {
    let total = 0;
    for (let v = 1; v < 100; v++) total += PV.legalCells(s, v).length;
    return total / 99;
  }),
  // Leave a home for every possible future number: maximise the worst case.
  maxMinLegal: scorePick((s) => {
    let worst = Infinity;
    for (let v = 1; v < 100; v++) {
      const n = PV.legalCells(s, v).length;
      if (n < worst) worst = n;
    }
    return -worst;
  }),
  // Maximise how many distinct future values still have somewhere to go.
  maxCovered: scorePick((s) => {
    let covered = 0;
    for (let v = 1; v < 100; v++) if (PV.legalCells(s, v).length > 0) covered++;
    return covered;
  }),
  minCount: scorePick((s) => -PV.feasibleCount(s)),
  constrict: scorePick((s) => -PV.flexibility(s)),
  // Spec-flavoured "survivor": how many placements can the board still take?
  maxSurvival: function (state, cells, value, rng) {
    let best = -Infinity;
    let bestCells = [];
    for (const cell of cells) {
      const sim = PV.cloneState(state);
      PV.placeValue(sim, cell.r, cell.c, value);
      let total = 0;
      for (let n = 0; n < 24; n++) total += survival(PV.cloneState(sim), rng);
      const score = total / 24;
      if (score > best) { best = score; bestCells = [cell]; }
      else if (score === best) bestCells.push(cell);
    }
    return bestCells[Math.floor(rng() * bestCells.length)];
  },
  blend1: scorePick((s) => PV.flexibility(s) + 0.5 * killCount(s)),
  blend2: scorePick((s) => PV.flexibility(s) + 1.0 * killCount(s)),
  blend4: scorePick((s) => PV.flexibility(s) + 4.0 * killCount(s)),
  blend10: scorePick((s) => PV.flexibility(s) + 10.0 * killCount(s)),
  hard: function (state, cells, value, rng) {
    return AI.choose(state, 'hard', cells);
  },
  // Leave the tightest squares for later: place on the narrowest legal square.
  narrowest: function (state, cells, value, rng) {
  let best = Infinity;
  let bestCells = [];
  for (const cell of cells) {
    const w = PV.cellInterval(state, cell.r, cell.c);
    const width = Math.max(0, Math.min(w.hi, 100) - Math.max(w.lo, 0) - 1);
    if (width < best) { best = width; bestCells = [cell]; }
    else if (width === best) bestCells.push(cell);
  }
  return bestCells[Math.floor(rng() * bestCells.length)];
  },
};

// How many placements can still be made from this board before someone is stuck?
function survival(state, rng) {
  let count = 0;
  for (let guard = 0; guard < 200; guard++) {
    const value = Math.floor(rng() * 100);
    if (value === 0) { state.current = 1 - state.current; continue; }
    const cells = PV.legalCells(state, value);
    if (cells.length === 0) return count;
    const pick = cells[Math.floor(rng() * cells.length)];
    const result = PV.placeValue(state, pick.r, pick.c, value);
    count++;
    if (result.full) return count;
  }
  return count;
}

function playMatch(rng, policyA, policyB, size, mode) {
  const state = PV.createGame({ size: size, mode: mode, targetWins: 3, rng: rng });
  let guard = 0;
  while (state.phase !== 'matchover' && guard++ < 20000) {
    if (state.phase === 'roundover') { PV.nextRound(state); continue; }
    PV.roll(state);
    if (state.roll.skipped) continue;
    const cells = PV.legalCells(state, state.roll.value);
    if (cells.length === 0) { PV.loseRound(state); continue; }
    const policy = state.current === 0 ? policyA : policyB;
    const pick = policy(state, cells, state.roll.value, rng);
    PV.place(state, pick.r, pick.c);
  }
  return state.matchWinner;
}

function main() {
  const games = Number(process.argv[2] || 40);
  const size = process.argv[3] || 'standard';
  const modeArg = process.argv[4] || 'both';
  const mode = ['whole', 'rows', 'column', 'both'].indexOf(modeArg) !== -1 ? modeArg : 'both';
  const filter = process.argv[5] ? process.argv[5].split(',') : null;
  const allNames = Object.keys(POLICIES);
  const names = filter ? allNames.filter((n) => filter.indexOf(n) !== -1) : allNames;
  if (filter) for (const f of filter) if (names.indexOf(f) === -1) throw new Error('unknown policy ' + f);

  // Round-robin: each policy as P1 against every other policy as P2.
  for (const a of names) {
    let line = a.padEnd(16);
    for (const b of names) {
      if (a === b) { line += '    -   '; continue; }
      let wins = 0;
      for (let g = 0; g < games; g++) {
        const rng = mulberry32(g * 40503 + names.indexOf(a) * 97 + names.indexOf(b));
        if (playMatch(rng, POLICIES[a], POLICIES[b], size, mode) === 0) wins++;
      }
      line += (100 * wins / games).toFixed(0).padStart(5) + '% ';
    }
    console.log(line);
  }
  console.log('\nrows = P1 policy, columns = P2 policy; cell = P1 win rate over ' + games + ' games');
}

main();
