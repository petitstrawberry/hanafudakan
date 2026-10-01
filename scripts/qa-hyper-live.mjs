/** Test-only arrangements; actual Rust HTTP/WebSocket, built App and GameRoom. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixtures = JSON.parse(process.env.QA_LIVE_FIXTURES);
const base = process.env.QA_BASE_URL;
const output = 'artifacts/light-contract-rework';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
const report = { evidence: 'Actual Rust HTTP/WebSocket and built App; test-only card arrangements; no mocks.', cases: [], pageErrors: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const end = Date.now() + 16000;
  while (Date.now() < end) { if (await predicate()) return; await wait(50); }
  throw Error(`Timeout: ${label}`);
}
async function open(fixture, seat) {
  const context = await browser.newContext({ viewport: ['bind', 'revelation', 'engines'].includes(fixture.kind) ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(session => {
    localStorage.setItem('hanafudakan-session', JSON.stringify(session));
    for (const key of ['hana-sound', 'hana-music', 'hana-motion']) localStorage.setItem(key, 'false');
    const NativeSocket = window.WebSocket;
    window.__qaSockets = []; window.__qaCelebrations = []; window.__qaTraps = [];
    new MutationObserver(() => {
      const text = document.querySelector('.yaku-celebration span')?.textContent;
      if (text && window.__qaCelebrations.at(-1) !== text) window.__qaCelebrations.push(text);
      const trap = document.querySelector('.trap-activation-overlay')?.textContent;
      if (trap && window.__qaTraps.at(-1) !== trap) window.__qaTraps.push(trap);
    }).observe(document, { childList: true, subtree: true });
    window.WebSocket = class extends NativeSocket { constructor(...args) { super(...args); window.__qaSockets.push(this); } };
  }, fixture.sessions[seat]);
  const page = await context.newPage(); page.setDefaultTimeout(16000);
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
  await until(() => client.room?.phase === 'play', 'initial live snapshot'); await idle(client);
  return client;
}
async function idle(client) {
  await client.page.locator('.game-page[data-animating="false"]').waitFor();
  await until(async () => await client.page.locator('.hp-attack-overlay, .trap-activation-overlay').count() === 0, 'effects finished');
}
async function send(client, command) {
  await client.page.evaluate(command => window.__qaSockets.findLast(s => s.readyState === WebSocket.OPEN).send(JSON.stringify(command)), command);
}
async function capture(client, card, target = null) {
  await idle(client);
  await client.page.locator(`.your-hand .hana-card[data-card-id="${card}"]`).click();
  if (target !== null) await client.page.locator(`.field-slot .hana-card[data-card-id="${target}"]`).click();
}
async function reload(client) {
  const count = client.socketCount; await client.page.reload();
  await until(() => client.socketCount > count, 'reconnect'); await idle(client);
}
try {
  for (const fixture of fixtures) {
    const owner = await open(fixture, 0); const attacker = await open(fixture, 1);
    if (fixture.kind === 'engines') {
      const stock = owner.room.deckCount;
      assert.deepEqual(owner.room.hyper.contracts[0].map(c => c.points), [3,3,3]);
      await capture(owner, 4); await until(() => owner.room.turn === 1, 'engine turn'); await idle(owner);
      assert.deepEqual(owner.room.hyper.bloom, [7,2]); assert.equal(owner.room.hyper.chain[0], 5);
      assert.equal(owner.room.deckCount, stock - 3);
      assert.ok((await owner.page.evaluate(() => window.__qaCelebrations)).some(t => t.startsWith('5 CHAIN')));
      await owner.page.getByText('契約の発動', { exact: true }).click();
      assert.match(await owner.page.locator('.contract-history').innerText(), /追猟.*3を奪取/);
      report.cases.push({ kind: fixture.kind, chain:5, extraDraws:2, bloom:[7,2] });
    } else if (fixture.kind === 'sight' || fixture.kind === 'revelation') {
      assert.equal(owner.room.hyper.hp, null);
      assert.deepEqual(owner.room.hyper.intel.opponentHand, attacker.room.hand);
      assert.equal(owner.room.hyper.intel.nextCard, 28);
      assert.deepEqual(attacker.room.hyper.intel, { opponentHand:[], nextCard:null });
      assert.equal(await owner.page.locator('.opponent-hand .hana-card:not(.back)').count(), attacker.room.hand.length);
      await owner.page.getByText('看破・天啓 · 次の山札', { exact: true }).click();
      assert.equal(await owner.page.locator('.private-intel .hana-card[data-card-id="28"]').count(), 1);
      assert.equal(await attacker.page.locator('.private-intel').count(), 0);
      await reload(owner);
      assert.deepEqual(owner.room.hyper.intel.opponentHand, attacker.room.hand);
      if (fixture.kind === 'revelation') {
        const seq = Math.max(0, ...owner.room.events.map(e => e.id));
        await owner.page.locator('.your-hand .hana-card[data-card-id="0"]').click();
        assert.equal(await owner.page.locator('.field-slot.match-target').count(), 3);
        assert.ok((await owner.page.locator('.field-target-label').allTextContents()).every(t => !t.includes('まとめ取り')));
        await owner.page.locator('.field-slot .hana-card[data-card-id="9"]').click();
        await until(() => owner.room.events.some(e => e.id > seq && e.cardId === 0), 'cross-month acquisition'); await idle(owner);
        const first = owner.room.events.find(e => e.id > seq && e.cardId === 0);
        assert.deepEqual(first.targetIds, [9]); assert.deepEqual(first.capturedCards[0], [0,9]);
        assert.equal(first.hyper.bloom[1], 2); assert.equal(first.hyper.chain[0], 1);
        assert.match(owner.room.log.join('\n'), /天啓！.*代償/);
      }
      await owner.page.screenshot({ path:`${output}/live-${fixture.kind}.png` });
      report.cases.push({ kind:fixture.kind, authorizedIntel:true, reconnect:true, crossMonthSingleCapture:fixture.kind === 'revelation' });
    } else if (fixture.kind === 'storm_ko') {
      assert.deepEqual(owner.room.hyper.hp, [7,32]);
      await capture(owner,16); await until(() => attacker.room.turn === 1, 'storm opponent turn'); await idle(attacker);
      const forecast = attacker.room.hyper.damagePreviews.find(p => p.cardId === 8 && p.targetId === 9).damage;
      assert.equal(forecast[0].roles,5); assert.equal(forecast[0].power,7);
      const stock = attacker.room.deckCount;
      await attacker.page.locator('.your-hand .hana-card[data-card-id="8"]').click();
      await attacker.page.getByText('攻撃内訳',{exact:true}).click();
      assert.match(await attacker.page.locator('.combat-preview').innerText(),/役5/);
      await attacker.page.locator('.field-slot .hana-card[data-card-id="9"]').click();
      await until(() => attacker.room.phase === 'finished','KO'); await idle(attacker);
      assert.equal(attacker.room.winner,1); assert.deepEqual(attacker.room.hyper.hp,[0,32]);
      assert.equal(attacker.room.deckCount,stock); assert.deepEqual(attacker.room.events.at(-1).hyper.damage,forecast);
      for (const [seat,name] of ['罠の契約者','攻撃する人'].entries()) {
        assert.equal(await attacker.page.getByRole('meter',{name:`${name}のHP`,exact:true}).evaluate(m => m.value),[0,32][seat]);
      }
      await reload(attacker); assert.deepEqual(attacker.room.hyper.hp,[0,32]);
      report.cases.push({kind:fixture.kind,forecastEqualsActual:true,stopBeforeDraw:true,reconnect:true});
    } else {
      assert.equal(owner.room.hyper.hp,null);
      assert.equal(owner.room.hyper.trapChoices.length,2);
      assert.deepEqual(attacker.room.hyper.trapChoices,[]);
      await owner.page.getByRole('button',{name:'罠を指定',exact:true}).click();
      await owner.page.getByRole('button',{name:'罠を取消',exact:true}).click();
      assert.deepEqual(owner.room.hyper.traps,[null,null]);
      const revision=owner.room.boardRevision;
      const kind=fixture.kind === 'draw_choice' ? 'levy' : fixture.kind;
      const effectName={levy:'徴収',reveal:'暴露',bind:'足枷'}[kind];
      await owner.page.getByRole('button',{name:'罠を指定',exact:true}).click();
      await owner.page.locator('.trap-choice-panel button').filter({hasText:effectName}).click();
      await owner.page.locator('.field-slot .hana-card[data-card-id="9"]').click();
      await until(() => attacker.room.hyper.traps[0] === 9,'trap broadcast'); await idle(owner);
      assert.equal(owner.room.turn,0); assert.equal(owner.room.boardRevision,revision);
      assert.deepEqual(owner.room.hyper.trapKinds,[kind,null]); assert.deepEqual(attacker.room.hyper.trapKinds,[null,null]);
      await send(owner,{type:'trap',kind,targetId:13,boardRevision:revision});
      await until(() => owner.errors.length === 1,'repeat rejected');
      await reload(owner); assert.deepEqual(owner.room.hyper.trapKinds,[kind,null]);
      await capture(owner,fixture.kind === 'reveal' ? 24 : 16);
      await until(() => attacker.room.turn === 1,'opponent turn'); await idle(attacker);
      if (fixture.kind === 'draw_choice') {
        await capture(attacker,4); await until(() => attacker.room.phase === 'draw_choice','draw choice'); await idle(attacker);
        assert.deepEqual(attacker.room.legalTargets,[9,10]);
      } else await attacker.page.locator('.your-hand .hana-card[data-card-id="8"]').click();
      // Single ordinary target submits on hand click outside HP mode.
      if (fixture.kind === 'draw_choice') await attacker.page.locator('.field-slot .hana-card[data-card-id="9"]').click();
      await until(() => attacker.room.events.some(e => e.hyper?.trapActivations?.length),'trap activation record');
      await until(async () => (await attacker.page.evaluate(() => window.__qaTraps)).length > 0,'trap animation');
      if (kind === 'levy') await attacker.page.screenshot({path:`${output}/live-trap-activation.png`});
      if (kind === 'levy') {
        assert.ok(await attacker.page.locator('.trap-activation-overlay').count(), 'disconnect while trap visible');
        const connections = attacker.socketCount;
        await attacker.page.evaluate(() => window.__qaSockets.findLast(s => s.readyState === WebSocket.OPEN).close());
        await until(() => attacker.socketCount > connections, 'reconnect during trap overlay');
      }
      await idle(attacker); await idle(owner);
      const activation=attacker.room.events.find(e => e.hyper?.trapActivations?.length).hyper.trapActivations[0];
      assert.equal(activation.kind,kind); assert.equal(activation.victim,1);
      assert.match((await attacker.page.evaluate(() => window.__qaTraps)).join('\n'),new RegExp(`トラップ札発動！！.*${effectName}`));
      if (kind === 'levy') { assert.equal(activation.amount,3); assert.deepEqual(attacker.room.hyper.bloom,[3,0]); }
      if (kind === 'reveal') {
        assert.equal(owner.room.hyper.intel.opponentHand.length,2);
        assert.ok(owner.room.hyper.intel.opponentHand.every(c => attacker.room.hand.includes(c)));
        assert.deepEqual(attacker.room.hyper.intel.opponentHand,[]);
        await reload(owner); assert.equal(owner.room.hyper.intel.opponentHand.length,2);
        assert.equal(await owner.page.locator('.opponent-hand .hana-card:not(.back)[data-card-id="0"]').count(),0);
      }
      if (kind === 'bind') {
        const first = attacker.room.events.find(e => e.hyper?.trapActivations?.length);
        assert.equal(first.hyper.chain[1],3);
        assert.ok(attacker.room.hyper.chain[1] >= 3); assert.equal(attacker.room.hyper.boosts[1],0);
        assert.equal(attacker.room.hyper.growthSealed[1],true);
        assert.ok((await attacker.page.evaluate(() => window.__qaCelebrations)).some(t => t.startsWith('3 CHAIN')));
      }
      await attacker.page.screenshot({path:`${output}/live-${fixture.kind}.png`});
      report.cases.push({kind:fixture.kind,cancel:true,privateChoices:true,repeatRejected:true,reconnect:true,reconnectDuringEffect:kind === 'levy',activation});
    }
    const overflow=await owner.page.evaluate(() => ({x:Math.max(0,document.documentElement.scrollWidth-innerWidth),y:Math.max(0,document.documentElement.scrollHeight-innerHeight)}));
    assert.deepEqual(overflow,{x:0,y:0});
    await owner.context.close(); await attacker.context.close();
  }
  assert.deepEqual(report.pageErrors,[]);
} finally { await writeFile(`${output}/browser-live.json`,JSON.stringify(report,null,2)); await browser.close(); }
console.log(JSON.stringify(report,null,2));
