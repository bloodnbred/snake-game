// Validates index.html: tag balance, script syntax, and key markup.
const fs = require('fs');
const path = require('path');

const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const voids = new Set(['meta', 'br', 'hr', 'img', 'input', 'link', 'source']);
const stack = [];
const mismatched = [];
const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
let m;
while ((m = re.exec(h))) {
  const [, closing, tag, selfClose] = m;
  const t = tag.toLowerCase();
  if (closing) {
    if (stack.pop() !== t) mismatched.push(m[0]);
  } else if (!selfClose && !voids.has(t)) {
    stack.push(t);
  }
}

const checks = [
  ['no unclosed tags', stack.length === 0, `unclosed: ${stack}`],
  ['no mismatched tags', mismatched.length === 0, `mismatched: ${mismatched}`],
];

try {
  new Function(h.match(/<script>([\s\S]*?)<\/script>/)[1]);
  checks.push(['inline script parses', true, '']);
} catch (e) {
  checks.push(['inline script parses', false, e.message]);
}

checks.push(['viewport meta present', /name="viewport"/.test(h), '']);
checks.push(['canvas element present', /<canvas/.test(h), '']);
checks.push(['charset declared', /charset="utf-8"/.test(h), '']);
checks.push(['doctype is html5', /^<!DOCTYPE html>/i.test(h.trim()), '']);

let failed = 0;
for (const [name, ok, detail] of checks) {
  if (ok) console.log(`  ok  ${name}`);
  else { console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); failed++; }
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
if (failed) process.exitCode = 1;
