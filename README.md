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
| **Whole grid** (default, recommended) | Every row increases left → right, and every column increases top → bottom. |
| **Columns only** | Rows are ignored. Each column must be strictly monotonic — the direction is set by the first two numbers placed in that column, and may differ between columns. |

Board sizes: **Easy 3×5**, **Standard 4×5**, **Hard 5×5**.

## Play it

<https://ben0551.github.io/the-place-value/>

## AI difficulty

| Level | Behaviour |
|---|---|
| **Easy** | Picks a random legal square. |
| **Medium** | Maximises the board's remaining placement options (leaves gaps open). |
| **Hard** | Monte-Carlo simulation of the dice: for every legal square it plays out dozens of random continuations and keeps the one with the highest round-win rate. |

### A note on Medium (measured, not guessed)

`tools/sim.js` and `tools/policy-experiment.js` play thousands of AI-vs-AI games.
In *this* game, hoarding options is a **losing** strategy: the strong line is to
constrict the board so the opponent is the one who gets stuck.

Over 200 simulated standard-grid matches:

| Matchup | Win rate for the first player |
|---|---|
| Hard vs Easy | ~73% |
| Medium vs Easy | ~48% |
| Constrict (minimise options) vs Easy | ~60% |

So Medium plays exactly as specified, but it is deliberately *gentle* — it keeps
the board open and is beatable. If you want Medium to be a real step up from
Easy, change one line in `ai.js` (`chooseMedium`) to score with
`-PV.flexibility(sim)` instead of `PV.flexibility(sim)`. Say the word and it is
a one-line commit.

Rounds are short: on a Standard board a round lasts about 9 placements, and
ending a round by filling the board is rare (0 of 78 rounds in one sample) but
possible.

## Two spec ambiguities, resolved

The written spec contradicts itself in two places. Both are documented here and
are one-line changes if you read them the other way.

1. **Vertical direction.** The prose says "higher numbers must be above lower
   numbers", but the worked example board (`05 15 28 64 91` / `12 23 44 70 95` /
   `22 40 61 80 99`) has the *smallest* numbers at the top. The example was
   followed: rows increase left → right, columns increase top → bottom. The two
   readings are isomorphic (flip the board), so only the display changes — set
   `FLIP_VERTICAL = true` in `game.js` for the prose reading.
2. **Column mode direction.** The example column board
   (`90 12 51` / `80 45 76` / `15 78 99`) contains one *descending* column and
   two ascending ones, so "columns must stay ordered" cannot mean a single fixed
   direction. It is implemented as: each column must be strictly monotonic, and
   each column picks its own direction.

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
node tools/sim.js 60 standard grid hard-easy
node tools/policy-experiment.js 40 standard grid
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
