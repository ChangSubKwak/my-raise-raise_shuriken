'use strict';
// Advisory dead-code scanner for index.html. Run: npm run scan
// Two HIGH-PRECISION checks (no false positives observed on this codebase):
//   1) top-level `function name(` definitions with zero other references
//   2) CSS `#id` selectors (rule-starting) with no matching HTML id="" / getElementById('id')
// Dynamic patterns (className string assignment, `'s'+n`, template `t-${type}`) make a
// CSS-*class* check too noisy, so it is intentionally omitted. This script is ADVISORY:
// it prints findings and exits 0 unless --strict is passed.

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
// strip CSS comments so "removed #foo" notes don't read as live selectors
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');

// 1) dead functions
const defs = [...new Set([...script.matchAll(/function ([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]))];
const deadFns = defs.filter((name) => {
  const esc = name.replace(/[$]/g, '\\$');
  const total = (script.match(new RegExp('\\b' + esc + '\\b', 'g')) || []).length;
  const defCount = (script.match(new RegExp('function ' + esc + '\\b', 'g')) || []).length;
  return total - defCount === 0; // referenced only by its own definition
});

// 2) orphaned CSS #id selectors (exclude hex colors; require rule-start context)
const htmlIds = new Set([...html.matchAll(/id="([a-zA-Z][\w-]*)"/g)].map((m) => m[1]));
const jsIds = new Set([...html.matchAll(/getElementById\(['"]([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const cssIdSel = new Set(
  // match "#name" only when it starts/continues a selector (followed by { , : . space-then-{)
  [...style.matchAll(/#([a-zA-Z][\w-]*)(?=[\s.,:{>+~])/g)].map((m) => m[1])
);
const isHex = (s) => /^[0-9a-fA-F]{3,8}$/.test(s);
const deadIds = [...cssIdSel].filter((id) => !isHex(id) && !htmlIds.has(id) && !jsIds.has(id));

console.log('--- dead-code scan ---');
console.log(deadFns.length ? `Dead functions (${deadFns.length}): ${deadFns.join(', ')}` : 'Dead functions: none');
console.log(deadIds.length ? `Orphaned CSS #ids (${deadIds.length}): ${deadIds.join(', ')}` : 'Orphaned CSS #ids: none');

const clean = deadFns.length === 0 && deadIds.length === 0;
console.log(clean ? '\n  clean ✓' : '\n  findings above (advisory)');
if (!clean && process.argv.includes('--strict')) process.exit(1);
