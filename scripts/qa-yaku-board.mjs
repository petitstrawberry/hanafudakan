/** LOCAL supplemental UI regression for each player's four captured-card piles. HTTP/WebSocket
 * fixtures are synthetic; this is not Rust gameplay or public deployment E2E. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://localhost:5173';
const output = resolve('artifacts/qa');
await mkdir(output, { recursive: true });
const popoverOnly = process.env.QA_YAKU_POPOVER_ONLY === '1';
const report = popoverOnly ? JSON.parse(await readFile(`${output}/yaku-report.json`, 'utf8')) : { evidence: 'LOCAL supplemental mocked HTTP/WebSocket RoomView four-pile captured-card/role tests; no public host, real backend rooms, or hidden-card inference.', base, startedAt: new Date().toISOString(), tests: [], pageErrors: [], unexpectedRequests: [], screenshots: [] };
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
const session = { token: 'yaku-fixture-token', playerId: 'yaku-self', name: '役検証 花子' };
const roomFixture = () => ({
  id: 'yaku-board-fixture', name: '双方の役の見通し', hostId: session.playerId, mode: 'pvp', rounds: 3, round: 1, status: 'playing',
  players: [{ id: session.playerId, name: session.name, score: 0, handCount: 6, captured: [20, 24, 32, 1, 5, 0, 2], connected: true, isCpu: false }, { id: 'yaku-other', name: '役検証 太郎', score: 0, handCount: 6, captured: [36, 40, 13, 6], connected: true, isCpu: false }],
  myIndex: 0, hand: [4, 12, 16, 41, 44, 45], field: [8, 28, 9, 21, 33, 37, 3, 7], deckCount: 17, turn: 0, phase: 'play', drawnCard: null,
  yaku: [[], []], koikoi: [0, 0], winner: null, matchWinner: null, roundPoints: 0, messages: [], log: ['役ボード専用の合成局面'], legalTargets: [], spectators: 0, dealer: 0, events: [],
});
async function setup(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(session => {
    localStorage.setItem('hanafudakan-session', JSON.stringify(session));
    localStorage.setItem('hana-assist', 'true');
    localStorage.setItem('hana-sound', 'false');
    localStorage.setItem('hana-motion', 'false');
  }, session);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const client = { context, page, room: roomFixture(), socket: null, commands: [] };
  page.on('pageerror', error => report.pageErrors.push({ viewport, error: error.stack }));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === '/api/rooms') body = { rooms: [{ id: client.room.id, name: client.room.name, mode: 'pvp', rounds: 3, players: 1, spectators: 0, locked: false, status: 'playing', hostName: session.name }] };
    else if (path === '/api/me' || path === '/api/session') body = session;
    else if (path === `/api/rooms/${client.room.id}/join`) body = { roomId: client.room.id };
    else { report.unexpectedRequests.push(path); body = { error: 'Unexpected yaku fixture request' }; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.routeWebSocket('**/api/ws?*', socket => {
    client.socket = socket;
    socket.onMessage(message => client.commands.push(JSON.parse(String(message))));
    socket.send(JSON.stringify({ type: 'state', room: client.room }));
  });
  await page.goto(`${base}/?room=${client.room.id}`);
  await page.locator('.captured-yaku-role').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  return client;
}
const role = (page, player, id) => page.locator(`.captured-yaku[data-role-player="${player}"] [data-yaku-id="${id}"]`);
async function snapshot(page) {
  return page.locator('.captured-yaku-role').evaluateAll(elements => elements.map(element => ({ player: element.closest('[data-role-player]').dataset.rolePlayer, id: element.dataset.yakuId, state: element.dataset.yakuState, text: element.textContent, label: element.getAttribute('aria-label'), near: element.classList.contains('is-near') })).sort((a, b) => `${a.player}:${a.id}`.localeCompare(`${b.player}:${b.id}`)));
}
async function update(client, room) {
  client.room = room;
  client.socket.send(JSON.stringify({ type: 'state', room }));
  await client.page.waitForTimeout(180);
  await client.page.locator('.game-page[data-animating="false"]').waitFor();
}
async function verifyState(page, player, id, state, near = false) {
  const button = role(page, player, id);
  assert.equal(await button.getAttribute('data-yaku-state'), state, `player ${player} ${id}`);
  const style = await button.evaluate(element => ({ near: element.classList.contains('is-near'), decoration: getComputedStyle(element.querySelector('.captured-yaku-role-name')).textDecorationLine }));
  assert.equal(style.near, near);
  assert.equal(style.decoration.includes('line-through'), state === 'impossible' || state === 'upgraded');
}
async function screenshot(page, name) {
  await page.screenshot({ path: `${output}/${name}`, fullPage: true });
  report.screenshots.push(name);
}
async function verifyLayout(page, label, own = 0) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth, wide: matchMedia('(min-width: 700px) and (min-aspect-ratio: 6/5)').matches }));
  assert.ok(size.scroll <= size.viewport + 1, `${label} horizontal overflow: ${JSON.stringify(size)}`);
  const panels = await page.locator('.captured-yaku').evaluateAll(elements => elements.map(el => { const b = el.getBoundingClientRect(); return { player: Number(el.dataset.capturePlayer), x: b.x, y: b.y, width: b.width, height: b.height, roleCount: el.querySelectorAll('.captured-yaku-role').length }; }));
  assert.equal(panels.length, 2);
  assert.deepEqual(panels.map(panel => panel.roleCount), [12, 12]);
  const field = await page.locator('.field-cards').boundingBox();
  const ownPanel = panels.find(panel => panel.player === own);
  const otherPanel = panels.find(panel => panel.player !== own);
  if (size.wide) {
    assert.ok(otherPanel.x + otherPanel.width <= field.x + 1, 'wide layout places opponent physical captured piles left of the field');
    assert.ok(ownPanel.x >= field.x + field.width - 1, 'wide layout places own physical captured piles right of the field');
  } else {
    assert.ok(otherPanel.y + otherPanel.height <= field.y + 1, 'portrait layout places opponent physical captured piles above the field');
    assert.ok(ownPanel.y >= field.y + field.height - 1, 'portrait layout places own physical captured piles below the field');
  }
  const clippedLabels = await page.locator('.captured-yaku-role').evaluateAll(elements => elements.filter(element => {
    const button = element.getBoundingClientRect();
    const name = element.querySelector('.captured-yaku-role-name').getBoundingClientRect();
    const mark = element.querySelector('.captured-yaku-role-mark')?.getBoundingClientRect();
    return name.left < button.left - 1 || name.right > button.right + 1 || (mark && (mark.left < button.left - 1 || mark.right > button.right + 1));
  }).map(element => element.getAttribute('aria-label')));
  assert.deepEqual(clippedLabels, [], 'all role labels and near/complete marks must fit inside their group');
  report.tests.push({ name: label, status: 'passed', size, panels });
}
async function verifyCapturedPiles(page, room, label) {
  const expectedKind = id => [0, 8, 28, 40, 44].includes(id) ? 'bright' : [4, 12, 16, 20, 24, 29, 32, 36, 41].includes(id) ? 'animal' : [1, 5, 9, 13, 17, 21, 25, 33, 37, 42].includes(id) ? 'ribbon' : 'chaff';
  const partitions = [];
  for (let player = 0; player < 2; player++) {
    const panel = page.locator(`.captured-yaku[data-capture-player="${player}"]`);
    assert.equal(await panel.count(), 1);
    const groups = await panel.locator('[data-capture-kind]').evaluateAll(elements => elements.map(element => ({ kind: element.dataset.captureKind, label: element.querySelector('h3').textContent, ids: [...element.querySelectorAll('[data-captured-card-id]')].map(card => Number(card.dataset.capturedCardId)), roleIds: [...element.querySelectorAll('[data-yaku-id]')].map(role => role.dataset.yakuId), pileBottom: element.querySelector('.captured-yaku-scroll').getBoundingClientRect().bottom, rolesTop: element.querySelector('.captured-yaku-roles').getBoundingClientRect().top })));
    assert.deepEqual(groups.map(group => group.kind), ['bright', 'animal', 'ribbon', 'chaff']);
    assert.deepEqual(groups.map(group => group.label), ['光', 'たね', '短冊', 'かす']);
    const ids = groups.flatMap(group => group.ids);
    assert.deepEqual([...ids].sort((a, b) => a - b), [...room.players[player].captured].sort((a, b) => a - b));
    assert.equal(new Set(ids).size, ids.length, 'every physical captured card appears exactly once');
    assert.equal(new Set(groups.flatMap(group => group.roleIds)).size, 12);
    for (const group of groups) {
      assert.ok(group.ids.every(id => expectedKind(id) === group.kind));
      assert.ok(group.rolesTop >= group.pileBottom - 1, 'role labels appear beneath the physical pile');
    }
    if (ids.includes(32)) {
      assert.ok(groups.find(group => group.kind === 'animal').ids.includes(32));
      assert.ok(!groups.find(group => group.kind === 'chaff').ids.includes(32));
    }
    partitions.push({ player, groups });
  }
  report.tests.push({ name: label, status: 'passed', partitions });
}
try {
  if (!popoverOnly) {
  const client = await setup({ width: 1440, height: 1000 });
  const { page } = client;
  assert.equal(await page.locator('.captured-yaku-role').count(), 24);
  await verifyCapturedPiles(page, client.room, 'both players have four physical captured-card piles, unique cards and 12 roles below');
  assert.match(await role(page, 0, 'kasu').getAttribute('aria-label'), /あと8枚/, 'sake contributes to chaff scoring without physical duplication');
  // Splitting a required trio between players makes it impossible for both.
  await verifyState(page, 0, 'inoshikacho', 'impossible');
  await verifyState(page, 1, 'inoshikacho', 'impossible');
  await verifyState(page, 0, 'akatan', 'possible', true);
  for (const id of ['hanami', 'tsukimi']) {
    await verifyState(page, 0, id, 'possible', true);
    await verifyState(page, 1, id, 'impossible');
  }
  await role(page, 0, 'inoshikacho').click();
  assert.match(await page.locator('.role-detail').innerText(), /相手が獲得済み/);
  assert.equal(await page.locator('.role-detail .role-card-blocked img[src="/cards/36.svg"]').count(), 1);
  await page.getByRole('button', { name: '役の詳細を閉じる' }).click();
  await role(page, 0, 'hanami').click();
  assert.match(await page.locator('.role-detail').innerText(), /あと1枚/);
  assert.equal(await page.locator('.role-detail .role-card-in-field img[src="/cards/8.svg"]').count(), 1);
  report.tests.push({ name: '24 per-player roles, blocked trio, one-sided cup blocking, near-one highlights and explanatory details', status: 'passed' });

  const complete = structuredClone(client.room);
  complete.players[0].captured.push(9);
  complete.field = complete.field.filter(id => id !== 9);
  complete.yaku[0] = [{ name: '赤短', points: 5 }];
  await update(client, complete);
  await verifyState(page, 0, 'akatan', 'complete');
  assert.match(await role(page, 0, 'akatan').getAttribute('aria-label'), /成立/);
  await page.getByRole('button', { name: '役の詳細を閉じる' }).click();
  await role(page, 0, 'akatan').click();
  assert.match(await page.locator('.role-detail').innerText(), /成立済み/);
  assert.equal(await page.locator('.role-detail-cards').count(), 0);
  await page.getByRole('button', { name: '役の詳細を閉じる' }).click();
  await verifyLayout(page, 'desktop 1440px captured-card placement follows viewport aspect ratio');
  await verifyCapturedPiles(page, complete, 'incoming capture adds exactly one card to its physical ribbon pile');
  await screenshot(page, 'yaku-desktop-board.png');
  report.tests.push({ name: 'Incoming public captures and server earned yaku update completed role', status: 'passed' });

  const publicRoles = await snapshot(page);
  await update(client, { ...client.room, hand: [10, 11, 14, 15, 18, 19] });
  assert.deepEqual(await snapshot(page), publicRoles, 'private hand changes must not affect public role reachability');
  await role(page, 0, 'hanami').click();
  await page.getByRole('switch', { name: '対局アシスト' }).click();
  assert.equal(await page.locator('.captured-yaku-role').count(), 24);
  assert.equal(await page.locator('.captured-yaku-role:disabled').count(), 24);
  assert.equal(await page.locator('.role-detail').count(), 0);
  assert.deepEqual(await snapshot(page), publicRoles);
  await page.getByRole('switch', { name: '対局アシスト' }).click();
  await update(client, { ...client.room, myIndex: 1, hand: [10, 11, 14, 15, 18, 19] });
  assert.equal(await page.locator('.captured-yaku-self').getAttribute('data-capture-player'), '1');
  await verifyLayout(page, 'seat 1 physical piles swap around the field', 1);
  assert.deepEqual(await snapshot(page), publicRoles);
  await update(client, { ...client.room, myIndex: null, hand: [], spectators: 1 });
  assert.equal(await page.locator('.your-hand button').count(), 0);
  assert.equal(await page.locator('.captured-yaku-self').count(), 0);
  await verifyCapturedPiles(page, client.room, 'spectator sees only the same public physical captured cards');
  assert.deepEqual(await snapshot(page), publicRoles);
  report.tests.push({ name: 'Assist OFF preserves 24 disabled roles; seat 1 and spectator preserve public-only per-player statuses', status: 'passed' });
  assert.equal(client.commands.length, 0, 'role inspection must never issue game commands');
  await client.context.close();

  const mobile = await setup({ width: 390, height: 844 });
  await update(mobile, complete);
  await verifyLayout(mobile.page, 'mobile 390px four piles fit without document overflow');
  await verifyCapturedPiles(mobile.page, complete, 'mobile 390px physical card grouping and uniqueness');
  await role(mobile.page, 0, 'inoshikacho').click();
  await verifyLayout(mobile.page, 'mobile 390px open impossible-role detail');
  await screenshot(mobile.page, 'yaku-mobile-board-detail.png');
  await mobile.page.getByRole('button', { name: '役の詳細を閉じる' }).click();
  const ordinaryChaff = Array.from({ length: 48 }, (_, id) => id).filter(id => ![0, 8, 28, 40, 44, 4, 12, 16, 20, 24, 29, 32, 36, 41, 1, 5, 9, 13, 17, 21, 25, 33, 37, 42].includes(id));
  assert.equal(ordinaryChaff.length, 24);
  const crowded = roomFixture();
  crowded.players[0] = { ...crowded.players[0], captured: [...ordinaryChaff, 32], handCount: 1 };
  crowded.players[1] = { ...crowded.players[1], captured: [0, 4, 1], handCount: 2 };
  crowded.hand = [16];
  crowded.field = [8, 9, 12, 13, 21, 24];
  crowded.deckCount = 11;
  crowded.yaku = [[{ name: 'カス', points: 16 }], []];
  await update(mobile, crowded);
  await verifyCapturedPiles(mobile.page, crowded, '24 ordinary chaff remain physically present; sake remains animal only');
  await verifyLayout(mobile.page, 'mobile 390px maximum chaff pile does not overflow document');
  const scroller = mobile.page.locator('[data-capture-player="0"] [data-capture-kind="chaff"] .captured-yaku-scroll');
  const initialScroll = await scroller.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
  assert.ok(initialScroll.scrollWidth > initialScroll.width, 'large chaff pile should use its own local scrolling');
  const lastCard = mobile.page.locator('[data-capture-player="0"] [data-capture-kind="chaff"] [data-captured-card-id="47"]');
  await lastCard.focus();
  const finalScroll = await scroller.evaluate(element => ({ left: element.scrollLeft, x: element.getBoundingClientRect().x, right: element.getBoundingClientRect().right }));
  const lastBox = await lastCard.boundingBox();
  assert.ok(finalScroll.left > 0);
  assert.ok(lastBox.x >= finalScroll.x - 1 && lastBox.x + lastBox.width <= finalScroll.right + 1, 'keyboard focus exposes the final card inside the pile');
  await screenshot(mobile.page, 'yaku-mobile-24-chaff.png');
  report.tests.push({ name: 'maximum chaff pile scrolls locally and keyboard focus reveals last physical card', status: 'passed', initialScroll, finalScroll, lastBox });
  assert.equal(mobile.commands.length, 0);
  await mobile.context.close();
  }
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1214, height: 900 }, { width: 390, height: 844 }]) {
    const client = await setup(viewport);
    const { page } = client;
    await role(page, 0, 'goko').click();
    // Read the opening geometry directly; never scroll the popup into view.
    const geometry = await page.locator('.role-detail').evaluate(element => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, viewportWidth: innerWidth, viewportHeight: innerHeight, position: getComputedStyle(element).position }; });
    assert.equal(geometry.position, 'fixed');
    assert.ok(geometry.x >= 0 && geometry.y >= 0 && geometry.x + geometry.width <= geometry.viewportWidth + 1 && geometry.y + geometry.height <= geometry.viewportHeight + 1, `detail is outside viewport: ${JSON.stringify(geometry)}`);
    assert.equal(await page.locator('.modal-shade').count(), 0, 'role detail is nonmodal with no backdrop');
    const name = `yaku-top-role-popover-${viewport.width}.png`;
    await page.screenshot({ path: `${output}/${name}`, fullPage: false });
    report.screenshots.push(name);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.role-detail').count(), 0);
    await role(page, 0, 'goko').click();
    await page.getByRole('button', { name: '役の詳細を閉じる' }).click();
    assert.equal(await page.locator('.role-detail').count(), 0);
    assert.equal(client.commands.length, 0);
    report.tests.push({ name: `top role detail immediately visible; Escape and X close at ${viewport.width}px`, status: 'passed', geometry });
    await client.context.close();
  }
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.unexpectedRequests, []);
  report.status = 'passed';
  console.log(JSON.stringify({ status: report.status, tests: report.tests.map(test => test.name), screenshots: report.screenshots }));
} catch (error) {
  report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error);
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${output}/yaku-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
