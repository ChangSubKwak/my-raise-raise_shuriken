'use strict';
// Test harness for the single-file game (index.html).
// Extracts the <script> body, stubs the browser environment, and evaluates it
// inside a vm context. Pure game-logic functions (declared with const/let inside
// the script) are captured into a global export object appended to the source,
// since block-scoped bindings do not leak onto the vm context object.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeElementStub() {
  const el = {
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {},
    dataset: {},
    children: [],
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    querySelector() { return makeElementStub(); },
    querySelectorAll() { return makeListStub(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 40, height: 40 }; },
    getContext() { return makeCtxStub(); },
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
    click() {},
    remove() {},
  };
  return el;
}
function makeListStub() {
  const arr = [];
  arr.forEach = Array.prototype.forEach.bind(arr);
  return arr;
}
// A recursive callable stub: every property read and every call returns another
// stub, so deeply-chained Web Audio / canvas calls (osc.frequency.setValueAtTime,
// g.gain.exponentialRampToValueAtTime, ctx.createOscillator().connect(...), etc.)
// never throw. Numeric-ish accessors return sane primitives.
function deepStub() {
  const fn = function () { return deepStub(); };
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === 'currentTime') return 0;
      if (prop === 'state') return 'running';
      if (prop === 'value') return 0;
      if (prop === 'width' || prop === 'height') return 0;
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'then') return undefined; // not a thenable
      return deepStub();
    },
    set() { return true; },
    apply() { return deepStub(); },
  });
}
function makeCtxStub() { return deepStub(); }

function loadGame() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('script block not found');
  let src = m[1];

  // Don't auto-boot (boot() touches timers/DOM heavily and is not needed for
  // pure-logic tests). Remove the final standalone boot() call.
  src = src.replace(/\nboot\(\);\s*$/, '\n/* boot() suppressed for tests */\n');

  // Capture the functions and state accessor we want to test. Appended code runs
  // in the same lexical scope, so it can see const/let-declared bindings.
  src += `
;globalThis.__GAME__ = {
  getState: () => state,
  setState: (s) => { state = s; },
  defaultState,
  fns: {
    getGoldMul, shurikenDmg, getBaseDmg, getTranscendence, getTranscendMul,
    getActiveSets, hasSet, spinRewardForToday, getExchangeRate,
    levelName, levelTier, weekdayBonus, questSeed, todayString,
    getSpawnInterval, getSpawnStartLevel, findNextAutoMergePair,
    checkLineBonus, countStars, getGridSize, getGridCols,
    grantTranscendMilestone, getCenterIndex, getPieceDpsShare, getPassiveGoldRate,
    dailyMergeRewardFor, getFormationGrade, comboCashout,
    compactGridArray, sortGridByLevel, getLevelFlavor,
    registerCodex, announceTranscendIfNeeded,
    getNextGoal, getGoldMulBreakdown,
    // integration-level (DOM calls are stubbed to no-ops):
    tryMerge, autoMergeStep, emptySlots, spawnShuriken, doExchange, doRitualMerge,
  },
  consts: { FRENZY_MAX, FRENZY_DURATION, TRANSCEND_BASE, DAILY_CHALLENGE_TARGET, SET_DEFS, ACHIEVEMENTS, LEVEL_NAMES, TRANSCEND_NAMES_61_80 },
};
`;

  const noop = () => {};
  const timer = () => 0;
  const documentStub = {
    getElementById: () => makeElementStub(),
    querySelector: () => makeElementStub(),
    querySelectorAll: () => makeListStub(),
    createElement: () => makeElementStub(),
    addEventListener: noop,
    removeEventListener: noop,
    body: makeElementStub(),
    documentElement: makeElementStub(),
  };
  const localStorageStub = (() => {
    const store = {};
    return {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k in store) delete store[k]; },
    };
  })();

  const sandbox = {
    document: documentStub,
    localStorage: localStorageStub,
    navigator: { userAgent: 'node-test' },
    performance: { now: () => Date.now() },
    requestAnimationFrame: timer,
    cancelAnimationFrame: noop,
    setInterval: () => 0,
    clearInterval: noop,
    setTimeout: () => 0, // suppress deferred toasts/sfx in tests
    clearTimeout: noop,
    console,
    Math,
    Date,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    Set,
    Map,
    Proxy,
    Reflect,
    Symbol,
    confirm: () => true,
    alert: noop,
    prompt: () => '',
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.AudioContext = function () { return makeCtxStub(); };
  sandbox.window.webkitAudioContext = sandbox.window.AudioContext;

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'index.html:script' });
  return sandbox.__GAME__;
}

module.exports = { loadGame };
