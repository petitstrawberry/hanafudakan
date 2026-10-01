/** Synthetic GameRoom UI checks; authoritative rules/transport are covered by Rust.
 * Requires the Vite dev server. QA_BASE_URL defaults to localhost:5173.
 * Use PLAYWRIGHT_MODULE / QA_CHROMIUM_PATH for an existing local browser install.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE_URL || 'http://localhost:5173';
const output = 'artifacts/issue-9';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
const report = { evidence: 'Synthetic snapshots in the actual GameRoom component, not real-server E2E.', tests: [], pageErrors: [] };
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      localStorage.setItem('hana-sound', 'false');
      localStorage.setItem('hana-music', 'false');
      localStorage.setItem('hana-motion', 'false');
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    await page.goto(`${base}/qa/hyper.html`);
    await page.getByText('補助UI試験（合成局面）', { exact: true }).click();
    await page.getByRole('button', { name: '伏兵・ダメージ予告', exact: true }).click();
    await page.getByRole('button', { name: '罠を指定', exact: true }).click();
    await page.getByRole('button', { name: '罠を取消', exact: true }).click();
    assert.equal(await page.locator('.field-trapped').count(), 0);
    await page.getByRole('button', { name: '罠を指定', exact: true }).click();
    await page.locator('.trap-choice-panel button').filter({ hasText: '徴収' }).click();
    await page.locator('.field-slot .hana-card[data-card-id="9"]').click();
    await page.waitForFunction(() => document.querySelector('.field-trap-label')?.textContent?.includes('あなたの罠'));
    assert.equal(await page.getByRole('button', { name: '罠を指定', exact: true }).count(), 0);
    await page.locator('.your-hand .hana-card[data-card-id="0"]').click();
    assert.match(await page.locator('.field-target-label').innerText(), /相手 −4 \/ 力4/);
    assert.match(await page.locator('.field-slot .hana-card[data-card-id="1"]').getAttribute('title'), /札2＋初撃2/);
    await page.getByText('攻撃内訳', { exact: true }).click();
    assert.match(await page.locator('.combat-preview').innerText(), /威力4 \/ HP減少4（32→28）/);
    const overflow = await page.evaluate(() => ({ x: Math.max(0, document.documentElement.scrollWidth - innerWidth), y: Math.max(0, document.documentElement.scrollHeight - innerHeight) }));
    assert.deepEqual(overflow, { x: 0, y: 0 });
    await page.screenshot({ path: `${output}/combat-${viewport.width}.png`, fullPage: true });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByText('補助UI試験（合成局面）', { exact: true }).click();
    await page.getByRole('button', { name: '攻撃履歴を見る', exact: true }).click();
    await page.getByText('攻撃履歴', { exact: true }).click();
    assert.match(await page.locator('.combat-history').innerText(), /威力4 \/ HP減少4（32→28）/);
    await page.screenshot({ path: `${output}/history-${viewport.width}.png`, fullPage: true });
    await page.getByText('補助UI試験（合成局面）', { exact: true }).click();
    await page.getByRole('button', { name: 'めくり・ダメージ予告', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '罠を指定', exact: true }).count(), 0);
    await page.getByText('攻撃内訳', { exact: true }).click();
    assert.doesNotMatch(await page.locator('.combat-preview').innerText(), /罠4/);
    assert.equal(await page.locator('.field-slot.match-target').count(), 2);
    await page.screenshot({ path: `${output}/drawn-combat-${viewport.width}.png`, fullPage: true });
    await page.getByText('補助UI試験（合成局面）', { exact: true }).click();
    await page.getByRole('button', { name: '双方HP演出（旧イベント互換）', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.hyper-hp meter').length === 2 && [...document.querySelectorAll('.hyper-hp meter')].every(m => m.value === 0), { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('.hp-attack-overlay'), { timeout: 15000 });
    await page.screenshot({ path: `${output}/mutual-ko-${viewport.width}.png`, fullPage: true });
    report.tests.push({ viewport, trapCancelAndPlacement: true, onePlacementBudget: true, forecastAndBreakdown: true, drawnChoiceForecast: true, readableAttackHistory: true, bothHpZero: true, overflow });
    await context.close();
  }
  assert.deepEqual(report.pageErrors, []);
} finally {
  await writeFile(`${output}/browser-combat.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
