/* How strong is a shallow Monte-Carlo Medium?
 *
 * Hard evaluates every legal square with HARD_ROLLOUTS simulated continuations.
 * This script replays that evaluation with a smaller budget to see whether a
 * cheap "medium" rung exists between Easy (no lookahead) and Hard.
 *
 * Run: node tools/medium-alternatives.js [games]
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

// Same evaluation as ai.js chooseHard, with a configurable rollout budget.
function mcPlayer(rollouts) {
  return function (state, cells, value, rng) {
    let best = -Infinity;
    let bestCells = [];
    for (const cell of cells) {
      const sim = PV.cloneState(state);
      PV.placeValue(sim, cell.r, cell.c, value);
      let wins = 0;
      for (let i = 0; i < rollouts; i++) {
        const s = PV.cloneState(sim);
        let guard = 0;
        let won = false;
        while (guard++ < 400) {
          const v = Math.floor(rng() * 100);
          if (v === 0) { s.current = 1 - s.current; continue; }
          const cs = PV.legalCells(s, v);
          if (cs.length === 0) { won = s.current !== state.current; break; }
          let bf = Infinity;
          let bc = [];
          for (const c2 of cs) {
            const s3 = PV.cloneState(s);
            PV.placeValue(s3, c2.r, c2.c, v);
            const f = PV.flexibility(s3);
            if (f < bf) { bf = f; bc = [c2]; } else if (f === bf) bc.push(c2);
          }
          const pick = bc[Math.floor(rng() * bc.length)];
          const res = PV.placeValue(s, pick.r, pick.c, v);
          if (res.full) { won = s.current === state.current; break; }
        }
        if (won) wins++;
      }
      const score = wins / rollouts + PV.flexibility(sim) * 1e-4;
      if (score > best) { best = score; bestCells = [cell]; }
      else if (score === best) bestCells.push(cell);
    }
    return bestCells[Math.floor(rng() * bestCells.length)];
  };
}

function play(seed, policyA, policyB) {
  const rng = mulberry32(seed);
  const s = PV.createGame({ size: 'standard', rng: rng, targetWins: 3 });
  let guard = 0;
  while (s.phase !== 'matchover' && guard++ < 20000) {
    if (s.phase === 'roundover') { PV.nextRound(s); continue; }
    PV.roll(s);
    if (s.roll.skipped) continue;
    const cells = PV.legalCells(s, s.roll.value);
    if (cells.length === 0) { PV.loseRound(s); continue; }
    const pick = s.current === 0
      ? policyA(s, cells, s.roll.value, rng)
      : policyB(s, cells, s.roll.value, rng);
    PV.place(s, pick.r, pick.c);
  }
  return s.matchWinner;
}

function main() {
  const games = Number(process.argv[2] || 200);
  const easy = (s, cells, v, rng) => cells[Math.floor(rng() * cells.length)];
  const hard = (s, cells, v) => AI.choose(s, 'hard', cells);
  const medium = (s, cells, v) => AI.choose(s, 'medium', cells);

  console.log(`standard grid, first player's match win rate over ${games} games\n`);
  console.log('policy      vs easy   vs hard  vs medium');
  const rows = [
    ['easy', easy],
    ['medium (spec)', medium],
    ['mc8', mcPlayer(8)],
    ['mc16', mcPlayer(16)],
    ['mc24', mcPlayer(24)],
    ['hard', hard],
  ];
  for (const [label, fn] of rows) {
    const rates = [easy, hard, medium].map(function (opp) {
      let wins = 0;
      for (let i = 0; i < games; i++) {
        if (play(i * 104729 + 17, fn, opp) === 0) wins++;
      }
      return (100 * wins / games).toFixed(1) + '%';
    });
    console.log(label.padEnd(13), rates[0].padStart(7), rates[1].padStart(8), rates[2].padStart(9));
  }
}

main();
