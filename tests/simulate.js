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

function runSim(mergeEvery) {
  const G = loadGame();
  const F = G.fns, C = G.consts;
  G.setState(G.defaultState());
  const S = () => G.getState();
  const reached = {};
  let prestiges = 0;
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
    if (sinceAct >= mergeEvery) {
      sinceAct = 0;
      for (let i = 0; i < 6; i++) { // 개입 버스트: 손 합성 최대 6회
        const p = F.findNextAutoMergePair();
        if (!p) break;
        F.tryMerge(p[0], p[1], false);
      }
      try { F.doRitualMerge(); } catch (e) {}
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
  return { reached, prestiges, finalLv: S().bestLevel };
}

function median3(mergeEvery) {
  const runs = [runSim(mergeEvery), runSim(mergeEvery), runSim(mergeEvery)];
  const med = {};
  for (const m of MILESTONES) {
    const vals = runs.map(r => r.reached[m]).filter(v => v != null).sort((a, b) => a - b);
    med[m] = vals.length === 3 ? vals[1] : (vals.length ? vals[vals.length - 1] : null);
  }
  return { med, prestiges: runs.map(r => r.prestiges), finalLv: runs.map(r => r.finalLv) };
}

console.log(`페이싱 시뮬레이션 — 프로파일당 3회, 최대 ${HOURS}h (sim), dt 0.5s`);
const active = median3(2);
const casual = median3(15);
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
