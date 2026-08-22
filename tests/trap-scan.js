'use strict';
// 함정 탐지기 (trap scan) — "플레이어에게 제시되지만 실제로는 0을 주는 선택지"를 잡는다.
//
// 이 프로젝트에서 같은 계열의 결함이 네 번 났다:
//   · 성좌 신속(haste)이 0.6s 스폰 하한에서 기여 정확히 0 (v3.81.0 감사)
//   · 제련 속성(swift)이 같은 하한에서 무효 → 🚫 게이트로 방어 (Q-Leap 128)
//   · 부적 '최전선' 1차 정의가 발동 0회·소멸 10.7개 (v3.85.1 자체 실측)
//   · 부적 '순' 정책이 결 미해금 시 영원히 안 터짐 → 폴백으로 방어 (v3.85.0)
// 공통점: 단위 테스트는 전부 통과했다. 형태만 봤지 '전달된 값'을 안 쟀기 때문이다.
//
// 이 스캐너는 선택지마다 (옵션 ON) vs (기준선) 을 같은 난수로 굴려 실제 산출을 비교한다.
// 모든 상태에서 0.00배면 함정으로 보고 실패한다 — 단, 코드가 그 상태를 inert로 표시해
// 플레이어에게 알리고 있으면 (예: 🚫 배지, 폴백) 통과시킨다.
const { loadGame } = require('./harness');
const fs = require('fs');
const path = require('path');
const RAW = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const SIM_SEC = 900; // 상태당 15분 (sim)

// 정본 상태 3종 — 초반 / 중반 / 엔드게임(스폰 하한 도달)
const STATES = {
  초반:  { best: 8,  lv: 3,  up: { maxShuriken: 4,  spawnRate: 3,  spawnBatch: 0, spawnLevel: 1, goldMul: 2 } },
  중반:  { best: 22, lv: 6,  up: { maxShuriken: 12, spawnRate: 14, spawnBatch: 2, spawnLevel: 5, goldMul: 12 } },
  엔드:  { best: 45, lv: 10, up: { maxShuriken: 24, spawnRate: 70, spawnBatch: 6, spawnLevel: 9, goldMul: 30 } },
};

function fresh(stateKey, apply) {
  const G = loadGame();
  const F = G.fns, C = G.consts;
  const cfg = STATES[stateKey];
  const s = G.defaultState();
  s.bestLevel = cfg.best; s.runBestLevel = cfg.best; s.prestigeCount = 5;
  Object.assign(s.upgrades, cfg.up);
  s.skills = Object.assign({}, s.skills, { swiftHands: 4 });
  s.stats = {}; s.gold = 0;
  G.setState(s);
  const st = G.getState();
  st.grid = new Array(F.getGridSize()).fill(null);
  for (let i = 0; i < st.grid.length; i++) {
    st.grid[i] = { id: 100 + i, level: cfg.lv + (i % 2), fireTimer: 0, grain: ['cheon', 'ji', 'in'][i % 3] };
  }
  if (apply) apply(G, F, C);
  return { G, F, C };
}

function play({ G, F }, seed) {
  const S = () => G.getState();
  const real = Math.random;
  let x = seed;
  Math.random = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  let t = 0, since = 0, jumps = 0, charmFires = 0, charmValue = 0;
  try {
    while (t < SIM_SEC) {
      F.update(0.5); t += 0.5; since += 0.5;
      if (since >= 2) {
        since = 0;
        for (let i = 0; i < 6; i++) {
          const p = F.findNextAutoMergePair(); if (!p) break;
          const a = S().grid[p[0]]; const lv = a ? a.level : 0;
          const heldCharms = S().luckyCharms || 0;
          F.tryMerge(p[0], p[1], false);
          const res = S().grid[p[1]];
          if (res && res.level > lv + 1) jumps++;
          // 부적이 '어느 레벨에서' 터졌는지 — 적게 터져도 크게 터지면 함정이 아니다
          if ((S().luckyCharms || 0) < heldCharms) { charmFires++; charmValue += Math.pow(2, lv); }
        }
        try { F.doRitualMerge(); } catch (e) {}
      }
    }
  } finally { Math.random = real; }
  const st = S();
  let variants = 0;
  for (const c of st.grid) if (c && (c.golden || c.star || c.dark)) variants++;
  return {
    gold: st.gold,
    spawned: st.stats.totalSpawned || 0,
    merges: st.stats.totalMerges || 0,
    variants,
    charms: charmFires,
    charmValue, // 발동 레벨 가중 — '적게 터지지만 크게'를 구분한다
    jumps,
    interval: F.getSpawnInterval(),
  };
}

// 선택지 정의: 무엇을 켜고, 어떤 채널을 재는가
const OPTIONS = [];
{
  const probe = loadGame();
  const C = probe.consts;
  for (const m of C.FORGE_MODES) {
    if (m.id === 'standard') continue;
    OPTIONS.push({ family: '제련', id: m.id, label: `${m.icon} ${m.name}`,
      apply: (G) => { G.getState().forgeMode = m.id; },
      channel: (r) => r.spawned, inertMark: /forgeEffective/ });
  }
  for (const st of C.CONSTELLATION_STARS) {
    if (st.id === 'wealth') continue;
    OPTIONS.push({ family: '성좌', id: st.id, label: `${st.icon} ${st.name}`,
      apply: (G) => { const s = G.getState(); s.bestLevel = Math.max(s.bestLevel, 80); s.constellation = { [st.id]: 20 }; },
      // 연(緣)은 점프 행운이므로 점프 수로 재야 한다 — 합성 수로 재면 영원히 1.000이 나온다
      channel: (r) => st.id === 'haste' ? r.spawned : st.id === 'mutation' ? r.variants : r.jumps,
      inertMark: /isConstellationHasteInert/ });
  }
  for (const p of C.CHARM_POLICIES) {
    if (p.id === 'now') continue;
    OPTIONS.push({ family: '부적', id: p.id, label: `${p.icon} ${p.name}`,
      apply: (G) => { G.getState().charmPolicy = p.id; },
      channel: (r) => r.charms, valueChannel: (r) => r.charmValue, inertMark: /getCharmPolicyId/ });
  }
  for (const sm of (C.STRATEGY_MODES || [])) {
    if (sm.id === 'none') continue;
    OPTIONS.push({ family: '전략', id: sm.id, label: sm.label || sm.id,
      apply: (G) => { G.getState().strategyMode = sm.id; },
      channel: (r) => sm.id === 'fast' ? r.spawned : sm.id === 'variant' ? r.variants : r.gold,
      inertMark: null });
  }
}

const SEEDS = [11, 29];
let fail = 0;
const rows = [];
console.log(`\n함정 스캔 — 선택지별 실제 산출 (상태당 ${SIM_SEC / 60}분 sim × ${SEEDS.length}시드)\n`);
console.log('  계열   선택지                    ' + Object.keys(STATES).map(k => k.padEnd(9)).join('') + ' 판정');
for (const opt of OPTIONS) {
  const ratios = {};
  let valueNote = '';
  for (const key of Object.keys(STATES)) {
    let base = 0, withOpt = 0;
    for (const seed of SEEDS) {
      base += opt.channel(play(fresh(key, null), seed));
      withOpt += opt.channel(play(fresh(key, opt.apply), seed));
    }
    ratios[key] = base > 0 ? withOpt / base : (withOpt > 0 ? Infinity : 1);
  }
  const allFlat = Object.values(ratios).every(r => Math.abs(r - 1) < 0.01);
  // '모든 상태에서 발동 0' 은 가치 채널이 있어도 함정이다 (부적 1차 최전선이 정확히 이 모양이었다)
  // 세 상태 '전부' 죽어야 함정으로 보면, 중·엔드에서만 죽는 함정(부적 1차 최전선이 정확히
  // 그 모양이었다 — 초반 1.000 / 중반 0.000 / 엔드 0.000)이 통과한다. 도달 가능한 상태
  // 하나에서라도 산출이 0이면 그 상태의 플레이어에게는 완전한 함정이므로 잡는다.
  const deadEverywhere = Object.values(ratios).every(r => r === 0);
  const deadSomewhere = Object.values(ratios).some(r => r === 0);
  const guarded = opt.inertMark ? opt.inertMark.test(RAW) : false;
  let verdict = !allFlat ? 'ok' : (guarded ? 'inert 표시 있음' : '함정');
  if (deadEverywhere) verdict = '함정(전 구간 0)';
  else if (deadSomewhere) verdict = '함정(일부 구간 0)';
  // 가치 채널이 있으면 '적게 터지지만 크게'인지 함께 본다
  if (opt.valueChannel) { // 판정과 무관하게 항상 잰다 — '적게 터지지만 크게'는 발동 수만 보면 안 보인다
    const vr = {};
    for (const key of Object.keys(STATES)) {
      let bv = 0, ov = 0;
      for (const seed of SEEDS) {
        bv += opt.valueChannel(play(fresh(key, null), seed));
        ov += opt.valueChannel(play(fresh(key, opt.apply), seed));
      }
      vr[key] = bv > 0 ? ov / bv : (ov > 0 ? Infinity : 1);
    }
    valueNote = ' · 가치 ' + Object.keys(STATES).map(k => (vr[k] === Infinity ? '∞' : vr[k].toFixed(1)) + 'x').join('/');
    if (Object.values(vr).every(r => r < 0.5)) verdict = '경고(가치 감소)';
    else if (verdict.indexOf('inert') === 0 && Object.values(vr).some(r => r > 1.05)) verdict = 'ok(가치 전달)';
  }
  if (verdict.indexOf('함정') === 0) fail++;
  rows.push([opt.family, opt.label, ratios, verdict]);
  console.log(`  ${opt.family.padEnd(6)} ${opt.label.padEnd(24)} ` +
    Object.keys(STATES).map(k => (ratios[k] === Infinity ? '  ∞  ' : ratios[k].toFixed(3)).padEnd(9)).join('') + ' ' + verdict + valueNote);
}
console.log('\n  판정 규칙: 세 상태 모두에서 기준선 대비 1.000배(변화 없음)면 함정.');
console.log('  단, 코드에 inert 표시(🚫 게이트·폴백)가 있으면 플레이어가 알 수 있으므로 통과.');
if (fail) {
  console.log(`\n  ✗ 함정 ${fail}건 — 도달 가능한 상태에서 산출이 0인 선택지가 있다`);
  process.exit(1);
}
console.log('\n  clean ✓');
