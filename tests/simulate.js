'use strict';
// 페이싱 시뮬레이터 — 헤드리스로 게임을 자동 플레이해 진행 곡선을 측정한다.
// Run: npm run simulate [hours]
// 두 플레이 프로파일(active: 2초마다 개입 / casual: 15초마다)로 각 3회 돌려
// 마일스톤 도달 시간의 중앙값을 표로 출력 — 페이싱 절벽을 데이터로 드러내는 도구.
// 게임 코드는 손대지 않는다 (harness의 vm 로드 재사용, 구매는 UI 핸들러 로직 복제).
const { loadGame } = require('./harness');

const MILESTONES = [3, 5, 8, 10, 12, 15, 20, 25, 30, 35, 40, 50, 60];
const HOURS = Math.min(24, parseFloat(process.argv[2]) || 8);

function fmtT(sec) {
  if (sec == null) return '   —   ';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2)}h${String(m).padStart(2, '0')}m`;
}

// 감사 133.2: 결(Q-Leap 133)은 '흡수 상태'다 — 합성으로 생기지도 사라지지도 않고 목적지 선택만으로
// 전파되므로, 손으로 방향을 조종하면 보드를 단일 결로 수렴시켜 순 합성률을 크게 끌어올릴 수 있다.
// 기본(blind) 프로파일은 findNextAutoMergePair가 고른 짝을 그대로 넘겨 이 축을 전혀 측정하지 못했다.
// 아래 정책은 그 상한을 재는 전용 프로파일이다 — blind 기준선(승인된 PACING 기준)은 손대지 않는다.
const GOLD_GRAIN = 'cheon'; // 天 = 합성 골드 채널
function findGrainSteeredPair(F, S) {
  const grid = S().grid;
  const byLevel = new Map();
  for (let i = 0; i < grid.length; i++) {
    const c = grid[i];
    if (!c || c.locked) continue;
    if (!byLevel.has(c.level)) byLevel.set(c.level, []);
    byLevel.get(c.level).push(i);
  }
  const levels = [...byLevel.keys()].filter(lv => byLevel.get(lv).length >= 2).sort((a, b) => a - b);
  if (!levels.length) return null;
  for (const lv of levels) {
    const idxs = byLevel.get(lv);
    // 1순위: 天끼리 (순 합성 + 골드 채널)
    const gold = idxs.filter(i => grid[i].grain === GOLD_GRAIN);
    if (gold.length >= 2) return [gold[1], gold[0]];
    // 2순위: 세탁 — 天이 아닌 조각을 天 목적지로 흘려 결을 天으로 바꾼다 (혼합 = 세금 0)
    if (gold.length === 1) {
      const other = idxs.find(i => i !== gold[0]);
      if (other !== undefined) return [other, gold[0]];
    }
  }
  // 天이 없는 층만 남았으면 그냥 최저 층을 합쳐 회전이 天을 다시 주입하길 기다린다
  const idxs = byLevel.get(levels[0]);
  return [idxs[1], idxs[0]];
}

function runSim(mergeEvery, policy) {
  const AFK = policy === 'afk'; // 감사 C7: 무인 방치 — 손 개입 0, 자동화만
  const G = loadGame();
  const F = G.fns, C = G.consts;
  G.setState(G.defaultState());
  if (policy === 'afk') {
    // 감사 C7의 시나리오는 '포화 상태 그리드를 방치'다 — 빈 세이브에서 시작하면 8시간에 합성 29회뿐이라
    // 콤보 성장 자체가 측정되지 않는다. 중반 플레이어가 자동화를 켜고 자리를 뜬 상태를 만든다.
    const st = G.getState();
    st.autoMergeUnlocked = true; st.autoMerge = true; st.autoRitualEnabled = true;
    st.bestLevel = 20; st.runBestLevel = 20; st.prestigeCount = 3;
    Object.assign(st.upgrades, { maxShuriken: 12, spawnRate: 14, spawnBatch: 2, goldMul: 12, spawnLevel: 5, firerate: 10, baseDmg: 10, luckChance: 6 });
    st.grid = new Array(F.getGridSize()).fill(null);
    for (let i = 0; i < st.grid.length; i++) st.grid[i] = { id: 9000 + i, level: 6 + (i % 3), fireTimer: 0, grain: ['cheon','ji','in'][i % 3] };
  }
  const S = () => G.getState();
  const reached = {};
  let prestiges = 0;
  let handMerges = 0, pureMerges = 0;
  let peakCombo = 0, mergeGold = 0, prevGold = 0, comboBreaks = 0;
  const dt = 0.5;
  const end = HOURS * 3600;
  let t = 0, sinceAct = 0;

  const buyUpgrades = () => {
    // 싼 것부터 그리디 구매 (UI 핸들러 로직 복제)
    for (let guard = 0; guard < 50; guard++) {
      let best = null, bestCost = Infinity;
      for (const u of C.UPGRADES) {
        if (F.isUpgradeMaxed(u.id)) continue;
        const cost = F.getUpgradeCost(u);
        if (cost <= S().gold && cost < bestCost) { best = u; bestCost = cost; }
      }
      if (!best) break;
      S().gold -= bestCost;
      S().upgrades[best.id]++;
      if (best.id === 'maxShuriken') S().grid.push(null);
    }
  };
  const buySkills = () => {
    for (const sk of C.SKILLS) {
      const lv = (S().skills && S().skills[sk.id]) || 0;
      if (lv >= sk.maxLv) continue;
      const cost = sk.cost(lv);
      if ((S().enlightenment || 0) >= cost) { S().enlightenment -= cost; S().skills[sk.id] = lv + 1; }
    }
  };

  while (t < end) {
    F.update(dt);
    t += dt; sinceAct += dt;
    if (AFK) {
      // 방치 관측: 콤보 정점과 합성 골드 비중만 기록한다 (개입 없음)
      const cc = S().comboCount || 0;
      if (cc > peakCombo) peakCombo = cc;
      if (cc === 0 && peakCombo > 0) comboBreaks++;
      const g = S().gold;
      if (g > prevGold) mergeGold += 0; // 골드 증가분은 패시브와 섞여 분리 불가 — 아래 stats로 대체
      prevGold = g;
      const b = S().bestLevel;
      for (const m of MILESTONES) if (!reached[m] && b >= m) reached[m] = t;
      if (reached[60]) break;
      continue;
    }
    if (sinceAct >= mergeEvery) {
      sinceAct = 0;
      for (let i = 0; i < 6; i++) { // 개입 버스트: 손 합성 최대 6회
        const p = policy === 'grain' ? findGrainSteeredPair(F, S) : F.findNextAutoMergePair();
        if (!p) break;
        const a = S().grid[p[0]], b = S().grid[p[1]];
        if (a && b && a.level === b.level) {
          handMerges++;
          if (F.grainPureId([a, b], false)) pureMerges++;
        }
        F.tryMerge(p[0], p[1], false);
      }
      // Q-Leap 134: 'aim' 프로파일은 진안으로 무리와 결과 칸을 고른다 — 純 무리 우선,
      // 없으면 각인 칸이 포함된 무리의 그 칸, 그 외에는 기존 자동 선택과 같다.
      // blind/grain 기준선은 인자 없는 호출 그대로라 수학적으로 불변이다.
      if (policy === 'aim') {
        try {
          const groups = F.findRitualGroups();
          let target = -1;
          for (const g of groups) {
            if (F.grainPureId(g.indices.map(i => S().grid[i]), false)) { target = g.indices[0]; break; }
          }
          if (target < 0) {
            for (const g of groups) {
              const eng = g.indices.find(i => F.getEngraving(i));
              if (eng !== undefined) { target = eng; break; }
            }
          }
          if (groups.length) F.doRitualMerge(false, target);
        } catch (e) {}
      } else {
        try { F.doRitualMerge(); } catch (e) {}
      }
      if ((S().frenzyCharge || 0) >= 100) try { F.activateFrenzy(true); } catch (e) {}
      buyUpgrades();
      buySkills();
      if (S().bestLevel >= 8 && F.getPrestigeAdvice().recommend) {
        try { F.doPrestige(); prestiges++; } catch (e) {}
      }
    }
    const b = S().bestLevel;
    for (const m of MILESTONES) if (!reached[m] && b >= m) reached[m] = t;
    if (reached[60]) break;
  }
  return { reached, prestiges, finalLv: S().bestLevel, pureRate: handMerges ? pureMerges / handMerges : 0,
           peakCombo, comboBreaks, totalMerges: (S().stats || {}).totalMerges || 0,
           mergeGoldStat: (S().stats || {}).totalGoldEarned || 0, gold: S().gold };
}

function median3(mergeEvery, policy) {
  const runs = [runSim(mergeEvery, policy), runSim(mergeEvery, policy), runSim(mergeEvery, policy)];
  const med = {};
  for (const m of MILESTONES) {
    const vals = runs.map(r => r.reached[m]).filter(v => v != null).sort((a, b) => a - b);
    med[m] = vals.length === 3 ? vals[1] : (vals.length ? vals[vals.length - 1] : null);
  }
  return {
    med, prestiges: runs.map(r => r.prestiges), finalLv: runs.map(r => r.finalLv),
    pureRate: runs.reduce((a, r) => a + r.pureRate, 0) / runs.length,
    peakCombo: runs.map(r => r.peakCombo || 0), comboBreaks: runs.map(r => r.comboBreaks || 0),
    totalMerges: runs.map(r => r.totalMerges || 0),
  };
}

console.log(`페이싱 시뮬레이션 — 프로파일당 3회, 최대 ${HOURS}h (sim), dt 0.5s`);
const active = median3(2);
const casual = median3(15);
// 감사 133.2: 결-인지(목적지 스티어링) 프로파일 — Q-Leap 133의 수동 최적화 상한을 재는 축.
// blind 프로파일과 나란히 두어 계수 조정 시 상한이 어디로 움직이는지 보이게 한다.
const grain = median3(2, 'grain');
// Q-Leap 134: 진안 프로파일 — 의식의 무리·결과 칸을 손으로 고르는 상한 (PACING 규칙 전후 비교용)
const aim = median3(2, 'aim');
// 감사 C7: 무인 방치 프로파일 — 콤보가 끊기지 않는 구간을 측정한다 (승인 대기 중인 상한 판단 근거)
const afk = median3(0, 'afk');
console.log('\n  Lv    active(2s개입)  casual(15s개입)   구간 배율(active)');
let prev = null;
for (const m of MILESTONES) {
  const a = active.med[m], c = casual.med[m];
  const stepMul = (prev != null && a != null && prev.a != null && prev.a > 0)
    ? ` ×${((a - prev.a) / Math.max(1, prev.step || (a - prev.a))).toFixed(1)}` : '';
  const step = prev && a != null && prev.a != null ? a - prev.a : null;
  console.log(`  ${String(m).padStart(2)}    ${fmtT(a)}          ${fmtT(c)}        ${step != null ? '+' + fmtT(step).trim() : ''}`);
  prev = { a, step };
}
console.log(`\n  윤회 횟수 (3회 런): active ${active.prestiges.join('/')} · casual ${casual.prestiges.join('/')}`);
console.log(`  종료 시 Lv: active ${active.finalLv.join('/')} · casual ${casual.finalLv.join('/')}`);
console.log('\n  결(三才)·진안 프로파일 — 손 플레이 최적화 상한 (감사 133.2 / Q-Leap 134)');
console.log('   Lv    blind(active)   결-인지(active)   진안(active)');
for (const m of MILESTONES) {
  console.log(`  ${String(m).padStart(2)}    ${fmtT(active.med[m])}        ${fmtT(grain.med[m])}        ${fmtT(aim.med[m])}`);
}
console.log(`  진안 종료 Lv: ${aim.finalLv.join('/')} · 윤회 ${aim.prestiges.join('/')}`);
console.log('');
console.log('  방치(AFK) 프로파일 — 손 개입 0 · 자동합치기+자동 의식만 (감사 C7 커버리지)');
console.log(`   콤보 정점: ${afk.peakCombo.join(' / ')}  ·  콤보 끊김 횟수: ${afk.comboBreaks.join(' / ')}`);
console.log(`   총 합성: ${afk.totalMerges.join(' / ')}  ·  종료 Lv: ${afk.finalLv.join('/')}`);
console.log(`  순 합성률: blind ${(active.pureRate * 100).toFixed(1)}% → 결-인지 ${(grain.pureRate * 100).toFixed(1)}%`);
console.log(`  종료 시 Lv: 결-인지 ${grain.finalLv.join('/')} · 윤회 ${grain.prestiges.join('/')}`);
