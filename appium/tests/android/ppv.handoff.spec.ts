// ─────────────────────────────────────────────────────────────────────────────
// DAZN PPV — Android Appium Handoff Test
//
// DEVICE: Samsung Galaxy Z Fold5 (real device, USB/ADB)
// EVENT:  Joshua vs. Prenga
//
// FLOW:
//   1. DAZN app opens on real device (already logged in, noReset=true)
//   2. Dismisses system dialogs / update prompts & landing page interstitials ("Explore")
//   3. Navigates to Buy button based on SOURCE env var:
//        schedule                → Bottom tab → Schedule → scroll to July 25th → find PPV tile → Buy
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

// ── Helper: get screen dimensions dynamically ────────────────────────────────
function getScreenSize(): { width: number; height: number } {
  const output = adb('shell wm size');
  const match = output.match(/(\d+)x(\d+)/);
  if (match) {
    return { width: parseInt(match[1]), height: parseInt(match[2]) };
  }
  return { width: 1080, height: 2340 };
}

// ── Helper: tap screen coordinates via ADB ──────────────────────────────────
function adbTap(x: number, y: number): void {
  adb(`shell input tap ${x} ${y}`);
}

// ── Helper: swipe via ADB ────────────────────────────────────────────────────
function adbSwipe(x1: number, y1: number, x2: number, y2: number): void {
  adb(`shell input swipe ${x1} ${y1} ${x2} ${y2} 150`);
}

// ── Helper: press Back button via ADB ───────────────────────────────────────
function adbBack(): void {
  adb('shell input keyevent 4');
}

// ── Helper: extract DAZN URL from Chrome via ADB UI dump ────────────────────
function getChromeUrl(): string {
  adb('shell uiautomator dump /sdcard/window_dump.xml');
  const dump = adb('shell cat /sdcard/window_dump.xml');
  const m1 = dump.match(/https:\/\/[^\s"']*dazn\.com[^\s"']*/);
  if (m1) return m1[0];
  const tabs = adb('shell content query --uri content://com.android.chrome.FileProvider 2>/dev/null');
  const m2 = tabs.match(/https:\/\/[^\s'"]*dazn\.com[^\s'"]*/);
  if (m2) return m2[0];
  return '';
}

// ── Selector helpers ─────────────────────────────────────────────────────────
async function findEl(driver: WdBrowser, sel: string, timeoutMs = 10000): Promise<WdElement> {
  try {
    const el = await driver.$(sel);
    await el.waitForDisplayed({ timeout: timeoutMs });
    return el;
  } catch { return null; }
}

async function tapByText(driver: WdBrowser, text: string, timeoutMs = 10000): Promise<boolean> {
  const el = await findEl(driver, `android=new UiSelector().textContains("${text}")`, timeoutMs);
  if (!el) return false;
  await el.click();
  return true;
}

async function isVisible(driver: WdBrowser, text: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const el = await driver.$(`android=new UiSelector().textContains("${text}")`);
    await el.waitForDisplayed({ timeout: timeoutMs });
    return true;
  } catch { return false; }
}

// ── App startup: dismiss dialogs using ADB taps (dynamic screen size) ──────
async function dismissStartupDialogs(driver: WdBrowser): Promise<void> {
  const screen = getScreenSize();
  const centerX = Math.round(screen.width / 2);
  
  console.log(`🔍 Dismissing dialogs with ADB taps (screen: ${screen.width}x${screen.height})...`);
  
  const systemDialogY = Math.round(screen.height * 0.15);
  for (let i = 0; i < 3; i++) {
    adbTap(centerX, systemDialogY);
    await driver.pause(500);
  }
  
  console.log('🔍 Clicking "Explore" button on landing page...');
  
  const exploreYPositions = [
    Math.round(screen.height * 0.08),
    Math.round(screen.height * 0.10),
    Math.round(screen.height * 0.12),
    Math.round(screen.height * 0.06),
  ];
  
  const xPositions = [
    Math.round(screen.width * 0.65),
    Math.round(screen.width * 0.70),
    Math.round(screen.width * 0.60),
    Math.round(screen.width * 0.75),
  ];
  
  let exploreClicked = false;
  
  for (const yPos of exploreYPositions) {
    for (const x of xPositions) {
      for (let clickAttempt = 0; clickAttempt < 3; clickAttempt++) {
        console.log(`  Clicking (${x}, ${yPos}) attempt ${clickAttempt + 1}...`);
        adbTap(x, yPos);
        await driver.pause(2500);
        
        if (await isVisible(driver, 'Home', 1500) || await isVisible(driver, 'Schedule', 1500) || 
            await isVisible(driver, 'Sports', 1500) || await isVisible(driver, 'Boxing', 1500)) {
          console.log(`  ✅ "Explore" button clicked at (${x}, ${yPos}) - now on home screen`);
          exploreClicked = true;
          break;
        }
      }
      if (exploreClicked) break;
    }
    if (exploreClicked) break;
  }
  
  if (!exploreClicked) {
    console.log('  Trying Back button fallback...');
    for (let i = 0; i < 5; i++) {
      adbBack();
      await driver.pause(1500);
      if (await isVisible(driver, 'Home', 1000) || await isVisible(driver, 'Schedule', 1000) || 
          await isVisible(driver, 'Sports', 1000)) {
        console.log('  ✅ Navigated to home with Back button');
        exploreClicked = true;
        break;
      }
    }
  }
  
  if (!exploreClicked) {
    console.log('  ⚠️ Could not click Explore button — taking screenshot and continuing');
    await driver.saveScreenshot('./test-results/android_explore_failed.png');
  }
  
  // Dismiss cookie consent popup using exact XPath
  console.log('🍪 Checking for cookie consent popup...');
  
  let cookieDismissed = false;
  
  // Method 1: Use exact XPath from Appium Inspector (most reliable)
  try {
    const acceptBtn = await driver.$(`//android.widget.Button[@resource-id="com.dazn:id/btn_accept_cookies"]`);
    if (await acceptBtn.isDisplayed()) {
      await acceptBtn.click();
      console.log('✅ Cookie popup dismissed (exact XPath)');
      cookieDismissed = true;
      await driver.pause(1500);
    }
  } catch (e) {
    console.log('  Exact XPath not found, trying text methods...');
  }
  
  // Method 2: Try finding Accept button using textContains
  if (!cookieDismissed) {
    for (let cookieAttempt = 0; cookieAttempt < 3; cookieAttempt++) {
      await driver.pause(500);
      
      try {
        const acceptBtn = await driver.$(`android=new UiSelector().textContains("Accept")`);
        if (await acceptBtn.isDisplayed()) {
          await acceptBtn.click();
          console.log('✅ Cookie popup dismissed (textContains)');
          cookieDismissed = true;
          await driver.pause(1500);
          break;
        }
      } catch (e) {}
    }
  }
  
  // Method 3: Try exact button texts
  if (!cookieDismissed) {
    const cookieButtons = ['Accept', 'Essential cookies only', 'Got it', 'OK'];
    
    for (const buttonText of cookieButtons) {
      try {
        const cookieBtn = await driver.$(`android=new UiSelector().text("${buttonText}")`);
        if (await cookieBtn.isDisplayed()) {
          await cookieBtn.click();
          console.log(`✅ Cookie popup dismissed (clicked "${buttonText}")`);
          cookieDismissed = true;
          await driver.pause(1500);
          break;
        }
      } catch (e) {}
    }
  }
  
  // Method 4: Coordinate fallback
  if (!cookieDismissed) {
    const screenSize = getScreenSize();
    const acceptBtnY = Math.round(screenSize.height * 0.78);
    const acceptBtnX = Math.round(screenSize.width * 0.5);
    
    console.log(`  Trying coordinate tap at (${acceptBtnX}, ${acceptBtnY})`);
    adbTap(acceptBtnX, acceptBtnY);
    await driver.pause(1500);
  }
  
  await driver.$(`android=new UiSelector().textContains("Home")`)
    .waitForDisplayed({ timeout: 20000 })
    .catch(() => console.log('  ⚠️ Home text not found — continuing'));
  
  console.log('✅ App loaded\n');
}

// ── Find PPV banner anywhere on screen ───────────────────────────────────────
async function findPPVBanner(driver: WdBrowser): Promise<boolean> {
  if (await isVisible(driver, PPV_NAME, 4000)) return true;
  if (await scrollToText(driver, PPV_NAME)) return true;
  for (let i = 0; i < 5; i++) { await swipeLeft(driver); if (await isVisible(driver, PPV_NAME, 1500)) return true; }
  for (let i = 0; i < 8; i++) { await scrollDown(driver); if (await isVisible(driver, PPV_NAME, 1500)) return true; }
  return false;
}

// ── Navigate to Schedule tab ─────────────────────────────────────────────────
async function navigateToSchedule(driver: WdBrowser): Promise<void> {
  console.log('📅 Navigating to Schedule tab...');
  await driver.saveScreenshot('./test-results/before_schedule_click.png');
  
  // Method 1: Find Schedule by text label (most reliable)
  try {
    const scheduleText = await driver.$(`android=new UiSelector().text("Schedule")`);
    if (await scheduleText.isDisplayed()) {
      await scheduleText.click();
      await driver.pause(3000);
      console.log('✅ Schedule tab clicked (by text)');
      await driver.saveScreenshot('./test-results/after_schedule_click.png');
      return;
    }
  } catch (e) {
    console.log('  Text not found, trying coordinate tap...');
  }
  
  // Method 2: Tap Schedule icon by coordinates (bottom nav, 3rd from left)
  const screenSize = getScreenSize();
  const bottomNavY = Math.round(screenSize.height * 0.92);  // Bottom nav area
  const scheduleX = Math.round(screenSize.width * 0.5);     // 3rd icon (middle)
  
  console.log(`  Tapping Schedule at coordinates (${scheduleX}, ${bottomNavY})`);
  adbTap(scheduleX, bottomNavY);
  await driver.pause(3000);
  await driver.saveScreenshot('./test-results/after_schedule_tap.png');
  
  // Verify we're on Schedule page
  try {
    const scheduleHeader = await driver.$(`android=new UiSelector().text("SCHEDULE")`);
    if (await scheduleHeader.isDisplayed()) {
      console.log('✅ Schedule tab clicked (coordinate tap)');
      return;
    }
  } catch (e) {}
  
  // Method 3: Try tapping different positions (try 2nd, 3rd, 4th icons)
  const iconPositions = [0.25, 0.5, 0.75];  // 25%, 50%, 75% of width
  
  for (const xPercent of iconPositions) {
    const x = Math.round(screenSize.width * xPercent);
    console.log(`  Trying nav icon at x=${x} (${Math.round(xPercent * 100)}%)`);
    adbTap(x, bottomNavY);
    await driver.pause(2000);
    
    try {
      const scheduleHeader = await driver.$(`android=new UiSelector().text("SCHEDULE")`);
      if (await scheduleHeader.isDisplayed()) {
        console.log(`✅ Schedule tab clicked (position ${Math.round(xPercent * 100)}%)`);
        return;
      }
    } catch (e) {}
  }
  
  console.log('⚠️  Could not navigate to Schedule tab');
}

// ── Scroll schedule and find Joshua PPV tile (then center it) ─────
async function scrollScheduleToPPVTile(driver: WdBrowser): Promise<WdElement | null> {
  console.log('  Target: Joshua vs. Prenga (July 25)');
  
  // Step 1: Fast scroll to find "July" header (aggressive swipes)
  console.log('  Step 1: Fast scroll to July...');
  for (let i = 0; i < 20; i++) {
    if (await isVisible(driver, 'July', 300) || await isVisible(driver, 'JUL', 300)) {
      console.log(`  ✅ Found July (step ${i + 1})`);
      break;
    }
    // Bigger, faster scrolls to get through June quickly
    adbSwipe(Math.round(getScreenSize().width / 2), 
             Math.round(getScreenSize().height * 0.75), 
             Math.round(getScreenSize().width / 2), 
             Math.round(getScreenSize().height * 0.20));
    await driver.pause(500);
  }
  
  await driver.pause(1000);
  
  // Step 2: Scroll through July looking for Joshua vs. Prenga
  console.log('  Step 2: Searching July for Joshua...');
  let foundEl: WdElement | null = null;
  
  for (let i = 0; i < 20; i++) {
    // Check for PPV
    try {
      const ppvEl = await driver.$(`//android.widget.TextView[@text="Joshua vs. Prenga"]`);
      if (await ppvEl.isDisplayed()) {
        console.log(`✅ Found "Joshua vs. Prenga" (July step ${i + 1})`);
        
        // Check if it's fully visible (not near bottom nav)
        const rect = await ppvEl.getRect();
        const screenH = getScreenSize().height;
        const bottomNavThreshold = screenH * 0.75;
        
        if (rect.y > bottomNavThreshold) {
          // Tile is too low - scroll it to CENTER of screen
          console.log(`  Tile at y=${rect.y} (near bottom), scrolling to center...`);
          adbSwipe(Math.round(screenH / 2), 0, Math.round(screenH / 2), Math.round(screenH * 0.1));
          await driver.pause(500);
          
          // Small scroll up to bring tile to center
          const scrollUp = Math.round(rect.y - (screenH * 0.4));
          adbSwipe(Math.round(getScreenSize().width / 2), 
                   Math.round(screenH * 0.7), 
                   Math.round(getScreenSize().width / 2), 
                   Math.round(screenH * 0.3));
          await driver.pause(1500);
          
          // Return the re-found element (now centered)
          const centeredEl = await driver.$(`//android.widget.TextView[@text="Joshua vs. Prenga"]`);
          if (await centeredEl.isDisplayed()) {
            const newRect = await centeredEl.getRect();
            console.log(`  ✅ Tile centered at y=${newRect.y}`);
            return centeredEl;
          }
        }
        
        return ppvEl;
      }
    } catch (e) {}
    
    // Stop if we reach August
    if (await isVisible(driver, 'August', 200) || await isVisible(driver, 'AUG', 200)) {
      console.log('  ⚠️ Reached August - stopping');
      break;
    }
    
    // Gentle swipe through July
    adbSwipe(Math.round(getScreenSize().width / 2), 
             Math.round(getScreenSize().height * 0.55), 
             Math.round(getScreenSize().width / 2), 
             Math.round(getScreenSize().height * 0.45));
    await driver.pause(800);
  }
  
  return null;
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
  if (await tapByText(driver, 'Boxing', 5000)) { await driver.pause(2000); return; }
  console.log('⚠️  Could not confirm Boxing page — continuing from current screen');
}

// ── Capture checkout URL from WebView / Chrome Custom Tab ────────────────────
async function captureCheckoutUrl(driver: WdBrowser): Promise<string> {
  for (let attempt = 0; attempt < 15; attempt++) {
    await driver.pause(1000);
    try {
      const contexts = await driver.getContexts() as string[];
      const webCtx = contexts.find(
        (c) => c !== 'NATIVE_APP' && (c.includes('WEBVIEW') || c.includes('CHROMIUM') || c.includes('CDP')),
      );
      if (webCtx) {
        await driver.switchContext(webCtx);
        const url = await driver.getUrl();
        if (url && url.includes('dazn.com')) return url;
        await driver.switchContext('NATIVE_APP').catch(() => {});
      }
    } catch { }
    if (attempt % 3 === 2) {
      const adbUrl = getChromeUrl();
      if (adbUrl.includes('dazn.com')) return adbUrl;
    }
  }
  return getChromeUrl();
}

// ── Navigation helpers ───────────────────────────────────────────────────────
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

// ════════════════════════════════════════════════════════════════════════════
// TEST
// ════════════════════════════════════════════════════════════════════════════
describe('DAZN Android PPV → Web Handoff', () => {
  before(async () => {
    clearHandoffUrl();
    require('fs').mkdirSync('./test-results', { recursive: true });
    console.log(`\n╔════════════════════════════════════════════════════╗`);
    console.log(`║  DAZN Android PPV Handoff                          ║`);
    console.log(`║  Event  : ${PPV_NAME.padEnd(40)}║`);
    console.log(`║  Source : ${SOURCE.padEnd(40)}║`);
    console.log(`╚════════════════════════════════════════════════════╝\n`);
  });

  it('navigates to PPV buy button, opens Chrome, captures checkout URL', async () => {
    const driver = browser;
    await driver.pause(5000);

    await dismissStartupDialogs(driver);

    let buyTapped = false;

    if (SOURCE === 'schedule') {
      console.log('📅 Navigating to Schedule page...');
      
      await navigateToSchedule(driver);
      await driver.pause(3000);
      
      let onSchedule = false;
      let onBoxing = false;
      
      try {
        const scheduleHeader = await driver.$(`android=new UiSelector().text("SCHEDULE")`);
        onSchedule = await scheduleHeader.isDisplayed();
      } catch (e) {}
      
      try {
        const boxingHeader = await driver.$(`android=new UiSelector().text("Boxing")`);
        onBoxing = await boxingHeader.isDisplayed();
      } catch (e) {}
      
      if (onBoxing && !onSchedule) {
        await driver.saveScreenshot('./test-results/wrong_page_clicked.png');
        throw new Error('❌ Clicked Boxing tab instead of Schedule! Test STOPPED.');
      }
      
      if (onSchedule) {
        console.log('✅ On Schedule page');
        await driver.pause(2000);
        
        console.log('Clicking Boxing filter...');
        try {
          const boxingEl = await driver.$(`//android.widget.TextView[@text="Boxing"]`);
          if (await boxingEl.isDisplayed()) {
            await boxingEl.click();
            console.log('✅ Boxing filter clicked (XPath)');
          }
        } catch (e) {
          console.log('  XPath failed, trying UiSelector...');
          const boxingEl = await driver.$(`android=new UiSelector().text("Boxing")`);
          if (await boxingEl.isDisplayed()) {
            await boxingEl.click();
            console.log('✅ Boxing filter clicked (UiSelector)');
          }
        }
        await driver.pause(3000);
        
        console.log(`Finding ${PPV_NAME}...`);
        await driver.pause(5000);
        
        console.log(`Scrolling to ${PPV_NAME}...`);
        const ppvElement = await scrollScheduleToPPVTile(driver);
        
        // Click the PPV tile using exact XPath (most reliable)
        await driver.pause(1000);
        try {
          const ppvTile = await driver.$(`//android.widget.TextView[@text="Joshua vs. Prenga"]`);
          await ppvTile.click();
          console.log(`✅ Clicked Joshua vs. Prenga tile`);
        } catch (e) {
          console.log('⚠️ Could not click PPV tile');
        }
        
        await driver.pause(2000);
        
        for (const cta of ['Buy now', 'Buy Now', 'Buy']) {
          if (await tapByText(driver, cta, 5000)) {
            buyTapped = true;
            console.log(`✅ Tapped ${cta}`);
            break;
          }
        }
      } else {
        await driver.saveScreenshot('./test-results/schedule_navigation_failed.png');
        throw new Error('❌ Neither Schedule nor Boxing detected. Test STOPPED.');
      }
    }

    // ── boxing-upcoming-fights ────────────────────────────────────────────
    else if (SOURCE === 'boxing-upcoming-fights') {
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

    // ── boxing-page-banner ────────────────────────────────────────────────
    else if (SOURCE === 'boxing-page-banner') {
      await navigateToBoxingPage(driver);
      await driver.pause(1500);
      for (const cta of ['Buy this fight', 'Buy now', 'Buy Now', 'Buy']) {
        if (await tapByText(driver, cta, 7000)) { buyTapped = true; console.log(`✅ Tapped "${cta}"`); break; }
      }
    }

    // ── home-boxing-banner ────────────────────────────────────────────────
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

    // ── home-boxing-tile ──────────────────────────────────────────────────
    else if (SOURCE === 'home-boxing-tile') {
      await scrollToText(driver, PPV_NAME);
      await tapByText(driver, PPV_NAME, 8000);
      await driver.pause(2000);
      for (const cta of ['Buy now', 'Buy Now', 'Buy']) {
        if (await tapByText(driver, cta, 6000)) { buyTapped = true; break; }
      }
    }

    // ── fallback ──────────────────────────────────────────────────────────
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
      throw new Error(`❌ Could not tap Buy CTA. SOURCE="${SOURCE}". See test-results/android_buy_not_found.png`);
    }

    await driver.pause(3000);
    await driver.saveScreenshot('./test-results/android_buy_tapped.png');
    console.log('\n⏳ Waiting for Chrome Custom Tab to open...');

    // ── Step 3: Capture checkout URL from Chrome Custom Tab ───────────────
    console.log('📋 Capturing checkout URL...');
    
    let checkoutUrl = '';
    
    // Method 1: Switch to WebView context (most reliable)
    console.log('  Trying WebView context...');
    try {
      const contexts = await driver.getContexts();
      const webContext = contexts.find((c: string) => 
        c.includes('WEBVIEW') || c.includes('CHROMIUM') || c.includes('CDP')
      );
      
      if (webContext) {
        await driver.switchContext(webContext);
        checkoutUrl = await driver.getUrl();
        console.log(`  WebView URL: ${checkoutUrl}`);
        if (checkoutUrl && checkoutUrl.includes('dazn.com')) {
          console.log('✅ URL captured from WebView context');
        }
        await driver.switchContext('NATIVE_APP');
      }
    } catch (e) {
      console.log('  WebView context failed');
    }
    
    // Method 2: Get URL from Chrome UI dump
    if (!checkoutUrl || !checkoutUrl.includes('dazn.com')) {
      console.log('  Trying Chrome UI dump...');
      checkoutUrl = getChromeUrl();
      if (checkoutUrl && checkoutUrl.includes('dazn.com')) {
        console.log('✅ URL captured from Chrome UI dump');
      }
    }
    
    // Method 3: Get URL from text field on screen
    if (!checkoutUrl || !checkoutUrl.includes('dazn.com')) {
      console.log('  Trying text field...');
      try {
        const urlField = await driver.$(`android=new UiSelector().textContains("dazn.com")`);
        if (await urlField.isDisplayed()) {
          checkoutUrl = await urlField.getText();
          console.log('✅ URL captured from text field');
        }
      } catch (e) {
        console.log('  Text field method failed');
      }
    }
    
    if (!checkoutUrl || !checkoutUrl.includes('dazn.com')) {
      await driver.saveScreenshot('./test-results/android_url_not_found.png');
      throw new Error(`❌ Could not capture checkout URL from paywall.\n   See test-results/android_url_not_found.png`);
    }

    console.log(`\n🌐 Checkout URL captured:\n   ${checkoutUrl}\n`);
    writeHandoffUrl(checkoutUrl);
    console.log('✅ URL written to mobile_entry_url.txt');
    console.log('📱 Next: Open browser, paste URL, and complete web flow');
  });
});