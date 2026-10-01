/** Actual local HTTP/WebSocket, built App, ordinary random deals and CPU. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE_URL;
const output = process.env.QA_OUTPUT_DIR || 'artifacts/hyper-practice';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
const report = { evidence: 'Real local server, built App, random deals and CPU; no fixtures or mocks.', tests: [], pageErrors: [] };
const roles = ['猪鹿蝶','赤短','青短','花見で一杯','月見で一杯','三光','雨四光','四光','五光','タネ','短冊','カス'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await predicate()) return; await pause(50); }
  throw Error(`Timeout: ${label}`);
}
try {
  for (const viewport of [{width:1440,height:1000},{width:390,height:844},{width:844,height:390}]) {
    const response = await fetch(`${base}/api/session`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'契約お試しQA'}) });
    assert.equal(response.status,200); const session=await response.json();
    const context=await browser.newContext({viewport,reducedMotion:'reduce'});
    await context.addInitScript(session => {
      localStorage.setItem('hanafudakan-session',JSON.stringify(session));
      for(const key of ['hana-sound','hana-music','hana-motion'])localStorage.setItem(key,'false');
    },session);
    const page=await context.newPage(); let room; let version=0; const errors=[];
    page.on('pageerror',error=>report.pageErrors.push(error.message));
    page.on('websocket',socket=>socket.on('framereceived',event=>{
      const message=JSON.parse(String(event.payload));
      if(message.type==='state'){room=message.room;version++;}
      if(message.type==='error')errors.push(message.message);
    }));
    await page.goto(base);
    await page.getByRole('button',{name:'ハイパー契約をお試し',exact:true}).click();
    const dialog=page.getByRole('dialog');
    assert.equal(await dialog.locator('.practice-contract-list button').count(),12);
    await dialog.locator('.practice-contract-list button').filter({hasText:'修羅場'}).click();
    await until(()=>room?.practiceRole==='三光' && room.turn===0,'CPU plays first');
    await page.locator('.game-page[data-animating="false"]').waitFor();
    const id=room.id;
    assert.equal(room.rounds,1); assert.equal(room.hyper.contracts[0][0].id,'storm');
    assert.equal(room.hyper.hp.length,2); assert.equal(room.players[1].isCpu,true);
    const cases=[];
    for(const role of roles) {
      if (await page.locator('.hyper-practice-controls').getAttribute('open') === null) await page.locator('.hyper-practice-controls summary').click();
      await page.getByRole('combobox',{name:'試す契約',exact:true}).selectOption(role);
      const revision=room.boardRevision;
      await page.getByRole('button',{name:'この契約で試し直す',exact:true}).click();
      await until(()=>room?.practiceRole===role && room.boardRevision>revision && room.turn===0,'practice reset and CPU response');
      await page.locator('.game-page[data-animating="false"]').waitFor();
      assert.equal(room.id,id); assert.equal(room.hyper.contracts[0].length,1);
      assert.equal(room.hyper.hp!==null,role==='三光');
      assert.deepEqual(room.players.map(p=>p.score),[0,0]);
      // The populated board and visible public piles conserve the 48 cards.
      assert.equal(room.players.reduce((n,p)=>n+p.handCount+p.captured.length,0)+room.field.length+room.deckCount+(room.drawnCard===null?0:1),48);
      if(role==='雨四光') {
        assert.equal(room.hyper.trapRemaining[0],3); assert.equal(room.hyper.trapReady[0],true);
        await page.getByRole('button',{name:'罠を指定',exact:true}).click();
        await page.locator('.trap-roulette-result button').first().click();
        await page.locator('.field-slot button.hana-card').first().click();
        await until(()=>room.hyper.trapRemaining[0]===2,'trap budget');
      }
      cases.push(role);
      console.log(`passed ${viewport.width}: ${role}`);
    }
    const contract=room.hyper.contracts[0][0].id;
    const card=room.hand[0], event=room.events.at(-1)?.id ?? 0;
    await page.locator(`.your-hand .hana-card[data-card-id="${card}"]`).click();
    if(await page.locator('.field-target-label').count()>0)await page.locator('.field-slot').filter({has:page.locator('.field-target-label')}).first().locator('.hana-card').click();
    await until(()=>room.events.some(move=>move.id>event && move.player===0),'actual human play');
    await page.locator('.game-page[data-animating="false"]').waitFor();
    const previousVersion=version;
    await page.reload();
    await until(()=>version>previousVersion && room?.id===id && room.hyper.contracts[0][0].id===contract,'reconnect');
    await page.locator('.game-page[data-animating="false"]').waitFor();
    assert.equal(room.practiceRole,'カス');
    const overflow=await page.evaluate(()=>({x:Math.max(0,document.documentElement.scrollWidth-innerWidth)}));
    assert.equal(overflow.x,0);
    await page.screenshot({path:`${output}/practice-${viewport.width}.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    report.tests.push({viewport,roles:cases,realCpu:true,humanPlay:true,trapPlacement:true,reconnect:true,overflow});
    await context.close();
  }
  assert.deepEqual(report.pageErrors,[]);
  await writeFile(`${output}/browser-practice.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
