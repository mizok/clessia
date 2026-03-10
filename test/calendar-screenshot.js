#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const BASE_URL = 'http://localhost:4200';
const TARGET_URL = `${BASE_URL}/admin/calendar`;
const SCREENSHOT_DIR = '/tmp/calendar-screenshots';

const LOGIN_EMAIL = 'admin@clessia.dev';
const LOGIN_PASSWORD = 'password123';

const stepResults = [];
process.env.PLAYWRIGHT_DISABLE_HEADLESS_SHELL ??= '1';

function recordStep(step, description, ok, detail = '') {
  const status = ok ? '成功' : '失敗';
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`[${status}] Step ${step}: ${description}${suffix}`);
  stepResults.push({ step, description, status, detail });
}

async function runStep(step, description, action, options = {}) {
  const { fatal = false } = options;

  try {
    const detail = await action();
    recordStep(step, description, true, typeof detail === 'string' ? detail : '');
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    recordStep(step, description, false, detail);
    if (fatal) {
      throw error;
    }
    return false;
  }
}

async function waitForCalendarStable(page) {
  try {
    await page.waitForSelector('.cal', { state: 'visible', timeout: 10000 });
    return 'selector';
  } catch {
    await page.waitForTimeout(2000);
    return 'timeout';
  }
}

async function launchBrowserWithFallback(chromium) {
  const attempts = [
    { name: 'headless-default', options: { headless: true } },
    { name: 'headless-channel-chromium', options: { headless: true, channel: 'chromium' } },
    { name: 'headed-channel-chromium', options: { headless: false, channel: 'chromium' } },
  ];

  const errors = [];
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch(attempt.options);
      return browser;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${attempt.name}: ${message}`);
    }
  }

  throw new Error(errors.join(' | '));
}

async function ensureLoggedIn(page) {
  const url = page.url();
  const loginVisible = await page.locator('#email').first().isVisible().catch(() => false);

  if (!url.includes('/login') && !loginVisible) {
    return;
  }

  await page.waitForSelector('#email', { state: 'visible', timeout: 10000 });
  await page.fill('#email', LOGIN_EMAIL);
  await page.fill('#password', LOGIN_PASSWORD);

  const submitButton = page.locator('button[type="submit"]');
  await submitButton.first().click();

  await Promise.race([
    page.waitForSelector('.cal', { state: 'visible', timeout: 15000 }).catch(() => null),
    page.waitForURL((nextUrl) => !nextUrl.href.includes('/login'), { timeout: 15000 }).catch(() => null),
  ]);

  const rolePicker = page.locator('.select-role__option:has-text("管理者")');
  if (await rolePicker.first().isVisible().catch(() => false)) {
    await rolePicker.first().click();
    await page.waitForTimeout(800);
  }

  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
}

async function clickNextWeek(page) {
  const candidates = [
    '.cal__nav button[aria-label*="下週"]',
    '.cal__nav button[aria-label*="下一週"]',
    '.cal__nav button:has(.pi-chevron-right)',
  ];

  for (const selector of candidates) {
    const button = page.locator(selector).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return;
    }
  }

  const byText = page.getByRole('button', { name: /下週|下一週|chevron-right/i }).first();
  if (await byText.isVisible().catch(() => false)) {
    await byText.click();
    return;
  }

  throw new Error('找不到「下週」按鈕');
}

async function clickToday(page) {
  const byLabel = page.getByRole('button', { name: '今天' }).first();
  if (await byLabel.isVisible().catch(() => false)) {
    await byLabel.click();
    return;
  }

  const fallback = page.locator('.cal__nav button:has-text("今天")').first();
  if (await fallback.isVisible().catch(() => false)) {
    await fallback.click();
    return;
  }

  throw new Error('找不到「今天」按鈕');
}

(async function main() {
  let browser;

  try {
    let chromium;
    try {
      ({ chromium } = require('playwright'));
    } catch {
      throw new Error('尚未安裝 playwright，請先執行: npm i -D playwright');
    }

    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

    await runStep(1, '啟動 Playwright（chromium，viewport 1280x800）', async () => {
      browser = await launchBrowserWithFallback(chromium);
    }, { fatal: true });

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    await runStep(2, `導航到 ${TARGET_URL}`, async () => {
      await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await ensureLoggedIn(page);
    }, { fatal: true });

    await runStep(3, '等待頁面穩定（.cal 出現，或等 2 秒）', async () => {
      await waitForCalendarStable(page);
    });

    await runStep(4, '截圖 01-calendar-week-view.png', async () => {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '01-calendar-week-view.png'),
        fullPage: true,
      });
    });

    await runStep(5, '點擊「下週」按鈕並等 1 秒', async () => {
      await clickNextWeek(page);
      await page.waitForTimeout(1000);
    });

    await runStep(6, '截圖 02-next-week.png', async () => {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '02-next-week.png'),
        fullPage: true,
      });
    });

    await runStep(7, '點擊「今天」按鈕並等 1 秒', async () => {
      await clickToday(page);
      await page.waitForTimeout(1000);
    });

    await runStep(8, '截圖 03-back-today.png', async () => {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '03-back-today.png'),
        fullPage: true,
      });
    });

    await runStep(9, '若有 .cal__session，點第一個並截圖 04-session-detail.png', async () => {
      await page.waitForSelector('.cal', { state: 'visible', timeout: 5000 });
      const sessions = page.locator('.cal__session');
      const count = await sessions.count();

      if (count === 0) {
        return '無 session，略過';
      }

      await sessions.first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '04-session-detail.png'),
        fullPage: true,
      });
    });

    await runStep(10, '縮小視窗到 375x812 並等 1 秒', async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(1000);
    });

    await runStep(11, '截圖 05-mobile-view.png', async () => {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '05-mobile-view.png'),
        fullPage: true,
      });
    });

    await runStep(12, '關閉瀏覽器', async () => {
      await context.close();
      await browser.close();
      browser = undefined;
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`\n流程中止：${detail}`);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }

    console.log('\n=== Step Summary ===');
    for (const result of stepResults.sort((a, b) => a.step - b.step)) {
      const detail = result.detail ? ` (${result.detail})` : '';
      console.log(`Step ${result.step}: ${result.description} -> ${result.status}${detail}`);
    }
    console.log(`\n截圖目錄：${SCREENSHOT_DIR}`);
  }
})();
