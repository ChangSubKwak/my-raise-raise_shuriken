# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

표창키우기 — 합체 (Shuriken Merge). A grid-based merge game (2048-style) with idle/incremental progression. Two same-level shuriken on the grid merge into the next level; shurikens on the grid passively generate gold by level. Goal: reach the highest shuriken level, prestige (윤회), and beyond into transcendence (초월). (An early combat sub-game was removed in v2.5; gold is now purely passive + merge rewards.)

**v1 vs v2**: This repo previously held a different game (single-trajectory tower-defense idle with 30 systems, 5200+ lines). It is preserved at `index_v1.html` for reference but is **not the active design**. The merge mechanic in `index.html` is the canonical game. Do not port v1 systems into v2 unless asked — v2 is intentionally scoped down.

## Run

```bash
open index.html                  # macOS browser
python3 -m http.server 8000      # local server alternative
```

Single self-contained file. No build, no dependencies. Same convention as v1.

## Mandatory after every JS edit

```bash
node -e "const s=require('fs').readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1]; new Function(s); console.log('OK')"
```

Silent JS errors are the dominant failure mode in a single-file game. Run this before declaring any change complete.

## Tests

```bash
npm run check     # parse (above) + pure-logic test suite
npm test          # tests only
npm run scan      # advisory dead-code scan: def-only functions + orphaned CSS #ids
```

Zero-install: `tests/harness.js` reads `index.html`, extracts the `<script>`, stubs the
browser (DOM/localStorage/Web Audio via a recursive proxy), and evaluates it in a `vm`
context with `boot()` suppressed. Block-scoped `const`/`let` functions are captured into
`globalThis.__GAME__` by code appended to the script (they don't leak onto the vm context
otherwise). `tests/game.test.js` then asserts on the **pure** logic only — damage/gold
formulas, transcendence, set bonuses, auto-merge priority, line bonus, daily-spin/exchange,
level naming, spawn interval. DOM-rendering paths are intentionally out of scope. Add a test
whenever you add a deterministic formula or a new derived stat.

## Architecture (v2 merge)

**Layout, by design**:
- Top: HUD (gold/gem) + daily-challenge / weekday banners.
- Middle (grid-wrap): `<div id="grid">` — DOM-based grid of cells. Each cell holds a shuriken or is empty. Header has core actions + a ☰ menu for modal buttons.
- Bottom (spawn-bar): generation gauge + spawn/auto-merge/burn controls (wraps on narrow screens).
- Right (or stacked on mobile): upgrade + skill-tree + prestige panel.

The **grid is DOM** because drag/select-target is much cleaner with element event handlers; do NOT migrate it to canvas (you'll lose pointer-event sanity). NOTE: the old combat sub-game (canvas, enemies, projectiles, particle FX) was removed in v2.5 and its dead code deleted in v3.34 — gold is now purely passive (`getPassiveGoldRate`) + merge rewards. There is no combat canvas.

**Grid sprite rendering**: each cell contains a small `<canvas>` painted by `drawShurikenSprite(canvas, level)`. The sprites rotate via `setInterval(repaintGridSprites, 100)` — every 100ms all grid sprites repaint, reading `Date.now()` for rotation phase. Empty cells have no sprite (skip).

**State & persistence**:
- `state.grid` is a flat array of length `getGridSize()` = `min(30, 6 + state.upgrades.maxShuriken)` — i.e. base 6, +1 per `maxShuriken` upgrade level, hard-capped at 30. (There is no separate `gridSize` upgrade.) Because size grows by 1, **most grids are non-rectangular**: `getGridCols()` is 3/4/5/6 and the last row/column is often partial. Any grid-geometry code must skip phantom cells (`idx >= size`), not assume a full rectangle — see `checkLineBonus`.
- Cell entry: `{ id, level, fireTimer }` or `null`.
- `state.spawnCount` resets each stage start (`startStage()`) — that's the cost-escalation scope.
- localStorage key: `shuriken_merge_v2` (distinct from v1's `shuriken_save_v1`).

**Merge mechanic** (`tryMerge(fromIdx, toIdx)`):
- empty target → move
- same level → merge: `toIdx` becomes `level+1`, `fromIdx` cleared, `bestLevel` updated
- different level → swap

The UI is **tap-tap, not drag-drop**: tap source to select (highlights), tap target to act. Simpler on mobile and easier to reason about. `selectedIdx` tracks the first tap.

**Ritual-parity invariant**: `doRitualMerge` (의식 합성, 3+ same-level group → one higher piece) is a second merge path that must mirror `tryMerge`'s bookkeeping, counting a ritual of N pieces as **N-1 merge-equivalents**. Both paths must credit: merge count (`creditMerges`), daily-merge tiers (`addDailyMergeCount`), daily challenge (`addChallengeProgress`), frenzy meter (`addFrenzyCharge`), per-merge procs (`rollMergeProcs`), level/transcend milestones, even-level 💎, auto-lock (`autoLockPass`), blessed-cell consumption, codex/transcend/line bonuses, and **spontaneous variant generation** (0 variant parents → ritual rolls `1-(1-p)^(N-1)` at tryMerge's rates incl. variantMul/goldenLuck/frenzy; inheritance uses 0.7 per variant parent vs tryMerge's 0.5). Anything counted as "a merge" in `tryMerge` must also fire in `doRitualMerge` (scaled by N-1). Intentionally **tryMerge-only**: combo chain, lucky/divine procs (those are 2-piece-merge mechanics). When adding any new merge reward, wire BOTH paths or you create silent drift.

**Milestone jump-skip invariant**: `bestLevel`/`comboCount`/transcendence can jump multiple steps in one merge (lucky/ritual/divine/blessed). Any threshold-keyed reward (`MILESTONES`, `TRANSCEND_MILESTONES`, `COMBO_MILESTONES`) must grant **every threshold crossed in `(prev, new]`**, not just an exact `[new]` lookup — follow the range-crossing pattern in `creditMerges`. Counters that only ever +1 (attendance streak, `addDailyMergeCount`) are exempt.

**Gold income (passive, no combat)**: `getPassiveGoldRate()` is the single source of truth — `Σ 0.5·2^(level-1) · synergyMul · centerBonus · getGoldMul() · getPassiveGoldBonus()` over occupied cells. `update()` accrues this; the HUD readout and offline reward call the same fn (they must never diverge). Merge/ritual gold uses `2^newLv · getGoldMul() · combo · jump · getMergeGoldBonus()`.

**Upgrades** (modeled after original 표창키우기 item names):
- `maxShuriken` — **최대 표창 수** (field cap). +1 slot per level, base 6 → cap 30. The defining stat — limits how many shurikens you can hold while waiting to merge.
- `spawnRate` — **제작시간 감소**. `getSpawnInterval()` = `base × 0.95^lv × (many other multipliers: stars 0.7^n, swiftHands, burning, frenzy, trial, elite, strategy mode…)`, floored at **0.6s**. Base is **16s** (v3.63; raised from 12 to slow the gauge per player feedback). New players boot at `spawnProgress 0.6` so the first spawn is quick.
- `spawnBatch` — **제작 최대치**. +1 shuriken spawned per tick (when progress hits 1.0). Cap 6.
- `firerate` — **연마 (패시브 골드)**. Repurposed (combat sub-game removed): passive gold +8%/lv via `getPassiveGoldBonus()`. (id kept for save compat; legacy `getFireInterval`/`getTotalDPS` are now dead.)
- `baseDmg` — **정밀 합성 (합성 골드)**. Repurposed: merge + ritual gold +8%/lv via `getMergeGoldBonus()`. (id kept; legacy `shurikenDmg` only feeds the info-modal DPS-share ratio where it cancels.)
- `goldMul` — +10%/lv gold (applies to all gold via `getGoldMul`).
- `spawnLevel` — `1 + lv`; spawned shurikens start at this level (huge mid-game power).

**Time-based generation (NOT cost-based)**: No gold cost to spawn — generation is purely time-gated by `getSpawnInterval()`. This is the explicit design point: avoid making the game feel like a defense-driven economy. Gold/combat is a **side resource** that funds upgrades; shuriken count grows on its own clock. The HUD shows `현재/최대` next to the grid + spawn-batch multiplier.

**Spawn full state**: when `emptySlots().length === 0`, `state.spawnProgress` is clamped to 1.0 (the bar shows "그리드 가득참 — 합쳐서 공간 확보"). This is the tension point — players must merge to free space, which is the entire loop.

**Prestige (윤회)**: unlocked at `bestLevel >= 8`. Resets gold/stage/most upgrades but preserves: `prestigeCount`, `bestLevel`, the `maxShuriken`/`spawnBatch`/`luckChance` upgrades, and the global multiplier `(1 + 0.5 * prestigeCount)` on gold. Intentional that `maxShuriken` doesn't reset — players keep the larger field. Also resets run-transient activity state (combo/frenzy/goldRush/burning timers + frenzy meter) so a fresh run starts clean.

**Variant Fusion (변종 융합)**: sacrifice 3 same-variant pieces → 1 of the next-rarer tier (`VARIANT_FUSION_NEXT`: golden→star→dark; dark is top, no fusion). `tryVariantFusion(kind)` consumes the 3 highest-level carriers (non-locked), result keeps the highest level at the lowest consumed index. Gives passive variants a strategic hoard-vs-craft decision + a non-luck path to rare variants. UI = a conditional button injected into the info modal (`showShurikenInfo`). Additive/opt-in. Stat: `fusionsUsed`.

**Strategy Mode (전략)**: a prestige-tier choice of mutually-exclusive **trade-off** run modifiers (`STRATEGY_MODES`: none/gold/fast/variant). Each gain has an offsetting loss (e.g. gold +30% / spawn 18% slower) → no dominant pick, a genuine playstyle decision. Effects via `getStrategy{Gold,Spawn,Variant}Mul()` wired into `getGoldMulBreakdown`/`getSpawnInterval`/`getVariantSpontaneousMul`. `state.strategyMode` is a persistent **setting** (survives prestige; validated on load). Selected via a cycling button injected into the prestige panel (`renderPrestige`); active mode shows in the weekday banner. Stat: `strategyUsed`.

**Achievement rewards**: achievements now grant 💎 on unlock (`getAchievementGem`: per-entry `gem` → `ACHIEVEMENT_CAPSTONES` → default 3) + collection milestones (`grantAchievementCompletion`, range-crossing for jump-safety) at 10/25/50/75/all. No retroactive grant (migration-safe). Codex has a parallel next-milestone readout (`getNextCodexMilestone`).

**Animations & feedback**:
- `flashCell(idx)` scales + glow on successful merge.
- `spawnExplosion` / `spawnGoldBurst` particle bursts on enemy death.
- `shakeScreen(amt)` decays at 0.85 per frame.
- 10 SFX types (synthesized via Web Audio); shared mute toggle persisted to `localStorage`.

## What to avoid

- Don't bring back v1's 30 systems. The whole point of v2 is the focused merge loop.
- Don't switch the merge UI to drag-drop without a clear benefit — tap-tap is reliable cross-platform.
- Don't make grid size dynamic outside the `maxShuriken` upgrade — many places assume `state.grid.length === getGridSize()`.
- Don't add backwards-compatibility shims for v1 saves; the keys are distinct and v1 lives at `index_v1.html`.

## User-global rules (from ~/.claude/CLAUDE.md)

Quantum Leap framework applies for "의미있는 진행" requests. Constraints that apply here:
- Single-file preservation — same file rule as v1.
- JS parse verification after every turn — see mandatory command above.
- Score inflation avoidance — for v2, this means resist adding new multiplier-only stats. New systems should add new player decisions (a new spawn-side mechanic, a new enemy archetype that interacts with merge state, etc.) or new sensory dimensions.
