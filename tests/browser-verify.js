'use strict';
// Browser verification gate for TODOS curation tracks T2/T3/T1a (+ v3.72 engraving UI).
// OPTIONAL TOOL — needs system Chrome + playwright-core (NOT a repo dependency; the repo stays zero-install):
//   npm i --no-save playwright-core && npm run verify:browser
// Drives a real headless Chrome against index.html: clicks toggles, opens modals, reads state,
// takes screenshots into tests/browser-shots/ (gitignored-worthy evidence, overwritten each run).
// Serves the repo's index.html over localhost, drives headless system Chrome via
// playwright-core, asserts behavior, and drops screenshots into ./shots.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const REPO = require('path').join(__dirname, '..');
const SHOTS = path.join(__dirname, 'browser-shots');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ok ' + msg); }
  else { fail++; failures.push(msg); console.log('  ✗ FAIL ' + msg); }
}

(async () => {
  // -- tiny static server --
  const server = http.createServer((req, res) => {
    const file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const p = path.join(REPO, file);
    fs.readFile(p, (err, data) => {
      if (err) { console.log('  [404] ' + file); res.writeHead(404); res.end('nope'); return; }
      const ct = file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(data);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width: 480, height: 960 } });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  // tutorial can (re)appear after the attendance modal on a fresh save — clear overlays before screenshots
  const clearOverlays = () => page.evaluate(() => {
    const skip = document.getElementById('tut-skip');
    const ov = document.getElementById('tutorial-overlay');
    if (ov && getComputedStyle(ov).display !== 'none') skip && skip.click();
    const att = document.getElementById('attend-claim') || document.querySelector('#attendance-modal .codex-close');
    if (att) att.click();
  });

  // -- boot --
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#grid .cell', { timeout: 15000 });
  // dismiss tutorial overlay if it blocks (retry — it may mount after first paint)
  for (let i = 0; i < 5; i++) {
    const dismissed = await page.evaluate(() => {
      const ov = document.getElementById('tutorial-overlay');
      const visible = ov && getComputedStyle(ov).display !== 'none' && ov.offsetParent !== null;
      if (visible) { const skip = document.getElementById('tut-skip'); if (skip) skip.click(); return true; }
      return false;
    });
    await page.waitForTimeout(350);
    if (dismissed) break;
  }
  const cellCount = await page.evaluate(() => document.querySelectorAll('#grid .cell').length);
  ok(cellCount >= 6, `boot: grid rendered (${cellCount} cells)`);
  await clearOverlays(); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, '01-boot.png') });

  const $id = (id) => page.evaluate((i) => { const el = document.getElementById(i); if (el) el.click(); return !!el; }, id);
  const shown = (id) => page.evaluate((i) => document.getElementById(i).classList.contains('show'), id);

  // ================= ☰ menu opens with a TRUSTED click =================
  // (JS el.click() fires handlers even on display:none — the v3.09~3.76 menu bug hid here.
  //  page.click() goes through hit-testing, so a dead button fails loudly.)
  console.log('☰ 메뉴 (신뢰 클릭)');
  const prevReveal = await page.evaluate(() => {
    const prev = { b: state.bestLevel, p: state.prestigeCount };
    state.bestLevel = 12; state.prestigeCount = 1; refreshUI();
    return prev;
  });
  await clearOverlays(); await page.waitForTimeout(150);
  await page.click('#menu-btn');
  await page.waitForTimeout(150);
  const menuOpen = await page.evaluate(() => {
    const m = document.getElementById('grid-menu');
    return { display: getComputedStyle(m).display, items: [...m.querySelectorAll('button')].filter(el => el.offsetParent !== null).length };
  });
  ok(menuOpen.display !== 'none' && menuOpen.items >= 8, `menu opens via real click (${menuOpen.display}, ${menuOpen.items} items)`);
  await page.click('#menu-btn');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('grid-menu')).display === 'none'), 'menu closes again');
  await page.evaluate((prev) => { state.bestLevel = prev.b; state.prestigeCount = prev.p; refreshUI(); }, prevReveal); // 하류 섹션 상태 복원

  // ================= T2: automation panel =================
  console.log('T2 자동화 패널');
  ok(await $id('automation-btn'), 'T2: ⚙ 자동화 버튼 존재+클릭');
  ok(await shown('automation-modal'), 'T2: 자동화 모달 오픈');
  await clearOverlays(); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, '02-automation.png') });

  await $id('auto-sell-toggle');
  ok(await page.evaluate(() => state.autoSellEnabled === true), 'T2: 자동 매도 토글 ON');
  const th0 = await page.evaluate(() => state.autoSellThreshold);
  await $id('auto-sell-up');
  ok(await page.evaluate((t) => state.autoSellThreshold === t + 1, th0), 'T2: 매도 임계값 + 동작');
  await page.evaluate(() => { document.querySelector('.prio-btn[data-prio="high"]').click(); });
  ok(await page.evaluate(() => state.autoMergePriority === 'high'), 'T2: 우선순위 → 높은 Lv');
  await $id('auto-lock-toggle');
  ok(await page.evaluate(() => state.autoLockEnabled === true), 'T2: 자동 잠금 토글 ON');
  await $id('auto-ritual-toggle');
  ok(await page.evaluate(() => state.autoRitualEnabled === true), 'T2: 자동 의식 토글 ON');
  ok(await page.evaluate(() => document.getElementById('prestige-speed-toggle').disabled === true),
    'T2: 윤회 가속은 윤회 5회 전 잠금');
  // 감사 C0/C1 회귀 가드: 부적 정책 버튼이 .prio-btn을 공유해 (1) 클릭이 자동 합치기 우선순위를
  // undefined로 파괴하고 (2) refreshAutoLockUI가 부적 버튼의 .active를 지웠다. 둘 다 DOM 배선
  // 결함이라 순수 로직 테스트로는 잡을 수 없다 — 브라우저 게이트가 유일한 집이다.

  await $id('automation-close');
  ok(!(await shown('automation-modal')), 'T2: 닫기 버튼 동작');
  // backdrop click closes
  await $id('automation-btn');
  await page.evaluate(() => {
    const m = document.getElementById('automation-modal');
    m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  ok(!(await shown('automation-modal')), 'T2: 바깥 클릭 닫기 동작');

  // ================= T3: today hub =================
  console.log('T3 오늘 허브');
  ok(await $id('quest-btn'), 'T3: 📅 오늘 버튼 존재+클릭');
  ok(await shown('today-modal'), 'T3: 오늘 허브 오픈');
  await clearOverlays(); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, '03-today.png') });

  const questCount = await page.evaluate(() => document.querySelectorAll('#quest-list .quest-item, #quest-list > *').length);
  ok(questCount >= 3, `T3: 일일 미션 렌더 (${questCount}개 항목)`);
  ok(await page.evaluate(() => document.getElementById('weekly-quest-box').innerHTML.length > 20), 'T3: 주간 미션 렌더');
  ok(await page.evaluate(() => document.getElementById('today-challenge').textContent.trim() !== '—'), 'T3: 도전 readout 채워짐');
  ok(await page.evaluate(() => document.getElementById('today-merge').textContent.trim() !== '—'), 'T3: 합성 readout 채워짐');
  ok(await page.evaluate(() => document.getElementById('today-attend').textContent.trim() !== '—'), 'T3: 출석 readout 채워짐');
  // spin (fresh save → 미수령)
  const spinBefore = await page.evaluate(() => ({ date: state.lastSpinDate, gem: state.gem, gold: state.gold }));
  await $id('spin-btn');
  await page.waitForTimeout(300);
  const spinAfter = await page.evaluate(() => ({ date: state.lastSpinDate, status: document.getElementById('spin-status').textContent }));
  ok(spinBefore.date === '' && spinAfter.date !== '', 'T3: 룰렛 1회 수령 (lastSpinDate 기록)');
  ok(spinAfter.status !== '미수령', `T3: 룰렛 상태 갱신 (${spinAfter.status.trim()})`);
  // exchange: give gold, convert
  await page.evaluate(() => { state.gold = 50000; refreshDailyActionsUI(); });
  const exBefore = await page.evaluate(() => ({ gem: state.gem, gold: state.gold }));
  await $id('exchange-btn');
  const exAfter = await page.evaluate(() => ({ gem: state.gem, gold: state.gold }));
  ok(exAfter.gem === exBefore.gem + 1 && exAfter.gold < exBefore.gold, `T3: 환산소 동작 (골드 ${exBefore.gold}→${exAfter.gold}, 💎+1)`);
  // spin/exchange must NOT be inside shop modal anymore
  ok(await page.evaluate(() => !document.querySelector('#shop-modal #spin-btn') && !document.querySelector('#shop-modal #exchange-btn')),
    'T3: 룰렛/환산소가 상점에서 제거됨 (허브로 이전)');
  await $id('today-close');
  ok(!(await shown('today-modal')), 'T3: 닫기 동작');

  // ================= T1a: buff strip =================
  console.log('T1a 활성 버프 표시줄');
  ok(await page.evaluate(() => document.getElementById('buff-strip').style.display === 'none'), 'T1a: 버프 없음 → 숨김');
  await page.evaluate(() => { state.frenzyTimer = 12; state.goldRushTimer = 5; updateHUD(); });
  const strip = await page.evaluate(() => {
    const el = document.getElementById('buff-strip');
    return { visible: el.style.display !== 'none', text: el.textContent, chips: el.querySelectorAll('.buff-chip').length };
  });
  ok(strip.visible && strip.chips === 2, `T1a: 버프 2개 → 칩 2개 표시 (${strip.chips})`);
  ok(/폭주/.test(strip.text) && /골드러시/.test(strip.text) && /\d+s/.test(strip.text), `T1a: 이름+남은 초 표기 (${strip.text.trim()})`);
  await clearOverlays(); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, '04-buffstrip.png') });
  // countdown ticks + disappears
  await page.waitForTimeout(1600);
  const strip2 = await page.evaluate(() => document.getElementById('buff-strip').textContent);
  ok(strip2 !== strip.text, 'T1a: 카운트다운 갱신 (초 감소)');
  await page.evaluate(() => { state.frenzyTimer = 0; state.goldRushTimer = 0; updateHUD(); });
  ok(await page.evaluate(() => document.getElementById('buff-strip').style.display === 'none'), 'T1a: 버프 종료 → 소멸');

  // ================= v3.72: engraving UI =================
  console.log('각인 UI (v3.72)');
  // locked before prestige
  await $id('engrave-btn');
  ok(await page.evaluate(() => typeof engraveMode !== 'undefined' && engraveMode === false), '각인: 해금 전 모드 진입 차단');
  // unlock + enter mode
  await page.evaluate(() => { state.prestigeCount = 1; state.enlightenment = 50; renderSkillTree(); });
  await $id('engrave-btn');
  ok(await page.evaluate(() => engraveMode === true), '각인: 모드 ON');
  // tap cell 0 → picker modal
  await page.evaluate(() => {
    const cell = document.querySelector('#grid .cell[data-idx="0"]');
    cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  ok(await shown('engrave-modal'), '각인: 칸 탭 → 룬 선택 모달');
  await clearOverlays(); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, '05-engrave-modal.png') });
  // pick first rune (wealth)
  await page.evaluate(() => { document.querySelector('#engrave-rune-list .engrave-rune-btn').click(); });
  const eng = await page.evaluate(() => ({ e: state.engravings[0], pts: state.enlightenment, open: document.getElementById('engrave-modal').classList.contains('show') }));
  ok(eng.e === 'wealth' && eng.pts === 35, `각인: 부 룬 적용 + 悟 15 차감 (잔여 ${eng.pts})`);
  ok(!eng.open, '각인: 적용 후 모달 닫힘');
  ok(await page.evaluate(() => !!document.querySelector('#grid .cell[data-idx="0"] .engrave-mark')), '각인: 칸에 룬 마크 표시');
  // mutual exclusion: sell mode exits engrave mode
  await $id('sell-btn');
  ok(await page.evaluate(() => engraveMode === false && sellMode === true), '각인: 판매 모드 진입 시 각인 모드 해제 (v3.72.2)');
  await $id('sell-btn'); // sell off again
  await clearOverlays(); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, '06-final.png') });

  // ================= Q-Leap 133: 칸 마크 충돌 가드 (감사 133.1) =================
  // 결 표식을 '겹치지 않는 자리'로 옮겼다는 주장은 두 번 틀렸다 (하단 중앙 → 미리보기와 충돌,
  // 상단 중앙 → Lv 라벨과 충돌해 'Lv12'가 'Lv天'으로 읽혔다). 존재 여부가 아니라 기하를 잰다.
  console.log('Q-Leap 133 결 표식 충돌');
  const markCollisions = await page.evaluate(() => {
    // 6열(최악) 그리드 + 세 자리 Lv + 모든 마크 종류를 한 칸에 몰아넣은 상태를 만든다.
    // 각인/시세 마크는 '우연히 남아 있길' 기대하면 안 된다 — 결정적으로 만들어 넣는다
    // (구 버전 fixture는 engravings를 세팅하지 않고 sellMode도 꺼둬서 .engrave-mark /
    //  .market-mark가 아예 렌더되지 않았고, 두 마크가 얽힌 충돌을 구조적으로 볼 수 없었다).
    state.bestLevel = 40; state.runBestLevel = 40;
    state.upgrades.maxShuriken = 24;
    state.grid = new Array(getGridSize()).fill(null);
    const marketLv = getMarketLevel();
    const grains = ['cheon', 'ji', 'in'];
    const runes = ['wealth', 'forge', 'fortune'];
    state.engravings = {};
    for (let i = 0; i < state.grid.length; i++) {
      state.grid[i] = {
        id: 5000 + i, level: (i % 4 === 0) ? marketLv : 12 + (i % 3) * 44, fireTimer: 0, grain: grains[i % 3],
        locked: i % 7 === 0, golden: i % 5 === 0, star: i % 6 === 0, dark: i % 8 === 0,
      };
      if (i % 3 === 0) state.engravings[i] = runes[(i / 3) % 3];      // 각인 마크가 실제로 그려지게
    }
    state.blessedIdx = 5;         // 🙏 의사요소 (🔒과 같은 자리 — 근사 박스로 커버)
    sellMode = true;              // .market-mark는 판매 모드에서만 렌더된다
    selectedIdx = 1;              // .mergeable 미리보기까지 렌더되게
    renderGrid();
    // 결 표식만이 아니라 칸에 얹히는 모든 마크를 서로 대조한다 (감사 133.1의 교훈 일반화:
    // 133 스윕에서 ★×각인 10.6px, Lv라벨×🌑 10.3px 같은 잠복 결함이 이 방식으로만 드러났다).
    // 합성 미리보기(.mergeable::after)는 z-index 4로 마크를 '의도적으로' 덮는 불투명 오버레이라 제외.
    const SEL = ['.lv-label', '.grain-mark', '.golden-mark', '.star-mark', '.dark-mark',
                 '.market-mark', '.synergy-dot', '.engrave-mark'];
    // ★/✦/🌑/시너지 dot은 transform(scale·rotate) 애니메이션을 달고 있다. getBoundingClientRect는
    // '지금 이 순간'의 변형된 박스를 돌려주므로, renderGrid 직후(모든 애니메이션 0% 키프레임 =
    // 모든 박스가 최소)에 한 번만 재면 항상 통과한다 — 실제로 300ms 뒤 같은 보드에서 ★×🌑이
    // 14.6px 겹쳤다. 애니메이션을 멈추고 한 주기를 균등 샘플해 '최악의 박스'(합집합)를 잰다.
    const anims = document.getAnimations().filter(a => a.effect && a.effect.target
      && a.effect.target.closest && a.effect.target.closest('#grid'));
    anims.forEach(a => a.pause());
    const PHASES = 24;
    const union = new Map(); // el -> {left,right,top,bottom}
    for (let p = 0; p < PHASES; p++) {
      for (const a of anims) {
        const d = (a.effect.getComputedTiming() || {}).duration;
        if (typeof d === 'number' && isFinite(d) && d > 0) a.currentTime = d * (p / PHASES);
      }
      for (const cell of document.querySelectorAll('#grid .cell')) {
        for (const sel of SEL) {
          const el = cell.querySelector(sel);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const u = union.get(el);
          if (!u) union.set(el, { left: r.left, right: r.right, top: r.top, bottom: r.bottom });
          else {
            u.left = Math.min(u.left, r.left); u.right = Math.max(u.right, r.right);
            u.top = Math.min(u.top, r.top);   u.bottom = Math.max(u.bottom, r.bottom);
          }
        }
      }
    }
    anims.forEach(a => a.play());
    const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    let collisions = 0, checked = 0, worst = null, seenMarks = new Set();
    const pairWorst = new Map(); // 'a × b' -> px (진단용: 실패 시 전 목록을 뿌린다)
    for (const cell of document.querySelectorAll('#grid .cell')) {
      if (!cell.querySelector('.grain-mark')) continue;
      checked++;
      const found = [];
      for (const sel of SEL) {
        const el = cell.querySelector(sel);
        if (el) { found.push([sel, union.get(el)]); seenMarks.add(sel); }
      }
      // 잠금/축복은 의사요소라 rect를 못 잡는다 — 실제 CSS 값(top:2 right:3, 10~11px)으로 근사
      const cr = cell.getBoundingClientRect();
      if (cell.classList.contains('locked-piece') || cell.classList.contains('blessed')) {
        found.push(['::lock', { left: cr.right - 17, right: cr.right - 3, top: cr.top + 2, bottom: cr.top + 15 }]);
        seenMarks.add('::lock');
      }
      for (let i = 0; i < found.length; i++) {
        for (let j = i + 1; j < found.length; j++) {
          if (hit(found[i][1], found[j][1])) {
            collisions++;
            const ox = Math.min(found[i][1].right, found[j][1].right) - Math.max(found[i][1].left, found[j][1].left);
            const key = `${found[i][0]} × ${found[j][0]}`;
            pairWorst.set(key, Math.max(pairWorst.get(key) || 0, +ox.toFixed(1)));
            if (!worst || ox > worst.ox) worst = { sel: key, ox: +ox.toFixed(1) };
          }
        }
      }
    }
    sellMode = false;
    const pairs = [...pairWorst.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}px`);
    return { collisions, checked, worst, pairs, cols: getGridCols(), marks: [...seenMarks].sort() };
  });
  ok(markCollisions.checked >= 20 && markCollisions.cols === 6, `결: 6열 ${markCollisions.checked}칸에서 표식 렌더`);
  // fixture 커버리지 자체를 고정한다 — 마크가 렌더되지 않으면 충돌 0은 아무 의미가 없다
  ok(markCollisions.marks.length >= 9,
    `마크 9종 전부 렌더 (fixture 커버리지) — ${markCollisions.marks.join(' ')}`);
  ok(markCollisions.collisions === 0,
    `칸 마크 전수 무충돌 (6열 최악 조건 · 애니메이션 전주기)${markCollisions.pairs.length ? ` — ${markCollisions.pairs.join(' / ')}` : ''}`);
  await clearOverlays(); await page.waitForTimeout(200); await page.screenshot({ path: path.join(SHOTS, '07-grain-marks.png') });

  // ================= 감사 스윕 C5/C6: 스프라이트 맞춤 + 좁은 뷰포트 모달 =================
  // C5: 캔버스가 셀을 넘치면 overflow:hidden이 잘라낸다 (6열에서 픽셀의 44.7%만 보였다).
  // 존재가 아니라 '셀 안에 들어가는가 + 종횡비가 보존되는가'를 잰다.
  console.log('감사 스윕 C5/C6');
  for (const [ms, wantCols] of [[7, 5], [24, 6]]) {
    const fit = await page.evaluate((m) => {
      state.bestLevel = 40; state.runBestLevel = 40;
      state.upgrades.maxShuriken = m;
      state.grid = new Array(getGridSize()).fill(null).map((_, i) => ({ id: 6000 + i, level: 12, fireTimer: 0 }));
      selectedIdx = -1;
      renderGrid();
      let worstOver = 0, worstRatio = 0, n = 0;
      for (const cell of document.querySelectorAll('#grid .cell')) {
        const cv = cell.querySelector('canvas');
        if (!cv) continue;
        n++;
        const cr = cell.getBoundingClientRect(), vr = cv.getBoundingClientRect();
        worstOver = Math.max(worstOver, vr.width - cr.width, vr.height - cr.height);
        worstRatio = Math.max(worstRatio, Math.abs(vr.width / vr.height - 1));
      }
      return { cols: getGridCols(), n, over: +worstOver.toFixed(2), ratio: +worstRatio.toFixed(3) };
    }, ms);
    ok(fit.cols === wantCols && fit.n >= 10, `C5: ${wantCols}열 ${fit.n}칸 렌더 (maxShuriken ${ms})`);
    ok(fit.over <= 0.5, `C5: ${wantCols}열에서 스프라이트가 칸을 넘지 않음 (초과 ${fit.over}px)`);
    ok(fit.ratio < 0.02, `C5: ${wantCols}열에서 종횡비 보존 (편차 ${fit.ratio})`);
  }

  // C6: 좁은/낮은 뷰포트에서 열린 모달이 화면을 벗어나면 제목·닫기 버튼이 잘린다.
  // 여기서 재는 것은 .info-box만이 아니라 '열려 있는 모달 박스'라 앞으로 추가될 모달도 함께 덮는다.
  for (const vp of [{ width: 320, height: 568, name: '320×568 세로' }, { width: 568, height: 320, name: '568×320 가로' }]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(150);
    const box = await page.evaluate(() => {
      state.bestLevel = 120; state.runBestLevel = 120;
      state.upgrades.maxShuriken = 4;
      state.grid = new Array(getGridSize()).fill(null);
      state.grid[0] = { id: 7100, level: 120, fireTimer: 0, grain: 'cheon', golden: true, star: true, dark: true };
      renderGrid();
      showShurikenInfo(0);
      const el = document.querySelector('#info-modal .info-box');
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        clipTop: +Math.max(0, -r.top).toFixed(1),
        clipBot: +Math.max(0, r.bottom - innerHeight).toFixed(1),
        scrollable: cs.overflowY === 'auto' || cs.overflowY === 'scroll',
      };
    });
    ok(box.clipTop === 0 && box.clipBot === 0,
      `C6: ${vp.name}에서 정보 모달이 뷰포트 안에 들어옴 (위 ${box.clipTop}px · 아래 ${box.clipBot}px 잘림)`);
    ok(box.scrollable, `C6: ${vp.name}에서 내용이 넘치면 스크롤 가능`);
    await page.evaluate(() => { const m = document.getElementById('info-modal'); if (m) m.classList.remove('show'); });
  }
  await page.setViewportSize({ width: 480, height: 960 });
  await page.waitForTimeout(150);

  // ================= Q-Leap 134: 진안(陣眼) 표적 의식 =================
  // 신뢰 클릭으로만 검증한다 (el.click()은 숨겨진 요소에서도 발화해 v3.09~3.76 ☰ 사건을 가렸다).
  console.log('Q-Leap 134 진안');
  await page.evaluate(() => {
    state.bestLevel = 20; state.runBestLevel = 20; state.autoRitualEnabled = false;
    state.upgrades.maxShuriken = 6; // 4열
    state.grid = new Array(getGridSize()).fill(null);
    // 무리 A(작음): 0,1,2 = Lv5 · 무리 B(큼): 4,5,6,8 = Lv7  → 무조준이면 B가 뽑힌다
    [0, 1, 2].forEach((i, k) => { state.grid[i] = { id: 300 + k, level: 5, fireTimer: 0, grain: 'cheon' }; });
    [4, 5, 6, 8].forEach((i, k) => { state.grid[i] = { id: 310 + k, level: 7, fireTimer: 0, grain: 'ji' }; });
    selectedIdx = -1; sellMode = false; infoMode = false;
    refreshUI();
  });
  const noAim = await page.evaluate(() => document.getElementById('ritual-btn').textContent);
  ok(!/◎/.test(noAim), `진안: 무조준이면 ◎ 없음 — "${noAim}"`);
  await clearOverlays(); await page.waitForTimeout(150);
  await page.click('#grid .cell[data-idx="2"]');           // 작은 무리의 구성원을 신뢰 클릭
  await page.waitForTimeout(200);
  const aimed = await page.evaluate(() => ({
    txt: document.getElementById('ritual-btn').textContent,
    outlined: [...document.querySelectorAll('#grid .cell')].filter(c => c.classList.contains('ritual-group')).map(c => +c.dataset.idx),
    sel: selectedIdx,
  }));
  ok(/◎/.test(aimed.txt), `진안: 조준 시 ◎ 표시 — "${aimed.txt}"`);
  ok(JSON.stringify(aimed.outlined.sort((a, b) => a - b)) === '[0,1,2]',
    `진안: 발동될 무리만 윤곽 — ${JSON.stringify(aimed.outlined)}`);
  await page.screenshot({ path: path.join(SHOTS, '08-ritual-eye.png') });
  await page.click('#ritual-btn');                          // 신뢰 클릭으로 발동
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    at2: state.grid[2] ? state.grid[2].level : null,
    at0: state.grid[0] ? state.grid[0].level : null,
    bigIntact: [4, 5, 6, 8].every(i => state.grid[i] && state.grid[i].level === 7),
    sel: selectedIdx,
    outlines: document.querySelectorAll('#grid .cell.ritual-group').length,
  }));
  ok(after.at2 === 7, `진안: 결과가 클릭한 칸(2)에 앉음 (Lv ${after.at2})`);
  ok(after.at0 === null, '진안: 기존 기본 칸(0)은 비었다 — 크기 정렬을 이겼다');
  ok(after.bigIntact, '진안: 더 큰 무리는 손대지 않았다');
  ok(after.sel === -1 && after.outlines === 0, '진안: 발동 후 조준·윤곽이 남지 않는다');
  // 새 마크 rect를 만들지 않았음을 구조적으로 증명 (마크 충돌 가드와 독립)
  const childParity = await page.evaluate(() => {
    state.grid = new Array(getGridSize()).fill(null);
    [0, 1, 2].forEach((i, k) => { state.grid[i] = { id: 400 + k, level: 5, fireTimer: 0, grain: 'cheon' }; });
    selectedIdx = -1; renderGrid();
    const before = document.querySelector('#grid .cell[data-idx="1"]').childElementCount;
    selectedIdx = 1; renderGrid();
    const cell = document.querySelector('#grid .cell[data-idx="1"]');
    return { before, after: cell.childElementCount, hasClass: cell.classList.contains('ritual-group') };
  });
  ok(childParity.hasClass && childParity.after === childParity.before,
    `진안: 윤곽은 outline만 — 셀 자식 노드 수 불변 (${childParity.before} → ${childParity.after})`);
  await page.evaluate(() => { selectedIdx = -1; renderGrid(); });

  // ================= Q-Leap 135: 부적의 때 =================
  // 정책 행은 자동화 모달 안에 있다 (새 패널 없음). 신뢰 클릭으로 실제 토글되는지 본다.
  console.log('Q-Leap 135 부적의 때');
  await page.evaluate(() => {
    state.bestLevel = 20; state.runBestLevel = 20; state.charmPolicy = 'now';
    state.luckyCharms = 2; state.stats.totalMerges = 500;
    refreshUI();
  });
  await clearOverlays(); await page.waitForTimeout(150);
  // #automation-btn은 ☰ 메뉴 안이라 닫힌 상태에서는 신뢰 클릭 대상이 아니다 — 모달은 기존 헬퍼로 열고,
  // 정작 검증 대상인 정책 버튼(모달 안, 실제로 보이는 요소)만 신뢰 클릭한다.
  await $id('automation-btn');
  await page.waitForTimeout(200);
  const boxShown = await page.evaluate(() => {
    const el = document.getElementById('charm-policy-box');
    return { visible: !!el && getComputedStyle(el).display !== 'none', held: (document.getElementById('charm-held')||{}).textContent };
  });
  ok(boxShown.visible, '부적: 100합성 이후 정책 행 노출');
  ok(boxShown.held === '2', `부적: 보유 수 표시 (${boxShown.held})`);
  await page.click('#charm-policy-box [data-charm="frontier"]');
  await page.waitForTimeout(150);
  const picked = await page.evaluate(() => ({
    policy: state.charmPolicy,
    active: document.querySelector('#charm-policy-box [data-charm="frontier"]').classList.contains('active'),
    desc: (document.getElementById('charm-policy-desc')||{}).textContent,
  }));
  ok(picked.policy === 'frontier' && picked.active, '부적: 신뢰 클릭으로 최전선 정책 선택');
  ok(/생성 레벨/.test(picked.desc || ''), `부적: 설명이 갱신된다 — "${picked.desc}"`);
  // 미해금 상태에서 순 정책은 함정이 되지 않는다 (설명이 폴백을 알린다)
  const pureFallback = await page.evaluate(() => {
    state.bestLevel = 3; state.charmPolicy = 'pure'; refreshAutoSellUI();
    return { effective: getCharmPolicyId(), desc: (document.getElementById('charm-policy-desc')||{}).textContent };
  });
  ok(pureFallback.effective === 'now', '부적: 결 미해금이면 순 정책이 즉시로 폴백');
  ok(/해금/.test(pureFallback.desc || ''), '부적: 폴백 상태를 설명으로 알린다');

  // C0 가드는 '설정 → 신뢰 클릭 → 단언' 순서여야 문다. 앞선 테스트가 남긴 값에 기대면
  // (첫 시도가 그랬다) 버그 코드에서도 통과해버린다 — 직접 프로브로 확인한 함정이다.
  // 앞의 폴백 테스트가 bestLevel을 3으로 내렸다 — refreshUI로 노출 상태까지 되돌려야 신뢰 클릭이 가능하다
  await page.evaluate(() => {
    state.bestLevel = 20; state.runBestLevel = 20; state.stats.totalMerges = 500;
    state.charmPolicy = 'now'; state.autoMergePriority = 'preserve';
    refreshUI(); refreshAutoSellUI(); refreshAutoLockUI();
  });
  await page.waitForTimeout(150);
  await page.click('#charm-policy-box [data-charm="now"]');
  await page.waitForTimeout(180);
  const prioIntact = await page.evaluate(() => ({
    prio: String(state.autoMergePriority),
    effective: state.autoMergePriority || 'low',
    savedHasKey: (localStorage.getItem('shuriken_merge_v2') || '').indexOf('autoMergePriority') >= 0,
    prioActive: [...document.querySelectorAll('#automation-modal [data-prio]')].filter(x => x.classList.contains('active')).map(x => x.dataset.prio),
    charmActive: [...document.querySelectorAll('#charm-policy-box [data-charm]')].filter(x => x.classList.contains('active')).map(x => x.dataset.charm),
  }));
  ok(prioIntact.prio === 'preserve', `부적: 정책 클릭이 자동 합치기 우선순위를 파괴하지 않는다 (${prioIntact.prio})`);
  ok(prioIntact.savedHasKey, '부적: 우선순위 키가 저장본에서 사라지지 않는다 (변종 보존 상실 방지)');
  ok(prioIntact.prioActive.join(',') === 'preserve', `부적: 우선순위 하이라이트 보존 (${prioIntact.prioActive.join(',') || '없음'})`);
  ok(prioIntact.charmActive.length === 1, `부적: 현재 정책 버튼이 하이라이트된다 (${prioIntact.charmActive.join(',') || '없음'})`);
  // 형제 루프(refreshAutoLockUI)가 도는 조작 뒤에도 유지되는가
  await $id('auto-lock-toggle');
  await page.waitForTimeout(120);
  const afterLock = await page.evaluate(() => ({
    charmActive: [...document.querySelectorAll('#charm-policy-box [data-charm]')].filter(x => x.classList.contains('active')).map(x => x.dataset.charm),
    prio: String(state.autoMergePriority),
  }));
  ok(afterLock.charmActive.length === 1 && afterLock.prio === 'preserve',
    `부적: 자동 잠금 토글 후에도 양쪽 하이라이트·설정 유지 (${afterLock.charmActive.join(',')} / ${afterLock.prio})`);
  await page.evaluate(() => { state.bestLevel = 20; state.charmPolicy = 'now'; refreshAutoSellUI(); });
  await $id('automation-close');
  await page.waitForTimeout(150);

  // ================= console errors =================
  const errs = consoleErrors.filter(e => !/favicon/i.test(e));
  ok(errs.length === 0, `콘솔 에러 0건${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('Failures:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error('DRIVER ERROR:', e); process.exit(2); });
