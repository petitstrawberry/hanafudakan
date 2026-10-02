/** Dedicated real browser + real local HTTP/WebSocket server. No game/network mocks.
 * QA_BASE_URL, PLAYWRIGHT_MODULE and QA_CHROMIUM_PATH follow other QA scripts.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
const { releases } = JSON.parse(await readFile(new URL('../client/src/data/releases.json', import.meta.url)));
const version = releases[0].version;
const key = 'hanafudakan-announcements-read-through';
const output = resolve(process.env.QA_OUTPUT_DIR || 'artifacts/announcements');
await mkdir(output, { recursive: true });
const report = { base, version, tests: [], screenshots: [], pageErrors: [], cleanup: [], status: 'running' };
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'], ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
const contexts = [];
const pass = name => { report.tests.push(name); console.log(`PASS ${name}`); };
const notice = page => page.getByRole('dialog', { name: '花札館が新しくなりました' });
async function client(viewport = { width: 1440, height: 1000 }, init) {
  const context = await browser.newContext({ viewport }); contexts.push(context);
  await context.addInitScript(() => { localStorage.setItem('hana-sound', 'false'); localStorage.setItem('hana-motion', 'false'); });
  if (init) await context.addInitScript(init);
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  return { context, page };
}
async function overflow(page) { const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(size.scroll <= size.width + 1, JSON.stringify(size)); }
async function screenshot(page, name, fullPage = false) { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: `${output}/${name}.png`, fullPage, animations: 'disabled' }); report.screenshots.push(`${name}.png`); }
async function hidden(page) { await notice(page).waitFor({ state: 'hidden' }); }
async function marker(page) { return page.evaluate(key => localStorage.getItem(key), key); }
const roomsToClean = [];
try {
  for (const viewport of [{width:1440,height:1000},{width:390,height:844},{width:844,height:390}]) {
    const { page } = await client(viewport);
    await page.goto(base); await notice(page).waitFor();
    assert.ok(await notice(page).innerText().then(text => text.includes(`v${version}`)));
    await overflow(page); await screenshot(page, `notice-${viewport.width}`);
    await page.getByRole('button', { name: 'お知らせ一覧へ', exact:true }).click(); await hidden(page);
    assert.equal(await marker(page), version);
    await page.getByRole('link', { name:'変更点を読む' }).click();
    await page.getByRole('heading', { name: '更新の詳細' }).waitFor(); await overflow(page);
    assert.ok(await page.locator('.release-detail').innerText().then(text => text.includes('全12契約')));
    await screenshot(page, `detail-${viewport.width}`, true);
    await page.goBack(); await page.getByRole('heading', {name:'お知らせ', exact:true}).waitFor();
    await page.goForward(); await page.getByRole('heading', {name:'更新の詳細'}).waitFor();
    await page.getByRole('link', {name:'一覧に戻る'}).click();
    await page.getByRole('button', {name:/^(対戦ロビー|対戦に戻る)$/}).click();
    await page.reload(); await page.getByRole('button', {name:/CPUと遊ぶ/}).waitFor(); await hidden(page);
    assert.equal(await marker(page),version);
    pass(`first notice, detail/list, browser back/forward, reload and no overflow ${viewport.width}x${viewport.height}`);
  }
  for (const action of ['確認して閉じる','閉じる','Escape','shade']) {
    const {page} = await client(); await page.goto(base); await notice(page).waitFor();
    if (action === 'Escape') await page.keyboard.press('Escape');
    else if (action === 'shade') await page.locator('.modal-shade').click({position:{x:3,y:3}});
    else await notice(page).getByRole('button',{name:action,exact:true}).click();
    await hidden(page); assert.equal(await marker(page),version); await page.reload(); await hidden(page);
    pass(`acknowledgment and reopen suppression via ${action}`);
  }
  for (const saved of ['0.1.0','broken','2.0.0']) {
    const {page,context} = await client();
    await context.addInitScript(({key,saved}) => localStorage.setItem(key,saved), {key,saved});
    await page.goto(base); await page.getByRole('button',{name:/CPUと遊ぶ/}).waitFor();
    if(saved === '2.0.0') { await hidden(page); assert.equal(await marker(page),saved); }
    else { await notice(page).waitFor(); await page.keyboard.press('Escape'); assert.equal(await marker(page),version); }
    pass(`stored marker ${saved}`);
  }
  for (const blocked of ['access','write']) {
    const {page} = await client(undefined, () => {
      Object.defineProperty(window, '__savedSession', {value: JSON.stringify({token:'preserved',playerId:'preserved',name:'保存済み'})});
      localStorage.setItem('hanafudakan-session', window.__savedSession);
      localStorage.setItem('hana-name','保存済み');
    });
    await page.context().addInitScript(blocked => {
      if (blocked === 'access') Object.defineProperty(window, 'localStorage', {get() {throw new DOMException('Blocked','SecurityError');}});
      else Storage.prototype.setItem = () => { throw new DOMException('Full','QuotaExceededError'); };
    }, blocked);
    await page.goto(base); await notice(page).waitFor(); await page.keyboard.press('Escape'); await hidden(page);
    await page.getByRole('button',{name:'お知らせ',exact:true}).click(); await page.getByRole('button',{name:/^(対戦ロビー|対戦に戻る)$/}).click(); await hidden(page);
    if(blocked === 'write') assert.equal(await page.evaluate(() => localStorage.getItem('hanafudakan-session')), await page.evaluate(() => window.__savedSession));
    pass(`blocked ${blocked} storage renders and dismisses without touching saved session`);
  }
  const missing = await client();
  await missing.page.goto(`${base}/?room=missing-announcement-qa`); await notice(missing.page).waitFor();
  await missing.page.keyboard.press('Escape'); pass('missing invitation resolves before idle-lobby notice');
  const shared = await client(); await shared.page.goto(base); await notice(shared.page).waitFor();
  const other = await shared.context.newPage(); await other.goto(`${base}/#announcements`);
  await other.evaluate(key => localStorage.setItem(key, '2.0.0'), key);
  await shared.page.keyboard.press('Escape'); await hidden(shared.page); assert.equal(await marker(shared.page),'2.0.0');
  pass('closing an older open notice preserves the newer marker from another tab');
  // Real invitation, defer until the user returns from the table.
  const host = await browser.newContext(); contexts.push(host);
  const session = await (await host.request.post(`${base}/api/session`, {data:{name:'お知らせQA主催'}})).json();
  const result = await (await host.request.post(`${base}/api/rooms`, {headers:{Authorization:`Bearer ${session.token}`},data:{name:'お知らせQA専用',mode:'pvp',rounds:3,password:'',hyper:false}})).json();
  assert.ok(result.roomId); roomsToClean.push({id:result.roomId,token:session.token});
  const invited = await client(); await invited.page.goto(`${base}/?room=${result.roomId}`);
  await invited.page.getByRole('button',{name:'ロビーへ',exact:true}).first().waitFor(); await hidden(invited.page);
  const savedSession = await invited.page.evaluate(() => localStorage.getItem('hanafudakan-session'));
  await invited.page.getByRole('button',{name:'お知らせ',exact:true}).click(); await invited.page.getByRole('link',{name:'変更点を読む'}).click();
  await invited.page.getByRole('button',{name:/^(対戦ロビー|対戦に戻る)$/}).click(); await hidden(invited.page);
  assert.equal(await invited.page.evaluate(() => localStorage.getItem('hanafudakan-session')),savedSession);
  await invited.page.getByRole('button',{name:'ロビーへ',exact:true}).first().click(); await notice(invited.page).waitFor(); await invited.page.keyboard.press('Escape');
  pass('real invite defers notice; news preserves session and table; leaving shows pending notice');
  const playing = await client(); await playing.page.goto(base); await notice(playing.page).waitFor(); await playing.page.keyboard.press('Escape');
  let state = null;
  playing.page.on('websocket', socket => socket.on('framereceived', event => { try { const message=JSON.parse(String(event.payload)); if(message.type==='state') state=message.room; } catch{} }));
  await playing.page.getByRole('button',{name:/CPUと遊ぶ/}).click(); await playing.page.getByRole('button',{name:'対戦をはじめる'}).click();
  await playing.page.waitForFunction(() => document.querySelector('.your-hand button'));
  assert.ok(state?.id);
  const token = JSON.parse(await playing.page.evaluate(() => localStorage.getItem('hanafudakan-session'))).token;
  roomsToClean.push({id:state.id,token});
  await playing.page.evaluate(key => localStorage.removeItem(key),key); await playing.page.reload();
  await playing.page.locator('.your-hand').waitFor(); await hidden(playing.page);
  await playing.page.getByRole('button',{name:'お知らせ',exact:true}).click(); await playing.page.getByRole('link',{name:'変更点を読む'}).click();
  await playing.page.getByRole('button',{name:/^(対戦ロビー|対戦に戻る)$/}).click(); await playing.page.locator('.your-hand').waitFor(); await hidden(playing.page);
  await screenshot(playing.page,'active-game-no-notice');
  await playing.page.getByRole('button',{name:'ロビーへ',exact:true}).first().click(); await playing.page.getByRole('button',{name:'投了して退室する',exact:true}).click();
  await notice(playing.page).waitFor(); await playing.page.keyboard.press('Escape');
  pass('real CPU match reload and manual news do not interrupt; pending notice waits until forfeit/leave');
  assert.deepEqual(report.pageErrors,[]); report.status='passed';
} catch(error) { report.status='failed'; report.failure=error.stack; console.error(error); process.exitCode=1; }
finally {
  for(const room of roomsToClean) {
    try { const context=contexts[0]; const response=await context.request.post(`${base}/api/rooms/${room.id}/leave`,{headers:{Authorization:`Bearer ${room.token}`},data:{}}); report.cleanup.push({room:room.id,status:response.status()}); }
    catch(error) {report.cleanup.push({room:room.id,error:error.message});}
  }
  await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)); await browser.close();
}
