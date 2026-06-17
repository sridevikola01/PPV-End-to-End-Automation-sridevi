// ─────────────────────────────────────────────────────────────────────────────
// DAZN PPV — Android Appium Handoff Test
//
// DEVICE: Samsung Galaxy Z Fold5 (real device, USB/ADB)
// EVENT:  Joshua vs. Prenga
//
// FLOW:
//   1. DAZN app opens on real device (already logged in, noReset=true)
//   2. Dismisses system dialogs / update prompts
//   3. Navigates to Buy button based on SOURCE env var:
//        boxing-upcoming-fights  → Sports tab → Boxing → Upcoming Big Fights → Buy now
//        boxing-page-banner      → Sports tab → Boxing → hero banner → Buy this fight
//        home-boxing-banner      → Home hero banner → Buy
//        home-boxing-tile        → Home Boxing rail → Buy
//   4. App opens Chrome Custom Tab with DAZN checkout URL
//   5. Captures URL via WebView context switch or ADB fallback
//   6. Writes URL to mobile_entry_url.txt  ← Playwright reads this
//
// HOW TO RUN:
//   cd appium && npm run android
//   Overrides: PPV_NAME="Joshua" SOURCE="boxing-upcoming-fights" npm run android
//
// ENV VARS:
//   PPV_NAME     : partial text on screen  (default: Joshua)
//   SOURCE       : surfacing point         (default: boxing-upcoming-fights)
//   APP_PACKAGE  : DAZN package            (default: com.dazn)
//   DEVICE_NAME  : ADB device name         (default: Galaxy Z Fold5)
// ─────────────────────────────────────────────────────────────────────────────

// WebdriverIO injects `browser` as a global at runtime — declare so TS is happy.
// eslint-disable-next-line no-var
declare var browser: any;
// Type alias so helper signatures are readable but not blocked by missing @wdio/globals
type WdBrowser = any;
type WdElement = any;

import { execSync } from 'child_process';
import { writeHandoffUrl, clearHandoffUrl } from '../../utils/handoff';

// ── Config ───────────────────────────────────────────────────────────────────
const PPV_NAME    = process.env.PPV_NAME    || 'Joshua';
const SOURCE      = process.env.SOURCE      || 'boxing-upcoming-fights';
const APP_PACKAGE = process.env.APP_PACKAGE || 'com.dazn';
const ANDROID_SDK = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
const ADB         = `${ANDROID_SDK}/platform-tools/adb`;

// ── Helper: run ADB command ──────────────────────────────────────────────────
function adb(cmd: string): string {
  try {
    return execSync(`${ADB} ${cmd}`, { encoding: 'utf-8', timeout: 15000 }).trim();
  } catch {
    return '';
  }
}

// ── Helper: extract DAZN URL from Chrome via ADB UI dump ────────────────────
function getChromeUrl(): string {
  // Dump Chrome window XML and parse URL out
  adb('shell uiautomator dump /sdcard/window_dump.xml');
  const dump = adb('shell cat /sdcard/window_dump.xml');
  const m1 = dump.match(/https:\/\/[^\s"']*dazn\.com[^\s"']*/);
  if (m1) return m1[0];

  // Chrome content provider fallback
  const tabs = adb('shell content query --uri content://com.android.chrome.FileProvider 2>/dev/null');
  const m2 = tabs.match(/https:\/\/[^\s'"]*dazn\.com[^\s'"]*/);
  if (m2) return m2[0];

  return '';
}

// ── Selector helpers ─────────────────────────────────────────────────────────
async function findEl(
  driver: WdBrowser, sel: string, timeoutMs = 10000,
): Promise<WdElement> {
  try {
    const el = await driver.$(sel);
    await el.waitForDisplayed({ timeout: timeoutMs });
    return el;
  } catch { return null; }
}

async function tapByText(
  driver: WdBrowser, text: string, timeoutMs = 10000,
): Promise<boolean> {
  const el = await findEl(driver, `android=new UiSelector().textContains("${text}")`, timeoutMs);
  if (!el) return false;
  await el.click();
  return true;
}

async function isVisible(
  driver: WdBrowser, text: string, timeoutMs = 3000,
): Promise<boolean> {
  try {
    const el = await driver.$(`android=new UiSelector().textContains("${text}")`);
    await el.waitForDisplayed({ timeout: timeoutMs });
    return true;
  } catch { return false; }
}

async function scrollToText(driver: WdBrowser, text: string): Promise<boolean> {
  try {
    const el = await driver.$(
      `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(` +
      `new UiSelector().textContains("${text}"))`,
    );
    return await el.isDisplayed();
  } catch { return false; }
}

async function swipeLeft(driver: WdBrowser): Promise<void> {
  const { width, height } = await driver.getWindowSize();
  await driver.action('pointer')
    .move({ x: Math.round(width * 0.8), y: Math.round(height * 0.35) })
    .down().move({ x: Math.round(width * 0.2), y: Math.round(height * 0.35) }).up().perform();
  await driver.pause(800);
}

async function scrollDown(driver: WdBrowser): Promise<void> {
  const { width, height } = await driver.getWindowSize();
  await driver.action('pointer')
    .move({ x: Math.round(width / 2), y: Math.round(height * 0.75) })
    .down().move({ x: Math.round(width / 2), y: Math.round(height * 0.25) }).up().perform();
  await driver.pause(600);
}

// ── Dismiss system dialogs ───────────────────────────────────────────────────
async function dismissSystemDialogs(driver: WdBrowser): Promise<void> {
  for (const label of ['Not now', 'Skip', 'Later', 'Dismiss', 'Allow', 'OK', 'Continue', 'Got it']) {
    try {
      const el = await driver.$(`android=new UiSelector().textMatches("(?i)${label}")`);
      await el.waitForDisplayed({ timeout: 1200 });
      await el.click().catch(() => {});
      await driver.pause(400);
    } catch { /* not present */ }
  }
}

// ── Find PPV banner anywhere on screen ───────────────────────────────────────
async function findPPVBanner(driver: WdBrowser): Promise<boolean> {
  if (await isVisible(driver, PPV_NAME, 4000)) return true;
  if (await scrollToText(driver, PPV_NAME)) return true;
  for (let i = 0; i < 5; i++) { await swipeLeft(driver); if (await isVisible(driver, PPV_NAME, 1500)) return true; }
  for (let i = 0; i < 8; i++) { await scrollDown(driver); if (await isVisible(driver, PPV_NAME, 1500)) return true; }
  return false;
}

// ── Navigate to Boxing page via Sports nav tab ───────────────────────────────
async function navigateToBoxingPage(driver: WdBrowser): Promise<void> {
  console.log('🥊 Navigating to Boxing page via Sports tab...');
  const sportsTapped = await tapByText(driver, 'Sports', 5000) || await tapByText(driver, 'Sport', 4000);
  if (sportsTapped) {
    await driver.pause(1500);
    if (await scrollToText(driver, 'Boxing') || await tapByText(driver, 'Boxing', 6000)) {
      await driver.pause(2000);
      console.log('✅ On Boxing page');
      return;
    }
  }
  // Fallback: tap Boxing from current screen
  if (await tapByText(driver, 'Boxing', 5000)) { await driver.pause(2000); return; }
  console.log('⚠️  Could not confirm Boxing page — continuing from current screen');
}

// ── Capture checkout URL from WebView / Chrome Custom Tab ────────────────────
async function captureCheckoutUrl(driver: WdBrowser): Promise<string> {
  for (let attempt = 0; attempt < 15; attempt++) {
    await driver.pause(1000);
    try {
      const contexts = await driver.getContexts() as string[];
      console.log(`  Contexts (attempt ${attempt + 1}): ${contexts.join(', ')}`);
      const webCtx = contexts.find(
        (c) => c !== 'NATIVE_APP' && (c.includes('WEBVIEW') || c.includes('CHROMIUM') || c.includes('CDP')),
      );
      if (webCtx) {
        await driver.switchContext(webCtx);
        const url = await driver.getUrl();
        if (url && url.includes('dazn.com')) return url;
        await driver.switchContext('NATIVE_APP').catch(() => {});
      }
    } catch { /* context not ready */ }
    if (attempt % 3 === 2) {
      const adbUrl = getChromeUrl();
      if (adbUrl.includes('dazn.com')) return adbUrl;
    }
  }
  // Final fallbacks
  const finalAdbUrl = getChromeUrl();
  if (finalAdbUrl.includes('dazn.com')) return finalAdbUrl;
  try {
    await driver.switchContext('NATIVE_APP').catch(() => {});
    const bar = await driver.$('android=new UiSelector().resourceId("com.android.chrome:id/url_bar")');
    await bar.waitForDisplayed({ timeout: 3000 });
    const text = await bar.getText();
    if (text && text.includes('dazn')) return text.startsWith('http') ? text : `https://${text}`;
  } catch { }
  return '';
}

// ════════════════════════════════════════════════════════════════════════════
// TEST
// ════════════════════════════════════════════════════════════════════════════
describe('DAZN Android PPV → Web Handoff', () => {
  before(async () => {
    clearHandoffUrl();
    // Ensure output folder exists before any saveScreenshot calls
    require('fs').mkdirSync('./test-results', { recursive: true });
    console.log(`\n╔════════════════════════════════════════════════════╗`);
    console.log(`║  DAZN Android PPV Handoff                          ║`);
    console.log(`║  Event  : ${PPV_NAME.padEnd(40)}║`);
    console.log(`║  Source : ${SOURCE.padEnd(40)}║`);
    console.log(`╚════════════════════════════════════════════════════╝\n`);
  });

  it('navigates to PPV buy button, opens Chrome, captures checkout URL', async () => {
    const driver = browser;

    // ── Step 1: App startup ───────────────────────────────────────────────────
    console.log('⏳ Waiting for app to load...');
    await driver.pause(4000);
    await dismissSystemDialogs(driver);
    await driver.$(`android=new UiSelector().textContains("Home")`)
      .waitForDisplayed({ timeout: 25000 })
      .catch(() => console.log('⚠️  Home text not found — continuing'));
    console.log('✅ App loaded\n');

    let buyTapped = false;

    // ── boxing-upcoming-fights ────────────────────────────────────────────────
    if (SOURCE === 'boxing-upcoming-fights') {
      await navigateToBoxingPage(driver);
      console.log(`🔍 Searching for "${PPV_NAME}" in Upcoming Big Fights...`);

      let found = await findPPVBanner(driver);
      if (!found) {
        for (let i = 0; i < 12; i++) {
          await scrollDown(driver);
          if (await isVisible(driver, PPV_NAME, 1200)) { found = true; break; }
        }
      }
      if (!found) {
        await driver.saveScreenshot('./test-results/android_boxing_debug.png');
        require('fs').writeFileSync('./test-results/android_boxing_source.xml', await driver.getPageSource());
        throw new Error(`❌ "${PPV_NAME}" not found on Boxing page. Check test-results/android_boxing_debug.png`);
      }

      console.log(`✅ Found "${PPV_NAME}" — tapping card...`);
      await driver.saveScreenshot('./test-results/android_ppv_found.png');
      await tapByText(driver, PPV_NAME);
      await driver.pause(2500);
      await driver.saveScreenshot('./test-results/android_ppv_detail.png');

      for (const cta of ['Buy now', 'Buy Now', 'Buy', 'Get PPV', 'Purchase']) {
        if (await tapByText(driver, cta, 6000)) { buyTapped = true; console.log(`✅ Tapped "${cta}"`); break; }
      }
      if (!buyTapped) {
        for (let i = 0; i < 4; i++) {
          await scrollDown(driver);
          for (const cta of ['Buy now', 'Buy Now', 'Buy', 'Get PPV']) {
            if (await tapByText(driver, cta, 2000)) { buyTapped = true; console.log(`✅ Tapped "${cta}" after scroll`); break; }
          }
          if (buyTapped) break;
        }
      }
    }

    // ── boxing-page-banner ────────────────────────────────────────────────────
    else if (SOURCE === 'boxing-page-banner') {
      await navigateToBoxingPage(driver);
      await driver.pause(1500);
      for (const cta of ['Buy this fight', 'Buy now', 'Buy Now', 'Buy']) {
        if (await tapByText(driver, cta, 7000)) { buyTapped = true; console.log(`✅ Tapped "${cta}"`); break; }
      }
    }

    // ── home-boxing-banner ────────────────────────────────────────────────────
    else if (SOURCE === 'home-boxing-banner') {
      if (!await findPPVBanner(driver)) {
        await driver.saveScreenshot('./test-results/android_home_debug.png');
        throw new Error(`❌ PPV banner "${PPV_NAME}" not found on Home`);
      }
      await tapByText(driver, PPV_NAME);
      await driver.pause(2000);
      for (const cta of ['Buy now', 'Buy Now', 'Buy', 'Get PPV']) {
        if (await tapByText(driver, cta, 6000)) { buyTapped = true; break; }
      }
    }

    // ── home-boxing-tile ──────────────────────────────────────────────────────
    else if (SOURCE === 'home-boxing-tile') {
      await scrollToText(driver, PPV_NAME);
      await tapByText(driver, PPV_NAME, 8000);
      await driver.pause(2000);
      for (const cta of ['Buy now', 'Buy Now', 'Buy']) {
        if (await tapByText(driver, cta, 6000)) { buyTapped = true; break; }
      }
    }

    // ── fallback ──────────────────────────────────────────────────────────────
    else {
      console.log(`⚠️  Unknown SOURCE "${SOURCE}" — generic Home screen fallback`);
      if (!await findPPVBanner(driver)) throw new Error(`❌ "${PPV_NAME}" not found`);
      await tapByText(driver, PPV_NAME);
      await driver.pause(2000);
      for (const cta of ['Buy now', 'Buy Now', 'Buy']) {
        if (await tapByText(driver, cta, 6000)) { buyTapped = true; break; }
      }
    }

    if (!buyTapped) {
      await driver.saveScreenshot('./test-results/android_buy_not_found.png');
      require('fs').writeFileSync('./test-results/android_buy_not_found_source.xml', await driver.getPageSource());
      throw new Error(`❌ Could not tap Buy CTA. SOURCE="${SOURCE}". See test-results/android_buy_not_found.png`);
    }

    await driver.pause(3000);
    await driver.saveScreenshot('./test-results/android_buy_tapped.png');
    console.log('\n⏳ Waiting for Chrome Custom Tab to open...');

    // ── Step 3: Capture checkout URL ──────────────────────────────────────────
    const checkoutUrl = await captureCheckoutUrl(driver);

    if (!checkoutUrl || !checkoutUrl.includes('dazn.com')) {
      await driver.saveScreenshot('./test-results/android_chrome_debug.png');
      throw new Error(
        `❌ Could not capture checkout URL.\n` +
        `   Got: "${checkoutUrl}"\n` +
        `   See test-results/android_chrome_debug.png`,
      );
    }

    console.log(`\n🌐 Checkout URL captured:\n   ${checkoutUrl}\n`);
    writeHandoffUrl(checkoutUrl);
    console.log('✅ URL written to mobile_entry_url.txt — run_mobile_test.sh will validate it');
  });
});
