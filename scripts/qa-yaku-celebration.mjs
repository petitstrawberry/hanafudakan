/** Local-only synthetic public-state/event tests for NEW-role announcements.
 * This supplements the real Rust game checks; it does not contact a public site.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://localhost:5173';
const visualOnly = process.env.QA_CUE_VISUAL_ONLY === '1';
await mkdir('artifacts/qa', { recursive: true });
const report = { evidence: 'Local browser, synthetic public RoomView and game events; no real backend room or public deployment.', tests: [], pageErrors: [], consoleErrors: [], screenshots: [] };
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
const session = { token: 'celebration-qa-token', playerId: 'celebration-self', name: '演出QA 花子' };
const baseline = () => ({
  id: 'celebration-fixture', name: '新しい役だけの演出', hostId: session.playerId, mode: 'pvp', rounds: 3, round: 1, status: 'playing',
  players: [{ id: session.playerId, name: session.name, score: 0, handCount: 4, captured: [0, 8, 32], connected: true, isCpu: false }, { id: 'celebration-other', name: '演出QA 太郎', score: 0, handCount: 4, captured: [], connected: true, isCpu: false }],
  myIndex: 0, hand: [29, 16, 20, 24], field: [28, 13, 2, 3, 4, 5, 36, 37], deckCount: 16, turn: 0, phase: 'play', drawnCard: null,
  yaku: [[{ name: '花見で一杯', points: 5 }], []], koikoi: [0, 0], winner: null, matchWinner: null, roundPoints: 0, messages: [], log: ['合成された公開局面'], legalTargets: [], spectators: 0, dealer: 0, events: [],
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, message, timeout = 16000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(50); }
  throw new Error(`Timed out: ${message}`);
};
function pass(name, details = {}) { report.tests.push({ name, status: 'passed', ...details }); console.log(`PASS ${name} ${JSON.stringify(details)}`); }
async function setup(initial) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(session => {
    localStorage.setItem('hanafudakan-session', JSON.stringify(session));
    localStorage.setItem('hana-sound', 'false');
    localStorage.setItem('hana-motion', 'true');
    window.__yakuAnnouncements = [];
    window.__yakuAnnouncementEnds = [];
    let lastKey = '';
    new MutationObserver(() => {
      const node = document.querySelector('.yaku-cut-in');
      if (!node) { if (lastKey) window.__yakuAnnouncementEnds.push({ key: lastKey, at: performance.now() }); lastKey = ''; return; }
      const key = `${node.dataset.sequence}:${node.dataset.kind}:${node.dataset.yakuName}`;
      if (key === lastKey) return;
      lastKey = key;
      window.__yakuAnnouncements.push({ key, name: node.dataset.yakuName, kind: node.dataset.kind, title: node.querySelector('.yaku-cut-in-title')?.textContent, player: node.querySelector('.yaku-cut-in-player')?.textContent, points: node.querySelector('.yaku-cut-in-points')?.textContent, delta: node.querySelector('.yaku-increment-value')?.textContent, cards: [...node.querySelectorAll('img.yaku-cut-in-card')].map(image => image.getAttribute('src')), at: performance.now() });
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sequence', 'data-kind', 'data-yaku-name'] });
  }, session);
  const page = await context.newPage();
  page.setDefaultTimeout(16000);
  const client = { context, page, room: initial, socket: null, commands: [] };
  page.on('pageerror', error => report.pageErrors.push(error.stack));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === '/api/rooms') body = { rooms: [{ id: client.room.id, name: client.room.name, mode: 'pvp', rounds: 3, players: 1, spectators: 0, locked: false, status: 'playing', hostName: session.name }] };
    else if (path === '/api/me' || path === '/api/session') body = session;
    else if (path.endsWith('/join')) body = { roomId: client.room.id };
    else throw new Error(`Unexpected fixture HTTP call ${path}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.routeWebSocket('**/api/ws?*', socket => {
    client.socket = socket;
    socket.onMessage(message => client.commands.push(JSON.parse(String(message))));
    socket.send(JSON.stringify({ type: 'state', room: client.room }));
  });
  await page.goto(`${base}/?room=${initial.id}`);
  await page.locator('.captured-yaku [data-yaku-id]').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  return client;
}
const announcements = client => client.page.evaluate(() => window.__yakuAnnouncements);
async function publish(client, room) {
  client.room = room;
  client.socket.send(JSON.stringify({ type: 'state', room }));
  await delay(100);
}
async function finished(client) { await client.page.locator('.game-page[data-animating="false"]').waitFor({ timeout: 25000 }); }
function event(room, id, source, cardId, targetIds, captured, deckCount) {
  return { id, player: 0, source, cardId, targetIds, captured: true, field: room.field.filter(card => !targetIds.includes(card)), capturedCards: [captured, []], deckCount, requiresChoice: false };
}
try {
  const client = await setup(baseline());
  await delay(200);
  assert.deepEqual(await announcements(client), []);
  pass('existing role in initial room snapshot is not replayed');
  const next = structuredClone(client.room);
  const firstCapture = [...next.players[0].captured, 29, 28];
  const handEvent = event(next, 1, 'hand', 29, [28], firstCapture, 16);
  const drawEvent = event({ ...next, field: handEvent.field }, 2, 'draw', 12, [13], [...firstCapture, 12, 13], 15);
  next.players[0].captured = drawEvent.capturedCards[0];
  next.players[0].handCount = 3;
  next.hand = [16, 20, 24];
  next.field = drawEvent.field;
  next.deckCount = 15;
  next.events = [handEvent, drawEvent];
  next.yaku[0] = [{ name: '三光', points: 5 }, { name: '花見で一杯', points: 5 }, { name: '月見で一杯', points: 5 }];
  next.phase = 'decision';
  await publish(client, next);
  await client.page.locator('.yaku-cut-in[data-kind="role"]').waitFor();
  await delay(250);
  // Capture the live compositor frame directly: a full Playwright screenshot
  // can finish after a deliberately brief announcement has already disappeared.
  const cdp = await client.context.newCDPSession(client.page);
  const nativeFrame = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('artifacts/qa/yaku-celebration-new-role.png', Buffer.from(nativeFrame.data, 'base64'));
  await cdp.detach();
  report.screenshots.push('yaku-celebration-new-role.png');
  await until(async () => (await announcements(client)).length >= 2, 'two new-role announcements');
  await finished(client);
  const gained = await announcements(client);
  assert.deepEqual(gained.map(item => item.name), ['三光', '月見で一杯']);
  assert.ok(gained.every(item => item.kind === 'role' && item.title.includes(item.name) && item.player.includes(session.name)));
  assert.deepEqual([...gained[0].cards].sort(), ['/cards/0.svg', '/cards/8.svg', '/cards/28.svg'].sort());
  assert.deepEqual([...gained[1].cards].sort(), ['/cards/28.svg', '/cards/32.svg'].sort());
  assert.ok(gained[1].at > gained[0].at + 500, 'new roles must be presented sequentially');
  pass('two new roles are named and illustrated sequentially, existing role is excluded', { announcements: gained });
  if (!visualOnly) {
  await publish(client, { ...client.room, phase: 'play', turn: 1, koikoi: [1, 0] });
  await finished(client);
  await delay(200);
  assert.deepEqual(await announcements(client), gained);
  pass('koikoi with identical earned roles does not replay those roles');
  await client.page.reload();
  await client.page.locator('.captured-yaku [data-yaku-id]').first().waitFor();
  await finished(client);
  await delay(300);
  assert.deepEqual(await announcements(client), []);
  pass('reconnect/current snapshot does not replay completed roles');

  const nextRound = baseline();
  nextRound.round = 2;
  nextRound.players[0].captured = [0, 8];
  nextRound.yaku = [[], []];
  nextRound.events = client.room.events;
  await publish(client, nextRound);
  await finished(client);
  const earnedAgain = structuredClone(nextRound);
  const againEvent = event(earnedAgain, 3, 'hand', 29, [28], [0, 8, 29, 28], 16);
  earnedAgain.events = [...nextRound.events, againEvent];
  earnedAgain.field = againEvent.field;
  earnedAgain.players[0].captured = againEvent.capturedCards[0];
  earnedAgain.players[0].handCount = 3;
  earnedAgain.hand = [16, 20, 24];
  earnedAgain.phase = 'decision';
  earnedAgain.yaku[0] = [{ name: '三光', points: 5 }];
  await publish(client, earnedAgain);
  await until(async () => (await announcements(client)).length === 1, 'same role in a new round');
  await finished(client);
  assert.deepEqual((await announcements(client)).map(item => item.name), ['三光']);
  pass('same role may be announced again after the next round begins');
  await client.context.close();

  const incrementInitial = baseline();
  incrementInitial.id = 'increment-fixture';
  incrementInitial.players[0].captured = [2, 3, 6, 7, 10, 11, 14, 15, 18, 19];
  incrementInitial.yaku[0] = [{ name: 'カス', points: 1 }];
  incrementInitial.hand = [22, 0, 8, 12];
  incrementInitial.field = [23, 4, 5, 16, 17, 36, 37, 40];
  const increment = await setup(incrementInitial);
  const increased = structuredClone(increment.room);
  const incrementEvent = event(increased, 1, 'hand', 22, [23], [...increased.players[0].captured, 22, 23], increased.deckCount);
  increased.events = [incrementEvent];
  increased.field = incrementEvent.field;
  increased.players[0].captured = incrementEvent.capturedCards[0];
  increased.players[0].handCount = 3;
  increased.hand = [0, 8, 12];
  increased.yaku[0] = [{ name: 'カス', points: 3 }];
  increased.phase = 'decision';
  await publish(increment, increased);
  await increment.page.locator('.yaku-cut-in[data-kind="increment"]').waitFor();
  await increment.page.screenshot({ path: 'artifacts/qa/yaku-celebration-increment.png', fullPage: false });
  report.screenshots.push('yaku-celebration-increment.png');
  await finished(increment);
  const deltas = await announcements(increment);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].kind, 'increment');
  assert.equal(deltas[0].name, 'カス');
  assert.match(deltas[0].delta, /\+2\s*文/);
  const ends = await increment.page.evaluate(() => window.__yakuAnnouncementEnds);
  const deltaEnd = ends.find(item => item.key === deltas[0].key);
  assert.ok(deltaEnd && deltaEnd.at - deltas[0].at < 1300, 'point increase should use the short announcement');
  pass('same-category point increase shows only a brief +2文 increment', { announcement: deltas[0], duration: deltaEnd.at - deltas[0].at });
  assert.equal(increment.commands.length, 0);
  await increment.context.close();
  }
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error);
} finally {
  await writeFile(`artifacts/qa/yaku-celebration${visualOnly ? '-visual' : ''}-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
