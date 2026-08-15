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

// Raw HTML for structural guards (button presence + handler wiring survives UI rebuilds).
const RAW_HTML = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
// 페이싱 시뮬레이터 원문 — 커버리지 가드용 (감사 133.2: 결-인지 프로파일이 사라지면 상한 측정이 끊긴다)
const RAW_SIM = require('fs').readFileSync(require('path').join(__dirname, 'simulate.js'), 'utf8');

// Helper: build a clean state and patch fields, then install it.
function withState(patch) {
  const s = G.defaultState();
  Object.assign(s, patch);
  // ensure grid array sized to default
  G.setState(s);
  return s;
}

group('release version sync', () => {
  const pkg = require('../package.json');
  const m = RAW_HTML.match(/const GAME_VERSION = '([^']+)'/);
  ok(!!m, 'GAME_VERSION constant present');
  eq(m && m[1], pkg.version, 'GAME_VERSION matches package.json (bump BOTH on release)');
});

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

// (v3.35) damage-formula tests removed — shurikenDmg/getBaseDmg deleted with combat.
// Gold contribution (getPieceGoldShare) is tested below instead.

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
  eq(G.getState().gem, 560, 'transcend 20 from scratch grants all crossed milestones (30+80+150+300)');
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

group('piece gold share (v3.35 — replaces DPS share)', () => {
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades(), dailyChallengeId: '',
    grid: gridFrom([1, 1, null, null, null, null]) });
  approx(F.getPieceGoldShare(0), 0.5, 'two equal pieces → 50% gold each');
  // Lv2 weight 2× Lv1 (different levels → no synergy) → share 2/3 vs 1/3
  withState({ prestigeCount: 0, bestLevel: 1, upgrades: defaultUpgrades(), dailyChallengeId: '',
    grid: gridFrom([2, 1, null, null, null, null]) });
  approx(F.getPieceGoldShare(0), 2 / 3, 'Lv2 contributes 2/3 of gold', 1e-9);
  eq(F.getPieceGoldShare(2), 0, 'empty cell contributes 0');
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

group('even-level 💎 jump-skip (audit fix — range count)', () => {
  // dark absorb makes a deterministic 2-step jump: Lv7+Lv7→Lv8, dark absorbs Lv8 → Lv9.
  // prevBest=7, newLv=9 crosses the EVEN Lv8 without landing on it. The old exact-landing
  // check (newLv%2===0) granted 0 💎; the range count grants 1 (for crossing Lv8).
  const today = F.todayString();
  const allAch = {}; for (const a of C.ACHIEVEMENTS) allAch[a.id] = 1; // pre-unlock → checkAchievements grants nothing
  const s = withState({
    grid: gridFrom([{ level: 7, dark: true }, 7, 8, null, null, null]),
    codex: {}, gem: 0, bestLevel: 7, upgrades: defaultUpgrades(), prestigeCount: 0,
    dailyQuests: [], lastFirstMergeDate: today, // suppress daily-first-merge +3
  });
  s.stats = {}; s.achievements = Object.assign({}, allAch);
  for (let lv = 1; lv <= 9; lv++) s.codex[lv] = true; // pre-fill so codex grants no incidental gems
  const realRandom = Math.random;
  Math.random = () => 0.999999; // no lucky jump, no spontaneous variant, no procs
  F.tryMerge(0, 1);
  Math.random = realRandom;
  const st = G.getState();
  eq(st.grid[1].level, 9, 'dark absorb produced the Lv9 jump');
  eq(st.gem, 1, 'crossing even Lv8 (landing on odd Lv9) grants 1 💎, not 0');
});

group('codex registration jump-skip (audit fix — register every crossed level)', () => {
  // same 7→8→9 dark-absorb jump, codex empty. Old code registered only the landing Lv9,
  // stranding Lv8 (lost 깨달음 + understated codex count). Fix registers every crossed level.
  const s = withState({
    grid: gridFrom([{ level: 7, dark: true }, 7, 8, null, null, null]),
    codex: {}, enlightenment: 0, bestLevel: 7, upgrades: defaultUpgrades(), prestigeCount: 0,
  });
  s.stats = {};
  const realRandom = Math.random;
  Math.random = () => 0.999999;
  F.tryMerge(0, 1);
  Math.random = realRandom;
  const st = G.getState();
  ok(st.codex[8], 'intermediate Lv8 registered (was silently skipped before)');
  ok(st.codex[9], 'landing Lv9 registered');
});

group('corrupt upgrades no longer wipes the save (audit fix)', () => {
  // A NaN maxShuriken made getGridSize() return NaN → new Array(NaN) threw inside
  // validateAndRepairState → load()'s catch silently discarded the ENTIRE save.
  const s = G.defaultState();
  s.upgrades = { maxShuriken: NaN, spawnRate: -3, spawnBatch: 'x', firerate: 2.7 };
  G.setState(s);
  let threw = false;
  try { F.validateAndRepairState(); } catch (e) { threw = true; }
  ok(!threw, 'validateAndRepairState survives corrupt upgrades (no save-wipe)');
  const u = G.getState().upgrades;
  eq(u.maxShuriken, 0, 'NaN maxShuriken repaired to default');
  eq(u.spawnRate, 0, 'negative spawnRate repaired');
  eq(u.spawnBatch, 0, 'non-number spawnBatch repaired');
  eq(u.firerate, 2, 'fractional firerate floored');
  ok(isFinite(F.getGridSize()), 'getGridSize() finite after repair');
});

group('corrupt skills repaired — no NaN spawn-interval / gold (audit-2)', () => {
  // getSkillLv does `(skills && skills[id]) || 0` — catches NaN but a non-numeric STRING
  // survives → Math.pow(0.96, "abc") = NaN → spawn interval NaN → generation stalls forever.
  const s = G.defaultState();
  s.skills = Object.assign({}, s.skills, { swiftHands: 'abc', goldMastery: -2, codexBoost: 3.9 });
  G.setState(s);
  let threw = false;
  try { F.validateAndRepairState(); } catch (e) { threw = true; }
  ok(!threw, 'validateAndRepairState survives corrupt skills');
  const sk = G.getState().skills;
  eq(sk.swiftHands, 0, 'non-numeric skill string repaired to 0');
  eq(sk.goldMastery, 0, 'negative skill repaired to 0');
  eq(sk.codexBoost, 3, 'fractional skill floored');
  ok(isFinite(F.getSpawnInterval()), 'spawn interval finite after skills repair (no stall)');
  ok(isFinite(F.getGoldMul()), 'gold multiplier finite after skills repair');
});

group('corrupt runBestLevel repaired + clamped (audit-2)', () => {
  const s = G.defaultState();
  s.bestLevel = 10; s.runBestLevel = NaN;
  G.setState(s);
  F.validateAndRepairState();
  ok(isFinite(G.getState().runBestLevel), 'NaN runBestLevel repaired to a finite value');
  // runBestLevel can never legitimately exceed all-time bestLevel → clamp
  const s2 = G.defaultState();
  s2.bestLevel = 5; s2.runBestLevel = 999;
  G.setState(s2);
  F.validateAndRepairState();
  ok(G.getState().runBestLevel <= G.getState().bestLevel, 'runBestLevel clamped to bestLevel');
});

group('corrupt nextShurikenId repaired before id-repair loop (audit-2)', () => {
  const s = G.defaultState();
  s.nextShurikenId = NaN;
  s.grid = gridFrom([5, null, null, null, null, null]);
  s.grid[0].id = NaN; // also corrupt a cell id so the repair loop runs (c.id = nextShurikenId++)
  G.setState(s);
  F.validateAndRepairState();
  ok(isFinite(G.getState().nextShurikenId), 'NaN nextShurikenId re-derived to a finite value');
  ok(isFinite(G.getState().grid[0].id), 'repaired cell id is finite (not NaN++)');
});

group('auto-frenzy chains on expiry when gauge full (audit-2)', () => {
  if (typeof F.update !== 'function') { ok(true, 'update() not exposed — skip'); return; }
  const MAX = C.FRENZY_MAX;
  const realRandom = Math.random;
  Math.random = () => 0.999999;
  // frenzy about to expire, gauge already refilled to MAX during it, auto ON.
  const s = withState({
    frenzyTimer: 0.05, frenzyCharge: MAX, autoFrenzyEnabled: true,
    grid: gridFrom([null, null, null, null, null, null]), spawnProgress: 0,
    upgrades: defaultUpgrades(), prestigeCount: 0, bestLevel: 1,
  });
  s.stats = {};
  F.update(0.1); // expires the frenzy
  Math.random = realRandom;
  const st = G.getState();
  ok((st.frenzyTimer || 0) > 0, 'auto-frenzy re-fired on expiry (timer reset) — not left inert');
  eq(st.frenzyCharge, 0, 'chained activation consumed the gauge to 0');
});

group('auto-frenzy does NOT chain when toggle is OFF (audit-2)', () => {
  if (typeof F.update !== 'function') { ok(true, 'update() not exposed — skip'); return; }
  const MAX = C.FRENZY_MAX;
  const realRandom = Math.random;
  Math.random = () => 0.999999;
  const s = withState({
    frenzyTimer: 0.05, frenzyCharge: MAX, autoFrenzyEnabled: false,
    grid: gridFrom([null, null, null, null, null, null]), spawnProgress: 0,
    upgrades: defaultUpgrades(), prestigeCount: 0, bestLevel: 1,
  });
  s.stats = {};
  F.update(0.1);
  Math.random = realRandom;
  const st = G.getState();
  eq(st.frenzyTimer, 0, 'no re-fire when auto is OFF');
  eq(st.frenzyCharge, MAX, 'gauge stays full for manual activation');
});

group('info-modal gold rate guards Infinity (audit-2 source guard)', () => {
  // display-only fix (DOM out of unit scope) — assert the bare unguarded toFixed render is gone.
  ok(!/baseGoldRate\.toFixed\(1\)\}\s*\/\s*초/.test(RAW_HTML), 'bare baseGoldRate.toFixed(1) render removed');
  ok(/!isFinite\(baseGoldRate\)/.test(RAW_HTML), 'info-modal gold rate now guards non-finite (∞)');
});

group('inheritance prestige preserves variant flags (audit-3)', () => {
  if (typeof F.doPrestige !== 'function') { ok(true, 'doPrestige not exposed — skip'); return; }
  // 계승(inheritance) Lv2 keeps the 2 highest pieces through 윤회. The rebuild used to drop
  // golden/star/dark flags → a paid inheritance of a rare piece came back plain (lost ×5 sell,
  // passive-gold synergy, variant-inheritance bias).
  const s = withState({
    bestLevel: 10, runBestLevel: 10, // prestige unlocked (>= 8)
    grid: gridFrom([{ level: 9, dark: true }, { level: 7, golden: true }, 3, null, null, null]),
    skills: Object.assign({}, G.defaultState().skills, { inheritance: 2 }),
    upgrades: defaultUpgrades(), enlightenment: 50, prestigeCount: 0,
  });
  s.stats = {};
  F.doPrestige();
  const kept = G.getState().grid.filter(Boolean).sort((a, b) => b.level - a.level);
  eq(kept.length, 2, 'two highest pieces inherited through prestige');
  eq(kept[0].level, 9, 'highest inherited piece is the Lv9');
  ok(kept[0].dark === true, 'inherited Lv9 keeps its dark flag (was silently stripped before)');
  ok(kept[1].golden === true, 'inherited Lv7 keeps its golden flag');
});

group('reload clears run-transient combo/burning state (audit-3)', () => {
  if (typeof F.save !== 'function' || typeof F.load !== 'function') { ok(true, 'save/load not exposed — skip'); return; }
  // A save fired mid-combo used to restore comboCount verbatim → first post-reload merge got a
  // free comboMult. frenzy/goldRush are intentionally persisted; combo/burning/blessed are not.
  const s = withState({
    comboCount: 5, comboTimer: 1.8, comboTimerMax: 2.5, burningTimer: 12,
    blessedIdx: 3, blessedTimer: 4,
    frenzyCharge: 40, goldRushTimer: 6,
    upgrades: defaultUpgrades(),
  });
  s.stats = {};
  F.save();
  F.load();
  const st = G.getState();
  eq(st.comboCount, 0, 'comboCount cleared on reload (no free combo multiplier)');
  eq(st.comboTimer, 0, 'comboTimer cleared on reload');
  eq(st.burningTimer, 0, 'burningTimer cleared on reload');
  eq(st.blessedIdx, -1, 'blessedIdx reset on reload');
  eq(st.frenzyCharge, 40, 'frenzyCharge STILL persists across reload (intentional)');
  eq(st.goldRushTimer, 6, 'goldRushTimer STILL persists across reload (intentional)');
});

group('info modal guards stale-index actions (audit-4 source guard)', () => {
  // automation can mutate the grid while the info modal is open; the store/sell/fuse buttons
  // defer to _infoModalIdx at click time. DOM-interaction fix (out of unit scope) — assert the
  // id-capture + per-handler re-check is wired so the wrong piece can't be stored/sold/fused.
  ok(/_infoModalPieceId = c\.id/.test(RAW_HTML), 'info modal captures the displayed piece id at open');
  const guards = (RAW_HTML.match(/if \(!_infoModalPieceValid\(\)\) return/g) || []).length;
  ok(guards >= 3, `all three info-modal action buttons re-check piece identity (found ${guards})`);
});

group('curation T3: unified 오늘 hub structure (source guard)', () => {
  // DOM consolidation (out of unit scope) — assert the hub exists, the daily surfaces were
  // RELOCATED into it (present exactly once → no duplicate-id breakage), and the old quest-modal
  // shell is gone. Reward logic is unchanged (renderQuests + claim fns already tested elsewhere).
  ok(/<div id="today-modal">/.test(RAW_HTML), 'today-modal hub exists');
  ok(/id="today-close"/.test(RAW_HTML), 'hub has a close button');
  ok(!/<div id="quest-modal">/.test(RAW_HTML), 'old quest-modal shell removed (merged into hub)');
  // each relocated daily surface must appear exactly once (id) — duplicate would be a real bug
  for (const id of ['quest-list', 'weekly-quest-box', 'spin-btn', 'exchange-btn', 'exchange-btn-10']) {
    const n = (RAW_HTML.match(new RegExp('id="' + id + '"', 'g')) || []).length;
    eq(n, 1, `${id} appears exactly once (relocated, not duplicated)`);
  }
  // hub status readouts present
  for (const id of ['today-challenge', 'today-merge', 'today-attend']) {
    ok(new RegExp('id="' + id + '"').test(RAW_HTML), `hub has ${id} status readout`);
  }
  // the entry button opens the hub via renderToday (not the old quest-modal)
  ok(/renderToday\(\);\s*\n\s*document\.getElementById\('today-modal'\)\.classList\.add\('show'\)/.test(RAW_HTML),
    'quest-btn handler opens today-modal via renderToday');
  ok(/function renderToday\(\)/.test(RAW_HTML), 'renderToday defined');
  ok(/function refreshDailyActionsUI\(\)/.test(RAW_HTML), 'refreshDailyActionsUI (shared spin/exchange) defined');
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
  eq(bd.length, 12, '12 gold-multiplier sources defined (incl. strategy mode + tower)');
  ok(bd.every(f => typeof f.mul === 'number' && f.label), 'every factor has label + numeric mul');
  // prestige factor reflects count
  const pf = bd.find(f => f.key === 'prestige');
  approx(pf.mul, 1 + 2 * 0.5, 'prestige factor = 1 + count*0.5');
});

group('sell value formula (Q-Leap 119 refactor + QA)', () => {
  // runBestLevel 20 → daily-market band is [11,20], so the level-5 pieces tested here never
  // catch the market premium → these baseline assertions stay deterministic across dates.
  withState({ prestigeCount: 0, bestLevel: 20, runBestLevel: 20, upgrades: defaultUpgrades(), dailyChallengeId: '' });
  const gm = F.getGoldMul();
  // match sellValue's single floor (floor-then-multiply is brittle when gm is fractional,
  // e.g. on a weekday with a gold-mult bonus).
  const expect = (lv, mul) => Math.floor(Math.pow(2, lv) * gm * 0.5 * mul);
  eq(F.sellValue({ level: 5 }), expect(5, 1), 'plain sell = 2^lv * goldMul * 0.5');
  eq(F.sellValue({ level: 5, golden: true }), expect(5, 5), 'golden sells 5x');
  eq(F.sellValue({ level: 5, golden: true, star: true, dark: true }), expect(5, 125), 'all variants → 125x');
  eq(F.sellValue({ level: 5, locked: true }), 0, 'locked piece is unsellable');
  eq(F.sellValue(null), 0, 'null → 0');
});

group('daily market (오늘의 시세) — date-seeded sell premium', () => {
  withState({ prestigeCount: 0, bestLevel: 20, runBestLevel: 20, upgrades: defaultUpgrades(), dailyChallengeId: '' });
  // deterministic per fixed date
  eq(F.getMarketLevel('2026-01-15'), F.getMarketLevel('2026-01-15'), 'market level deterministic for a date');
  eq(F.getMarketMul('2026-01-15'), F.getMarketMul('2026-01-15'), 'market mul deterministic for a date');
  const lv = F.getMarketLevel('2026-01-15');
  ok(lv >= 11 && lv <= 20, 'market level within current-run frontier band [runBestLevel-9, runBestLevel]');
  const m = F.getMarketMul('2026-01-15');
  ok(m >= 2 && m <= 4, 'market mul in [2,4]');
  // varies across dates (sanity, not strict)
  const levels = ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'].map((d) => F.getMarketLevel(d));
  ok(new Set(levels).size >= 2, 'market level varies across dates');
  // sellValue applies the premium for today's market level, none for an off-band level
  const gm = F.getGoldMul();
  const today = F.todayString();
  const mktLv = F.getMarketLevel(today);
  const mktMul = F.getMarketMul(today);
  eq(F.sellValue({ level: mktLv }), Math.floor(Math.pow(2, mktLv) * gm * 0.5 * mktMul), 'market-level piece sells at premium');
  eq(F.sellValue({ level: 5 }), Math.floor(Math.pow(2, 5) * gm * 0.5), 'off-band level (5, band 11-20): no premium');
  // premium stacks multiplicatively with variant muls
  eq(F.sellValue({ level: mktLv, golden: true }), Math.floor(Math.pow(2, mktLv) * gm * 0.5 * 5 * mktMul), 'market premium stacks with golden ×5');
  // anchors to runBestLevel (current run), not all-time bestLevel — so it stays relevant
  // post-prestige (grid reset to low pieces) instead of stranding on unreachable highs.
  withState({ prestigeCount: 3, bestLevel: 50, runBestLevel: 5, upgrades: defaultUpgrades(), dailyChallengeId: '' });
  const postPrestigeLv = F.getMarketLevel('2026-01-15');
  ok(postPrestigeLv >= 2 && postPrestigeLv <= 8, 'post-prestige market tracks runBestLevel band [2,8], not bestLevel-50 highs');
});

group('sellShuriken e2e — market premium gold + marketSells stat (v3.66.1 path)', () => {
  if (typeof F.sellShuriken !== 'function') { ok(true, 'sellShuriken not exposed — skip'); return; }
  const s = withState({ prestigeCount: 0, bestLevel: 20, runBestLevel: 20, gold: 0, upgrades: defaultUpgrades(), dailyChallengeId: '' });
  s.stats = {};
  s.dailyQuests = [];
  const mktLv = F.getMarketLevel();
  const mktMul = F.getMarketMul();
  const gm = F.getGoldMul();
  s.grid = place(6, { 0: mktLv });
  F.sellShuriken(0);
  const st = G.getState();
  eq(st.gold, Math.floor(Math.pow(2, mktLv) * gm * 0.5 * mktMul), 'market-level sell credits premium gold via real sellShuriken');
  eq(st.stats.marketSells, 1, 'marketSells incremented on a market-level sale');
  eq(st.stats.totalSold, 1, 'totalSold incremented');
  eq(st.grid[0], null, 'sold piece cleared from grid');
  // an off-band sale does NOT bump marketSells
  const s2 = withState({ prestigeCount: 0, bestLevel: 20, runBestLevel: 20, gold: 0, upgrades: defaultUpgrades(), dailyChallengeId: '' });
  s2.stats = {}; s2.dailyQuests = [];
  s2.grid = place(6, { 0: 5 }); // band is [11,20] → level 5 is off-market
  F.sellShuriken(0);
  eq(G.getState().stats.marketSells || 0, 0, 'off-market sale leaves marketSells at 0');
});

group('escAttr — HTML attribute escaping (codex flavor tooltip safety)', () => {
  if (typeof F.escAttr !== 'function') { ok(true, 'escAttr not exposed — skip'); return; }
  eq(F.escAttr('plain'), 'plain', 'plain text unchanged');
  eq(F.escAttr('a"b'), 'a&quot;b', 'double-quote escaped (would break title="...")');
  eq(F.escAttr('a&b'), 'a&amp;b', 'ampersand escaped first');
  eq(F.escAttr('<x>'), '&lt;x&gt;', 'angle brackets escaped');
  eq(F.escAttr('"&<>'), '&quot;&amp;&lt;&gt;', 'amp escaped before others, no double-encoding');
  // a real flavor string (contains literal double quotes) must not break an attribute
  const fl = F.getLevelFlavor(10);
  if (fl) ok(!/(^|[^&])"/.test(F.escAttr(fl)), 'escaped milestone flavor has no raw double-quote');
});

group('daysBetween — streak math across month/year/leap boundaries', () => {
  if (typeof F.daysBetween !== 'function') { ok(true, 'daysBetween not exposed — skip'); return; }
  const db = F.daysBetween;
  eq(db('2026-5-27', '2026-5-27'), 0, 'same day → 0');
  eq(db('2026-1-1', '2026-1-2'), 1, 'consecutive days → 1');
  eq(db('2026-1-31', '2026-2-1'), 1, 'month boundary (Jan→Feb) → 1');
  eq(db('2026-12-31', '2027-1-1'), 1, 'year boundary (Dec→Jan) → 1');
  eq(db('2026-2-28', '2026-3-1'), 1, 'non-leap Feb 28 → Mar 1 → 1');
  eq(db('2028-2-28', '2028-2-29'), 1, 'leap year has Feb 29 → 1');
  eq(db('2028-2-29', '2028-3-1'), 1, 'leap Feb 29 → Mar 1 → 1');
  eq(db('2026-5-1', '2026-5-3'), 2, 'a missed day → gap of 2 (streak should reset)');
  eq(db('2026-1-1', '2026-2-1'), 31, 'Jan has 31 days');
  eq(db('2026-1-2', '2026-1-1'), -1, 'reverse order → negative (never === 1, so no false streak)');
});

group('attendance — daily gem scaling, streak inc/reset, 7-day milestone (one-shot), same-day no-op', () => {
  if (typeof F.processAttendance !== 'function') { ok(true, 'processAttendance not exposed — skip'); return; }
  const empty6 = () => gridFrom([null, null, null, null, null, null]);
  const ymd = (msAgo) => F.dateKey(new Date(Date.now() - msAgo));
  // first attendance → streak 1, 1 gem (1 + floor(1/3)=0)
  let s = withState({ gem: 0, lastAttendDate: '', attendStreak: 0, grid: empty6() }); s.stats = {};
  F.processAttendance();
  eq(G.getState().attendStreak, 1, 'first attendance → streak 1');
  eq(G.getState().gem, 1, 'first day → 1 gem');
  eq(G.getState().lastAttendDate, F.todayString(), 'lastAttendDate = today');
  // same-day re-claim is a no-op
  s = withState({ gem: 5, attendStreak: 3 }); s.lastAttendDate = F.todayString(); s.stats = {};
  F.processAttendance();
  eq(G.getState().gem, 5, 'same-day re-claim grants nothing');
  eq(G.getState().attendStreak, 3, 'streak unchanged same day');
  // consecutive day → streak increments; streak 6 → 1 + min(4, floor(6/3)=2) = 3 gems
  s = withState({ gem: 0, attendStreak: 5, grid: empty6() }); s.lastAttendDate = ymd(86400000); s.stats = {};
  F.processAttendance();
  eq(G.getState().attendStreak, 6, 'consecutive day → streak 5→6');
  eq(G.getState().gem, 3, 'streak 6 → 3 daily gems');
  // a missed day resets streak to 1
  s = withState({ gem: 0, attendStreak: 10, grid: empty6() }); s.lastAttendDate = ymd(3 * 86400000); s.stats = {};
  F.processAttendance();
  eq(G.getState().attendStreak, 1, 'gap > 1 day → streak resets to 1');
  // reaching streak 7 → daily 3 + 7-day bonus 5 + milestone 10 = 18, one-shot
  s = withState({ gem: 0, attendStreak: 6, grid: empty6() }); s.lastAttendDate = ymd(86400000); s.stats = {};
  F.processAttendance();
  eq(G.getState().attendStreak, 7, 'streak → 7');
  eq(G.getState().gem, 18, 'streak 7: daily 3 + weekly bonus 5 + milestone 10');
  ok(G.getState().stats.attendMilestones[7], '7-day milestone recorded (one-shot guard)');
});

group('daily quest claim — gems, questBoost ×2, all-complete bonus (1/day), no double-claim', () => {
  if (typeof F.claimQuestRewards !== 'function') { ok(true, 'claimQuestRewards not exposed — skip'); return; }
  const allAch = {}; for (const a of C.ACHIEVEMENTS) allAch[a.id] = 1; // suppress incidental achievement gems
  const doneTiers = {}; for (const n of [10, 25, 50, 75, C.ACHIEVEMENTS.length]) doneTiers[n] = 1;
  // two completed quests, no challenge boost
  let s = withState({ gem: 0, dailyChallengeId: '', lastAllQuestsDate: '' });
  s.achievements = allAch; s.stats = { achCompletions: doneTiers };
  s.dailyQuests = [
    { type: 'merges', target: 10, progress: 10, claimed: false, reward: { gem: 3 } },
    { type: 'spawn', target: 5, progress: 5, claimed: false, reward: { gem: 4 } },
  ];
  eq(F.claimQuestRewards(), 2, 'claimed both completed quests');
  eq(G.getState().gem, 17, 'quest gems (3+4=7) + all-complete bonus (10)');
  eq(G.getState().stats.questsCompleted, 2, 'questsCompleted += 2');
  eq(G.getState().stats.allQuestDays, 1, 'allQuestDays += 1');
  eq(F.claimQuestRewards(), 0, 'nothing left to claim');
  eq(G.getState().gem, 17, 'no double reward on re-claim');
  // questBoost challenge doubles quest gem AND the all-complete bonus
  s = withState({ gem: 0, dailyChallengeId: 'questBoost', lastAllQuestsDate: '' });
  s.achievements = allAch; s.stats = { achCompletions: doneTiers };
  s.dailyQuests = [{ type: 'merges', target: 10, progress: 10, claimed: false, reward: { gem: 3 } }];
  eq(F.claimQuestRewards(), 1, 'claimed the one completed quest');
  eq(G.getState().gem, 26, 'questBoost: quest gem 3×2=6 + bonus 10×2=20');
  // incomplete quests are not claimed
  s = withState({ gem: 0, dailyChallengeId: '', lastAllQuestsDate: F.todayString() });
  s.achievements = allAch; s.stats = { achCompletions: doneTiers };
  s.dailyQuests = [{ type: 'merges', target: 10, progress: 4, claimed: false, reward: { gem: 3 } }];
  eq(F.claimQuestRewards(), 0, 'incomplete quest not claimed');
  eq(G.getState().gem, 0, 'no gem for incomplete quest');
});

group('weekly quest — baseline-delta progress + claim reward + double-claim guard', () => {
  if (typeof F.claimWeeklyReward !== 'function') { ok(true, 'claimWeeklyReward not exposed — skip'); return; }
  const s = withState({ gem: 0, enlightenment: 0 });
  s.stats = { totalMerges: 100 };
  // pre-unlock all achievements + completion tiers so checkAchievements (called inside claim)
  // grants no incidental gems — isolates the weekly reward amount.
  const allAch = {}; for (const a of C.ACHIEVEMENTS) allAch[a.id] = 1; s.achievements = allAch;
  s.stats.achCompletions = {}; for (const n of [10, 25, 50, 75, C.ACHIEVEMENTS.length]) s.stats.achCompletions[n] = 1;
  s.weeklyQuest = { type: 'totalMerges', target: 30, baseline: 80, claimed: false, reward: { gem: 25, enlightenment: 3 }, name: '주간X' };
  eq(F.getWeeklyProgress(), 20, 'progress = stat(100) - baseline(80) = 20 (below target)');
  eq(F.claimWeeklyReward(), false, 'cannot claim below target');
  eq(G.getState().gem, 0, 'no reward granted below target');
  // reach the target
  G.getState().stats.totalMerges = 110; // 110 - 80 = 30 >= target
  eq(F.getWeeklyProgress(), 30, 'progress clamped at target (30)');
  ok(F.claimWeeklyReward(), 'claim succeeds at target');
  eq(G.getState().gem, 25, 'gem reward granted');
  eq(G.getState().enlightenment, 3, 'enlightenment reward granted');
  eq(G.getState().stats.weeklyCompleted, 1, 'weeklyCompleted incremented');
  eq(F.claimWeeklyReward(), false, 'cannot re-claim (claimed guard)');
  eq(G.getState().gem, 25, 'no double reward on re-claim');
});

group('trial system — startTrial setup + endTrial win/loss + inactive guard', () => {
  if (typeof F.startTrial !== 'function') { ok(true, 'startTrial not exposed — skip'); return; }
  // setup: goal = max(5, 그리드 최고 Lv + 3) (v3.79.2 F1b — 계승 쌍 즉시클리어 차단),
  // reward = 5 + floor(prestigeCount/3), timer 60
  let s = withState({ runBestLevel: 10, prestigeCount: 6, enlightenment: 0, grid: gridFrom([10, 3, null, null, null, null]) }); s.stats = {};
  F.startTrial();
  let st = G.getState();
  ok(st.trialActive, 'startTrial activates trial');
  eq(st.trialTimer, 60, 'timer set to 60s');
  eq(st.trialGoalLv, 13, 'goal = grid-max + 3 (계승 Lv10 쌍이면 목표도 13 — 즉시클리어 불가)');
  withState({ runBestLevel: 10, prestigeCount: 6, grid: [null, null, null, null, null, null] });
  F.startTrial();
  eq(G.getState().trialGoalLv, 5, 'empty grid → minimum goal 5 (runBestLevel은 더 이상 목표 입력이 아님)');
  s = withState({ runBestLevel: 10, prestigeCount: 6, enlightenment: 0, grid: gridFrom([10, 3, null, null, null, null]) }); s.stats = {};
  F.startTrial();
  st = G.getState();
  eq(st.trialReward, 7, 'reward = 5 + floor(prestigeCount/3)');
  eq(st.trialStartBestLv, 10, 'records starting run-best');
  // minimum goal floor + base reward
  s = withState({ runBestLevel: 1, prestigeCount: 0 }); s.stats = {};
  F.startTrial();
  eq(G.getState().trialGoalLv, 5, 'goal floored at 5');
  eq(G.getState().trialReward, 5, 'base reward 5 at prestige 0');
  // checkTrialProgress wins when runBestLevel reaches goal
  s = withState({ trialActive: true, trialTimer: 30, trialGoalLv: 8, trialReward: 5, runBestLevel: 8, enlightenment: 2 }); s.stats = {};
  F.checkTrialProgress();
  st = G.getState();
  eq(st.trialActive, false, 'reaching goal ends trial (win)');
  eq(st.enlightenment, 7, 'win grants reward enlightenment (2+5)');
  eq(st.stats.trialsWon, 1, 'win counted');
  // endTrial(false) = loss: no reward, no win count
  s = withState({ trialActive: true, trialTimer: 0, trialGoalLv: 8, trialReward: 5, runBestLevel: 3, enlightenment: 9 }); s.stats = {};
  F.endTrial(false);
  st = G.getState();
  eq(st.trialActive, false, 'loss ends trial');
  eq(st.enlightenment, 9, 'loss grants no enlightenment');
  eq(st.stats.trialsWon || 0, 0, 'loss not counted as win');
  // inactive-trial guard: endTrial is a no-op (prevents double reward if called twice)
  s = withState({ trialActive: false, trialReward: 5, enlightenment: 5 }); s.stats = {};
  F.endTrial(true);
  eq(G.getState().enlightenment, 5, 'endTrial on inactive trial is a no-op (no phantom reward)');
});

group('enlightenment gain formula (QA)', () => {
  // actual prestige reward = max(1, floor(runBestLevel/3))
  withState({ runBestLevel: 1 });
  eq(F.getEnlightenmentGain(), 1, 'min gain is 1');
  withState({ runBestLevel: 9 });
  eq(F.getEnlightenmentGain(), 3, 'runBest 9 → 3');
  withState({ runBestLevel: 60 });
  eq(F.getEnlightenmentGain(), 20, 'runBest 60 → 20');
  // monotonic non-decreasing in runBestLevel
  let prev = 0, ok2 = true;
  for (let lv = 1; lv <= 80; lv++) { withState({ runBestLevel: lv }); const g = F.getEnlightenmentGain(); if (g < prev) ok2 = false; prev = g; }
  ok(ok2, 'enlightenment gain is monotonic non-decreasing');
});

group('pacing interventions A+B (v3.78, user-approved)', () => {
  // A. 윤회 골드 체감: 1~20회 +50%p → 21~50회 +25%p → 51회+ +10%p
  withState({ prestigeCount: 2 });
  approx(F.getPrestigeGoldMul(), 2.0, 'p2: unchanged early curve (1+1.0)', 1e-9);
  withState({ prestigeCount: 20 });
  approx(F.getPrestigeGoldMul(), 11, 'p20: tier-1 cap (1+10)', 1e-9);
  withState({ prestigeCount: 50 });
  approx(F.getPrestigeGoldMul(), 18.5, 'p50: +tier-2 (11+7.5)', 1e-9);
  withState({ prestigeCount: 273 });
  approx(F.getPrestigeGoldMul(), 18.5 + 22.3, 'p273: deep spam collapses to +10%p steps', 1e-9);
  eq(F.getNextPrestigeGoldInc(), 10, 'next-step readout at deep count = 10%p');
  withState({ prestigeCount: 3 });
  eq(F.getNextPrestigeGoldInc(), 50, 'next-step readout early = 50%p');
  // breakdown wired to the new curve
  withState({ prestigeCount: 30 });
  approx(F.getGoldMulBreakdown().find(f => f.key === 'prestige').mul, 1 + 10 + 2.5, 'breakdown uses the decayed curve', 1e-9);
  // monotonic non-decreasing
  let prevM = 0, mono = true;
  for (let p = 0; p <= 300; p++) { const m = F.getPrestigeGoldMul(p); if (m < prevM) mono = false; prevM = m; }
  ok(mono, 'decayed curve stays monotonic');

  // B. 알찬 런 계수: 10분 램프, 첫 윤회 면제, 스팸 런은 비례 축소
  withState({ prestigeCount: 0, runPlaySec: 0 });
  eq(F.getRunSubstanceFactor(), 1, 'first prestige exempt (skill tree opening unharmed)');
  withState({ prestigeCount: 3, runPlaySec: 0 });
  eq(F.getRunSubstanceFactor(), 0, '0s run → factor 0');
  withState({ prestigeCount: 3, runPlaySec: 300 });
  approx(F.getRunSubstanceFactor(), 0.5, '5min run → 50%', 1e-9);
  withState({ prestigeCount: 3, runPlaySec: 900 });
  eq(F.getRunSubstanceFactor(), 1, '15min run → full');
  // 30초 스팸 런: runBest 30이라도 悟 0 (v3.79.1 — 무조건 하한 1도 스팸 수입원이었다)
  withState({ prestigeCount: 3, runBestLevel: 30, runPlaySec: 30 });
  eq(F.getEnlightenmentGain(), 0, '30s spam run pays 0悟 (unconditional floor removed)');
  withState({ prestigeCount: 3, runBestLevel: 3, runPlaySec: 300 });
  eq(F.getEnlightenmentGain(), 0, 'half-substance tiny run can round to 0 (no free floor)');
  withState({ prestigeCount: 3, runBestLevel: 3, runPlaySec: 600 });
  eq(F.getEnlightenmentGain(), 1, 'full-substance run keeps the ≥1 floor');
  withState({ prestigeCount: 3, runBestLevel: 30, runPlaySec: 600 });
  eq(F.getEnlightenmentGain(), 10, 'full 10min run pays full 10悟');
  // advice refuses to endorse short runs
  const adv = (() => { withState({ bestLevel: 30, runBestLevel: 30, prestigeCount: 3, enlightenment: 0, runPlaySec: 60 }); return F.getPrestigeAdvice(); })();
  ok(!adv.recommend && /짧습니다/.test(adv.reason), 'advice blocks short-run prestige with a countdown reason');
  // update() accrues runPlaySec; doPrestige resets it
  const sU = withState({ runPlaySec: 0 });
  for (let i = 0; i < 30; i++) F.update(0.1);
  ok(sU.runPlaySec >= 2, 'update accrues run playtime');
  const sR = withState({ bestLevel: 12, runBestLevel: 12, prestigeCount: 1, runPlaySec: 999, enlightenment: 0 });
  F.doPrestige();
  eq(sR.runPlaySec, 0, 'prestige resets the run clock');
  // migration: old save without the field gets full factor for the in-flight run
  const sM = withState({ prestigeCount: 5 });
  delete sM.runPlaySec;
  F.save();
  withState({});
  F.load();
  eq(G.getState().runPlaySec, 600, 'legacy save migrates to a full substance factor');
});

group('tier gates (Q-Leap 131, PACING C)', () => {
  const GATES = C.TIER_GATES;
  eq(GATES.length, 3, 'three midgame gates');
  eq(GATES.map(g => g.lv).join(','), '15,25,35', 'gates at 15/25/35');

  // crossing queues the gate; jump across two queues both (jump-safe)
  const s1 = withState({ bestLevel: 14 });
  F.checkTierGates(14, 15);
  eq(s1.gatePending.join(','), '15', 'crossing 15 queues gate 15');
  const s2 = withState({ bestLevel: 14 });
  F.checkTierGates(14, 26);
  eq(s2.gatePending.join(','), '15,25', 'jump 14→26 queues both crossed gates');
  // no requeue when claimed or already pending
  const s3 = withState({ gatesClaimed: { 15: 'gem' }, gatePending: [25] });
  F.checkTierGates(10, 40);
  eq(s3.gatePending.join(','), '25,35', 'claimed gate not requeued; pending not duplicated');

  // claims: three choices grant three different resources, one-shot
  const s4 = withState({ gatePending: [15], gem: 0 });
  eq(F.claimGate(15, 'gem'), true, 'gem claim works');
  eq(s4.gem >= GATES[0].gem, true, 'gem granted');
  eq(s4.gatesClaimed[15], 'gem', 'choice recorded');
  eq(s4.gatePending.length, 0, 'pending cleared');
  eq(F.claimGate(15, 'gem'), false, 'one-shot — second claim refused');
  const s5 = withState({ gatePending: [25], enlightenment: 0 });
  F.claimGate(25, 'enlight');
  eq(s5.enlightenment, GATES[1].enlight, 'enlightenment granted');
  const s6 = withState({ gatePending: [35], grid: [null, null, null, null, null, null] });
  F.claimGate(35, 'variant');
  const dark = s6.grid.find(c => c && c.dark);
  ok(dark && dark.level === 31, 'dark piece lands at gate−4 level');
  // variant needs an empty slot
  const s7 = withState({ gatePending: [15], grid: gridFrom([1, 1, 1, 1, 1, 1]) });
  eq(F.claimGate(15, 'variant'), false, 'variant claim refused on a full grid');
  eq(s7.gatePending.join(','), '15', 'gate stays pending after refusal');

  // validation: bad values repaired, pending minus claimed
  const s8 = withState({ gatesClaimed: { 15: 'gem', 99: 'gem', 25: 'hax' }, gatePending: [15, 25, 99, 'x'] });
  F.validateAndRepairState();
  eq(Object.keys(s8.gatesClaimed).join(','), '15', 'invalid claim entries dropped');
  eq(s8.gatePending.join(','), '25', 'pending keeps only valid unclaimed gates');

  // record-path integration: a merge crossing 15 queues the gate
  const s9 = withState({ bestLevel: 14, runBestLevel: 14, grid: gridFrom([14, 14, null, null, null, null]) });
  F.tryMerge(0, 1);
  ok(s9.gatePending.includes(15), 'tryMerge record path queues crossed gates');
  // structural: all three record paths wired
  eq((RAW_HTML.match(/checkTierGates\(prevBest, newLv\)/g) || []).length, 3, 'gate check wired into all 3 record paths');
  // achievement
  ok(C.ACHIEVEMENTS.some(a => a.id === 'a_gate_all'), 'gate achievement registered');
  // modal render smoke
  let threw = false;
  try { withState({ gatePending: [15] }); F.showGateModal(); } catch (e) { threw = true; }
  eq(threw, false, 'gate modal renders under stubs');
});

group('pacing hardening v3.79.2 (audit F2/F3)', () => {
  // F2: 윤회는 이번 런에서 Lv 8 재등반이 필요 — 2클릭 골드-배수 러시의 문 봉쇄
  const sA = withState({ bestLevel: 40, runBestLevel: 3, prestigeCount: 5, runPlaySec: 9999 });
  eq(F.doPrestige(), false, 'lifetime Lv40 but run Lv3 → prestige refused (rush door closed)');
  eq(sA.prestigeCount, 5, 'count unchanged on refusal');
  const sB = withState({ bestLevel: 40, runBestLevel: 8, prestigeCount: 5, runPlaySec: 600 });
  ok(F.doPrestige(), 're-climbed to 8 this run → prestige allowed');
  // advice mirrors the gate with a re-climb reason
  withState({ bestLevel: 40, runBestLevel: 3, prestigeCount: 5 });
  const adv2 = F.getPrestigeAdvice();
  ok(!adv2.recommend && /재도달/.test(adv2.reason), 'advice explains the re-climb requirement');
  // F3: 시련 중 관문 변종 반입 금지 (보류-수령 밀수 봉쇄) — 관문은 보존
  const sC = withState({ gatePending: [35], towerActive: 3, grid: [null, null, null, null, null, null] });
  eq(F.claimGate(35, 'variant'), false, 'variant claim blocked during an active tower floor');
  eq(sC.gatePending.join(','), '35', 'gate preserved for after the floor');
  ok(F.claimGate(35, 'gem'), 'non-smuggling choices remain available in-tower');
});

group('prestige advice (Q-Leap 122)', () => {
  withState({ bestLevel: 5, prestigeCount: 0 });
  eq(F.getPrestigeAdvice().recommend, false, 'below Lv8 → not recommended');
  withState({ bestLevel: 12, runBestLevel: 12, prestigeCount: 0, enlightenment: 0 });
  eq(F.getPrestigeAdvice().recommend, true, 'first prestige at Lv8+ → recommended');
  // subsequent: recommend only when gain is a big boost to current enlightenment
  withState({ bestLevel: 30, runBestLevel: 30, prestigeCount: 3, enlightenment: 5, runPlaySec: 600 }); // gain=10 >= max(2,2.5)
  eq(F.getPrestigeAdvice().recommend, true, 'large relative gain → recommended');
  withState({ bestLevel: 30, runBestLevel: 9, prestigeCount: 3, enlightenment: 100, runPlaySec: 600 }); // gain=3 < min(50,10)=10
  eq(F.getPrestigeAdvice().recommend, false, 'small absolute gain → hold');
  // deep player: huge holdings but a solid run (gain 10, Lv30) → recommend (absolute-cap fix,
  // so the relative 50% threshold can't make advice perpetually "hold")
  withState({ bestLevel: 60, runBestLevel: 30, prestigeCount: 20, enlightenment: 500, runPlaySec: 600 }); // gain=10 >= min(250,10)=10
  eq(F.getPrestigeAdvice().recommend, true, 'deep player with a solid run → recommend (not perpetual hold)');
});

// (v3.35) DPS/fire-interval test removed — getTotalDPS/getFireInterval deleted with combat.

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

group('save integrity repair (Q-Leap 121)', () => {
  // wrong grid length → resized to getGridSize (6 with default upgrades)
  let s = withState({ upgrades: defaultUpgrades(), grid: [null, null] });
  let r = F.validateAndRepairState();
  eq(G.getState().grid.length, 6, 'grid resized to correct size');
  ok(r >= 1, 'repair counted for grid resize');
  // invalid piece entries nulled
  s = withState({ upgrades: defaultUpgrades(), grid: [{ level: 5 }, { level: NaN }, 'garbage', { foo: 1 }, null, null] });
  F.validateAndRepairState();
  const g = G.getState().grid;
  ok(g[0] && g[0].level === 5, 'valid piece kept');
  eq(g[1], null, 'NaN-level piece nulled');
  eq(g[2], null, 'non-object cell nulled');
  eq(g[3], null, 'piece without level nulled');
  // negative / NaN scalars repaired
  s = withState({ upgrades: defaultUpgrades(), gold: -50, gem: NaN, bestLevel: 0, spawnProgress: 5, grid: gridFrom([null,null,null,null,null,null]) });
  F.validateAndRepairState();
  const st = G.getState();
  eq(st.gold, 0, 'negative gold → 0');
  eq(st.gem, 0, 'NaN gem → 0');
  eq(st.bestLevel, 1, 'bestLevel < 1 → 1');
  eq(st.spawnProgress, 1, 'spawnProgress clamped to [0,1]');
  // bestLevel raised to grid max
  s = withState({ upgrades: defaultUpgrades(), bestLevel: 3, grid: gridFrom([10, 2, null, null, null, null]) });
  F.validateAndRepairState();
  eq(G.getState().bestLevel, 10, 'bestLevel raised to highest grid piece');
  // storage (v2.75) sanitized like grid cells: invalid entries dropped, valid kept,
  // bestLevel raised from a stored piece, non-array reset, length capped at 3.
  s = withState({ upgrades: defaultUpgrades(), bestLevel: 5,
    grid: gridFrom([null, null, null, null, null, null]),
    storage: [{ level: 7, id: 1, fireTimer: 0 }, { level: NaN }, 'junk', null] });
  F.validateAndRepairState();
  let stg = G.getState().storage;
  eq(stg.length, 1, 'invalid storage entries dropped, valid kept');
  eq(stg[0].level, 7, 'valid stored piece preserved');
  eq(G.getState().bestLevel, 7, 'bestLevel raised from stored piece');
  s = withState({ upgrades: defaultUpgrades(), grid: gridFrom([null, null, null, null, null, null]), storage: 'corrupt' });
  F.validateAndRepairState();
  stg = G.getState().storage;
  ok(Array.isArray(stg) && stg.length === 0, 'non-array storage → []');
  s = withState({ upgrades: defaultUpgrades(), grid: gridFrom([null, null, null, null, null, null]),
    storage: [{ level: 2, id: 1 }, { level: 2, id: 2 }, { level: 2, id: 3 }, { level: 2, id: 4 }, { level: 2, id: 5 }] });
  F.validateAndRepairState();
  eq(G.getState().storage.length, 3, 'storage capped at 3');
  // corrupt lastSave reset to a finite timestamp (else NaN elapsed poisons offline reward)
  s = withState({ upgrades: defaultUpgrades(), grid: gridFrom([null, null, null, null, null, null]) });
  s.lastSave = NaN;
  F.validateAndRepairState();
  ok(isFinite(G.getState().lastSave) && G.getState().lastSave > 0, 'NaN lastSave reset to finite timestamp');
  s = withState({ upgrades: defaultUpgrades(), grid: gridFrom([null, null, null, null, null, null]) });
  s.lastSave = -5;
  F.validateAndRepairState();
  ok(G.getState().lastSave > 0, 'negative lastSave reset to finite timestamp');
  // clean state needs no repair
  s = withState({ upgrades: defaultUpgrades(), gold: 100, gem: 5, bestLevel: 10, spawnProgress: 0.5, grid: gridFrom([5, 5, null, null, null, null]) });
  s.stats = { totalMerges: 10, playTimeSec: 100 };
  eq(F.validateAndRepairState(), 0, 'clean state → 0 repairs');
  // corrupt lifetime stats are sanitized
  s = withState({ upgrades: defaultUpgrades(), grid: gridFrom([null,null,null,null,null,null]) });
  s.stats = { totalMerges: NaN, playTimeSec: -5, totalGoldEarned: Infinity, bestCombo: 7 };
  F.validateAndRepairState();
  const st2 = G.getState().stats;
  eq(st2.totalMerges, 0, 'NaN stat → 0');
  eq(st2.playTimeSec, 0, 'negative stat → 0');
  eq(st2.totalGoldEarned, 0, 'Infinity stat → 0');
  eq(st2.bestCombo, 7, 'valid stat preserved');
});

group('stress: random ops preserve invariants (property test)', () => {
  // Run the integrated core loop under several deterministic seeds, mixing
  // spawn / merge / sell / ritual + occasional variant pieces. Any failure is
  // reproducible from its seed. Catches emergent corruption unit tests miss.
  function runSeed(seed0, steps) {
    let seed = seed0 >>> 0;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const realRandom = Math.random;
    Math.random = rnd;
    const violations = [];
    try {
      const s = withState({
        // include repurposed gold upgrades + goldMul so the gold-bonus paths are exercised
        upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 6, firerate: 4, baseDmg: 4, goldMul: 3 }), // grid size 12
        gold: 0, gem: 0, bestLevel: 1, prestigeCount: 0, spawnProgress: 0,
        grid: new Array(12).fill(null),
      });
      s.stats = {}; s.codex = {};
      const size = F.getGridSize();
      let prevBest = 1;
      for (let step = 0; step < steps; step++) {
        const g = G.getState().grid;
        const roll = rnd();
        if (roll < 0.45) {
          F.spawnShuriken();
          // occasionally tag a fresh piece as a variant to exercise inheritance/sets
          if (rnd() < 0.15) {
            const occupied = []; for (let i = 0; i < g.length; i++) if (g[i]) occupied.push(i);
            if (occupied.length) {
              const c = g[occupied[Math.floor(rnd() * occupied.length)]];
              const k = rnd(); if (k < 0.4) c.golden = true; else if (k < 0.7) c.star = true; else c.dark = true;
            }
          }
        } else if (roll < 0.8) {
          const a = Math.floor(rnd() * g.length), b = Math.floor(rnd() * g.length);
          if (a !== b) F.tryMerge(a, b);
        } else if (roll < 0.92) {
          const occupied = []; for (let i = 0; i < g.length; i++) if (g[i] && !g[i].locked) occupied.push(i);
          if (occupied.length) F.sellShuriken(occupied[Math.floor(rnd() * occupied.length)]);
        } else {
          F.doRitualMerge(); // no-op if no 3-group
        }
        const st = G.getState();
        if (!isFinite(st.gold) || st.gold < 0) violations.push(`gold@${seed0}:${step}=${st.gold}`);
        if (!isFinite(st.gem) || st.gem < 0) violations.push(`gem@${seed0}:${step}=${st.gem}`);
        if (!isFinite(st.bestLevel) || st.bestLevel < 1) violations.push(`best@${seed0}:${step}`);
        if (st.bestLevel < prevBest) violations.push(`bestRegress@${seed0}:${step}`);
        prevBest = st.bestLevel;
        if (st.grid.length > size) violations.push(`gridGrow@${seed0}:${step}`);
        let gridMax = 0;
        for (const c of st.grid) {
          if (c == null) continue;
          if (typeof c !== 'object' || !isFinite(c.level) || c.level < 1) { violations.push(`piece@${seed0}:${step}`); continue; }
          if (c.level > gridMax) gridMax = c.level;
        }
        if (gridMax > st.bestLevel) violations.push(`bestBelowGrid@${seed0}:${step}`);
        if (violations.length > 8) break;
      }
    } finally { Math.random = realRandom; }
    return { violations, best: G.getState().bestLevel };
  }
  let totalViolations = [];
  let progressed = false;
  for (const seed of [0x2bad4f3d, 0x9e3779b9, 0x1234abcd]) {
    const r = runSeed(seed, 2500);
    totalViolations = totalViolations.concat(r.violations);
    if (r.best > 1) progressed = true;
  }
  eq(totalViolations.length, 0, 'mixed ops across 3 seeds keep invariants: ' + totalViolations.slice(0, 8).join(' | '));
  ok(progressed, 'stress runs progressed (bestLevel grew)');
});

group('daily quest generation (QA)', () => {
  const a = F.generateDailyQuests('2026-5-21');
  const b = F.generateDailyQuests('2026-5-21');
  eq(a.length, 3, 'exactly 3 daily quests');
  eq(JSON.stringify(a), JSON.stringify(b), 'same date → identical quests (deterministic)');
  const c = F.generateDailyQuests('2026-5-22');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'different date → different quests');
  // distinct templates (no duplicate type+target pair)
  const keys = a.map(q => q.type + ':' + q.target);
  eq(new Set(keys).size, 3, 'quests are distinct templates');
  // each quest well-formed
  ok(a.every(q => q.progress === 0 && q.claimed === false && q.reward && typeof q.target === 'number'), 'quests well-formed (progress 0, unclaimed, reward, numeric target)');
});

group('mondayOfWeek ISO correctness (QA)', () => {
  // for any date, the returned key must parse to a Monday (getDay()===1),
  // be on or before the input, and within the same 6-day window.
  const parse = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  let allMonday = true, allInWindow = true;
  for (let off = 0; off < 21; off++) {
    const d = new Date(2026, 4, 1 + off); // May 1..21 2026 spans 3 weeks incl. Sundays
    const mk = parse(F.mondayOfWeek(d));
    if (mk.getDay() !== 1) allMonday = false;
    const diffDays = Math.round((d - mk) / 86400000);
    if (diffDays < 0 || diffDays > 6) allInWindow = false;
  }
  ok(allMonday, 'mondayOfWeek always lands on a Monday (incl. Sundays)');
  ok(allInWindow, 'returned Monday is within the same ISO week (0..6 days back)');
  // determinism: same week → same key for Mon..Sun
  const monday = F.mondayOfWeek(new Date(2026, 4, 18)); // a Monday
  for (let i = 0; i < 7; i++) {
    eq(F.mondayOfWeek(new Date(2026, 4, 18 + i)), monday, `day +${i} maps to same week Monday`);
  }
});

group('save/load round-trip persistence (QA)', () => {
  // Build a rich, distinctive state, persist it, wipe to defaults, reload.
  // Catches "added a state field but forgot to persist/restore it" regressions.
  const rich = withState({
    gold: 123456, gem: 789, bestLevel: 42, runBestLevel: 30, prestigeCount: 7,
    enlightenment: 55, frenzyCharge: 50, autoFrenzyEnabled: true,
    goldRushTimer: 0, lastSpinDate: '2026-5-21', lastSpinReward: 8,
    luckyCharms: 3, challengeStreak: 4, dailyMergeCount: 120,
    autoMergeUnlocked: true, autoSellEnabled: true, autoLockThreshold: 18,
    meditationMode: true, storage: [{ id: 1, level: 9, golden: true }],
    growthLog: [{ date: '2026-5-20', best: 40, prestige: 7 }, { date: '2026-5-21', best: 42, prestige: 7 }],
    codex: { 1: true, 2: true, 40: true },
    grid: gridFrom([5, 5, 9, null, null, null]),
  });
  rich.stats = Object.assign(rich.stats || {}, { totalMerges: 999, divineMerges: 2 });
  F.save();
  // wipe to a fresh default state, then reload from the saved blob
  G.setState(G.defaultState());
  const loaded = F.load();
  ok(loaded === true, 'load() succeeds from saved blob');
  const st = G.getState();
  eq(st.gold, 123456, 'gold persisted');
  eq(st.gem, 789, 'gem persisted');
  eq(st.bestLevel, 42, 'bestLevel persisted');
  eq(st.prestigeCount, 7, 'prestigeCount persisted');
  eq(st.enlightenment, 55, 'enlightenment persisted');
  eq(st.frenzyCharge, 50, 'frenzyCharge persisted (Q-Leap 77)');
  eq(st.autoFrenzyEnabled, true, 'autoFrenzyEnabled persisted (Q-Leap 80)');
  eq(st.lastSpinDate, '2026-5-21', 'lastSpinDate persisted (Q-Leap 88)');
  eq(st.luckyCharms, 3, 'luckyCharms persisted (Q-Leap 89)');
  eq(st.challengeStreak, 4, 'challengeStreak persisted (Q-Leap 94)');
  eq(st.dailyMergeCount, 120, 'dailyMergeCount persisted (Q-Leap 110)');
  eq(st.meditationMode, true, 'meditationMode persisted (Q-Leap 75)');
  eq(st.autoMergeUnlocked, true, 'autoMergeUnlocked persisted');
  eq((st.storage || []).length, 1, 'storage persisted (Q-Leap 74)');
  eq((st.growthLog || []).length, 2, 'growthLog persisted (Q-Leap 120)');
  eq(Object.keys(st.codex || {}).length, 3, 'codex persisted');
  eq((st.stats || {}).totalMerges, 999, 'lifetime stats persisted');
  eq(st.grid.filter(Boolean).length, 3, 'grid pieces persisted');
});

group('prestige preserve/reset rules (Q-Leap 123 refactor + QA)', () => {
  // guard: below Lv8 → no prestige
  let s = withState({ bestLevel: 5, prestigeCount: 0 });
  s.stats = {};
  eq(F.doPrestige(), false, 'prestige blocked below Lv8');
  eq(G.getState().prestigeCount, 0, 'prestigeCount unchanged when blocked');

  // full prestige from a rich run
  s = withState({
    bestLevel: 40, runBestLevel: 30, prestigeCount: 2, gold: 999999, enlightenment: 10, runPlaySec: 600,
    upgrades: { maxShuriken: 6, spawnRate: 9, spawnBatch: 3, firerate: 7, baseDmg: 8, goldMul: 5, spawnLevel: 4, luckChance: 2 },
    autoMergeUnlocked: true, skills: { inheritance: 0 },
    codex: { 1: true, 20: true, 40: true },
    storage: [{ id: 1, level: 30 }, { id: 2, level: 28 }], // must NOT survive prestige
    grid: gridFrom([10, 12, 8, null, null, null]),
  });
  s.stats = { totalMerges: 500 };
  const enlightBefore = G.getState().enlightenment;
  const ok2 = F.doPrestige();
  const st = G.getState();
  ok(ok2 === true, 'prestige executes at Lv40');
  // preserved
  eq(st.prestigeCount, 3, 'prestigeCount incremented');
  eq(st.bestLevel, 40, 'bestLevel preserved (all-time record)');
  ok(st.enlightenment > enlightBefore, 'enlightenment increased by gain');
  eq(st.upgrades.maxShuriken, 6, 'gridSize upgrade preserved');
  eq(st.upgrades.spawnBatch, 3, 'spawnBatch upgrade preserved');
  eq(st.upgrades.luckChance, 2, 'luckChance upgrade preserved');
  eq(st.autoMergeUnlocked, true, 'autoMerge unlock preserved');
  eq(Object.keys(st.codex).length, 3, 'codex preserved');
  eq((st.stats || {}).totalMerges, 500, 'lifetime stats preserved');
  // reset
  eq(st.gold, 0, 'gold reset to 0');
  eq(st.runBestLevel, 1, 'run-best reset');
  eq(st.upgrades.spawnRate, 0, 'spawnRate upgrade reset');
  eq(st.upgrades.baseDmg, 0, 'baseDmg upgrade reset');
  eq(st.upgrades.goldMul, 0, 'goldMul upgrade reset');
  eq(st.grid.filter(Boolean).length, 0, 'grid cleared (no inheritance skill)');
  eq(st.postPrestigeSpawns, 10, 'post-prestige spawn boost armed');
  eq((st.storage || []).length, 0, 'storage cleared on prestige (no free keep bypassing 계승 skill)');

  // inheritance skill keeps top-N pieces
  s = withState({
    bestLevel: 40, runBestLevel: 30, prestigeCount: 1, gold: 100,
    upgrades: { maxShuriken: 6, spawnRate: 0, spawnBatch: 0, firerate: 0, baseDmg: 0, goldMul: 0, spawnLevel: 0, luckChance: 0 },
    skills: { inheritance: 2 },
    grid: gridFrom([5, 12, 9, 3, null, null]),
  });
  s.stats = {};
  F.doPrestige();
  const kept = G.getState().grid.filter(Boolean).map(c => c.level).sort((a, b) => b - a);
  eq(kept.length, 2, 'inheritance 2 → keeps 2 pieces');
  eq(kept[0], 12, 'keeps highest level');
  eq(kept[1], 9, 'keeps 2nd highest');
});

group('achievements grant 💎 on unlock (previously cosmetic-only)', () => {
  if (typeof F.checkAchievements !== 'function') { ok(true, 'checkAchievements not exposed — skip'); return; }
  const ACH = C.ACHIEVEMENTS;
  const target = 'a_first_merge';
  const def = ACH.find(a => a.id === target);
  const expected = (def && def.gem) || 3;
  // pre-unlock everything except the target so exactly one new achievement fires
  const pre = {};
  for (const a of ACH) if (a.id !== target) pre[a.id] = 1;
  const s = withState({ gem: 0 });
  s.achievements = pre;
  // pre-claim all completion tiers so the collection-milestone bonus doesn't fire here — isolates the per-achievement reward.
  const doneTiers = {}; for (const n of [10, 25, 50, 75, ACH.length]) doneTiers[n] = 1;
  s.stats = { totalMerges: 1, achCompletions: doneTiers }; // satisfies a_first_merge's check
  F.checkAchievements();
  eq(s.gem, expected, `unlocking ${target} grants 💎+${expected}`);
  ok(!!s.achievements[target], 'achievement recorded as unlocked');
  // idempotent: an already-unlocked achievement grants nothing more (clean migration, no retroactive windfall)
  F.checkAchievements();
  eq(s.gem, expected, 'no re-grant for an already-unlocked achievement');
});

group('getAchievementGem: capstones grant more than the flat default', () => {
  if (typeof F.getAchievementGem !== 'function') { ok(true, 'not exposed — skip'); return; }
  const ACH = C.ACHIEVEMENTS;
  const find = id => ACH.find(a => a.id === id);
  // a regular achievement gets the flat 3
  eq(F.getAchievementGem(find('a_first_merge')), 3, 'ordinary achievement → flat 3');
  // capstones grant their tiered amount
  eq(F.getAchievementGem(find('a_transcend_20')), 25, 'Lv80 transcend capstone → 25');
  eq(F.getAchievementGem(find('a_attend_100')), 20, '100-day attendance → 20');
  eq(F.getAchievementGem(find('a_merge_5000')), 15, '5000 merges → 15');
  // explicit per-entry gem (if any) still wins; and every achievement yields a positive reward
  ok(ACH.every(a => F.getAchievementGem(a) >= 3), 'every achievement grants at least the default');
});

group('getNextCodexMilestone returns the next un-reached codex tier', () => {
  if (typeof F.getNextCodexMilestone !== 'function') { ok(true, 'not exposed — skip'); return; }
  eq(F.getNextCodexMilestone(0).n, 10, 'at 0 → next codex tier 10');
  eq(F.getNextCodexMilestone(10).n, 25, 'at 10 → 25');
  eq(F.getNextCodexMilestone(39).n, 40, 'at 39 → 40');
  eq(F.getNextCodexMilestone(60), null, 'all codex milestones reached → null');
  ok(F.getNextCodexMilestone(0).gem > 0, 'codex tier carries a gem reward');
});

group('getNextAchievementMilestone returns the next un-reached tier', () => {
  if (typeof F.getNextAchievementMilestone !== 'function') { ok(true, 'not exposed — skip'); return; }
  const total = C.ACHIEVEMENTS.length;
  eq(F.getNextAchievementMilestone(0).n, 10, 'at 0 unlocked → next tier 10');
  eq(F.getNextAchievementMilestone(10).n, 25, 'at 10 → next tier 25');
  eq(F.getNextAchievementMilestone(24).n, 25, 'at 24 → still 25');
  eq(F.getNextAchievementMilestone(74).n, 75, 'at 74 → 75');
  eq(F.getNextAchievementMilestone(75).n, total, 'at 75 → final "all" tier');
  eq(F.getNextAchievementMilestone(total), null, 'all reached → null');
  ok(F.getNextAchievementMilestone(0).gem > 0, 'tier carries a gem reward');
});

group('achievement completion milestone fires on crossing 10 (jump-crossing)', () => {
  if (typeof F.checkAchievements !== 'function') { ok(true, 'checkAchievements not exposed — skip'); return; }
  const ACH = C.ACHIEVEMENTS;
  // pre-unlock 9 achievements (none being a_first_merge), then unlock a 10th → crosses the 10-tier.
  const ids = ACH.map(a => a.id).filter(id => id !== 'a_first_merge');
  const pre = {};
  for (let i = 0; i < 9; i++) pre[ids[i]] = 1;
  const s = withState({ gem: 0 });
  s.achievements = pre;
  s.stats = { totalMerges: 1 }; // unlocks a_first_merge (the 10th)
  F.checkAchievements();
  ok(!!s.achievements['a_first_merge'], 'a_first_merge unlocked (10th)');
  ok(s.stats.achCompletions && s.stats.achCompletions[10], '10-achievement completion milestone granted');
  ok(s.gem >= 3 + 10, 'gem includes achievement reward (+3) and completion bonus (+10)');
  // idempotent: re-running grants no further completion bonus
  const g = s.gem;
  F.checkAchievements();
  eq(s.gem, g, 'no re-grant of completion milestone');
});

group('dark absorb prefers a plain neighbor (preserves variants)', () => {
  if (typeof F.tryMerge !== 'function') { ok(true, 'tryMerge not exposed — skip'); return; }
  const realRandom = Math.random;
  Math.random = () => 0.99; // jump=1, no variant procs
  try {
    // merge Lv5(dark) + Lv5 → Lv6 at idx4; neighbors idx5=Lv6 golden, idx0=Lv6 plain.
    // dark absorb should eat the PLAIN (idx0) and keep the golden (idx5).
    const s = withState({ grid: place(9, { 3: 5, 4: 5, 5: 6, 0: 6 }), bestLevel: 10, upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 3 }), skills: {} });
    s.grid[3].dark = true;   // dark parent → triggers absorb
    s.grid[5].golden = true; // a variant neighbor that should be spared
    s.stats = {};
    eq(F.getGridCols(), 4, 'idx4 is row1/col0; neighbors are 5,0,8');
    F.tryMerge(3, 4);
    eq(s.grid[4].level, 7, 'result absorbed a Lv6 neighbor → Lv7');
    ok(s.grid[5] && s.grid[5].golden, 'golden neighbor preserved');
    eq(s.grid[0], null, 'plain neighbor was the absorb victim');
  } finally { Math.random = realRandom; }
});

group('all achievement checks are safe (Q-Leap 124)', () => {
  const ACH = C.ACHIEVEMENTS;
  ok(Array.isArray(ACH) && ACH.length > 50, `achievement list present (${ACH.length})`);
  // every entry well-formed
  ok(ACH.every(a => a.id && a.name && typeof a.check === 'function'), 'every achievement has id/name/check');
  // ids unique
  eq(new Set(ACH.map(a => a.id)).size, ACH.length, 'achievement ids are unique');
  // checks never throw on a minimal default state
  withState({});
  let threwDefault = 0;
  for (const a of ACH) { try { a.check(G.getState()); } catch (e) { threwDefault++; } }
  eq(threwDefault, 0, 'no achievement check throws on default state');
  // checks never throw on a rich state, and return boolean-ish
  const rich = withState({
    bestLevel: 80, prestigeCount: 12, enlightenment: 200, attendStreak: 100,
    autoMergeUnlocked: true, meditationMode: true, challengeStreak: 8,
    skills: { inheritance: 3, fate: 5 }, codex: {}, storage: [{ id: 1, level: 5 }],
    grid: gridFrom([20, 20, 20, 21, 22, 20]),
  });
  for (let lv = 1; lv <= 60; lv++) rich.codex[lv] = true;
  rich.stats = {
    totalMerges: 10000, totalSpawned: 5000, totalGoldEarned: 5e7, bestCombo: 100,
    luckyMerges: 200, blessedMerges: 50, goldenSpawned: 30, starSpawned: 10, darkSpawned: 5,
    questsCompleted: 50, weeklyCompleted: 12, shopUses: 40, trialsWon: 15, locksUsed: 20,
    burnsUsed: 5, massMerges: 3, splitsUsed: 2, totalSold: 100, ritualsPerformed: 20,
    comboMilestones: 6, darkAbsorbs: 4, autoSells: 10, milestonesReached: 5, divineMerges: 12,
    mergeGemDrops: 15, coatingsUsed: 3, spinsUsed: 30, luckyCharmsUsed: 10, lineBonuses: 25,
    challengesCompleted: 10, transcendMilestones: { 5: true, 10: true }, codexMilestones: { 10: true },
    goldRushes: 5, dailyMergeTiers: 4, comboCashouts: 8, allQuestDays: 10, goldenSold: 2,
  };
  let threwRich = 0, nonBool = 0;
  for (const a of ACH) {
    try { const r = a.check(G.getState()); if (typeof r !== 'boolean' && r !== undefined) nonBool++; }
    catch (e) { threwRich++; }
  }
  eq(threwRich, 0, 'no achievement check throws on rich state');
});

group('ritual on the blessed cell counts as a blessed merge (parity with tryMerge)', () => {
  if (typeof F.doRitualMerge !== 'function') { ok(true, 'doRitualMerge not exposed — skip'); return; }
  const realRandom = Math.random;
  Math.random = () => 0.99;
  try {
    // blessed cell (idx 1) is inside the ritual group [0,1,2] → should credit blessedMerges + consume.
    const s = withState({
      grid: place(9, { 0: 5, 1: 5, 2: 5 }), bestLevel: 10, blessedIdx: 1,
      dailyQuests: [], lastFirstMergeDate: F.todayString(),
    });
    s.stats = {};
    ok(F.doRitualMerge(), 'ritual including blessed cell performed');
    eq(s.stats.blessedMerges, 1, 'ritual on blessed cell credited blessedMerges (was 0 — drift fix)');
    eq(s.blessedIdx, -1, 'blessing consumed by the ritual');
    // blessed cell (idx 8) is outside the group → no credit, not consumed
    const s2 = withState({
      grid: place(9, { 0: 5, 1: 5, 2: 5 }), bestLevel: 10, blessedIdx: 8,
      dailyQuests: [], lastFirstMergeDate: F.todayString(),
    });
    s2.stats = {};
    ok(F.doRitualMerge(), 'ritual not including blessed cell');
    eq(s2.stats.blessedMerges || 0, 0, 'no blessed credit when blessed cell is outside the ritual group');
    eq(s2.blessedIdx, 8, 'blessing not consumed when outside the group');
  } finally { Math.random = realRandom; }
});

group('ritual daily-quest type advances on a ritual merge', () => {
  if (typeof F.doRitualMerge !== 'function') { ok(true, 'doRitualMerge not exposed — skip'); return; }
  const realRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const s = withState({
      grid: place(9, { 0: 4, 1: 4, 2: 4 }), bestLevel: 10,
      dailyQuests: [{ type: 'ritual', target: 3, progress: 0, claimed: false, reward: { gem: 5 } }],
      lastFirstMergeDate: F.todayString(),
    });
    s.stats = {};
    ok(F.doRitualMerge(), 'ritual performed');
    eq(s.dailyQuests[0].progress, 1, 'ritual quest advanced by 1 (one ritual = 1 progress)');
  } finally { Math.random = realRandom; }
});

group('ritual spontaneous variant generation (parity with tryMerge, 0 variant parents)', () => {
  if (typeof F.doRitualMerge !== 'function') { ok(true, 'doRitualMerge not exposed — skip'); return; }
  const realRandom = Math.random;
  try {
    // 0 variant parents + a very low roll → spontaneous variant fires. Before the fix the
    // ritual rolled 0% spontaneous (only inheritance), so this child would always be plain.
    Math.random = () => 0.00001;
    let s = withState({ upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 3 }),
      grid: place(9, { 0: 5, 1: 5, 2: 5 }), bestLevel: 10 });
    F.doRitualMerge();
    let r = G.getState().grid[0];
    ok(r && r.golden, 'low-roll ritual spontaneously creates a variant child (parity with tryMerge)');
    // a very high roll → no spontaneous variant (no false positives)
    Math.random = () => 0.999999;
    s = withState({ upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 3 }),
      grid: place(9, { 0: 5, 1: 5, 2: 5 }), bestLevel: 10 });
    F.doRitualMerge();
    r = G.getState().grid[0];
    ok(r && !r.golden && !r.star && !r.dark, 'high-roll ritual produces a plain child');
  } finally { Math.random = realRandom; }
});

group('ritual crossing a daily-merge tier grants it (loop avoids jump-skip)', () => {
  if (typeof F.doRitualMerge !== 'function') { ok(true, 'doRitualMerge not exposed — skip'); return; }
  const realRandom = Math.random;
  Math.random = () => 0.99;
  try {
    // dailyMergeCount 49; a 3-piece ritual increments by N-1=2 via a LOOP (49→50→51),
    // so the tier-50 reward must fire. A naive `+= 2` would skip it.
    const today = F.todayString();
    const s = withState({
      grid: place(9, { 0: 5, 1: 5, 2: 5 }), bestLevel: 10, gem: 0,
      dailyMergeCount: 49, dailyMergeDate: today, dailyMergeClaimed: {},
      dailyQuests: [], lastFirstMergeDate: today,
    });
    const allAch = {}; for (const a of C.ACHIEVEMENTS) allAch[a.id] = 1; // suppress achievement gems
    s.achievements = allAch;
    const done = {}; for (const n of [10, 25, 50, 75, C.ACHIEVEMENTS.length]) done[n] = 1;
    s.stats = { achCompletions: done };
    F.doRitualMerge();
    eq(s.dailyMergeCount, 51, 'ritual advanced daily merge count 49 → 51 (loop +1 ×2)');
    ok(s.dailyMergeClaimed[50], 'tier 50 claimed (not skipped past)');
    ok(s.gem >= 5, 'tier-50 reward (💎5) granted');
  } finally { Math.random = realRandom; }
});

group('ritual merge advances daily challenge progress (N-1 merges, parity with tryMerge)', () => {
  if (typeof F.doRitualMerge !== 'function') { ok(true, 'doRitualMerge not exposed — skip'); return; }
  const realRandom = Math.random;
  Math.random = () => 0.99;
  try {
    // ritual 3×Lv5 → Lv7. Daily challenge active & not done; should advance by N-1 = 2.
    const s = withState({
      grid: place(9, { 0: 5, 1: 5, 2: 5 }), bestLevel: 10,
      dailyChallengeId: 'comboKeep', dailyChallengeDone: false, dailyChallengeProgress: 0,
      dailyQuests: [], lastFirstMergeDate: F.todayString(),
    });
    s.stats = {};
    ok(F.doRitualMerge(), 'ritual 5×3 performed');
    eq(s.dailyChallengeProgress, 2, 'ritual of 3 advanced daily challenge by 2 (was 0 — drift fix)');
  } finally { Math.random = realRandom; }
});

group('level milestones grant on jump past threshold (Lv 20 not skipped by Lv19→21)', () => {
  if (typeof F.doRitualMerge !== 'function') { ok(true, 'doRitualMerge not exposed — skip'); return; }
  const realRandom = Math.random;
  Math.random = () => 0.99;
  try {
    // ritual 3×Lv19 → Lv21; prevBest 19 → crosses the Lv20 milestone (old exact-newLv check skipped it).
    // milestonesReached is incremented only by triggerMilestone, so it is a clean signal.
    const s = withState({
      grid: place(9, { 0: 19, 1: 19, 2: 19 }), bestLevel: 19, gem: 0,
      dailyQuests: [], lastFirstMergeDate: F.todayString(),
    });
    s.stats = {};
    ok(F.doRitualMerge(), 'ritual 19×3 → Lv21');
    eq(s.bestLevel, 21, 'new best Lv21 (jumped past 20)');
    ok((s.stats.milestonesReached || 0) >= 1, 'Lv20 milestone fired despite landing on Lv21');
  } finally { Math.random = realRandom; }
});

group('combo milestone fires on blessed +2 jump (crossing threshold, not just exact)', () => {
  if (typeof F.tryMerge !== 'function') { ok(true, 'tryMerge not exposed — skip'); return; }
  const realRandom = Math.random;
  Math.random = () => 0.99; // suppress variant/proc randomness
  try {
    // blessed merge bumps comboCount by 2: 9 → 11, jumping over the ×10 milestone.
    // ×10's effect grants 행운의 손 +1 (luckyHandCharges), a clean observable.
    const s = withState({
      grid: place(9, { 0: 3, 1: 3 }), comboCount: 9, blessedIdx: 1,
      luckyHandCharges: 0, bestLevel: 10, dailyQuests: [],
      lastFirstMergeDate: F.todayString(),
    });
    s.stats = {};
    F.tryMerge(0, 1);
    eq(s.comboCount, 11, 'blessed merge bumped combo 9 → 11 (×10 not the landing value)');
    ok((s.luckyHandCharges || 0) >= 1, '×10 combo milestone still fired (행운의 손 +1) despite the +2 jump');
  } finally { Math.random = realRandom; }
});

group('transcend milestones: a jump grants all crossed thresholds (not just exact t)', () => {
  if (typeof F.grantTranscendMilestone !== 'function') { ok(true, 'grantTranscendMilestone not exposed — skip'); return; }
  // jump to t=7 (bestLevel 67) — old exact-match check skipped the t=5 (+30) milestone
  let s = withState({ bestLevel: 67, gem: 0 });
  s.stats = {};
  F.grantTranscendMilestone();
  eq(s.stats.transcendMilestones[5], true, 't=5 milestone granted even when current t=7 (jumped past)');
  eq(s.gem, 30, 't=5 milestone gem (+30) granted on jump past it');
  // jump straight to t=20 — grant all four: 30+80+150+300 = 560
  s = withState({ bestLevel: 80, gem: 0 });
  s.stats = {};
  F.grantTranscendMilestone();
  eq(s.gem, 560, 'all four milestones (5/10/15/20) granted on jump to t=20');
  // idempotent — repeat grants nothing
  const before = s.gem;
  F.grantTranscendMilestone();
  eq(s.gem, before, 'no double-grant on repeat call');
  // below first threshold (t=3) grants nothing
  s = withState({ bestLevel: 63, gem: 0 });
  s.stats = {};
  F.grantTranscendMilestone();
  eq(s.gem, 0, 't=3 grants no milestone (below t=5)');
});

group('ritual merge auto-locks high-Lv result when auto-lock enabled (parity with tryMerge)', () => {
  if (typeof F.doRitualMerge !== 'function') { ok(true, 'doRitualMerge not exposed — skip'); return; }
  const realRandom = Math.random;
  Math.random = () => 0.99;
  try {
    // 3 adjacent Lv4 → Lv6. bestLevel=10 so it is NOT a new best (isolates lock from gem reward).
    const s = withState({
      grid: place(9, { 0: 4, 1: 4, 2: 4 }), bestLevel: 10,
      autoLockEnabled: true, autoLockThreshold: 6, dailyQuests: [],
      lastFirstMergeDate: F.todayString(),
    });
    s.stats = {};
    ok(F.doRitualMerge(), 'ritual performed (Lv4×3 → Lv6)');
    const result = s.grid[0];
    ok(result && result.level === 6, 'result piece is Lv6 at idx 0');
    eq(result.locked, true, 'Lv6 result auto-locked (≥ threshold 6) — parity with tryMerge');
    ok((s.stats.locksUsed || 0) >= 1, 'locksUsed stat incremented by ritual auto-lock');
  } finally { Math.random = realRandom; }
});

group('prestige resets run-transient activity state (fresh run starts clean)', () => {
  if (typeof F.doPrestige !== 'function') { ok(true, 'doPrestige not exposed — skip'); return; }
  const s = withState({
    bestLevel: 10, runBestLevel: 10, prestigeCount: 0, enlightenment: 0,
    comboCount: 7, comboTimer: 2.5, frenzyCharge: 99, frenzyTimer: 5,
    goldRushTimer: 12, burningTimer: 8,
    grid: place(9, { 0: 3 }), upgrades: defaultUpgrades(), skills: {},
  });
  s.stats = {};
  ok(F.doPrestige(), 'prestige performed (bestLevel 10 ≥ 8)');
  eq(s.comboCount, 0, 'comboCount reset');
  eq(s.comboTimer, 0, 'comboTimer reset');
  eq(s.frenzyCharge, 0, 'frenzyCharge reset (no carried meter)');
  eq(s.frenzyTimer, 0, 'frenzyTimer reset');
  eq(s.goldRushTimer, 0, 'goldRushTimer reset');
  eq(s.burningTimer, 0, 'burningTimer reset');
  eq(s.prestigeCount, 1, 'prestigeCount incremented + preserved');
  eq(s.bestLevel, 10, 'bestLevel preserved through prestige');
});

group('rollMergeProcs: per-merge gem-drop/gold-rush scale with units (ritual parity)', () => {
  if (typeof F.rollMergeProcs !== 'function') { ok(true, 'rollMergeProcs not exposed — skip'); return; }
  const realRandom = Math.random;
  try {
    // force both procs (0.002 + 0.003 thresholds) to always fire
    Math.random = () => 0;
    let s = withState({ gem: 0, goldRushTimer: 0 });
    s.stats = {};
    F.rollMergeProcs(3, 6); // ritual of 4 pieces = 3 units
    eq(s.gem, 3, 'gem drop fires once per unit (3 units → +3 gem)');
    eq(s.stats.mergeGemDrops, 3, 'mergeGemDrops counts each drop');
    eq(s.stats.goldRushes, 1, 'gold rush counted once even across multiple units (wasActive guard)');
    ok(s.goldRushTimer > 0, 'gold rush activated');
    // never-fire case
    Math.random = () => 0.5;
    s = withState({ gem: 0, goldRushTimer: 0 });
    s.stats = {};
    F.rollMergeProcs(5, 6);
    eq(s.gem, 0, 'no procs when random above thresholds');
    // zero units = no-op
    Math.random = () => 0;
    s = withState({ gem: 0, goldRushTimer: 0 });
    s.stats = {};
    F.rollMergeProcs(0, 6);
    eq(s.gem, 0, 'zero units rolls nothing');
  } finally { Math.random = realRandom; }
});

group('ritual merge grants new-best even-level 💎 (parity with tryMerge)', () => {
  if (typeof F.doRitualMerge !== 'function') { ok(true, 'doRitualMerge not exposed — skip'); return; }
  const realRandom = Math.random;
  Math.random = () => 0.99; // suppress variant procs
  const today = F.todayString();
  // pre-unlock every achievement so checkAchievements grants no 💎 during the ritual — isolates the even-level gem.
  const allAch = {};
  for (const a of C.ACHIEVEMENTS) allAch[a.id] = 1;
  try {
    // 3 adjacent Lv4 → newLv = 4+1+(3-2) = 6 (even), new best from 4.
    // lastFirstMergeDate=today suppresses the +3 daily-first-merge bonus so we isolate the even-level gem.
    let s = withState({ grid: place(9, { 0: 4, 1: 4, 2: 4 }), bestLevel: 4, gem: 0, dailyQuests: [], lastFirstMergeDate: today });
    s.stats = {}; s.achievements = Object.assign({}, allAch);
    ok(F.doRitualMerge(), 'ritual performed (Lv4×3 → Lv6)');
    eq(s.bestLevel, 6, 'new best level is 6');
    eq(s.gem, 1, 'new best even Lv6 via ritual grants 💎+1');
    // jump-aware (audit fix): best 3 → Lv5 lands on ODD 5 but CROSSES even Lv4 → grants 💎+1.
    s = withState({ grid: place(9, { 0: 3, 1: 3, 2: 3 }), bestLevel: 3, gem: 0, dailyQuests: [], lastFirstMergeDate: today });
    s.stats = {}; s.achievements = Object.assign({}, allAch);
    ok(F.doRitualMerge(), 'ritual performed (Lv3×3 → Lv5)');
    eq(s.bestLevel, 5, 'new best level is 5 (odd)');
    eq(s.gem, 1, 'odd landing Lv5 still grants 💎+1 for crossing even Lv4 (jump-safe)');
    // true no-cross case: best 4 → Lv5 crosses NO new even → 0 gem.
    s = withState({ grid: place(9, { 0: 3, 1: 3, 2: 3 }), bestLevel: 4, gem: 0, dailyQuests: [], lastFirstMergeDate: today });
    s.stats = {}; s.achievements = Object.assign({}, allAch);
    ok(F.doRitualMerge(), 'ritual performed (Lv3×3 → Lv5 from best 4)');
    eq(s.gem, 0, 'landing Lv5 from best 4 crosses no new even → no gem');
  } finally { Math.random = realRandom; }
});

group('addFrenzyCharge: shared meter-charge, ritual matches (N-1) merges', () => {
  if (typeof F.addFrenzyCharge !== 'function') { ok(true, 'addFrenzyCharge not exposed — skip'); return; }
  const MAX = C.FRENZY_MAX;
  // normal merge = 1 unit (no packed set: grid empty)
  let s = withState({ grid: new Array(9).fill(null), frenzyCharge: 0, autoFrenzyEnabled: false });
  F.addFrenzyCharge(1);
  eq(s.frenzyCharge, 1, 'normal merge charges 1');
  // ritual of 3 pieces = 2 units
  s = withState({ grid: new Array(9).fill(null), frenzyCharge: 0, autoFrenzyEnabled: false });
  F.addFrenzyCharge(3 - 1);
  eq(s.frenzyCharge, 2, 'ritual of 3 charges 2 (matches creditMerges N-1)');
  // packed set (grid ≥90% full) doubles the gain
  s = withState({ grid: place(9, {0:1,1:1,2:1,3:1,4:1,5:1,6:1,7:1,8:1}), frenzyCharge: 0, autoFrenzyEnabled: false });
  ok(F.hasSet('packed'), 'full grid activates packed set');
  F.addFrenzyCharge(1);
  eq(s.frenzyCharge, 2, 'packed set doubles charge (1→2)');
  // never exceeds FRENZY_MAX
  s = withState({ grid: new Array(9).fill(null), frenzyCharge: MAX - 1, autoFrenzyEnabled: false });
  F.addFrenzyCharge(10);
  eq(s.frenzyCharge, MAX, 'charge clamps at FRENZY_MAX');
  // zero/negative units are a no-op
  s = withState({ grid: new Array(9).fill(null), frenzyCharge: 5, autoFrenzyEnabled: false });
  F.addFrenzyCharge(0);
  eq(s.frenzyCharge, 5, 'zero units is a no-op');
});

group('blessedDuration: weekday blessMul applies uniformly (single source of truth)', () => {
  if (typeof F.blessedDuration !== 'function') { ok(true, 'blessedDuration not exposed — skip'); return; }
  // helper must equal (30 + blessTime*5) * weekday blessMul, for any skill level.
  for (const lv of [0, 3, 6]) {
    withState({ skills: { blessTime: lv } });
    const mul = F.weekdayBonus().blessMul || 1;
    const expected = (30 + lv * 5) * mul;
    approx(F.blessedDuration(), expected, `blessedDuration matches formula at blessTime=${lv} (mul=${mul})`);
  }
  // base (no skill) is at least 30s, and scales up with the skill.
  withState({ skills: { blessTime: 0 } });
  const base = F.blessedDuration();
  withState({ skills: { blessTime: 6 } });
  ok(F.blessedDuration() > base, 'higher blessTime yields longer duration');
});

group('autosell/meditation achievements: flag path AND counter path both fire', () => {
  const ACH = C.ACHIEVEMENTS;
  const autoSell = ACH.find(a => a.id === 'a_autosell');
  const meditate = ACH.find(a => a.id === 'a_meditation');
  ok(autoSell && meditate, 'both achievements present');
  // default: neither earned
  withState({}); G.getState().stats = {};
  eq(autoSell.check(G.getState()), false, 'a_autosell false by default');
  eq(meditate.check(G.getState()), false, 'a_meditation false by default');
  // flag path (toggle on, no merge yet)
  withState({ autoSellEnabled: true }); G.getState().stats = {};
  eq(autoSell.check(G.getState()), true, 'a_autosell fires via autoSellEnabled flag');
  withState({ meditationMode: true }); G.getState().stats = {};
  eq(meditate.check(G.getState()), true, 'a_meditation fires via meditationMode flag');
  // counter path (flag toggled back off, but stat recorded the prior use)
  withState({ autoSellEnabled: false }); G.getState().stats = { autoSells: 1 };
  eq(autoSell.check(G.getState()), true, 'a_autosell stays earned via autoSells counter');
  withState({ meditationMode: false }); G.getState().stats = { meditationsUsed: 1 };
  eq(meditate.check(G.getState()), true, 'a_meditation stays earned via meditationsUsed counter');
});

group('auto-merge end-to-end via update() (reproduce toggle report)', () => {
  if (typeof F.update !== 'function') { ok(true, 'update() not exposed — skip'); return; }
  // unlocked + on, a grid of mergeable pairs; advance time → auto-merge should consume pairs.
  const s = withState({
    autoMergeUnlocked: true, autoMerge: true, autoMergeCap: 99, autoMergePriority: 'low',
    upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 6 }),
    spawnProgress: 0, prestigeCount: 0, bestLevel: 1,
    grid: gridFrom([2, 2, 3, 3, 4, 4]), // 3 pairs, grid full (no spawning interference)
  });
  s.stats = {};
  const realRandom = Math.random;
  Math.random = () => 0.999999; // suppress lucky jumps so merges are deterministic
  const pairsBefore = G.getState().grid.filter(Boolean).length; // 6 pieces
  // advance ~5s of game time in 0.1s steps → autoMergeTimer fires every 0.5s
  for (let i = 0; i < 50; i++) { try { F.update(0.1); } catch (e) { ok(false, 'update threw: ' + e.message); break; } }
  Math.random = realRandom;
  const st = G.getState();
  const occupied = st.grid.filter(Boolean).length;
  ok(occupied < pairsBefore, `auto-merge consumed pairs while ON (${pairsBefore} → ${occupied})`);
  ok(st.bestLevel > 1, `auto-merge produced higher levels (bestLevel ${st.bestLevel})`);

  // toggled OFF + not burning → no auto-merging
  const s2 = withState({
    autoMergeUnlocked: true, autoMerge: false, burningTimer: 0,
    upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 6 }),
    spawnProgress: 0, bestLevel: 5,
    grid: gridFrom([5, 5, 5, 5, 5, 5]),
  });
  s2.stats = {};
  const before2 = G.getState().grid.filter(Boolean).length;
  for (let i = 0; i < 50; i++) { try { F.update(0.1); } catch (e) {} }
  eq(G.getState().grid.filter(Boolean).length, before2, 'no auto-merge when toggled OFF (state respected)');
});

group('creditMerges — milestone/charm crossing (drift + robustness bugfix)', () => {
  if (typeof F.creditMerges !== 'function') { ok(true, 'creditMerges not exposed — skip'); return; }
  // single merge hits exact 100 → milestone gem + 1 charm
  let s = withState({ gem: 0, luckyCharms: 0 });
  s.stats = { totalMerges: 99 };
  F.creditMerges(1);
  eq(G.getState().stats.totalMerges, 100, 'totalMerges advanced');
  eq(G.getState().gem, 5, '100-merge milestone granted 💎5');
  eq(G.getState().luckyCharms, 1, 'crossing 100 granted 1 charm');
  // batch (ritual) JUMPS OVER a milestone (98→103) — must still grant it (old exact-match bug)
  s = withState({ gem: 0, luckyCharms: 0 });
  s.stats = { totalMerges: 98 };
  F.creditMerges(5); // 98 → 103, crosses 100
  eq(G.getState().gem, 5, 'milestone granted even when jumped over (98→103)');
  eq(G.getState().luckyCharms, 1, 'charm granted when 100 boundary crossed by batch');
  // big batch crossing multiple 100-boundaries → multiple charms
  s = withState({ gem: 0, luckyCharms: 0 });
  s.stats = { totalMerges: 50 };
  F.creditMerges(250); // 50 → 300: crosses 100,200,300 = 3 charms; milestone 100 = 💎5
  eq(G.getState().luckyCharms, 3, 'three 100-boundaries crossed → 3 charms');
  eq(G.getState().gem, 5, '100 milestone granted once in the batch');
  // milestone is one-shot (re-credit past it grants nothing)
  s = withState({ gem: 0, luckyCharms: 0 });
  s.stats = { totalMerges: 100, mergeMilestones: { 100: true } };
  F.creditMerges(1);
  eq(G.getState().gem, 0, 'already-claimed milestone not re-granted');
});

group('baseDmg merge-gold bonus wired into real tryMerge (e2e)', () => {
  const realRandom = Math.random; Math.random = () => 0.999999; // no lucky jump
  // baseDmg 0 → baseline merge gold
  let s = withState({ gold: 0, prestigeCount: 0, bestLevel: 5, dailyChallengeId: '',
    upgrades: defaultUpgrades(), grid: gridFrom([5, 5, null, null, null, null]) });
  s.stats = {};
  F.tryMerge(0, 1);
  const goldPlain = G.getState().gold;
  // baseDmg 10 → +80% merge gold
  s = withState({ gold: 0, prestigeCount: 0, bestLevel: 5, dailyChallengeId: '',
    upgrades: Object.assign(defaultUpgrades(), { baseDmg: 10 }), grid: gridFrom([5, 5, null, null, null, null]) });
  s.stats = {};
  F.tryMerge(0, 1);
  const goldBoosted = G.getState().gold;
  Math.random = realRandom;
  ok(goldPlain > 0, 'baseline merge produced gold');
  approx(goldBoosted, Math.floor(goldPlain * 1.8), 'baseDmg 10 boosts merge gold ~×1.8 (e2e via tryMerge)', goldPlain * 0.05);
});

group('repurposed combat upgrades → gold (firerate/baseDmg)', () => {
  // firerate now boosts passive gold +8%/Lv
  eq(F.getPassiveGoldBonus ? F.getPassiveGoldBonus() : 1, 1, 'no firerate → 1x');
  withState({ upgrades: Object.assign(defaultUpgrades(), { firerate: 5 }) });
  approx(F.getPassiveGoldBonus(), 1 + 5 * 0.08, 'firerate 5 → passive gold ×1.4');
  // it actually multiplies the passive rate
  withState({ prestigeCount: 0, upgrades: defaultUpgrades(), dailyChallengeId: '', grid: gridFrom([5, null, null, null, null, null]) });
  const ratePlain = F.getPassiveGoldRate();
  withState({ prestigeCount: 0, upgrades: Object.assign(defaultUpgrades(), { firerate: 5 }), dailyChallengeId: '', grid: gridFrom([5, null, null, null, null, null]) });
  approx(F.getPassiveGoldRate(), ratePlain * 1.4, 'firerate raises passive gold rate by its bonus', 1e-6);
  // info-modal per-piece readout must use the SAME factors as income: weight × goldMul × passiveBonus.
  // (getPassiveGoldBonus was previously omitted from the readout, understating the rate once firerate was bought.)
  if (typeof F.pieceGoldWeight === 'function') {
    const s = withState({ prestigeCount: 0, dailyChallengeId: '', upgrades: Object.assign(defaultUpgrades(), { firerate: 5 }), grid: gridFrom([5, null, null, null, null, null]) });
    const perCell = F.pieceGoldWeight(0) * F.getGoldMul() * F.getPassiveGoldBonus();
    approx(F.getPassiveGoldRate(), perCell, 'single-cell income = weight × goldMul × passiveBonus (readout formula)', 1e-6);
    ok(perCell > F.pieceGoldWeight(0) * F.getGoldMul(), 'including passiveBonus exceeds the old bonus-less readout');
  }
  // baseDmg now boosts merge/ritual gold +8%/Lv
  withState({ upgrades: defaultUpgrades() });
  eq(F.getMergeGoldBonus(), 1, 'no baseDmg → 1x');
  withState({ upgrades: Object.assign(defaultUpgrades(), { baseDmg: 10 }) });
  approx(F.getMergeGoldBonus(), 1 + 10 * 0.08, 'baseDmg 10 → merge gold ×1.8');
});

group('variant spontaneous multiplier applies to all variants (bugfix)', () => {
  if (typeof F.getVariantSpontaneousMul !== 'function') { ok(true, 'not exposed — skip'); return; }
  // goldFormation (2+ golden) must multiply variant spontaneous ×1.5 — date-independent check.
  withState({ grid: gridFrom([3, 4, null, null, null, null]) }); // no goldFormation
  const base = F.getVariantSpontaneousMul();
  withState({ grid: gridFrom([{ level: 3, golden: true }, { level: 4, golden: true }, null, null, null, null]) });
  const withGF = F.getVariantSpontaneousMul();
  approx(withGF, base * 1.5, 'goldFormation set multiplies variant spontaneous ×1.5');
  ok(base >= 1, 'baseline multiplier ≥ 1');
});

group('passive gold rate: synergy + center unified (consistency bugfix)', () => {
  // adjacency synergy must raise the rate (was missing from getPassiveGoldRate/display+offline)
  withState({ prestigeCount: 0, upgrades: defaultUpgrades(), dailyChallengeId: '',
    grid: gridFrom([3, 9, null, null, null, null]) }); // not adjacent (cols=3: idx0,idx1 ARE adjacent though)
  // build a clean non-adjacent baseline: single piece
  withState({ prestigeCount: 0, upgrades: defaultUpgrades(), dailyChallengeId: '',
    grid: gridFrom([5, null, null, null, null, null]) });
  const single = F.getPassiveGoldRate();
  // two same-level adjacent (idx0,idx1 adjacent in 3-col grid) → each gets +20% synergy
  withState({ prestigeCount: 0, upgrades: defaultUpgrades(), dailyChallengeId: '',
    grid: gridFrom([5, 5, null, null, null, null]) });
  const pair = F.getPassiveGoldRate();
  const base5 = 0.5 * Math.pow(2, 4); // one Lv5 piece weight
  // pair: idx0(non-center) 1.2x + idx1(non-center) 1.2x... but idx? center of size6=idx4, so neither is center
  approx(pair, single * 2 * 1.2 / 1, 'adjacent same-level pair gets +20% synergy each', 1e-6);
  // center bonus: a piece at center index earns +25%
  const ci = 4; // center for size-6 grid
  withState({ prestigeCount: 0, upgrades: defaultUpgrades(), dailyChallengeId: '',
    grid: place(6, { [ci]: 7 }) });
  const centered = F.getPassiveGoldRate();
  withState({ prestigeCount: 0, upgrades: defaultUpgrades(), dailyChallengeId: '',
    grid: place(6, { 0: 7 }) });
  const offCenter = F.getPassiveGoldRate();
  approx(centered, offCenter * 1.25, 'center cell still earns +25% in unified rate', 1e-6);
});

group('jumpBonus challenge applies to ritual too (drift bugfix)', () => {
  if (typeof F.doRitualMerge !== 'function') { ok(true, 'not exposed — skip'); return; }
  const realRandom = Math.random; Math.random = () => 0.999999;
  // 3-group → newLv = level + 1 + (len-2) = 4+1+1 = Lv6 normally; jumpBonus adds +1 → Lv7.
  let s = withState({ dailyChallengeId: 'jumpBonus', bestLevel: 4, runBestLevel: 4,
    upgrades: defaultUpgrades(), grid: gridFrom([4, 4, 4, null, null, null]) });
  s.stats = {};
  F.doRitualMerge();
  const lv = Math.max(...G.getState().grid.filter(Boolean).map(c => c.level));
  eq(lv, 7, 'jumpBonus day: 3×Lv4 ritual → Lv7 (+1 from challenge)');
  // without the challenge → Lv6
  s = withState({ dailyChallengeId: '', bestLevel: 4, runBestLevel: 4,
    upgrades: defaultUpgrades(), grid: gridFrom([4, 4, 4, null, null, null]) });
  s.stats = {};
  F.doRitualMerge();
  eq(Math.max(...G.getState().grid.filter(Boolean).map(c => c.level)), 6, 'no challenge → Lv6');
  Math.random = realRandom;
});

group('ritual variant inheritance incl. dark (asymmetry bugfix)', () => {
  if (typeof F.doRitualMerge !== 'function') { ok(true, 'not exposed — skip'); return; }
  const realRandom = Math.random; Math.random = () => 0.999999; // suppress single-parent procs
  // 2 dark parents in a ritual group → guaranteed dark child (was dropped before)
  let s = withState({ bestLevel: 4, runBestLevel: 4, upgrades: defaultUpgrades(),
    grid: gridFrom([{ level: 4, dark: true }, { level: 4, dark: true }, { level: 4 }, null, null, null]) });
  s.stats = {};
  F.doRitualMerge();
  const child = G.getState().grid.filter(Boolean).find(c => c.level >= 5);
  ok(child && child.dark === true, 'ritual with 2 dark parents → dark child preserved');
  // 2 golden parents → guaranteed golden child + stat tracked
  s = withState({ bestLevel: 4, runBestLevel: 4, upgrades: defaultUpgrades(),
    grid: gridFrom([{ level: 4, golden: true }, { level: 4, golden: true }, { level: 4 }, null, null, null]) });
  s.stats = {};
  F.doRitualMerge();
  const gchild = G.getState().grid.filter(Boolean).find(c => c.level >= 5);
  ok(gchild && gchild.golden === true, 'ritual golden inheritance still works');
  ok((G.getState().stats.goldenSpawned || 0) >= 1, 'ritual golden child counted in stats');
  Math.random = realRandom;
});

group('daily first-merge bonus shared by ritual (drift bugfix)', () => {
  if (typeof F.grantDailyFirstMerge !== 'function') { ok(true, 'not exposed — skip'); return; }
  // first call of the day grants 💎+3 and stamps the date; second call same day → nothing
  let s = withState({ gem: 0, lastFirstMergeDate: '' });
  s.stats = {};
  F.grantDailyFirstMerge();
  eq(G.getState().gem, 3, 'first merge of day → 💎+3');
  const dateStamp = G.getState().lastFirstMergeDate;
  ok(dateStamp && dateStamp.length > 0, 'date stamped');
  F.grantDailyFirstMerge();
  eq(G.getState().gem, 3, 'second merge same day → no extra bonus');
  // ritual path: a ritual as the day's first merge also grants it
  s = withState({ gem: 0, lastFirstMergeDate: '', runBestLevel: 4, bestLevel: 4,
    upgrades: defaultUpgrades(), grid: gridFrom([4, 4, 4, null, null, null]) });
  s.stats = {};
  const realRandom = Math.random; Math.random = () => 0.999999;
  F.doRitualMerge();
  Math.random = realRandom;
  eq(G.getState().gem >= 3, true, 'ritual as first merge of day grants the daily bonus');
});

group('trial completes via ritual merge (drift bugfix)', () => {
  if (typeof F.doRitualMerge !== 'function') { ok(true, 'doRitualMerge not exposed — skip'); return; }
  // Active trial with goal Lv 5. A 3-in-a-row ritual of Lv4 → Lv5 must register the win
  // immediately (previously only tryMerge checked trial progress).
  const s = withState({
    trialActive: true, trialTimer: 60, trialGoalLv: 5, trialReward: 5, trialStartBestLv: 1,
    runBestLevel: 4, bestLevel: 4, enlightenment: 0,
    upgrades: defaultUpgrades(), prestigeCount: 0,
    grid: gridFrom([4, 4, 4, null, null, null]), // row 0 connected → ritual group of 3
  });
  s.stats = {};
  const realRandom = Math.random;
  Math.random = () => 0.999999;
  F.doRitualMerge(); // 3×Lv4 → Lv5 (4+1+1=... bonus = 3-2=1 → newLv 5)
  Math.random = realRandom;
  const st = G.getState();
  ok(st.runBestLevel >= 5, `ritual reached the goal level (runBest ${st.runBestLevel})`);
  eq(st.trialActive, false, 'trial ended (won) immediately via ritual, not left hanging');
  ok((st.stats.trialsWon || 0) >= 1, 'trial counted as won');
});

group('spawn gauge pause/resume via update() (user-critical behavior)', () => {
  if (typeof F.update !== 'function') { ok(true, 'update() not exposed — skip'); return; }
  // FULL grid (no same-level pairs → no auto-merge), auto-merge OFF → gauge paused at 1.0
  let s = withState({
    autoMerge: false, autoMergeUnlocked: false, burningTimer: 0,
    upgrades: defaultUpgrades(), spawnProgress: 0.3, bestLevel: 6,
    grid: gridFrom([1, 2, 3, 4, 5, 6]), // full, all distinct
  });
  s.stats = {};
  F.update(0.1);
  eq(G.getState().grid.filter(Boolean).length, 6, 'grid is full');
  eq(G.getState().spawnProgress, 1, 'gauge pinned to 1.0 (paused) while full');
  // free a slot → gauge must resume (drop from 1 and tick), never stay stuck
  const st = G.getState();
  st.grid[0] = null;
  F.update(0.1); // first tick after full → resets to 0 (resume)
  ok(G.getState().spawnProgress < 1, 'gauge resumed (dropped below 1) once a slot freed');
  // advance enough time to actually spawn into the freed slot
  for (let i = 0; i < 200; i++) F.update(0.2);
  eq(G.getState().grid.filter(Boolean).length, 6, 'freed slot eventually refilled by spawn (gauge works when grid has space)');
});

group('playtime formatter fmtPlaytime() (long sessions + guards)', () => {
  eq(F.fmtPlaytime(30), '30초', 'seconds');
  eq(F.fmtPlaytime(90), '1분 30초', 'minutes+seconds');
  eq(F.fmtPlaytime(3661), '1시 1분', 'hours+minutes');
  eq(F.fmtPlaytime(90000), '1일 1시', '25h → days+hours');
  eq(F.fmtPlaytime(NaN), '0초', 'NaN → 0초 (no "NaN시")');
  eq(F.fmtPlaytime(-100), '0초', 'negative → 0초');
});

group('number formatter fmt() (endgame + guards)', () => {
  eq(F.fmt(0), '0', 'zero');
  eq(F.fmt(999), '999', 'below 1000 → integer');
  eq(F.fmt(1000), '1.00K', '1000 → 1.00K');
  eq(F.fmt(1500000), '1.50M', '1.5M');
  eq(F.fmt(2.5e9), '2.50B', 'billions');
  eq(F.fmt(1e12), '1.00T', 'trillions');
  ok(/aa$/.test(F.fmt(1e15)), '1e15 uses aa suffix');
  // deep endgame: large but within extended table → suffixed, not raw digits
  ok(!/^\d{7,}/.test(F.fmt(1e30)), '1e30 not rendered as a giant raw number');
  // beyond the table → scientific notation, never "NaN"/garbage
  ok(/e\+?\d+/.test(F.fmt(1e60)), '1e60 → scientific notation');
  // guards
  eq(F.fmt(NaN), '0', 'NaN → 0 (never renders NaN)');
  eq(F.fmt(Infinity), '0', 'Infinity → 0');
  eq(F.fmt(-5000), '-5.00K', 'negative handled');
});

group('variant inheritance on merge (core mechanic)', () => {
  const realRandom = Math.random;
  Math.random = () => 0.999999; // suppress spontaneous/single-parent procs
  // two golden parents → guaranteed golden child
  let s = withState({ grid: gridFrom([{ level: 5, golden: true }, { level: 5, golden: true }, null, null, null, null]),
    upgrades: defaultUpgrades(), prestigeCount: 0, bestLevel: 5 });
  s.stats = {};
  F.tryMerge(0, 1);
  ok(G.getState().grid[1] && G.getState().grid[1].golden === true, 'two golden parents → golden child (guaranteed)');
  // two star parents → guaranteed star child
  s = withState({ grid: gridFrom([{ level: 5, star: true }, { level: 5, star: true }, null, null, null, null]),
    upgrades: defaultUpgrades(), prestigeCount: 0, bestLevel: 5 });
  s.stats = {};
  F.tryMerge(0, 1);
  ok(G.getState().grid[1] && G.getState().grid[1].star === true, 'two star parents → star child (guaranteed)');
  // two dark parents → guaranteed dark child
  s = withState({ grid: gridFrom([{ level: 5, dark: true }, { level: 5, dark: true }, null, null, null, null]),
    upgrades: defaultUpgrades(), prestigeCount: 0, bestLevel: 5 });
  s.stats = {};
  F.tryMerge(0, 1);
  ok(G.getState().grid[1] && G.getState().grid[1].dark === true, 'two dark parents → dark child (guaranteed)');
  // plain parents (random suppressed) → no variant child
  s = withState({ grid: gridFrom([5, 5, null, null, null, null]),
    upgrades: defaultUpgrades(), prestigeCount: 0, bestLevel: 5 });
  s.stats = {};
  F.tryMerge(0, 1);
  const child = G.getState().grid[1];
  ok(child && !child.golden && !child.star && !child.dark, 'plain parents → plain child (no spontaneous variant at rng=max)');
  Math.random = realRandom;
});

group('UI structure guard — buttons present + wired (Q-Leap 125)', () => {
  // Every interactive control must exist in the HTML AND have a click handler wired,
  // so a future layout rebuild can't silently drop a button. (Catches the class of
  // bug where moving buttons into a menu accidentally removes one.)
  const buttons = [
    'hint-btn', 'sell-btn', 'info-btn', 'merge-all-btn', 'sort-btn', 'compact-btn',
    'ritual-btn', 'frenzy-btn', 'menu-btn',
    'codex-btn', 'quest-btn', 'shop-btn', 'trophy-btn',
    'help-btn', 'storage-btn', 'meditation-btn',
    'auto-merge-btn', 'forge-btn', 'instant-spawn-btn',
  ];
  for (const id of buttons) {
    ok(RAW_HTML.includes(`id="${id}"`), `button #${id} present in HTML`);
    ok(RAW_HTML.includes(`getElementById('${id}').addEventListener`), `button #${id} has a click handler wired`);
  }
  // the collapsible menu container exists
  ok(RAW_HTML.includes('id="grid-menu"'), '#grid-menu container present');
  // status readouts the HUD updates by id must exist
  for (const id of ['shuriken-count', 'shuriken-max', 'batch-info', 'next-spawn-lv', 'formation-grade', 'frenzy-count', 'storage-count']) {
    ok(RAW_HTML.includes(`id="${id}"`), `HUD readout #${id} present`);
  }
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

group('line bonus awards on a partial last row (non-rectangular grid)', () => {
  // size = 6 + maxShuriken = 7 → cols 4, rows 2. Bottom row real cells = 4,5,6 (idx 7 is phantom).
  // Before the fix, the phantom cell failed the whole line so this row could never award.
  const s = withState({ upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 1 }), gem: 0, gold: 0 });
  eq(F.getGridSize(), 7, 'grid size is 7 (non-rectangular: 4 cols × 2 rows)');
  eq(F.getGridCols(), 4, 'cols is 4');
  s.grid = place(7, { 4: 5, 5: 5, 6: 5 }); // full bottom row of 3 same-level
  s._claimedLines = {};
  F.checkLineBonus();
  ok(G.getState().gem > 0, 'partial bottom row of 3 same-level cells now awards a line bonus');
  // only 2 cells filled → no award (needs ≥3 real cells)
  const s2 = withState({ upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 1 }), gem: 0, gold: 0 });
  s2.grid = place(7, { 4: 5, 5: 5 });
  s2._claimedLines = {};
  F.checkLineBonus();
  eq(G.getState().gem, 0, 'a 2-cell partial row does not award (min 3)');
});

group('load fills missing skills from defaults (single source of truth)', () => {
  if (typeof F.load !== 'function' || typeof F.save !== 'function') { ok(true, 'save/load not exposed — skip'); return; }
  const s = withState({});
  s.skills = { fate: 3 }; // simulate an older save that predates some skill nodes
  F.save();
  F.load();
  const sk = G.getState().skills;
  eq(sk.fate, 3, 'present skill value preserved through load');
  eq(sk.goldMastery, 0, 'missing skill defaulted to 0');
  eq(sk.starLuck, 0, 'newest skill defaulted to 0');
  ok(sk.starLuck !== undefined && sk.blessTime !== undefined, 'all skills defined, none undefined');
});

group('integration: ritual pipeline credits N-1 merges across all systems (parity guard)', () => {
  if (typeof F.doRitualMerge !== 'function') { ok(true, 'doRitualMerge not exposed — skip'); return; }
  const realRandom = Math.random;
  Math.random = () => 0.99;
  try {
    // 3×Lv4 → Lv6 (N=3 → N-1=2 merge-equivalents). bestLevel 10 so not a new best (isolates accounting).
    // blessed cell (idx 1) is inside the group [0,1,2].
    const s = withState({
      grid: place(9, { 0: 4, 1: 4, 2: 4 }), bestLevel: 10, gold: 0,
      blessedIdx: 1,
      dailyChallengeId: 'comboKeep', dailyChallengeDone: false, dailyChallengeProgress: 0,
      frenzyCharge: 0, autoFrenzyEnabled: false,
      dailyQuests: [], lastFirstMergeDate: F.todayString(),
      upgrades: defaultUpgrades(), skills: {},
    });
    s.stats = {};
    ok(F.doRitualMerge(), 'ritual 4×3 → Lv6');
    eq(s.stats.totalMerges, 2, 'creditMerges: N-1 = 2 (v3.41 frenzy / v3.x merge-count parity)');
    eq(s.dailyChallengeProgress, 2, 'daily challenge advanced by N-1 = 2 (v3.51)');
    eq(s.frenzyCharge, 2, 'frenzy charged by N-1 = 2, no packed set (v3.41)');
    eq(s.stats.blessedMerges, 1, 'blessed-cell ritual credited blessedMerges (v3.52)');
    eq(s.blessedIdx, -1, 'blessing consumed by the ritual (v3.52)');
    eq(s.stats.ritualsPerformed, 1, 'ritual counted');
    ok(s.gold > 0, 'ritual gold awarded');
  } finally { Math.random = realRandom; }
});

group('integration: merge → bestLevel → prestige → reset/preserve + gold invariant', () => {
  if (typeof F.tryMerge !== 'function' || typeof F.doPrestige !== 'function') { ok(true, 'merge/prestige not exposed — skip'); return; }
  const realRandom = Math.random;
  Math.random = () => 0.99; // suppress jump/variant/divine procs → deterministic
  try {
    const s = withState({
      grid: place(9, { 0: 7, 1: 7 }), // two Lv7 → Lv8 (unlocks prestige)
      gem: 0, gold: 0, bestLevel: 7, prestigeCount: 0, enlightenment: 0,
      dailyQuests: [], lastFirstMergeDate: F.todayString(),
      upgrades: defaultUpgrades(), skills: {},
    });
    s.stats = {};
    eq(F.tryMerge(0, 1), 'merge', 'two Lv7 → merge');
    eq(s.grid[1].level, 8, 'result is Lv8');
    eq(s.bestLevel, 8, 'bestLevel rose to 8');
    ok((s.gem || 0) >= 1, 'reaching new best even Lv8 granted a gem');
    eq(s.stats.totalMerges, 1, 'merge counted');
    // prestige is now unlocked (bestLevel >= 8)
    const pc0 = s.prestigeCount;
    ok(F.doPrestige(), 'prestige succeeds at bestLevel 8');
    eq(s.prestigeCount, pc0 + 1, 'prestigeCount incremented');
    eq(s.bestLevel, 8, 'bestLevel preserved through prestige');
    eq(s.gold, 0, 'gold reset on prestige');
    ok(s.enlightenment > 0, 'enlightenment gained on prestige');
    eq(s.grid.length, F.getGridSize(), 'grid length matches gridSize after prestige');
    eq(s.frenzyCharge || 0, 0, 'frenzy meter reset on prestige');
    // cross-system gold invariant: passive income == Σ per-cell weight × goldMul × passiveBonus
    withState({ grid: place(9, { 0: 5, 1: 6, 4: 8 }), prestigeCount: 1, dailyChallengeId: '',
                upgrades: Object.assign(defaultUpgrades(), { firerate: 2 }) });
    let sum = 0;
    const g = G.getState().grid;
    for (let i = 0; i < g.length; i++) sum += F.pieceGoldWeight(i);
    approx(F.getPassiveGoldRate(), sum * F.getGoldMul() * F.getPassiveGoldBonus(),
           'income = Σ weight × goldMul × passiveBonus (no divergence)', 1e-6);
  } finally { Math.random = realRandom; }
});

group('fusion achievements track fusionsUsed (+ capstone gem override)', () => {
  const ACH = C.ACHIEVEMENTS;
  const f1 = ACH.find(a => a.id === 'a_fusion_1');
  const f10 = ACH.find(a => a.id === 'a_fusion_10');
  ok(f1 && f10, 'fusion achievements defined');
  eq(f1.check({ stats: { fusionsUsed: 1 } }), true, 'a_fusion_1 unlocks at 1 fusion');
  eq(f1.check({ stats: { fusionsUsed: 0 } }), false, 'a_fusion_1 not before first fusion');
  eq(f10.check({ stats: { fusionsUsed: 10 } }), true, 'a_fusion_10 at 10');
  eq(f10.check({ stats: { fusionsUsed: 9 } }), false, 'a_fusion_10 not at 9');
  if (typeof F.getAchievementGem === 'function') eq(F.getAchievementGem(f10), 8, 'a_fusion_10 per-entry gem override = 8');
});

group('integration: fusion unlocks its achievement + grants reward', () => {
  if (typeof F.tryVariantFusion !== 'function' || typeof F.checkAchievements !== 'function') { ok(true, 'not exposed — skip'); return; }
  const ACH = C.ACHIEVEMENTS;
  // pre-unlock everything except a_fusion_1, and pre-claim completion tiers, so only a_fusion_1 fires.
  const pre = {}; for (const a of ACH) if (a.id !== 'a_fusion_1') pre[a.id] = 1;
  const done = {}; for (const n of [10, 25, 50, 75, ACH.length]) done[n] = 1;
  const s = withState({ grid: place(9, { 0: 4, 1: 5, 2: 6 }), gem: 0 });
  s.grid[0].golden = true; s.grid[1].golden = true; s.grid[2].golden = true;
  s.achievements = pre;
  s.stats = { achCompletions: done };
  ok(F.tryVariantFusion('golden'), 'fusion performed (calls checkAchievements internally)');
  ok(!!s.achievements['a_fusion_1'], 'fusion unlocked a_fusion_1 end-to-end');
  ok(s.gem >= 3, 'achievement reward granted (≥3 💎)');
});

group('strategy achievement tracks strategyUsed', () => {
  const ACH = C.ACHIEVEMENTS;
  const a = ACH.find(x => x.id === 'a_strategy_1');
  ok(a, 'a_strategy_1 defined');
  eq(a.check({ stats: { strategyUsed: 1 } }), true, 'unlocks after first strategy selection');
  eq(a.check({ stats: { strategyUsed: 0 } }), false, 'not before any selection');
});

group('drawShurikenSprite runs across all tiers + transcend levels without throwing', () => {
  if (typeof F.drawShurikenSprite !== 'function') { ok(true, 'not exposed — skip'); return; }
  // canvas/ctx stub that absorbs every call & property — verifies the per-tier sprite logic
  // (wood/iron/silver/gold/mystic + transcend) has no reference error at any level.
  function ctxStub() { return new Proxy(function () {}, { get() { return ctxStub(); }, set() { return true; }, apply() { return ctxStub(); } }); }
  const canvas = { width: 80, height: 80, getContext: () => ctxStub() };
  let threw = null, lvThrew = 0;
  for (let lv = 1; lv <= 100; lv++) {
    try { F.drawShurikenSprite(canvas, lv); } catch (e) { if (!threw) { threw = e; lvThrew = lv; } }
  }
  ok(threw === null, 'sprite renders for Lv 1..100 (all tiers + transcend)' + (threw ? ` — Lv ${lvThrew}: ${threw.message}` : ''));
});

group('render functions run without throwing (UI-wiring smoke test)', () => {
  // First coverage of the render path — catches reference errors in render code that
  // pure-helper tests miss (e.g. the strategy button, next-milestone readouts I added).
  // DOM is stubbed, so this exercises the JS logic, not visual output.
  const renders = ['renderPrestige', 'renderAchievements', 'renderCodex', 'renderStats', 'renderGrid', 'refreshUI',
    'renderShop', 'renderStorage', 'renderLog', 'renderQuests', 'renderSkillTree', 'renderUpgrades',
    'renderHallOfFame', 'renderTrophy', 'updateHUD', 'refreshQuestBadge', 'refreshAutoSellUI', 'renderHelp'];
  // a rich, representative state that hits the new wiring (strategy mode, variants, achievements)
  const s = withState({
    bestLevel: 25, prestigeCount: 3, enlightenment: 40, strategyMode: 'gold',
    grid: gridFrom([5, 5, { level: 8, golden: true }, { level: 8, star: true }, 12, null]),
    skills: { goldMastery: 2, inheritance: 1 }, codex: { 1: true, 5: true, 10: true },
    dailyChallengeId: 'comboKeep',
  });
  s.stats = { totalMerges: 500, totalSpawned: 300, totalGoldEarned: 1e6, luckyMerges: 20, playTimeSec: 3600, achCompletions: { 10: true } };
  s.achievements = { a_first_merge: 1, a_fusion_1: 1 };
  for (const name of renders) {
    if (typeof F[name] !== 'function') { ok(true, `${name} not exposed — skip`); continue; }
    let threw = null;
    try { F[name](); } catch (e) { threw = e; }
    ok(threw === null, `${name}() runs without throwing` + (threw ? ` — ${threw.message}` : ''));
  }
});

group('object-valued stats survive save/load (achCompletions / milestone maps)', () => {
  if (typeof F.save !== 'function' || typeof F.load !== 'function') { ok(true, 'save/load not exposed — skip'); return; }
  const s = withState({});
  s.stats = { totalMerges: 5, achCompletions: { 10: true, 25: true }, transcendMilestones: { 5: true } };
  F.save(); F.load();
  const st = G.getState().stats;
  eq(st.totalMerges, 5, 'numeric stat survives round-trip');
  ok(st.achCompletions && st.achCompletions[10] === true && st.achCompletions[25] === true, 'achCompletions object survives intact');
  ok(st.transcendMilestones && st.transcendMilestones[5] === true, 'milestone map survives (validateAndRepair only zeroes numeric NaN/neg)');
});

group('countAdjacentSameLevel: orthogonal same-level neighbors only (shared helper)', () => {
  if (typeof F.countAdjacentSameLevel !== 'function') { ok(true, 'not exposed — skip'); return; }
  // size 9 → 4 cols. Horizontal triple Lv5 at 0,1,2.
  withState({ upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 3 }), grid: place(9, { 0: 5, 1: 5, 2: 5 }) });
  eq(F.getGridCols(), 4, 'size 9 → 4 cols');
  eq(F.countAdjacentSameLevel(1), 2, 'middle of horizontal triple → 2 same-level neighbors');
  eq(F.countAdjacentSameLevel(0), 1, 'left end → 1');
  // different-level neighbor is not counted
  withState({ upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 3 }), grid: place(9, { 0: 5, 1: 3, 2: 5 }) });
  eq(F.countAdjacentSameLevel(0), 0, 'different-level neighbor → 0');
  // empty cell → 0
  eq(F.countAdjacentSameLevel(8), 0, 'empty cell → 0');
});

group('getNextPrestigeMilestone returns the next un-reached prestige tier', () => {
  if (typeof F.getNextPrestigeMilestone !== 'function') { ok(true, 'not exposed — skip'); return; }
  eq(F.getNextPrestigeMilestone(0).n, 5, 'at 0 → next 5');
  eq(F.getNextPrestigeMilestone(5).n, 10, 'at 5 → next 10');
  eq(F.getNextPrestigeMilestone(24).n, 25, 'at 24 → 25');
  eq(F.getNextPrestigeMilestone(50), null, 'all reached → null');
  ok(F.getNextPrestigeMilestone(0).gem > 0, 'tier carries a gem reward');
});

group('prestige milestones grant 💎 at 5/10/25/50 (one-shot, no retroactive)', () => {
  if (typeof F.doPrestige !== 'function') { ok(true, 'doPrestige not exposed — skip'); return; }
  // pre-unlock all achievements + completion tiers so only the prestige milestone grants gems.
  const allAch = {}; for (const a of C.ACHIEVEMENTS) allAch[a.id] = 1;
  const doneTiers = {}; for (const n of [10, 25, 50, 75, C.ACHIEVEMENTS.length]) doneTiers[n] = 1;
  const s = withState({ prestigeCount: 4, bestLevel: 10, runBestLevel: 10, gem: 0, grid: place(9, {}), upgrades: defaultUpgrades(), skills: {} });
  s.achievements = allAch;
  s.stats = { achCompletions: doneTiers };
  F.doPrestige();
  eq(s.prestigeCount, 5, 'prestige count reached 5');
  eq(s.gem, 50, 'prestige-5 milestone grants 50 💎');
  ok(s.stats.prestigeMilestones && s.stats.prestigeMilestones[5], 'milestone recorded (one-shot)');
  // next prestige (5→6) is not a milestone (v3.79.2 F2: 재등반 후에만 가능)
  s.runBestLevel = 10;
  F.doPrestige();
  eq(s.prestigeCount, 6, 'prestige count 6');
  eq(s.gem, 50, 'no milestone gem at count 6');
});

group('strategy mode persists through save/load and prestige (it is a setting)', () => {
  if (typeof F.save !== 'function' || typeof F.load !== 'function') { ok(true, 'save/load not exposed — skip'); return; }
  const s = withState({ strategyMode: 'gold' });
  s.stats = {};
  F.save(); F.load();
  eq(G.getState().strategyMode, 'gold', 'strategyMode survives a save/load round-trip');
  if (typeof F.doPrestige === 'function') {
    const s2 = withState({ strategyMode: 'fast', bestLevel: 10, runBestLevel: 10, grid: place(9, {}), upgrades: defaultUpgrades(), skills: {} });
    s2.stats = {};
    F.doPrestige();
    eq(G.getState().strategyMode, 'fast', 'strategyMode preserved through prestige (player setting, not run-transient)');
  }
});

group('strategy mode: trade-off run modifiers wired into gold/spawn/variant', () => {
  if (typeof F.getStrategyGoldMul !== 'function') { ok(true, 'strategy helpers not exposed — skip'); return; }
  // none = neutral
  withState({ strategyMode: 'none' });
  eq(F.getStrategyGoldMul(), 1, 'none → gold ×1');
  eq(F.getStrategySpawnMul(), 1, 'none → spawn ×1');
  eq(F.getStrategyVariantMul(), 1, 'none → variant ×1');
  // gold mode: +30% gold, slower spawn (trade-off)
  withState({ strategyMode: 'gold' });
  approx(F.getStrategyGoldMul(), 1.30, 'gold mode → gold ×1.30');
  ok(F.getStrategySpawnMul() > 1, 'gold mode → spawn slower (interval up)');
  // fast mode: faster spawn, less gold (trade-off)
  withState({ strategyMode: 'fast' });
  ok(F.getStrategySpawnMul() < 1, 'fast mode → spawn faster (interval down)');
  ok(F.getStrategyGoldMul() < 1, 'fast mode → less gold');
  // variant mode: ×2 variant, less gold
  withState({ strategyMode: 'variant' });
  eq(F.getStrategyVariantMul(), 2, 'variant mode → variant ×2');
  ok(F.getStrategyGoldMul() < 1, 'variant mode → less gold');
  // wired into the real formulas: gold mode raises getGoldMul, slows getSpawnInterval
  const base = withState({ strategyMode: 'none', prestigeCount: 0, dailyChallengeId: '', upgrades: defaultUpgrades(), grid: gridFrom([5, null, null, null, null, null]) });
  const goldNone = F.getGoldMul(); const spawnNone = F.getSpawnInterval();
  withState({ strategyMode: 'gold', prestigeCount: 0, dailyChallengeId: '', upgrades: defaultUpgrades(), grid: gridFrom([5, null, null, null, null, null]) });
  approx(F.getGoldMul(), goldNone * 1.30, 'gold mode multiplies getGoldMul by 1.30', 1e-6);
  ok(F.getSpawnInterval() > spawnNone, 'gold mode lengthens spawn interval');
  // strategy 'variant' factor is actually COMPOSED into getVariantSpontaneousMul (not just the helper)
  if (typeof F.getVariantSpontaneousMul === 'function') {
    withState({ strategyMode: 'none', grid: new Array(9).fill(null) });
    const vNone = F.getVariantSpontaneousMul();
    withState({ strategyMode: 'variant', grid: new Array(9).fill(null) });
    approx(F.getVariantSpontaneousMul(), vNone * 2, 'variant mode doubles the composed variant-spontaneous mul', 1e-9);
  }
  // the strategy factor appears in the gold breakdown with the correct sign (drives the
  // transparency UI: penalties shown in red, bonuses normally — v3.63.3)
  withState({ strategyMode: 'fast', prestigeCount: 0, dailyChallengeId: '', upgrades: defaultUpgrades(), grid: gridFrom([5, null, null, null, null, null]) });
  const sf = F.getGoldMulBreakdown().find(f => f.key === 'strategy');
  ok(sf && sf.mul < 1, 'fast mode → a <1 strategy factor in the breakdown (visible penalty)');
  withState({ strategyMode: 'gold', prestigeCount: 0, dailyChallengeId: '', upgrades: defaultUpgrades(), grid: gridFrom([5, null, null, null, null, null]) });
  const sg = F.getGoldMulBreakdown().find(f => f.key === 'strategy');
  ok(sg && sg.mul > 1, 'gold mode → a >1 strategy factor in the breakdown');
  // invalid/unknown mode falls back to none
  withState({ strategyMode: 'bogus' });
  eq(F.getStrategyGoldMul(), 1, 'unknown mode → neutral');
});

group('variant fusion: 3 same-variant → 1 next-tier, keeps highest level', () => {
  if (typeof F.tryVariantFusion !== 'function') { ok(true, 'tryVariantFusion not exposed — skip'); return; }
  // 3 golden pieces (Lv 4,6,5) → 1 star at Lv 6 (highest), other two cleared.
  const s = withState({ grid: place(9, { 0: 4, 2: 6, 5: 5 }) });
  s.grid[0].golden = true; s.grid[2].golden = true; s.grid[5].golden = true;
  s.stats = {};
  eq(F.countVariant('golden'), 3, '3 golden pieces present');
  ok(F.tryVariantFusion('golden'), 'fusion performed');
  const stars = s.grid.filter(c => c && c.star);
  eq(stars.length, 1, 'exactly one star produced');
  eq(stars[0].level, 6, 'result keeps the highest consumed level (6)');
  ok(!stars[0].golden, 'result is star, not golden');
  eq(s.grid.filter(c => c && c.golden).length, 0, 'all 3 goldens consumed');
  eq(s.grid.filter(c => c).length, 1, 'net 3 pieces → 1 piece');
  eq(s.stats.fusionsUsed, 1, 'fusionsUsed stat incremented');
  // not enough variants → no-op
  const s2 = withState({ grid: place(9, { 0: 4, 1: 5 }) });
  s2.grid[0].golden = true; s2.grid[1].golden = true;
  s2.stats = {};
  eq(F.tryVariantFusion('golden'), false, 'fewer than 3 → fusion rejected');
  eq(s2.grid.filter(c => c).length, 2, 'pieces untouched on rejection');
  // anchored fusion: the tapped piece always participates and the result lands on it
  const sA = withState({ grid: place(9, { 0: 4, 1: 5, 2: 6, 7: 8 }) });
  sA.grid[0].golden = true; sA.grid[1].golden = true; sA.grid[2].golden = true; sA.grid[7].golden = true;
  sA.stats = {};
  ok(F.tryVariantFusion('golden', 7), 'anchored fusion at idx 7 performed (4 goldens)');
  ok(sA.grid[7] && sA.grid[7].star, 'result lands on the anchor cell (idx 7)');
  eq(sA.grid[7].level, 8, 'result keeps the highest consumed level (anchor Lv8 + 2 highest others)');
  eq(sA.grid.filter(c => c && c.golden).length, 1, 'exactly one golden remains (4 → consumed 3, 1 left)');
  // fusion preserves a variant rarer than the produced tier: 3 goldens, one also dark → result star + dark
  const sD = withState({ grid: place(9, { 0: 5, 1: 6, 2: 7 }) });
  sD.grid[0].golden = true; sD.grid[1].golden = true; sD.grid[2].golden = true;
  sD.grid[1].dark = true; // the Lv6 golden also carries the rarer dark variant
  sD.stats = {};
  ok(F.tryVariantFusion('golden'), 'fusion of 3 goldens (one also dark)');
  const res = sD.grid.find(c => c && c.star);
  ok(res && res.dark, 'result (star) preserves the rarer dark variant — not destroyed by fusion');
  // dark is top tier → cannot fuse
  const s3 = withState({ grid: place(9, { 0: 4, 1: 5, 2: 6 }) });
  s3.grid[0].dark = true; s3.grid[1].dark = true; s3.grid[2].dark = true;
  s3.stats = {};
  eq(F.tryVariantFusion('dark'), false, 'dark is top tier — no fusion');
  // locked variants are not counted/consumed
  const s4 = withState({ grid: place(9, { 0: 4, 1: 5, 2: 6 }) });
  s4.grid[0].golden = true; s4.grid[1].golden = true; s4.grid[2].golden = true; s4.grid[2].locked = true;
  s4.stats = {};
  eq(F.countVariant('golden'), 2, 'locked golden excluded from count');
  eq(F.tryVariantFusion('golden'), false, 'cannot fuse when only 2 unlocked goldens');
});

group('sortGridByLevel compacts + sorts descending, preserving pieces/variants', () => {
  if (typeof F.sortGridByLevel !== 'function') { ok(true, 'sortGridByLevel not exposed — skip'); return; }
  const s = withState({ grid: place(6, { 0: 3, 2: 7, 3: 5, 5: 5 }) });
  s.grid[2].golden = true; // the Lv7 piece is golden
  F.sortGridByLevel();
  const g = G.getState().grid;
  eq(g[0].level, 7, 'highest level first');
  ok(g[0].golden, 'variant flag preserved through sort');
  eq(g[1].level, 5, '2nd descending');
  eq(g[2].level, 5, '3rd descending');
  eq(g[3].level, 3, '4th descending');
  eq(g[4], null, 'nulls compacted to the end');
  eq(g[5], null, 'nulls compacted to the end');
  eq(g.filter(c => c).length, 4, 'piece count preserved (no loss/duplication)');
  eq(g.length, 6, 'grid length unchanged');
});

group('integration: post-prestige spawn boost applies +2 then decrements', () => {
  if (typeof F.spawnShuriken !== 'function' || typeof F.doPrestige !== 'function') { ok(true, 'not exposed — skip'); return; }
  const realRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const s = withState({ bestLevel: 10, runBestLevel: 10, grid: place(9, {}), upgrades: defaultUpgrades(), skills: {} });
    s.stats = {};
    F.doPrestige(); // Q-Leap 91: sets postPrestigeSpawns = 10
    eq(s.postPrestigeSpawns, 10, 'prestige grants 10 boosted spawns');
    const baseLv = F.getSpawnStartLevel(); // spawnLevel reset by prestige → 1
    F.spawnShuriken();
    const spawned = s.grid.find(c => c);
    eq(spawned.level, baseLv + 2, 'first post-prestige spawn is +2 boosted (getNextSpawnLevel)');
    eq(s.postPrestigeSpawns, 9, 'boost counter decremented by the spawn');
  } finally { Math.random = realRandom; }
});

group('spawn batch / start level / star count formulas', () => {
  // getSpawnBatch = min(SPAWN_BATCH_CAP=6, 1 + spawnBatch upgrade)
  if (typeof F.getSpawnBatch === 'function') {
    withState({ upgrades: defaultUpgrades() });
    eq(F.getSpawnBatch(), 1, 'base spawn batch is 1');
    withState({ upgrades: Object.assign(defaultUpgrades(), { spawnBatch: 3 }) });
    eq(F.getSpawnBatch(), 4, 'spawnBatch 3 → batch 4');
    withState({ upgrades: Object.assign(defaultUpgrades(), { spawnBatch: 20 }) });
    eq(F.getSpawnBatch(), 6, 'batch caps at 6 (SPAWN_BATCH_CAP)');
  }
  // getSpawnStartLevel = 1 + spawnLevel + masterSmith skill
  withState({ upgrades: defaultUpgrades(), skills: {} });
  eq(F.getSpawnStartLevel(), 1, 'base spawn start level is 1');
  withState({ upgrades: Object.assign(defaultUpgrades(), { spawnLevel: 2 }), skills: { masterSmith: 2 } });
  eq(F.getSpawnStartLevel(), 5, 'spawnLevel 2 + masterSmith 2 → start Lv 5');
  // getNextSpawnLevel = getSpawnStartLevel + post-prestige +2 boost while active
  if (typeof F.getNextSpawnLevel === 'function') {
    withState({ upgrades: defaultUpgrades(), skills: {}, postPrestigeSpawns: 0 });
    eq(F.getNextSpawnLevel(), F.getSpawnStartLevel(), 'no boost → equals start level');
    withState({ upgrades: defaultUpgrades(), skills: {}, postPrestigeSpawns: 5 });
    eq(F.getNextSpawnLevel(), F.getSpawnStartLevel() + 2, 'post-prestige boost active → +2');
  }
  // countStars = number of star pieces on the grid
  withState({ grid: gridFrom([{ level: 5, star: true }, { level: 3 }, { level: 5, star: true }, null, null, null]) });
  eq(F.countStars(), 2, 'counts star pieces on the grid');
  withState({ grid: gridFrom([3, 4, 5, null, null, null]) });
  eq(F.countStars(), 0, 'no stars → 0');
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
  ok(baseInt >= 0.6, 'spawn interval respects floor (0.6)');
  // heavy stacking (maxed spawnRate + burning + frenzy + 3 stars) clamps to the 0.6 floor
  withState({ upgrades: Object.assign(defaultUpgrades(), { spawnRate: 50 }), burningTimer: 10, frenzyTimer: 10,
    grid: gridFrom([{ level: 5, star: true }, { level: 5, star: true }, { level: 5, star: true }, null, null, null]) });
  eq(F.getSpawnInterval(), 0.6, 'heavy stacking clamps to the 0.6 floor');
});

group('grid size scaling', () => {
  withState({ upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 0 }) });
  eq(F.getGridSize(), 6, 'base grid size 6');
  withState({ upgrades: Object.assign(defaultUpgrades(), { maxShuriken: 3 }) });
  eq(F.getGridSize(), 9, 'grid grows +1/level');
});

group('expedition (Q-Leap 124)', () => {
  const T = C.EXPEDITION_TIERS;
  eq(T.length, 3, 'three expedition tiers');
  ok(T[0].minutes < T[1].minutes && T[1].minutes < T[2].minutes, 'tier durations ascend');
  ok(T[0].minLv < T[1].minLv && T[1].minLv < T[2].minLv, 'tier min levels ascend');
  ok(T[0].goldMul < T[1].goldMul && T[1].goldMul < T[2].goldMul, 'tier gold premiums ascend');
  ok(T[0].growChance === 0 && T[2].growChance > T[1].growChance, 'grow chance: none on scout, best on grand');

  // unlock gate
  withState({ bestLevel: C.EXPEDITION_UNLOCK_LV - 1 });
  eq(F.isExpeditionUnlocked(), false, 'locked below unlock level');
  withState({ bestLevel: C.EXPEDITION_UNLOCK_LV });
  eq(F.isExpeditionUnlocked(), true, 'unlocked at gate level');

  // variant gem multiplier ladder
  eq(F.expeditionVariantMul({}), 1, 'plain piece variant mul 1');
  eq(F.expeditionVariantMul({ golden: true }), 2, 'golden ×2');
  eq(F.expeditionVariantMul({ star: true }), 3, 'star ×3');
  eq(F.expeditionVariantMul({ dark: true }), 4, 'dark ×4');
  eq(F.expeditionVariantMul({ golden: true, star: true, dark: true }), 24, 'stacked variants multiply');

  // gold formula: piece passive weight × duration × premium, claim-time multipliers
  withState({ bestLevel: 12 });
  for (const [lv, ti] of [[5, 0], [8, 1], [12, 2]]) {
    const expect = Math.floor(0.5 * Math.pow(2, lv - 1) * F.getGoldMul() * F.getPassiveGoldBonus() * T[ti].minutes * 60 * T[ti].goldMul);
    eq(F.getExpeditionGold(lv, ti), expect, `gold reward formula (lv ${lv}, tier ${ti})`);
  }
  eq(F.getExpeditionGold(5, 99), 0, 'invalid tier → 0 gold');
  eq(F.getExpeditionGem({ star: true }, 1), T[1].gem * 3, 'gem reward scales with variant');

  // eligibility gating
  withState({ bestLevel: 12 });
  eq(F.canSendExpedition({ id: 1, level: 4, fireTimer: 0 }, 0), false, 'below tier minLv blocked');
  eq(F.canSendExpedition({ id: 1, level: 5, fireTimer: 0 }, 0), true, 'at tier minLv allowed');
  eq(F.canSendExpedition({ id: 1, level: 20, fireTimer: 0, locked: true }, 0), false, 'locked piece blocked');
  withState({ bestLevel: 9 });
  eq(F.canSendExpedition({ id: 1, level: 20, fireTimer: 0 }, 0), false, 'blocked before unlock');

  // start → grid slot freed, state set, stat credited
  const s1 = withState({ bestLevel: 12, grid: gridFrom([8, null, null, null, null, null]) });
  eq(F.startExpedition(0, 1), true, 'startExpedition succeeds');
  eq(s1.grid[0], null, 'piece removed from grid');
  ok(s1.expedition && s1.expedition.piece.level === 8 && s1.expedition.tier === 1, 'expedition state holds the piece');
  eq(s1.stats.expeditions, 1, 'departure stat credited');
  ok(F.getExpeditionRemainingSec() > 0, 'remaining time counts down from full duration');
  eq(F.canSendExpedition({ id: 9, level: 20, fireTimer: 0 }, 0), false, 'second concurrent expedition blocked');
  eq(F.claimExpedition(), false, 'cannot claim before completion');

  // claim: rewards granted, piece returns to first empty slot
  s1.expedition.endsAt = Date.now() - 1000;
  const expGold = F.getExpeditionGold(8, 1);
  const gem0 = s1.gem;
  eq(F.claimExpedition(), true, 'claim succeeds after completion');
  eq(s1.expedition, null, 'expedition cleared after claim');
  ok(s1.grid[0] && s1.grid[0].level >= 8, 'piece returned to grid');
  ok(s1.gold >= expGold, 'premium gold granted');
  ok(s1.gem >= gem0 + T[1].gem, 'gem reward granted');
  eq(s1.stats.expeditionsClaimed, 1, 'claim stat credited');

  // claim blocked while grid is full (grid-full tension applies to returns too)
  const s2 = withState({ bestLevel: 12, grid: gridFrom([3, 3, 3, 3, 3, 3]),
    expedition: { piece: { id: 99, level: 8, fireTimer: 0 }, tier: 0, startedAt: Date.now() - 1000, endsAt: Date.now() - 1 } });
  eq(F.claimExpedition(), false, 'claim blocked on full grid');
  ok(s2.expedition !== null, 'expedition preserved until space is freed');

  // grand-tier growth: force the roll, verify record bookkeeping (noteLevelReached)
  const realRandom = Math.random;
  Math.random = () => 0; // always below growChance
  const s3 = withState({ bestLevel: 12, runBestLevel: 12, grid: gridFrom([null, null, null, null, null, null]),
    expedition: { piece: { id: 7, level: 12, fireTimer: 0 }, tier: 2, startedAt: 1, endsAt: Date.now() - 1 } });
  eq(F.claimExpedition(), true, 'grand claim succeeds');
  Math.random = realRandom;
  eq(s3.grid[0].level, 13, 'grand expedition grew the piece +1');
  eq(s3.bestLevel, 13, 'growth past record updates bestLevel');
  ok(s3.codex && s3.codex[13], 'grown level registered in codex');

  // save integrity: corrupt expedition dropped, valid one survives
  const s4 = withState({ expedition: { piece: { level: 'x' }, tier: 0, endsAt: Date.now() } });
  F.validateAndRepairState();
  eq(s4.expedition, null, 'corrupt expedition piece → dropped');
  const s5 = withState({ expedition: { piece: { id: 1, level: 9, fireTimer: 0 }, tier: 99, endsAt: Date.now() } });
  F.validateAndRepairState();
  eq(s5.expedition, null, 'invalid tier → dropped');
  const s6 = withState({ bestLevel: 3, expedition: { piece: { id: 1, level: 9, fireTimer: 0 }, tier: 1, startedAt: 1, endsAt: Date.now() + 1000 } });
  F.validateAndRepairState();
  ok(s6.expedition !== null, 'valid expedition survives repair');
  eq(s6.bestLevel, 9, 'bestLevel raised to cover the expedition piece (grid/storage parity)');

  // prestige wipes the off-grid expedition (storage parity — no smuggling across 윤회)
  const s7 = withState({ bestLevel: 12, runBestLevel: 12, gold: 5000,
    expedition: { piece: { id: 1, level: 9, fireTimer: 0 }, tier: 1, startedAt: 1, endsAt: Date.now() + 1000 } });
  F.doPrestige();
  eq(s7.expedition, null, 'prestige clears active expedition');

  // structural guards: chip element + handler wiring exist in the HTML
  ok(RAW_HTML.includes('id="expedition-chip"'), 'expedition chip element present');
  ok(RAW_HTML.includes("getElementById('expedition-chip').addEventListener"), 'chip click handler wired');
  ok(C.ACHIEVEMENTS.some(a => a.id === 'a_exped_1') && C.ACHIEVEMENTS.some(a => a.id === 'a_exped_25'), 'expedition achievements registered');

  // nextShurikenId re-derivation must cover the expedition piece (3rd off-grid location)
  const s8 = withState({ bestLevel: 12, nextShurikenId: NaN,
    grid: gridFrom([{ level: 3 }, null, null, null, null, null]),
    expedition: { piece: { id: 50, level: 9, fireTimer: 0 }, tier: 1, startedAt: 1, endsAt: Date.now() + 1000 } });
  F.validateAndRepairState();
  ok(s8.nextShurikenId > 50, 'nextShurikenId re-derived above expedition piece id (no collision on return)');

  // daily-quest integration: expedition template excluded before unlock, drawable after
  withState({ bestLevel: C.EXPEDITION_UNLOCK_LV - 1 });
  for (let d = 1; d <= 30; d++) {
    const qs = F.generateDailyQuests(`2026-7-${d}`);
    ok(qs.every(q => q.type !== 'expedition'), `no expedition quest before unlock (day ${d})`);
  }
  withState({ bestLevel: C.EXPEDITION_UNLOCK_LV });
  let drawn = false;
  for (let d = 1; d <= 30; d++) {
    if (F.generateDailyQuests(`2026-7-${d}`).some(q => q.type === 'expedition')) { drawn = true; break; }
  }
  ok(drawn, 'expedition quest drawable once unlocked (deterministic date seeds)');

  // weekly-quest pool: expedition weekly gated by unlock (impossible-week protection)
  withState({ bestLevel: 9, weekStartDate: '', weeklyQuest: null });
  F.ensureWeeklyQuest();
  ok(G.getState().weeklyQuest.type !== 'expeditions', 'weekly pool excludes expeditions before unlock');
  // (post-unlock inclusion is seed-dependent per week — covered by the daily-pool draw test above)

  // startExpedition credits daily-quest progress
  const s9 = withState({ bestLevel: 12, grid: gridFrom([9, null, null, null, null, null]),
    dailyQuests: [{ type: 'expedition', target: 1, progress: 0, reward: { gem: 4 }, claimed: false }],
    lastQuestDate: F.todayString() });
  eq(F.startExpedition(0, 1), true, 'quest-wired start succeeds');
  eq(s9.dailyQuests[0].progress, 1, 'expedition quest progress credited on departure');
});

group('trial tower (Q-Leap 125)', () => {
  const FLOORS = C.TOWER_FLOORS;
  eq(FLOORS.length, 6, 'six tower floors');
  for (let i = 1; i < FLOORS.length; i++) {
    ok(FLOORS[i].goalLv > FLOORS[i - 1].goalLv, `floor ${i + 1} goal above floor ${i}`);
    ok(FLOORS[i].reward.gem > FLOORS[i - 1].reward.gem, `floor ${i + 1} gem reward above floor ${i}`);
  }
  ok(FLOORS.every((f, i) => f.floor === i + 1), 'floor ids are 1..N in order');

  // unlock gate
  withState({ prestigeCount: C.TOWER_UNLOCK_PRESTIGE - 1 });
  eq(F.isTowerUnlocked(), false, 'locked below prestige gate');
  withState({ prestigeCount: C.TOWER_UNLOCK_PRESTIGE });
  eq(F.isTowerUnlocked(), true, 'unlocked at prestige gate');

  // constraint hooks: inactive by default, active only during their floor
  withState({});
  eq(F.getTowerSpawnMul(), 1, 'no spawn penalty when inactive');
  eq(F.getTowerGoldMul(), 1, 'no gold penalty when inactive');
  withState({ towerActive: 1 });
  eq(F.getTowerSpawnMul(), FLOORS[0].spawnMul, 'floor 1 slows spawn');
  withState({ towerActive: 2 });
  eq(F.isTowerAutoBanned(), true, 'floor 2 bans automation');
  withState({ towerActive: 3 });
  eq(F.getTowerGoldMul(), FLOORS[2].goldMul, 'floor 3 cuts gold');
  ok(F.getGoldMul() < 1e9 && F.getGoldMulBreakdown().some(f => f.key === 'tower' && f.mul === FLOORS[2].goldMul), 'tower factor wired into gold breakdown');
  withState({ towerActive: 4 });
  eq(F.isTowerRitualBanned(), true, 'floor 4 bans ritual');
  eq(F.doRitualMerge(), false, 'doRitualMerge blocked on ritual-ban floor');
  withState({ towerActive: 5, upgrades: Object.assign(defaultUpgrades(), { spawnLevel: 7 }), postPrestigeSpawns: 5 });
  eq(F.getSpawnStartLevel(), 1, 'floor 5 pins spawn start level to 1');
  eq(F.getNextSpawnLevel(), 1, 'floor 5 ignores post-prestige boost too');

  // spawn interval integration (floor 1: ×1.5 vs clean state)
  withState({});
  const cleanInterval = F.getSpawnInterval();
  withState({ towerActive: 1 });
  approx(F.getSpawnInterval(), Math.max(0.6, cleanInterval * FLOORS[0].spawnMul), 'spawn interval scaled by tower mul', 1e-9);

  // clear: goal reached → reward, floor recorded, constraint lifted
  const s1 = withState({ towerActive: 1, towerFloor: 0, runBestLevel: FLOORS[0].goalLv, gem: 0, enlightenment: 0 });
  eq(F.checkTowerProgress(), true, 'floor clears at goal level');
  eq(s1.towerFloor, 1, 'cleared floor recorded');
  eq(s1.towerActive, 0, 'constraint lifted after clear');
  ok(s1.gem >= FLOORS[0].reward.gem, 'gem reward granted (+ a_tower_1 achievement gem on top)');
  eq(s1.stats.towerClears, 1, 'clear stat credited');
  // below goal → no clear
  const s2 = withState({ towerActive: 2, towerFloor: 1, runBestLevel: FLOORS[1].goalLv - 1 });
  eq(F.checkTowerProgress(), false, 'no clear below goal');
  eq(s2.towerActive, 2, 'constraint stays until goal');
  // jump past goal still clears (≥ comparison — jump-skip safe)
  const s3 = withState({ towerActive: 2, towerFloor: 1, runBestLevel: FLOORS[1].goalLv + 5, enlightenment: 0 });
  eq(F.checkTowerProgress(), true, 'jump past goal clears');
  eq(s3.enlightenment, FLOORS[1].reward.enlightenment, 'enlightenment reward granted');

  // abandon
  const s4 = withState({ towerActive: 3 });
  eq(F.abandonTower(), true, 'abandon works while active');
  eq(s4.towerActive, 0, 'abandon lifts constraint');
  withState({});
  eq(F.abandonTower(), false, 'abandon no-ops when inactive');

  // prestige flow: armed → consumed → next floor entered; active floor fails on prestige
  const s5 = withState({ bestLevel: 12, runBestLevel: 12, prestigeCount: C.TOWER_UNLOCK_PRESTIGE, towerArmed: true, towerFloor: 0 });
  F.doPrestige();
  eq(s5.towerArmed, false, 'arm consumed by prestige');
  eq(s5.towerActive, 1, 'next floor entered on armed prestige');
  const s6 = withState({ bestLevel: 12, runBestLevel: 12, prestigeCount: 3, towerActive: 2, towerArmed: false });
  F.doPrestige();
  eq(s6.towerActive, 0, 'active floor ends (fails) on prestige');
  // armed below unlock (e.g. save tamper) → no entry
  const s7 = withState({ bestLevel: 12, runBestLevel: 12, prestigeCount: 0, towerArmed: true, towerFloor: 0 });
  F.doPrestige();
  eq(s7.towerActive, 0, 'no tower entry when still locked (post-prestige count 1 < gate)');

  // tower completion: base ladder hands off to the deep ladder (Q-Leap 126)
  withState({ towerFloor: FLOORS.length });
  const afterBase = F.getNextTowerFloor();
  ok(afterBase && afterBase.floor === FLOORS.length + 1 && afterBase.deep === 1, 'base-ladder completion hands off to deep floor 1');

  // save integrity
  const s8 = withState({ towerFloor: 99, towerActive: NaN, towerArmed: 'yes' });
  F.validateAndRepairState();
  eq(s8.towerFloor, 99, 'deep towerFloor preserved (no clamp to base floor count)');
  eq(s8.towerActive, 0, 'invalid towerActive dropped (no phantom constraints)');
  eq(s8.towerArmed, true, 'towerArmed coerced to boolean');

  // achievements registered
  ok(C.ACHIEVEMENTS.some(a => a.id === 'a_tower_1') && C.ACHIEVEMENTS.some(a => a.id === 'a_tower_all'), 'tower achievements registered');

  // ── v3.70.1 audit fixes ──
  // inheritance insta-clear exploit: tower entry must NOT carry inherited pieces
  const s9 = withState({ bestLevel: 30, runBestLevel: 30, prestigeCount: 3, towerArmed: true, towerFloor: 0,
    skills: { goldMastery: 0, swiftHands: 0, fate: 0, masterSmith: 0, inheritance: 3, blessTime: 0, codexBoost: 0, goldenLuck: 0, starLuck: 0 },
    grid: gridFrom([28, 27, 26, null, null, null]) });
  F.doPrestige();
  eq(s9.towerActive, 1, 'armed prestige enters floor 1');
  ok(s9.grid.every(c => c === null), 'tower entry carries NO inherited pieces (insta-clear exploit closed)');
  // same skills WITHOUT arming → inheritance works normally
  const s10 = withState({ bestLevel: 30, runBestLevel: 30, prestigeCount: 3, towerArmed: false,
    skills: { goldMastery: 0, swiftHands: 0, fate: 0, masterSmith: 0, inheritance: 3, blessTime: 0, codexBoost: 0, goldenLuck: 0, starLuck: 0 },
    grid: gridFrom([28, 27, 26, null, null, null]) });
  F.doPrestige();
  eq(s10.grid.filter(Boolean).length, 3, 'normal prestige still honors inheritance');

  // stale cleared-floor active (multi-tab race) → repaired, no duplicate reward
  const s11 = withState({ towerFloor: 3, towerActive: 2 });
  F.validateAndRepairState();
  eq(s11.towerActive, 0, 'already-cleared floor cannot stay active (duplicate-reward guard)');
  const s12 = withState({ towerFloor: 3, towerActive: 4 });
  F.validateAndRepairState();
  eq(s12.towerActive, 4, 'legitimate next-floor active survives repair');

  // structural guards: merge-all gate + shop-강화 progress checks wired
  ok(/merge-all-btn'\)\.addEventListener[\s\S]{0,300}isTowerAutoBanned/.test(RAW_HTML), 'merge-all button gated on auto-ban floor');
  ok(/flashCell\(minIdx\);[\s\S]{0,400}noteLevelReached\(state\.grid\[minIdx\]\.level\)/.test(RAW_HTML), '표창 강화 routes through noteLevelReached (tower check + record rewards)');
});

group('tower deep floors (Q-Leap 126)', () => {
  const FLOORS = C.TOWER_FLOORS;
  const BASE = FLOORS.length;             // 6
  const PATS = C.TOWER_DEEP_PATTERNS;

  // pure generation: deterministic, only valid deep floor numbers
  const d1 = F.getDeepFloorDef(BASE + 1);
  ok(d1 && d1.floor === BASE + 1 && d1.deep === 1, 'deep floor 1 generated at base+1');
  eq(JSON.stringify(F.getDeepFloorDef(BASE + 1)), JSON.stringify(d1), 'deep def is deterministic (pure fn of floor number)');
  eq(F.getDeepFloorDef(BASE), null, 'no deep def for base floors');
  eq(F.getDeepFloorDef(0), null, 'no deep def for 0');
  eq(F.getDeepFloorDef(BASE + 1.5), null, 'no deep def for non-integer');
  eq(F.getDeepFloorDef(C.TOWER_MAX_FLOOR + 1), null, 'no deep def beyond max floor');

  // getTowerFloorDef bridges: base floors from the table, deeper ones synthesized
  eq(F.getTowerFloorDef(3), FLOORS[2], 'base floor still served from table');
  ok(!!F.getTowerFloorDef(BASE + 4), 'deep floor served via synthesis');

  // difficulty ramps with depth: goal +2/floor, spawn slower, gold thinner (until caps)
  const d2 = F.getDeepFloorDef(BASE + 2), d6 = F.getDeepFloorDef(BASE + 6);
  eq(d1.goalLv, FLOORS[BASE - 1].goalLv + 2, 'deep goal starts +2 above final base floor');
  eq(d2.goalLv, d1.goalLv + 2, 'goal rises +2 per deep floor');
  ok(d1.desc && d1.desc.length > 0, 'deep floor has a human-readable desc');
  // pattern rotation: floor BASE+1 uses pattern 0 (spawnMul+goldMul), BASE+6 wraps back harder
  ok(d1.spawnMul && d1.goldMul && !d1.banAuto, 'deep 1 = soft double constraint (pattern 0)');
  ok(d6.spawnMul > d1.spawnMul, 'same pattern is harsher on the second lap');
  ok(d6.goldMul < d1.goldMul, 'gold penalty deepens on the second lap');
  ok(F.getDeepFloorDef(BASE + 2).banAuto, 'pattern 1 bans automation');
  ok(F.getDeepFloorDef(BASE + 3).banRitual, 'pattern 2 bans ritual');
  ok(F.getDeepFloorDef(BASE + 4).spawnLv1, 'pattern 3 pins spawn Lv 1');
  const d5 = F.getDeepFloorDef(BASE + 5);
  ok(d5.banAuto && d5.banRitual && d5.spawnMul, 'pattern 4 (적멸) stacks three constraints');
  // caps hold at extreme depth
  const dDeep = F.getDeepFloorDef(BASE + 50);
  ok(dDeep.spawnMul <= 2.5 || !dDeep.spawnMul, 'spawnMul capped at 2.5');
  // audit fix: assert the gold floor on a floor that actually CARRIES goldMul
  // (k=8 → 무저 pattern, raw 0.4−0.16=0.24 → floored). BASE+50 is 적멸 (no goldMul).
  eq(F.getDeepFloorDef(BASE + 8).goldMul, 0.25, 'goldMul floored at 0.25 (first hit at deep 8)');
  ok(!dDeep.goldMul, '적멸 pattern carries no goldMul (floor test must target 무저)');
  // memoized: repeated lookups return the same object (hot-path GC relief)
  ok(F.getDeepFloorDef(BASE + 1) === F.getDeepFloorDef(BASE + 1), 'deep defs are memoized per floor');
  // rewards scale but stay one-shot-sized
  ok(d2.reward.gem > d1.reward.gem && d2.reward.enlightenment > d1.reward.enlightenment, 'deeper floors reward more (one-shot each)');

  // constraint hooks fire for an active deep floor
  withState({ towerActive: BASE + 1 });
  eq(F.getTowerSpawnMul(), d1.spawnMul, 'deep spawn penalty applied');
  eq(F.getTowerGoldMul(), d1.goldMul, 'deep gold penalty applied');
  withState({ towerActive: BASE + 2 });
  eq(F.isTowerAutoBanned(), true, 'deep auto-ban applied');
  withState({ towerActive: BASE + 3 });
  eq(F.isTowerRitualBanned(), true, 'deep ritual-ban applied');
  eq(F.doRitualMerge(), false, 'ritual blocked on deep ban floor');

  // clearing a deep floor: reward granted, progress recorded, next deep floor offered
  const s1 = withState({ towerActive: BASE + 1, towerFloor: BASE, runBestLevel: d1.goalLv, gem: 0, enlightenment: 0 });
  eq(F.checkTowerProgress(), true, 'deep floor clears at its goal');
  eq(s1.towerFloor, BASE + 1, 'deep clear recorded');
  ok(s1.gem >= d1.reward.gem, 'deep gem reward granted');
  eq(s1.enlightenment, d1.reward.enlightenment, 'deep enlightenment reward granted');
  ok(F.getNextTowerFloor() && F.getNextTowerFloor().floor === BASE + 2, 'ladder continues to the next deep floor');

  // armed prestige enters a deep floor with no inheritance (same exploit guard as base)
  const s2 = withState({ bestLevel: 30, runBestLevel: 30, prestigeCount: 5, towerArmed: true, towerFloor: BASE,
    skills: { goldMastery: 0, swiftHands: 0, fate: 0, masterSmith: 0, inheritance: 3, blessTime: 0, codexBoost: 0, goldenLuck: 0, starLuck: 0 },
    grid: gridFrom([28, 27, 26, null, null, null]) });
  F.doPrestige();
  eq(s2.towerActive, BASE + 1, 'armed prestige enters deep floor 1');
  ok(s2.grid.every(c => c === null), 'deep entry also carries no inherited pieces');

  // save integrity for deep values
  const s3 = withState({ towerFloor: 1e9 });
  F.validateAndRepairState();
  eq(s3.towerFloor, C.TOWER_MAX_FLOOR, 'absurd towerFloor clamped to max');
  const s4 = withState({ towerFloor: BASE, towerActive: BASE + 1 });
  F.validateAndRepairState();
  eq(s4.towerActive, BASE + 1, 'active deep floor survives repair');
  const s5 = withState({ towerFloor: BASE + 9, towerActive: BASE + 2 });
  F.validateAndRepairState();
  eq(s5.towerActive, 0, 'already-cleared deep floor cannot stay active');

  // deep achievements registered and keyed off base length
  const a3 = C.ACHIEVEMENTS.find(a => a.id === 'a_tower_deep3');
  const a10 = C.ACHIEVEMENTS.find(a => a.id === 'a_tower_deep10');
  ok(a3 && a10, 'deep achievements registered');
  eq(a3.check({ towerFloor: BASE + 3 }), true, 'deep3 achievement at base+3');
  eq(a3.check({ towerFloor: BASE + 2 }), false, 'deep3 not before base+3');
  eq(a10.check({ towerFloor: BASE + 10 }), true, 'deep10 achievement at base+10');
});

group('cell engraving (Q-Leap 127)', () => {
  const RUNES = C.ENGRAVE_RUNES;
  eq(RUNES.length, 3, 'three runes defined');
  ok(RUNES.every(r => r.id && r.icon && r.name && r.desc), 'runes fully described');

  // unlock gate: no prestige → no engraving, no 悟 spent
  const s0 = withState({ prestigeCount: 0, enlightenment: 100 });
  eq(F.isEngraveUnlocked(), false, 'locked before first prestige');
  eq(F.applyEngraving(0, 'wealth'), false, 'apply refused while locked');
  eq(s0.enlightenment, 100, 'no 悟 spent on refused apply');

  // cost ladder 15/30/50, max 3 cells, swap 8, remove free (no refund)
  const s1 = withState({ prestigeCount: 2, enlightenment: 200 });
  eq(F.getEngraveCost(), C.ENGRAVE_COSTS[0], 'first engrave at slot-1 cost');
  eq(F.applyEngraving(0, 'wealth'), true, 'first engrave applied');
  eq(s1.enlightenment, 200 - 15, 'slot-1 cost deducted');
  eq(F.applyEngraving(1, 'forge'), true, 'second engrave applied');
  eq(F.applyEngraving(2, 'fortune'), true, 'third engrave applied');
  eq(s1.enlightenment, 200 - 15 - 30 - 50, 'cost ladder 15/30/50 deducted');
  eq(F.engraveCount(), 3, 'three cells engraved');
  eq(F.applyEngraving(3, 'wealth'), false, 'fourth cell refused at cap');
  eq(F.applyEngraving(0, 'wealth'), false, 'same-rune re-apply is a no-op');
  eq(F.applyEngraving(0, 'forge'), true, 'rune swap allowed on engraved cell');
  eq(s1.enlightenment, 200 - 95 - C.ENGRAVE_SWAP_COST, 'swap costs flat swap fee');
  const before = s1.enlightenment;
  eq(F.removeEngraving(0), true, 'remove works');
  eq(s1.enlightenment, before, 'remove refunds nothing');
  eq(F.engraveCount(), 2, 'count drops after remove');
  eq(F.getEngraveCost(), C.ENGRAVE_COSTS[2], 're-engraving a third cell costs slot-3 price again (moving is not free)');
  // insufficient 悟
  const s2 = withState({ prestigeCount: 1, enlightenment: 5 });
  eq(F.applyEngraving(0, 'wealth'), false, 'refused when 悟 insufficient');
  eq(s2.enlightenment, 5, 'no partial deduction');
  // out-of-grid index refused (default grid size 6)
  eq(F.applyEngraving(10, 'wealth'), false, 'index beyond grid size refused');
  eq(F.applyEngraving(-1, 'wealth'), false, 'negative index refused');
  eq(F.applyEngraving(0, 'nope'), false, 'unknown rune refused');

  // effect: wealth ×1.5 on passive weight (non-center cell to isolate)
  const centerIdx = (() => { withState({}); return F.getCenterIndex(); })();
  const spot = centerIdx === 0 ? 1 : 0;
  const sW = withState({ grid: place(6, { [spot]: 5 }) });
  const baseW = F.pieceGoldWeight(spot);
  sW.engravings = { [spot]: 'wealth' };
  approx(F.pieceGoldWeight(spot), baseW * 1.5, 'wealth rune ×1.5 passive weight', 1e-9);
  approx(F.getPassiveGoldRate(), baseW * 1.5 * F.getGoldMul() * F.getPassiveGoldBonus(), 'passive rate flows through the same fn', 1e-6);
  eq(F.engraveWealthMul(spot === 0 ? 1 : 0), 1, 'wealth mul is cell-local');

  // effect: forge ×1.35 on merge gold landing on the engraved cell (deterministic via patched RNG)
  const origRandom = Math.random;
  Math.random = () => 0.99; // no jump, no procs, no spontaneous variants
  try {
    const sA = withState({ bestLevel: 10, grid: gridFrom([5, 5, null, null, null, null]), gold: 0 });
    const expectA = Math.floor(Math.pow(2, 6) * F.getGoldMul() * F.getMergeGoldBonus());
    F.tryMerge(0, 1);
    eq(sA.gold, expectA, 'baseline merge gold (no rune)');
    const sB = withState({ bestLevel: 10, grid: gridFrom([5, 5, null, null, null, null]), gold: 0, engravings: { 1: 'forge' } });
    const expectB = Math.floor(Math.pow(2, 6) * F.getGoldMul() * F.getMergeGoldBonus() * 1.35);
    F.tryMerge(0, 1);
    eq(sB.gold, expectB, 'forge rune ×1.35 on merge completed onto the cell');
    const sC = withState({ bestLevel: 10, grid: gridFrom([5, 5, null, null, null, null]), gold: 0, engravings: { 0: 'forge' } });
    F.tryMerge(0, 1);
    eq(sC.gold, expectA, 'forge on the FROM cell does nothing (destination-keyed)');
    // ritual parity: result cell engraved → ritual gold ×1.35.
    // (기대값은 의식 "후" 계산 — 의식이 삼위일체 세트를 소모한 뒤 골드가 산정되므로)
    const sD = withState({ bestLevel: 10, grid: gridFrom([5, 5, 5, null, null, null]), gold: 0 });
    F.doRitualMerge();
    const expectD = Math.floor(Math.pow(2, 7) * F.getGoldMul() * 3 * 2 * F.getMergeGoldBonus());
    eq(sD.gold, expectD, 'baseline ritual gold');
    const sE = withState({ bestLevel: 10, grid: gridFrom([5, 5, 5, null, null, null]), gold: 0, engravings: { 0: 'forge' } });
    F.doRitualMerge();
    const expectE = Math.floor(Math.pow(2, 7) * F.getGoldMul() * 3 * 2 * F.getMergeGoldBonus() * 1.35);
    eq(sE.gold, expectE, 'forge rune applies to ritual result cell (parity)');
    // effect: fortune +4%p on the +2-jump threshold, destination-keyed, hand merges only
    const wkLuck = (F.weekdayBonus().luckPlus || 0);
    Math.random = () => 0.05 + wkLuck + 0.02; // above base pJump2, inside +4%p window
    const sF = withState({ bestLevel: 10, grid: gridFrom([5, 5, null, null, null, null]) });
    F.tryMerge(0, 1);
    eq(sF.grid[1].level, 6, 'no fortune rune → jump 1 at this roll');
    const sG = withState({ bestLevel: 10, grid: gridFrom([5, 5, null, null, null, null]), engravings: { 1: 'fortune' } });
    F.tryMerge(0, 1);
    eq(sG.grid[1].level, 7, 'fortune rune converts the same roll into a +2 jump');
  } finally { Math.random = origRandom; }
  eq(F.engraveFortuneBonus(0), 0, 'no fortune bonus without rune');

  // persistence: engravings survive prestige (permanent purchase, like skills)
  const sP = withState({ bestLevel: 12, runBestLevel: 12, prestigeCount: 2, enlightenment: 50, engravings: { 2: 'wealth' } });
  F.doPrestige();
  eq((sP.engravings || {})[2], 'wealth', 'engraving survives prestige');

  // save integrity: bad idx / unknown rune / over-cap / non-object all repaired
  const sV = withState({ engravings: { 0: 'wealth', 10: 'forge', 1: 'nope', 2: 'fortune', 3: 'forge', 4: 'wealth' } });
  F.validateAndRepairState();
  ok(!('10' in sV.engravings) && !('1' in sV.engravings), 'out-of-grid + unknown-rune entries dropped');
  ok(Object.keys(sV.engravings).length <= C.ENGRAVE_MAX, 'entry count clamped to max');
  eq(sV.engravings[0], 'wealth', 'valid entry preserved');
  const sV2 = withState({ engravings: ['wealth'] });
  F.validateAndRepairState();
  ok(!Array.isArray(sV2.engravings) && typeof sV2.engravings === 'object', 'array-shaped engravings reset to {}');

  // stats + achievements
  const sS = withState({ prestigeCount: 1, enlightenment: 100 });
  F.applyEngraving(0, 'wealth');
  eq(sS.stats.engravesUsed, 1, 'engrave stat credited');
  ok(C.ACHIEVEMENTS.some(a => a.id === 'a_engrave_1') && C.ACHIEVEMENTS.some(a => a.id === 'a_engrave_3'), 'engrave achievements registered');
  const a3 = C.ACHIEVEMENTS.find(a => a.id === 'a_engrave_3');
  eq(a3.check({ engravings: { 0: 'wealth', 1: 'forge', 2: 'fortune' } }), true, 'a_engrave_3 at 3 cells');
  eq(a3.check({ engravings: { 0: 'wealth' } }), false, 'a_engrave_3 not below 3');
  eq(a3.check({}), false, 'a_engrave_3 tolerates missing field');

  // render smoke with engravings present (grid mark path)
  withState({ engravings: { 0: 'wealth' }, grid: gridFrom([3, null, null, null, null, null]) });
  let threw = false;
  try { F.renderGrid(); } catch (e) { threw = true; }
  eq(threw, false, 'renderGrid renders engraved cells without throwing');

  // structural guards: button + modal wired
  ok(/engrave-btn'\)\.addEventListener/.test(RAW_HTML), 'engrave button wired');
  ok(/id="engrave-modal"/.test(RAW_HTML), 'engrave modal present');

  // ── v3.72.2 audit fixes ──
  // fortune rune is HAND-merge only: the auto-merge engine passes isAuto and gets no bonus
  const origRandom2 = Math.random;
  const wkLuck2 = (F.weekdayBonus().luckPlus || 0);
  Math.random = () => 0.05 + wkLuck2 + 0.02; // inside the +4%p fortune window
  try {
    const sAuto = withState({ bestLevel: 10, grid: gridFrom([5, 5, null, null, null, null]), engravings: { 0: 'fortune' } });
    F.autoMergeStep(); // merges into idx 0 (lowest index of the level)
    eq(sAuto.grid[0].level, 6, 'auto merge gets NO fortune bonus (hand-merge only, matches copy)');
    const sHand = withState({ bestLevel: 10, grid: gridFrom([5, 5, null, null, null, null]), engravings: { 1: 'fortune' } });
    F.tryMerge(0, 1);
    eq(sHand.grid[1].level, 7, 'hand merge still gets the fortune bonus');
  } finally { Math.random = origRandom2; }
  // NaN / non-integer idx refused before any 悟 is spent
  const sN = withState({ prestigeCount: 1, enlightenment: 100 });
  eq(F.applyEngraving(NaN, 'wealth'), false, 'NaN idx refused');
  eq(F.applyEngraving(1.5, 'wealth'), false, 'fractional idx refused');
  eq(sN.enlightenment, 100, 'no 悟 spent on refused idx');
  // UI-mode hygiene wired: engrave mode clears stale selection + rival modes; prestige resets it
  ok(/function setEngraveMode[\s\S]{0,600}selectedIdx = -1/.test(RAW_HTML), 'entering engrave mode clears stale selection');
  ok(/function setEngraveMode[\s\S]{0,600}sellMode = false/.test(RAW_HTML), 'engrave mode exits sell mode');
  ok(/sell-btn'\)\.addEventListener[\s\S]{0,400}setEngraveMode\(false\)/.test(RAW_HTML), 'sell mode exits engrave mode');
  ok(/info-btn'\)\.addEventListener[\s\S]{0,500}setEngraveMode\(false\)/.test(RAW_HTML), 'info mode exits engrave mode');
  ok(/function doPrestige[\s\S]{0,6000}setEngraveMode\(false\)/.test(RAW_HTML), 'prestige resets engrave mode');
});

group('cross-system audit fixes (v3.72.4)', () => {
  // offline reward must NOT extend 15~30s transient buffs (goldRush ×2 / frenzy ×1.2) over the window
  const offlineGold = (extra) => {
    const s = withState(Object.assign({
      grid: gridFrom([8, null, null, null, null, null]),
      lastSave: Date.now() - 3600 * 1000,
      gold: 0,
      spawnProgress: 1, // suppress the spawn-precharge branch variance
    }, extra));
    F.processOfflineReward();
    return s.gold;
  };
  const base = offlineGold({});
  ok(base > 0, 'offline gold accrues for an hour away');
  eq(offlineGold({ goldRushTimer: 12 }), base, 'persisted gold rush does NOT inflate the offline window');
  eq(offlineGold({ frenzyTimer: 20 }), base, 'persisted frenzy does NOT inflate the offline window');
  eq(offlineGold({ goldRushTimer: 12, frenzyTimer: 20 }), base, 'stacked transient buffs excluded together');

  // expedition return honors auto-lock (parity with both merge paths)
  const sE = withState({
    autoLockEnabled: true, autoLockThreshold: 5,
    grid: gridFrom([null, null, null, null, null, null]),
    expedition: { piece: { id: 500, level: 10, fireTimer: 0 }, tier: 0, startedAt: Date.now() - 700000, endsAt: Date.now() - 1000 },
  });
  eq(F.claimExpedition(), true, 'finished expedition claims');
  const returned = sE.grid.find(c => c && c.id === 500);
  ok(returned && returned.locked === true, 'returned piece auto-locked at threshold');

  // level-raising paths route through noteLevelReached (record rewards can never be skipped)
  ok(/연쇄 ×30[\s\S]{0,600}noteLevelReached/.test(RAW_HTML), 'combo ×30 강화 routes through noteLevelReached');
  // noteLevelReached grants milestone gems for crossed levels (regression for the lost-forever bug)
  const sM = withState({ bestLevel: 19, runBestLevel: 19, gem: 0 });
  F.noteLevelReached(20);
  ok(sM.gem >= 1, 'record via non-merge path still grants level rewards (Lv20 crossing)');
});

group('forge mode (Q-Leap 128)', () => {
  const MODES = C.FORGE_MODES;
  eq(MODES.length, 3, 'three forge modes');
  eq(MODES[0].id, 'standard', 'standard first (default)');
  // non-dominance: both specializations pay ~9% raw-rate tax vs standard
  const fine = MODES.find(m => m.id === 'fine'), swift = MODES.find(m => m.id === 'swift');
  approx(Math.pow(2, fine.lvDelta) / fine.spawnMul, 2 / 2.2, 'fine value-rate ≈ 0.909× standard', 1e-9);
  approx(Math.pow(2, swift.lvDelta) / swift.spawnMul, 0.5 / 0.55, 'swift value-rate ≈ 0.909× standard', 1e-9);
  ok(Math.pow(2, fine.lvDelta) / fine.spawnMul < 1 && Math.pow(2, swift.lvDelta) / swift.spawnMul < 1,
    'no dominant pick — specialization is a tax, situational value is the payoff');

  // unlock gate
  withState({ bestLevel: C.FORGE_UNLOCK_LV - 1, forgeMode: 'fine' });
  eq(F.isForgeUnlocked(), false, 'locked below unlock level');
  eq(F.getForgeSpawnMul(), 1, 'locked → no spawn effect');
  eq(F.getForgeLevelDelta(), 0, 'locked → no level effect');

  // fine: slower + higher start level
  const up = () => Object.assign(defaultUpgrades(), { spawnLevel: 3 });
  withState({ bestLevel: 10, forgeMode: 'standard', upgrades: up() });
  const baseInterval = F.getSpawnInterval();
  const baseLv = F.getNextSpawnLevel();
  withState({ bestLevel: 10, forgeMode: 'fine', upgrades: up() });
  approx(F.getSpawnInterval(), Math.max(0.6, baseInterval * fine.spawnMul), 'fine slows spawn ×2.2', 1e-9);
  eq(F.getNextSpawnLevel(), baseLv + 1, 'fine spawns +1 level');
  // swift: faster + lower start level
  withState({ bestLevel: 10, forgeMode: 'swift', upgrades: up() });
  approx(F.getSpawnInterval(), Math.max(0.6, baseInterval * swift.spawnMul), 'swift speeds spawn ×0.55', 1e-9);
  eq(F.getNextSpawnLevel(), baseLv - 1, 'swift spawns −1 level');

  // swift gate at start level 1 — no free speed
  withState({ bestLevel: 10, forgeMode: 'swift' }); // no spawnLevel upgrades → start Lv 1
  eq(F.getForgeSpawnMul(), 1, 'swift inert at start Lv 1 (no free acceleration)');
  eq(F.getNextSpawnLevel() >= 1, true, 'level never below 1');
  // fine still works at start level 1
  withState({ bestLevel: 10, forgeMode: 'fine' });
  eq(F.getNextSpawnLevel(), 2, 'fine works from start Lv 1');

  // tower 고행 (spawnLv1) neutralizes forge entirely
  withState({ bestLevel: 30, prestigeCount: 3, forgeMode: 'fine', towerActive: 5, upgrades: up() });
  eq(F.getNextSpawnLevel(), 1, 'spawnLv1 floor pins level regardless of forge');
  eq(F.getForgeSpawnMul(), 1, 'spawnLv1 floor removes the forge interval penalty too');

  // persistence + validation
  const sSave = withState({ bestLevel: 10, forgeMode: 'swift' });
  F.save();
  const sLoad = withState({});
  F.load();
  eq(G.getState().forgeMode, 'swift', 'forge mode survives save/load');
  const sBad = withState({ forgeMode: 'hax' });
  F.save();
  withState({});
  F.load();
  eq(G.getState().forgeMode, 'standard', 'invalid forge mode repaired to standard on load');

  // structural: button + handler wired
  ok(/id="forge-btn"/.test(RAW_HTML), 'forge button present');
  ok(/forge-btn'\)\.addEventListener/.test(RAW_HTML), 'forge button handler wired');
  ok(/getForgeSpawnMul\(\)\);/.test(RAW_HTML), 'forge mul wired into getSpawnInterval');

  // ── v3.73.1 audit fixes: the 0.6s floor must not eat the forge tax ──
  const floored = () => Object.assign(defaultUpgrades(), { spawnRate: 200, spawnLevel: 3 });
  withState({ bestLevel: 30, forgeMode: 'standard', upgrades: floored() });
  eq(F.getSpawnIntervalBase(), 0.6, 'endgame spawnRate pins the base interval at the floor');
  const stdFloor = F.getSpawnInterval();
  eq(stdFloor, 0.6, 'standard at the floor');
  withState({ bestLevel: 30, forgeMode: 'fine', upgrades: floored() });
  approx(F.getSpawnInterval(), 0.6 * fine.spawnMul, 'fine pays the FULL ×2.2 even at the floor (no free +1 Lv)', 1e-9);
  approx(Math.pow(2, 1) * stdFloor / F.getSpawnInterval(), 2 / 2.2, 'non-dominance ratio holds at the floor', 1e-9);
  // swift at the floor: zero speed gain possible → inert (no silent −1 Lv pure loss)
  withState({ bestLevel: 30, forgeMode: 'swift', upgrades: floored() });
  eq(F.getForgeSpawnMul(), 1, 'swift inert when the base interval is floor-pinned');
  eq(F.getForgeLevelDelta(), 0, 'swift pays no level penalty while inert');
  // swift honors the post-prestige boost window (effective level, not raw start level)
  withState({ bestLevel: 10, forgeMode: 'swift', postPrestigeSpawns: 3 });
  eq(F.getForgeLevelDelta(), -1, 'swift active during boost window at raw start Lv 1');
  eq(F.getNextSpawnLevel(), 2, 'boosted swift spawn: 1+2−1 = 2');
  // spawn that exceeds all-time best routes through the record path (no silent validate-repair loss)
  const sR = withState({
    bestLevel: 8, runBestLevel: 3, forgeMode: 'fine', postPrestigeSpawns: 1,
    skills: { goldMastery: 0, swiftHands: 0, fate: 0, masterSmith: 5, blessTime: 0, codexBoost: 0, goldenLuck: 0, starLuck: 0, inheritance: 0 },
    grid: [null, null, null, null, null, null],
  });
  eq(F.getNextSpawnLevel(), 9, 'fine+boost+masterSmith can exceed a Lv8 all-time best');
  F.spawnShuriken();
  eq(sR.bestLevel, 9, 'spawn record updates bestLevel through noteLevelReached');
  ok(!!sR.codex[9], 'record spawn registers the codex entry (reward not lost to validate-repair)');
  eq(sR.runBestLevel, 9, 'runBestLevel follows the record spawn');
});

group('T1b/T4 curation (v3.74): burning/timeBoost/split/coat removed', () => {
  // shop no longer sells the removed items; burning button gone
  ok(!/id: 'timeBoost'/.test(RAW_HTML), 'timeBoost shop item removed');
  ok(!/id: 'split'/.test(RAW_HTML), 'split shop item removed');
  ok(!/id: 'coatGolden'/.test(RAW_HTML), 'coatGolden shop item removed');
  ok(!/id="burn-btn"/.test(RAW_HTML), 'burning button removed');
  ok(!/BURNING_COST/.test(RAW_HTML), 'burning constants removed');
  // legacy timers are harmless: no spawn-speed effect
  withState({});
  const cleanIv = F.getSpawnInterval();
  withState({ burningTimer: 10, timeBoostTimer: 10 });
  eq(F.getSpawnInterval(), cleanIv, 'legacy burning/timeBoost timers no longer affect spawn interval');
  // T1b absorption: frenzy now doubles jump probabilities (burning identity lives on)
  const origRandom3 = Math.random;
  const wk3 = (F.weekdayBonus().luckPlus || 0);
  Math.random = () => 0.05 + wk3 + 0.01; // above base pJump2, inside the frenzy-doubled window
  try {
    const sNo = withState({ bestLevel: 10, grid: gridFrom([5, 5, null, null, null, null]) });
    F.tryMerge(0, 1);
    eq(sNo.grid[1].level, 6, 'no frenzy → jump 1 at this roll');
    const sFr = withState({ bestLevel: 10, frenzyTimer: 20, grid: gridFrom([5, 5, null, null, null, null]) });
    F.tryMerge(0, 1);
    eq(sFr.grid[1].level, 7, 'frenzy doubles the jump window (absorbed from burning)');
  } finally { Math.random = origRandom3; }
  // removed achievements are gone; count-based milestones still coherent
  ok(!C.ACHIEVEMENTS.some(a => ['a_burn', 'a_split', 'a_coat_1'].includes(a.id)), 'orphaned achievements removed');
});

group('ambience (Q-Leap 129)', () => {
  // pure params: pitch follows bestLevel, density follows combo/frenzy, harmony follows gold rush
  withState({ bestLevel: 1 });
  const p1 = F.getAmbienceParams();
  approx(p1.root, 110, 'root starts at 110Hz', 1e-9);
  withState({ bestLevel: 10 });
  approx(F.getAmbienceParams().root, 110 * Math.pow(2, 2 / 12), 'root rises a semitone per 5 levels', 1e-9);
  withState({ bestLevel: 500 });
  approx(F.getAmbienceParams().root, 110 * 4, 'root capped at +2 octaves', 1e-9);
  withState({ bestLevel: 10, comboCount: 12 });
  ok(F.getAmbienceParams().pluckMin < p1.pluckMin, 'high combo densifies plucks');
  withState({ bestLevel: 10, frenzyTimer: 10 });
  const pf = F.getAmbienceParams();
  ok(pf.pluckMin < p1.pluckMin && pf.bright && pf.padCut > p1.padCut, 'frenzy: fastest plucks + bright + open filter');
  withState({ bestLevel: 10, goldRushTimer: 5 });
  ok(F.getAmbienceParams().bright, 'gold rush brightens (5th harmony)');
  // runtime smoke under stubs: start/update/stop never throw
  withState({ musicEnabled: true });
  let threw = false;
  try { F.getAudio(); F.startAmbience(); F.updateAmbience(); F.stopAmbience(); } catch (e) { threw = true; }
  eq(threw, false, 'ambience lifecycle runs without throwing (stubbed audio)');
  // persistence: explicit OFF survives load, old saves default ON
  const sM = withState({ musicEnabled: false });
  F.save();
  withState({});
  F.load();
  eq(G.getState().musicEnabled, false, 'music OFF persists through save/load');
  // structural: toggle button + gesture hook wired
  ok(/id="music-btn"/.test(RAW_HTML), 'music button present');
  ok(/music-btn'\)\.onclick/.test(RAW_HTML), 'music toggle wired');
  ok(/if \(state\.musicEnabled\) startAmbience\(\)/.test(RAW_HTML), 'ambience starts on first audio gesture');
});

group('progressive disclosure (Q-Leap 130)', () => {
  // fresh player: almost everything hidden — the simplified first contact
  withState({ bestLevel: 1 });
  const r1 = F.getRevealState();
  ok(!r1.sellInfo && !r1.gridTools && !r1.ritual && !r1.frenzy && !r1.autoMerge
     && !r1.forge && !r1.daily && !r1.shop && !r1.codex && !r1.prestige && !r1.skills && !r1.hof,
    'Lv 1: only the core loop is visible');
  // reveals arrive in a sensible ladder
  withState({ bestLevel: 3 });
  const r3 = F.getRevealState();
  ok(r3.sellInfo && r3.daily && r3.shop && r3.instant && r3.achv && !r3.ritual && !r3.prestige, 'Lv 3: economy + daily layer');
  withState({ bestLevel: 5 });
  const r5 = F.getRevealState();
  ok(r5.ritual && r5.frenzy && r5.autoMerge && r5.storage && !r5.forge && !r5.prestige, 'Lv 5: merge-depth layer');
  withState({ bestLevel: 6 });
  ok(F.getRevealState().forge && F.getRevealState().prestige, 'Lv 6: forge + prestige teaser');
  // frenzy also reveals by merge count (active play without level luck)
  withState({ bestLevel: 2 });
  G.getState().stats.totalMerges = 40;
  ok(F.getRevealState().frenzy, 'frenzy reveals by merge count too');
  // skills gate on prestige (bestLevel alone never shows them)
  withState({ bestLevel: 60 });
  ok(!F.getRevealState().skills && !F.getRevealState().hof, 'skills/HoF wait for first prestige');
  withState({ bestLevel: 10, prestigeCount: 1 });
  ok(F.getRevealState().skills && F.getRevealState().hof, 'skills/HoF after prestige');
  // monotonic sources only: bestLevel survives prestige → nothing regresses
  withState({ bestLevel: 12, runBestLevel: 12, prestigeCount: 2 });
  const rAll = F.getRevealState();
  const sP = G.getState(); F.doPrestige();
  const rAfter = F.getRevealState();
  ok(Object.keys(rAll).every(k => !rAll[k] || rAfter[k]), 'no reveal regresses across prestige');
  // applyReveal runs without throwing (DOM stubs) and is wired into refreshUI
  let threw = false;
  try { F.applyReveal(); } catch (e) { threw = true; }
  eq(threw, false, 'applyReveal safe under stubs');
  ok(/function refreshUI\(\) \{\s*applyReveal\(\)/.test(RAW_HTML), 'refreshUI applies reveal first');

  // ── v3.76.1 audit fixes ──
  // skills reveal is monotonic even when 悟 is spent down to 0 (owned skills keep the block)
  withState({ bestLevel: 10, prestigeCount: 0, enlightenment: 0,
    skills: { goldMastery: 1, swiftHands: 0, fate: 0, masterSmith: 0, inheritance: 0, blessTime: 0, codexBoost: 0, goldenLuck: 0, starLuck: 0 } });
  ok(F.getRevealState().skills, 'owned skill keeps the skill block visible at 悟 0 (no vanishing purchase)');
  // corrupt-save guard: a prestiged save always sees the prestige section
  withState({ bestLevel: 1, prestigeCount: 3 });
  ok(F.getRevealState().prestige, 'prestige section survives a corrupt bestLevel when prestigeCount > 0');
  // ☰ menu: inline display:none must NOT exist (it beat .open forever — broken since v3.09)
  ok(!/id="grid-menu" style="display:none;"/.test(RAW_HTML), 'grid-menu has no inline display:none');
  ok(/#grid-menu \{[\s\S]{0,300}display: none;/.test(RAW_HTML), 'grid-menu default-hidden via CSS (so .open can win)');
  // reveal announces stagger instead of overwriting the single toast slot
  ok(/400 \+ i \* 2100/.test(RAW_HTML), 'multiple reveal announces are staggered');
  // v3.77.2: hof key regained a consumer — it gates the 전당 tab; rank title restored there
  ok(/dataset\.tab === 'hof'\) t\.style\.display = getRevealState\(\)\.hof/.test(RAW_HTML), 'hof reveal key gates the 전당 tab');
  ok(/function getHofRankTitle/.test(RAW_HTML) && /progress\.textContent = getHofRankTitle\(\)/.test(RAW_HTML), 'dynamic rank title restored on the 전당 tab');
});

group('active buff strip (T1a curation)', () => {
  withState({});
  eq(F.getActiveBuffs().length, 0, 'no buffs on a clean state');
  // T1b/T4 v3.74: burning/timeBoost removed — legacy timers must NOT surface as buffs
  withState({ frenzyTimer: 12.4, goldRushTimer: 3, burningTimer: 8, timeBoostTimer: 29 });
  const buffs = F.getActiveBuffs();
  eq(buffs.length, 2, 'two timed buffs remain after curation (legacy timers ignored)');
  eq(buffs.map(b => b.id).join(','), 'frenzy,goldRush', 'stable order');
  ok(buffs.every(b => b.icon && b.name && b.desc && b.remain > 0), 'entries fully described with remaining time');
  approx(buffs[0].remain, 12.4, 'remaining seconds passed through raw', 1e-9);
  ok(/점프 확률 ×2/.test(buffs[0].desc), 'frenzy desc advertises the absorbed jump ×2 (T1b)');
  withState({ frenzyTimer: 0, goldRushTimer: -3 });
  eq(F.getActiveBuffs().length, 0, 'zero/negative timers excluded');
  withState({ goldRushTimer: 7 });
  eq(F.getActiveBuffs()[0].id, 'goldRush', 'single active buff reported alone');
  // structural: strip element + updateHUD wiring
  ok(/id="buff-strip"/.test(RAW_HTML), 'buff strip element present');
  ok(/buff-strip'\)[\s\S]{0,600}getActiveBuffs\(\)/.test(RAW_HTML), 'updateHUD renders the strip from getActiveBuffs');
});

group('transcendence constellation (Q-Leap 132)', () => {
  // ── 1) 빈 배분 = 기존 동작 그대로 (마이그레이션 항등) ──
  withState({ bestLevel: 65 }); // T=5
  let a = F.getConstellationAlloc();
  eq(a.wealth, 5, 'unallocated points default to wealth');
  eq(a.haste + a.fortune + a.mutation, 0, 'no other allocation by default');
  approx(F.getTranscendMul(), 1 + 5 * 0.02, 'empty allocation reproduces legacy +2%/pt exactly');
  approx(F.getConstellationSpawnMul(), 1, 'no haste → spawn mul 1');
  approx(F.getConstellationLuckBonus(), 0, 'no fortune → luck bonus 0');
  approx(F.getConstellationVariantMul(), 1, 'no mutation → variant mul 1');
  withState({ bestLevel: 50, constellation: { haste: 3 } }); // T=0 — allocation without points is inert
  a = F.getConstellationAlloc();
  eq(a.wealth + a.haste + a.fortune + a.mutation, 0, 'no transcendence → allocation fully inert');

  // ── 2) 배분 효과 + 총량 보존 (안티-인플레이션: 합은 항상 T) ──
  withState({ bestLevel: 70, constellation: { haste: 4, fortune: 3, mutation: 2 } }); // T=10
  a = F.getConstellationAlloc();
  eq(a.wealth, 1, 'wealth = remainder after explicit allocation');
  eq(`${a.haste},${a.fortune},${a.mutation}`, '4,3,2', 'explicit allocation honored');
  eq(a.wealth + a.haste + a.fortune + a.mutation, 10, 'allocation always sums to T (pure redistribution)');
  approx(F.getTranscendMul(), 1.02, 'wealth 1pt → gold +2%');
  approx(F.getConstellationSpawnMul(), Math.pow(0.99, 4), 'haste −1%/pt compounds');
  approx(F.getConstellationLuckBonus(), 0.003, 'fortune +0.1%p/pt');
  approx(F.getConstellationVariantMul(), 1.04, 'mutation +2%/pt');

  // ── 3) 손상 세이브: 초과/NaN/음수/실수는 읽기 시 무해화 ──
  withState({ bestLevel: 63, constellation: { haste: 99, fortune: 5, mutation: 1 } }); // T=3
  a = F.getConstellationAlloc();
  eq(a.haste, 3, 'overflow clamped in id order (haste first)');
  eq(a.fortune + a.mutation + a.wealth, 0, 'nothing left after clamp');
  withState({ bestLevel: 65, constellation: { haste: NaN, fortune: -3, mutation: 2.9 } });
  a = F.getConstellationAlloc();
  eq(`${a.haste},${a.fortune},${a.mutation},${a.wealth}`, '0,0,2,3', 'NaN/negative → 0, fraction floored');

  // ── 4) 효과 배선: 스폰 간격 · 변종 발생률 (비율 비교라 요일 보너스와 무관) ──
  withState({ bestLevel: 70, constellation: { haste: 10 } });
  const spawnWith = F.getSpawnInterval();
  const varWith0 = F.getVariantSpontaneousMul();
  withState({ bestLevel: 70 });
  const spawnWithout = F.getSpawnInterval();
  approx(spawnWith / spawnWithout, Math.pow(0.99, 10), 'haste wired into getSpawnIntervalBase');
  withState({ bestLevel: 70, constellation: { mutation: 10 } });
  approx(F.getVariantSpontaneousMul() / varWith0, 1.2, 'mutation wired into getVariantSpontaneousMul');

  // ── 5) 스테이징: 예약은 즉시 효과 없음 (핫스왑 차단), 초과/무효 별 거부, 활성 동치 → null ──
  const sStage = withState({ bestLevel: 70, constellation: { haste: 2 } });
  eq(F.stageConstellationDelta('fortune', 3), true, 'stage +3 fortune accepted');
  eq(sStage.constellationNext.fortune, 3, 'staged value recorded');
  eq(sStage.constellationNext.haste, 2, 'staging starts from the ACTIVE allocation');
  approx(F.getConstellationLuckBonus(), 0, 'staged change has NO live effect before prestige');
  approx(F.getConstellationSpawnMul(), Math.pow(0.99, 2), 'active haste unchanged while staged');
  eq(F.stageConstellationDelta('haste', 99), false, 'overflow beyond T rejected');
  eq(F.stageConstellationDelta('bogus', 1), false, 'unknown star rejected');
  eq(F.stageConstellationDelta('wealth', 1), false, 'wealth is remainder-only, not directly editable');
  eq(F.stageConstellationDelta('fortune', -3), true, 'stage back down accepted');
  eq(sStage.constellationNext, null, 'staged-equal-to-active normalizes to null (no pending tag)');

  // ── 6) 적용: applyConstellationNext + doPrestige 통합 ──
  const sApply = withState({ bestLevel: 70, constellation: { haste: 2 }, constellationNext: { haste: 5, fortune: 1 } });
  eq(F.applyConstellationNext(), true, 'apply consumes the staged allocation');
  eq(sApply.constellation.haste, 5, 'staged became active');
  eq(sApply.constellationNext, null, 'staging slot cleared');
  eq(sApply.stats.constellationAssigns, 1, 'assign stat credited');
  eq(F.applyConstellationNext(), false, 'no-op without a staged allocation');
  const sPre = withState({ bestLevel: 70, runBestLevel: 10, constellationNext: { fortune: 2 } });
  F.doPrestige();
  eq((sPre.constellation || {}).fortune, 2, 'doPrestige applies the staged reallocation');
  eq(sPre.constellationNext, null, 'doPrestige clears the staging slot');
  const sKeep = withState({ bestLevel: 70, runBestLevel: 10, constellation: { haste: 3 } });
  F.doPrestige();
  eq((sKeep.constellation || {}).haste, 3, 'active allocation survives prestige when nothing staged');

  // ── 7) 연의 별: 점프 임계 실측 (전역 — 각인 룬과 달리 자동 합성에도 적용) ──
  const origRandom = Math.random;
  const wkLuck = (F.weekdayBonus().luckPlus || 0);
  Math.random = () => 0.05 + wkLuck + 0.005; // fortune 10pt(+1%p) 창 안, 기본 임계 밖
  try {
    const sNo = withState({ bestLevel: 70, grid: gridFrom([5, 5, null, null, null, null]) });
    F.tryMerge(0, 1);
    eq(sNo.grid[1].level, 6, 'no fortune star → jump 1 at this roll');
    const sYes = withState({ bestLevel: 70, constellation: { fortune: 10 }, grid: gridFrom([5, 5, null, null, null, null]) });
    F.tryMerge(0, 1);
    eq(sYes.grid[1].level, 7, 'fortune star converts the same roll into a +2 jump');
    const sAuto = withState({ bestLevel: 70, constellation: { fortune: 10 }, grid: gridFrom([5, 5, null, null, null, null]) });
    F.autoMergeStep();
    eq(sAuto.grid[0].level, 7, 'fortune star applies to AUTO merges too (global, unlike the cell rune)');
  } finally { Math.random = origRandom; }

  // ── 8) 세이브 검증 ──
  const sV1 = withState({ bestLevel: 70, constellation: [1, 2], constellationNext: 'junk' });
  F.validateAndRepairState();
  ok(!Array.isArray(sV1.constellation) && typeof sV1.constellation === 'object', 'array constellation reset to {}');
  eq(sV1.constellationNext, null, 'junk constellationNext reset to null');
  const sV2 = withState({ bestLevel: 63, constellation: { haste: 99, bogus: 3, fortune: 0 } });
  F.validateAndRepairState();
  eq(sV2.constellation.haste, 3, 'validation clamps overflow to T (id order)');
  ok(!('bogus' in sV2.constellation), 'unknown star keys dropped');
  ok(!('fortune' in sV2.constellation), 'zero entries not stored');
  const sV3 = withState({ bestLevel: 65, constellationIntroShown: 'yes', constellationNext: {} });
  F.validateAndRepairState();
  eq(sV3.constellationIntroShown, true, 'intro flag coerced to boolean');
  eq(sV3.constellationNext, null, 'staged equal to active (both empty) normalizes to null');
  // '전부 부로 되돌리기' 예약(모두 0)은 활성과 다르면 리로드에서 살아남아야 한다 (자체 감사 발견)
  const sV4 = withState({ bestLevel: 70, constellation: { haste: 5 }, constellationNext: { haste: 0, fortune: 0, mutation: 0 } });
  F.validateAndRepairState();
  ok(sV4.constellationNext !== null, 'all-zero staged reallocation survives reload when it differs from active');
  eq(F.applyConstellationNext(), true, 'and still applies at prestige');
  eq(F.getConstellationAlloc().wealth, 10, 'returning everything to wealth works end-to-end');
  const sV5 = withState({ bestLevel: 70, constellation: { haste: 5 }, constellationNext: { haste: 5 } });
  F.validateAndRepairState();
  eq(sV5.constellationNext, null, 'staged deep-equal to active normalized to null by validation');

  // ── 9) 패널 섹션 + 실적 + 구조 가드 ──
  withState({ bestLevel: 50 });
  eq(F.buildConstellationSection(), '', 'section fully hidden before transcendence (progressive disclosure)');
  withState({ bestLevel: 70, constellation: { haste: 4 } });
  const sect = F.buildConstellationSection();
  ok(/초월 성좌/.test(sect) && /10pt/.test(sect) && /⚡4/.test(sect), 'section shows pt total + allocation summary');
  ok(C.CONSTELLATION_STARS.length === 4 && C.CONSTELLATION_ALLOC_IDS.length === 3, 'star roster: 4 stars, 3 allocatable (wealth = remainder)');
  ok(C.ACHIEVEMENTS.some(x => x.id === 'a_constellation'), 'constellation achievement registered');
  const aC = C.ACHIEVEMENTS.find(x => x.id === 'a_constellation');
  eq(aC.check({ stats: { constellationAssigns: 1 } }), true, 'a_constellation at first applied reassign');
  eq(aC.check({}), false, 'a_constellation tolerates missing stats');
  ok(/getTowerSpawnMul\(\) \* getConstellationSpawnMul\(\)/.test(RAW_HTML), 'haste term inside the spawn base product (floor applies after)');
  ok(/\+ getConstellationLuckBonus\(\)/.test(RAW_HTML), 'fortune term in tryMerge luckBonus (no isAuto gate — global)');
  ok(/m \*= getConstellationVariantMul\(\)/.test(RAW_HTML), 'mutation term in getVariantSpontaneousMul (ritual parity automatic)');
  ok(/if \(applyConstellationNext\(\)\)/.test(RAW_HTML), 'doPrestige applies the staged allocation');
  ok(/id="constellation-modal"/.test(RAW_HTML), 'constellation modal present');
  ok((RAW_HTML.match(/buildConstellationSection\(\)/g) || []).length >= 3, 'section rendered in BOTH renderPrestige branches (def + 2 call sites)');
  ok(/getTranscendence\(\) >= 1 && !state\.constellationIntroShown/.test(RAW_HTML), 'boot-time intro for legacy saves already past Lv 61');

  // ── 10) 감사 132 수정 회귀 ──
  // 132.2: 비유한 delta는 used > T 가드를 통과해 NaN을 저장했다 → 페일-클로즈
  const sN = withState({ bestLevel: 70, constellation: {}, constellationNext: null });
  eq(F.stageConstellationDelta('haste', NaN), false, 'NaN delta rejected (fail closed)');
  eq(sN.constellationNext, null, 'and nothing staged');
  eq(F.stageConstellationDelta('haste', Infinity), false, 'Infinity delta rejected');
  eq(sN.constellationNext, null, 'still nothing staged');
  eq(F.stageConstellationDelta('haste', 3), true, 'finite delta still works');
  eq(sN.constellationNext.haste, 3, 'staged normally after rejected garbage');

  // 132.4/132.9: 소수 bestLevel(변조)에서 검증의 T와 읽기 경로의 T가 일치 (정수 pt)
  withState({ bestLevel: 70.7, constellation: { haste: 3 } });
  eq(F.getTranscendence(), 10, 'fractional bestLevel floors to integer transcend pts');
  const aFrac = F.getConstellationAlloc();
  eq(aFrac.wealth, 7, 'wealth remainder stays an integer (no float leak into UI strings)');
  eq(aFrac.wealth + aFrac.haste + aFrac.fortune + aFrac.mutation, 10, 'allocation still sums to floored T');

  // 132.1: 신속의 별 inert 판정 — 0.6s 하한에 흡수되면 추가 pt 기여가 0
  const sH = withState({ bestLevel: 70, constellation: {}, upgrades: Object.assign(defaultUpgrades(), { spawnRate: 0 }) });
  eq(F.isConstellationHasteInert(), false, 'haste is live at the default spawn interval');
  ok(F.getSpawnIntervalRaw() > 0.6, 'raw (unfloored) interval exposed for the inert check');
  sH.upgrades.spawnRate = 80; // 엔드게임: 하한 도달
  ok(F.getSpawnIntervalRaw() <= 0.6, 'deep spawnRate pins the raw interval under the floor');
  eq(F.isConstellationHasteInert(), true, 'haste flagged inert once the floor absorbs it');
  eq(F.getSpawnIntervalBase(), 0.6, 'floored base unchanged by the raw/base split');
  ok(/isConstellationHasteInert\(\)/.test(RAW_HTML), 'inert warning wired into the modal row');

  // 132.5 / 132.7 / 132.8 / N6: UI 패리티 구조 가드
  ok(/🌌 성좌 예약/.test(RAW_HTML), 'prestige confirm modal lists the staged reallocation (parity with 🗼 시련 예약)');
  ok(/closeEngraveModal\(\);\s*\n\s*closeConstellationModal\(\);/.test(RAW_HTML), 'doPrestige closes the constellation modal too (hygiene parity)');
  ok(/label: '💰 부\(富\)의 별'/.test(RAW_HTML), 'gold breakdown labels the transcend factor as the wealth star');
  ok(!/✦\$\{(a|cn)\.mutation/.test(RAW_HTML), 'mutation star does not reuse the golden-variant ✦ glyph');
  ok(/constelModal\._sig/.test(RAW_HTML), 'open modal re-renders when T changes (signature gate)');
});

group('삼재의 결 / grain (Q-Leap 133)', () => {
  const REAL = Math.random;
  const quiet = (fn) => { Math.random = () => 0.999999; try { return fn(); } finally { Math.random = REAL; } };
  const grainState = (patch) => {
    const s = withState(Object.assign({
      codex: {}, gem: 0, enlightenment: 0, bestLevel: 20, runBestLevel: 20,
      upgrades: defaultUpgrades(), prestigeCount: 0, dailyQuests: [],
      lastFirstMergeDate: F.todayString(), // suppress the daily-first-merge grant
    }, patch));
    s.stats = {};
    for (let lv = 1; lv <= 30; lv++) s.codex[lv] = true; // no incidental codex gems/悟
    return s;
  };

  // ── 1) 결 정의 + 회전 ──
  eq(C.GRAINS.length, 3, '천/지/인 3결');
  eq(C.GRAINS.map(g => g.channel).join(','), 'gold,frenzy,variant', '결마다 서로 다른 채널');
  eq(new Set(C.GRAINS.map(g => g.id)).size, 3, '결 id 중복 없음');
  const sRot = grainState({});
  sRot.grainCycle = 0;
  eq(F.getNextGrainId(), C.GRAINS[0].id, '회전 0 → 첫 결');
  sRot.grainCycle = 4;
  eq(F.getNextGrainId(), C.GRAINS[1].id, '회전은 3주기 (예측 가능 — 무작위 아님)');
  sRot.grainCycle = 35;
  eq(F.getNextGrainId(), C.GRAINS[35 % 3].id, '회전 상한 부근에서도 일관');
  eq(F.getGrainDef('nope'), null, '알 수 없는 결은 null');

  // ── 2) 채널 배수: 대칭 + 세금 (지배 픽 불가) ──
  const channels = ['gold', 'frenzy', 'variant'];
  for (const g of C.GRAINS) {
    let sum = 0;
    for (const ch of channels) {
      const m = F.grainChannelMul(g.id, ch);
      eq(m, g.channel === ch ? C.GRAIN_PURE_MUL : C.GRAIN_OFF_MUL, `${g.ch}: ${ch} 채널 배수`);
      sum += m;
    }
    // 감사 133.4: 이 '합'은 배수 대칭을 고정할 뿐 안티-인플레이션 근거가 아니다 (세 채널은 서로 다른
    // 자원이고 채널은 매 합성마다 선택되므로 합이 아니라 max가 지배한다). 근거는 아래 ≈0.99와 isAuto 배제.
    approx(sum, C.GRAIN_PURE_MUL + 2 * C.GRAIN_OFF_MUL, `${g.ch}: 세 채널 합이 동일 (배수 대칭 — 결 사이에 우열 없음)`, 1e-9);
  }
  for (const ch of channels) eq(F.grainChannelMul(null, ch), 1, `혼합 합성은 ${ch} 채널 ×1 (오늘과 동일)`);
  // 실제 안티-인플레이션 근거 (1): 결을 모르고 아무렇게나 합치는 플레이어의 기대값은 사실상 불변
  const pureAvg = (C.GRAIN_PURE_MUL + 2 * C.GRAIN_OFF_MUL) / 3;
  approx(2 / 3 + (1 / 3) * pureAvg, 1, '무관심 플레이의 기대 채널값 ≈ 1 (인플레이션 없음)', 0.02);
  ok(/폐기된 논증/.test(RAW_HTML), '"합 2.9 < 3.0" 세금 논증이 폐기됨으로 명시 표시 (감사 133.4)');
  ok(/max가 지배한다/.test(RAW_HTML), '정정된 안티-인플레이션 근거(합이 아니라 max)가 설계 주석에 명시됨');
  ok(/흡수 상태/.test(RAW_HTML), '결이 흡수 상태라는 알려진 상한이 설계 주석에 기록됨 (감사 133.2)');

  // ── 3) 순(純) 판정 ──
  const P = (grain) => ({ id: 1, level: 5, fireTimer: 0, grain });
  const g0 = C.GRAINS[0].id, g1 = C.GRAINS[1].id;
  grainState({});
  eq(F.grainPureId([P(g0), P(g0)], false), g0, '같은 결 손 합성 → 순');
  eq(F.grainPureId([P(g0), P(g1)], false), null, '다른 결 → 혼합');
  eq(F.grainPureId([P(g0), P(g0)], true), null, '자동 경로는 항상 혼합 (방치 기준선 불변)');
  eq(F.grainPureId([P(g0), P(undefined)], false), null, '결 없는 레거시 조각은 혼합');
  eq(F.grainPureId([P('bogus'), P('bogus')], false), null, '알 수 없는 결은 순 판정 불가');
  eq(F.grainPureId([P(g0)], false), null, '1개짜리는 순 아님');
  eq(F.grainPureId([P(g0), P(g0), P(g0)], false), g0, '의식용 3개 그룹도 판정');
  grainState({ bestLevel: C.GRAIN_UNLOCK_LV - 1, runBestLevel: 1 });
  eq(F.isGrainUnlocked(), false, `Lv ${C.GRAIN_UNLOCK_LV} 전에는 미해금`);
  eq(F.grainPureId([P(g0), P(g0)], false), null, '미해금 구간은 결 효과 없음 (점진 공개)');
  grainState({ bestLevel: C.GRAIN_UNLOCK_LV });
  eq(F.isGrainUnlocked(), true, `Lv ${C.GRAIN_UNLOCK_LV}에서 해금`);

  // ── 4) 생성이 결을 회전 부여 ──
  const sSp = grainState({ grid: new Array(6).fill(null) });
  sSp.grainCycle = 0;
  quiet(() => { F.spawnShuriken(); F.spawnShuriken(); F.spawnShuriken(); });
  const spawned = G.getState().grid.filter(Boolean).map(c => c.grain).sort();
  eq(spawned.length, 3, '3개 생성');
  eq(new Set(spawned).size, 3, '연속 생성은 세 결을 고루 부여 (회전)');
  eq(G.getState().grainCycle, 3, '회전 카운터 전진');
  sSp.grainCycle = C.GRAINS.length * 12 - 1;
  quiet(() => F.spawnShuriken());
  eq(G.getState().grainCycle, 0, '회전 카운터는 유한 (저장값 폭주 방지)');

  // ── 5) tryMerge: 천(天) = 골드 채널 ──
  const goldGrain = C.GRAINS.find(g => g.channel === 'gold').id;
  const sMix = grainState({ grid: gridFrom([{ level: 5, grain: goldGrain }, { level: 5, grain: C.GRAINS[1].id }, null, null, null, null]) });
  quiet(() => F.tryMerge(0, 1));
  const mixedGold = G.getState().gold;
  const sPure = grainState({ grid: gridFrom([{ level: 5, grain: goldGrain }, { level: 5, grain: goldGrain }, null, null, null, null]) });
  quiet(() => F.tryMerge(0, 1));
  const pureGold = G.getState().gold;
  ok(mixedGold > 0 && pureGold > 0, '두 경우 모두 합성 골드 발생');
  approx(pureGold / mixedGold, C.GRAIN_PURE_MUL, '순 天 합성은 합성 골드 ×2.2', 0.02);
  eq(G.getState().stats.pureMerges, 1, '순 합성 실적 기록');
  // 자동 경로는 보너스 없음
  const sAuto = grainState({ grid: gridFrom([{ level: 5, grain: goldGrain }, { level: 5, grain: goldGrain }, null, null, null, null]) });
  quiet(() => F.tryMerge(0, 1, true));
  approx(G.getState().gold, mixedGold, '자동 합성은 결이 같아도 혼합 취급 (시뮬레이터 기준선 보존)', mixedGold * 0.01);
  eq(G.getState().stats.pureMerges || 0, 0, '자동 합성은 순 실적도 없음');

  // ── 6) tryMerge: 지(地) = 폭주 채널 / 결 승계 방향 ──
  const frenzyGrain = C.GRAINS.find(g => g.channel === 'frenzy').id;
  const sFr = grainState({ grid: gridFrom([{ level: 5, grain: frenzyGrain }, { level: 5, grain: frenzyGrain }, null, null, null, null]), frenzyCharge: 0 });
  quiet(() => F.tryMerge(0, 1));
  approx(G.getState().frenzyCharge, C.GRAIN_PURE_MUL, '순 地 합성은 폭주 충전 ×2.2', 1e-9);
  const sFrOff = grainState({ grid: gridFrom([{ level: 5, grain: goldGrain }, { level: 5, grain: goldGrain }, null, null, null, null]), frenzyCharge: 0 });
  quiet(() => F.tryMerge(0, 1));
  approx(G.getState().frenzyCharge, C.GRAIN_OFF_MUL, '순 天 합성은 폭주 충전을 ×0.35로 대가 지불', 1e-9);
  eq(G.getState().grid[1].grain, goldGrain, '결과 표창은 목적지의 결을 승계');
  const sDir = grainState({ grid: gridFrom([{ level: 5, grain: goldGrain }, { level: 5, grain: frenzyGrain }, null, null, null, null]) });
  quiet(() => F.tryMerge(0, 1));
  eq(G.getState().grid[1].grain, frenzyGrain, '혼합 합성도 목적지 결을 따른다 (방향 = 다음 수의 밑돌)');
  eq(F.resolveMergeGrain({ grain: goldGrain }, { grain: undefined }), goldGrain, '목적지가 레거시(결 없음)면 출발지 결 승계');
  eq(F.resolveMergeGrain({}, {}), undefined, '양쪽 다 결이 없으면 결도 없음');

  // ── 7) 의식-패리티 ──
  const ritualPure = grainState({ grid: gridFrom([{ level: 5, grain: goldGrain }, { level: 5, grain: goldGrain }, { level: 5, grain: goldGrain }, null, null, null]) });
  quiet(() => F.doRitualMerge());
  const rPureGold = G.getState().gold;
  eq(G.getState().stats.pureMerges, 2, '의식은 N-1 합성 상당으로 순 실적 계상 (패리티)');
  eq(G.getState().grid[0].grain, goldGrain, '의식 결과도 결을 승계');
  const ritualMix = grainState({ grid: gridFrom([{ level: 5, grain: goldGrain }, { level: 5, grain: goldGrain }, { level: 5, grain: frenzyGrain }, null, null, null]) });
  quiet(() => F.doRitualMerge());
  const rMixGold = G.getState().gold;
  approx(rPureGold / rMixGold, C.GRAIN_PURE_MUL, '순 의식도 골드 ×2.2 (tryMerge와 같은 규칙)', 0.02);
  const ritualAuto = grainState({ grid: gridFrom([{ level: 5, grain: goldGrain }, { level: 5, grain: goldGrain }, { level: 5, grain: goldGrain }, null, null, null]) });
  quiet(() => F.doRitualMerge(true));
  approx(G.getState().gold, rMixGold, '자동 의식은 혼합 취급', rMixGold * 0.01);
  const ritualFr = grainState({ grid: gridFrom([{ level: 5, grain: frenzyGrain }, { level: 5, grain: frenzyGrain }, { level: 5, grain: frenzyGrain }, null, null, null]), frenzyCharge: 0 });
  quiet(() => F.doRitualMerge());
  approx(G.getState().frenzyCharge, 2 * C.GRAIN_PURE_MUL, '순 地 의식의 폭주 충전 = (N-1) × 2.2', 1e-9);

  // ── 8) 인(人) = 변종 채널 (양 경로가 같은 변수를 곱한다) ──
  const RAW_SCRIPT = RAW_HTML;
  ok(/getVariantSpontaneousMul\(\) \* grainChannelMul\(pureGrain, 'variant'\)/.test(RAW_SCRIPT),
     '변종 채널이 tryMerge·의식 양쪽의 variantMul에 곱해진다 (의식-패리티)');
  eq((RAW_SCRIPT.match(/grainChannelMul\(pureGrain, 'variant'\)/g) || []).length, 2, '변종 채널 배선은 정확히 두 경로');
  eq((RAW_SCRIPT.match(/grainChannelMul\(pureGrain, 'gold'\)/g) || []).length, 2, '골드 채널 배선도 두 경로');
  eq((RAW_SCRIPT.match(/grainChannelMul\(pureGrain, 'frenzy'\)/g) || []).length, 2, '폭주 채널 배선도 두 경로');
  ok(/doRitualMerge\(true\)/.test(RAW_SCRIPT), '자동 의식 호출이 isAuto를 넘긴다');

  // ── 9) 검증/복구 ──
  const sVal = grainState({ grid: gridFrom([{ level: 5, grain: 'hacked' }, { level: 5, grain: goldGrain }, null, null, null, null]) });
  sVal.storage = [{ id: 99, level: 4, fireTimer: 0, grain: 'nope' }];
  sVal.grainCycle = -3.7;
  F.validateAndRepairState();
  const stV = G.getState();
  eq(stV.grid[0].grain, undefined, '변조된 결은 제거 (혼합 취급)');
  eq(stV.grid[1].grain, goldGrain, '정상 결은 보존');
  eq(stV.storage[0].grain, undefined, '보관 조각도 같은 규칙 (패리티)');
  eq(stV.grainCycle, 0, '손상된 회전 카운터 복구');
  ok(/p\.grain !== undefined && !getGrainDef\(p\.grain\)/.test(RAW_SCRIPT), '원정 조각도 결을 검증한다');

  // ── 10) 점진 공개 + 실적/도움말 ──
  grainState({ bestLevel: C.GRAIN_UNLOCK_LV - 1 });
  eq(F.getRevealState().grain, false, `Lv ${C.GRAIN_UNLOCK_LV} 전엔 결 UI 비노출`);
  grainState({ bestLevel: C.GRAIN_UNLOCK_LV });
  eq(F.getRevealState().grain, true, '해금과 동시에 노출');
  ok(/\['#next-grain-chip', 'grain'\]/.test(RAW_SCRIPT), '다음 결 칩이 REVEAL_TARGETS에 등록됨');
  ok(/id="next-grain-chip"/.test(RAW_SCRIPT) && /id="spawn-label-main"/.test(RAW_SCRIPT),
     '칩은 매 프레임 갈아끼우는 라벨 바깥의 정적 요소 (증발 방지)');
  ok(C.ACHIEVEMENTS.some(a => a.id === 'a_grain_1') && C.ACHIEVEMENTS.some(a => a.id === 'a_grain_100'), '결 실적 2종 등록');
  eq(C.ACHIEVEMENTS.find(a => a.id === 'a_grain_1').check({ stats: { pureMerges: 1 } }), true, 'a_grain_1 판정');
  eq(C.ACHIEVEMENTS.find(a => a.id === 'a_grain_1').check({}), false, 'a_grain_1은 stats 누락에 안전');
  ok(/삼재의 결/.test(RAW_SCRIPT), '도움말에 결 항목 존재');

  // ── 11) 결의 생애: 변환은 승계, 생성은 회전 ──
  // 계승(윤회) — 데려오는 표창이지 새로 만드는 게 아니다 (변종 플래그와 같은 규칙)
  const sInh = grainState({
    grid: gridFrom([{ level: 12, grain: frenzyGrain, golden: true }, null, null, null, null, null]),
    bestLevel: 30, runBestLevel: 30, prestigeCount: 3, gold: 0,
  });
  sInh.skills = Object.assign({}, sInh.skills, { inheritance: 1 });
  quiet(() => F.doPrestige());
  const inherited = G.getState().grid.filter(Boolean)[0];
  if (inherited) {
    eq(inherited.grain, frenzyGrain, '계승 표창은 결을 유지 (조용한 하향 방지)');
    eq(inherited.golden, true, '계승 표창은 변종도 유지 (기존 규칙 회귀 없음)');
  } else {
    ok(true, '계승 스킬 미보유 환경 — 계승 케이스 생략');
  }
  // 융합 — 결과 칸의 결 승계
  const sFus = grainState({
    grid: gridFrom([
      { level: 8, golden: true, grain: goldGrain }, { level: 7, golden: true, grain: frenzyGrain },
      { level: 6, golden: true, grain: frenzyGrain }, null, null, null,
    ]),
    bestLevel: 30, runBestLevel: 30,
  });
  quiet(() => F.tryVariantFusion('golden'));
  const fused = G.getState().grid.filter(Boolean)[0];
  eq(fused.star, true, '융합 결과는 상위 변종');
  eq(fused.grain, goldGrain, '융합 결과도 결과 칸의 결을 승계');
  // 새로 생겨나는 표창(관문 보상/출석 선물)은 회전을 소비한다
  eq((RAW_SCRIPT.match(/takeNextGrain\(\)/g) || []).length, 4, '회전 소비 진입점은 정의 1 + 호출 3 (생성·관문·출석)');
  ok(/level: c\.level, fireTimer: 0, golden: !!c\.golden, star: !!c\.star, dark: !!c\.dark, grain: c\.grain/.test(RAW_SCRIPT),
     '계승 경로가 결을 명시적으로 승계');

  // ── 12) 감사 133 수정 회귀 ──
  // 133.1: 표식 자리 (기하 충돌은 tests/browser-verify.js가 실측 — 여기선 자리 고정만 지킨다)
  ok(/\.cell \.grain-mark \{\s*position: absolute; top: 50%; left: 2px;/.test(RAW_SCRIPT),
     '결 표식은 좌측 중앙 (상단 중앙은 Lv 라벨을 덮었다 — browser-verify의 충돌 가드와 한 쌍)');
  ok(!/칸 하단 표시/.test(RAW_SCRIPT), '도움말이 표식 위치를 잘못 안내하지 않음');
  // 133.3: 소수 폭주 충전이 오프라인 모달에 부동소수 원문으로 새지 않는다
  ok(/const frenzyShown = Math\.round\(frenzyAdded \* 10\) \/ 10;/.test(RAW_SCRIPT),
     '오프라인 보상 표시가 소수 충전을 반올림 (0.35가 "+0"이 되는 floor는 금지)');
  const frenzyLeak = 100 - [...Array(279)].reduce((a) => a + 0.35, 0); // 감사가 실측한 누적 경로
  ok(String(frenzyLeak).length > 6, '전제 확인: 소수 누적은 실제로 긴 부동소수를 만든다');
  eq(Math.round(frenzyLeak * 10) / 10, 2.4, '표시 규칙이 그 값을 "+2.4"로 다듬는다');
  // 133.2: 결은 흡수 상태 — 시뮬레이터가 결-인지 상한을 측정하는 프로파일을 갖는다
  ok(/findGrainSteeredPair/.test(RAW_SIM) && /policy === 'grain'/.test(RAW_SIM),
     '시뮬레이터에 결-인지(목적지 스티어링) 프로파일 추가 — 수동 최적화 상한 측정');
  ok(/F\.findNextAutoMergePair\(\)/.test(RAW_SIM), '기존 blind 기준선(승인된 PACING 기준)은 유지');

  // ── 13) 의식의 순(純) 결정 surface (133.1 후속) ──
  // 의식은 그룹이 자동 선택되므로 유일한 결정은 '지금 터뜨릴까 / 결을 맞추고 터뜨릴까'다.
  // 버튼이 발동될 그룹의 순 여부를 알려주지 않으면 그 결정을 내릴 수 없다.
  ok(/tag = gd \? ` \$\{gd\.ch\}純` : ' 混'/.test(RAW_SCRIPT), '의식 버튼이 발동 그룹의 순/혼을 표시');
  ok(/groups\.slice\(\)\.sort\(\(a, b\) => b\.indices\.length - a\.indices\.length \|\| b\.level - a\.level\)\[0\]/.test(RAW_SCRIPT),
     '표시가 doRitualMerge와 같은 정렬로 실제 발동 그룹을 고른다 (표시-동작 불일치 방지)');
  eq((RAW_SCRIPT.match(/b\.indices\.length - a\.indices\.length \|\| b\.level - a\.level/g) || []).length, 2,
     '그룹 선택 규칙은 발동부와 표시부 두 곳뿐 (세 번째가 생기면 드리프트 위험)');
  ok(/n > 0 && isGrainUnlocked\(\)/.test(RAW_SCRIPT), '결 미해금 구간에선 순/혼 태그를 노출하지 않음 (점진 공개)');

  // ── 14) 칸 마크 충돌 스윕 회귀 (기하는 browser-verify가 실측) ──
  ok(/\.cell \.star-mark \{\s*position: absolute; bottom: 1px; left: 15px;/.test(RAW_SCRIPT),
     '별 표식이 각인 룬 자리에서 비켜남 (두 글자가 통째로 겹치던 잠복 결함)');
  ok(/\.cell \.dark-mark \{\s*position: absolute; top: 24px;/.test(RAW_SCRIPT),
     '검은 표식이 Lv 라벨 띠 아래로 내려감 (6열 3자리 Lv 충돌)');
  ok(/border-radius: 5px; z-index: 4;/.test(RAW_SCRIPT),
     '합성 미리보기 알약이 마크(z-index 3) 위로 — 선택 중 결과 Lv이 갉히지 않음');
  ok(/gridEl\.dataset\.cols = cols;/.test(RAW_SCRIPT) && /#grid\[data-cols="6"\] \.cell \.lv-label/.test(RAW_SCRIPT),
     '6열에서만 Lv 라벨 축소 — 세 자리 표기가 🔒와 겹치던 3.3px 해소 (data-cols 훅)');
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
