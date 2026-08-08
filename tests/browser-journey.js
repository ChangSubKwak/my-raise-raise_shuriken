'use strict';
// OPTIONAL TOOL — needs system Chrome + playwright-core (npm i --no-save playwright-core).
// Run: npm run verify:journey
// Full-lifecycle E2E journey in a real browser: fresh boot → merge to a record →
// prestige (UI) → tower arm+enter+abandon (UI) → expedition send/claim (info-modal UI) →
// market premium sell (UI). Covers flows the other suites reach only at function level.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ok ' + msg); }
  else { fail++; failures.push(msg); console.log('  ✗ FAIL ' + msg); }
}

(async () => {
  const server = http.createServer((req, res) => {
    fs.readFile(path.join(REPO, req.url === '/' ? '/index.html' : req.url.split('?')[0]), (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(d);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 960 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForSelector('#grid .cell');
  const clearOverlays = async () => {
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const s = document.getElementById('tut-skip');
        const ov = document.getElementById('tutorial-overlay');
        if (ov && getComputedStyle(ov).display !== 'none' && s) s.click();
        const a = document.getElementById('attend-claim');
        const am = document.getElementById('attend-modal');
        if (am && am.classList.contains('show') && a) a.click();
      });
    }
  };
  await clearOverlays();

  // ── 1. fresh boot: minimal surface ──
  console.log('1. 신규 부팅');
  const freshBtns = await page.evaluate(() =>
    [...document.querySelectorAll('#grid-header button')].filter(el => el.offsetParent !== null).length);
  ok(freshBtns === 2, `Lv1 header shows only 힌트+메뉴 (${freshBtns})`);

  // ── 2. merge to a record (tap-tap UI) ──
  console.log('2. 손 합성 신기록');
  await page.evaluate(() => {
    state.grid = state.grid.map(() => null);
    state.grid[0] = { id: state.nextShurikenId++, level: 7, fireTimer: 0 };
    state.grid[1] = { id: state.nextShurikenId++, level: 7, fireTimer: 0 };
    renderGrid();
  });
  await page.click('#grid .cell[data-idx="0"]');
  await page.waitForTimeout(150);
  await page.click('#grid .cell[data-idx="1"]');
  await page.waitForTimeout(400);
  const rec = await page.evaluate(() => ({ b: state.bestLevel, gold: state.gold }));
  ok(rec.b >= 8, `record reached Lv ${rec.b} via real taps`);
  ok(rec.gold > 0, 'merge gold paid');

  // ── 3. prestige via UI ──
  console.log('3. 윤회 (UI)');
  await clearOverlays();
  await page.evaluate(() => { state.runBestLevel = state.bestLevel; refreshUI(); });
  await page.click('#prestige-btn');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('prestige-modal')).display !== 'none'), 'prestige modal opens');
  await page.click('#prestige-confirm');
  await page.waitForTimeout(400);
  const p1 = await page.evaluate(() => ({ pc: state.prestigeCount, skillsVisible: document.getElementById('skill-block').style.display !== 'none' }));
  ok(p1.pc === 1, 'prestige executed');
  ok(p1.skillsVisible, 'skill block revealed after first prestige');

  // ── 4. tower arm → enter → constraint → abandon (UI) ──
  console.log('4. 시련의 탑 (UI)');
  await page.evaluate(() => { state.prestigeCount = 2; state.bestLevel = 12; state.runBestLevel = 12; refreshUI(); });
  await clearOverlays();
  await page.click('#tower-arm');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => state.towerArmed === true), 'tower armed via panel button');
  await page.click('#prestige-btn');
  await page.waitForTimeout(200);
  await page.click('#prestige-confirm');
  await page.waitForTimeout(500);
  const tw = await page.evaluate(() => ({
    active: state.towerActive, grid: state.grid.filter(Boolean).length,
    slow: getSpawnInterval() / getSpawnIntervalBase(),
  }));
  ok(tw.active === 1, 'floor 1 entered on armed prestige');
  ok(tw.grid === 0, 'no inherited pieces in tower run');
  await clearOverlays();
  await page.click('#tower-abandon');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => state.towerActive === 0), 'abandon lifts the floor');

  // ── 5. expedition send + claim via info modal ──
  console.log('5. 원정 (info modal UI)');
  await page.evaluate(() => {
    state.bestLevel = 12; state.runBestLevel = 12;
    state.grid = state.grid.map(() => null);
    state.grid[2] = { id: state.nextShurikenId++, level: 12, fireTimer: 0 };
    refreshUI();
  });
  await clearOverlays();
  await page.click('#info-btn');
  await page.waitForTimeout(150);
  await page.click('#grid .cell[data-idx="2"]');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => document.getElementById('info-modal').classList.contains('show')), 'info modal opens in info mode');
  await page.click('.info-exped-btn[data-tier="0"]');
  await page.waitForTimeout(250);
  const ex1 = await page.evaluate(() => ({ has: !!state.expedition, gone: !state.grid[2] }));
  ok(ex1.has && ex1.gone, 'expedition departs via modal button (piece leaves the grid)');
  // fast-forward and claim through the chip
  await page.evaluate(() => { state.expedition.endsAt = Date.now() - 1000; updateHUD(); });
  await page.waitForTimeout(300);
  const goldBefore = await page.evaluate(() => state.gold);
  await page.click('#expedition-chip');
  await page.waitForTimeout(300);
  const ex2 = await page.evaluate(() => ({ cleared: !state.expedition, back: state.grid.filter(Boolean).length, gold: state.gold }));
  ok(ex2.cleared && ex2.back === 1, 'claim returns the piece through the chip');
  ok(ex2.gold > goldBefore, `expedition premium paid (+${ex2.gold - goldBefore})`);
  await page.click('#info-btn'); // info mode off
  await page.waitForTimeout(100);

  // ── 6. market premium sell via sell mode ──
  console.log('6. 오늘의 시세 판매 (UI)');
  const mkt = await page.evaluate(() => {
    // 앞 단계의 시한부 버프(골드러시/폭주)가 기대값 계산과 실제 판매 사이에 만료되면
    // goldMul이 달라져 단언이 흔들린다 — 고정하고 계산
    state.goldRushTimer = 0; state.frenzyTimer = 0; state.comboCount = 0;
    const lv = getMarketLevel();
    state.grid = state.grid.map(() => null);
    state.grid[0] = { id: state.nextShurikenId++, level: lv, fireTimer: 0 };
    renderGrid();
    // slack은 표창이 그리드에 있는 지금 계산 (판매 후엔 rate가 0이라 늦다)
    return { lv, mul: getMarketMul(), expect: sellValue(state.grid[0]), slack: Math.ceil(getPassiveGoldRate()) + 5 };
  });
  await page.click('#sell-btn');
  await page.waitForTimeout(150);
  const goldBeforeSell = await page.evaluate(() => state.gold);
  await page.click('#grid .cell[data-idx="0"]');
  await page.waitForTimeout(250);
  const sold = await page.evaluate(() => ({ gold: state.gold, sells: state.stats.marketSells || 0, empty: !state.grid[0] }));
  // 클릭 사이 ~수백 ms 동안 그리드 표창의 패시브 골드가 계속 쌓인다 — 정확 일치 대신
  // [기대값, 기대값 + 1초치 패시브] 범위로 단언 (프리미엄 미적용이면 기대값의 절반이라 확실히 걸러짐)
  const delta = sold.gold - goldBeforeSell;
  ok(sold.empty && delta >= mkt.expect && delta <= mkt.expect + mkt.slack,
    `market sell pays the ×${mkt.mul} premium (+${delta}, expect ${mkt.expect}~+${mkt.slack})`);
  ok(sold.sells >= 1, 'marketSells stat credited');

  // ── console errors ──
  ok(errs.length === 0, `콘솔 에러 0건${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('Failures:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error('DRIVER ERROR:', e); process.exit(2); });
