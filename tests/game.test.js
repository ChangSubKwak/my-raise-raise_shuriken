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

group('daily merge tiers (Q-Leap 110)', () => {
  eq(F.dailyMergeRewardFor(50), 5, '50 merges → 5 gem');
  eq(F.dailyMergeRewardFor(150), 10, '150 → 10');
  eq(F.dailyMergeRewardFor(300), 20, '300 → 20');
  eq(F.dailyMergeRewardFor(600), 40, '600 → 40');
  eq(F.dailyMergeRewardFor(51), 0, 'non-threshold → 0');
  eq(F.dailyMergeRewardFor(0), 0, 'zero → 0');
});

group('formation grade (Q-Leap 111)', () => {
  withState({ bestLevel: 10, grid: gridFrom([null, null, null, null, null, null]) });
  eq(F.getFormationGrade().grade, '—', 'empty grid → no grade');
  withState({ bestLevel: 10, grid: gridFrom([9, 10, 8, null, null, null]) }); // avg 9 / 10 = 0.9 ≥0.8
  eq(F.getFormationGrade().grade, 'S', 'avg 90% of best → S');
  withState({ bestLevel: 10, grid: gridFrom([6, 7, 6, null, null, null]) }); // avg 6.33/10=0.63 ≥0.6
  eq(F.getFormationGrade().grade, 'A', 'avg ~63% → A');
  withState({ bestLevel: 10, grid: gridFrom([4, 5, 4, null, null, null]) }); // avg 4.33/10=0.43 ≥0.4
  eq(F.getFormationGrade().grade, 'B', 'avg ~43% → B');
  withState({ bestLevel: 10, grid: gridFrom([1, 2, 1, null, null, null]) }); // avg 1.33/10=0.13
  eq(F.getFormationGrade().grade, 'C', 'low avg → C');
});

group('combo cashout (Q-Leap 112)', () => {
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades(), grid: gridFrom([null, null, null, null, null, null]) });
  eq(F.comboCashout(9), 0, 'below 10 combo → no cashout');
  const gm = F.getGoldMul();
  approx(F.comboCashout(10), Math.floor(10 * 10 * 5 * gm), 'combo 10 cashout = 100*5*goldMul');
  // higher peak scales quadratically
  ok(F.comboCashout(20) > F.comboCashout(10) * 3, 'cashout scales super-linearly with peak');
});

group('compact grid (Q-Leap 113)', () => {
  // gaps removed, relative order preserved
  const g = gridFrom([5, null, 3, null, 7, null]);
  const out = F.compactGridArray(g);
  eq(out[0].level, 5, 'first piece stays first');
  eq(out[1].level, 3, 'second piece keeps order');
  eq(out[2].level, 7, 'third piece keeps order');
  eq(out[3], null, 'trailing cells null');
  eq(out.length, 6, 'length preserved');
  // already-compact grid unchanged in order
  const g2 = gridFrom([1, 2, 3, null, null, null]);
  const out2 = F.compactGridArray(g2);
  eq(out2.map(c => c && c.level).join(','), '1,2,3,,,', 'compact is stable');
});

group('merge mechanic — integration (tryMerge)', () => {
  // same level → merge into target at level+1, source cleared, combo +1, bestLevel updated
  const s = withState({ grid: gridFrom([3, 3, null, null, null, null]), gold: 0, bestLevel: 3, comboCount: 0,
    upgrades: defaultUpgrades(), prestigeCount: 0 });
  s.stats = s.stats || {};
  // Force deterministic merge (no lucky jump): stub Math.random high so jump stays 1.
  const realRandom = Math.random;
  Math.random = () => 0.999999; // above all jump/divine/drop thresholds
  const res = F.tryMerge(0, 1);
  Math.random = realRandom;
  const st = G.getState();
  eq(res, 'merge', 'same-level returns "merge"');
  eq(st.grid[0], null, 'source cleared after merge');
  ok(st.grid[1] && st.grid[1].level === 4, 'target becomes level+1');
  ok(st.gold > 0, 'merge awards gold');
  eq(st.bestLevel, 4, 'bestLevel updated to 4');
  ok((st.comboCount || 0) >= 1, 'combo incremented');
  ok((st.stats.totalMerges || 0) >= 1, 'totalMerges counted');
});

group('merge mechanic — move to empty', () => {
  withState({ grid: gridFrom([5, null, null, null, null, null]), upgrades: defaultUpgrades() });
  const res = F.tryMerge(0, 2);
  const st = G.getState();
  eq(res, 'move', 'move to empty returns "move"');
  eq(st.grid[0], null, 'source emptied on move');
  ok(st.grid[2] && st.grid[2].level === 5, 'piece relocated to empty target');
});

group('merge mechanic — swap on different level', () => {
  withState({ grid: gridFrom([5, 7, null, null, null, null]), upgrades: defaultUpgrades() });
  const res = F.tryMerge(0, 1);
  const st = G.getState();
  eq(res, 'swap', 'different levels return "swap"');
  eq(st.grid[0].level, 7, 'levels swapped (0)');
  eq(st.grid[1].level, 5, 'levels swapped (1)');
});

group('autoMergeStep integration', () => {
  withState({ grid: gridFrom([4, 4, 2, null, null, null]), autoMergePriority: 'low', autoMergeCap: 99,
    upgrades: defaultUpgrades(), prestigeCount: 0 });
  G.getState().stats = G.getState().stats || {};
  const realRandom = Math.random;
  Math.random = () => 0.999999;
  const did = F.autoMergeStep();
  Math.random = realRandom;
  ok(did === true, 'autoMergeStep performs a merge when a pair exists');
  const levels = G.getState().grid.filter(Boolean).map(c => c.level).sort((a, b) => a - b);
  ok(levels.includes(5), 'a Lv5 exists after merging the Lv4 pair');
});

group('level flavor (Q-Leap 114)', () => {
  ok(F.getLevelFlavor(10).length > 0, 'Lv10 has flavor');
  ok(F.getLevelFlavor(60).length > 0, 'Lv60 has flavor');
  ok(F.getLevelFlavor(61).length > 0, 'Lv61 (transcend) has flavor');
  ok(F.getLevelFlavor(80).length > 0, 'Lv80 has flavor');
  eq(F.getLevelFlavor(11), '', 'non-milestone level has no flavor');
  eq(F.getLevelFlavor(5), '', 'Lv5 no flavor');
});

group('spawn pause when full (QA edge)', () => {
  withState({ grid: gridFrom([1, 2, 3, 4, 5, 6]), upgrades: defaultUpgrades() });
  eq(F.emptySlots().length, 0, 'full grid has 0 empty slots');
  eq(F.spawnShuriken(), false, 'spawnShuriken returns false when full');
  withState({ grid: gridFrom([1, 2, 3, null, null, null]), upgrades: defaultUpgrades() });
  G.getState().stats = G.getState().stats || {};
  ok(F.spawnShuriken() === true, 'spawnShuriken succeeds with empty slots');
});

group('exchange affordability (QA edge)', () => {
  withState({ prestigeCount: 0, gold: 5000, gem: 0 }); // rate 10000, can't afford
  G.getState().stats = G.getState().stats || {};
  F.doExchange(1);
  eq(G.getState().gem, 0, 'no gem gained when gold insufficient');
  eq(G.getState().gold, 5000, 'gold untouched when unaffordable');
  withState({ prestigeCount: 0, gold: 25000, gem: 0 });
  G.getState().stats = G.getState().stats || {};
  F.doExchange(2); // cost 20000
  eq(G.getState().gem, 2, 'gained 2 gem');
  eq(G.getState().gold, 5000, 'gold reduced by 20000');
});

group('getActiveSets on empty grid (QA defensive)', () => {
  withState({ grid: gridFrom([null, null, null, null, null, null]), bestLevel: 1 });
  const sets = F.getActiveSets();
  eq(Object.keys(sets).length, 0, 'empty grid yields no sets');
  eq(F.getFormationGrade().grade, '—', 'empty grid grade is —');
});

group('registerCodex shared helper (Q-Leap 116 refactor)', () => {
  // first reach grants enlightenment; re-reach is a no-op
  withState({ codex: {}, enlightenment: 0, bestLevel: 5 });
  G.getState().stats = G.getState().stats || {};
  F.registerCodex(5);
  const e1 = G.getState().enlightenment;
  ok(e1 >= 1, 'new codex entry grants enlightenment');
  F.registerCodex(5);
  eq(G.getState().enlightenment, e1, 're-registering same level is a no-op');
  // hitting the 10-entry milestone grants gem
  const s = withState({ enlightenment: 0, gem: 0, bestLevel: 60 });
  s.stats = {};
  s.codex = {};
  for (let lv = 1; lv <= 9; lv++) s.codex[lv] = true; // 9 pre-registered
  F.registerCodex(10); // 10th → milestone {gem:10}
  eq(G.getState().gem, 10, 'codex 10-milestone grants 10 gem via shared helper');
});

group('transcend announce helper (Q-Leap 116 refactor)', () => {
  const s = withState({ bestLevel: 65, gem: 0 }); // transcend 5
  s.stats = {};
  // simulate a new record from 64 → 65 (already at 65); use prevBest 60
  F.announceTranscendIfNeeded(65, 60);
  eq(G.getState().gem, 30, 'announce grants the transcend-5 milestone (30 gem)');
  // below transcend base → nothing
  const s2 = withState({ bestLevel: 40, gem: 0 });
  s2.stats = {};
  F.announceTranscendIfNeeded(40, 30);
  eq(G.getState().gem, 0, 'no transcend announce below Lv 60');
});

group('ritual merge now grants codex (Q-Leap 116 bugfix)', () => {
  // 3 connected same-level pieces in a row → ritual merges to a NEW level → codex registers.
  // grid 6 = 3 cols × 2 rows. Row 0 = [5,5,5] are 4-neighbour connected.
  const s = withState({ grid: gridFrom([5, 5, 5, null, null, null]),
    codex: {}, enlightenment: 0, bestLevel: 5, upgrades: defaultUpgrades(), prestigeCount: 0 });
  s.stats = {};
  const before = Object.keys(G.getState().codex).length;
  const realRandom = Math.random;
  Math.random = () => 0.999999;
  F.doRitualMerge();
  Math.random = realRandom;
  const after = Object.keys(G.getState().codex).length;
  ok(after > before, 'ritual merge registered a new codex entry (was silently skipped before)');
  ok(G.getState().enlightenment >= 1, 'ritual merge granted codex enlightenment');
});

group('dark absorb records the true level (Q-Leap 116 bugfix)', () => {
  // 3-col grid. idx0 = dark Lv5, idx1 = Lv5, idx2 = Lv6.
  // Merge idx0→idx1 → Lv6, then dark absorbs the Lv6 neighbour at idx2 → Lv7.
  // Before the fix, bestLevel/codex recorded Lv6, leaving Lv7 unregistered.
  const s = withState({
    grid: gridFrom([{ level: 5, dark: true }, 5, 6, null, null, null]),
    codex: {}, enlightenment: 0, bestLevel: 6, upgrades: defaultUpgrades(), prestigeCount: 0,
  });
  s.stats = {};
  const realRandom = Math.random;
  Math.random = () => 0.999999; // no lucky jump, no spontaneous variant
  F.tryMerge(0, 1);
  Math.random = realRandom;
  const st = G.getState();
  eq(st.grid[1].level, 7, 'dark absorb produced a Lv7 piece');
  eq(st.grid[2], null, 'absorbed neighbour cleared');
  eq(st.bestLevel, 7, 'bestLevel records the absorbed Lv7 (not pre-absorb Lv6)');
  ok(st.codex[7], 'codex registered Lv7 reached via dark absorb');
});

group('next goal indicator (Q-Leap 117)', () => {
  withState({ bestLevel: 1 });
  let g = F.getNextGoal();
  eq(g.kind, 'level', 'early game → level goal');
  eq(g.target, 8, 'first goal is Lv8 prestige unlock');
  withState({ bestLevel: 8 });
  eq(F.getNextGoal().target, 10, 'after 8 → next is 10');
  withState({ bestLevel: 35 });
  eq(F.getNextGoal().target, 40, 'mid game → next milestone 40');
  withState({ bestLevel: 60 });
  g = F.getNextGoal();
  eq(g.kind, 'transcend', 'at 60 → transcend goal');
  eq(g.target, 5, 'first transcend goal is 5');
  withState({ bestLevel: 72 }); // transcend 12
  eq(F.getNextGoal().target, 15, 'transcend 12 → next transcend milestone 15');
  withState({ bestLevel: 80 }); // transcend 20 (max milestone)
  eq(F.getNextGoal().kind, 'endless', 'past all goals → endless');
});

group('gold multiplier breakdown (Q-Leap 118 refactor)', () => {
  // breakdown product must equal getGoldMul exactly (single source of truth)
  withState({ prestigeCount: 2, bestLevel: 70, upgrades: Object.assign(defaultUpgrades(), { goldMul: 3 }),
    grid: gridFrom([20, 20, 20, 21, 22, 20]), goldRushTimer: 5 });
  const product = F.getGoldMulBreakdown().reduce((a, f) => a * f.mul, 1);
  approx(product, F.getGoldMul(), 'breakdown product == getGoldMul', 1e-9);
  // each factor labeled and numeric
  const bd = F.getGoldMulBreakdown();
  eq(bd.length, 10, '10 gold-multiplier sources defined');
  ok(bd.every(f => typeof f.mul === 'number' && f.label), 'every factor has label + numeric mul');
  // prestige factor reflects count
  const pf = bd.find(f => f.key === 'prestige');
  approx(pf.mul, 1 + 2 * 0.5, 'prestige factor = 1 + count*0.5');
});

group('sell value formula (Q-Leap 119 refactor + QA)', () => {
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades(), dailyChallengeId: '' });
  const gm = F.getGoldMul();
  const base = (lv) => Math.floor(Math.pow(2, lv) * gm * 0.5);
  eq(F.sellValue({ level: 5 }), base(5), 'plain sell = 2^lv * goldMul * 0.5');
  eq(F.sellValue({ level: 5, golden: true }), base(5) * 5, 'golden sells 5x');
  eq(F.sellValue({ level: 5, golden: true, star: true, dark: true }), base(5) * 125, 'all variants → 125x');
  eq(F.sellValue({ level: 5, locked: true }), 0, 'locked piece is unsellable');
  eq(F.sellValue(null), 0, 'null → 0');
});

group('prestige gain formula (QA)', () => {
  withState({ bestLevel: 7 });
  eq(F.getPrestigeGain(), 0, 'below Lv8 → 0 prestige gain');
  withState({ bestLevel: 8 });
  eq(F.getPrestigeGain(), 1, 'Lv8 → floor(1^1.3) = 1');
  withState({ bestLevel: 17 });
  eq(F.getPrestigeGain(), Math.floor(Math.pow(10, 1.3)), 'Lv17 → floor(10^1.3)');
  // monotonic non-decreasing
  let prev = 0, ok2 = true;
  for (let lv = 8; lv <= 60; lv++) { withState({ bestLevel: lv }); const g = F.getPrestigeGain(); if (g < prev) ok2 = false; prev = g; }
  ok(ok2, 'prestige gain is monotonic non-decreasing in bestLevel');
});

group('damage scales with fire interval (QA)', () => {
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades(), grid: gridFrom([1, 2, 3, null, null, null]) });
  const dps = F.getTotalDPS();
  const interval = F.getFireInterval();
  let sum = 0;
  for (const lv of [1, 2, 3]) sum += F.shurikenDmg(lv);
  approx(dps, sum / interval, 'total DPS = sum(shurikenDmg)/fireInterval', 1e-6);
});

group('growth snapshot (Q-Leap 120)', () => {
  // new day appends
  let log = F.pushGrowthSnapshot([], { date: '2026-5-21', best: 10, prestige: 1 });
  eq(log.length, 1, 'first snapshot appended');
  log = F.pushGrowthSnapshot(log, { date: '2026-5-22', best: 14, prestige: 1 });
  eq(log.length, 2, 'next day appended');
  // same day updates to the higher record (not appended)
  log = F.pushGrowthSnapshot(log, { date: '2026-5-22', best: 12, prestige: 2 });
  eq(log.length, 2, 'same day does not append a new entry');
  eq(log[1].best, 14, 'same day keeps the higher best (14 > 12)');
  eq(log[1].prestige, 2, 'same day keeps the higher prestige');
  // cap enforced
  let big = [];
  for (let d = 1; d <= 20; d++) big = F.pushGrowthSnapshot(big, { date: '2026-6-' + d, best: d, prestige: 0 }, 14);
  eq(big.length, 14, 'log capped at 14 entries');
  eq(big[big.length - 1].best, 20, 'newest entry retained after capping');
  eq(big[0].best, 7, 'oldest beyond cap dropped (kept last 14: days 7..20)');
});

group('sparkline (Q-Leap 120)', () => {
  eq(F.sparkline([]), '', 'empty → empty string');
  eq(F.sparkline([5]).length, 1, 'single value → one block');
  const s = F.sparkline([1, 2, 3, 4, 5, 6, 7, 8]);
  eq(s.length, 8, 'one block per value');
  eq(s[0], '▁', 'min value → lowest block');
  eq(s[s.length - 1], '█', 'max value → highest block');
  // flat series doesn't crash (span 0 guarded)
  eq(F.sparkline([3, 3, 3]).length, 3, 'flat series handled');
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
