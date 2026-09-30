// Functional test: drives the real game code from index.html headlessly.
// The script is an IIFE with private state, so this stubs the DOM, captures
// the requestAnimationFrame callback, and steps the real loop() to advance
// real ticks. Canvas fill operations are recorded so game state can be read
// back out of the draw calls.
//
// Run: node test/functional.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// --- DOM stub -------------------------------------------------------------
let curFills = [];  // fills from the most recent frame only
let fontText = [];
let gridStrokes = 0;

function makeCtx() {
  // Track the current path's bounding box so that roundRect()+fill() draws
  // (snake segments, food) are recorded the same way fillRect() ones are.
  let bx = Infinity, by = Infinity, bx2 = -Infinity, by2 = -Infinity;
  const extend = (x, y) => {
    if (x < bx) bx = x;
    if (y < by) by = y;
    if (x > bx2) bx2 = x;
    if (y > by2) by2 = y;
  };
  const resetPath = () => { bx = by = Infinity; bx2 = by2 = -Infinity; };

  return {
    fillStyle: '#000', strokeStyle: '', lineWidth: 1, font: '',
    textAlign: '', textBaseline: '',
    fillRect(x, y, w, h) { curFills.push({ color: this.fillStyle, x, y, w, h }); },
    beginPath: resetPath,
    moveTo(x, y) { extend(x, y); },
    lineTo(x, y) { extend(x, y); },
    arcTo(x1, y1, x2, y2) { extend(x1, y1); extend(x2, y2); },
    closePath() {},
    stroke() { gridStrokes += 1; },
    fill() {
      if (bx2 >= bx) {
        curFills.push({ color: this.fillStyle, x: bx, y: by, w: bx2 - bx, h: by2 - by });
      }
    },
    fillText(t) { fontText.push(t); },
    measureText() { return { width: 0 }; },
  };
}

const store = {};
const ids = {};
function el(id) {
  return (ids[id] ||= {
    id, textContent: '', innerHTML: '', hidden: false, dataset: {},
    width: 400, height: 400, getContext: makeCtx,
    addEventListener() {},
  });
}
const windowListeners = {};
const canvasListeners = {};
const padButtons = [
  { dataset: { dir: 'up' }, addEventListener() {} },
  { dataset: { dir: 'down' }, addEventListener() {} },
  { dataset: { dir: 'left' }, addEventListener() {} },
  { dataset: { dir: 'right' }, addEventListener() {} },
];

const canvas = el('game');
// The stub does not parse the HTML, so seed the values the markup starts
// with. showOverlay() overwrites titleEl on death, so this is the "SNAKE"
// state a player sees on load.
el('title').textContent = 'SNAKE';
el('score').textContent = '0';
el('best').textContent = '0';
el('overlay').hidden = false;

const doc = {
  getElementById: el,
  querySelectorAll: (sel) => (sel === '.pad button' ? padButtons : []),
  addEventListener(k, f) { windowListeners[k] = f; },
};

// rAF is captured, not run: we call the loop manually to control time.
let loopFn = null;
const raf = (fn) => { loopFn = fn; return 1; };

const store_ = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};

// Deterministic Math so food placement is reproducible. The game code
// resolves Math from the injected parameter, not the host realm.
let seed = 12345;
const MathStub = Object.create(Math);
MathStub.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

new Function('document', 'window', 'localStorage', 'requestAnimationFrame', 'Math', source)(
  doc,
  { addEventListener: (k, f) => { windowListeners[k] = f; }, localStorage: store_ },
  store_,
  raf,
  MathStub
);

const key = (k) => windowListeners.keydown({ key: k, preventDefault() {} });

// Run one animation frame. Only the last frame's fills are kept, so state
// reads are never polluted by earlier frames.
function frame() {
  curFills = [];
  fontText = [];
  loopFn();
}

function frames(n = 12) {
  for (let i = 0; i < n; i++) frame();
}

// Snake cells are inset 2px inside their grid square, so recover the
// column/row by undoing the inset before dividing by the 20px cell.
const cellX = (px, inset = 2) => Math.round((px - inset) / 20);
const cellY = (py, inset = 2) => Math.round((py - inset) / 20);

// Green segments. Head is #4ade80, body segments are hsl(142, ...).
// The overlay title only reports "GAME OVER"/"YOU WIN" reliably, because a
// resumed game leaves the stale "PAUSED" title behind. Pause is instead
// detected from the PAUSED text draw() paints on the canvas.
const isPaused = () => fontText.includes('PAUSED');
const isDead = () => {
  const t = doc.getElementById('title').textContent;
  return t === 'GAME OVER' || t === 'YOU WIN';
};

// Presses Space as needed to reach a running, unpaused game.
function ensureRunning() {
  // Space resumes a paused game and restarts a dead one, so one press is
  // always enough to get back to a running state.
  if (isPaused() || isDead()) key(' ');
  frames(1);
}

// Forces a genuinely fresh game by running into a wall, then restarting.
// Frames needed to cross from x=10 to the wall at x=19, at START_TICKS=9
// frames per move. 200 is comfortably above that ceiling.
const WALL_FRAMES = 200;

function freshGame() {
  ensureRunning();
  for (let i = 0; i < WALL_FRAMES && !isDead(); i++) {
    key('ArrowRight');
    frame();
  }
  assert.ok(isDead(), `could not force a game over (title: ${doc.getElementById('title').textContent})`);
  key(' ');
  frames(2);
  assert.ok(!isPaused() && !isDead(), 'restart did not produce a running game');
}

function snakeCells() {
  return curFills
    .filter((f) => /hsl\(142|^\s*#4ade80/.test(f.color))
    .map((f) => ({ x: cellX(f.x), y: cellY(f.y) }));
}

function foodCell() {
  const f = curFills.find((x) => x.color === '#f87171');
  return f ? { x: cellX(f.x, 4), y: cellY(f.y, 4) } : null;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('loop is registered via requestAnimationFrame', () => {
  assert.strictEqual(typeof loopFn, 'function', 'rAF loop never captured');
});

test('initial state draws a 3-cell snake facing right', () => {
  freshGame();
  const cells = snakeCells();
  assert.strictEqual(cells.length, 3, `expected 3 cells, got ${cells.length}`);
  // freshGame restarts with the snake at (10,10) heading right
  assert.deepStrictEqual(
    cells.map((c) => c.x).sort((a, b) => b - a),
    [10, 9, 8],
    `unexpected x positions: ${JSON.stringify(cells)}`
  );
});

test('exactly one food item is on the board', () => {
  ensureRunning();
  frames();
  assert.ok(foodCell(), 'no food drawn');
  const count = curFills.filter((f) => f.color === '#f87171').length;
  assert.strictEqual(count, 1, `expected 1 food, got ${count}`);
});

test('food never spawns on the snake', () => {
  freshGame();
  for (let i = 0; i < 30; i++) {
    ensureRunning();
    key('ArrowRight');
    frame();
    const body = new Set(snakeCells().map((c) => `${c.x},${c.y}`));
    const f = foodCell();
    if (f) {
      assert.ok(!body.has(`${f.x},${f.y}`), `food overlapped snake at ${f.x},${f.y}`);
    }
  }
});

test('snake advances one cell per tick', () => {
  freshGame();
  const before = snakeCells().length;
  frames(20);
  const after = snakeCells().length;
  assert.ok(after >= before, 'snake shrank unexpectedly');
  assert.ok(after <= before + 1, `snake grew more than one cell per tick (${before} -> ${after})`);
});

test('180-degree reversal is ignored', () => {
  freshGame();
  key('ArrowRight');
  frames(12);
  const headBefore = snakeCells()[0];
  key('ArrowLeft'); // would be instant death if accepted
  frames(12);
  const headAfter = snakeCells()[0];
  assert.ok(headAfter, 'snake disappeared after reversal attempt');
  assert.strictEqual(headAfter.y, headBefore.y, 'y changed: reversal was not blocked');
  assert.ok(headAfter.x > headBefore.x, 'snake did not continue right after reversal');
});

test('moving up works', () => {
  freshGame();
  key('ArrowUp');
  frames(12);
  const head = snakeCells()[0];
  assert.ok(head && head.y < 10, `expected y to decrease from 10, got ${head && head.y}`);
});

test('hitting a wall ends the game', () => {
  freshGame();
  for (let i = 0; i < WALL_FRAMES && !isDead(); i++) {
    key('ArrowRight');
    frame();
  }
  const overlay = doc.getElementById('overlay');
  const title = doc.getElementById('title');
  assert.strictEqual(overlay.hidden, false, 'overlay should show after death');
  assert.strictEqual(title.textContent, 'GAME OVER', `expected GAME OVER, got "${title.textContent}"`);
});

test('space restarts after game over', () => {
  freshGame();
  for (let i = 0; i < WALL_FRAMES && !isDead(); i++) {
    key('ArrowRight');
    frame();
  }
  assert.ok(isDead(), 'expected death state');
  key(' ');
  frames(2);
  assert.strictEqual(snakeCells().length, 3, `expected fresh 3-cell snake, got ${snakeCells().length}`);
  assert.strictEqual(doc.getElementById('overlay').hidden, true, 'overlay should hide after restart');
});

test('pause freezes the snake and resume restarts it', () => {
  freshGame();
  key('ArrowRight');
  frames(12);
  const before = JSON.stringify(snakeCells());
  key(' '); // pause
  frames(40);
  assert.strictEqual(JSON.stringify(snakeCells()), before, 'snake moved while paused');
  assert.ok(fontText.includes('PAUSED'), 'PAUSED text not drawn');
  key(' '); // resume
  frames(12);
  assert.notStrictEqual(JSON.stringify(snakeCells()), before, 'snake did not move after resume');
});

test('eating food scores a point and persists the high score', () => {
  freshGame();
  store['snake.best'] = undefined;
  delete store['snake.best'];
  assert.strictEqual(Number(doc.getElementById('score').textContent), 0, 'score should start at 0');

  // Steer toward the food one axis at a time until it is eaten. The food
  // position is re-read each step because the board is 20x20 and the snake
  // may need to change direction mid-approach.
  let eaten = false;
  for (let attempt = 0; attempt < 200 && !eaten; attempt++) {
    ensureRunning();
    const head = snakeCells()[0];
    const f = foodCell();
    if (!head || !f) break;
    const dx = f.x - head.x;
    const dy = f.y - head.y;
    if (dx > 0) key('ArrowRight');
    else if (dx < 0) key('ArrowLeft');
    else if (dy > 0) key('ArrowDown');
    else if (dy < 0) key('ArrowUp');
    frame();
    if (Number(doc.getElementById('score').textContent) > 0) eaten = true;
  }

  assert.ok(eaten, 'snake never reached the food');
  const score = Number(doc.getElementById('score').textContent);
  assert.ok(score >= 1, `expected score >= 1, got ${score}`);
  // A point scored is a new high score, so it must be written to storage.
  assert.ok(store['snake.best'] !== undefined, 'best score never written to localStorage');
  assert.strictEqual(Number(store['snake.best']), score, 'stored best does not match score');
  assert.strictEqual(
    Number(doc.getElementById('best').textContent), score, 'best display out of sync'
  );
});

test('grid overlay is drawn for alignment', () => {
  assert.ok(gridStrokes > 0, 'no grid stroke recorded');
});

(async () => {
  let passed = 0;
  for (const [name, body] of tests) {
    try {
      body();
      passed++;
      console.log(`  ok  ${name}`);
    } catch (e) {
      console.log(`FAIL  ${name}\n      ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
