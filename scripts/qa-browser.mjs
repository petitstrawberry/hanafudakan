/** Real-browser smoke tests. Run with a dev server and backend already running.
 * PLAYWRIGHT_MODULE may point to a locally installed Playwright package.
 * QA_BASE_URL defaults to http://localhost:5173.
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE_URL || 'http://localhost:5173';
const output = resolve('artifacts/qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
const clients = [];
const report = { startedAt: new Date().toISOString(), base, tests: [], consoleErrors: [], pageErrors: [], websocketErrors: [], screenshots: [], selectionCases: {}, drawnChoices: 0, animations: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate, message, timeout = 12000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await predicate()) return; await delay(60); }
  throw new Error(`Timed out: ${message}`);
};
function pass(name, details = {}) { report.tests.push({ name, status: 'passed', ...details }); console.log(`PASS ${name} ${JSON.stringify(details)}`); }
async function screenshot(client, name) {
  await client.page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: 'disabled' });
  report.screenshots.push(`${name}.png`);
}
async function makeClient(name, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.__qaSockets = [];
    window.WebSocket = class extends NativeSocket {
      constructor(...args) { super(...args); window.__qaSockets.push(this); }
    };
    window.__qaAnimationSamples = [];
    let lastStage = '';
    new MutationObserver(() => {
      const overlay = document.querySelector('.move-overlay');
      const stage = overlay?.className || '';
      if (!overlay || stage === lastStage) { lastStage = stage; return; }
      lastStage = stage;
      window.__qaAnimationSamples.push({ stage, targets: overlay.querySelectorAll('.target-copy').length, played: overlay.querySelectorAll('.played-copy').length, enabledHandButtons: document.querySelectorAll('.your-hand button:not([disabled])').length, locked: document.querySelector('.game-page')?.getAttribute('data-animating') });
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-animating'] });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const client = { name, context, page, room: null, version: 0, socketCount: 0, sent: [], expected403: 0 };
  clients.push(client);
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({ client: name, text: message.text() });
  });
  page.on('pageerror', error => report.pageErrors.push({ client: name, text: error.message }));
  page.on('websocket', socket => {
    if (new URL(socket.url()).pathname !== '/api/ws') return;
    client.socketCount++;
    socket.on('framesent', event => {
      try { client.sent.push(JSON.parse(String(event.payload))); } catch { /* control frames */ }
    });
    socket.on('framereceived', event => {
      try {
        const data = JSON.parse(String(event.payload));
        if (data.type === 'state') { client.room = data.room; client.version++; }
        if (data.type === 'left') client.room = null;
        if (data.type === 'error') report.websocketErrors.push({ client: name, text: data.message });
      } catch { /* control frames */ }
    });
  });
  await page.goto(base);
  await page.getByRole('button', { name: /CPUと遊ぶ/ }).waitFor();
  await page.locator('.profile-button').click();
  await page.getByLabel('プレイヤー名', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'この名前ではじめる' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  return client;
}
async function checkOverflow(client, label) {
  const size = await client.page.evaluate(() => ({ viewport: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.viewport + 1, `${label} horizontal overflow: ${JSON.stringify(size)}`);
  pass(label, size);
}
async function playMove(client) {
  const { page } = client;
  await page.locator('.game-page[data-animating="false"]').waitFor({ timeout: 20000 });
  const state = client.room;
  if (state.turn !== state.myIndex || ['round_end', 'finished'].includes(state.phase)) return;
  const previous = client.version;
  if (state.phase === 'play') {
    // Prefer a capture. Inputs are selected solely from this player's network view.
    const countTargets = id => state.field.filter(target => Math.floor(id / 4) === Math.floor(target / 4)).length;
    const card = state.hand.find(id => countTargets(id) === 2) ?? state.hand.find(id => countTargets(id) > 0) ?? state.hand[0];
    assert.notEqual(card, undefined);
    const targets = state.field.filter(id => Math.floor(id / 4) === Math.floor(card / 4));
    const sentBeforeSelection = client.sent.length;
    await page.locator(`.your-hand button[data-card-id="${card}"]`).click();
    report.selectionCases[targets.length] = (report.selectionCases[targets.length] || 0) + 1;
    if (targets.length === 2) {
      await page.locator('.selection-tray').waitFor();
      assert.equal(client.sent.length, sentBeforeSelection, 'ambiguous two-target capture must wait for the chosen target');
      assert.equal(await page.locator('.field-slot.match-target').count(), 2);
      assert.equal(await page.locator('.target-option').count(), 2);
      if (report.selectionCases[2] === 1) await screenshot(client, 'matching-two-card-selection');
      await page.locator(`.target-option[data-target-id="${targets[0]}"]`).click();
    } else {
      await waitFor(() => client.sent.length > sentBeforeSelection, 'unambiguous hand click automatically submits');
      assert.equal(await page.getByTestId('confirm-play').count(), 0);
    }
    if (targets.length && !report.screenshots.includes('capture-stack.png')) {
      await page.locator('.move-stack .target-copy').first().waitFor({ state: 'visible', timeout: 5000 });
      // Keep CSS animation timing intact to capture the real stacked-card stage.
      await page.screenshot({ path: `${output}/capture-stack.png`, fullPage: false, animations: 'allow' });
      report.screenshots.push('capture-stack.png');
    }
  } else if (state.phase === 'draw_choice') {
    const target = state.legalTargets[0];
    assert.equal(await page.locator('.draw-selection .target-option').count(), 2);
    if (!report.drawnChoices) await screenshot(client, 'drawn-two-card-selection');
    report.drawnChoices++;
    await page.locator(`.target-option[data-target-id="${target}"]`).click();
  } else if (state.phase === 'decision') {
    await page.getByRole('button', { name: 'あがる', exact: true }).click();
  } else throw new Error(`Unexpected move phase ${state.phase}`);
  await waitFor(() => client.version > previous, 'server accepted UI move');
  await delay(420); // The server permits 30 commands in 10 seconds.
}
function checkPrivacy(client) {
  const state = client.room;
  assert.ok(state.players.every(player => !Object.hasOwn(player, 'hand') && !Object.hasOwn(player, 'cards')));
  assert.ok(!Object.hasOwn(state, 'deck'));
  if (state.myIndex === null) assert.deepEqual(state.hand, []);
  else assert.equal(state.hand.length, state.players[state.myIndex].handCount);
}
async function leave(client) {
  await client.page.evaluate(() => {
    const socket = window.__qaSockets.findLast(socket => socket.readyState === WebSocket.OPEN);
    if (socket) socket.send(JSON.stringify({ type: 'leave' }));
  }).catch(() => {});
  await delay(200);
}
async function leaveThroughUi(client) {
  await client.page.getByRole('button', { name: 'ロビーへ', exact: true }).first().click();
  const confirm = client.page.getByRole('button', { name: '投了して退室する', exact: true });
  await waitFor(async () => !client.page.url().includes('room=') || await confirm.isVisible(), 'leave confirmation or completion');
  if (await confirm.isVisible()) await confirm.click();
  await waitFor(() => !client.page.url().includes('room='), 'room leave completed');
  client.room = null;
}

try {
  const cpu = await makeClient('QA 花子');
  await screenshot(cpu, 'desktop-lobby');
  await checkOverflow(cpu, 'desktop lobby has no horizontal overflow');
  if (!process.env.QA_SKIP_CPU) {
  await cpu.page.getByRole('button', { name: /CPUと遊ぶ/ }).click();
  await waitFor(() => cpu.room?.phase === 'waiting', 'CPU room waiting');
  assert.equal(cpu.room.players.length, 2);
  assert.equal(cpu.room.players[1].isCpu, true);
  pass('CPU button creates a ready two-player room');
  await cpu.page.getByRole('button', { name: '対戦をはじめる' }).click();
  await waitFor(() => cpu.room?.round === 1, 'first CPU round');
  await screenshot(cpu, 'desktop-cpu-game');
  const completedRounds = [];
  const deadline = Date.now() + 360000;
  while (cpu.room?.phase !== 'finished' && Date.now() < deadline) {
    checkPrivacy(cpu);
    if (cpu.room.phase === 'round_end') {
      completedRounds.push({ round: cpu.room.round, points: cpu.room.roundPoints, winner: cpu.room.winner });
      await cpu.page.getByRole('button', { name: '次の局へ' }).click();
      await waitFor(() => cpu.room.phase !== 'round_end', 'next CPU round');
      await delay(420);
    } else if (cpu.room.turn === cpu.room.myIndex) await playMove(cpu);
    else await delay(150);
  }
  assert.equal(cpu.room?.phase, 'finished');
  assert.equal(cpu.room.round, 3);
  await cpu.page.locator('.result-panel').waitFor({ timeout: 20000 });
  completedRounds.push({ round: cpu.room.round, points: cpu.room.roundPoints, winner: cpu.room.winner });
  await screenshot(cpu, 'desktop-cpu-result');
  pass('CPU match completes all three rounds via browser card clicks', { rounds: completedRounds, commands: cpu.sent.length, scores: cpu.room.players.map(p => p.score) });
  const samples = await cpu.page.evaluate(() => window.__qaAnimationSamples);
  assert.ok(samples.some(sample => sample.stage === 'move-overlay move-stack' && sample.targets > 0 && sample.played === 1));
  assert.ok(samples.some(sample => sample.stage === 'move-overlay move-reveal'));
  assert.ok(samples.every(sample => sample.enabledHandButtons === 0 && sample.locked === 'true'), 'card controls are locked throughout the move animation');
  report.animations = samples;
  pass('public moves animate through reveal, travel, stacked capture and collection with controls locked', { stages: [...new Set(samples.map(sample => sample.stage))], selectionCases: report.selectionCases, drawnChoices: report.drawnChoices });
  await leaveThroughUi(cpu);
  } else report.cpuSkipped = true;

  const host = cpu;
  const peer = await makeClient('QA 太郎');
  const spectator = await makeClient('QA 観客');
  const roomName = `QA 鍵付き対局 ${Date.now()}`;
  await host.page.getByRole('button', { name: '対戦部屋をつくる' }).click();
  await host.page.getByLabel('部屋の名前').fill(roomName);
  await host.page.getByLabel('合言葉をつける').check();
  await host.page.getByLabel('合言葉', { exact: true }).fill('qa-secret-sakura');
  await host.page.getByRole('button', { name: 'この内容で卓をひらく' }).click();
  await waitFor(() => host.room?.phase === 'waiting' && host.room.name === roomName, 'password room created');
  const roomId = host.room.id;
  await peer.page.getByRole('button', { name: '部屋一覧を更新' }).click();
  const peerRow = peer.page.locator('.room-row').filter({ hasText: roomName });
  await peerRow.getByRole('button', { name: '入室', exact: false }).click();
  await peer.page.getByLabel('合言葉', { exact: true }).fill('wrong-password');
  const wrongResponse = peer.page.waitForResponse(response => response.url().includes(`/rooms/${roomId}/join`));
  await peer.page.getByRole('button', { name: '入室する', exact: true }).click();
  assert.equal((await wrongResponse).status(), 403);
  assert.equal(peer.room, null);
  await peer.page.getByRole('status').filter({ hasText: '合言葉' }).waitFor();
  pass('incorrect room password rejected with HTTP 403 and visible feedback');
  peer.expected403++;
  await peer.page.getByLabel('合言葉', { exact: true }).fill('qa-secret-sakura');
  await peer.page.getByRole('button', { name: '入室する', exact: true }).click();
  await waitFor(() => peer.room?.players.length === 2 && host.room.players.length === 2, 'peer joins correct password');
  await host.page.getByRole('button', { name: '対戦をはじめる' }).click();
  await waitFor(() => host.room?.round === 1 && peer.room?.round === 1, 'multiplayer begins');
  await host.page.locator('.your-hand button').first().waitFor();
  await peer.page.locator('.your-hand button').first().waitFor();
  await host.page.locator('.game-page[data-animating="false"]').waitFor();
  await peer.page.locator('.game-page[data-animating="false"]').waitFor();
  assert.equal(host.room.myIndex, 0);
  assert.equal(peer.room.myIndex, 1);
  checkPrivacy(host); checkPrivacy(peer);
  assert.ok(host.room.hand.every(id => !peer.room.hand.includes(id)));
  assert.equal(await host.page.locator('.your-hand button').count(), host.room.hand.length);
  assert.equal(await peer.page.locator('.your-hand button').count(), peer.room.hand.length);
  assert.equal(await host.page.locator('.opponent-hand .back').count(), peer.room.hand.length);
  pass('password room starts with isolated player hands and concealed opponent cards');

  await spectator.page.getByRole('button', { name: '部屋一覧を更新' }).click();
  await spectator.page.locator('.room-row').filter({ hasText: roomName }).getByRole('button', { name: /観戦/ }).click();
  await spectator.page.getByLabel('合言葉', { exact: true }).fill('qa-secret-sakura');
  await spectator.page.getByRole('button', { name: '入室する', exact: true }).click();
  await waitFor(() => spectator.room?.id === roomId, 'spectator joins');
  checkPrivacy(spectator);
  assert.equal(spectator.room.myIndex, null);
  assert.equal(await spectator.page.locator('.your-hand button').count(), 0);
  await spectator.page.locator('.spectator-note').waitFor();
  pass('spectator receives no hands and cannot play cards');

  // Exercise two human turns (including drawn-card target choice) through the real UI.
  const initialTurn = host.room.turn;
  let transitions = 0;
  let lastTurn = initialTurn;
  for (let action = 0; action < 8 && transitions < 2; action++) {
    const active = host.room.turn === host.room.myIndex ? host : peer;
    if (active.room.phase === 'round_end' || active.room.phase === 'finished') break;
    await playMove(active);
    await waitFor(() => JSON.stringify(host.room.field) === JSON.stringify(peer.room.field) && JSON.stringify(peer.room.field) === JSON.stringify(spectator.room.field), 'field broadcasts synchronized');
    if (host.room.turn !== lastTurn) { transitions++; lastTurn = host.room.turn; }
  }
  pass('legal multiplayer card moves synchronize across both players and spectator', { turnTransitions: transitions });
  const commandsBeforeReference = host.sent.length;
  await host.page.getByRole('button', { name: /遊びかた/ }).click();
  await host.page.getByRole('heading', { name: 'めくる、集める、こいこい。' }).waitFor();
  assert.ok(host.page.url().includes(`room=${roomId}`));
  await host.page.getByRole('button', { name: '設定', exact: true }).click();
  await host.page.getByRole('heading', { name: 'お好みの、ひとときに。' }).waitFor();
  await host.page.getByRole('button', { name: /対戦に戻る/ }).click();
  await host.page.locator('.enhanced-game').waitFor();
  assert.equal(host.sent.length, commandsBeforeReference);
  assert.equal(host.room.status, 'playing');
  pass('guide and settings preserve the current match and return without forfeit');
  await host.page.getByRole('button', { name: '会話', exact: true }).click();
  await peer.page.getByRole('button', { name: '会話', exact: true }).click();
  await host.page.getByLabel('チャットメッセージ').fill('よろしくお願いします！ <script>not-html</script>');
  await host.page.getByRole('button', { name: '送信', exact: true }).click();
  await peer.page.getByText('よろしくお願いします！ <script>not-html</script>', { exact: true }).waitFor();
  assert.ok(spectator.room.messages.some(m => m.text.includes('<script>')));
  const reactions = peer.page.getByRole('button', { name: /^リアクション / });
  for (let index = 0; index < await reactions.count(); index++) {
    const emoji = (await reactions.nth(index).getAttribute('aria-label')).replace('リアクション ', '');
    await reactions.nth(index).click();
    await waitFor(() => host.room.messages.some(m => m.name === 'QA 太郎' && m.text === emoji), `emote ${emoji} broadcast`);
    await delay(420);
  }
  pass('chat and emoji broadcast, HTML-like text is rendered as text');

  const handBefore = [...peer.room.hand];
  const socketCount = peer.socketCount;
  await peer.page.evaluate(() => window.__qaSockets.findLast(socket => socket.readyState === WebSocket.OPEN).close());
  await waitFor(() => host.room.players[1].connected === false, 'peer disconnected');
  await waitFor(() => peer.socketCount > socketCount && host.room.players[1].connected === true, 'automatic websocket reconnection', 15000);
  assert.deepEqual(peer.room.hand, handBefore);
  await peer.page.getByText('リアルタイム接続中', { exact: true }).waitFor();
  pass('websocket reconnect preserves seat, hand and current state');
  await screenshot(host, 'desktop-multiplayer-chat');
  await screenshot(spectator, 'desktop-spectator');

  await peer.page.setViewportSize({ width: 390, height: 844 });
  await checkOverflow(peer, 'mobile game has no horizontal overflow');
  await screenshot(peer, 'mobile-game');
  await peer.page.evaluate(() => window.__qaSockets.findLast(socket => socket.readyState === WebSocket.OPEN).close());
  const leaveResponse = peer.page.waitForResponse(response => response.url().includes(`/rooms/${roomId}/leave`));
  await leaveThroughUi(peer);
  assert.equal((await leaveResponse).status(), 200);
  await waitFor(() => host.room.status === 'finished', 'offline transport resignation received by server');
  pass('explicit resignation succeeds over HTTP while the websocket reconnects');
  await peer.page.getByRole('button', { name: /CPUと遊ぶ/ }).waitFor();
  await checkOverflow(peer, 'mobile lobby has no horizontal overflow');
  await screenshot(peer, 'mobile-lobby');
  await peer.page.getByRole('button', { name: /札の図鑑/ }).click();
  await checkOverflow(peer, 'mobile card collection has no horizontal overflow');
  assert.equal(await peer.page.locator('.collection-grid .hana-card').count(), 48);
  pass('card collection presents all 48 cards');

  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.websocketErrors, []);
  const unexpected = report.consoleErrors.filter(error => !error.text.includes('403 (Forbidden)'));
  assert.deepEqual(unexpected, []);
  pass('no uncaught JavaScript, unexpected console or websocket errors', { expected403: 1, renderer: await host.page.locator('.render-tag').innerText() });
} catch (error) {
  report.failed = error.stack;
  report.clientCommands = clients.map(client => ({ name: client.name, sent: client.sent }));
  console.error(error);
  for (const client of clients) await screenshot(client, `failure-${client.name.replaceAll(/[^a-zA-Z0-9]/g, '')}-${clients.indexOf(client)}`).catch(() => {});
  process.exitCode = 1;
} finally {
  for (const client of clients) await leave(client);
  report.finishedAt = new Date().toISOString();
  await writeFile(`${output}/browser-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
