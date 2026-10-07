import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ storageState: process.argv[2], viewport: { width: 390, height: 844 } })).newPage(); p.setDefaultTimeout(8000);
await p.goto('http://localhost:4200/admin/grades/exams', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
await p.getByRole('button', { name: /篩選/ }).first().click(); await p.waitForTimeout(600);
console.log('dialog labels', (await p.locator('.p-dialog:visible label').allInnerTexts()).join(' / '));
await b.close();
