/* The Place Value — pure game engine. No DOM access, no side effects.
 *
 * Row 0 is the TOP row, column 0 is the LEFT column. Ordering rule per mode:
 *   whole   — one snake path over every square, values strictly rising along it
 *   rows    — each row rises left -> right
 *   column  — each column rises top -> bottom
 *   both    — rows rise left -> right AND columns rise top -> bottom
 *   sudoku  — both of those, plus both diagonal families rising downwards
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlaceValue = api;
}(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const MODE_WHOLE = 'whole';   // one snake path through every cell
  const MODE_ROWS = 'rows';     // rows only
  const MODE_COLUMN = 'column'; // columns only
  const MODE_BOTH = 'both';     // rows and columns (top-left is smallest)
  const MODE_SUDOKU = 'sudoku'; // rows, columns and both diagonal families

  const BOARD_SIZES = {
    easy: { rows: 3, cols: 5, label: 'Easy', cells: 15 },
    standard: { rows: 4, cols: 5, label: 'Standard', cells: 20 },
    hard: { rows: 5, cols: 5, label: 'Hard', cells: 25 },
  };

  function formatNumber(value) {
    return String(value).padStart(2, '0');
  }

  function normalizeMode(mode) {
    if (mode === MODE_WHOLE || mode === MODE_ROWS || mode === MODE_COLUMN || mode === MODE_SUDOKU) return mode;
    return MODE_BOTH;
  }

  /* Whole-grid mode: the board is a single snake (boustrophedon) path, numbered
   * like a snakes-and-ladders board — square 1 is the bottom-left corner and the
   * path climbs, alternating direction each row. Values must strictly increase
   * along the path, so the last square is the largest number on the board. */
  function pathFor(state) {
    if (!state._path) {
      const path = [];
      for (let r = state.rows - 1; r >= 0; r--) {
        const cols = [];
        for (let c = 0; c < state.cols; c++) cols.push(c);
        if ((state.rows - 1 - r) % 2 === 1) cols.reverse();
        for (let i = 0; i < cols.length; i++) path.push({ r: r, c: cols[i] });
      }
      const index = [];
      for (let r = 0; r < state.rows; r++) index.push(new Array(state.cols).fill(-1));
      for (let k = 0; k < path.length; k++) index[path[k].r][path[k].c] = k;
      state._path = path;
      state._pathIndex = index;
    }
    return state._path;
  }

  // Squares that can still take a number. Whole-grid mode pins a 0 at the head
  // of the snake and a 100 at its tail, so those two are never playable.
  function placeableCount(state) {
    return state.rows * state.cols - (state.mode === MODE_WHOLE ? 2 : 0);
  }

  function emptyBoard(rows, cols) {
    const board = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(null);
      board.push(row);
    }
    return board;
  }

  function createGame(opts) {
    opts = opts || {};
    const size = BOARD_SIZES[opts.size] || BOARD_SIZES.standard;
    const state = {
      rows: size.rows,
      cols: size.cols,
      size: BOARD_SIZES[opts.size] ? opts.size : 'standard',
      mode: normalizeMode(opts.mode),
      targetWins: opts.targetWins || 3,
      names: [opts.names && opts.names[0] ? opts.names[0] : 'Player 1',
              opts.names && opts.names[1] ? opts.names[1] : 'Player 2'],
      board: emptyBoard(size.rows, size.cols),
      current: 0,
      scores: [0, 0],
      round: 1,
      phase: 'roll', // 'roll' | 'place' | 'roundover' | 'matchover'
      roll: null,
      roundWinner: null,
      matchWinner: null,
      placements: 0,
      log: [],
      rng: opts.rng || Math.random,
    };
    // Anchor the whole-grid snake: 00 at its head, 100 at its tail.
    if (state.mode === MODE_WHOLE) {
      const path = pathFor(state);
      const head = path[0];
      const tail = path[path.length - 1];
      state.board[head.r][head.c] = { value: 0, player: null, seed: 'start' };
      state.board[tail.r][tail.c] = { value: 100, player: null, seed: 'end' };
    }
    return state;
  }

  function pushLog(state, message) {
    state.log.push(message);
    if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
  }

  /* ---------------------------------------------------------------- roll */

  function roll(state) {
    if (state.phase !== 'roll') throw new Error('roll() called outside the roll phase');
    const tens = Math.floor(state.rng() * 10);
    const ones = Math.floor(state.rng() * 10);
    const value = tens * 10 + ones;
    state.roll = { tens: tens, ones: ones, value: value, skipped: value === 0 };
    if (value === 0) {
      pushLog(state, state.names[state.current] + ' rolled 00 - turn skipped.');
      state.current = 1 - state.current;
      return state.roll;
    }
    pushLog(state, state.names[state.current] + ' rolled ' + formatNumber(value) + '.');
    state.phase = 'place';
    return state.roll;
  }

  /* ------------------------------------------------------- ordering rules */

  // Single-axis modes use a fixed direction, the same one as rows-and-columns:
  // rows rise to the right, columns rise downwards. A lone number therefore still
  // constrains its line (everything left of it must be smaller, everything right
  // of it larger) instead of leaving the direction open.

  function rowBounds(state, r, c) {
    let lo = -Infinity;
    let hi = Infinity;
    for (let cc = c - 1; cc >= 0; cc--) {
      if (state.board[r][cc]) { lo = Math.max(lo, state.board[r][cc].value); break; }
    }
    for (let cc = c + 1; cc < state.cols; cc++) {
      if (state.board[r][cc]) { hi = Math.min(hi, state.board[r][cc].value); break; }
    }
    return { lo: lo, hi: hi };
  }

  function columnBounds(state, r, c) {
    let lo = -Infinity;
    let hi = Infinity;
    for (let rr = r - 1; rr >= 0; rr--) {
      if (state.board[rr][c]) { lo = Math.max(lo, state.board[rr][c].value); break; }
    }
    for (let rr = r + 1; rr < state.rows; rr++) {
      if (state.board[rr][c]) { hi = Math.min(hi, state.board[rr][c].value); break; }
    }
    return { lo: lo, hi: hi };
  }

  function mergeBounds(a, b) {
    return { lo: Math.max(a.lo, b.lo), hi: Math.min(a.hi, b.hi) };
  }

  // Exclusive bounds {lo, hi} for an empty cell: lo < value < hi.
  function cellInterval(state, r, c) {
    if (state.board[r][c]) return null;
    if (state.mode === MODE_WHOLE) {
      const path = pathFor(state);
      const idx = state._pathIndex[r][c];
      let lo = -Infinity;
      let hi = Infinity;
      // Bound by the nearest filled square on either side along the path, so an
      // early high number really does starve every later square.
      for (let k = idx - 1; k >= 0; k--) {
        const cell = state.board[path[k].r][path[k].c];
        if (cell) { lo = Math.max(lo, cell.value); break; }
      }
      for (let k = idx + 1; k < path.length; k++) {
        const cell = state.board[path[k].r][path[k].c];
        if (cell) { hi = Math.min(hi, cell.value); break; }
      }
      return { lo: lo, hi: hi };
    }
    if (state.mode === MODE_BOTH || state.mode === MODE_SUDOKU) {
      let bounds = mergeBounds(rowBounds(state, r, c), columnBounds(state, r, c));
      // Sudoku adds only the two corner-to-corner diagonals, and only on a board
      // that actually has them (rows === cols). Both rise towards the bottom.
      if (state.mode === MODE_SUDOKU && state.rows === state.cols) {
        const n = state.rows;
        const walk = function (dr, dc) {
          for (let k = 1; ; k++) {
            const rr = r + dr * k;
            const cc = c + dc * k;
            if (rr < 0 || rr >= n || cc < 0 || cc >= n) break;
            const cell = state.board[rr][cc];
            if (cell) {
              if (dr < 0) bounds = mergeBounds(bounds, { lo: cell.value, hi: Infinity });
              else bounds = mergeBounds(bounds, { lo: -Infinity, hi: cell.value });
              break;
            }
          }
        };
        if (r === c) { walk(-1, -1); walk(1, 1); }         // top-left -> bottom-right
        if (r + c === n - 1) { walk(-1, 1); walk(1, -1); }  // top-right -> bottom-left
      }
      return bounds;
    }
    if (state.mode === MODE_COLUMN) return columnBounds(state, r, c);
    return rowBounds(state, r, c);
  }

  function isLegal(state, r, c, value) {
    if (state.board[r][c]) return false;
    const iv = cellInterval(state, r, c);
    return value > iv.lo && value < iv.hi;
  }

  function legalCells(state, value) {
    const out = [];
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        if (isLegal(state, r, c, value)) out.push({ r: r, c: c });
      }
    }
    return out;
  }

  // 0 = filled, 1 = empty and legal for `value`, 2 = empty and illegal.
  function cellStatus(state, r, c, value) {
    if (state.board[r][c]) return 0;
    return isLegal(state, r, c, value) ? 1 : 2;
  }

  /* ------------------------------------------------------------- placement */

  function placeValue(state, r, c, value) {
    if (!isLegal(state, r, c, value)) return { ok: false };
    state.board[r][c] = { value: value, player: state.current };
    state.placements++;
    pushLog(state, state.names[state.current] + ' placed ' + formatNumber(value)
      + ' at row ' + (r + 1) + ', column ' + (c + 1) + '.');
    state.roll = null;
    if (state.placements === placeableCount(state)) {
      endRound(state, state.current, 'board completely filled');
      return { ok: true, full: true };
    }
    state.current = 1 - state.current;
    state.phase = 'roll';
    return { ok: true, full: false };
  }

  function place(state, r, c) {
    if (state.phase !== 'place') throw new Error('place() called outside the place phase');
    return placeValue(state, r, c, state.roll.value);
  }

  // The current player rolled a number they cannot place anywhere.
  function loseRound(state) {
    const loser = state.current;
    endRound(state, 1 - loser,
      state.names[loser] + ' could not place ' + formatNumber(state.roll.value));
    return state.roundWinner;
  }

  function endRound(state, winner, reason) {
    state.roundWinner = winner;
    state.scores[winner]++;
    state.phase = 'roundover';
    pushLog(state, state.names[winner] + ' wins round ' + state.round
      + ' (' + reason + '). Match score ' + state.scores[0] + '-' + state.scores[1] + '.');
    if (state.scores[winner] >= state.targetWins) {
      state.matchWinner = winner;
      state.phase = 'matchover';
      pushLog(state, state.names[winner] + ' wins the match!');
    }
  }

  function nextRound(state) {
    if (state.phase !== 'roundover') throw new Error('nextRound() called before the round ended');
    state.round++;
    state.board = emptyBoard(state.rows, state.cols);
    state.current = 0;
    state.phase = 'roll';
    state.roll = null;
    state.roundWinner = null;
    state.placements = 0;
    pushLog(state, '--- Round ' + state.round + ' ---');
    return state;
  }

  /* --------------------------------------------------------- AI / analysis */

  // How many empty cells could still accept at least one value (1..99).
  function feasibleCount(state) {
    let count = 0;
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        if (state.board[r][c]) continue;
        const iv = cellInterval(state, r, c);
        const lo = Math.max(iv.lo, 0);
        const hi = Math.min(iv.hi, 100);
        const width = hi - lo - 1;
        if (width > 0) count++;
      }
    }
    return count;
  }

  // Sum of the widths of every empty cell's feasible interval.
  function flexibility(state) {
    let total = 0;
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        if (state.board[r][c]) continue;
        const iv = cellInterval(state, r, c);
        const lo = Math.max(iv.lo, 0);
        const hi = Math.min(iv.hi, 100);
        const width = hi - lo - 1;
        if (width > 0) total += width;
      }
    }
    return total;
  }

  /* ---------------------------------------------------------- serialisation */

  function serialize(state) {
    return {
      rows: state.rows,
      cols: state.cols,
      size: state.size,
      mode: state.mode,
      targetWins: state.targetWins,
      names: state.names.slice(),
      board: state.board.map(function (row) {
        return row.map(function (cell) {
          return cell ? { value: cell.value, player: cell.player, seed: cell.seed || undefined } : null;
        });
      }),
      current: state.current,
      scores: state.scores.slice(),
      round: state.round,
      phase: state.phase,
      roll: state.roll ? { tens: state.roll.tens, ones: state.roll.ones, value: state.roll.value, skipped: !!state.roll.skipped } : null,
      roundWinner: state.roundWinner,
      matchWinner: state.matchWinner,
      placements: state.placements,
      log: state.log.slice(-50),
    };
  }

  function deserialize(data, rng) {
    const size = BOARD_SIZES[data.size] || BOARD_SIZES.standard;
    const state = {
      rows: data.rows || size.rows,
      cols: data.cols || size.cols,
      size: data.size || 'standard',
      mode: normalizeMode(data.mode),
      targetWins: data.targetWins || 3,
      names: (data.names && data.names.length === 2) ? data.names.slice() : ['Player 1', 'Player 2'],
      board: data.board,
      current: data.current || 0,
      scores: data.scores ? data.scores.slice() : [0, 0],
      round: data.round || 1,
      phase: data.phase || 'roll',
      roll: data.roll || null,
      roundWinner: data.roundWinner === undefined ? null : data.roundWinner,
      matchWinner: data.matchWinner === undefined ? null : data.matchWinner,
      placements: data.placements || 0,
      log: data.log ? data.log.slice(-50) : [],
      rng: rng || Math.random,
    };
    return state;
  }

  function cloneState(state) {
    const board = new Array(state.rows);
    for (let r = 0; r < state.rows; r++) {
      const row = new Array(state.cols);
      for (let c = 0; c < state.cols; c++) {
        const cell = state.board[r][c];
        row[c] = cell ? { value: cell.value, player: cell.player, seed: cell.seed || undefined } : null;
      }
      board[r] = row;
    }
    return {
      rows: state.rows,
      cols: state.cols,
      size: state.size,
      mode: state.mode,
      targetWins: state.targetWins,
      names: state.names.slice(),
      board: board,
      current: state.current,
      scores: [state.scores[0], state.scores[1]],
      round: state.round,
      phase: state.phase,
      roll: state.roll ? { tens: state.roll.tens, ones: state.roll.ones, value: state.roll.value, skipped: !!state.roll.skipped } : null,
      roundWinner: state.roundWinner,
      matchWinner: state.matchWinner,
      placements: state.placements,
      log: state.log.slice(),
      rng: state.rng,
    };
  }

  return {
    MODE_WHOLE: MODE_WHOLE,
    MODE_ROWS: MODE_ROWS,
    MODE_COLUMN: MODE_COLUMN,
    MODE_BOTH: MODE_BOTH,
    MODE_SUDOKU: MODE_SUDOKU,
    BOARD_SIZES: BOARD_SIZES,
    formatNumber: formatNumber,
    pathFor: pathFor,
    placeableCount: placeableCount,
    createGame: createGame,
    roll: roll,
    cellInterval: cellInterval,
    isLegal: isLegal,
    legalCells: legalCells,
    cellStatus: cellStatus,
    placeValue: placeValue,
    place: place,
    loseRound: loseRound,
    endRound: endRound,
    nextRound: nextRound,
    feasibleCount: feasibleCount,
    flexibility: flexibility,
    serialize: serialize,
    deserialize: deserialize,
    cloneState: cloneState,
  };
}));
