/** LOCAL deterministic capture layout QA. HTTP/WS RoomViews are synthetic;
 * this checks responsive UI geometry, not Rust gameplay or deployed services. */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://localhost:5173';
const output = resolve('artifacts/qa');
await mkdir(output, { recursive: true });
const report = { evidence: 'LOCAL synthetic HTTP/WebSocket fixtures; 24 unique captured cards, all 8 physical piles populated, cup 32 only in animal pile. No live backend room or public host.', base, startedAt: new Date().toISOString(), tests: [], pageErrors: [], unexpectedRequests: [] };
if (process.env.QA_LAYOUT_SIZES) {
  try { report.tests = JSON.parse(await readFile(`${output}/layout-report.json`, 'utf8')).tests.filter(test => !process.env.QA_LAYOUT_SIZES.split(',').includes(test.name)); } catch {}
}
const session = { token: 'layout-fixture-token', playerId: 'layout-self', name: '配置検証 花子' };
const fixture = () => ({
  id: 'capture-layout-fixture', name: '獲得札と役の配置検証', hostId: session.playerId, mode: 'pvp', rounds: 3, round: 1, status: 'playing',
  players: [{ id: session.playerId, name: session.name, score: 0, handCount: 4, captured: [0, 8, 4, 12, 32, 1, 5, 9, 2, 3, 6, 7], connected: true, isCpu: false }, { id: 'layout-other', name: '配置検証 太郎', score: 0, handCount: 4, captured: [28, 40, 20, 24, 36, 13, 17, 21, 10, 11, 14, 15], connected: true, isCpu: false }],
  myIndex: 0, hand: [41, 42, 44, 45], field: [16, 25, 29, 33, 18, 19, 22, 23], deckCount: 8, turn: 0, phase: 'play', drawnCard: null,
  yaku: [[{ name: '赤短', points: 5 }, { name: '花見で一杯', points: 5 }], [{ name: '猪鹿蝶', points: 5 }]], koikoi: [0, 0], winner: null, matchWinner: null, roundPoints: 0,
  messages: [], log: ['配置確認の合成局面'], legalTargets: [], spectators: 0, dealer: 0, events: [],
});
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
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
  const client = { context, page, room: fixture(), socket: null, commands: [] };
  page.on('pageerror', error => report.pageErrors.push({ viewport, error: error.stack }));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === '/api/rooms') body = { rooms: [{ id: client.room.id, name: client.room.name, mode: 'pvp', rounds: 3, players: 1, spectators: 0, locked: false, status: 'playing', hostName: session.name }] };
    else if (path === '/api/me' || path === '/api/session') body = session;
    else if (path === `/api/rooms/${client.room.id}/join`) body = { roomId: client.room.id };
    else { report.unexpectedRequests.push(path); body = { error: 'Unexpected layout fixture HTTP request' }; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.routeWebSocket('**/api/ws?*', socket => {
    client.socket = socket;
    socket.onMessage(message => client.commands.push(JSON.parse(String(message))));
    socket.send(JSON.stringify({ type: 'state', room: client.room }));
  });
  await page.goto(`${base}/?room=${client.room.id}`);
  await page.locator('.game-page[data-animating="false"]').waitFor();
  await page.locator('.captured-yaku-role').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  return client;
}
const intersects = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
async function geometry(page) {
  return page.evaluate(() => {
    const rect = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
    const one = selector => rect(document.querySelector(selector));
    const all = selector => [...document.querySelectorAll(selector)].map(el => ({ ...rect(el), id: el.dataset.cardId || el.dataset.capturedCardId }));
    return {
      viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      table: one('.game-table'), middle: one('.table-middle'), field: one('.field-cards'), hand: one('.your-hand'),
      playerBars: { own: one('.own-player'), opponent: one('.opponent-player') },
      fieldCards: all('.field-cards .hana-card'), handCards: all('.your-hand .hana-card'),
      panels: [...document.querySelectorAll('.capture-zone')].map(zone => {
        const panel = zone.querySelector('.captured-yaku');
        return { ...rect(zone), own: zone.classList.contains('capture-zone-own'), player: Number(panel.dataset.capturePlayer),
          groups: [...panel.querySelectorAll('.captured-yaku-group')].map(group => ({ ...rect(group), kind: group.dataset.captureKind, cards: [...group.querySelectorAll('[data-captured-card-id]')].map(el => Number(el.dataset.capturedCardId)), pile: rect(group.querySelector('.captured-yaku-scroll')), roles: rect(group.querySelector('.captured-yaku-roles')) })),
          labels: [...panel.querySelectorAll('h3, .captured-yaku-role')].map(el => {
            const group = el.closest('.captured-yaku-group');
            return { ...rect(el), group: rect(group), text: el.textContent, fontSize: getComputedStyle(el).fontSize, type: el.tagName === 'H3' ? 'group' : 'role',
              contents: [...el.querySelectorAll('.captured-yaku-role-name, .captured-yaku-role-mark')].map(child => ({ ...rect(child), text: child.textContent })) };
          }) };
      }),
    };
  });
}
async function verify(client, viewport, suffix = '') {
  const { page } = client;
  await page.evaluate(() => scrollTo(0, 0));
  const data = await geometry(page);
  const failures = [], warnings = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const chatInitiallyClosed = await page.locator('.game-conversation').count() === 0;
  check(chatInitiallyClosed, 'chat should be closed by default');
  const wide = viewport.width >= 700 && viewport.width / viewport.height >= 6 / 5;
  const own = data.panels.find(panel => panel.own), other = data.panels.find(panel => !panel.own);
  check(data.document.width <= viewport.width + 1, 'document has horizontal overflow');
  check(data.panels.length === 2, 'expected two captured panels');
  if (wide) {
    check(other.right <= data.middle.left + 1 && own.left >= data.middle.right - 1, 'wide layout must place opponent capture LEFT, own RIGHT of middle');
    for (const [panel, bar] of [[own, data.playerBars.own], [other, data.playerBars.opponent]]) {
      check(Math.abs(panel.left - bar.left) <= 1 && Math.abs(panel.right - bar.right) <= 1 && bar.bottom <= panel.top + 1, `player ${panel.player} name/score bar must align above its captured column`);
    }
  } else {
    check(other.bottom <= data.field.top + 1 && own.top >= data.field.bottom - 1, 'portrait must place opponent above field, own below field');
  }
  check(!intersects(own, other), 'capture zones intersect each other');
  for (const panel of data.panels) {
    check(panel.left >= -1 && panel.right <= viewport.width + 1, `player ${panel.player} capture zone outside horizontal viewport`);
    for (const card of [...data.fieldCards, ...data.handCards]) check(!intersects(panel, card), `player ${panel.player} capture zone intersects field/hand card ${card.id}`);
    check(panel.groups.length === 4, `player ${panel.player} expected four groups`);
    check(panel.labels.filter(label => label.type === 'role').length === 12, `player ${panel.player} expected 12 roles`);
    const [g0, g1, g2, g3] = panel.groups;
    if (wide) check(Math.abs(g0.top - g1.top) < 1 && Math.abs(g2.top - g3.top) < 1 && g2.top >= g0.bottom - 1 && g0.right <= g1.left + 1, `player ${panel.player} groups not 2x2`);
    else check(panel.groups.every(group => Math.abs(group.top - g0.top) < 1) && panel.groups.every((group, i) => !i || group.left >= panel.groups[i - 1].right - 1), `player ${panel.player} groups not four columns`);
    for (const group of panel.groups) {
      check(group.cards.length > 0, `player ${panel.player} ${group.kind} fixture pile empty`);
      check(group.roles.top >= group.pile.bottom - 1, `player ${panel.player} ${group.kind} role labels overlap pile`);
    }
    for (const label of panel.labels) {
      check(label.left >= label.group.left - 1 && label.right <= label.group.right + 1, `player ${panel.player} label '${label.text}' outside group`);
      check(label.left >= -1 && label.right <= viewport.width + 1, `player ${panel.player} label '${label.text}' outside horizontal viewport`);
      check(Number.parseFloat(label.fontSize) >= (label.type === 'role' ? 11 : 9), `player ${panel.player} label '${label.text}' unexpectedly small`);
      for (const content of label.contents) check(content.left >= label.left - 1 && content.right <= label.right + 1 && content.top >= label.top - 1 && content.bottom <= label.bottom + 1, `player ${panel.player} label '${label.text}' text/mark exceeds button bounds`);
    }
  }
  for (const fieldCard of data.fieldCards) for (const handCard of data.handCards) check(!intersects(fieldCard, handCard), `field ${fieldCard.id} overlaps hand ${handCard.id}`);
  const ids = data.panels.flatMap(panel => panel.groups.flatMap(group => group.cards));
  check(ids.length === 24 && new Set(ids).size === 24, 'fixture must show exactly 24 unique captured cards');
  const cupGroups = data.panels.flatMap(panel => panel.groups).filter(group => group.cards.includes(32));
  check(cupGroups.length === 1 && cupGroups[0].kind === 'animal', 'cup 32 physical card must appear once in animal group');
  const offViewportLabels = data.panels.flatMap(panel => panel.labels.filter(label => label.top < -1 || label.bottom > viewport.height + 1).map(label => ({ player: panel.player, text: label.text, top: label.top, bottom: label.bottom })));
  if (offViewportLabels.length) warnings.push(`${offViewportLabels.length} labels require vertical page scrolling`);
  check(client.commands.length === 0, 'layout inspection issued game commands');
  const screenshot = `layout-${viewport.width}x${viewport.height}${suffix}.png`;
  await page.screenshot({ path: `${output}/${screenshot}`, fullPage: false });
  if (data.document.height > viewport.height + 1) await page.screenshot({ path: `${output}/layout-${viewport.width}x${viewport.height}${suffix}-full.png`, fullPage: true });
  await page.locator('.game-chat-toggle').click();
  const chat = await page.locator('.game-conversation').evaluate(element => { const b = element.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; });
  check(chat.left >= -1 && chat.right <= viewport.width + 1 && chat.top >= -1 && chat.bottom <= viewport.height + 1, 'opened chat outside viewport');
  await page.screenshot({ path: `${output}/layout-${viewport.width}x${viewport.height}${suffix}-chat.png`, fullPage: false });
  await page.getByRole('button', { name: '会話を閉じる' }).click();
  check(await page.locator('.game-conversation').count() === 0, 'chat close button should close overlay');
  const test = { name: `${viewport.width}x${viewport.height}${suffix}`, status: failures.length ? 'failed' : 'passed', wide, failures, warnings, offViewportLabels, screenshot, chatInitiallyClosed, chat, geometry: data };
  report.tests.push(test);
  console.log(JSON.stringify({ name: test.name, status: test.status, failures, warnings, table: data.table, document: data.document }));
}
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1214, height: 627 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    if (process.env.QA_LAYOUT_SIZES && !process.env.QA_LAYOUT_SIZES.split(',').includes(`${viewport.width}x${viewport.height}`)) continue;
    const client = await setup(viewport);
    await verify(client, viewport);
    await client.context.close();
  }
  report.status = report.tests.some(test => test.status === 'failed') || report.pageErrors.length || report.unexpectedRequests.length ? 'failed' : 'passed';
  if (report.status === 'failed') process.exitCode = 1;
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error); }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${output}/layout-report.json`, JSON.stringify(report, null, 2)); await browser.close(); }
