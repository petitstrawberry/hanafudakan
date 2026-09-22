/** Supplemental deterministic UI tests only: HTTP and WebSocket game traffic is
 * mocked. These fixtures do not validate Rust rules or real-server integration.
 * Run alongside the actual Vite app at QA_BASE_URL (default localhost:5173).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE_URL || 'http://localhost:5173';
const output = resolve('artifacts/qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
const targetedCases = process.env.QA_FIXTURE_CASES?.split(',');
const report = targetedCases ? JSON.parse(await readFile(`${output}/fixture-report.json`, 'utf8')) : { evidence: 'Supplemental browser UI evidence using synthetic RoomView fixtures and mocked HTTP/WebSocket traffic. Not real-server E2E.', startedAt: new Date().toISOString(), base, tests: [], pageErrors: [], unexpectedRequests: [], screenshots: [] };
if (targetedCases) {
  const names = targetedCases.map(id => id === 'draw2' ? 'draw_choice explicitly chooses one of two targets' : `${Number(id.replace('hand', ''))} matching field cards`);
  report.tests = report.tests.filter(test => !names.includes(test.name));
  report.targetedReruns ||= [];
  report.targetedReruns.push({ cases: targetedCases, startedAt: new Date().toISOString(), reason: 'Direct highlighted field-card selection replaces the former candidate tray' });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, label) => {
  for (let i = 0; i < 200; i++) { if (await predicate()) return; await pause(25); }
  throw new Error(`Timed out: ${label}`);
};
const session = { token: 'fixture-only-token', playerId: 'fixture-self', name: '試験 花子' };
function roomFixture(matches, drawn = false) {
  const hand = drawn ? [12, 16, 20, 24, 28] : [0, 12, 16, 20, 24, 28];
  return {
    id: `fixture-${drawn ? 'draw' : 'hand'}-${matches}`, name: '公開イベント UI 検証', hostId: session.playerId,
    mode: 'pvp', rounds: 3, round: 1, status: 'playing',
    players: [{ id: session.playerId, name: session.name, score: 0, handCount: hand.length, captured: [], connected: true, isCpu: false }, { id: 'fixture-opponent', name: '試験 太郎', score: 0, handCount: 6, captured: [], connected: true, isCpu: false }],
    myIndex: 0, hand, field: [1, 2, 3].slice(0, matches).concat([4, 8, 32, 36, 40]),
    deckCount: 20, turn: 0, phase: drawn ? 'draw_choice' : 'play', drawnCard: drawn ? 0 : null,
    yaku: [[], []], koikoi: [0, 0], winner: null, matchWinner: null, roundPoints: 0,
    messages: [], log: ['補助試験用の合成局面'], legalTargets: drawn ? [1, 2] : [], spectators: 0, dealer: 0, events: [],
  };
}
async function clientFor(room, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  await context.addInitScript(({ session }) => {
    localStorage.setItem('hanafudakan-session', JSON.stringify(session));
    localStorage.setItem('hana-motion', 'true');
    localStorage.setItem('hana-sound', 'false');
    window.__fixtureAnimations = [];
    window.__fixtureGeometry = [];
    window.__fixtureCaptureAnchors = [];
    let previous = '';
    new MutationObserver(() => {
      const overlay = document.querySelector('.move-overlay');
      const stage = overlay?.className || '';
      if (!stage || stage === previous) { previous = stage; return; }
      previous = stage;
      window.__fixtureAnimations.push({ stage, targets: overlay.querySelectorAll('.target-copy').length, played: overlay.querySelectorAll('.played-copy').length, locked: document.querySelector('.game-page')?.getAttribute('data-animating'), enabledHandButtons: document.querySelectorAll('.your-hand button:not([disabled])').length });
      if (stage === 'move-overlay move-collect') {
        const bounds = element => { if (!element) return null; const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
        const kindFor = id => [0, 8, 28, 40, 44].includes(id) ? 'bright' : [4, 12, 16, 20, 24, 29, 32, 36, 41].includes(id) ? 'animal' : [1, 5, 9, 13, 17, 21, 25, 33, 37, 42].includes(id) ? 'ribbon' : 'chaff';
        for (const card of overlay.querySelectorAll('.flying-card')) {
          const id = Number(card.querySelector('img').getAttribute('src').match(/\/(\d+)\.svg$/)[1]);
          const style = getComputedStyle(card);
          const width = parseFloat(style.getPropertyValue('--card-width'));
          const pile = bounds(document.querySelector(`[data-capture-player="0"] [data-capture-kind="${kindFor(id)}"] .captured-yaku-scroll`));
          const score = bounds(document.querySelector('[data-player-index="0"] .player-score'));
          window.__fixtureCaptureAnchors.push({ id, kind: kindFor(id), centerX: parseFloat(style.getPropertyValue('--destination-x')) + width / 2, centerY: parseFloat(style.getPropertyValue('--destination-y')) + width * 380 / 240 / 2, pile, score, viewportHeight: innerHeight });
        }
      }
      const landing = document.querySelector('.field-landing-slot .hana-card');
      if (landing) {
        const bounds = element => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
        window.__fixtureGeometry.push({ stage, landing: bounds(landing), played: bounds(overlay.querySelector('.played-copy')), target: { x: parseFloat(overlay.style.getPropertyValue('--target-x')), y: parseFloat(overlay.style.getPropertyValue('--target-y')) }, rotation: overlay.style.getPropertyValue('--target-rotation'), existing: [...document.querySelectorAll('.field-slot:not(.field-landing-slot) .hana-card')].map(bounds), rings: overlay.querySelectorAll('.capture-ring').length });
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-animating'] });
  }, { session });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.pageErrors.push({ fixture: room.id, error: error.message }));
  const client = { context, page, room, commands: [], socket: null };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === '/api/rooms') body = { rooms: [{ id: room.id, name: room.name, mode: 'pvp', rounds: 3, players: 1, spectators: 0, locked: false, status: 'playing', hostName: session.name }] };
    else if (path === '/api/me' || path === '/api/session') body = session;
    else if (path === `/api/rooms/${room.id}/join`) body = { roomId: room.id };
    else { report.unexpectedRequests.push(path); body = { error: 'Unexpected fixture HTTP request' }; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.routeWebSocket('**/api/ws?*', socket => {
    client.socket = socket;
    socket.onMessage(message => client.commands.push(JSON.parse(String(message))));
    socket.send(JSON.stringify({ type: 'state', room }));
  });
  await page.goto(`${base}/?room=${room.id}`);
  await page.locator('.game-page[data-animating="false"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return client;
}
function eventAfter(room, source, targets) {
  const captured = targets.length > 0;
  const field = captured ? room.field.filter(id => !targets.includes(id)) : [...room.field, 0];
  const capturedCards = [captured ? [0, ...targets] : [], []];
  const event = { id: 1, player: 0, source, cardId: 0, targetIds: targets, captured, field, capturedCards, deckCount: room.deckCount, requiresChoice: false };
  return { ...room, hand: source === 'hand' ? room.hand.filter(id => id !== 0) : room.hand, field, drawnCard: null, phase: 'play', turn: 1, events: [event], players: room.players.map((p, index) => ({ ...p, captured: capturedCards[index], handCount: index === 0 && source === 'hand' ? p.handCount - 1 : p.handCount })) };
}
async function capture(client, filename) {
  await client.page.screenshot({ path: `${output}/${filename}`, fullPage: false, animations: 'allow' });
  report.screenshots.push(filename);
}
async function runSelectionCase(matches, drawn = false) {
  const client = await clientFor(roomFixture(matches, drawn));
  const { page, room } = client;
  assert.equal(await page.getByTestId('confirm-play').count(), 0, 'No extra confirmation action');
  assert.equal(await page.locator('.selection-tray, .target-option').count(), 0, 'Candidate panels must not be rendered');
  if (drawn) {
    assert.equal(await page.locator('.field-cards .match-target button[data-card-id]').count(), 2);
    assert.equal(await page.locator('.drawn-card [data-card-id="0"]').count(), 1);
    assert.equal(client.commands.length, 0, 'draw_choice must await target selection');
    await capture(client, 'fixture-drawn-two-choice.png');
    await page.locator('.field-cards .match-target button[data-card-id="2"]').click();
  } else {
    await page.locator('.your-hand [data-card-id="0"]').click();
    if (matches === 2) {
      assert.equal(await page.locator('.selection-tray, .target-option').count(), 0);
      assert.equal(client.commands.length, 0, 'two matches must await target selection');
      assert.equal(await page.locator('.field-slot.match-target').count(), 2);
      await page.locator('.turn-banner').getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await page.locator('.field-slot.match-target').count(), 0, 'Cancel clears ambiguous hand selection');
      assert.equal(client.commands.length, 0);
      await page.locator('.your-hand [data-card-id="0"]').click();
      assert.equal(await page.locator('.field-slot.match-target').count(), 2);
      await page.locator('.your-hand [data-card-id="0"]').click();
      assert.equal(await page.locator('.field-slot.match-target').count(), 0, 'Clicking the same hand card toggles selection off');
      assert.equal(client.commands.length, 0);
      await page.locator('.your-hand [data-card-id="0"]').click();
      assert.equal(await page.locator('.field-cards .match-target button[data-card-id]').count(), 2);
      await page.locator('.field-cards .match-target button[data-card-id="2"]').click();
    } else assert.equal(await page.locator('.selection-tray').count(), 0, 'unambiguous play needs no selection tray');
  }
  await until(() => client.commands.length === 1, 'exactly one command');
  const expected = drawn ? { type: 'choose', targetId: 2 } : { type: 'play', cardId: 0, ...(matches ? { targetId: matches === 2 ? 2 : 1 } : {}) };
  assert.deepEqual(client.commands, [expected]);
  assert.equal(await page.locator('.game-page').getAttribute('data-animating'), 'true', 'submission input lock');
  assert.equal(await page.locator('.your-hand button:not([disabled])').count(), 0);
  const targets = matches === 3 ? [1, 2, 3] : matches ? [matches === 2 ? 2 : 1] : [];
  const next = eventAfter(room, drawn ? 'choice' : 'hand', targets);
  client.socket.send(JSON.stringify({ type: 'state', room: next }));
  if (matches === 3) {
    await page.locator('.move-stack .target-copy').first().waitFor({ state: 'visible' });
    await capture(client, 'fixture-three-target-stack.png');
  }
  await page.locator('.game-page[data-animating="false"]').waitFor();
  const samples = await page.evaluate(() => window.__fixtureAnimations);
  assert.ok(samples.some(s => s.stage === 'move-overlay move-travel'));
  if (matches) {
    for (const stage of ['stack', 'collect']) assert.ok(samples.some(s => s.stage === `move-overlay move-${stage}` && s.targets === targets.length && s.played === 1));
    assert.equal(await page.locator('[data-capture-player="0"] [data-captured-card-id]').count(), targets.length + 1);
    const anchors = await page.evaluate(() => window.__fixtureCaptureAnchors);
    assert.equal(anchors.length, targets.length + 1);
    for (const anchor of anchors) {
      const destination = anchor.pile.y >= 0 && anchor.pile.y + anchor.pile.height < anchor.viewportHeight ? anchor.pile : anchor.score;
      assert.ok(destination && anchor.centerX >= destination.x - 1 && anchor.centerX <= destination.x + destination.width + 1 && anchor.centerY >= destination.y - 1 && anchor.centerY <= destination.y + destination.height + 1, `capture card ${anchor.id} destination must reach its ${anchor.kind} pile or own player score fallback`);
    }
    client.captureAnchors = anchors;
  }
  assert.ok(samples.every(s => s.locked === 'true' && s.enabledHandButtons === 0));
  assert.equal(await page.locator('.field-cards [data-card-id="0"]').count(), matches ? 0 : 1);
  assert.equal(client.commands.length, 1, 'animation must not issue duplicate commands');
  assert.equal(await page.locator('.selection-tray, .target-option').count(), 0);
  report.tests.push({ name: drawn ? 'draw_choice explicitly chooses one of two targets' : `${matches} matching field cards`, status: 'passed', expectedCommand: expected, suppliedPublicEvent: next.events[0], animationSamples: samples, captureAnchors: client.captureAnchors || [] });
  console.log(`PASS fixture ${drawn ? 'draw_choice' : `${matches} matches`}`);
  await client.context.close();
}

async function runLandingGeometry(viewport) {
  const client = await clientFor(roomFixture(0), viewport);
  const { page, room } = client;
  await page.locator('.your-hand [data-card-id="0"]').click();
  await until(() => client.commands.length === 1, 'unmatched play submitted');
  client.socket.send(JSON.stringify({ type: 'state', room: eventAfter(room, 'hand', []) }));
  await page.locator('.move-travel').waitFor({ state: 'visible' });
  await capture(client, `fixture-unmatched-travel-${viewport.width}.png`);
  await page.locator('.game-page[data-animating="false"]').waitFor();
  const samples = await page.evaluate(() => window.__fixtureGeometry);
  const travel = samples.find(sample => sample.stage === 'move-overlay move-travel');
  const settle = samples.find(sample => sample.stage === 'move-overlay move-settle');
  assert.ok(travel, 'unmatched card travels to a reserved empty slot');
  assert.ok(settle, 'unmatched card settles without capture stack');
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1, `geometry differs: ${a} vs ${b}`);
  const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const sample of [travel, settle]) {
    near(sample.target.x, sample.landing.x);
    near(sample.target.y, sample.landing.y);
    assert.equal(sample.rotation, '0deg');
    assert.equal(sample.rings, 0);
    assert.ok(sample.existing.every(card => !intersects(card, sample.landing)), 'landing slot overlaps an existing card');
  }
  near(settle.played.x, settle.landing.x);
  near(settle.played.y, settle.landing.y);
  near(settle.played.width, settle.landing.width);
  assert.ok(settle.existing.every(card => !intersects(card, settle.played)), 'settled played card overlaps an existing card');
  const finalBox = await page.locator('.field-cards [data-card-id="0"]').boundingBox();
  near(finalBox.x, settle.landing.x);
  near(finalBox.y, settle.landing.y);
  const animations = await page.evaluate(() => window.__fixtureAnimations);
  assert.ok(animations.every(sample => !['move-overlay move-stack', 'move-overlay move-collect'].includes(sample.stage)), 'no capture animation for an unmatched placement');
  const size = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.viewport + 1, 'unmatched animation must not create horizontal overflow');
  report.tests.push({ name: `unmatched placement geometry ${viewport.width}px`, status: 'passed', viewport, samples, finalBox, documentWidth: size });
  console.log(`PASS fixture unmatched landing ${viewport.width}px`);
  await client.context.close();
}

try {
  for (const matches of [0, 1, 2, 3]) if (!targetedCases || targetedCases.includes(`hand${matches}`)) await runSelectionCase(matches);
  if (!targetedCases || targetedCases.includes('draw2')) await runSelectionCase(2, true);
  if (!targetedCases) {
    await runLandingGeometry({ width: 1440, height: 1000 });
    await runLandingGeometry({ width: 390, height: 844 });
  }
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.unexpectedRequests, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${output}/fixture-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
