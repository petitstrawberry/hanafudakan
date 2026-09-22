/** One real HTTPS/WSS CPU-room smoke test against an explicitly supplied public
 * preview URL. No HTTP, WebSocket, or game-state mocking is used. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_PUBLIC_URL;
assert.ok(base?.startsWith('https://'), 'QA_PUBLIC_URL must be the authorized HTTPS preview');
const output = resolve('artifacts/qa');
await mkdir(output, { recursive: true });
const report = { evidence: 'Real external HTTPS and WSS smoke test, fresh browser context, no network/game mocks. GPU/WebGL disabled to exercise the 2D fallback.', base, startedAt: new Date().toISOString(), tests: [], httpErrors: [], pageErrors: [], websocketErrors: [], apiResponses: [], cardResponses: [], fontResponses: [], socketConnections: [], sentCommands: [], cleanup: 'pending', leftAcknowledged: false };
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'], ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  localStorage.setItem('hana-name', '公開接続QA');
  localStorage.setItem('hana-sound', 'false');
  const NativeSocket = window.WebSocket;
  window.__publicSmokeSockets = [];
  window.WebSocket = class extends NativeSocket {
    constructor(...args) { super(...args); if (String(args[0]).includes('/api/ws')) window.__publicSmokeSockets.push(this); }
  };
});
const page = await context.newPage();
page.setDefaultTimeout(25000);
let state = null;
let version = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, label, timeout = 25000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await wait(50); }
  throw new Error(`Timed out: ${label}`);
};
page.on('pageerror', error => report.pageErrors.push(error.message));
page.on('response', response => {
  const url = new URL(response.url());
  const entry = { path: url.pathname, status: response.status() };
  if (response.status() >= 400) report.httpErrors.push(entry);
  if (url.pathname.startsWith('/api/')) report.apiResponses.push(entry);
  if (url.pathname.startsWith('/cards/')) report.cardResponses.push(entry);
  if (url.pathname.startsWith('/fonts/')) report.fontResponses.push(entry);
});
page.on('websocket', socket => {
  if (!socket.url().includes('/api/ws')) return;
  const url = new URL(socket.url());
  report.socketConnections.push(`${url.protocol}//${url.host}${url.pathname}`);
  socket.on('framesent', event => {
    try { report.sentCommands.push(JSON.parse(String(event.payload))); } catch { /* non-JSON control frames */ }
  });
  socket.on('framereceived', event => {
    try {
      const message = JSON.parse(String(event.payload));
      if (message.type === 'state') { state = message.room; version++; }
      if (message.type === 'error') report.websocketErrors.push(message.message);
      if (message.type === 'left') report.leftAcknowledged = true;
    } catch { /* non-JSON control frames */ }
  });
});

try {
  const navigation = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
  assert.equal(navigation.status(), 200);
  assert.ok(page.url().startsWith('https://'));
  await page.getByRole('button', { name: /CPUと遊ぶ/ }).click();
  await until(() => state?.phase === 'waiting', 'CPU room creation over HTTPS');
  assert.equal(state.mode, 'cpu');
  assert.equal(state.players.length, 2);
  assert.equal(state.players[1].isCpu, true);
  report.tests.push({ name: 'HTTPS UI creates session and CPU room', status: 'passed', roomId: state.id });
  await page.getByRole('button', { name: '対戦をはじめる' }).click();
  await until(() => state?.phase === 'play' && state.turn === state.myIndex, 'own first legal turn');
  await page.locator('.game-page[data-animating="false"]').waitFor();
  const initial = structuredClone(state);
  const before = version;
  const candidates = initial.hand.map(cardId => ({ cardId, targets: initial.field.filter(id => Math.floor(id / 4) === Math.floor(cardId / 4)) }));
  const move = candidates.find(move => move.targets.length === 1) || candidates.find(move => move.targets.length !== 2) || candidates[0];
  const sentBefore = report.sentCommands.length;
  await page.locator(`.your-hand [data-card-id="${move.cardId}"]`).click();
  if (move.targets.length === 2) {
    assert.equal(report.sentCommands.length, sentBefore, 'ambiguous capture awaits explicit candidate');
    await page.locator(`.field-cards button[data-card-id="${move.targets[0]}"]`).click();
  }
  await until(() => version > before && state.hand.length < initial.hand.length, 'actual WSS state accepts hand move');
  const played = report.sentCommands.slice(sentBefore).find(command => command.type === 'play');
  assert.ok(played);
  assert.equal(played.cardId, move.cardId);
  report.tests.push({ name: 'Legal UI move receives real WSS state update', status: 'passed', targetCount: move.targets.length, command: played, stateVersions: version, handBefore: initial.hand.length, handAfter: state.hand.length });
  await page.locator('.game-page[data-animating="false"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('[data-backend]')?.getAttribute('data-backend') === '2D');
  report.renderer = await page.locator('[data-backend]').getAttribute('data-backend');
  await page.evaluate(() => document.fonts.ready);
  assert.ok(report.cardResponses.length > 0 && report.cardResponses.every(item => item.status === 200));
  assert.ok(report.fontResponses.length > 0 && report.fontResponses.every(item => item.status === 200));
  assert.ok(report.socketConnections.length > 0 && report.socketConnections.every(url => url.startsWith('wss://')));
  assert.deepEqual(report.httpErrors, []);
  assert.deepEqual(report.websocketErrors, []);
  assert.deepEqual(report.pageErrors, []);
  report.tests.push({ name: 'WSS, cards/fonts HTTP 200 and 2D fallback', status: 'passed', cards: report.cardResponses.length, fonts: report.fontResponses.length, renderer: report.renderer });
  await page.screenshot({ path: `${output}/public-cpu-game.png`, fullPage: false });
  report.screenshot = 'public-cpu-game.png';
  await page.getByRole('button', { name: 'ロビーへ', exact: true }).first().click();
  const confirmation = page.getByRole('button', { name: '投了して退室する', exact: true });
  await confirmation.waitFor();
  await confirmation.click();
  await until(() => !new URL(page.url()).searchParams.has('room'), 'UI leave completed');
  assert.ok(report.apiResponses.some(item => item.path.endsWith('/leave') && item.status === 200));
  report.cleanup = 'UI forfeit/leave completed with HTTP 200';
  report.status = 'passed';
  console.log(JSON.stringify({ status: report.status, tests: report.tests, cleanup: report.cleanup }));
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack;
  process.exitCode = 1;
  console.error(error);
} finally {
  const fallbackSent = await page.evaluate(() => {
    let sent = 0;
    for (const socket of window.__publicSmokeSockets || []) if (socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ type: 'leave' })); sent++; }
    return sent;
  }).catch(() => 0);
  if (fallbackSent) await until(() => report.leftAcknowledged, 'fallback WebSocket leave acknowledgment', 5000).catch(() => {});
  if (state?.id) {
    try {
      await until(async () => {
        const response = await page.request.get(`${base}/api/rooms`);
        const body = await response.json();
        report.cleanupRoomAbsent = response.ok() && !body.rooms.some(room => room.id === state.id);
        return report.cleanupRoomAbsent;
      }, 'created CPU room disappears after leave', 5000);
      report.cleanup = `${report.cleanup === 'pending' ? 'Fallback WebSocket leave' : report.cleanup}; created room absent from public room list`;
    } catch (error) {
      report.cleanup = `Unverified cleanup: ${error.message}`;
      report.status = 'failed';
      process.exitCode = 1;
    }
  } else report.cleanup = 'No room was created';
  report.finishedAt = new Date().toISOString();
  await writeFile(`${output}/public-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
