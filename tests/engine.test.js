/* Engine + AI tests. Run: node tests/engine.test.js */
'use strict';

const assert = require('assert');
const PV = require('../game.js');
const AI = require('../ai.js');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name: name, err: err });
  }
}

// Deterministic RNG so the roll tests are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// An RNG that hands out a scripted sequence of values, then random.
function scripted(values, seed) {
  const rng = mulberry32(seed || 12345);
  let i = 0;
  return function () {
    if (i < values.length) return values[i++];
    return rng();
  };
}

function fill(state, r, c, value, player) {
  state.board[r][c] = { value: value, player: player || 0 };
  state.placements++;
}

/* ------------------------------------------------------------- board sizes */

test('board sizes match the spec', () => {
  assert.deepStrictEqual(PV.BOARD_SIZES.easy, { rows: 3, cols: 5, label: 'Easy', cells: 15 });
  assert.deepStrictEqual(PV.BOARD_SIZES.standard, { rows: 4, cols: 5, label: 'Standard', cells: 20 });
  assert.deepStrictEqual(PV.BOARD_SIZES.hard, { rows: 5, cols: 5, label: 'Hard', cells: 25 });
});

test('createGame defaults to standard / grid / first to 3', () => {
  const s = PV.createGame({ rng: mulberry32(1) });
  assert.strictEqual(s.rows, 4);
  assert.strictEqual(s.cols, 5);
  assert.strictEqual(s.mode, 'grid');
  assert.strictEqual(s.targetWins, 3);
  assert.strictEqual(s.phase, 'roll');
  assert.deepStrictEqual(s.scores, [0, 0]);
  assert.strictEqual(s.board.flat().filter(Boolean).length, 0);
});

/* ------------------------------------------------------------------ rolling */

test('roll produces a two-digit value and enters the place phase', () => {
  const s = PV.createGame({ rng: scripted([0.0, 0.7]) });
  const r = PV.roll(s);
  assert.strictEqual(r.tens, 0);
  assert.strictEqual(r.ones, 7);
  assert.strictEqual(r.value, 7);
  assert.strictEqual(PV.formatNumber(r.value), '07');
  assert.strictEqual(s.phase, 'place');
});

test('double zero skips the turn and does not require a placement', () => {
  const s = PV.createGame({ rng: scripted([0.0, 0.0, 0.5, 0.5]) });
  const r = PV.roll(s);
  assert.strictEqual(r.value, 0);
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(s.current, 1, 'turn passes to player 2');
  assert.strictEqual(s.phase, 'roll');
  assert.strictEqual(s.placements, 0);
  const r2 = PV.roll(s);
  assert.strictEqual(r2.value, 55);
  assert.strictEqual(s.current, 1);
});

test('roll rejects a second roll before a placement', () => {
  const s = PV.createGame({ rng: mulberry32(2) });
  PV.roll(s);
  assert.throws(() => PV.roll(s), /roll phase/);
});

/* --------------------------------------------------------- whole grid mode */

test('whole grid: rows increase left to right', () => {
  const s = PV.createGame({ rng: mulberry32(3) });
  fill(s, 1, 1, 50);
  assert.strictEqual(PV.isLegal(s, 1, 0, 49), true);
  assert.strictEqual(PV.isLegal(s, 1, 0, 51), false);
  assert.strictEqual(PV.isLegal(s, 1, 2, 51), true);
  assert.strictEqual(PV.isLegal(s, 1, 2, 49), false);
});

test('whole grid: columns increase top to bottom (spec example orientation)', () => {
  const s = PV.createGame({ rng: mulberry32(4) });
  fill(s, 1, 1, 50);
  assert.strictEqual(PV.isLegal(s, 0, 1, 49), true, 'above must be smaller');
  assert.strictEqual(PV.isLegal(s, 0, 1, 51), false);
  assert.strictEqual(PV.isLegal(s, 2, 1, 51), true, 'below must be larger');
  assert.strictEqual(PV.isLegal(s, 2, 1, 49), false);
});

test('the spec example board is legal cell by cell', () => {
  const s = PV.createGame({ rng: mulberry32(5) });
  const rows = [
    [5, 15, 28, 64, 91],
    [12, 23, 44, 70, 95],
    [22, 40, 61, 80, 99],
  ];
  // Build it with the top-left cell first so every later placement is legal.
  const order = [];
  for (let c = 0; c < 5; c++) for (let r = 0; r < 3; r++) order.push([r, c]);
  for (const [r, c] of order) {
    const v = rows[r][c];
    assert.strictEqual(PV.isLegal(s, r, c, v), true, `cell ${r},${c} = ${v}`);
    fill(s, r, c, v);
  }
  assert.strictEqual(s.placements, 15);
});

test('the spec invalid example really is rejected', () => {
  const s = PV.createGame({ rng: mulberry32(6) });
  fill(s, 2, 2, 75);
  fill(s, 2, 3, 60);
  // 75 left of 60 in row 3 breaks the horizontal rule.
  assert.strictEqual(PV.isLegal(s, 2, 2, 75), false);
});

/* ------------------------------------------------------------- column mode */

test('column mode ignores the rows', () => {
  const s = PV.createGame({ mode: 'column', rng: mulberry32(7) });
  fill(s, 0, 0, 10);
  fill(s, 0, 1, 90); // same row, would break a row rule
  assert.strictEqual(PV.isLegal(s, 0, 2, 5), true);
});

test('column mode: a column keeps one direction once two values are down', () => {
  const s = PV.createGame({ mode: 'column', rng: mulberry32(8) });
  fill(s, 0, 0, 90);
  fill(s, 1, 0, 80); // descending
  assert.strictEqual(PV.isLegal(s, 2, 0, 70), true);
  assert.strictEqual(PV.isLegal(s, 2, 0, 85), false, 'must stay below 80');
  assert.strictEqual(PV.isLegal(s, 2, 0, 95), false);
});

test('column mode: a single value leaves the direction open', () => {
  const s = PV.createGame({ mode: 'column', rng: mulberry32(9) });
  fill(s, 0, 0, 90);
  assert.strictEqual(PV.isLegal(s, 1, 0, 10), true);
  assert.strictEqual(PV.isLegal(s, 1, 0, 95), true);
  assert.strictEqual(PV.isLegal(s, 1, 0, 90), false, 'duplicates are not ordered');
});

test('the spec column-mode example board is legal', () => {
  const s = PV.createGame({ mode: 'column', rng: mulberry32(10) });
  const rows = [
    [90, 12, 51],
    [80, 45, 76],
    [15, 78, 99],
  ];
  const order = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) order.push([r, c]);
  for (const [r, c] of order) {
    const v = rows[r][c];
    assert.strictEqual(PV.isLegal(s, r, c, v), true, `cell ${r},${c} = ${v}`);
    fill(s, r, c, v);
  }
});

/* ------------------------------------------------------------ round endings */

test('a roll with no legal square loses the round for the roller', () => {
  const s = PV.createGame({ size: 'easy', rng: scripted([0.9, 0.9]) }); // 99
  // Fill the top row with 98s... simpler: make 99 unplaceable by putting 98 above nothing.
  // On an empty board 99 is always placeable, so wall off every cell: use a nearly
  // full board where only one cell remains and it is boxed in below 99.
  s.board = PV.createGame({ size: 'easy', rng: mulberry32(1) }).board;
  const layout = [
    [10, 20, 30, 40, 50],
    [11, 21, 31, 41, 51],
    [12, 22, 32, 42, null],
  ];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    if (layout[r][c] === null) continue;
    s.board[r][c] = { value: layout[r][c], player: 0 };
  }
  s.placements = 14;
  s.phase = 'roll';
  PV.roll(s); // 99
  assert.strictEqual(s.roll.value, 99);
  assert.strictEqual(PV.legalCells(s, 99).length, 1, 'only the last cell is legal');
  PV.place(s, 2, 4);
  assert.strictEqual(s.phase, 'roundover', 'filling the last cell wins the round');
  assert.strictEqual(s.roundWinner, 0);
  assert.deepStrictEqual(s.scores, [1, 0]);
});

test('losing the round when the dice cannot be placed', () => {
  const s = PV.createGame({ size: 'easy', rng: scripted([0.5, 0.0]) }); // 50
  const layout = [
    [10, 20, 30, 40, 60],
    [11, 21, 31, 41, 61],
    [12, 22, 32, 42, 62],
  ];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    s.board[r][c] = { value: layout[r][c], player: 1 };
  }
  s.placements = 15;
  // Board is full, so clear one cell and make 50 unplaceable there.
  s.board[2][4] = null;
  s.placements = 14;
  s.phase = 'roll';
  s.current = 0;
  PV.roll(s);
  assert.strictEqual(s.roll.value, 50);
  assert.strictEqual(PV.legalCells(s, 50).length, 0);
  PV.loseRound(s);
  assert.strictEqual(s.roundWinner, 1);
  assert.deepStrictEqual(s.scores, [0, 1]);
  assert.strictEqual(s.phase, 'roundover');
});

test('first to 3 round wins takes the match', () => {
  const s = PV.createGame({ rng: mulberry32(11) });
  PV.endRound(s, 0, 'test');
  assert.strictEqual(s.phase, 'roundover');
  PV.nextRound(s);
  PV.endRound(s, 0, 'test');
  PV.nextRound(s);
  assert.strictEqual(s.round, 3);
  PV.endRound(s, 0, 'test');
  assert.strictEqual(s.phase, 'matchover');
  assert.strictEqual(s.matchWinner, 0);
  assert.deepStrictEqual(s.scores, [3, 0]);
});

test('nextRound clears the board but keeps the score', () => {
  const s = PV.createGame({ rng: mulberry32(12) });
  PV.endRound(s, 1, 'test');
  PV.nextRound(s);
  assert.strictEqual(s.round, 2);
  assert.strictEqual(s.phase, 'roll');
  assert.strictEqual(s.current, 0);
  assert.strictEqual(s.placements, 0);
  assert.strictEqual(s.matchWinner, null);
  assert.strictEqual(s.board.flat().filter(Boolean).length, 0);
  assert.deepStrictEqual(s.scores, [0, 1]);
});

/* --------------------------------------------------------- serialisation */

test('serialize/deserialize round-trips without the rng', () => {
  const s = PV.createGame({ rng: mulberry32(13) });
  PV.roll(s);
  PV.placeValue(s, 0, 0, s.roll.value);
  const data = PV.serialize(s);
  assert.strictEqual(data.rng, undefined);
  const copy = PV.deserialize(JSON.parse(JSON.stringify(data)), mulberry32(99));
  assert.deepStrictEqual(copy.board, s.board);
  assert.deepStrictEqual(copy.scores, s.scores);
  assert.strictEqual(copy.phase, s.phase);
  assert.strictEqual(copy.current, s.current);
  assert.strictEqual(copy.placements, s.placements);
});

/* ------------------------------------------------------------------- AI */

test('every difficulty returns a legal square', () => {
  const rng = mulberry32(2024);
  for (let game = 0; game < 12; game++) {
    const s = PV.createGame({
      size: ['easy', 'standard', 'hard'][game % 3],
      mode: game % 2 ? 'column' : 'grid',
      rng: rng,
    });
    for (let turn = 0; turn < 24 && s.phase !== 'matchover'; turn++) {
      if (s.phase === 'roundover') { PV.nextRound(s); continue; }
      if (s.phase !== 'roll') break;
      PV.roll(s);
      if (s.roll.skipped) continue;
      const cells = PV.legalCells(s, s.roll.value);
      if (cells.length === 0) { PV.loseRound(s); continue; }
      for (const difficulty of ['easy', 'medium', 'hard']) {
        const pick = AI.choose(s, difficulty, cells);
        assert.ok(pick, 'AI returned a square');
        assert.strictEqual(PV.isLegal(s, pick.r, pick.c, s.roll.value), true,
          `${difficulty} picked an illegal square`);
      }
      const pick = AI.choose(s, 'medium', cells);
      PV.place(s, pick.r, pick.c);
    }
  }
});

test('AI vs AI always terminates and produces a match winner', () => {
  for (let seed = 0; seed < 8; seed++) {
    const rng = mulberry32(seed * 7919 + 3);
    const s = PV.createGame({ size: 'standard', rng: rng, targetWins: 3 });
    let guard = 0;
    while (s.phase !== 'matchover' && guard++ < 5000) {
      if (s.phase === 'roundover') { PV.nextRound(s); continue; }
      PV.roll(s);
      if (s.roll.skipped) continue;
      const cells = PV.legalCells(s, s.roll.value);
      if (cells.length === 0) { PV.loseRound(s); continue; }
      const pick = AI.choose(s, seed % 2 ? 'hard' : 'medium', cells);
      PV.place(s, pick.r, pick.c);
    }
    assert.strictEqual(s.phase, 'matchover', `seed ${seed} terminated`);
    assert.ok(s.scores[0] === 3 || s.scores[1] === 3, `seed ${seed} reached the target`);
  }
});

test('hard AI beats easy AI over a fixed series of matches', () => {
  // Deterministic regression check: the seeds are fixed, so the result is too.
  // Measured over 200 matches hard wins ~59% (the game is dice-heavy, so the
  // margin over random play is real but modest).
  const games = 48;
  let hardWins = 0;
  for (let seed = 0; seed < games; seed++) {
    const rng = mulberry32(seed * 104729 + 17);
    const s = PV.createGame({ size: 'standard', rng: rng, targetWins: 3 });
    let guard = 0;
    while (s.phase !== 'matchover' && guard++ < 5000) {
      if (s.phase === 'roundover') { PV.nextRound(s); continue; }
      PV.roll(s);
      if (s.roll.skipped) continue;
      const cells = PV.legalCells(s, s.roll.value);
      if (cells.length === 0) { PV.loseRound(s); continue; }
      const difficulty = s.current === 0 ? 'hard' : 'easy';
      const pick = AI.choose(s, difficulty, cells);
      PV.place(s, pick.r, pick.c);
    }
    if (s.matchWinner === 0) hardWins++;
  }
  assert.ok(hardWins >= 20, `hard won only ${hardWins}/${games} on the fixed series`);
});

test('an illegal placement is refused without touching the board', () => {
  const s = PV.createGame({ rng: mulberry32(31) });
  fill(s, 1, 1, 50);
  const before = JSON.stringify(s.board);
  const result = PV.placeValue(s, 1, 0, 90); // 90 > 50 but it sits left of 50
  assert.strictEqual(result.ok, false);
  assert.strictEqual(JSON.stringify(s.board), before);
  assert.strictEqual(s.placements, 1);
});

/* ------------------------------------------------------------------ report */

if (failures.length) {
  for (const f of failures) {
    console.error('FAIL: ' + f.name);
    console.error('  ' + (f.err && f.err.message ? f.err.message : f.err));
  }
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`ok - ${passed} tests passed`);
