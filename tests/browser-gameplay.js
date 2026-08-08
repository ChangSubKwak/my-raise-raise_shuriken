'use strict';
// OPTIONAL TOOL — needs system Chrome + playwright-core (npm i --no-save playwright-core).
// Run: npm run verify:gameplay
// Gameplay smoke: real-browser exploratory pass — merge loop, persistence roundtrip,
// offline reward, prestige flow. Complements verify.js (UI panels) with actual play paths.
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
  const server = http.createServer((req, res) => {
    const file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    fs.readFile(path.join(REPO, file), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 960 } });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  const clearOverlays = () => page.evaluate(() => {
    const skip = document.getElementById('tut-skip');
    const ov = document.getElementById('tutorial-overlay');
    if (ov && getComputedStyle(ov).display !== 'none') skip && skip.click();
    ['attendance-modal', 'offline-modal'].forEach(id => {
      const m = document.getElementById(id);
      if (m && m.classList.contains('show')) {
        const btn = m.querySelector('button');
        if (btn) btn.click();
      }
    });
  });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#grid .cell', { timeout: 15000 });
  await page.waitForTimeout(600);
  await clearOverlays();

  // ── Phase 1: hand-merge loop ──
  console.log('P1 손 합성 루프');
  const merged = await page.evaluate(() => {
    state.grid = state.grid.map(() => null);
    spawnShuriken(); spawnShuriken();
    const idxs = [];
    state.grid.forEach((c, i) => { if (c) idxs.push(i); });
    state.grid[idxs[0]].level = 3; state.grid[idxs[1]].level = 3;
    const goldBefore = state.gold;
    renderGrid();
    handleCellTap(idxs[0]);
    handleCellTap(idxs[1]);
    const cell = state.grid[idxs[1]];
    return { level: cell && cell.level, goldGain: state.gold - goldBefore, combo: state.comboCount, merges: state.stats.totalMerges };
  });
  ok(merged.level >= 4, `탭-탭 합성 동작 (Lv3+3 → Lv${merged.level})`);
  ok(merged.goldGain > 0, `합성 골드 지급 (+${merged.goldGain})`);
  // 축복 칸이 무작위로 끼면 콤보가 +1 더 오른다 (정상 설계) → >= 1
  ok(merged.combo >= 1 && merged.merges >= 1, `콤보/통계 집계 (combo ${merged.combo}, merges ${merged.merges})`);

  // ── Phase 2: persistence roundtrip (reload) ──
  console.log('P2 세이브 왕복 (새로고침)');
  await page.evaluate(() => {
    state.engravings = { 2: 'forge' };
    state.towerFloor = 8;
    state.towerArmed = true;
    state.strategyMode = 'gold';
    state.enlightenment = 77;
    state.prestigeCount = 3;
    state.bestLevel = 12;
    state.expedition = { piece: { id: 9999, level: 12, fireTimer: 0 }, tier: 0, startedAt: Date.now() - 60000, endsAt: Date.now() + 540000 };
    save();
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#grid .cell', { timeout: 15000 });
  await page.waitForTimeout(600);
  await clearOverlays();
  const rt = await page.evaluate(() => ({
    eng: JSON.stringify(state.engravings),
    tf: state.towerFloor, ta: state.towerArmed, sm: state.strategyMode,
    en: state.enlightenment, pc: state.prestigeCount,
    exped: state.expedition && state.expedition.piece.level,
  }));
  ok(rt.eng === '{"2":"forge"}', `각인 리로드 보존 (${rt.eng})`);
  ok(rt.tf === 8, `심층 towerFloor 보존 (${rt.tf})`);
  ok(rt.ta === true, 'towerArmed 보존');
  ok(rt.sm === 'gold', '전략 모드 보존');
  ok(rt.en === 77 && rt.pc === 3, '悟/윤회 횟수 보존');
  ok(rt.exped === 12, '원정 진행 보존');

  // ── Phase 3: offline reward ──
  console.log('P3 오프라인 보상');
  await page.evaluate(() => {
    // put passive income on the grid, then backdate lastSave by 2h
    state.grid = state.grid.map(() => null);
    state.grid[0] = { id: state.nextShurikenId++, level: 8, fireTimer: 0 };
    save();
    const raw = JSON.parse(localStorage.getItem('shuriken_merge_v2'));
    raw.lastSave = Date.now() - 2 * 3600 * 1000;
    localStorage.setItem('shuriken_merge_v2', JSON.stringify(raw));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#grid .cell', { timeout: 15000 });
  await page.waitForTimeout(800);
  const off = await page.evaluate(() => {
    const m = document.getElementById('offline-modal');
    return { shown: m && m.classList.contains('show'), goldText: document.getElementById('offline-gold').textContent, timeText: document.getElementById('offline-time').textContent };
  });
  ok(off.shown, '오프라인 모달 표시');
  ok(/[1-9]/.test(off.goldText), `오프라인 골드 > 0 (${off.goldText.trim()})`);
  ok(/2시간|1시간|120|119/.test(off.timeText) || off.timeText.length > 0, `오프라인 시간 표기 (${off.timeText.trim()})`);
  await page.screenshot({ path: path.join(SHOTS, 'g1-offline.png') });
  // 골드는 로드 시점(processOfflineReward)에 이미 지급 — '받기'는 모달만 닫는다 (정상 설계)
  const claimed = await page.evaluate(() => {
    const g = state.gold;
    document.getElementById('offline-claim').click();
    return { gold: g, closed: !document.getElementById('offline-modal').classList.contains('show') };
  });
  ok(claimed.gold > 0 && claimed.closed, `오프라인 골드 로드 시 지급 + 받기로 닫힘 (보유 ${claimed.gold})`);

  // ── Phase 4: prestige via UI ──
  console.log('P4 윤회 UI 흐름');
  await clearOverlays();
  await page.evaluate(() => {
    state.bestLevel = 12; state.runBestLevel = 12; state.gold = 123456;
    state.runPlaySec = 600; // v3.79.1 알찬 런 규칙: 10분 런이어야 悟 지급
    renderPrestige();
  });
  await page.evaluate(() => document.getElementById('prestige-btn').click());
  const modalShown = await page.evaluate(() => getComputedStyle(document.getElementById('prestige-modal')).display !== 'none');
  ok(modalShown, '윤회 확인 모달 오픈');
  await page.screenshot({ path: path.join(SHOTS, 'g2-prestige.png') });
  const before = await page.evaluate(() => ({ pc: state.prestigeCount, en: state.enlightenment }));
  await page.evaluate(() => document.getElementById('prestige-confirm').click());
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    pc: state.prestigeCount, gold: state.gold, en: state.enlightenment,
    eng: JSON.stringify(state.engravings), tf: state.towerFloor,
    exped: state.expedition, grid: state.grid.filter(Boolean).length,
  }));
  ok(after.pc === before.pc + 1, `윤회 실행 (${before.pc}→${after.pc})`);
  ok(after.gold === 0, '골드 리셋');
  ok(after.en > before.en, `悟 획득 (${before.en}→${after.en})`);
  ok(after.eng === '{"2":"forge"}', '각인은 윤회 보존');
  ok(after.tf === 8, 'towerFloor 윤회 보존');
  ok(after.exped === null, '원정은 윤회 소거');

  // ── console errors ──
  const errs = consoleErrors.filter(e => !/favicon/i.test(e));
  ok(errs.length === 0, `콘솔 에러 0건${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('Failures:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error('DRIVER ERROR:', e); process.exit(2); });
