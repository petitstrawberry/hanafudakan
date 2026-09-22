/** Focused, real local-server regression for the paired role board. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE_URL || 'http://localhost:5173';
assert.ok(new URL(base).hostname === 'localhost', 'This focused regression is local only.');
await mkdir('artifacts/qa', { recursive: true });
const report = { evidence: 'Real local Rust backend and browser UI, no mocks.', tests: [], pageErrors: [], consoleErrors: [], websocketErrors: [], commands: [], snapshots: [] };
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  localStorage.setItem('hana-name', '役ボードQA');
  localStorage.setItem('hana-sound', 'false');
  const NativeSocket = window.WebSocket;
  window.__yakuQaSockets = [];
  window.WebSocket = class extends NativeSocket {
    constructor(...args) { super(...args); if (String(args[0]).includes('/api/ws')) window.__yakuQaSockets.push(this); }
  };
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
let state = null;
let version = 0;
let roomId;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, label, timeout = 25000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(60); }
  throw new Error(`Timed out: ${label}`);
};
const roles = () => page.locator('.captured-yaku[data-role-player]').evaluateAll(panels => panels.map(panel => ({ player: panel.getAttribute('data-role-player'), roles: [...panel.querySelectorAll('[data-yaku-id]')].map(role => ({ id: role.getAttribute('data-yaku-id'), state: role.getAttribute('data-yaku-state'), text: role.textContent.replace(/\s+/g, ' ').trim() })) })));
const pass = (name, details = {}) => { report.tests.push({ name, status: 'passed', ...details }); console.log(`PASS ${name} ${JSON.stringify(details)}`); };
page.on('pageerror', error => report.pageErrors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
page.on('websocket', socket => {
  if (new URL(socket.url()).pathname !== '/api/ws') return;
  socket.on('framesent', event => { try { report.commands.push(JSON.parse(String(event.payload))); } catch {} });
  socket.on('framereceived', event => {
    try {
      const message = JSON.parse(String(event.payload));
      if (message.type === 'state') { state = message.room; version++; }
      if (message.type === 'error') report.websocketErrors.push(message.message);
      if (message.type === 'left') report.leftAcknowledged = true;
    } catch {}
  });
});
try {
  await page.goto(base);
  await page.getByRole('button', { name: /CPUと遊ぶ/ }).click();
  await until(() => state?.phase === 'waiting', 'CPU room');
  roomId = state.id;
  await page.getByRole('button', { name: '対戦をはじめる' }).click();
  await page.locator('.your-hand button').first().waitFor();
  await page.locator('.game-page[data-animating="false"]').waitFor();
  assert.equal(await page.locator('.captured-yaku [data-yaku-id]').count(), 24);
  assert.equal(await page.locator('.captured-yaku-group[data-capture-kind]').count(), 8);
  const before = await roles();
  report.snapshots.push({ captured: state.players.map(player => player.captured), roles: before });
  pass('real CPU game presents two classified four-pile areas with 12 role labels each');

  for (let action = 0; action < 10; action++) {
    await page.locator('.game-page[data-animating="false"]').waitFor({ timeout: 30000 });
    if (state.players.every(player => player.captured.length > 0) || ['round_end', 'finished'].includes(state.phase)) break;
    if (state.turn !== state.myIndex) { await until(() => state.turn === state.myIndex || ['round_end', 'finished'].includes(state.phase), 'CPU turn'); continue; }
    const previous = version;
    if (state.phase === 'draw_choice') {
      await page.locator(`.field-cards button[data-card-id="${state.legalTargets[0]}"]`).click();
    } else if (state.phase === 'decision') {
      await page.getByRole('button', { name: 'あがる', exact: true }).click();
    } else {
      const card = state.hand.find(card => state.field.some(target => Math.floor(card / 4) === Math.floor(target / 4))) ?? state.hand[0];
      const matches = state.field.filter(target => Math.floor(card / 4) === Math.floor(target / 4));
      await page.locator(`.your-hand button[data-card-id="${card}"]`).click();
      if (matches.length === 2) await page.locator(`.field-cards button[data-card-id="${matches[0]}"]`).click();
    }
    await until(() => version > previous, 'real move update');
    await sleep(500);
  }
  await page.locator('.game-page[data-animating="false"]').waitFor({ timeout: 30000 });
  const after = await roles();
  assert.ok(state.players.some(player => player.captured.length > 0));
  assert.ok(after.every(panel => panel.roles.length === 12));
  for (let player = 0; player < 2; player++) {
    const displayed = await page.locator(`.captured-yaku[data-capture-player="${player}"] [data-captured-card-id]`).evaluateAll(nodes => nodes.map(node => Number(node.dataset.capturedCardId)));
    assert.deepEqual([...displayed].sort((a, b) => a - b), [...state.players[player].captured].sort((a, b) => a - b));
    assert.equal(new Set(displayed).size, displayed.length, 'each physical captured card appears once');
  }
  report.snapshots.push({ captured: state.players.map(player => player.captured), roles: after });
  pass('real CPU/player captures update classified piles and retain both sets of role labels', { capturedCounts: state.players.map(player => player.captured.length), moves: report.commands.filter(command => command.type === 'play').length });
  await page.screenshot({ path: 'artifacts/qa/yaku-live-desktop.png', fullPage: true });
  await page.getByRole('switch', { name: '対局アシスト' }).click();
  assert.equal(await page.locator('.captured-yaku [data-yaku-id]').count(), 24);
  assert.equal(await page.locator('.captured-yaku [data-yaku-id]:disabled').count(), 24);
  assert.equal(await page.locator('.role-detail').count(), 0);
  assert.deepEqual(await roles(), after);
  pass('assist OFF preserves both role boards and their live status');
  await page.setViewportSize({ width: 390, height: 844 });
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.equal(size.scroll, size.width);
  await page.screenshot({ path: 'artifacts/qa/yaku-live-mobile.png', fullPage: true });
  pass('mobile 390px role board has no horizontal overflow', size);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.websocketErrors, []);
  pass('no page, console or game protocol errors');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error);
  await page.screenshot({ path: 'artifacts/qa/yaku-live-failure.png', fullPage: true }).catch(() => {});
} finally {
  await page.evaluate(() => { for (const socket of window.__yakuQaSockets || []) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'leave' })); }).catch(() => {});
  if (roomId) {
    await until(async () => { const data = await (await page.request.get(`${base}/api/rooms`)).json(); report.cleanupRoomAbsent = !data.rooms.some(room => room.id === roomId); return report.cleanupRoomAbsent; }, 'QA room cleanup').catch(() => {});
  }
  await writeFile('artifacts/qa/yaku-live-report.json', `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
