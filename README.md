# The Place Value

A two-player strategic number-placement game for the browser. Roll two 10-sided
dice, place the two-digit number on a shared grid, and do not be the player who
cannot place.

* **Play vs AI** — easy / medium / hard.
* **Pass & Play** — two humans, one keyboard.
* **Online Multiplayer** — a host creates a game, shares a 4-character code or
  an invite link, and the opponent joins from any browser. No server required:
  the host's browser is the authority and the two peers talk over a WebRTC data
  channel (PeerJS).

First to **3 round wins** takes the match (configurable).

## How a round works

1. The player whose turn it is rolls a tens die (0–9) and a ones die (0–9).
2. The dice form a two-digit number: `0` + `7` → `07`.
3. `00` **skips the turn** — nothing is placed, no reroll.
4. Otherwise the player places the number in any empty square that keeps the
   board ordered. Legal squares glow green, illegal squares turn red.
5. If the number has **nowhere legal** to go, that player **loses the round**.
6. If the placement fills the **last empty square**, that player **wins the round**.

### Ordering rules

| Mode | Rule |
|---|---|
| **Whole grid** (default) | The board is one snake path, numbered like snakes-and-ladders — the head at the bottom-left corner is pinned to **00**, the path climbs from there reversing direction each row, and the tail is pinned to **100**. Numbers must strictly rise between the two anchors. |
| **Rows only** | Columns are ignored. Every row rises left → right. |
| **Columns only** | Rows are ignored. Every column rises top → bottom. |
| **Rows and columns** | Every row increases left → right and every column increases top → bottom — the board climbs from the top-left corner to the bottom-right. |
| **Sudoku** | Rows, columns *and* the two corner-to-corner diagonals all rise towards the bottom of the board. Needs a square board, so it is only offered at 5×5. |

Board sizes: **Easy 3×5**, **Standard 4×5**, **Hard 5×5**.

Measured round length with random play: on a Standard 4×5 board, **whole grid ≈
4 placements per round**, rows and columns ≈ 8, rows only ≈ 12, columns only ≈ 13;
on the square 5×5 board, sudoku ≈ 9.6 versus rows and columns ≈ 10. Whole grid is
the tight, swingy mode — a high number played early starves every square after it.

On a wide screen the dice sit beside the board; the game log is collapsed under
it and expands on click. Below ~720px the dice move underneath and everything
stacks to full width.

## Play it

<https://ben0551.github.io/the-place-value/>

## AI difficulty

| Level | Behaviour |
|---|---|
| **Easy** | Picks a random legal square. |
| **Medium** | Maximises the board's remaining placement options (leaves gaps open). |
| **Hard** | Monte-Carlo simulation of the dice: for every legal square it plays out dozens of random continuations and keeps the one with the highest round-win rate. |

### A note on the AI ladder (measured, not guessed)

`tools/sim.js`, `tools/policy-experiment.js` and `tests/engine.test.js` play
thousands of AI-vs-AI games. This game is dice-heavy — a round on a Standard
board lasts about 9 placements — so no AI is dominant and the margins are real
but modest.

Win rate for the first player, 200 rows-and-columns matches per row:

| Matchup | Win rate |
|---|---|
| Hard vs Easy | 59% |
| Hard vs Medium | 66% |
| Hard vs a "constrict the board" heuristic | 82% |
| Medium vs Easy | 45% |

Medium is implemented exactly as specified: it maximises the board's remaining
placement options. Measured, that is a *weaker* strategy than picking a legal
square at random. Keeping options open leaves options for the opponent too, and
in this game the player who gets stuck first loses the round — so the strong
line is the one Hard plays.

If you want Medium to be a genuine middle rung, replace `chooseMedium` in
`ai.js` with a shallow Monte-Carlo search (Hard's evaluation with a smaller
rollout budget). Measured, 16 rollouts gives 59% vs Easy and 64% vs the
spec's Medium, which makes the ladder monotonic. It is a small commit whenever
you want it.

Rounds are short: on a Standard board a round lasts about 9 placements, and
ending a round by filling the board is rare (0 of 78 rounds in one sample) but
possible.

## Rule decisions worth knowing

1. **"Whole grid" is a snake, not a lattice.** The original spec described rows
   and columns increasing together; that behaviour is kept as its own mode,
   **Rows and columns**. **Whole grid** is the snakes-and-ladders rule: the board
   is a single boustrophedon path starting at the bottom-left corner, and values
   must strictly increase along it. Because the path is a total order, one early
   high number constrains every square after it.
2. **Direction in the single-axis modes.** The original reading let each row or
   column pick its own direction once it held two numbers, with a lone number
   constraining nothing — measured, those modes filled 13–15 of 20 squares before
   anyone got stuck, i.e. effectively ruleless. Ben chose fixed directions
   instead: rows rise left → right, columns rise top → bottom, the same as
   rows-and-columns.
3. **Vertical direction of rows-and-columns.** The prose says "higher numbers
   must be above lower numbers", but the worked example board
   (`05 15 28 64 91` / `12 23 44 70 95` / `22 40 61 80 99`) has the *smallest*
   numbers at the top. The example is the intent: the board climbs from the
   top-left to the bottom-right, and every other mode uses that same direction
   (rows rise right, columns rise down).
4. **Sudoku diagonals.** Only the two corner-to-corner diagonals count, not every
   diagonal on the board, and each rises towards the bottom of the board. That
   requires a square grid, so sudoku is greyed out unless rows = cols — with the
   current sizes that means the Hard 5×5 board only. (A previous reading added
   every diagonal of both families; measured, that cost ~1 placement per round.)

## Online multiplayer

* The host picks board size, ordering rules and match length, then gets a code
  (e.g. `K7Q2`) and an invite link (`…?join=K7Q2`).
* The guest opens the link (or types the code) and the game starts.
* Both players see the board, whose turn it is, the last roll and the match
  score. The host rolls for both seats, so the guest never needs to roll.
* `?host=CODE` in the URL lets a host refresh the page and reclaim the same code.

Transport is [PeerJS](https://peerjs.com/) (vendored in `vendor/`, no build
step), which brokers the WebRTC connection from its free cloud server. If you
want to self-host the broker instead, run `npx peerjs --port 9000 --path /` and
point `BROKER` at the top of `online.js` to it.

## Development

Plain HTML/CSS/vanilla JS. No build step, no dependencies to install.

```
node tests/engine.test.js          # engine + AI tests
node tools/sim.js 60 standard sudoku hard-easy
node tools/policy-experiment.js 40 standard both
```

| File | Role |
|---|---|
| `index.html` | screens and structure |
| `style.css` | styling |
| `game.js` | pure engine — no DOM, serialisable state |
| `ai.js` | the three computer opponents |
| `online.js` | host/guest WebRTC session |
| `ui.js` | DOM controller and turn flow |
| `vendor/peerjs.min.js` | PeerJS 1.5.4 |

## Licence

MIT — do whatever you like with it.
