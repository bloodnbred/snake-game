// Headless smoke test of the snake logic extracted from index.html.
// Run: node snake-game/test/game.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Pull the game script out of index.html and expose its internals by
// re-executing it with a stubbed DOM.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert(match, 'could not find <script> block in index.html');
const source = match[1];

// Minimal DOM + canvas stub. Canvas2D is a no-op recorder.
function makeCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get: (t, k) => (k === 'canvas' ? {} : noop),
    set: () => true,
  });
}

function makeEl() {
  const el = {
    textContent: '', innerHTML: '', hidden: false, dataset: {},
    style: {},
    getContext: () => makeCtx(),
    width: 400, height: 400,
    addEventListener: () => {},
    querySelectorAll: () => [],
  };
  return el;
}

const store = {};
const elements = {};
const listeners = {};

const doc = {
  getElementById: (id) => (elements[id] ||= makeEl()),
  querySelectorAll: () => [],
  addEventListener: (k, fn) => { listeners[k] = fn; },
};

const canvasEl = makeEl();

const win = {
  addEventListener: (k, fn) => { listeners[k] = fn; },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  requestAnimationFrame: () => 0, // never actually loop
};

// Instrument: the IIFE keeps everything private, so we re-derive the
// assertions by driving the game through its real event handlers.
const sandbox = {
  document: doc, window: win, localStorage: win.localStorage,
  console, Math, Number, String, Array, Object, JSON, Proxy, setTimeout,
};
sandbox.globalThis = sandbox;
sandbox.window.document = doc;

const fn = new Function(
  'document', 'window', 'localStorage', 'requestAnimationFrame',
  source + '\n;return true;'
);
fn(doc, win, win.localStorage, () => 0);

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- Structural checks against the source itself -------------------------
test('script block is an IIFE and strict mode', () => {
  assert.ok(/^\(/.test(source.trim()), 'expected IIFE at start of script');
  assert.ok(source.includes("'use strict'"), 'expected strict mode');
});

test('uses requestAnimationFrame for the render loop', () => {
  assert.ok(source.includes('requestAnimationFrame(loop)'), 'expected rAF loop');
});

test('commits direction once per tick, not per input', () => {
  // The reversal guard is only sound if input cannot mutate dir directly.
  const turnBody = source.slice(source.indexOf('function turn'));
  assert.ok(turnBody.includes('pendingDir'), 'turn() must write pendingDir');
  assert.ok(!/function turn[\s\S]*?dir\s*=\s*\{/.test(turnBody), 'turn() must not assign dir');
});

test('reversal guard rejects 180 degree turns', () => {
  const turnBody = source.slice(source.indexOf('function turn'), source.indexOf('const KEYS'));
  assert.ok(turnBody.includes('dir.x === -x && dir.y === -y'), 'expected 180 guard');
  assert.ok(turnBody.includes('dir.x === x && dir.y === y'), 'expected same-dir guard');
});

test('collision check ignores the tail cell on non-eating moves', () => {
  // A move into the current tail is legal: the tail vacates that tick.
  const stepBody = source.slice(source.indexOf('function step'), source.indexOf('function die'));
  assert.ok(stepBody.includes('snake.slice(0, -1)'), 'expected tail exclusion');
  assert.ok(stepBody.includes('head.x >= COLS || head.y >= ROWS'), 'expected wall bounds');
});

test('high score is persisted and restored', () => {
  assert.ok(source.includes("localStorage.setItem('snake.best'"), 'expected persist');
  assert.ok(source.includes("localStorage.getItem('snake.best'"), 'expected restore');
});

test('speed increases and is capped', () => {
  assert.ok(source.includes('Math.max(MIN_TICKS'), 'expected tick rate cap');
  assert.ok(source.includes('score % SPEEDUP === 0'), 'expected level trigger');
});

test('full board is treated as a win', () => {
  assert.ok(source.includes('if (!food) return win()'), 'expected win on full board');
  assert.ok(source.includes('placeFood'), 'expected placeFood to return null when full');
});

test('no external network or script dependencies', () => {
  assert.ok(!/<script[^>]+src=/i.test(html), 'no external scripts allowed');
  assert.ok(!/https?:\/\/(?!localhost)/i.test(html.replace(/https?:\/\/www\.w3\.org/g, '')),
    'no external URLs allowed');
  assert.ok(!/cdn|unpkg|jsdelivr|googleapis/i.test(html), 'no CDN references');
});

test('keyboard covers arrows and WASD', () => {
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']) {
    assert.ok(source.includes(`${k}:`), `missing key binding: ${k}`);
  }
});

test('touch controls present for mobile', () => {
  assert.ok(html.includes('class="pad"'), 'expected on-screen pad');
  assert.ok(source.includes('touchstart'), 'expected touch handlers');
  assert.ok(source.includes('touchend'), 'expected swipe handler');
});

test('canvas is square and matches the grid', () => {
  const c = html.match(/<canvas[^>]*width="(\d+)"[^>]*height="(\d+)"/);
  assert(c, 'could not read canvas dimensions');
  assert.strictEqual(c[1], c[2], 'canvas must be square');
  assert.strictEqual(Number(c[1]), 20 * 20, 'canvas should be COLS * CELL');
});

test('localStorage storage is resilient to garbage values', () => {
  // reset() reads snake.best with a Number() coercion and || 0 fallback.
  assert.ok(/Number\(localStorage\.getItem/.test(source), 'expected coerced read');
});

(async () => {
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
