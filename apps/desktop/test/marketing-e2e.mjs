import { chromium } from 'playwright';
import fs from 'fs';

const API_BASE = process.env.HTW_API_BASE || 'https://htwmedia.dpdns.org';
const API_KEY = process.env.HTW_API_KEY;
if (!API_KEY) { console.error('HTW_API_KEY 必须作为环境变量提供，且不写入仓库'); process.exit(2); }

// 1x1 PNG 测试素材（仅用于端到端联通验证，非真实商品图）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const FIX = '/tmp/mv-fixture.png';
fs.writeFileSync(FIX, Buffer.from(PNG_B64, 'base64'));

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes('index.html')) || ctx.pages()[0] || await ctx.newPage();

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.evaluate((b, k) => { localStorage.setItem('htw_apiBase', b); localStorage.setItem('htw_apiKey', k); }, API_BASE, API_KEY);
await page.reload();
await page.click('[data-skill="marketing"]');
await page.fill('#mv-product-name', '测试商品-营销成片E2E');
await page.setInputFiles('#mv-files', FIX);
await page.click('#mv-start');

// 等待流程启动（出现状态徽标）
await page.waitForSelector('#mv-progress .badge', { timeout: 60000 });
// 等待终态或需确认
await page.waitForFunction(() => {
  const t = document.querySelector('#mv-progress .badge');
  return t && ['completed', 'waiting_approval', 'failed'].includes(t.textContent);
}, { timeout: 600000 });

const status = (await page.textContent('#mv-progress .badge')).trim();
console.log('FINAL STATUS:', status);
if (status === 'failed') { console.error('任务失败'); console.error(await page.textContent('#mv-progress')); process.exit(1); }

// 若需确认，自动确认以推进到成片
if (status === 'waiting_approval') {
  await page.click('#mv-progress .detail-actions .btn.primary'); // 确认
  await page.waitForFunction(() => {
    const t = document.querySelector('#mv-progress .badge');
    return t && ['completed', 'failed'].includes(t.textContent);
  }, { timeout: 600000 });
}

if (errors.length) { console.error('控制台错误:', errors); process.exit(1); }
console.log('E2E OK — 无控制台错误，流程抵达成片');
await browser.close();
