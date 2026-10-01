/** Invoked by the ignored Rust browser_hyper_live_e2e test. The arrangements
 * are test-only; HTTP, WebSocket commands, snapshots and UI are real. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixtures = JSON.parse(process.env.QA_LIVE_FIXTURES);
const base = process.env.QA_BASE_URL;
const output = 'artifacts/issue-9';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
const report = { evidence: 'Test-only arrangements, actual Rust HTTP/WebSocket and built App/GameRoom; no response mocks.', cases: [], pageErrors: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const end = Date.now() + 16000;
  while (Date.now() < end) { if (await predicate()) return; await wait(50); }
  throw Error(`Timeout: ${label}`);
}
async function open(fixture, seat) {
  const context = await browser.newContext({ viewport: ['mutual', 'engines'].includes(fixture.kind) ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(session => {
    localStorage.setItem('hanafudakan-session', JSON.stringify(session));
    localStorage.setItem('hana-sound', 'false');
    localStorage.setItem('hana-music', 'false');
    localStorage.setItem('hana-motion', 'false');
    const NativeSocket = window.WebSocket;
    window.__qaSockets = [];
    window.__qaCelebrations = [];
    new MutationObserver(() => {
      const text = document.querySelector('.yaku-celebration span')?.textContent;
      if (text && window.__qaCelebrations.at(-1) !== text) window.__qaCelebrations.push(text);
    }).observe(document, { childList: true, subtree: true });
    window.WebSocket = class extends NativeSocket {
      constructor(...args) { super(...args); window.__qaSockets.push(this); }
    };
  }, fixture.sessions[seat]);
  const page = await context.newPage();
  page.setDefaultTimeout(16000);
  const client = { context, page, room: null, errors: [], version: 0, socketCount: 0 };
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('websocket', socket => {
    client.socketCount++;
    socket.on('framereceived', event => {
      const message = JSON.parse(String(event.payload));
      if (message.type === 'state') { client.room = message.room; client.version++; }
      if (message.type === 'error') client.errors.push(message.message);
    });
  });
  await page.goto(`${base}/?room=${fixture.roomId}`);
  await until(() => client.room?.phase === 'play', 'initial live snapshot');
  await idle(client);
  return client;
}
async function idle(client) {
  await client.page.locator('.game-page[data-animating="false"]').waitFor();
  await until(async () => await client.page.locator('.hp-attack-overlay').count() === 0, 'attack finished');
}
async function send(client, command) {
  await client.page.evaluate(command => window.__qaSockets.findLast(s => s.readyState === WebSocket.OPEN).send(JSON.stringify(command)), command);
}
async function capture(client, card, target) {
  await idle(client);
  await client.page.locator(`.your-hand .hana-card[data-card-id="${card}"]`).click();
  if (target !== null) await client.page.locator(`.field-slot .hana-card[data-card-id="${target}"]`).click();
}
try {
  for (const fixture of fixtures) {
    const owner = await open(fixture, 0);
    const attacker = await open(fixture, 1);
    if (fixture.kind === 'engines') {
      const stock = owner.room.deckCount;
      assert.deepEqual(owner.room.hyper.contracts[0].map(c => c.points), [3, 3, 3]);
      await capture(owner, 4, null);
      await until(() => owner.room.turn === 1, 'engine turn resolved');
      await idle(owner);
      assert.deepEqual(owner.room.hyper.bloom, [7, 2]);
      assert.equal(owner.room.hyper.chain[0], 5);
      assert.ok((await owner.page.evaluate(() => window.__qaCelebrations)).some(text => text.startsWith("5 CHAIN")), "skipped CHAIN milestone is celebrated");
      assert.equal(owner.room.deckCount, stock - 3); // starter + one bounded CHAIN draw; no category draw
      assert.match(owner.room.log.join('\n'), /追猟.*奪取/);
      assert.match(owner.room.log.join('\n'), /草蔵/);
      assert.match(owner.room.log.join('\n'), /連筆.*＋3/);
      await owner.page.getByText('契約の発動', { exact: true }).click();
      assert.match(await owner.page.locator('.contract-history').innerText(), /追猟.*3を奪取/);
      assert.match(await owner.page.locator('.contract-history').innerText(), /連筆.*＋3/);
      const ownStatus = await owner.page.locator('[data-player-index="0"] .player-hyper-status').boundingBox();
      const mobileNav = await owner.page.locator('.sidebar').boundingBox();
      assert.ok(ownStatus.y + ownStatus.height <= mobileNav.y, 'own contract stats obscured by mobile menu');
      const overflow = await owner.page.evaluate(() => ({ x: Math.max(0, document.documentElement.scrollWidth - innerWidth), y: Math.max(0, document.documentElement.scrollHeight - innerHeight) }));
      assert.deepEqual(overflow, { x: 0, y: 0 });
      await owner.page.screenshot({ path: `${output}/live-engines-history.png` });
      report.cases.push({ kind: fixture.kind, bloom: owner.room.hyper.bloom, chain: 5, extraDraws: 2, scaledDescriptions: owner.room.hyper.contracts[0].map(c => c.description) });
    } else {
      await owner.page.getByRole('button', { name: '罠を指定', exact: true }).click();
      await owner.page.getByRole('button', { name: '罠を取消', exact: true }).click();
      assert.deepEqual(owner.room.hyper.traps, [null, null]);
      const revision = owner.room.boardRevision;
      await owner.page.getByRole('button', { name: '罠を指定', exact: true }).click();
      await owner.page.locator('.field-slot .hana-card[data-card-id="9"]').click();
      await until(() => attacker.room.hyper.traps[0] === 9, 'public trap broadcast');
      assert.equal(owner.room.turn, 0);
      assert.equal(owner.room.boardRevision, revision);
      assert.equal(await owner.page.getByRole('button', { name: '罠を指定', exact: true }).count(), 0);
      await send(owner, { type: 'trap', targetId: 13, boardRevision: revision });
      await until(() => owner.errors.length === 1, 'duplicate placement rejected');
      assert.deepEqual(owner.room.hyper.traps, [9, null]);
      await owner.page.reload();
      await until(() => owner.socketCount >= 2 && owner.room.hyper.traps[0] === 9, 'reconnected trap');
      await idle(owner);
      assert.equal(owner.room.hyper.trapReady[0], false);
      assert.deepEqual(attacker.room.hyper.damagePreviews, []);
      await capture(owner, 16, null);
      await until(() => attacker.room.turn === 1, 'opponent turn');
      await idle(attacker);
      if (fixture.kind === 'draw_choice') {
        await capture(attacker, 4, null);
        await until(() => attacker.room.phase === 'draw_choice', 'public drawn card choice');
        await idle(attacker);
        assert.equal(attacker.room.drawnCard, 8);
        assert.deepEqual(attacker.room.legalTargets, [9, 10]);
      }
      const forecast = attacker.room.hyper.damagePreviews.find(p => p.cardId === 8 && p.targetId === 9).damage;
      assert.equal(forecast.length, 2);
      assert.equal(forecast[0].roles, 5);
      if (fixture.kind !== 'draw_choice') await attacker.page.locator('.your-hand .hana-card[data-card-id="8"]').click();
      await attacker.page.getByText('攻撃内訳', { exact: true }).click();
      const breakdown = await attacker.page.locator('.combat-preview').innerText();
      assert.match(breakdown, /役5/);
      assert.match(breakdown, /罠4/);
      await attacker.page.screenshot({ path: `${output}/live-${fixture.kind}-forecast.png` });
      const seq = Math.max(0, ...attacker.room.events.map(e => e.id));
      await attacker.page.locator('.field-slot .hana-card[data-card-id="9"]').click();
      await until(() => attacker.room.events.some(e => e.id > seq && e.cardId === 8 && e.captured), 'real capture');
      const actual = attacker.room.events.find(e => e.id > seq && e.cardId === 8 && e.captured).hyper.damage;
      assert.deepEqual(actual, forecast);
      const expected = { capture: [25, 28], draw_choice: [25, 28], shield: [23, 30], exposure: [20, 27], mutual: [0, 0], attacker_ko: [25, 0] }[fixture.kind];
      assert.deepEqual(attacker.room.hyper.hp, expected);
      await until(() => owner.room.hyper.hp.every((hp, i) => hp === expected[i]), 'both clients agree');
      if (fixture.kind === 'mutual') { assert.equal(attacker.room.winner, null); assert.equal(attacker.room.roundPoints, 0); }
      if (fixture.kind === 'attacker_ko') assert.equal(attacker.room.winner, 0);
      if (fixture.kind === 'mutual' || fixture.kind === 'attacker_ko') {
        assert.equal(attacker.room.phase, 'finished');
        assert.equal(attacker.room.events.at(-1).cardId, 8); // no draw after either K.O.
      }
      await idle(attacker);
      await until(async () => JSON.stringify(await attacker.page.locator('.hyper-hp meter').evaluateAll(ms => ms.map(m => m.value).sort((a,b) => a-b))) === JSON.stringify([...expected].sort((a,b) => a-b)), 'visible HP');
      for (const [seat, name] of ['罠の契約者', '攻撃する人'].entries()) {
        const meter = attacker.page.getByRole('meter', { name: `${name}のHP`, exact: true });
        assert.equal(await meter.evaluate(m => m.value), expected[seat]);
        if (fixture.kind === 'mutual') {
          const rect = await meter.boundingBox();
          const nav = await attacker.page.locator('.sidebar').boundingBox();
          assert.ok(rect.y + rect.height <= nav.y, `${name} HP obscured by mobile menu`);
        }
      }
      await attacker.page.screenshot({ path: `${output}/live-${fixture.kind}-result.png` });
      await attacker.page.reload();
      await until(() => attacker.socketCount >= 2 && attacker.room.hyper.hp.every((hp, i) => hp === expected[i]), 'result reconnect');
      report.cases.push({ kind: fixture.kind, cancel: true, broadcast: true, duplicateRejected: true, reconnect: true, forecastEqualsActual: true, hp: expected, damage: actual });
    }
    await owner.context.close(); await attacker.context.close();
  }
  assert.deepEqual(report.pageErrors, []);
} finally {
  await writeFile(`${output}/browser-live.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
