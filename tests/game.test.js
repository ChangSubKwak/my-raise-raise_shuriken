'use strict';
// Pure-logic tests for index.html. Run: node tests/game.test.js
// No external deps — a tiny assert runner so the project stays single-file + zero-install.

const { loadGame } = require('./harness');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; failures.push(msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg} — expected ${b}, got ${a}`); }
function approx(a, b, msg, eps = 1e-9) { ok(Math.abs(a - b) <= eps, `${msg} — expected ~${b}, got ${a}`); }
function group(name, fn) { fn(); }

const G = loadGame();
const F = G.fns;
const C = G.consts;

// Helper: build a clean state and patch fields, then install it.
function withState(patch) {
  const s = G.defaultState();
  Object.assign(s, patch);
  // ensure grid array sized to default
  G.setState(s);
  return s;
}

group('levelName / levelTier', () => {
  eq(F.levelName(1), '나무 표창', 'Lv1 name');
  eq(F.levelName(60), '무한(無限)', 'Lv60 name');
  eq(F.levelName(61), '초월(超越)', 'Lv61 transcend name');
  eq(F.levelName(80), '전설(傳說)', 'Lv80 transcend name');
  eq(F.levelName(81), '초월계 81창', 'Lv81 fallback name');
  eq(F.levelName(0), '미상', 'Lv0 name');
  eq(F.levelTier(2).id, 'wood', 'tier wood');
  eq(F.levelTier(5).id, 'iron', 'tier iron');
  eq(F.levelTier(13).id, 'mystic', 'tier mystic');
  eq(F.levelTier(99).id, 'mystic', 'tier mystic high');
});

group('transcendence', () => {
  withState({ bestLevel: 50 });
  eq(F.getTranscendence(), 0, 'no transcendence below 60');
  eq(F.getTranscendMul(), 1, 'transcend mul 1x below 60');
  withState({ bestLevel: 60 });
  eq(F.getTranscendence(), 0, 'transcendence 0 at exactly 60');
  withState({ bestLevel: 70 });
  eq(F.getTranscendence(), 10, 'transcendence 10 at Lv70');
  approx(F.getTranscendMul(), 1.2, 'transcend mul +20% at Lv70');
  withState({ bestLevel: 80 });
  eq(F.getTranscendence(), 20, 'transcendence 20 at Lv80');
});

group('damage formula', () => {
  // shurikenDmg(level) = getBaseDmg() * 2^(level-1) * (1 + prestige*0.5) * transcendMul
  withState({ bestLevel: 1, prestigeCount: 0, upgrades: defaultUpgrades() });
  const base = F.getBaseDmg();
  approx(F.shurikenDmg(1), base, 'lv1 dmg == base');
  approx(F.shurikenDmg(2), base * 2, 'lv2 dmg doubles');
  approx(F.shurikenDmg(5), base * 16, 'lv5 dmg 2^4');
  withState({ bestLevel: 1, prestigeCount: 2, upgrades: defaultUpgrades() });
  approx(F.shurikenDmg(1), base * (1 + 2 * 0.5), 'prestige doubles dmg (x2)');
  // transcendence multiplies damage
  withState({ bestLevel: 70, prestigeCount: 0, upgrades: defaultUpgrades() });
  approx(F.shurikenDmg(1), base * 1.2, 'transcendence +20% dmg at Lv70');
});

group('gold multiplier composition', () => {
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades() });
  const g0 = F.getGoldMul();
  ok(g0 > 0, 'gold mul positive');
  withState({ prestigeCount: 1, bestLevel: 1, upgrades: defaultUpgrades() });
  approx(F.getGoldMul(), g0 * 1.5, 'prestige adds +50% gold');
  withState({ prestigeCount: 0, bestLevel: 70, upgrades: defaultUpgrades() });
  approx(F.getGoldMul(), g0 * 1.2, 'transcendence +20% gold');
});

group('exchange rate', () => {
  withState({ prestigeCount: 0 });
  eq(F.getExchangeRate(), 10000, 'base exchange rate');
  withState({ prestigeCount: 3 });
  eq(F.getExchangeRate(), 7000, 'rate drops 1000/prestige');
  withState({ prestigeCount: 50 });
  eq(F.getExchangeRate(), 2000, 'rate floored at 2000');
});

group('daily spin determinism', () => {
  withState({});
  const a = F.spinRewardForToday();
  const b = F.spinRewardForToday();
  eq(a, b, 'spin reward deterministic within a day');
  ok([1, 2, 3, 5, 8, 13].includes(a), `spin reward in valid set (got ${a})`);
});

group('questSeed determinism', () => {
  const s1 = F.questSeed('2026-5-21');
  const s2 = F.questSeed('2026-5-21');
  eq(s1(), s2(), 'same seed → same first value');
  const d1 = F.questSeed('2026-5-21')();
  const d2 = F.questSeed('2026-5-22')();
  ok(d1 !== d2, 'different dates → different values');
});

group('set bonuses (getActiveSets)', () => {
  // trinity: 3+ same level (lv>=5)
  withState({ grid: gridFrom([5, 5, 5, null, null, null]) });
  ok(F.hasSet('trinity'), 'trinity active with 3x Lv5');
  withState({ grid: gridFrom([4, 4, 4, null, null, null]) });
  ok(!F.hasSet('trinity'), 'no trinity below Lv5');
  withState({ grid: gridFrom([5, 5, null, null, null, null]) });
  ok(!F.hasSet('trinity'), 'no trinity with only 2');
  // goldFormation: 2+ golden
  withState({ grid: gridFrom([{ level: 3, golden: true }, { level: 4, golden: true }, null, null, null, null]) });
  ok(F.hasSet('goldFormation'), 'goldFormation with 2 goldens');
  // packed: 90%+ full
  withState({ grid: gridFrom([1, 2, 3, 4, 5, 6]) });
  ok(F.hasSet('packed'), 'packed when grid full');
  withState({ grid: gridFrom([1, 2, 3, null, null, null]) });
  ok(!F.hasSet('packed'), 'not packed at 50%');
  // ascension: 3+ pieces Lv20+
  withState({ grid: gridFrom([20, 21, 22, null, null, null]) });
  ok(F.hasSet('ascension'), 'ascension with 3x Lv20+');
});

group('rainbow set (Q-Leap 101)', () => {
  // all three variant kinds present (on any pieces) → rainbow
  withState({ grid: gridFrom([
    { level: 3, golden: true }, { level: 4, star: true }, { level: 5, dark: true }, null, null, null,
  ]) });
  ok(F.hasSet('rainbow'), 'rainbow active with golden+star+dark');
  withState({ grid: gridFrom([{ level: 3, golden: true }, { level: 4, star: true }, null, null, null, null]) });
  ok(!F.hasSet('rainbow'), 'no rainbow without a dark variant');
  // one piece can carry all three → still counts
  withState({ grid: gridFrom([{ level: 3, golden: true, star: true, dark: true }, null, null, null, null, null]) });
  ok(F.hasSet('rainbow'), 'rainbow from a single tri-variant piece');
});

group('rainbow gold multiplier (Q-Leap 101)', () => {
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades(), grid: gridFrom([null, null, null, null, null, null]) });
  const plain = F.getGoldMul();
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades(),
    grid: gridFrom([{ level: 3, golden: true, star: true, dark: true }, null, null, null, null, null]) });
  approx(F.getGoldMul(), plain * 1.25, 'rainbow adds +25% gold');
});

group('transcend milestones (Q-Leap 102)', () => {
  const s = withState({ bestLevel: 65, gem: 0 }); // transcend 5
  s.stats = s.stats || {};
  F.grantTranscendMilestone();
  eq(G.getState().gem, 30, 'transcend 5 grants 30 gem');
  F.grantTranscendMilestone(); // idempotent
  eq(G.getState().gem, 30, 'transcend 5 milestone is one-shot');
  const s2 = withState({ bestLevel: 80, gem: 0 }); // transcend 20
  s2.stats = {};
  F.grantTranscendMilestone();
  eq(G.getState().gem, 300, 'transcend 20 grants 300 gem');
  const s3 = withState({ bestLevel: 63, gem: 0 }); // transcend 3, no milestone
  s3.stats = {};
  F.grantTranscendMilestone();
  eq(G.getState().gem, 0, 'no milestone between thresholds');
});

group('gold rush multiplier (Q-Leap 104)', () => {
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades(), goldRushTimer: 0, grid: gridFrom([null, null, null, null, null, null]) });
  const plain = F.getGoldMul();
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades(), goldRushTimer: 10, grid: gridFrom([null, null, null, null, null, null]) });
  approx(F.getGoldMul(), plain * 2, 'gold rush doubles gold while active');
});

group('elite formation set (Q-Leap 105)', () => {
  // bestLevel 10 → threshold 7; 5 pieces all >=7 → elite
  withState({ bestLevel: 10, grid: gridFrom([7, 8, 9, 10, 7, 8]) });
  ok(F.hasSet('elite'), 'elite with 5+ pieces all >= bestLevel-3');
  // one piece below threshold → no elite
  withState({ bestLevel: 10, grid: gridFrom([7, 8, 9, 10, 3, 8]) });
  ok(!F.hasSet('elite'), 'no elite if any piece below threshold');
  // fewer than 5 pieces → no elite
  withState({ bestLevel: 10, grid: gridFrom([8, 9, 10, null, null, null]) });
  ok(!F.hasSet('elite'), 'no elite with under 5 pieces');
  // elite speeds spawn by 10%
  withState({ bestLevel: 10, upgrades: defaultUpgrades(), grid: gridFrom([8, 8, 8, 8, 8, 8]) });
  const eliteInt = F.getSpawnInterval();
  withState({ bestLevel: 10, upgrades: defaultUpgrades(), grid: gridFrom([8, 8, 8, null, null, null]) });
  const plainInt = F.getSpawnInterval();
  approx(eliteInt, plainInt * 0.9, 'elite cuts spawn interval 10%', 1e-6);
});

group('center cell (Q-Leap 107)', () => {
  // default grid size 6 → 3 cols, 2 rows → center = floor(2/2)*3 + floor(3/2) = 3+1 = 4
  withState({ upgrades: defaultUpgrades() });
  eq(F.getCenterIndex(), 4, 'center index for 6-cell grid');
  // center occupant earns +25%: two identical pieces, one centered vs not
  withState({ upgrades: defaultUpgrades(), prestigeCount: 0, bestLevel: 1,
    grid: place(6, { 4: 5 }) });
  const centered = F.getPassiveGoldRate();
  withState({ upgrades: defaultUpgrades(), prestigeCount: 0, bestLevel: 1,
    grid: place(6, { 0: 5 }) });
  const offCenter = F.getPassiveGoldRate();
  approx(centered, offCenter * 1.25, 'center cell gives +25% gold weight', 1e-6);
});

group('piece DPS share (Q-Leap 108)', () => {
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades(),
    grid: gridFrom([1, 1, null, null, null, null]) });
  approx(F.getPieceDpsShare(0), 0.5, 'two equal pieces → 50% each');
  // Lv2 deals 2x Lv1 → share 2/3 vs 1/3
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades(),
    grid: gridFrom([2, 1, null, null, null, null]) });
  approx(F.getPieceDpsShare(0), 2 / 3, 'Lv2 contributes 2/3 of DPS', 1e-9);
  eq(F.getPieceDpsShare(2), 0, 'empty cell contributes 0');
});

group('perfect formation (Q-Leap 109)', () => {
  // need trinity (3x same Lv>=5), packed (90%+ full), ascension (3x Lv20+), elite (5+ all >= best-3)
  // bestLevel 22 → elite threshold 19. Fill all 6 cells with Lv 20,20,20,21,22,20:
  //   trinity: 20 appears 4x (>=3, >=5) ✓; ascension: all >=20 (>=3) ✓; elite: all >=19, count 6 ✓;
  //   packed: 6/6 full ✓
  withState({ bestLevel: 22, grid: gridFrom([20, 20, 20, 21, 22, 20]) });
  const sets = F.getActiveSets();
  ok(sets.trinity && sets.packed && sets.ascension && sets.elite, 'all 4 core sets active');
  ok(sets.perfect, 'perfect formation active when 4 core sets present');
  // remove one to break packed → no perfect
  withState({ bestLevel: 22, grid: gridFrom([20, 20, 20, 21, 22, null]) });
  ok(!F.getActiveSets().perfect, 'no perfect when not packed');
});

group('perfect gold multiplier (Q-Leap 109)', () => {
  // perfect grants +50% (×1.5) on top of trinity (×1.15). Compare vs a grid with neither.
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades(),
    grid: gridFrom([1, 2, null, null, null, null]) });
  const plain = F.getGoldMul();
  withState({ prestigeCount: 0, bestLevel: 22, upgrades: defaultUpgrades(),
    grid: gridFrom([20, 20, 20, 21, 22, 20]) });
  // transcendence is 0 here (best 22 < 60). trinity ×1.15 × perfect ×1.5
  approx(F.getGoldMul(), plain * 1.15 * 1.5, 'perfect+trinity stack on gold', 1e-6);
});

group('findNextAutoMergePair priority', () => {
  // low priority: lowest level pair first
  withState({ grid: gridFrom([2, 5, 5, 2, null, null]), autoMergePriority: 'low', autoMergeCap: 99 });
  let p = F.findNextAutoMergePair();
  ok(p !== null, 'finds a pair');
  const lv = G.getState().grid[p[0]].level;
  eq(lv, 2, 'low priority picks lowest-level pair (Lv2)');
  // high priority
  withState({ grid: gridFrom([2, 5, 5, 2, null, null]), autoMergePriority: 'high', autoMergeCap: 99 });
  p = F.findNextAutoMergePair();
  eq(G.getState().grid[p[0]].level, 5, 'high priority picks highest-level pair (Lv5)');
  // no pair
  withState({ grid: gridFrom([1, 2, 3, null, null, null]), autoMergePriority: 'low', autoMergeCap: 99 });
  eq(F.findNextAutoMergePair(), null, 'no pair → null');
  // locked excluded
  withState({ grid: gridFrom([{ level: 4, locked: true }, { level: 4 }, null, null, null, null]), autoMergePriority: 'low', autoMergeCap: 99 });
  eq(F.findNextAutoMergePair(), null, 'locked piece not paired');
  // cap excluded
  withState({ grid: gridFrom([8, 8, null, null, null, null]), autoMergePriority: 'low', autoMergeCap: 5 });
  eq(F.findNextAutoMergePair(), null, 'pieces above cap excluded');
  // preserve: variants skipped
  withState({ grid: gridFrom([{ level: 6, golden: true }, { level: 6, golden: true }, null, null, null, null]), autoMergePriority: 'preserve', autoMergeCap: 99 });
  eq(F.findNextAutoMergePair(), null, 'preserve mode skips variant pairs');
});

group('checkLineBonus awards once per line config', () => {
  // 3-col grid, fill row 0 with same level → 1 award, gem increases
  const s = withState({ grid: gridFrom([5, 5, 5, null, null, null]), gem: 0, gold: 0 });
  // grid size 6 => cols 3, rows 2. Row 0 = [5,5,5] full same level.
  s._claimedLines = {};
  F.checkLineBonus();
  const gem1 = G.getState().gem;
  ok(gem1 > 0, `line bonus awarded gem (got ${gem1})`);
  F.checkLineBonus(); // same config → no re-award
  eq(G.getState().gem, gem1, 'line bonus not re-awarded for same config');
});

group('line bonus re-arms after config clears', () => {
  const s = withState({ grid: gridFrom([5, 5, 5, null, null, null]), gem: 0, gold: 0 });
  s._claimedLines = {};
  F.checkLineBonus();
  const gem1 = G.getState().gem;
  // break the line, then re-form a *different* level line → should award again
  const s2 = G.getState();
  s2.grid = gridFrom([6, 6, 6, null, null, null]);
  F.checkLineBonus();
  ok(G.getState().gem > gem1, 'a new line config (Lv6) awards again after Lv5');
});

group('todayString matches dateKey format', () => {
  // todayString is now an alias of dateKey() — both feed daily-reset comparisons.
  const t = F.todayString();
  ok(/^\d{4}-\d{1,2}-\d{1,2}$/.test(t), `todayString format YYYY-M-D (got ${t})`);
});

group('getSpawnInterval modifiers', () => {
  withState({ upgrades: defaultUpgrades(), frenzyTimer: 0, prestigeCount: 0, grid: gridFrom([null,null,null,null,null,null]) });
  const baseInt = F.getSpawnInterval();
  withState({ upgrades: defaultUpgrades(), frenzyTimer: 10, prestigeCount: 0, grid: gridFrom([null,null,null,null,null,null]) });
  const frenzyInt = F.getSpawnInterval();
  approx(frenzyInt, baseInt * 0.5, 'frenzy halves spawn interval', 1e-6);
  ok(baseInt >= 0.4, 'spawn interval respects floor');
});

group('grid size scaling', () => {
  withState({ upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 0 }) });
  eq(F.getGridSize(), 6, 'base grid size 6');
  withState({ upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 3 }) });
  eq(F.getGridSize(), 9, 'grid grows +1/level');
});

// ---- helpers ----
function defaultUpgrades() {
  return { maxShuriken: 0, spawnRate: 0, spawnBatch: 0, firerate: 0, baseDmg: 0, goldMul: 0, spawnLevel: 0, luckChance: 0 };
}
// Build a grid array from a spec list. Numbers → {level}, objects → piece, null → empty.
function gridFrom(spec) {
  let id = 1;
  return spec.map((x) => {
    if (x == null) return null;
    if (typeof x === 'number') return { id: id++, level: x, fireTimer: 0 };
    return Object.assign({ id: id++, fireTimer: 0 }, x);
  });
}
// Build an empty grid of `size` with pieces placed at specific indices: place(6, {4: 5}).
function place(size, map) {
  const g = new Array(size).fill(null);
  let id = 1;
  for (const k of Object.keys(map)) g[+k] = { id: id++, level: map[k], fireTimer: 0 };
  return g;
}

// ---- report ----
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\n  Failures:');
  for (const f of failures) console.log('   ✗ ' + f);
  process.exit(1);
}
console.log('  All green ✓\n');
