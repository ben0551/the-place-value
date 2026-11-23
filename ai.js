/* The Place Value — AI opponents. Pure logic, no DOM. */
(function (root, factory) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const PV = isNode ? require('./game.js') : root.PlaceValue;
  const api = factory(PV);
  if (isNode) module.exports = api;
  else root.PlaceValueAI = api;
}(typeof self !== 'undefined' ? self : globalThis, function (PV) {
  'use strict';

  const DIFFICULTIES = { EASY: 'easy', MEDIUM: 'medium', HARD: 'hard' };

  // Monte-Carlo settings for the hard AI. Tuned by tools/sim.js.
  const HARD_ROLLOUTS = 48;
  const ROLLOUT_LIMIT = 400;

  function randomPick(list, rng) {
    return list[Math.floor(rng() * list.length)];
  }

  /* Easy: any legal square. */
  function chooseEasy(state, cells) {
    return randomPick(cells, state.rng);
  }

  /* Medium: leave the board as flexible as possible. */
  function chooseMedium(state, cells) {
    let best = -Infinity;
    let bestCells = [];
    for (let i = 0; i < cells.length; i++) {
      const sim = PV.cloneState(state);
      PV.placeValue(sim, cells[i].r, cells[i].c, state.roll.value);
      const score = PV.flexibility(sim) + PV.feasibleCount(sim) * 0.01;
      if (score > best + 1e-9) {
        best = score;
        bestCells = [cells[i]];
      } else if (Math.abs(score - best) <= 1e-9) {
        bestCells.push(cells[i]);
      }
    }
    return randomPick(bestCells, state.rng);
  }

  /* Policy used inside hard-AI rollouts: keep the most squares feasible. */
  function policyPick(state, cells, value) {
    let best = -Infinity;
    let bestCells = [];
    for (let i = 0; i < cells.length; i++) {
      const sim = PV.cloneState(state);
      PV.placeValue(sim, cells[i].r, cells[i].c, value);
      const score = PV.feasibleCount(sim);
      if (score > best) {
        best = score;
        bestCells = [cells[i]];
      } else if (score === best) {
        bestCells.push(cells[i]);
      }
    }
    return randomPick(bestCells, state.rng);
  }

  // Play a round to completion from `sim`; true if `player` wins the round.
  function rollout(sim, player, rng) {
    for (let guard = 0; guard < ROLLOUT_LIMIT; guard++) {
      const value = Math.floor(rng() * 100);
      if (value === 0) { // 00 skips the turn
        sim.current = 1 - sim.current;
        continue;
      }
      const cells = PV.legalCells(sim, value);
      if (cells.length === 0) return sim.current !== player; // current player is stuck
      const pick = policyPick(sim, cells, value);
      const result = PV.placeValue(sim, pick.r, pick.c, value);
      if (result.full) return sim.current === player;
    }
    return false;
  }

  /* Hard: pick the placement with the highest simulated round-win rate. */
  function chooseHard(state, cells) {
    const rng = state.rng;
    let best = -Infinity;
    let bestCells = [];
    for (let i = 0; i < cells.length; i++) {
      const sim = PV.cloneState(state);
      PV.placeValue(sim, cells[i].r, cells[i].c, state.roll.value);
      let wins = 0;
      for (let n = 0; n < HARD_ROLLOUTS; n++) {
        if (rollout(PV.cloneState(sim), state.current, rng)) wins++;
      }
      const rate = wins / HARD_ROLLOUTS;
      const tiebreak = PV.flexibility(sim) * 1e-4;
      const score = rate + tiebreak;
      if (score > best + 1e-9) {
        best = score;
        bestCells = [cells[i]];
      } else if (Math.abs(score - best) <= 1e-9) {
        bestCells.push(cells[i]);
      }
    }
    return randomPick(bestCells, rng);
  }

  function choose(state, difficulty, cells) {
    if (!cells) cells = PV.legalCells(state, state.roll.value);
    if (cells.length === 0) return null;
    if (difficulty === DIFFICULTIES.EASY) return chooseEasy(state, cells);
    if (difficulty === DIFFICULTIES.HARD) return chooseHard(state, cells);
    return chooseMedium(state, cells);
  }

  return {
    DIFFICULTIES: DIFFICULTIES,
    HARD_ROLLOUTS: HARD_ROLLOUTS,
    choose: choose,
    chooseEasy: chooseEasy,
    chooseMedium: chooseMedium,
    chooseHard: chooseHard,
  };
}));
