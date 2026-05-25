# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

표창키우기 — 합체 (Shuriken Merge). A grid-based merge game (2048-style) crossed with idle tower-defense. Two same-level shuriken on the grid merge into the next level; all shurikens on the grid auto-fire at enemies in a combat zone above. Goal: reach the highest shuriken level and clear stages.

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

**Two-region layout, by design**:
- Top (combat-wrap): `<canvas id="combat">` — enemies walk left, projectiles fly up from below.
- Middle (grid-wrap): `<div id="grid">` — DOM-based grid of cells. Each cell holds a shuriken or is empty.
- Bottom: spawn button + auto-toggles.
- Right (or stacked on mobile): upgrade panel.

The DOM-vs-canvas split is intentional: the **grid is DOM** because drag/select-target is much cleaner with element event handlers; **combat is canvas** because it has continuous animation, particles, and projectiles. Do NOT migrate the grid into canvas (you'll lose pointer-event sanity) and do NOT migrate combat into DOM (perf will tank).

**Grid sprite rendering**: each cell contains a small `<canvas>` painted by `drawShurikenSprite(canvas, level)`. The sprites rotate via `setInterval(repaintGridSprites, 100)` — every 100ms all grid sprites repaint, reading `Date.now()` for rotation phase. Empty cells have no sprite (skip).

**State & persistence**:
- `state.grid` is a flat array of length `getGridSize()` (9 → 12 → 16 → 20 → 25 based on `state.upgrades.gridSize`).
- Cell entry: `{ id, level, fireTimer }` or `null`.
- `state.spawnCount` resets each stage start (`startStage()`) — that's the cost-escalation scope.
- localStorage key: `shuriken_merge_v2` (distinct from v1's `shuriken_save_v1`).

**Merge mechanic** (`tryMerge(fromIdx, toIdx)`):
- empty target → move
- same level → merge: `toIdx` becomes `level+1`, `fromIdx` cleared, `bestLevel` updated
- different level → swap

The UI is **tap-tap, not drag-drop**: tap source to select (highlights), tap target to act. Simpler on mobile and easier to reason about. `selectedIdx` tracks the first tap.

**Auto-fire from the grid**:
- Each cell's `fireTimer` ticks down independently in `tickGrid(dt)`.
- On fire: spawn `Projectile` from a virtual position `(col + 0.5) / cols * W` at `y = H_combat + 6` (just below the combat canvas), aimed at `nearestEnemy()`.
- This makes column position visually map to fire origin — left grid cells fire from the left, right cells from the right.
- `nearestEnemy()` picks the **leftmost in-view** enemy (closest to player), not closest by Euclidean distance — strategically more useful.

**Damage formula**:
```
shurikenDmg(level) = getBaseDmg() * 2^(level - 1) * (1 + prestige * 0.5)
                   = (5 + baseDmg_lv * 2) * 2^(level - 1) * (1 + 0.5 * prestige)
```
Exponential in level — that's the whole point. Merging a Lv5 + Lv5 → Lv6 doubles your damage *for that single shuriken*; the new tier far outpaces having two of the lower tier.

**Wave system**: identical structure to v1 — 10 waves per stage then a boss with a 30s timer. If boss timer expires, `stageFail()` rolls back to fresh stage 1 of current run (gold/grid/upgrades preserved). Boss HP multiplier is `×12` (v2 tuned lighter than v1's `×15`).

**Upgrades** (modeled after original 표창키우기 item names):
- `maxShuriken` — **최대 표창 수** (field cap). +1 slot per level, base 6 → cap 30. The defining stat — limits how many shurikens you can hold while waiting to merge.
- `spawnRate` — **제작시간 감소**. Interval × 0.95^lv, base 5s.
- `spawnBatch` — **제작 최대치**. +1 shuriken spawned per tick (when progress hits 1.0). Cap 6.
- `firerate` — **연마 (패시브 골드)**. Repurposed (combat sub-game removed): passive gold +8%/lv via `getPassiveGoldBonus()`. (id kept for save compat; legacy `getFireInterval`/`getTotalDPS` are now dead.)
- `baseDmg` — **정밀 합성 (합성 골드)**. Repurposed: merge + ritual gold +8%/lv via `getMergeGoldBonus()`. (id kept; legacy `shurikenDmg` only feeds the info-modal DPS-share ratio where it cancels.)
- `goldMul` — +10%/lv gold (applies to all gold via `getGoldMul`).
- `spawnLevel` — `1 + lv`; spawned shurikens start at this level (huge mid-game power).

**Time-based generation (NOT cost-based)**: No gold cost to spawn — generation is purely time-gated by `getSpawnInterval()`. This is the explicit design point: avoid making the game feel like a defense-driven economy. Gold/combat is a **side resource** that funds upgrades; shuriken count grows on its own clock. The HUD shows `현재/최대` next to the grid + spawn-batch multiplier.

**Spawn full state**: when `emptySlots().length === 0`, `state.spawnProgress` is clamped to 1.0 (the bar shows "그리드 가득참 — 합쳐서 공간 확보"). This is the tension point — players must merge to free space, which is the entire loop.

**Combat sub-game**: combat zone (top of stage) is intentionally smaller than the grid. Enemies walk, shurikens auto-fire, gold accumulates. Player never directly interacts with combat. The UI text under the grid says "전투는 백그라운드 서브게임" to make this clear.

**Prestige (윤회)**: unlocked at `bestLevel >= 8`. Resets gold/stage/upgrades but preserves: `prestigeCount`, `bestLevel`, `gridSize` upgrade, and the global multiplier `(1 + 0.5 * prestigeCount)` on damage AND gold. Intentional that gridSize doesn't reset — players keep the larger field.

**Animations & feedback**:
- `flashCell(idx)` scales + glow on successful merge.
- `spawnExplosion` / `spawnGoldBurst` particle bursts on enemy death.
- `shakeScreen(amt)` decays at 0.85 per frame.
- 10 SFX types (synthesized via Web Audio); shared mute toggle persisted to `localStorage`.

## What to avoid

- Don't bring back v1's 30 systems. The whole point of v2 is the focused merge loop.
- Don't switch the merge UI to drag-drop without a clear benefit — tap-tap is reliable cross-platform.
- Don't make grid size dynamic outside `gridSize` upgrade — many places assume `state.grid.length === getGridSize()`.
- Don't add backwards-compatibility shims for v1 saves; the keys are distinct and v1 lives at `index_v1.html`.

## User-global rules (from ~/.claude/CLAUDE.md)

Quantum Leap framework applies for "의미있는 진행" requests. Constraints that apply here:
- Single-file preservation — same file rule as v1.
- JS parse verification after every turn — see mandatory command above.
- Score inflation avoidance — for v2, this means resist adding new multiplier-only stats. New systems should add new player decisions (a new spawn-side mechanic, a new enemy archetype that interacts with merge state, etc.) or new sensory dimensions.
