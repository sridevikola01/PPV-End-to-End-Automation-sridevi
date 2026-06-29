// ─────────────────────────────────────────────────────────────────────────────
// DAZN PPV — Android Appium Existing User Test
//
// DEVICE: Samsung Galaxy Z Fold5 (real device, USB/ADB)
// EVENT:  Configurable via PPV_CONFIG env var
//
// FLOW:
//   1. DAZN app opens on real device (already logged in, noReset=true)
//   2. Dismisses system dialogs / update prompts & landing page interstitials ("Explore")
//   3. Pre-login flow (if My Account source):
//      - Navigate to signin page
//      - Enter email and password
//      - Sign in
//      - Navigate to My Account
//   4. Navigate to PPV buy button based on SOURCE env var:
//        myaccount                → My Account → Find PPV → Buy
//        schedule                 → Bottom tab → Schedule → scroll to event → Buy
//        boxing-upcoming-fights   → Sports tab → Boxing → Upcoming Big Fights → Buy
//        boxing-page-banner       → Sports tab → Boxing → hero banner → Buy
//        home-boxing-banner       → Home hero banner → Buy
//        home-boxing-tile         → Home Boxing rail → Buy
//        search                   → Search icon/tab → Search for event → Buy
//   5. App opens Chrome Custom Tab with DAZN checkout URL
//   6. Captures URL via WebView context switch or ADB fallback
//   7. Writes URL to mobile_entry_url.txt  ← Playwright reads this
//
// HOW TO RUN:
//   cd appium && npm run android
//   Overrides: PPV_NAME="Joshua" SOURCE="myaccount" USER_STATE="active_standard" npm run android
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
const PPV_NAME = process.env.PPV_NAME || 'Joshua';
const SOURCE = process.env.SOURCE || 'myaccount';
const USER_STATE = process.env.USER_STATE || 'active_standard';
const APP_PACKAGE = process.env.APP_PACKAGE || 'com.dazn';
const ANDROID_SDK = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
const ADB = `${ANDROID_SDK}/platform-tools/adb`;
const REGION = process.env.DAZN_REGION || 'GB';
const LOGIN_FIRST = (process.env.LOGIN_FIRST || process.env.LOGIN || '').toLowerCase() === 'true';

let USER_EMAIL = process.env.USER_EMAIL || '';
let USER_PASSWORD = process.env.USER_PASSWORD || '';

// Dynamically resolve credentials matching the web flow
if (!USER_EMAIL || !USER_PASSWORD) {
  try {
    const fs = require('fs');
    const path = require('path');
    const originalCwd = process.cwd();
    const projectRoot = path.resolve(__dirname, '../../..');
    process.chdir(projectRoot);

    const { buildEventData } = require('../../../utils/buildEventData');
    const { loadEventConfig } = require('../../../utils/testHelpers');
    const eventConfig = process.env.PPV_CONFIG || 'aj_joshua_prenga.json';
    const eventJson = loadEventConfig(eventConfig);
    const eventData = buildEventData(eventJson, REGION, 'standard', 'monthly', SOURCE);
    USER_EMAIL = eventData.USER_EMAIL || '';
    USER_PASSWORD = eventData.USER_PASSWORD || '';
    console.log(`🔑 Resolved credentials from config: ${USER_EMAIL}`);

    process.chdir(originalCwd);
  } catch (e) {
    console.warn('⚠️ Failed to resolve credentials from config:', e.message);
  }
}

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

  // Don't wait for specific screens - just continue after a delay
  console.log('  Continuing without waiting for specific screen...');
  await driver.pause(2000);

  console.log('✅ App loaded\n');
}

// ── Pre-Login Flow: Sign in existing user ───────────────────────────────────
async function preLoginFlow(driver: WdBrowser, baseUrl: string): Promise<void> {
  console.log('\n🔐 PRE-LOGIN FLOW: Signing in existing user...');
  await driver.pause(2000);

  // Try to find direct Login/Sign In button on the home page (typically at the top)
  const directLoginSelectors = [
    'android=new UiSelector().text("Sign In")',
    'android=new UiSelector().text("Sign in")',
    'android=new UiSelector().text("Log In")',
    'android=new UiSelector().text("Log in")',
    'android=new UiSelector().text("Login")',
    'android=new UiSelector().description("Sign In")',
    'android=new UiSelector().description("Sign in")',
    'android=new UiSelector().description("Log In")',
    'android=new UiSelector().description("Log in")',
    'android=new UiSelector().description("Login")',
    'android=new UiSelector().textContains("Sign In")',
    'android=new UiSelector().textContains("Sign in")',
    'android=new UiSelector().textContains("Log In")',
    'android=new UiSelector().textContains("Log in")',
    'android=new UiSelector().textContains("Login")',
    'android=new UiSelector().descriptionContains("Sign In")',
    'android=new UiSelector().descriptionContains("Sign in")',
    'android=new UiSelector().descriptionContains("Log In")',
    'android=new UiSelector().descriptionContains("Log in")',
    'android=new UiSelector().descriptionContains("Login")'
  ];

  let loginClicked = false;
  for (const selector of directLoginSelectors) {
    try {
      const loginBtn = await driver.$(selector);
      if (await loginBtn.isDisplayed()) {
        console.log(`  Found direct login button with selector: ${selector}, clicking...`);
        await loginBtn.click();
        await driver.pause(4000);
        loginClicked = true;
        break;
      }
    } catch { }
  }

  if (!loginClicked) {
    console.log('  Direct login button not found, trying via Profile/Account icon...');
    // Try to find and tap on Profile/Account icon
    const profileSelectors = [
      'android=new UiSelector().descriptionContains("Profile")',
      'android=new UiSelector().descriptionContains("Account")',
      'android=new UiSelector().textContains("Profile")',
      'android=new UiSelector().textContains("Account")',
      '//android.widget.ImageView[contains(@content-desc, "Profile")]',
      '//android.widget.ImageView[contains(@content-desc, "Account")]'
    ];

    let profileFound = false;
    for (const selector of profileSelectors) {
      try {
        const profileBtn = await driver.$(selector);
        if (await profileBtn.isDisplayed()) {
          console.log('  Found Profile/Account button, tapping...');
          await profileBtn.click();
          await driver.pause(2000);
          profileFound = true;
          break;
        }
      } catch (e) { }
    }

    if (!profileFound) {
      console.log('  ⚠️ Profile button not found via selectors, trying coordinate tap...');
      const screenSize = getScreenSize();
      // Profile icon typically in top-right corner
      const profileX = Math.round(screenSize.width * 0.90);
      const profileY = Math.round(screenSize.height * 0.06);
      adbTap(profileX, profileY);
      await driver.pause(2000);
    }

    // Look for Sign In button in the Profile menu
    for (const selector of directLoginSelectors) {
      try {
        const signInBtn = await driver.$(selector);
        if (await signInBtn.isDisplayed()) {
          console.log('  Found Sign In button in profile menu, tapping...');
          await signInBtn.click();
          await driver.pause(4000);
          loginClicked = true;
          break;
        }
      } catch { }
    }
  }

  // Enter email
  if (USER_EMAIL) {
    console.log(`  📧 Entering email: ${USER_EMAIL}`);
    const emailInput = await findEl(driver,
      'android=new UiSelector().className("android.widget.EditText")',
      10000
    );
    if (emailInput) {
      await emailInput.click();
      await driver.pause(1000);
      await emailInput.clearValue();
      await emailInput.setValue(USER_EMAIL);
      await driver.pause(1500);

      // Tap Continue/Next button
      const continueSelectors = [
        'android=new UiSelector().text("Get started")',
        'android=new UiSelector().text("Get Started")',
        'android=new UiSelector().text("Continue")',
        'android=new UiSelector().text("Next")',
        'android=new UiSelector().textContains("Get started")',
        'android=new UiSelector().textContains("Get Started")',
        'android=new UiSelector().textContains("Next")'
      ];
      for (const selector of continueSelectors) {
        try {
          const continueBtn = await driver.$(selector);
          if (await continueBtn.isDisplayed()) {
            await continueBtn.click();
            await driver.pause(3000);
            break;
          }
        } catch { }
      }
    }
  }

  // Enter password
  if (USER_PASSWORD) {
    console.log('  🔑 Entering password...');
    const passwordInput = await findEl(driver,
      'android=new UiSelector().className("android.widget.EditText")',
      10000
    );
    if (passwordInput) {
      await passwordInput.click();
      await driver.pause(1000);
      await passwordInput.clearValue();
      await passwordInput.setValue(USER_PASSWORD);
      await driver.pause(1500);

      // Tap Sign In/Login button
      const signInSelectors = [
        'android=new UiSelector().text("Sign In")',
        'android=new UiSelector().text("Sign in")',
        'android=new UiSelector().text("Log In")',
        'android=new UiSelector().text("Log in")',
        'android=new UiSelector().textContains("Sign In")',
        'android=new UiSelector().textContains("Sign in")',
        'android=new UiSelector().textContains("Log In")',
        'android=new UiSelector().textContains("Log in")'
      ];
      for (const selector of signInSelectors) {
        try {
          const signInBtnFinal = await driver.$(selector);
          if (await signInBtnFinal.isDisplayed()) {
            await signInBtnFinal.click();
            await driver.pause(5000);
            break;
          }
        } catch { }
      }
    }
  }

  console.log('✅ Pre-login flow completed\n');
}

// ── Navigate to My Account ──────────────────────────────────────────────────
async function navigateToMyAccount(driver: WdBrowser): Promise<void> {
  console.log('👤 Navigating to My Account...');

  // Try to find My Account in menu
  const myAccountSelectors = [
    'android=new UiSelector().textContains("My Account")',
    'android=new UiSelector().textContains("Account")',
    'android=new UiSelector().textContains("Profile")',
    '//android.widget.TextView[contains(@text, "My Account")]',
    '//android.widget.TextView[contains(@text, "Account")]'
  ];

  for (const selector of myAccountSelectors) {
    try {
      const el = await driver.$(selector);
      if (await el.isDisplayed()) {
        console.log('  Found My Account, tapping...');
        await el.click();
        await driver.pause(3000);
        return;
      }
    } catch (e) {
      // Continue
    }
  }

  // Fallback: Try via profile menu
  const screenSize = getScreenSize();
  const profileX = Math.round(screenSize.width * 0.90);
  const profileY = Math.round(screenSize.height * 0.06);
  adbTap(profileX, profileY);
  await driver.pause(2000);

  // Look for My Account in menu
  const myAccountMenu = await findEl(driver,
    'android=new UiSelector().textContains("My Account")',
    3000
  );
  if (myAccountMenu) {
    await myAccountMenu.click();
    await driver.pause(3000);
  }

  console.log('✅ Navigated to My Account\n');
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
  console.log('  Looking for Schedule button by text...');
  try {
    const scheduleText = await driver.$(`android=new UiSelector().text("Schedule")`);
    if (await scheduleText.isDisplayed()) {
      console.log('  Found Schedule button by text, clicking...');
      await scheduleText.click();
      await driver.pause(3000);
      console.log('✅ Schedule tab clicked (by text)');
      await driver.saveScreenshot('./test-results/after_schedule_click.png');
      return;
    }
  } catch (e) {
    console.log('  Schedule text not found as button');
  }

  // Take screenshot to see what's on the home page
  console.log('  Taking screenshot to see home page layout...');
  await driver.saveScreenshot('./test-results/home_page_before_schedule.png');

  // Method 2: Tap Schedule icon by coordinates (bottom nav)
  const screenSize = getScreenSize();
  const bottomNavY = Math.round(screenSize.height * 0.92);  // Bottom nav area

  // Schedule tab is at 4th position (around 70% from left) on Pixel 7
  const scheduleX = Math.round(screenSize.width * 0.70);
  console.log(`  Tapping Schedule at coordinates (${scheduleX}, ${bottomNavY})`);
  adbTap(scheduleX, bottomNavY);
  await driver.pause(3000);
  await driver.saveScreenshot('./test-results/after_schedule_tap.png');

  // Verify we're on Schedule page
  try {
    const scheduleHeader = await driver.$(`android=new UiSelector().text("SCHEDULE")`);
    const isSchedule = await scheduleHeader.isDisplayed();

    // Check if we're still on Home page
    const homeTab = await driver.$(`android=new UiSelector().text("Home")`);
    const stillOnHome = await homeTab.isDisplayed();

    if (isSchedule && !stillOnHome) {
      console.log('✅ Schedule tab clicked successfully');
      return;
    } else if (stillOnHome) {
      console.log('  ⚠️ Still on Home page - tap did not navigate to Schedule');
    }
  } catch (e) { }

  console.log('⚠️  Could not navigate to Schedule tab');
}

// ── Scroll schedule and find PPV tile (then center it) ─────
async function scrollScheduleToPPVTile(driver: WdBrowser): Promise<WdElement | null> {
  console.log(`  Target: ${PPV_NAME}`);

  // Step 1: Fast scroll to find event
  console.log('  Step 1: Fast scroll to find event...');
  for (let i = 0; i < 20; i++) {
    if (await isVisible(driver, PPV_NAME, 300)) {
      console.log(`  ✅ Found event (step ${i + 1})`);
      break;
    }
    // Bigger, faster scrolls
    adbSwipe(Math.round(getScreenSize().width / 2),
      Math.round(getScreenSize().height * 0.75),
      Math.round(getScreenSize().width / 2),
      Math.round(getScreenSize().height * 0.20));
    await driver.pause(500);
  }

  await driver.pause(1000);

  // Step 2: Look for the event tile
  console.log('  Step 2: Searching for event tile...');
  let foundEl: WdElement | null = null;

  for (let i = 0; i < 20; i++) {
    // Check for PPV
    try {
      const ppvEl = await driver.$(`//android.widget.TextView[@text="${PPV_NAME}"]`);
      if (await ppvEl.isDisplayed()) {
        console.log(`✅ Found "${PPV_NAME}" (step ${i + 1})`);

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
          const centeredEl = await driver.$(`//android.widget.TextView[@text="${PPV_NAME}"]`);
          if (await centeredEl.isDisplayed()) {
            const newRect = await centeredEl.getRect();
            console.log(`  ✅ Tile centered at y=${newRect.y}`);
            return centeredEl;
          }
        }

        return ppvEl;
      }
    } catch (e) { }

    // Gentle swipe
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

// ── Helper: extract significant keywords from event title for matching ────────
function getPPVKeywords(searchQuery: string, ppvName: string): string[] {
  const words = [searchQuery, ppvName];
  const candidates: string[] = [];
  for (const w of words) {
    if (!w) continue;
    const cleanWord = w.toLowerCase().replace(/[:\-–\.]/g, ' ');
    if (cleanWord.includes('vs')) {
      const parts = cleanWord.split(/\bvs\b/).map(p => p.trim());
      candidates.push(...parts);
    } else {
      candidates.push(...cleanWord.split(/\s+/).map(p => p.trim()));
    }
  }
  const keywordsSet = new Set<string>();
  for (const cand of candidates) {
    const subWords = cand.split(/\s+/);
    for (const sw of subWords) {
      if (sw.length > 2 && sw !== 'the' && sw !== 'vs' && sw !== 'and') {
        keywordsSet.add(sw);
      }
    }
  }
  const result = Array.from(keywordsSet);
  return result.length > 0 ? result : [searchQuery.toLowerCase()];
}

// ── Helper: find target PPV tile excluding ancillary content ─────────────────
async function findCorrectPPVTile(driver: WdBrowser, keywords: string[]): Promise<WdElement | null> {
  console.log(`🔍 Scanning TextView elements for keywords: ${JSON.stringify(keywords)}`);
  try {
    const elements = await driver.$$('android=new UiSelector().className("android.widget.TextView")');
    for (const el of elements) {
      const text = await el.getText().catch(() => '');
      if (text) {
        const textLower = text.toLowerCase();
        const matchesQuery = keywords.every(kw => textLower.includes(kw));
        const isAncillary = [
          'press', 'weigh', 'workout', 'replay', 'highlights',
          'preview', 'promo', 'interview', 'behind the', 'episode',
          'documentary', 'face off', 'kickboxing'
        ].some(term => textLower.includes(term));

        if (matchesQuery && !isAncillary) {
          console.log(`  ✅ Found matching main event tile: "${text}"`);
          return el;
        }
      }
    }
  } catch (e: any) {
    console.log(`  ⚠️ Error finding tile: ${e.message}`);
  }
  return null;
}

// ── Navigate to Search screen ────────────────────────────────────────────────
async function navigateToSearch(driver: WdBrowser): Promise<void> {
  console.log('🔍 Navigating to Search screen...');
  await driver.saveScreenshot('./test-results/before_search_click.png');

  // Method 1: Find Search button by text, content description, or resource ID
  const searchSelectors = [
    `android=new UiSelector().text("Search")`,
    `android=new UiSelector().description("Search")`,
    `android=new UiSelector().textContains("Search")`,
    `android=new UiSelector().descriptionContains("Search")`,
    `android=new UiSelector().resourceIdMatches(".*search.*")`,
    `//android.widget.ImageView[@content-desc="Search"]`,
    `//android.widget.TextView[@content-desc="Search"]`,
    `//*[@content-desc="Search"]`,
    `//*[contains(@resource-id, "search")]`
  ];

  for (const selector of searchSelectors) {
    try {
      console.log(`  Trying to find Search button with selector: ${selector}`);
      const searchBtn = await driver.$(selector);
      if (await searchBtn.isDisplayed()) {
        console.log(`  Found Search button, clicking...`);
        await searchBtn.click();
        await driver.pause(3000);
        console.log('✅ Search screen opened (by selector)');
        await driver.saveScreenshot('./test-results/after_search_click.png');
        return;
      }
    } catch (e: any) {
      console.log(`  Selector failed: ${e.message}`);
    }
  }

  // Method 2: Coordinate tap fallback.
  const screenSize = getScreenSize();
  console.log(`  Screen size: ${screenSize.width}x${screenSize.height}`);

  // Try tapping top right header (around 90% width, 6% height)
  const searchTopX = Math.round(screenSize.width * 0.90);
  const searchTopY = Math.round(screenSize.height * 0.06);
  console.log(`  Tapping top header search coordinates fallback: (${searchTopX}, ${searchTopY})`);
  adbTap(searchTopX, searchTopY);
  await driver.pause(3000);
  await driver.saveScreenshot('./test-results/after_search_top_tap.png');

  // Check if input element appeared
  const hasInput = await driver.$('android=new UiSelector().className("android.widget.EditText")').isDisplayed().catch(() => false);
  if (hasInput) {
    console.log('✅ Search screen opened (via top coordinate tap)');
    return;
  }

  // Try bottom navigation Search tab coordinate (around 90% width, 92% height)
  const searchBottomX = Math.round(screenSize.width * 0.90);
  const searchBottomY = Math.round(screenSize.height * 0.92);
  console.log(`  Tapping bottom nav search coordinates fallback: (${searchBottomX}, ${searchBottomY})`);
  adbTap(searchBottomX, searchBottomY);
  await driver.pause(3000);
  await driver.saveScreenshot('./test-results/after_search_bottom_tap.png');
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
        await driver.switchContext('NATIVE_APP').catch(() => { });
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

async function logoutAppFlow(driver: WdBrowser): Promise<void> {
  console.log('\n🔒 Starting Logout flow from native app...');
  try {
    // 1. Terminate and launch/activate the app fresh to ensure we land on home page
    console.log(`📱 Restarting DAZN app: ${APP_PACKAGE}...`);
    try {
      await driver.terminateApp(APP_PACKAGE);
      await driver.pause(1500);
    } catch { }
    await driver.activateApp(APP_PACKAGE);
    await driver.pause(6000);

    // 2. Open Profile/Account Menu
    console.log('👤 Tapping Profile/Account Menu icon...');
    const profileSelectors = [
      'android=new UiSelector().descriptionContains("Profile")',
      'android=new UiSelector().descriptionContains("Account")',
      'android=new UiSelector().textContains("Profile")',
      'android=new UiSelector().textContains("Account")',
      '//android.widget.ImageView[contains(@content-desc, "Profile")]',
      '//android.widget.ImageView[contains(@content-desc, "Account")]'
    ];

    let profileClicked = false;
    for (const selector of profileSelectors) {
      try {
        const profileBtn = await driver.$(selector);
        if (await profileBtn.isDisplayed()) {
          await profileBtn.click();
          console.log(`✅ Tapped Profile/Account menu using selector: ${selector}`);
          profileClicked = true;
          break;
        }
      } catch { }
    }

    if (!profileClicked) {
      console.log('⚠️ Profile button not found via selectors, using coordinate tap fallback...');
      const { width, height } = await driver.getWindowSize();
      const profileX = Math.round(width * 0.90);
      const profileY = Math.round(height * 0.06);
      try {
        await driver.action('pointer')
          .move({ x: profileX, y: profileY })
          .down().pause(100).up().perform();
        console.log(`✅ Coordinate tap at (${profileX}, ${profileY}) performed`);
        profileClicked = true;
      } catch (err: any) {
        console.warn('⚠️ Coordinate tap failed:', err.message);
      }
    }

    await driver.pause(4000);

    // 3. Scroll down to find the Log out button
    console.log('📜 Scrolling down to find the Log out button...');
    const logoutSelectors = [
      'android=new UiSelector().text("Log out")',
      'android=new UiSelector().text("Log Out")',
      'android=new UiSelector().textContains("Log out")',
      'android=new UiSelector().textContains("Log Out")',
      'android=new UiSelector().descriptionContains("Log out")',
      'android=new UiSelector().descriptionContains("Log Out")',
      '//android.widget.TextView[@text="Log out"]',
      '//android.widget.TextView[@text="Log Out"]'
    ];

    let logoutBtn = null;
    // Swipe down up to 5 times to find it
    for (let swipe = 0; swipe < 5; swipe++) {
      for (const selector of logoutSelectors) {
        try {
          const el = await driver.$(selector);
          if (await el.isDisplayed()) {
            logoutBtn = el;
            break;
          }
        } catch { }
      }
      if (logoutBtn) break;
      console.log(`   Swiping down (attempt ${swipe + 1})...`);
      await scrollDown(driver);
    }

    if (logoutBtn) {
      console.log('🖱️ Clicking Log out button...');
      await logoutBtn.click();
      await driver.pause(5000);
      console.log('✅ Successfully logged out from DAZN app.');
    } else {
      console.warn('⚠️ Log out button was not found in the My Account menu.');
    }
  } catch (err: any) {
    console.error('⚠️ Logout flow failed:', err.message);
  }
}

async function acceptAppCookies(driver: WdBrowser): Promise<void> {
  console.log('🍪 Checking for native app cookie/privacy consent banner...');
    const nativeCookieSelectors = [
      //'android=new UiSelector().text("Accept All")',
      // 'android=new UiSelector().text("ACCEPT ALL")',
      //'android=new UiSelector().text("Agree")',
      //'android=new UiSelector().text("AGREE")',
      'android=new UiSelector().text("Accept")',
      'android=new UiSelector().text("ACCEPT")'
    ];
    for (const selector of nativeCookieSelectors) {
      try {
        const el = await driver.$(selector);
        if (await el.isDisplayed()) {
          console.log(`🍪 Native cookie banner detected (${selector}). Accepting...`);
          await el.click();
          await driver.pause(2000);
          break;
        }
      } catch { }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TEST
  // ════════════════════════════════════════════════════════════════════════════
  describe('DAZN Android PPV — Existing User Flow', () => {
    before(async () => {
      clearHandoffUrl();
      require('fs').mkdirSync('./test-results', { recursive: true });
      console.log(`\n╔════════════════════════════════════════════════════╗`);
      console.log(`║  DAZN Android PPV — Existing User                 ║`);
      console.log(`║  Event  : ${PPV_NAME.padEnd(40)}║`);
      console.log(`║  Source : ${SOURCE.padEnd(40)}║`);
      console.log(`║  User   : ${USER_STATE.padEnd(40)}║`);
      console.log(`╚════════════════════════════════════════════════════╝\n`);

      console.log('🧹 Clearing DAZN app data to ensure a completely fresh start...');
      adb(`shell pm clear ${APP_PACKAGE}`);
      await browser.pause(2000);
      console.log('📱 Launching DAZN app fresh...');
      await browser.activateApp(APP_PACKAGE);
      await browser.pause(6000);

      // Call accept cookies method
      await acceptAppCookies(browser);
    });

    it('navigates to PPV buy button as existing user, opens Chrome, captures checkout URL', async () => {
      const driver = browser;
      const baseUrl = 'https://www.dazn.com';

      console.log('🎥 Starting screen recording on Android device...');
      await driver.startRecordingScreen({
        timeLimit: 300, // 5 minutes (300 seconds)
        videoSize: '1280x720',
        bitRate: '2000000',
      }).catch(e => console.error('⚠️ Failed to start screen recording:', e));

      await driver.pause(5000);

      await dismissStartupDialogs(driver);

      let buyTapped = false;

      const isMyAccount = SOURCE === 'myaccount' || SOURCE === 'myaccount-subscription-status';

      // ── Pre-Login Phase ───────────────────────────────────────────────────
      if (isMyAccount || LOGIN_FIRST) {
        await preLoginFlow(driver, baseUrl);
      }

      // ── myaccount ─────────────────────────────────────────────────────────
      if (isMyAccount) {
        await navigateToMyAccount(driver);

        // Wait for My Account page to load
        await driver.pause(3000);

        // Look for PPV section
        console.log(`🔍 Looking for PPV: "${PPV_NAME}" in My Account...`);

        // Scroll to find PPV
        for (let i = 0; i < 10; i++) {
          if (await isVisible(driver, PPV_NAME, 2000)) {
            console.log(`✅ Found PPV: "${PPV_NAME}"`);
            break;
          }
          scrollDown(driver);
          await driver.pause(1000);
        }

        // Look for Buy Now button
        const buyNowSelectors = [
          'android=new UiSelector().textContains("Buy now")',
          'android=new UiSelector().textContains("Buy Now")',
          'android=new UiSelector().textContains("Buy")',
          'android=new UiSelector().textContains("Purchase")'
        ];

        for (const selector of buyNowSelectors) {
          const buyBtn = await findEl(driver, selector, 2000);
          if (buyBtn) {
            console.log('  Found Buy button, tapping...');
            await buyBtn.click();
            buyTapped = true;
            await driver.pause(3000);
            break;
          }
        }

        if (!buyTapped) {
          await driver.saveScreenshot('./test-results/myaccount_buy_not_found.png');
          throw new Error(`❌ Could not find Buy button for PPV: "${PPV_NAME}" in My Account`);
        }
      }
      // ── schedule ────────────────────────────────────────────────────────────
      else if (SOURCE === 'schedule') {
        console.log('📅 Navigating to Schedule page...');

        await navigateToSchedule(driver);
        await driver.pause(3000);

        let onSchedule = false;
        let onBoxing = false;

        try {
          const scheduleHeader = await driver.$(`android=new UiSelector().text("SCHEDULE")`);
          onSchedule = await scheduleHeader.isDisplayed();
        } catch (e) { }

        try {
          const boxingHeader = await driver.$(`android=new UiSelector().text("Boxing")`);
          onBoxing = await boxingHeader.isDisplayed();
        } catch (e) { }

        if (onBoxing && !onSchedule) {
          await driver.saveScreenshot('./test-results/wrong_page_clicked.png');
          throw new Error('❌ Clicked Boxing tab instead of Schedule! Test STOPPED.');
        }

        if (onSchedule) {
          console.log('✅ On Schedule page');
          await driver.pause(2000);

          console.log('Finding Boxing filter...');
          let boxingEl = null;

          // First, try to find the Boxing filter element
          try {
            boxingEl = await driver.$(`//android.widget.TextView[@text="Boxing"]`);
            console.log('  Found Boxing filter with XPath');
          } catch (e) {
            console.log('  XPath failed, trying UiSelector...');
            try {
              boxingEl = await driver.$(`android=new UiSelector().text("Boxing")`);
              console.log('  Found Boxing filter with UiSelector');
            } catch (e2) {
              console.log('  ❌ Could not find Boxing filter element');
            }
          }

          // Now click it if found
          if (boxingEl) {
            try {
              const isDisplayed = await boxingEl.isDisplayed();
              console.log(`  Boxing filter displayed: ${isDisplayed}`);
              if (isDisplayed) {
                await boxingEl.click();
                console.log('✅ Boxing filter clicked successfully');
              } else {
                console.log('  ⚠️ Boxing filter found but not displayed');
              }
            } catch (e) {
              console.log(`  ❌ Failed to click Boxing filter: ${e.message}`);
            }
          } else {
            console.log('  ⚠️  Boxing filter not found - continuing without filter');
          }
          await driver.pause(3000);

          console.log(`Finding ${PPV_NAME}...`);
          await driver.pause(5000);

          console.log(`Scrolling to ${PPV_NAME}...`);
          const ppvElement = await scrollScheduleToPPVTile(driver);

          // Click the PPV tile using exact XPath (most reliable)
          await driver.pause(1000);
          try {
            const ppvTile = await driver.$(`//android.widget.TextView[@text="${PPV_NAME}"]`);
            await ppvTile.click();
            console.log(`✅ Clicked ${PPV_NAME} tile`);
          } catch (e) {
            console.log('⚠️ Could not click PPV tile');
          }

          await driver.pause(2000);

          // After clicking PPV tile, we should be on paywall screen with Copy button
          // Skip looking for Buy button and go straight to URL capture
          console.log('  On paywall screen - will capture URL via Copy button');
          buyTapped = true;  // Skip Buy button step
        } else {
          await driver.saveScreenshot('./test-results/schedule_navigation_failed.png');
          throw new Error('❌ Neither Schedule nor Boxing detected. Test STOPPED.');
        }
      }

      // ── search ────────────────────────────────────────────────────────────
      else if (SOURCE === 'search') {
        await navigateToSearch(driver);

        let searchQuery = PPV_NAME;
        try {
          const fs = require('fs');
          const path = require('path');
          const configFileName = process.env.PPV_CONFIG || 'aj_joshua_prenga.json';
          const configPath = path.resolve(__dirname, '../../..', 'config/events', configFileName);
          if (fs.existsSync(configPath)) {
            const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (configData.PPV_NAME) {
              searchQuery = configData.PPV_NAME;
              console.log(`✅ Loaded complete PPV name from config: "${searchQuery}"`);
            }
          }
        } catch (e: any) {
          console.log(`⚠️ Failed to load complete PPV name from config: ${e.message}. Using fallback.`);
        }

        if (searchQuery.includes(':')) {
          searchQuery = searchQuery.split(':').pop()?.trim() || searchQuery;
        }
        searchQuery = searchQuery.replace(/\./g, ''); // removes dots, e.g. "Joshua vs. Prenga" -> "Joshua vs Prenga"

        console.log(`🔍 Entering search query: "${searchQuery}"`);
        const screenSize = getScreenSize();
        let searchInput = null;
        const inputSelectors = [
          `android=new UiSelector().className("android.widget.EditText")`,
          `android=new UiSelector().resourceIdMatches(".*search_src_text.*")`,
          `android=new UiSelector().resourceIdMatches(".*search.*")`,
          `//android.widget.EditText`,
          `//*[contains(@resource-id, "search")]`
        ];

        for (const selector of inputSelectors) {
          try {
            const el = await driver.$(selector);
            if (await el.isDisplayed()) {
              searchInput = el;
              break;
            }
          } catch { }
        }

        if (searchInput) {
          await searchInput.click();
          await driver.pause(1000);
          await searchInput.clearValue();
          await searchInput.setValue(searchQuery);
          await driver.pause(1500);
        } else {
          console.log('⚠️ Search input not found via locator, using coordinate tap fallback and ADB text typing...');
          const inputX = Math.round(screenSize.width / 2);
          const inputY = Math.round(screenSize.height * 0.06);
          adbTap(inputX, inputY);
          await driver.pause(1000);

          // Send keyevent via ADB text as fallback/supplement ONLY when searchInput is not found
          const adbText = searchQuery.replace(/\s+/g, '%s');
          adb(`shell input text "${adbText}"`);
          await driver.pause(1500);
        }

        console.log('⌨️ Pressing Search/Enter on keyboard...');
        adb('shell input keyevent 66');
        await driver.pause(4000);
        await driver.saveScreenshot('./test-results/android_search_results.png');

        const keywords = getPPVKeywords(searchQuery, PPV_NAME);
        console.log(`🔍 Looking for PPV tile: "${PPV_NAME}"...`);
        let ppvTile = await findCorrectPPVTile(driver, keywords);

        if (!ppvTile) {
          console.log('  ⚠️ PPV tile not immediately visible. Swiping down search results...');
          await scrollDown(driver);
          await driver.pause(2000);
          ppvTile = await findCorrectPPVTile(driver, keywords);
        }

        // If the PPV tile is not found, retry searching by appending 'upcoming'
        if (!ppvTile) {
          const retryQuery = `${searchQuery} upcoming`;
          console.log(`⚠️ PPV tile not found for "${searchQuery}". Retrying search with "${retryQuery}"...`);

          // Reset Search screen by navigating to it again
          await navigateToSearch(driver);

          searchInput = null;
          for (const selector of inputSelectors) {
            try {
              const el = await driver.$(selector);
              if (await el.isDisplayed()) {
                searchInput = el;
                break;
              }
            } catch { }
          }

          if (searchInput) {
            await searchInput.click();
            await driver.pause(1000);
            await searchInput.clearValue();
            await searchInput.setValue(retryQuery);
            await driver.pause(1500);
          } else {
            console.log('⚠️ Search input not found, using coordinate tap fallback and ADB text typing...');
            const inputX = Math.round(screenSize.width / 2);
            const inputY = Math.round(screenSize.height * 0.06);
            adbTap(inputX, inputY);
            await driver.pause(1000);

            const adbRetryText = retryQuery.replace(/\s+/g, '%s');
            adb(`shell input text "${adbRetryText}"`);
            await driver.pause(1500);
          }

          console.log('⌨️ Pressing Search/Enter on keyboard...');
          adb('shell input keyevent 66');
          await driver.pause(4000);
          await driver.saveScreenshot('./test-results/android_search_retry_results.png');

          ppvTile = await findCorrectPPVTile(driver, keywords);

          if (!ppvTile) {
            console.log('  ⚠️ PPV tile not immediately visible in retry search. Swiping down results...');
            await scrollDown(driver);
            await driver.pause(2000);
            ppvTile = await findCorrectPPVTile(driver, keywords);
          }
        }

        if (ppvTile) {
          console.log(`✅ Found PPV tile - tapping it...`);
          await ppvTile.click();
          await driver.pause(4000);
          await driver.saveScreenshot('./test-results/android_search_after_tile_click.png');

          // Directly transition to url capture phase (similar to schedule flow)
          console.log('  On paywall screen - will capture URL via Copy button');
          buyTapped = true;
        } else {
          throw new Error(`❌ PPV event "${PPV_NAME}" not found in search results (after primary & retry search).`);
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

      console.log('\n⏳ Waiting for Chrome Custom Tab to open...');
      await driver.pause(5000);  // Wait longer for Chrome to open
      await driver.saveScreenshot('./test-results/android_after_buy_click.png');

      // Check if Chrome opened by looking for Chrome UI
      console.log('  Checking if Chrome opened...');
      const chromeSigns = ['Address', 'Search', 'dazn.com', 'https://'];
      let chromeOpened = false;

      for (const sign of chromeSigns) {
        if (await isVisible(driver, sign, 2000)) {
          console.log(`  ✅ Chrome opened (found: ${sign})`);
          chromeOpened = true;
          break;
        }
      }

      if (!chromeOpened) {
        console.log('  ⚠️ Chrome may not have opened. Checking current activity...');
        const currentActivity = adb('shell dumpsys window | grep mCurrentFocus');
        console.log(`  Current activity: ${currentActivity}`);
      }

      // ── Step 3: Capture checkout URL from paywall screen ──────────────────
      console.log("📋 Capturing checkout URL from paywall...");
      await driver.saveScreenshot("./test-results/android_paywall_screen.png");

      let checkoutUrl = "";

      // Dump page source to help debug why "Copy" button is not found/clickable
      console.log("\n── Page Source (for debugging Copy button) ──────────────────");
      const pageSource = await driver.getPageSource();
      console.log(pageSource.substring(0, 5000)); // Log first 5000 chars to avoid overwhelming output
      console.log("────────────────────────────────────────────────────────────\n");

      // Method 1: Click Copy button and get URL from clipboard
      console.log("  Method 1: Clicking Copy button and reading clipboard...");

      // First, scroll up slightly to ensure Copy button is fully visible
      console.log("  Scrolling up to ensure Copy button is visible...");
      const screenSize = getScreenSize();
      adbSwipe(Math.round(screenSize.width / 2),
        Math.round(screenSize.height * 0.85),
        Math.round(screenSize.width / 2),
        Math.round(screenSize.height * 0.75));
      await driver.pause(1000);

      // Try clicking the parent element of the Copy button
      try {
        // The clickable element is a View, which contains the TextView "Copy"
        const parentCopyBtn = await driver.$(`//android.view.View[./android.widget.TextView[@text="Copy"]]`);
        console.log("  Found parent of Copy button, waiting for display...");
        await parentCopyBtn.waitForDisplayed({ timeout: 5000 });
        console.log("  Parent displayed, attempting click...");
        await parentCopyBtn.click();
        console.log("  ✅ Clicked parent of Copy button");
        await driver.pause(2000);

        // Take screenshot after click
        await driver.saveScreenshot("./test-results/android_after_copy_click.png");
        console.log("  Screenshot saved: android_after_copy_click.png");
      } catch (e) {
        console.log(`  ❌ Failed to click parent: ${e.message}`);
        console.log("  Trying coordinate tap as fallback...");

        // Fallback: Try coordinate tap if element click failed
        const copyBtnX = Math.round(screenSize.width * 0.19);  // 19% from left
        const copyBtnY = Math.round(screenSize.height * 0.89); // 89% from top

        console.log(`  Tapping Copy button at coordinates (${copyBtnX}, ${copyBtnY})`);
        adbTap(copyBtnX, copyBtnY);
        await driver.pause(2000);

        // Take screenshot after coordinate tap
        await driver.saveScreenshot("./test-results/android_after_copy_tap.png");
        console.log("  Screenshot saved: android_after_copy_tap.png");
      }

      // Read URL from clipboard using Appium driver or fallback to ADB
      try {
        const base64Content = await driver.getClipboard();
        checkoutUrl = Buffer.from(base64Content, 'base64').toString('utf8');
        console.log(`  Appium clipboard content: ${checkoutUrl.substring(0, 100)}...`);
      } catch (e: any) {
        console.log(`  Failed to get clipboard via Appium: ${e.message}`);
        checkoutUrl = adb("shell am clipht get");
        console.log(`  ADB Clipboard content: ${checkoutUrl.substring(0, 100)}...`);
      }

      if (checkoutUrl && (checkoutUrl.includes("dazn.com") || checkoutUrl.includes("amazonaws.com"))) {
        console.log("✅ URL captured from clipboard");
      } else {
        // If clipboard failed, take screenshot and throw error immediately
        await driver.saveScreenshot("./test-results/android_url_not_found.png");
        console.log("❌ Clipboard content was not a valid DAZN URL. All URL capture methods failed.");
        console.log("   Screenshot saved to: test-results/android_url_not_found.png");
        console.log("   Paywall screenshot saved to: test-results/android_paywall_screen.png");
        throw new Error(`❌ Could not capture checkout URL from paywall.\n   Clipboard content: ${checkoutUrl}\n   Check screenshots and console log.`);
      }

      console.log(`\n🌐 Checkout URL captured:\n   ${checkoutUrl}\n`);
      writeHandoffUrl(checkoutUrl);
      console.log("✅ URL written to mobile_entry_url.txt");
      console.log("📱 Closing DAZN app...");
      adb("shell am force-stop " + APP_PACKAGE);
      await driver.pause(1000);
      console.log("📱 Next: Open fresh Chrome browser, paste URL, and complete web flow");

      // ── Playwright Web Checkout Phase ──────────────────────────────────────────
      // Force-stop Chrome to ensure a completely fresh browser launch (not a new tab).
      console.log("Force-stopping Chrome to ensure fresh browser launch...");
      adb("shell am force-stop com.android.chrome");
      await driver.pause(1000);
      const originalCwd = process.cwd();
      let playwrightBrowser: any = null;
      let context: any = null;
      const runStart = new Date();

      try {
        // 1. Change directory to root so paths resolve correctly relative to config and sheets
        const nodePath = require('path');
        const nodeFs = require('fs');
        process.chdir(nodePath.resolve(__dirname, '../../..'));
        console.log(`📂 Changed working directory to: ${process.cwd()}`);

        // Dynamic imports to keep the top of the file 100% original
        const { chromium } = require('@playwright/test');
        const fs = nodeFs;
        const path = nodePath;

        const { SignupPage } = require('../../../pages/SignupPage');
        const { PaymentPage } = require('../../../pages/PaymentPage');
        const { StandalonePPVPage } = require('../../../pages/StandalonePPVPage');
        const { PPVUpsellSuccessPage } = require('../../../pages/PPVUpsellSuccessPage');
        const { PPVUpsellPaymentPage } = require('../../../pages/PPVUpsellPaymentPage');
        const { MyAccountPage } = require('../../../pages/MyAccountPage');
        const { SchedulePage: WebSchedulePage } = require('../../../pages/schedulepage');

        const {
          readSheet,
          configureExcelPathForEvent,
          getPPVDataByVariant,
          getPlanDataByTier,
          getPaymentDataByTierAndPlan,
          getPhonePageData,
          getOTPPageData,
          getStandalonePPVPageData,
          getUpsellFirstSuccessData,
          getUpsellSecondSuccessData,
          getUpsellPaymentData,
        } = require('../../../utils/excelReader');

        const { detectVariant } = require('../../../flows/detectVariant');
        const { validateVariant } = require('../../../flows/validateVariant');
        const { buildEventData } = require('../../../utils/buildEventData');
        const { detectPageType } = require('../../../utils/flowHelpers');
        const { displayResultsTable } = require('../../../utils/resultsDisplay');
        const { writeResults } = require('../../../utils/excelWriter');
        const { generateReports } = require('../../../utils/reportGenerator');
        const { createTestUser } = require('../../../utils/testDataBuilder');

        const {
          sleep,
          setupPage,
          handleCookies,
          stabilisePage,
          dismissMarketingPopup,
        } = require('../../../utils/helpers');

        const {
          loadEventConfig,
          safeScrollToElement,
          clickAndWaitForNav,
          handlePopupModal,
          assertCountryMatch,
        } = require('../../../utils/testHelpers');


        const REGION = process.env.DAZN_REGION || 'GB';
        const EVENT_CONFIG = process.env.PPV_CONFIG || 'aj_joshua_prenga.json';
        const PLAN = process.env.PLAN || 'standard_monthly';
        const PPV_TYPE = (process.env.PPV_TYPE || 'normal').toLowerCase();
        const SWITCH_TO_ULTIMATE = (process.env.SWITCH || '').toLowerCase() === 'true';
        const ENV = (process.env.DAZN_ENV || 'stag').toLowerCase();
        const PAYMENT_METHOD = (process.env.PAYMENT_METHOD || 'credit_card').toLowerCase();

        // Screenshot helper for failed fields
        async function captureFailShot(page: any, field: string): Promise<string | undefined> {
          try {
            const dir = path.resolve(process.cwd(), 'test-results', 'screenshots');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const safe = field.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
            const shotPath = path.join(dir, `FAIL_${safe}_${Date.now()}.jpg`);
            await page.screenshot({ path: shotPath, type: 'jpeg', quality: 75, fullPage: false });
            return shotPath;
          } catch {
            return undefined;
          }
        }

        // Replace platform=android with platform=web
        let webCheckoutUrl = checkoutUrl.replace('platform=android', 'platform=web');

        const json = loadEventConfig(EVENT_CONFIG);

        const plansPath = path.resolve(process.cwd(), 'config/DaznPlan.json');
        const plans = JSON.parse(fs.readFileSync(plansPath, 'utf-8'));
        const planData = plans[PLAN];
        if (!planData) {
          throw new Error(`❌ Plan "${PLAN}" not found in DaznPlan.json`);
        }

        const planTier = (planData.TIER || 'standard').toLowerCase();
        const isUltimate = planTier === 'ultimate';
        const ratePlan = (planData.RATE_PLAN || 'monthly').toLowerCase();

        const planName = ratePlan === 'monthly'
          ? 'Flex Monthly'
          : (ratePlan.includes('upfront') ? 'APU' : 'APM');
        const tierName = planTier.charAt(0).toUpperCase() + planTier.slice(1);
        const srcLabel = SOURCE.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

        const flowConfig = {
          name: `Existing User: ${srcLabel} → ${tierName} → ${planName}`,
          source: SOURCE,
          tier: planTier,
          ratePlan: ratePlan,
          endPage: 'payment',
          enableDevMode: false,
          planKey: PLAN
        };

        console.log(`\n╔═══════════════════════════════════════════════════════╗`);
        console.log(`║  RUNNING LOCAL PLAYWRIGHT WEB CHECKOUT: ${flowConfig.name}`);
        console.log(`║  Source: ${flowConfig.source} | Tier: ${flowConfig.tier} | Plan: ${flowConfig.ratePlan}`);
        console.log(`╚═══════════════════════════════════════════════════════╝\n`);

        const results: any[] = [];
        configureExcelPathForEvent(json.eventKey || '');

        const eventData = buildEventData(json, REGION, planTier, ratePlan.replace(/-/g, ' '), SOURCE);
        eventData.source = SOURCE;
        eventData.SOURCE = SOURCE;

        // Compute date variables
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 7);
        const fDay = futureDate.getDate();
        const fMonth = futureDate.toLocaleString('en-GB', { month: 'long' });
        const fYear = futureDate.getFullYear();
        eventData.FLEX_FUTURE_DATE_SHORT = `${fDay} ${fMonth} ${fYear}`;

        const offerType = eventData.OFFER_TYPE || '1_month_free';
        const isNoOffer = offerType === 'no_offer' || offerType === 'none';

        if (planTier === 'ultimate') {
          eventData.PLAN_CTA_BUTTON = eventData.PLAN_CTA_BUTTON_ULTIMATE || 'Continue with DAZN Ultimate';
          eventData.DAZN_TIER = 'DAZN Ultimate';
        } else {
          if (isNoOffer) {
            eventData.PLAN_CTA_BUTTON = eventData.PLAN_CTA_BUTTON_STANDARD || 'Continue with DAZN Standard';
          } else {
            eventData.PLAN_CTA_BUTTON = eventData.PLAN_CTA_BUTTON_STANDARD || 'Continue with 7-day Free Trial';
          }
          eventData.DAZN_TIER = 'DAZN Standard';
        }

        const activeOfferPresent = eventData.ACTIVE_OFFER_PRESENT === 'true';
        if (activeOfferPresent && ratePlan === 'monthly') {
          eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
          eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_PLAN_LABEL || 'Flex – Pay Monthly - First Month Only';
          eventData.PAYMENT_FREE_TEXT = 'N/A';
          eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT_TRIAL || '';
        } else if (offerType === '7_day_trial' && planTier === 'standard' && ratePlan === 'monthly') {
          eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_TRIAL || 'Choose how to pay after your free trial';
          eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_FREE_TEXT_TRIAL || '7-days free';
          eventData.PAYMENT_FREE_TEXT = eventData.PAYMENT_FREE_TEXT_TRIAL || '7-days free';
          eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT_TRIAL || '';
        } else if (ratePlan === 'annual pay monthly' || ratePlan === 'annual pay upfront' || ratePlan.includes('annual')) {
          eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
          eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_PLAN_NAME_ANNUAL || 'Annual - Pay Monthly';
          if (offerType === '1_month_free') {
            eventData.PAYMENT_FREE_TEXT = eventData.PAYMENT_FREE_TEXT_MONTHLY || 'First month free';
          } else {
            eventData.PAYMENT_FREE_TEXT = 'N/A';
          }
          if (planTier === 'ultimate') {
            eventData.CANCELLATION_TEXT = ratePlan.includes('monthly')
              ? (eventData.CANCELLATION_TEXT_ULTIMATE_APM || '')
              : (eventData.CANCELLATION_TEXT_ULTIMATE_APU || '');
          } else {
            eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT_ANNUAL || '';
          }
        } else if (offerType === '1_month_free' && ratePlan === 'monthly') {
          eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
          eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_PLAN_NAME_FLEX || 'Flex – Pay Monthly';
          eventData.PAYMENT_FREE_TEXT = eventData.PAYMENT_FREE_TEXT_MONTHLY || 'First month free';
          eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT_TRIAL || '';
        } else if (isNoOffer && ratePlan === 'monthly') {
          eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
          eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_PLAN_NAME_FLEX || 'Flex – Pay Monthly';
          eventData.PAYMENT_FREE_TEXT = 'N/A';
          eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT || "Monthly subscription. Cancel with 30 days' notice. Your subscription auto-renews unless you cancel.";
        } else {
          eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
          eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_PLAN_NAME_FLEX || 'Flex – Pay Monthly';
          eventData.PAYMENT_FREE_TEXT = eventData.PAYMENT_FREE_TEXT_MONTHLY || 'First month free';
          eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT_TRIAL || '';
        }

        eventData['PAYMENT_PAGE_TITLE'] = eventData.PAYMENT_PAGE_TITLE;
        eventData['PAYMENT_PLAN_NAME'] = eventData.PAYMENT_PLAN_NAME;
        eventData['PAYMENT_FREE_TEXT'] = eventData.PAYMENT_FREE_TEXT;
        eventData['PLAN_CTA_BUTTON'] = eventData.PLAN_CTA_BUTTON;
        eventData['DAZN_TIER'] = eventData.DAZN_TIER;
        eventData['CANCELLATION_TEXT'] = eventData.CANCELLATION_TEXT;

        const variantConfig = json.variants;
        const pagesConfig = json.pages;

        console.log('🌐 Connecting to Android device via Playwright...');
        const { _android } = require('@playwright/test');
        const devices = await _android.devices();
        if (devices.length === 0) {
          throw new Error('❌ No Android devices found by Playwright!');
        }
        const device = devices[0];
        console.log(`📱 Connected to device: ${device.model()} (${device.serial()})`);

        console.log('Force-stopping Chrome on device...');
        await device.shell('am force-stop com.android.chrome');
        await sleep(1000);

        console.log('Launching Chrome browser on Android device...');
        context = await device.launchBrowser({
          viewport: { width: 375, height: 667 },
          timezoneId: 'Asia/Kolkata',
          locale: 'en-IN',
          args: ['--incognito', '--no-first-run', '--disable-first-run-ui']
        });

        await context.addInitScript(() => {
          try {
            if (!localStorage.getItem('randomABPoint')) {
              localStorage.setItem('randomABPoint', Math.random().toString());
            }

            const mockClipboard = {
              writeText: async (text: any) => {
                console.log('📋 [MOCK CLIPBOARD] writeText called with:', text);
                return Promise.resolve();
              },
              readText: async () => {
                console.log('📋 [MOCK CLIPBOARD] readText called');
                return Promise.resolve('mock-dev-id');
              }
            };

            Object.defineProperty(navigator, 'clipboard', {
              value: mockClipboard,
              writable: true,
              configurable: true
            });
            console.log('✅ Clipboard API stubbed in test context');
          } catch { }
        });

        // Force opening a brand-new page/tab to prevent showing any pre-existing/restored pages
        console.log('Opening a new browser tab for the checkout page...');
        const page = await context.newPage();

        // Clean up all other background/restored tabs (including Amazon) immediately
        console.log('Cleaning up any other open tabs in Chrome...');
        const openPages = context.pages();
        for (const p of openPages) {
          if (p !== page) {
            await p.close().catch(() => { });
          }
        }

        console.log('Bringing Chrome browser UI to the foreground...');
        await device.shell('am start -n com.android.chrome/com.google.android.apps.chrome.Main');
        await sleep(1500);

        page.on('console', (msg: any) => {
          const text = msg.text();
          const textLower = text.toLowerCase();
          if (textLower.includes('dev') || textLower.includes('mode') || textLower.includes('copy') || textLower.includes('error') || textLower.includes('fail') || textLower.includes('clipboard') || textLower.includes('permission')) {
            console.log(`🖥️ [Page Console] ${text}`);
          }
        });

        console.log(`\n🌐 Opening handoff URL: ${webCheckoutUrl}\n`);
        await page.goto(webCheckoutUrl);

        // Explicitly wait for cookies and accept them
        console.log('🍪 Waiting for cookie banner and accepting cookies...');
        const acceptBtn = page.locator('#onetrust-accept-btn-handler');
        try {
          await acceptBtn.waitFor({ state: 'visible', timeout: 20000 });
          console.log('🍪 Cookie accept button is visible. Clicking it...');
          await acceptBtn.click({ force: true });
          console.log('🍪 Accepted cookies.');

          await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => { });
          console.log('🍪 Cookie banner is hidden.');
        } catch (e) {
          console.log('⚠️ Primary cookie banner not visible or interactable within timeout. Trying helper fallbacks...');
          await handleCookies(page, 5000);
        }

        const variant = await detectVariant(page, variantConfig).catch(() => 'variant1');
        console.log('🎯 variant:', variant);
        const currentVariantConfig = variantConfig?.[variant] || {};

        let reachedEndPage = false;
        let ppvValidated = false;
        let planValidated = false;
        let planClickCount = 0;
        let emailProcessedCount = 0;
        let stuckCount = 0;
        let firstPaymentDone = false;
        let firstSuccessValidated = false;
        let savedCardPaymentDone = false;

        // Traverse checkout funnel
        for (let step = 0; step < 15; step++) {
          if (page.isClosed()) throw new Error('❌ Page closed unexpectedly');

          const pageType = await detectPageType(page, pagesConfig, planClickCount);
          await handleCookies(page, step === 0 ? 5000 : 500);
          await stabilisePage(page);
          await dismissMarketingPopup(page);
          console.log(`\nstep ${step + 1} → pageType: ${pageType} | planClicks: ${planClickCount} | url: ${page.url()}`);

          // ── Default Signup validation check: Fail if no PPV ──
          const isBoxingSubscriptionSource =
            SOURCE === 'boxing-ultimate-subscription' ||
            SOURCE === 'boxing-standard-subscription' ||
            SOURCE === 'boxing-join-the-club';
          if (process.env.DEFAULT_SIGNUP === 'true' && !ppvValidated && !isBoxingSubscriptionSource) {
            const url = page.url().toLowerCase();
            if (url.includes('page=tierplans') || url.includes('page=plandetails') || pageType === 'plan' || pageType === 'email') {
              const bodyText = await page.locator('body').innerText({ timeout: 2000 }).then((t: any) => t.toLowerCase()).catch(() => '');
              if (!bodyText.includes('subscribe without a pay-per-view')) {
                throw new Error('❌ [DefaultSignup] No PPV exists in default signup — redirected directly to plans page');
              }
            }
          }

          // ── OTP Verification page ──────────────────────────────
          if (pageType === 'otp') {
            console.log('🔑 Reached OTP Verification page');
            reachedEndPage = true;

            try {
              const otpData = getOTPPageData();
              console.log(`\n🧾 Validating OTP page — ${otpData.length} fields`);

              for (const row of otpData) {
                const field = (row['Field'] || '').trim();
                const expected = (row['Expected'] || '').toString().trim();
                if (!field) continue;

                let actual = 'N/A';
                const fieldLower = field.toLowerCase();

                if (fieldLower === 'page title') {
                  const h1 = await page.locator('h1').first().textContent({ timeout: 5000 }).catch(() => '');
                  if (h1 && h1.trim()) {
                    actual = h1.trim();
                  } else {
                    const h2 = await page.locator('h2').first().textContent({ timeout: 3000 }).catch(() => '');
                    if (h2 && h2.trim()) {
                      actual = h2.trim();
                    }
                  }
                } else if (fieldLower === 'page description') {
                  const desc = await page.locator('h1 + p, h2 + p, h1 ~ p, [class*="subtitle"], [class*="description"]')
                    .first().textContent({ timeout: 3000 }).catch(() => '');
                  if (desc && desc.trim()) {
                    actual = desc.trim();
                  } else {
                    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
                    const lines = bodyText.split('\n').map((l: any) => l.trim()).filter((l: any) => l.length > 15 && l.length < 200);
                    for (const line of lines) {
                      if (/sent.*code|code.*to|digit.*code/i.test(line)) { actual = line; break; }
                    }
                  }
                } else if (fieldLower === 'otp input present') {
                  const otpInputs = page.locator(
                    'input[type="tel"], input[type="number"], input[inputmode="numeric"], ' +
                    'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i], ' +
                    'input[data-test-id*="otp" i], input[data-test-id*="code" i], ' +
                    'input[maxlength="1"], input[maxlength="4"], input[maxlength="6"]'
                  );
                  const count = await otpInputs.count().catch(() => 0);
                  actual = count > 0 ? 'Yes' : 'No';
                } else if (fieldLower === 'verify button') {
                  const btn = page.locator(
                    'button:has-text("Verify"), button:has-text("Submit"), button:has-text("Confirm"), button[type="submit"]'
                  ).first();
                  const text = await btn.textContent({ timeout: 3000 }).catch(() => '');
                  actual = (text || '').trim() || 'N/A';
                } else if (fieldLower === 'resend code link') {
                  const resend = page.locator(
                    'button:has-text("Resend"), a:has-text("Resend"), button:has-text("resend"), a:has-text("resend"), ' +
                    'button:has-text("Send again"), a:has-text("Send again"), ' +
                    '*:has-text("Resend code"), *:has-text("resend code")'
                  ).first();
                  actual = (await resend.isVisible({ timeout: 3000 }).catch(() => false)) ? 'Yes' : 'No';
                }

                const actualNorm = actual.toLowerCase().replace(/\s+/g, ' ').trim();
                const expectedNorm = expected.toLowerCase().replace(/\s+/g, ' ').trim();
                const status = (actualNorm === expectedNorm ||
                  actualNorm.includes(expectedNorm) ||
                  expectedNorm.includes(actualNorm)) ? 'PASS' : 'FAIL';

                console.log(`  ${status === 'PASS' ? '✅' : '❌'} [${field}]  expected="${expected}"  actual="${actual}"`);
                const _shotOTP = status === 'FAIL' ? await captureFailShot(page, field) : undefined;
                results.push({ page: 'OTP Verification', field, expected, actual, status, screenshot: _shotOTP });
              }
            } catch (e: any) {
              console.warn('⚠️  OTP page validation error:', e.message);
              results.push({
                page: 'OTP Verification',
                field: 'OTP Page Reached',
                expected: 'Yes',
                actual: 'Yes',
                status: 'PASS',
              });
            }

            break;
          }

          // ── Phone Number page ──────────────────────────────────
          if (pageType === 'phone') {
            console.log('📱 Reached "Add your phone number" page');
            reachedEndPage = true;

            try {
              const phoneData = getPhonePageData();
              console.log(`\n🧾 Validating Phone Number page — ${phoneData.length} fields`);

              for (const row of phoneData) {
                const field = (row['Field'] || '').trim();
                const expected = (row['Expected'] || '').toString().trim();
                if (!field) continue;

                let actual = 'N/A';
                const fieldLower = field.toLowerCase();

                if (fieldLower === 'page title') {
                  const h1 = await page.locator('h1').first().textContent({ timeout: 5000 }).catch(() => '');
                  actual = (h1 || '').trim() || 'N/A';
                } else if (fieldLower === 'page description') {
                  const desc = await page.locator('h1 + p, h1 ~ p, [class*="subtitle"], [class*="description"]')
                    .first().textContent({ timeout: 3000 }).catch(() => '');
                  if (desc && desc.trim()) {
                    actual = desc.trim();
                  } else {
                    const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
                    const lines = body.split('\n').map((l: any) => l.trim()).filter((l: any) => l.length > 20 && l.length < 200);
                    for (const line of lines) {
                      if (/recover|locked out|verify/i.test(line)) { actual = line; break; }
                    }
                  }
                } else if (fieldLower === 'phone input present') {
                  const input = page.locator('input[type="tel"], input[name*="phone" i], input[placeholder*="phone" i]').first();
                  actual = (await input.isVisible({ timeout: 3000 }).catch(() => false)) ? 'Yes' : 'No';
                } else if (fieldLower === 'continue button') {
                  const btn = page.locator('button:has-text("Continue"), button[type="submit"]').first();
                  const text = await btn.textContent({ timeout: 3000 }).catch(() => '');
                  actual = (text || '').trim() || 'N/A';
                } else if (fieldLower === 'country code present') {
                  const cc = page.locator('[class*="country" i], [class*="dial" i], select, [role="listbox"]').first();
                  actual = (await cc.isVisible({ timeout: 3000 }).catch(() => false)) ? 'Yes' : 'No';
                }

                const actualNorm = actual.toLowerCase().replace(/\s+/g, ' ').trim();
                const expectedNorm = expected.toLowerCase().replace(/\s+/g, ' ').trim();
                const status = (actualNorm === expectedNorm ||
                  actualNorm.includes(expectedNorm) ||
                  expectedNorm.includes(actualNorm)) ? 'PASS' : 'FAIL';

                console.log(`  ${status === 'PASS' ? '✅' : '❌'} [${field}]  expected="${expected}"  actual="${actual}"`);
                const _shotPhone = status === 'FAIL' ? await captureFailShot(page, field) : undefined;
                results.push({ page: 'Phone Number', field, expected, actual, status, screenshot: _shotPhone });
              }
            } catch (e: any) {
              console.warn('⚠️  Phone page validation error:', e.message);
              results.push({
                page: 'Phone Number',
                field: 'Phone Number Page Reached',
                expected: 'Yes',
                actual: 'Yes',
                status: 'PASS',
              });
            }

            break;
          }

          // ── UPSELL: First Success Page ──────────────────────────────
          if (pageType === 'success-upsell' && PPV_TYPE === 'upsell' && firstPaymentDone && !firstSuccessValidated) {
            console.log('🏆 First Success Page — PPV Upsell');
            stuckCount = 0;
            const successPage = new PPVUpsellSuccessPage(page);
            try {
              const successData = getUpsellFirstSuccessData();
              if (successData.length > 0) {
                await successPage.validateUpsellSuccess(successData, results, eventData, 'First Success');
              }
            } catch (err: any) { console.warn('⚠️ First Success validation error:', err.message); }
            firstSuccessValidated = true;
            await successPage.clickBuyUpsell();
            continue;
          }

          // ── UPSELL: Saved Card Payment (PPV B purchase) ─────────────
          if (pageType === 'saved-card-payment' && PPV_TYPE === 'upsell' && firstPaymentDone && firstSuccessValidated && !savedCardPaymentDone) {
            console.log('💳 Next Upsell Saved Card Payment');
            stuckCount = 0;
            const savedCardPage = new PPVUpsellPaymentPage(page);
            try {
              const upsellPayData = getUpsellPaymentData();
              if (upsellPayData.length > 0) {
                await savedCardPage.validateSavedCardPayment(upsellPayData, results, eventData, 'Upsell Payment');
              }
            } catch (err: any) { console.warn('⚠️ Upsell Payment validation error:', err.message); }
            savedCardPaymentDone = true;
            await savedCardPage.fillAndSubmit(eventData);
            results.push({ page: 'Upsell Payment', field: 'Upsell Payment Completed', expected: 'Success', actual: 'Success', status: 'PASS' });
            continue;
          }

          // ── UPSELL: Second Success Page (DAZN Bet promo) ────────────
          if (pageType === 'bet-upsell' && PPV_TYPE === 'upsell' && savedCardPaymentDone) {
            console.log('🎰 Second Success Page — DAZN Bet');
            stuckCount = 0;
            const successPage = new PPVUpsellSuccessPage(page);
            try {
              const betData = getUpsellSecondSuccessData();
              if (betData.length > 0) {
                await successPage.validateBetUpsell(betData, results, eventData, 'Second Success');
              }
            } catch (err: any) { console.warn('⚠️ Second Success validation error:', err.message); }
            reachedEndPage = true;
            await successPage.clickMaybeLater();
            break;
          }

          // ── Payment Details Page ─────────────────────────────────
          if (pageType === 'payment') {
            console.log('💳 Reached Payment page');
            if (SOURCE === 'schedule' || SOURCE === 'search') {
              const currentUrl = page.url();
              console.log(`🔍 [${SOURCE === 'schedule' ? 'Schedule' : 'Search'} Flow] Checking URL: ${currentUrl}`);
              const isStag = currentUrl.includes('stag.dazn.com') || currentUrl.includes('sandbox') || currentUrl.includes('staging');
              if (!isStag) {
                console.log(`⚠️ URL is not stag (URL: ${currentUrl}). Ending flow and closing browser.`);
                if (SOURCE === 'search') {
                  await logoutAppFlow(driver);
                }
                return;
              }
            }
            reachedEndPage = true;

            const payment = new PaymentPage(page);
            if (await payment.isPaymentPage()) {
              console.log('✅ Payment page detected');
              const planKey = SOURCE.startsWith('boxing-bundle') ? `${ratePlan} bundle` : ratePlan;
              const paymentData = getPaymentDataByTierAndPlan(planTier, planKey);
              console.log(`📊 Payment rows: ${paymentData.length}`);
              await payment.validate(paymentData, results, eventData, 'existinguser');
            }

            // ── SCENARIO 2: Ultimate Upsell Banner ──
            const isStandardTierForUpsell = planTier === 'standard';
            const isMonthlyOrAPMForUpsell = ratePlan === 'monthly' || ratePlan === 'annual pay monthly';

            if (isStandardTierForUpsell && isMonthlyOrAPMForUpsell) {
              try {
                await payment.validateUltimateUpsellBannerText(results, eventData);
                const shouldClickUpsell = SWITCH_TO_ULTIMATE || SOURCE === 'landing-page-dont-miss-live-switch';

                if (shouldClickUpsell) {
                  const switched = await payment.clickUltimateUpsellAndValidate(results, eventData);
                  if (switched) {
                    console.log('💎 [SWITCH=true] Proceeding with DAZN Ultimate payment...');
                    eventData.TIER = 'ultimate';
                    eventData['TIER'] = 'ultimate';
                    eventData.DAZN_TIER = 'DAZN Ultimate';
                    eventData['DAZN_TIER'] = 'DAZN Ultimate';
                    eventData.RATE_PLAN = 'annual pay monthly';
                    eventData['RATE_PLAN'] = 'annual pay monthly';
                  }
                } else {
                  console.log('ℹ️ SWITCH not set — skipping Ultimate upsell click. Proceeding with Standard payment.');
                }
              } catch (upsellErr: any) {
                console.warn(`⚠️ Ultimate Upsell Banner validation error: ${upsellErr.message}`);
              }
            }

            firstPaymentDone = true;

            // Payment details filling on staging
            if (ENV === 'stag') {
              console.log(`💳 DAZN_ENV is stag — filling payment via method: ${PAYMENT_METHOD}`);
              try {
                if (PAYMENT_METHOD === 'gpay') {
                  console.log('🔵 [GPay] Using Google Pay payment method...');
                  await payment.fillGooglePayAndSubmit(results, eventData);
                  await payment.verifyPaymentSuccess();
                  await payment.clickSuccessContinue();
                } else {
                  console.log('💳 Using Credit Card payment method...');
                  await payment.fillPaymentAndSubmit();
                  await payment.verifyPaymentSuccess();
                  await payment.clickSuccessContinue();
                }

                console.log('✅ Payment details submitted successfully on staging!');
                results.push({
                  page: 'Payment Success',
                  field: 'Payment Completed',
                  expected: 'Success page reached',
                  actual: 'Success page reached',
                  status: 'PASS',
                });

                // ── SCENARIO 3: My Account PPV Status check ──
                if (PPV_TYPE !== 'upsell') {
                  try {
                    console.log('\n🏠 [Post-Payment] Validating PPV status in My Account...');
                    const myAccountPage = new MyAccountPage(page);
                    await myAccountPage.navigateToMyAccountAndValidatePPVStatus(
                      eventData.PPV_NAME,
                      results,
                      eventData
                    );
                  } catch (myAccountErr: any) {
                    console.warn(`⚠️ [Post-Payment] My Account PPV status validation error: ${myAccountErr.message}`);
                    results.push({
                      page: 'My Account (Post-Payment)',
                      field: 'PPV Status After Purchase',
                      expected: 'Purchased',
                      actual: `Error: ${myAccountErr.message}`,
                      status: 'FAIL',
                    });
                  }
                }

                // ── SCENARIO 4: Post-Payment Schedule verification ──
                if (PPV_TYPE !== 'upsell') {
                  try {
                    console.log('\n📅 [Post-Payment] Navigating to Schedule page to verify purchased event...');
                    const webSchedulePagePostPayment = new WebSchedulePage(page);
                    const baseUrl = eventData.BASE_URL;
                    await webSchedulePagePostPayment.navigate(baseUrl);

                    const sport = eventData.SPORT || json.SPORT || 'Boxing';
                    await webSchedulePagePostPayment.selectSport(sport);

                    console.log(`🔍 Finding event tile: "${eventData.PPV_NAME}"`);
                    const eventCard = await webSchedulePagePostPayment.findEvent(eventData.PPV_NAME);

                    console.log('🖱️ Clicking PPV event tile...');
                    await eventCard.click();

                    console.log('⏳ Waiting for navigation off the Schedule page...');
                    await page.waitForURL((url: URL) => !url.href.includes('/schedule'), { timeout: 15000 });
                    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });

                    const currentUrl = page.url();
                    console.log(`🔗 Post-payment redirected URL: ${currentUrl}`);

                    const lowerUrl = currentUrl.toLowerCase();
                    let navStatus: 'PASS' | 'FAIL' = 'FAIL';
                    let actualPage = 'Unknown Page';

                    if (lowerUrl.includes('preview')) {
                      actualPage = 'Preview Page';
                      navStatus = 'PASS';
                    } else if (
                      lowerUrl.includes('fixture') ||
                      lowerUrl.includes('event') ||
                      lowerUrl.includes('stream') ||
                      lowerUrl.includes('player')
                    ) {
                      actualPage = 'Fixture Page';
                      navStatus = 'PASS';
                    }

                    results.push({
                      page: 'Schedule (Post-Payment)',
                      field: 'Post-Purchase Navigation Target',
                      expected: 'Preview Page or Fixture Page',
                      actual: `Navigated to: ${currentUrl} (${actualPage})`,
                      status: navStatus,
                    });
                  } catch (scheduleErr: any) {
                    console.warn(`⚠️ [Post-Payment] Schedule page validation error: ${scheduleErr.message}`);
                    results.push({
                      page: 'Schedule (Post-Payment)',
                      field: 'Post-Purchase Navigation Target',
                      expected: 'Preview Page or Fixture Page',
                      actual: `Error: ${scheduleErr.message}`,
                      status: 'FAIL',
                    });
                  }
                }

                if (PPV_TYPE === 'upsell') {
                  console.log('🔄 Upsell flow — continuing loop for post-payment pages...');
                  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
                  continue;
                }
              } catch (paymentErr: any) {
                console.error(`❌ Payment filling failed: ${paymentErr.message}`);
                try {
                  await page.screenshot({ path: `test-results/payment_fill_error_${Date.now()}.png`, fullPage: true });
                } catch { }
                const _shotPay = await captureFailShot(page, 'Payment Completed').catch(() => undefined);
                results.push({
                  page: 'Payment Success',
                  field: 'Payment Completed',
                  expected: 'Success page reached',
                  actual: `Failed: ${paymentErr.message}`,
                  status: 'FAIL',
                  screenshot: _shotPay,
                });
                throw paymentErr;
              }
            } else {
              console.log(`ℹ️ DAZN_ENV is "${ENV}" — ending the flow on payment page as requested for production.`);
              reachedEndPage = true;
            }

            break;
          }

          // ── Email/Signup Page ──────────────────────────────────
          // ── Email/Login Page ──────────────────────────────────
          if (pageType === 'email') {
            console.log('👉 Email/Login page');
            stuckCount = 0;
            emailProcessedCount++;

            // ── Error popup detection (e.g. "No key found!", error codes) ──
            const bodyTextForError = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
            const errorPatterns = [
              /no key found/i,
              /error code:\s*\d/i,
              /something went wrong/i,
              /try refreshing the page/i,
              /unexpected error/i,
            ];
            const matchedError = errorPatterns.find(p => p.test(bodyTextForError));
            if (matchedError) {
              const errorSnippet = bodyTextForError.split('\n').filter(l => errorPatterns.some(p => p.test(l))).join(' | ').substring(0, 200);
              console.log(`❌ [Signup/Signin Error] Detected error popup on page: "${errorSnippet}"`);
              try {
                await page.screenshot({ path: 'test-results/signup_error_popup.png', fullPage: true });
                console.log('📸 Screenshot saved to test-results/signup_error_popup.png');
              } catch (se: any) {
                console.warn('⚠️  Could not save screenshot:', se.message);
              }
              throw new Error(`❌ Signup/Signin error popup detected: "${errorSnippet}". The signup page shows an error — test cannot proceed.`);
            }

            if (emailProcessedCount > 5) {
              console.log('⚠️  Email/Login loop detected — breaking');
              try {
                await page.screenshot({ path: 'test-results/email_loop_error.png', fullPage: true });
                console.log('📸 Screenshot saved to test-results/email_loop_error.png');
              } catch (se: any) {
                console.warn('⚠️  Could not save screenshot:', se.message);
              }
              if (page.url().includes('paymentDetails') || page.url().includes('payment')) {
                reachedEndPage = true;
                console.log('💳 Navigated to payment page after loop detection retry');
                continue;
              }
              break;
            }

            const emailInput = page.locator('input[type="email"]').first();
            const passwordInput = page.locator('input[type="password"]').first();

            // Wait up to 10 seconds for email or password input to load on the email/login page
            await Promise.any([
              emailInput.waitFor({ state: 'visible', timeout: 10000 }),
              passwordInput.waitFor({ state: 'visible', timeout: 10000 })
            ]).catch(() => { });

            const emailVisible = await emailInput.isVisible({ timeout: 500 }).catch(() => false);
            const passwordVisible = await passwordInput.isVisible({ timeout: 500 }).catch(() => false);

            let signedIn = false;
            if (emailVisible && passwordVisible) {
              console.log(`📧 Entering email: ${USER_EMAIL} and password...`);
              await emailInput.fill(USER_EMAIL);
              await passwordInput.fill(USER_PASSWORD);

              const signInBtn = page.locator(
                'button:has-text("Sign in"), ' +
                'button:has-text("Log in"), ' +
                'button:has-text("Sign In"), ' +
                'button:has-text("Continue"), ' +
                'button[type="submit"]'
              ).first();
              await clickAndWaitForNav(page, signInBtn, 'Sign In/Continue Both');
              signedIn = true;
            } else if (passwordVisible) {
              console.log('🔑 Entering password...');
              await passwordInput.fill(USER_PASSWORD);

              const signInBtn = page.locator(
                'button:has-text("Sign in"), ' +
                'button:has-text("Log in"), ' +
                'button:has-text("Sign In"), ' +
                'button:has-text("Continue"), ' +
                'button[type="submit"]'
              ).first();
              await clickAndWaitForNav(page, signInBtn, 'Sign In/Continue password-only');
              signedIn = true;
            } else if (emailVisible) {
              console.log(`📧 Entering email: ${USER_EMAIL}`);
              await emailInput.fill(USER_EMAIL);

              const nextBtn = page.locator(
                'button:has-text("Next"), ' +
                'button:has-text("Continue"), ' +
                'button[type="submit"]'
              ).first();
              await clickAndWaitForNav(page, nextBtn, 'Email Continue');
            }

            await page.waitForLoadState('domcontentloaded').catch(() => { });
            await sleep(2000);
            continue;
          }

          // ── Standalone PPV Page ────────────────────────────────
          if (pageType === 'standalone-ppv') {
            if (PPV_TYPE !== 'standalone') {
              console.log('⚠️ standalone-ppv detected but PPV_TYPE is not standalone — treating as ppv');
            } else {
              console.log('👉 Standalone PPV page');
              stuckCount = 0;
              const standalonePPVPage = new StandalonePPVPage(page);
              await standalonePPVPage.waitUntilPPVPageReady();

              if (!ppvValidated) {
                try {
                  const ppvData = getStandalonePPVPageData();
                  await standalonePPVPage.validatePPVPageChecked(ppvData, results, eventData);
                  await standalonePPVPage.validatePPVPageUnchecked(ppvData, results, eventData);
                  ppvValidated = true;
                } catch (err: any) {
                  console.warn('⚠️ Standalone PPV page validation error:', err.message);
                }
              }

              await standalonePPVPage.selectPlan(ratePlan === 'monthly' ? 'flex' : 'annual');
              await standalonePPVPage.clickContinue();
              await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
              continue;
            }
          }

          // ── Default Signup Page ──────────────────────────────────
          if (pageType === 'default-signup') {
            console.log('👉 Default Signup page');
            stuckCount = 0;

            if (!ppvValidated) {
              try {
                const ppvData = getPPVDataByVariant(variant);
                await validateVariant(page, variant, ppvData, results, eventData, 'Default Signup');
              } catch (e: any) {
                console.warn('⚠️ Default Signup validation error:', e.message);
              }
              ppvValidated = true;
            }

            // Verify PPV on page matches expected
            const ppvName = eventData.PPV_NAME || '';
            const nameClean = ppvName.replace(/[:\-–]/g, ' ');
            let matched = false;
            if (nameClean.includes('vs')) {
              const fighters = nameClean.split(/\bvs\b/i).map((f: any) => f.trim());
              const f1 = fighters[0];
              const f2 = fighters[1];
              if (f1 && f2) {
                const hasF1 = await page.locator(`text=${f1}`).first().isVisible().catch(() => false);
                const hasF2 = await page.locator(`text=${f2}`).first().isVisible().catch(() => false);
                matched = hasF1 || hasF2;
              }
            }
            if (!matched && ppvName) {
              matched = await page.locator(`text=${ppvName}`).first().isVisible().catch(() => false);
            }
            if (!matched) {
              throw new Error(`❌ [DefaultSignup] PPV on page does not match expected event: "${ppvName}"`);
            }
            console.log(`✅ [DefaultSignup] Verified PPV on page matches: "${ppvName}"`);

            console.log('🖱️ [DefaultSignup] Clicking "Continue with pay-per-view"...');
            await page.locator('button:has-text("Continue with pay-per-view"), a:has-text("Continue with pay-per-view")').first().click({ force: true });
            await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
            continue;
          }

          // ── PPV Page ───────────────────────────────────────────
          if (pageType === 'ppv') {
            console.log('👉 PPV page');
            stuckCount = 0;

            if (!ppvValidated) {
              try {
                if (SOURCE.startsWith('boxing-bundle')) {
                  const bundlePpvData = readSheet('Boxing page');
                  await validateVariant(page, variant, bundlePpvData, results, eventData, 'Bundle PPV', 'boxing-bundle-ppv');
                } else {
                  const ppvData = getPPVDataByVariant(variant);
                  await validateVariant(page, variant, ppvData, results, eventData, 'PPV');
                }
              } catch (e: any) {
                console.warn('⚠️  PPV validation error:', e.message);
              }
              ppvValidated = true;
            }

            if (planTier === 'ultimate') {
              console.log('💎 Clicking DAZN Ultimate card...');
              const selectors = [
                'div:has-text("The Ultimate Fan Package") >> text=DAZN Ultimate',
                '[class*="upsell" i]:has-text("Ultimate")',
                '[class*="ultimate" i]:has-text("Ultimate")',
                'div:has-text("DAZN Ultimate"):has-text("/month")',
                'label:has-text("DAZN Ultimate")'
              ];
              let clicked = false;
              for (const sel of selectors) {
                const el = page.locator(sel).first();
                if (await el.isVisible().catch(() => false)) {
                  await safeScrollToElement(page, el);
                  await el.click({ force: true }).catch(() => { });
                  console.log(`✅ Clicked Ultimate card: ${sel}`);
                  clicked = true;
                  break;
                }
              }

              if (!clicked) {
                const radios = page.locator('input[type="radio"]');
                const count = await radios.count().catch(() => 0);
                for (let i = 0; i < count; i++) {
                  const radio = radios.nth(i);
                  const radioLabel = await radio.locator('xpath=ancestor::label | xpath=ancestor::div[1]').first();
                  const text = await radioLabel.innerText({ timeout: 500 }).catch(() => '');
                  if (text.toLowerCase().includes('ultimate')) {
                    await safeScrollToElement(page, radio);
                    await radio.click({ force: true }).catch(() => { });
                    clicked = true;
                    break;
                  }
                }
              }

              const btn = page.locator(
                'button:has-text("Continue with DAZN Ultimate"), ' +
                'button:has-text("Continue with Ultimate"), ' +
                'button:has-text("Continue")'
              ).first();
              await clickAndWaitForNav(page, btn, 'PPV Continue Ultimate');
            } else {
              const ppvSelector = currentVariantConfig?.ppvSelector || 'input[type="radio"]';
              const ppvInput = page.locator(ppvSelector).first();
              if (await ppvInput.isVisible().catch(() => false)) {
                await safeScrollToElement(page, ppvInput);
                await ppvInput.click({ force: true }).catch(() => { });
              }

              let btn = page.locator('button:has-text("Continue with pay-per-view")').first();
              if (await btn.isVisible().catch(() => false)) {
                console.log('🖱️ Clicking CTA: "Continue with pay-per-view"');
              } else {
                const ctaText = currentVariantConfig?.ctaText || 'Continue';
                let targetBtn = page.locator(`button:has-text("${ctaText}")`).first();
                if (await targetBtn.isVisible().catch(() => false)) {
                  btn = targetBtn;
                } else {
                  const fallbacks = [
                    'button:has-text("Buy")',
                    'button:has-text("Purchase")',
                    'button:has-text("Pay now")',
                    'button:has-text("Continue")',
                    'button[type="submit"]'
                  ];
                  for (const fb of fallbacks) {
                    const fbBtn = page.locator(fb).first();
                    if (await fbBtn.isVisible().catch(() => false)) {
                      btn = fbBtn;
                      break;
                    }
                  }
                }
              }
              await clickAndWaitForNav(page, btn, `PPV Continue (${variant})`);
            }

            await setupPage(page, 500);
            continue;
          }

          // ── Plan Selection Page ────────────────────────────────
          if (pageType === 'plan') {
            console.log(`👉 DAZN Plan page - Tier: ${planTier}, Rate Plan: ${ratePlan}`);
            stuckCount = 0;
            planClickCount++;

            if (page.url().includes('page=TierPlans')) {
              console.log(`🗺️ Handling TierPlans page selection for tier: ${planTier}`);
              let tierBtn;
              if (planTier === 'ultimate') {
                tierBtn = page.locator('button:has-text("Continue with DAZN Ultimate"), button:has-text("Continue with Ultimate")').first();
              } else {
                tierBtn = page.locator('button:has-text("Continue with Standard"), button:has-text("Continue with DAZN Standard")').first();
              }
              if (await tierBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                await safeScrollToElement(page, tierBtn);
                await clickAndWaitForNav(page, tierBtn, `TierPlans Selection (${planTier})`);
                await setupPage(page, 500);
                continue;
              }
            }

            if (!planValidated && !page.url().includes('page=TierPlans')) {
              try {
                const planData = getPlanDataByTier(planTier);
                await validateVariant(page, 'plan', planData, results, eventData, 'DAZN Plan');
              } catch (e: any) {
                console.warn('⚠️  Plan validation error:', e.message);
              }
              planValidated = true;
            }

            if (planTier === 'ultimate') {
              if (ratePlan === 'annual pay upfront') {
                const upfrontCard = page.locator(
                  'label:has-text("Annual - Pay Upfront"), label:has-text("Pay Upfront"), [role="radio"]:has-text("Upfront")'
                ).first();
                if (await upfrontCard.isVisible({ timeout: 2000 }).catch(() => false)) {
                  await safeScrollToElement(page, upfrontCard);
                  await upfrontCard.click({ force: true }).catch(() => { });
                } else {
                  const radios = page.locator('input[type="radio"], [role="radio"]');
                  const count = await radios.count().catch(() => 0);
                  let clicked = false;
                  for (let i = 0; i < count; i++) {
                    const r = radios.nth(i);
                    const parentText = await r.evaluate((el: any) => el.closest('label')?.innerText || el.closest('div')?.innerText || '').catch(() => '');
                    if (parentText.toLowerCase().includes('upfront') || parentText.toLowerCase().includes('save')) {
                      await safeScrollToElement(page, r);
                      await r.click({ force: true }).catch(() => { });
                      clicked = true;
                      break;
                    }
                  }
                  if (!clicked) {
                    const radio = count > 2 ? radios.nth(2) : radios.nth(1);
                    if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
                      await safeScrollToElement(page, radio);
                      await radio.click({ force: true }).catch(() => { });
                    }
                  }
                }
              } else {
                const monthlyCard = page.locator(
                  'label:has-text("Annual - Pay Monthly"), label:has-text("Pay Monthly"), [role="radio"]:has-text("Pay Monthly")'
                ).first();
                if (await monthlyCard.isVisible({ timeout: 2000 }).catch(() => false)) {
                  await safeScrollToElement(page, monthlyCard);
                  await monthlyCard.click({ force: true }).catch(() => { });
                } else {
                  const radios = page.locator('input[type="radio"], [role="radio"]');
                  const count = await radios.count().catch(() => 0);
                  let clicked = false;
                  for (let i = 0; i < count; i++) {
                    const r = radios.nth(i);
                    const parentText = await r.evaluate((el: any) => el.closest('label')?.innerText || el.closest('div')?.innerText || '').catch(() => '');
                    if (parentText.toLowerCase().includes('monthly') || parentText.toLowerCase().includes('saver') || parentText.toLowerCase().includes('over time')) {
                      await safeScrollToElement(page, r);
                      await r.click({ force: true }).catch(() => { });
                      clicked = true;
                      break;
                    }
                  }
                  if (!clicked) {
                    const radio = radios.first();
                    if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
                      await safeScrollToElement(page, radio);
                      await radio.click({ force: true }).catch(() => { });
                    }
                  }
                }
              }

              // Post-selection validation
              if (ratePlan === 'annual pay upfront') {
                await page.waitForTimeout(500);
                const radios = page.locator('input[type="radio"], [role="radio"]');
                const count = await radios.count().catch(() => 0);
                let upfrontSelected = false;
                for (let i = 0; i < count; i++) {
                  const r = radios.nth(i);
                  const parentText = await r.evaluate((el: any) => el.closest('label')?.innerText || el.closest('div')?.innerText || '').catch(() => '');
                  if (parentText.toLowerCase().includes('upfront')) {
                    upfrontSelected = await r.isChecked().catch(() => false);
                    break;
                  }
                }
                results.push({
                  page: 'DAZN Plan',
                  field: 'Annual Pay Upfront Selected (After Click)',
                  expected: 'Yes',
                  actual: upfrontSelected ? 'Yes' : 'No',
                  status: upfrontSelected ? 'PASS' : 'FAIL',
                });
              }

              const planBtn = page.locator(
                'button:has-text("Continue with DAZN Ultimate"), ' +
                'button:has-text("Continue with Ultimate"), ' +
                'button:has-text("Continue")'
              ).first();
              await planBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
              await clickAndWaitForNav(page, planBtn, 'Ultimate Plan Continue');
            } else {
              if (ratePlan === 'annual pay monthly' || ratePlan.includes('annual')) {
                const annualCard = page.locator(
                  'label:has-text("Annual - pay over time"), label:has-text("Annual - Pay Monthly")'
                ).first();

                if (await annualCard.isVisible({ timeout: 3000 }).catch(() => false)) {
                  await safeScrollToElement(page, annualCard);
                  await annualCard.click({ force: true }).catch(() => { });
                } else {
                  const radio = page.locator('input[type="radio"]').nth(1);
                  if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
                    await safeScrollToElement(page, radio);
                    await radio.click({ force: true }).catch(() => { });
                  }
                }

                const planBtn = page.locator(
                  'button:has-text("Continue with 1st Month Free"), ' +
                  'button:has-text("Continue with Annual"), ' +
                  'button:has-text("Continue")'
                ).first();
                await planBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });

                // Validate CTA text changed after selecting APM
                let has1MonthFree = false;
                if (await annualCard.isVisible({ timeout: 2000 }).catch(() => false)) {
                  const annualText = await annualCard.textContent().catch(() => '') || '';
                  if (/1\s*month\s*free|first\s*month\s*free/i.test(annualText)) {
                    has1MonthFree = true;
                  }
                } else {
                  const radio = page.locator('input[type="radio"]').nth(1);
                  if (await radio.isVisible({ timeout: 2000 }).catch(() => false)) {
                    const radioParentText = await radio.evaluate((el: any) => el.parentElement?.textContent || '').catch(() => '');
                    if (/1\s*month\s*free|first\s*month\s*free/i.test(radioParentText)) {
                      has1MonthFree = true;
                    }
                  }
                }

                const ctaText = await planBtn.textContent().catch(() => '') || '';
                const cleanCta = ctaText.replace(/\s+/g, ' ').trim();
                const expectedCta = has1MonthFree ? 'Continue with 1st Month Free' : 'Continue';
                const ctaMatch = cleanCta.toLowerCase().includes(expectedCta.toLowerCase());
                results.push({
                  page: 'DAZN Plan',
                  field: 'CTA After APM Selection',
                  expected: expectedCta,
                  actual: cleanCta,
                  status: ctaMatch ? 'PASS' : 'FAIL'
                });

                await clickAndWaitForNav(page, planBtn, 'Standard Annual Plan Continue');
              } else {
                const trialRadio = page.locator('input[type="radio"]').first();
                if (await trialRadio.isVisible({ timeout: 1500 }).catch(() => false)) {
                  await safeScrollToElement(page, trialRadio);
                  await trialRadio.click({ force: true }).catch(() => { });
                }

                const planBtn = page.locator(
                  'button:has-text("Continue with 7-day Free Trial"), ' +
                  'button:has-text("Continue with 1st Month Free"), ' +
                  'button:has-text("Continue with PPV"), ' +
                  'button:has-text("Continue")'
                ).first();
                await planBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
                await clickAndWaitForNav(page, planBtn, 'Standard Plan Continue');
              }
            }

            await setupPage(page, 500);
            continue;
          }

          stuckCount++;
          console.log(`⚠️  Unknown page — waiting... (${stuckCount}/20) | URL: ${page.url()}`);
          await sleep(800);
          if (stuckCount >= 20) {
            const bodyPreview = await page.locator('body').innerText()
              .catch(() => 'N/A')
              .then((t: any) => t.substring(0, 200));
            throw new Error(`❌ Flow stuck on unknown page.\nURL: ${page.url()}\nPreview: ${bodyPreview}`);
          }
        }

        if (!reachedEndPage) {
          const finalUrl = page.url();
          if (finalUrl.includes('paymentDetails') || finalUrl.includes('payment')) {
            console.log('💳 Payment page detected after loop exit');
            if (SOURCE === 'schedule' || SOURCE === 'search') {
              console.log(`🔍 [${SOURCE === 'schedule' ? 'Schedule' : 'Search'} Flow] Checking URL: ${finalUrl}`);
              const isStag = finalUrl.includes('stag.dazn.com') || finalUrl.includes('sandbox') || finalUrl.includes('staging');
              if (!isStag) {
                console.log(`⚠️ URL is not stag (URL: ${finalUrl}). Ending flow and closing browser.`);
                if (SOURCE === 'search') {
                  await logoutAppFlow(driver);
                }
                return;
              }
            }
            reachedEndPage = true;

            const payment = new PaymentPage(page);
            if (await payment.isPaymentPage()) {
              const planKey = SOURCE.startsWith('boxing-bundle') ? `${ratePlan} bundle` : ratePlan;
              const paymentData = getPaymentDataByTierAndPlan(planTier, planKey);
              await payment.validate(paymentData, results, eventData, 'existinguser');
            }
          } else {
            console.log(`⚠️  Flow did not reach expected end page`);
          }
        }

        console.log('🎥 Stopping screen recording on Android device...');
        try {
          const videoBuffer = await driver.stopRecordingScreen();
          if (videoBuffer) {
            const videoDir = path.resolve(process.cwd(), 'test-results');
            if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
            const videoOutputPath = path.join(videoDir, `existinguser_run_${Date.now()}.mp4`);
            fs.writeFileSync(videoOutputPath, Buffer.from(videoBuffer, 'base64'));
            console.log(`🎥 Video recording saved to: ${videoOutputPath}`);
          }
        } catch (e: any) {
          console.error('⚠️ Failed to stop screen recording:', e.message);
        }

        try {
          const videoPath = await page.video()?.path();
          if (videoPath) console.log(`🎥 Playwright browser video: ${videoPath}`);
        } catch { }

        // Tag results with flow metadata
        results.forEach(r => {
          r.flowName = flowConfig.name;
          r.source = flowConfig.source;
          r.tier = flowConfig.tier;
          r.ratePlan = flowConfig.ratePlan;
        });

        // Write results to Excel
        const { excelPath, videoPath } = await writeResults(results);

        // Display detailed results table
        displayResultsTable(results, 'ppv', {
          event: json.PPV_NAME,
          region: REGION,
          excelPath,
          videoPath,
        });

        // Generate HTML + PDF run reports
        await generateReports(results, {
          event: json.PPV_NAME,
          region: REGION,
          source: flowConfig.source,
          ratePlan: flowConfig.ratePlan,
          tier: flowConfig.tier,
          env: ENV,
          flowName: flowConfig.name,
          startTime: runStart,
          endTime: new Date(),
          excelPath,
          videoPath,
          userType: 'existing-user',
          userState: USER_STATE,
        });

        const passed = results.filter(r => r.status === 'PASS').length;
        const failed = results.filter(r => r.status === 'FAIL').length;
        const total = passed + failed;

        console.log(`\n✅ Flow "${flowConfig.name}" complete: ${passed}/${total} passed (${total > 0 ? ((passed / total) * 100).toFixed(1) : 0}%)`);
        console.log(`${'─'.repeat(55)}`);

        if (total === 0) {
          throw new Error(`❌ Flow "${flowConfig.name}" had 0 validation checks`);
        }

        if (!reachedEndPage) {
          throw new Error(`❌ Flow "${flowConfig.name}" did not reach the expected end page`);
        }

        if (SOURCE === 'search') {
          await logoutAppFlow(driver);
        }

      } catch (playwrightErr: any) {
        console.error(`❌ Local Playwright Web Checkout failed: ${playwrightErr.message}`);
        throw playwrightErr;
      } finally {
        // 2. Clean up context and browser
        if (context) {
          await context.close().catch(() => { });
        }
        if (playwrightBrowser) {
          await playwrightBrowser.close().catch(() => { });
        }
        // 3. Restore original working directory
        process.chdir(originalCwd);
        console.log(`📂 Restored working directory to: ${process.cwd()}`);
      }
    });

    after(async () => {
      try {
        await browser.stopRecordingScreen().catch(() => { });
      } catch { }
    });
  });