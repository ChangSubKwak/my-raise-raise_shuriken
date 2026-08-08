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

  // ================= console errors =================
  const errs = consoleErrors.filter(e => !/favicon/i.test(e));
  ok(errs.length === 0, `콘솔 에러 0건${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('Failures:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error('DRIVER ERROR:', e); process.exit(2); });
