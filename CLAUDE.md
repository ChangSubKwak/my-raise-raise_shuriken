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
- `spawnRate` — **제작시간 감소**. `getSpawnInterval()` = `base × 0.95^lv × (many other multipliers: stars 0.7^n, swiftHands, frenzy, trial, elite, strategy/forge mode…)`, floored at **0.6s**. Base is **16s** (v3.63; raised from 12 to slow the gauge per player feedback). New players boot at `spawnProgress 0.6` so the first spawn is quick.
- `spawnBatch` — **제작 최대치**. +1 shuriken spawned per tick (when progress hits 1.0). Cap 6.
- `firerate` — **연마 (패시브 골드)**. Repurposed (combat sub-game removed): passive gold +8%/lv via `getPassiveGoldBonus()`. (id kept for save compat; legacy `getFireInterval`/`getTotalDPS` are now dead.)
- `baseDmg` — **정밀 합성 (합성 골드)**. Repurposed: merge + ritual gold +8%/lv via `getMergeGoldBonus()`. (id kept; legacy `shurikenDmg` only feeds the info-modal DPS-share ratio where it cancels.)
- `goldMul` — +10%/lv gold (applies to all gold via `getGoldMul`).
- `spawnLevel` — `1 + lv`; spawned shurikens start at this level (huge mid-game power).

**Time-based generation (NOT cost-based)**: No gold cost to spawn — generation is purely time-gated by `getSpawnInterval()`. This is the explicit design point: avoid making the game feel like a defense-driven economy. Gold/combat is a **side resource** that funds upgrades; shuriken count grows on its own clock. The HUD shows `현재/최대` next to the grid + spawn-batch multiplier.

**Spawn full state**: when `emptySlots().length === 0`, `state.spawnProgress` is clamped to 1.0 (the bar shows "그리드 가득참 — 합쳐서 공간 확보"). This is the tension point — players must merge to free space, which is the entire loop.

**Prestige (윤회)**: unlocked at `bestLevel >= 8`. Resets gold/stage/most upgrades but preserves: `prestigeCount`, `bestLevel`, the `maxShuriken`/`spawnBatch`/`luckChance` upgrades, and the global multiplier `(1 + 0.5 * prestigeCount)` on gold. Intentional that `maxShuriken` doesn't reset — players keep the larger field. Also resets run-transient activity state (combo/frenzy/goldRush timers + frenzy meter) so a fresh run starts clean.

**Variant Fusion (변종 융합)**: sacrifice 3 same-variant pieces → 1 of the next-rarer tier (`VARIANT_FUSION_NEXT`: golden→star→dark; dark is top, no fusion). `tryVariantFusion(kind)` consumes the 3 highest-level carriers (non-locked), result keeps the highest level at the lowest consumed index. Gives passive variants a strategic hoard-vs-craft decision + a non-luck path to rare variants. UI = a conditional button injected into the info modal (`showShurikenInfo`). Additive/opt-in. Stat: `fusionsUsed`.

**Strategy Mode (전략)**: a prestige-tier choice of mutually-exclusive **trade-off** run modifiers (`STRATEGY_MODES`: none/gold/fast/variant). Each gain has an offsetting loss (e.g. gold +30% / spawn 18% slower) → no dominant pick, a genuine playstyle decision. Effects via `getStrategy{Gold,Spawn,Variant}Mul()` wired into `getGoldMulBreakdown`/`getSpawnInterval`/`getVariantSpontaneousMul`. `state.strategyMode` is a persistent **setting** (survives prestige; validated on load). Selected via a cycling button injected into the prestige panel (`renderPrestige`); active mode shows in the weekday banner. Stat: `strategyUsed`.

**Forge Mode (제련 모드)**: the spawn-side tactical dial CLAUDE.md's Q-Leap rule asks for (`FORGE_MODES`: standard / 🔥 fine ×2.2 interval +1 start Lv / 🌪 swift ×0.55 interval −1 start Lv; unlock `bestLevel >= FORGE_UNLOCK_LV` = 6). Spawning stays purely time-gated (no gold cost — the design point) but the player chooses WHAT to smelt. Both specializations pay the same ~9% raw value-rate tax vs standard (2/2.2 = 0.5/0.55 ≈ 0.909, asserted in tests) so there is no dominant pick — fine buys slot/tap economy (grid pressure, idle), swift buys merge-event volume (combo, frenzy charge, merge quests). Unlike Strategy Mode (run-level policy chosen at prestige), forge is switchable ANY time via the spawn-bar cycle button (`#forge-btn`). Gates in `forgeEffective()`: inert when locked, on 고행-type floors (`isTowerSpawnLv1` — pin wins, penalty removed too), swift is inert at effective start Lv ≤1 counting the post-prestige +2 boost window (no free acceleration — the anti-dominance keystone) AND when `getSpawnIntervalBase()` is pinned at the 0.6s floor (zero speed gain possible → −1 Lv would be a silent pure loss); the button shows 🚫 whenever the selected mode is inert. **Floor-ordering invariant (audit 128.1)**: the interval is `max(0.6, getSpawnIntervalBase() × getForgeSpawnMul())` where the BASE is floored first — putting the forge mul inside the base product would let the endgame floor (uncapped cheap `spawnRate` pins it) absorb fine's ×2.2 entirely, making +1 Lv free (value rate ×2) and inverting the non-dominance design; tests assert the ratio at the floor. Wired as `getForgeLevelDelta()` in `getNextSpawnLevel` (clamped ≥1). `spawnShuriken` calls `noteLevelReached` when a spawn exceeds all-time `bestLevel` (masterSmith+boost+fine can overtake a Lv8 best; without it the validate-repair path silently ate the level's one-shot rewards). `state.forgeMode` is a persistent setting (survives prestige; validated on load like `strategyMode`). Stat: `forgeUsed`.

**Daily Market (오늘의 표창 시세)**: each day, ONE shuriken level sells at a ×2–4 premium. `getMarketLevel(dateStr)` is date-seeded (`questSeed`) but anchored to the **current run's** frontier — a level in `[runBestLevel-9, runBestLevel]` (min band floor at 8), re-rolling only every ~5 run-levels (`Math.floor(top/5)` in the seed) so it stays relevant at any depth and stable within a day. (Anchored to `runBestLevel`, NOT all-time `bestLevel`, so it doesn't strand on unreachable highs right after prestige resets the grid; pre-prestige the two are equal.) `getMarketMul(dateStr)` → 2/3/4. Both are **pure** (read `state.bestLevel` + date only, no persisted field → migration-safe). Wired into `sellValue` (`if (c.level === getMarketLevel()) mul *= getMarketMul()`, stacks multiplicatively with variant ×5s); shown in the weekday banner; `sellShuriken` increments `stats.marketSells` + toasts on a premium sale. Design intent: promote the underused manual-sell mechanic into a **hold-vs-sell timing decision** (selling consumes the piece → loses merge frontier + passive gold, so the premium is an opportunity-cost tradeoff, NOT a free multiplier — respects the anti-inflation rule).

**Expedition (표창 원정)**: send ONE shuriken off-grid on a real-time timer (`EXPEDITION_TIERS`: 정찰 10m/Lv5+ ×2.0, 원정 1h/Lv8+ ×2.5 +💎3, 대원정 8h/Lv12+ ×3.0 +💎7 + 18% grow-chance). Unlocked at `bestLevel >= EXPEDITION_UNLOCK_LV` (10). While away the piece contributes NOTHING (no passive gold, no synergy, no star aura, not merge material) — the claim premium (`getExpeditionGold`: piece's base passive weight × duration × tier mul, computed at claim time like `sellValue`) is priced against that opportunity cost, so it's a hold-vs-deploy decision, not a free multiplier. Variants multiply the 💎 reward (`expeditionVariantMul`: golden ×2 / star ×3 / dark ×4, stacking). `endsAt` is a `Date.now()` timestamp → progresses offline (the deliberate valve around the 4h/50% offline cap). Grand-tier grow (+1 Lv) routes through `noteLevelReached` — the non-merge sibling of tryMerge's record block (jump-safe: even-💎, milestones, codex, transcend announce). Claim requires an empty grid slot (grid-full tension applies to returns). **Prestige wipes an active expedition** (storage parity — no smuggling pieces/rewards across 윤회; the prestige modal warns). UI: send buttons in the info modal (`showShurikenInfo`), status chip above the grid (`#expedition-chip`, repaint gated by per-second signature). Stats: `expeditions`, `expeditionsClaimed`.

**Trial Tower (시련의 탑)**: a prestige-tier ladder of ONE-SHOT handicap runs (`TOWER_FLOORS`, 6 floors; unlock `prestigeCount >= TOWER_UNLOCK_PRESTIGE` = 2). Player arms the next floor in the prestige panel (`towerArmed`, persistent until consumed); `doPrestige` consumes the arm and starts the new run with that floor's constraint active (`towerActive`). **Tower entry disables 계승 (inheritance) for that run** (`enteringTower` is computed BEFORE the inheritance block in `doPrestige`) — inherited high pieces would insta-clear any floor with one merge, bypassing every constraint (audit-confirmed exploit). The '⚡ 모두' merge-all button is banned on the auto-ban floor (it drives the same `autoMergeStep` engine), and the '표창 강화' shop item calls `checkTrialProgress`/`checkTowerProgress` after bumping `runBestLevel` (any future `runBestLevel`-raising path must do the same or clears are silently missed). Reaching `runBestLevel >= goalLv` clears the floor (`checkTowerProgress`, ≥-comparison so jump merges are safe) → one-time 💎+悟 reward, `towerFloor` recorded (permanent). Constraints use ONLY existing hooks — `getTowerSpawnMul` (spawn interval), `getTowerGoldMul` (gold breakdown factor), `isTowerAutoBanned` (auto-merge gate + auto-ritual + button toast), `isTowerRitualBanned` (doRitualMerge guard + ritual-button lock), `isTowerSpawnLv1` (`getSpawnStartLevel`/`getNextSpawnLevel`, ignores post-prestige boost) — **never grid size** (CLAUDE.md taboo). Prestige during an active floor = fail (no reward); abandon button in the prestige panel. Complements Strategy Mode: strategy = permanent trade-off setting, tower = voluntary one-shot handicap ladder; they stack. Rewards are one-shot → no farming inflation. **Deep floors (무한 심층, floors 7+)**: after the 6 base floors, `getDeepFloorDef(n)` procedurally synthesizes floors — a **pure function of the floor number** (no persisted fields → migration-safe, deterministic, testable). 5 patterns (`TOWER_DEEP_PATTERNS`: 심연/나락/무저/공허/적멸) rotate while intensity ramps (spawnMul 1.5+0.1k capped 2.5; goldMul 0.4−0.02k floored 0.25) and goalLv rises +2/floor → a natural asymptote (endless honor ladder, never force-clearable). `getTowerFloorDef` bridges table→synthesis; rewards stay one-shot but scale with depth (gem 80+15k, 悟 10+2k). `validateAndRepairState` clamps `towerFloor` to `TOWER_MAX_FLOOR` (999), NOT to `TOWER_FLOORS.length` — a base-length clamp would destroy deep progress on load. Ban toasts/titles use the active floor's `name` (not hardcoded '수공의 층'/'침묵의 층') since deep floors carry the same bans. Deep defs are **memoized** (`_deepFloorCache` — active floors are read on per-frame paths); callers must treat defs as immutable (audit-verified contract). Audit-accepted economy note: buying 표창 강화 to top off a deep goal can be gem-net-positive in a bounded window (k≲15 at endgame levels), but each floor still costs a full no-inheritance constrained prestige run reaching near-goal naturally — a finite one-shot time↔gem tradeoff, not a farmable loop; do not "fix" without re-running that analysis. Progress check sites mirror trial: tryMerge, doRitualMerge, and `noteLevelReached` (expedition grow). Stats: `towerClears`; state: `towerFloor`/`towerActive`/`towerArmed` (all validated in `validateAndRepairState` — a corrupt `towerActive` would apply phantom constraints forever).

**Cell Engraving (성소 각인)**: permanent player-chosen special cells bought with 悟 (`ENGRAVE_RUNES`: 💰 wealth ×1.5 passive weight / ⚒ forge ×1.35 merge+ritual gold on the completion cell / 🍀 fortune +4%p lucky chance, destination-keyed; unlock `prestigeCount >= ENGRAVE_UNLOCK_PRESTIGE` = 1). The chosen counterpart to random blessed cells, and the first open-ended 悟 sink competing with the finite skill tree (~382悟 total) — deep-tower 悟 income needed one. `state.engravings = { idx: runeId }`, max `ENGRAVE_MAX` (3), cost ladder `ENGRAVE_COSTS` 15/30/50 by current count, rune swap `ENGRAVE_SWAP_COST` (8), removal free but NO refund (moving a slot costs full slot price — deliberate placement commitment). Survives prestige (permanent purchase, like skills; `maxShuriken` also persists so indices never go stale). Effects are cell-conditional, not flat multipliers — the decision is routing merges onto engraved cells. Wiring: `engraveWealthMul` inside `pieceGoldWeight` (single fn → HUD/offline/share auto-consistent), `engraveForgeMul` on BOTH `tryMerge` (toIdx) and `doRitualMerge` (result cell) — **ritual-parity invariant applies**; `engraveFortuneBonus` is tryMerge-only AND hand-merge-only (`tryMerge(from, to, isAuto)` — auto-merge/merge-all pass `isAuto=true`, gating the fortune rune; documented parity exception: 2-piece-merge mechanic, same class as combo/lucky procs). Audit design note: auto-merge deterministically targets the LOWEST index of a level and ritual results land on the group's lowest index, so low-index engraved cells systematically capture forge gold from idle play — accepted for forge (its copy has no manual restriction and auto merges are low-level/low-gold), which is why fortune (copy says 손 합성) is explicitly gated. `engraveMode` transient UI mode is mutually exclusive with sellMode/infoMode (all three tap-intercepting modes clear each other + selectedIdx) and is reset on prestige along with the picker modal. UI: `engraveMode` transient toggle (button in the 悟 panel header) → tap a cell → rune picker modal (`#engrave-modal`); engraved cells show a corner rune mark even when empty. Validation drops bad idx/rune and clamps count. Stats: `engravesUsed`.

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

**Ambience (정취, Q-Leap 129)**: a state-reactive generative music layer — the Q-Leap "new sensory dimension" axis. Pure presentation: no effects, no rewards, no economy coupling. Graph: detuned triangle pad pair → lowpass → `_musicGain` (0.6) → `_audioGain` (master 0.12 — mute is shared) + a minor-pentatonic pluck scheduler. `getAmbienceParams()` is the PURE mapping (tested): root pitch = 110Hz × 2^(min(24, ⌊bestLevel/5⌋)/12) (a semitone per 5 levels, capped +2 octaves), combo/frenzy densify plucks (speed ×0.8/×0.6/×0.35), frenzy opens the filter (900→1400Hz), frenzy/goldRush add brightness + perfect-5th harmony. Starts lazily inside `getAudio()`'s creation block (first user gesture — autoplay-safe); `updateAmbience()` glides pad/filter on the 1s render throttle. Toggle `#music-btn` (footer) ↔ `state.musicEnabled` (default ON incl. old saves via `s.musicEnabled !== false`; explicit OFF persists). Audio nodes are runtime-only (`_music`/`_musicGain`) — never persisted; all node code is try/catch-wrapped and stub-safe for the test harness. Two audit-mandated guards (v3.75.1): the pluck scheduler SKIPS while `_audio.state === 'suspended'` (a pre-gesture context freezes `currentTime` at 0, so queued plucks would all fire at once on the first resume — an audible burst), and a `visibilitychange` handler stops/restarts ambience so a backgrounded tab doesn't drone at stale pitch (rAF pause freezes `updateAmbience`).

**Curation (T1b/T4, v3.74 — user-approved one-way removals)**: 버닝(burning), 시간 가속(timeBoost), 표창 분할(split), 황금 코팅(coatGolden) were REMOVED to cut cognitive load. Burning's unique identity — jump probability ×2 — was absorbed into 폭주 (frenzy; `frenzyJumpMul` in tryMerge), so frenzy now reads: spawn ×2 · gold +20% · jump ×2 · golden ×1.5. The state fields (`burningTimer`/`timeBoostTimer`) and stats (`burnsUsed`/`splitsUsed`/`coatingsUsed`) remain in defaultState/old saves as harmless legacy (save-compat rule) — load() zeroes the timers; nothing reads them. Their achievements (a_burn/a_split/a_coat_1) were deleted. Do not resurrect these systems; if a gem sink is needed, design a new decision instead.
