/* Headless AI-vs-AI harness. Run: node tools/sim.js [games] [size] [mode]
 *
 * Prints match win rates, round lengths and per-move timing so the AI
 * difficulty knobs can be tuned against real numbers.
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

function playMatch(rng, opts, difficultyA, difficultyB) {
  const state = PV.createGame({
    size: opts.size,
    mode: opts.mode,
    targetWins: opts.targetWins,
    rng: rng,
  });
  let guard = 0;
  let moves = 0;
  let thinkMs = 0;
  let fullBoards = 0;
  while (state.phase !== 'matchover' && guard++ < 20000) {
    if (state.phase === 'roundover') {
      if (state.placements >= state.rows * state.cols) fullBoards++;
      PV.nextRound(state);
      continue;
    }
    PV.roll(state);
    if (state.roll.skipped) continue;
    const cells = PV.legalCells(state, state.roll.value);
    if (cells.length === 0) { PV.loseRound(state); continue; }
    const difficulty = state.current === 0 ? difficultyA : difficultyB;
    const t0 = Date.now();
    const pick = AI.choose(state, difficulty, cells);
    thinkMs += Date.now() - t0;
    moves++;
    PV.place(state, pick.r, pick.c);
  }
  return {
    winner: state.matchWinner,
    rounds: state.round,
    placements: state.placements,
    moves: moves,
    thinkMs: thinkMs,
    scores: state.scores.slice(),
    fullBoards: fullBoards,
  };
}

function main() {
  const games = Number(process.argv[2] || 20);
  const size = process.argv[3] || 'standard';
  const modeArg = process.argv[4] || 'grid';
  const mode = (modeArg === 'rows' || modeArg === 'column') ? modeArg : 'grid';
  const pair = (process.argv[5] || 'hard-easy').split('-');
  const difficultyA = pair[0];
  const difficultyB = pair[1];

  const opts = { size: size, mode: mode, targetWins: 3 };
  let aWins = 0;
  let bWins = 0;
  let totalMoves = 0;
  let totalThink = 0;
  let totalMs = 0;
  let totalFullBoards = 0;
  let totalRounds = 0;
  const roundLengths = [];

  for (let g = 0; g < games; g++) {
    const rng = mulberry32(g * 2654435761 + 11);
    const t0 = Date.now();
    const result = playMatch(rng, opts, difficultyA, difficultyB);
    totalMs += Date.now() - t0;
    totalMoves += result.moves;
    totalThink += result.thinkMs;
    totalFullBoards += result.fullBoards;
    totalRounds += result.rounds;
    roundLengths.push(result.rounds);
    if (result.winner === 0) aWins++; else bWins++;
  }

  console.log(`size=${size} mode=${mode} ${difficultyA} (P1) vs ${difficultyB} (P2)`);
  console.log(`  games:        ${games}`);
  console.log(`  ${difficultyA} wins:  ${aWins} (${(100 * aWins / games).toFixed(1)}%)`);
  console.log(`  ${difficultyB} wins:  ${bWins} (${(100 * bWins / games).toFixed(1)}%)`);
  console.log(`  rounds/match: ${(roundLengths.reduce((a, b) => a + b, 0) / games).toFixed(2)}`);
  console.log(`  full boards:  ${totalFullBoards}/${totalRounds} rounds ended by filling the board`);
  console.log(`  moves/match:  ${(totalMoves / games).toFixed(1)}`);
  console.log(`  think/move:   ${(totalThink / Math.max(1, totalMoves)).toFixed(1)} ms`);
  console.log(`  wall/match:   ${(totalMs / games).toFixed(0)} ms`);
}

main();
