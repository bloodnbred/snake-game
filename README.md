# Snake

A browser Snake game in a single dependency-free HTML file. Open `index.html` and play.

## Features

- Grid-based movement with smooth canvas rendering
- Arrow keys or `WASD` to steer, `Space` to pause and resume
- Swipe and on-screen D-pad controls on touch devices
- Score and high score, persisted to `localStorage`
- Speed increases every 2 points, up to a cap
- Blocks 180-degree reversals so you cannot kill yourself on a keypress
- Ends on wall or self collision, detects a full-board win

## Run

Just open `index.html` in a browser. No build, no install, no dependencies.

To serve it over HTTP instead:

```
npm start
```

Then open http://localhost:8000.

## Test

```
npm test
```

Two suites, 25 assertions, no test framework required:

- `test/game.test.js` checks structural properties of the source: input
  handlers exist, the reversal guard is present, no external dependencies.
- `test/functional.test.js` actually plays the game. It stubs the DOM and
  canvas, captures the `requestAnimationFrame` callback, and steps the real
  `loop()` to advance real ticks, reading game state back out of the draw
  calls. This catches behavioural bugs the source inspection cannot.

## Controls

| Action | Keys |
| --- | --- |
| Steer | Arrow keys or `W` `A` `S` `D` |
| Start / pause / resume | `Space` |
| Retry | `Space`, click, or tap |

## How it works

State lives in a closure: `snake` is an array of cells ordered head-first, `dir` is the
committed direction and `pendingDir` holds the most recent input. Input only updates
`pendingDir`; the direction is committed once per tick in `step()`. That one-tick delay is
what makes fast keypresses register instead of dropping, and it is why a reversal check
against `dir` is sufficient to prevent self-collision on a single input.

Rendering is decoupled from simulation. `loop()` runs on `requestAnimationFrame` and draws
every frame, while the grid only advances when a tick counter elapses, so movement speed
is independent of display refresh rate.

Food placement collects all unoccupied cells and picks one uniformly at random, which
avoids the bias you get from retrying random coordinates. A `null` return means no free
cells remain, which is a win condition.

The game starts paused behind a start screen, so nothing moves until the player is ready.

## Files

```
index.html          markup, styles, and game logic
serve.js            zero-dependency static file server for local play
test/game.test.js   structural checks
test/functional.test.js  headless behavioural tests
```

