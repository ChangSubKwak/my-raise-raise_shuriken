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
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; } },
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
    getGoldMul, getTranscendence, getTranscendMul,
    getActiveSets, hasSet, spinRewardForToday, getExchangeRate,
    levelName, levelTier, weekdayBonus, questSeed, todayString,
    getSpawnInterval, getSpawnStartLevel, getSpawnBatch, getNextSpawnLevel, findNextAutoMergePair,
    checkLineBonus, countStars, getGridSize, getGridCols,
    grantTranscendMilestone, getCenterIndex, getPieceGoldShare, getPassiveGoldRate, pieceGoldWeight,
    dailyMergeRewardFor, getFormationGrade, comboCashout,
    renderPrestige, renderAchievements, renderCodex, renderStats, renderGrid, refreshUI,
    renderShop, renderStorage, renderLog, renderQuests, renderSkillTree, renderUpgrades,
    renderHallOfFame, renderTrophy, updateHUD, refreshQuestBadge, refreshAutoSellUI, renderHelp,
    drawShurikenSprite,
    compactGridArray, sortGridByLevel, getLevelFlavor,
    registerCodex, announceTranscendIfNeeded,
    getNextGoal, getGoldMulBreakdown, sellValue, getPrestigeAdvice, getEnlightenmentGain,
    getMarketLevel, getMarketMul,
    getVariantSpontaneousMul, getPassiveGoldBonus, getMergeGoldBonus, blessedDuration, getSkillLv,
    addFrenzyCharge, hasSet, rollMergeProcs,
    pushGrowthSnapshot, sparkline, validateAndRepairState,
    generateDailyQuests, mondayOfWeek, save, load, doPrestige, fmt, fmtPlaytime,
    daysBetween, dateKey, escAttr, getLevelFlavor,
    getWeeklyProgress, claimWeeklyReward, ensureWeeklyQuest, claimQuestRewards, processAttendance,
    // integration-level (DOM calls are stubbed to no-ops):
    tryMerge, autoMergeStep, emptySlots, spawnShuriken, doExchange, doRitualMerge, sellShuriken, update,
    startTrial, checkTrialProgress, endTrial, creditMerges, grantDailyFirstMerge, checkAchievements,
    getNextAchievementMilestone, getAchievementGem, getNextCodexMilestone, getNextPrestigeMilestone,
    tryVariantFusion, countVariant, countAdjacentSameLevel,
    getStrategyMode, getStrategyGoldMul, getStrategySpawnMul, getStrategyVariantMul,
    isExpeditionUnlocked, expeditionVariantMul, getExpeditionGold, getExpeditionGem,
    canSendExpedition, getExpeditionRemainingSec, startExpedition, claimExpedition, noteLevelReached,
    isTowerUnlocked, getTowerFloorDef, getDeepFloorDef, getActiveTowerFloor, getNextTowerFloor,
    getTowerSpawnMul, getTowerGoldMul, isTowerAutoBanned, isTowerRitualBanned, isTowerSpawnLv1,
    checkTowerProgress, abandonTower,
    getActiveBuffs, processOfflineReward,
    isForgeUnlocked, getForgeMode, getForgeSpawnMul, getForgeLevelDelta, getSpawnIntervalBase, getSpawnIntervalRaw, applyForgeMode,
    getAmbienceParams, startAmbience, stopAmbience, updateAmbience, getAudio,
    getRevealState, applyReveal,
    getUpgradeCost, isUpgradeMaxed, activateFrenzy,
    getPrestigeGoldMul, getNextPrestigeGoldInc, getRunSubstanceFactor,
    getGateDef, checkTierGates, claimGate, showGateModal,
    isEngraveUnlocked, engraveCount, getEngraveCost, getEngraving,
    engraveWealthMul, engraveForgeMul, engraveFortuneBonus, applyEngraving, removeEngraving,
    getConstellationAlloc, getConstellationSpawnMul, getConstellationLuckBonus, getConstellationVariantMul,
    stageConstellationDelta, applyConstellationNext, buildConstellationSection, isConstellationHasteInert,
    isGrainUnlocked, getGrainDef, getNextGrainId, grainPureId, grainChannelMul, resolveMergeGrain, noteGrainPure,
    // 커버리지 공백 메우기: 순수 로직인데 그동안 하네스에 노출되지 않아 단위 테스트가 0개였던 것들.
    // findRitualGroups는 의식 발동과 순/혼 표시가 둘 다 의존하는데 비직사각형 그리드 BFS라
    // CLAUDE.md가 경고한 팬텀 칸(idx >= size) 위험의 정중앙에 있다.
    findRitualGroups, pickRitualGroup, charmPolicyAllows, getCharmPolicyId, getCharmPolicy, isChallenge, levelPoints, getHofRankTitle,
  },
  consts: { FRENZY_MAX, FRENZY_DURATION, TRANSCEND_BASE, DAILY_CHALLENGE_TARGET, SET_DEFS, ACHIEVEMENTS, LEVEL_NAMES, TRANSCEND_NAMES_61_80, EXPEDITION_TIERS, EXPEDITION_UNLOCK_LV, TOWER_FLOORS, TOWER_UNLOCK_PRESTIGE, TOWER_DEEP_PATTERNS, TOWER_MAX_FLOOR, ENGRAVE_RUNES, ENGRAVE_COSTS, ENGRAVE_MAX, ENGRAVE_SWAP_COST, ENGRAVE_UNLOCK_PRESTIGE, CHARM_POLICIES, CHARM_CAP, CHARM_FRONTIER_GAP, COMBO_MULT_CAP, COMBO_MILESTONES, CONSTELLATION_STARS, CONSTELLATION_ALLOC_IDS, GRAINS, GRAIN_PURE_MUL, GRAIN_OFF_MUL, GRAIN_UNLOCK_LV, FORGE_MODES, FORGE_UNLOCK_LV, UPGRADES, SKILLS, TIER_GATES },
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
