import { execSync } from 'child_process';

const APP_PACKAGE = process.env.APP_PACKAGE || 'com.dazn';
const ANDROID_SDK = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
const ADB = `${ANDROID_SDK}/platform-tools/adb`;
const COOKIE_BUTTON_XPATH = '//android.widget.Button[@resource-id="com.dazn:id/btn_accept_cookies"]';
const DEVICE_SERIAL = process.env.DEVICE_SERIAL || '';

type WdBrowser = any;
type WdElement = any;

type PrepareAndroidAppOptions = {
  clearAppData?: boolean;
  waitForHome?: boolean;
  acceptCookiesOnly?: boolean;
};

function adb(cmd: string): string {
  try {
    const serialArg = DEVICE_SERIAL ? `-s ${DEVICE_SERIAL} ` : '';
    return execSync(`${ADB} ${serialArg}${cmd}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    }).trim();
  } catch {
    return '';
  }
}

async function clickIfVisible(el: WdElement, label: string, driver: WdBrowser): Promise<boolean> {
  try {
    if (await el.isDisplayed().catch(() => false) || await el.isExisting()) {
      try {
        await el.click();
      } catch (clickErr: any) {
        console.warn(`  Native click failed: ${clickErr.message}. Trying ADB tap fallback...`);
        const rect = await el.getRect();
        const tapX = Math.round(rect.x + rect.width / 2);
        const tapY = Math.round(rect.y + rect.height / 2);
        const caps: any = await driver.getCapabilities().catch(() => ({}));
        const udid = caps['appium:udid'] || caps.udid || caps['appium:deviceUDID'] || caps.deviceUDID || process.env.DEVICE_SERIAL || '';
        const serialArg = udid ? `-s ${udid}` : '';
        const { execSync } = require('child_process');
        const ANDROID_SDK = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
        const ADB = `${ANDROID_SDK}/platform-tools/adb`;
        execSync(`${ADB} ${serialArg} shell input tap ${tapX} ${tapY}`);
      }
      console.log(`✅ ${label}`);
      return true;
    }
  } catch {}

  return false;
}

async function tapFirstVisible(driver: WdBrowser, selectors: string[], label: string): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const el = await driver.$(selector);
      if (await clickIfVisible(el, label, driver)) return true;
    } catch {}
  }

  return false;
}

async function acceptCookiesIfPresent(driver: WdBrowser): Promise<boolean> {
  return tapFirstVisible(driver, [
    COOKIE_BUTTON_XPATH,
    'android=new UiSelector().resourceId("com.dazn:id/btn_accept_cookies")',
    'android=new UiSelector().textContains("Accept")',
    'android=new UiSelector().textContains("I Agree")',
  ], 'Cookies accepted');
}

async function dismissOneStartupDialog(driver: WdBrowser): Promise<boolean> {
  return tapFirstVisible(driver, [
    '//android.widget.Button[@resource-id="com.android.permissioncontroller:id/permission_allow_button"]',
    'android=new UiSelector().resourceId("com.android.permissioncontroller:id/permission_allow_button")',
    'android=new UiSelector().resourceId("com.android.permissioncontroller:id/permission_allow_foreground_only_button")',
    'android=new UiSelector().resourceId("android:id/button1")',
    'android=new UiSelector().descriptionContains("Close")',
    'android=new UiSelector().descriptionContains("Dismiss")',
    'android=new UiSelector().textMatches("(?i)^(Explore|Continue|Start watching|Done|OK|Allow)$")',
    'android=new UiSelector().textMatches("(?i)^(Not now|No thanks|Maybe later|Skip|Cancel|Remind me later)$")',
  ], 'Startup dialog dismissed');
}

async function dismissLandingPage(driver: WdBrowser): Promise<boolean> {
  // Try to dismiss landing page by tapping Explore or swiping
  const exploredTapped = await tapFirstVisible(driver, [
    'android=new UiSelector().textMatches("(?i)^Explore$")',
    'android=new UiSelector().textMatches("(?i)^Get started$")',
    'android=new UiSelector().textMatches("(?i)^Continue$")',
    'android=new UiSelector().resourceId("com.dazn:id/btn_get_started")',
    'android=new UiSelector().resourceId("com.dazn:id/btn_continue")',
  ], 'Landing page dismissed');
  
  if (exploredTapped) {
    await driver.pause(2000); // Wait for navigation
    return true;
  }
  
  // If no button found, try swiping left
  try {
    const { width, height } = await driver.getWindowSize();
    await driver.action('pointer')
      .move({ x: Math.round(width * 0.8), y: Math.round(height * 0.5) })
      .down()
      .move({ x: Math.round(width * 0.2), y: Math.round(height * 0.5) })
      .up()
      .perform();
    await driver.pause(2000);
    console.log('  ✓ Landing page dismissed (swipe)');
    return true;
  } catch (e) {
    return false;
  }
}

async function isHomeReady(driver: WdBrowser): Promise<boolean> {
  const homeSelectors = [
    'android=new UiSelector().text("Home")',
    'android=new UiSelector().text("Sports")',
    'android=new UiSelector().text("Schedule")',
    'android=new UiSelector().text("Search")',
    'android=new UiSelector().descriptionContains("Home")',
    'android=new UiSelector().descriptionContains("Sports")',
    'android=new UiSelector().descriptionContains("Schedule")',
    'android=new UiSelector().descriptionContains("Search")',
  ];

  for (const selector of homeSelectors) {
    try {
      const el = await driver.$(selector);
      if (await el.isDisplayed()) return true;
    } catch {}
  }

  return false;
}

async function isLandingPageReady(driver: WdBrowser): Promise<boolean> {
  const landingIndicators = [
    // Text-based indicators
    'android=new UiSelector().textContains("DAZN")',
    'android=new UiSelector().textContains("Explore")',
    'android=new UiSelector().textContains("Start watching")',
    'android=new UiSelector().textContains("Welcome")',
    'android=new UiSelector().textContains("Get started")',
    'android=new UiSelector().textContains("Sign in")',
    'android=new UiSelector().textContains("Continue")',
    // Resource ID indicators
    'android=new UiSelector().resourceId("com.dazn:id/landing")',
    'android=new UiSelector().resourceId("com.dazn:id/splash")',
    'android=new UiSelector().resourceId("com.dazn:id/onboarding")',
    'android=new UiSelector().resourceId("com.dazn:id/get_started")',
    'android=new UiSelector().resourceId("com.dazn:id/btn_get_started")',
    'android=new UiSelector().resourceId("com.dazn:id/btn_continue")',
    // Description/content-desc indicators
    'android=new UiSelector().descriptionContains("DAZN")',
    'android=new UiSelector().descriptionContains("landing")',
  ];

  for (const selector of landingIndicators) {
    try {
      const el = await driver.$(selector);
      if (await el.isDisplayed()) {
        console.log(`  ✓ Landing page indicator found: ${selector}`);
        return true;
      }
    } catch {}
  }

  return false;
}

async function hasAnyVisibleElement(driver: WdBrowser): Promise<boolean> {
  // Fallback: check if the app has any visible UI by trying to get the current activity
  // This indicates the app has loaded, even if we can't identify the specific page
  try {
    const currentActivity = await driver.getCurrentActivity();
    if (currentActivity && currentActivity.includes('com.dazn') && !currentActivity.toLowerCase().includes('splash')) {
      console.log(`  ✓ App is running (activity: ${currentActivity})`);
      return true;
    }
  } catch (e) {
    console.log('  ⚠️ Could not get current activity for fallback');
  }
  
  // Secondary fallback: check page source for any UI elements
  try {
    const source = await driver.getPageSource();
    const hasContent = source.includes('android.widget.') || 
                       source.includes('android.view.') ||
                       source.includes('com.dazn.id');
    if (hasContent) {
      console.log('  ✓ App UI detected (page source fallback)');
      return true;
    }
  } catch (e) {
    console.log('  ⚠️ Could not check page source for fallback');
  }
  
  return false;
}

export async function waitForHomePage(driver: WdBrowser, timeoutMs = 120000): Promise<void> {
  let sawCookiePrompt = false;
  let sawStartupDialog = false;
  let lastCheckTime = Date.now();
  const startTime = Date.now();
  const checkInterval = 5000; // Log progress every 5 seconds

  try {
    await driver.waitUntil(async () => {
      const now = Date.now();
      if (now - lastCheckTime >= checkInterval) {
        lastCheckTime = now;
        console.log(`  ⏳ Still waiting for app to be ready... (${Math.floor((now - (lastCheckTime - checkInterval)) / 1000)}s elapsed)`);
      }

      if (await acceptCookiesIfPresent(driver)) {
        sawCookiePrompt = true;
        // Pause briefly after cookie dismissal so the app can transition to home
        await driver.pause(2000);
        return false;
      }

      if (await dismissOneStartupDialog(driver)) {
        sawStartupDialog = true;
        // Pause briefly after dialog dismissal to let the UI settle
        await driver.pause(1500);
        return false;
      }

      if (await isHomeReady(driver)) {
        console.log('  ✓ Home page detected');
        return true;
      }

      if (await isLandingPageReady(driver)) {
        console.log('  ✓ Landing page detected - dismissing to reach home');
        await dismissLandingPage(driver);
        // Don't return true yet - wait for home to appear after dismissal
        return false;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed > 40000 && await hasAnyVisibleElement(driver)) {
        console.log('  ✓ App UI detected (fallback after 40s)');
        return true;
      }

      return false;
    }, {
      timeout: timeoutMs,
      interval: 1000,
      timeoutMsg: `Android app did not reach Home or Landing page after ${Math.floor(timeoutMs / 1000)}s`,
    });
  } catch (error) {
    await driver.saveScreenshot('./test-results/android_startup_not_ready.png').catch(() => {});
    
    // Dump page source for debugging
    try {
      const pageSource = await driver.getPageSource();
      const debugFile = './test-results/android_startup_page_source.xml';
      require('fs').writeFileSync(debugFile, pageSource);
      console.log(`📄 Page source saved to: ${debugFile}`);
    } catch (e) {
      console.log('⚠️ Could not capture page source for debugging');
    }
    
    throw error;
  }

  if (!sawCookiePrompt) console.log('ℹ️ Cookie popup not shown');
  if (!sawStartupDialog) console.log('ℹ️ Startup dialogs not shown');
  console.log('✅ App ready (Home or Landing page detected)');
}

export async function prepareAndroidApp(driver: WdBrowser, options: PrepareAndroidAppOptions = {}) {
  const clearAppData = options.clearAppData !== false;

  console.log('═══════════════════════════════════════');
  console.log('📱 Preparing Android app');
  console.log('═══════════════════════════════════════');

  // Set device timezone to match region
  const REGION = (process.env.DAZN_REGION || 'GB').toUpperCase();
  const tzMap: Record<string, string> = {
    GB:  'Europe/London',
    UK:  'Europe/London',
    US:  'America/New_York',
    UAE: 'Asia/Dubai',
    AU:  'Australia/Sydney',
    BR:  'America/Sao_Paulo',
    DE:  'Europe/Berlin',
    IT:  'Europe/Rome',
    ES:  'Europe/Madrid',
    FR:  'Europe/Paris',
    CA:  'America/Toronto',
    JP:  'Asia/Tokyo',
  };
  const targetTz = tzMap[REGION] || 'Europe/London';
  try {
    adb(`shell setprop persist.sys.timezone ${targetTz}`);
    console.log(`✅ Set Android device timezone to: ${targetTz}`);
  } catch (err: any) {
    console.warn(`⚠️ Failed to set device timezone via ADB: ${err.message}`);
  }

  // Kill app if already running (use adb force-stop for reliability)
  try {
    adb(`shell am force-stop ${APP_PACKAGE}`);
    console.log('✅ App terminated');
  } catch {}

  if (clearAppData) {
    try {
      adb(`shell pm clear ${APP_PACKAGE}`);
      console.log('✅ App data cleared');
    } catch {
      console.log('⚠️ Unable to clear app data');
    }
  } else {
    console.log('ℹ️ App data preserved');
  }

  // Launch app
  await driver.activateApp(APP_PACKAGE);
  console.log('🚀 App launched');

  if (options.acceptCookiesOnly) {
    // Accept cookies but keep the landing page visible (don't dismiss it).
    // This is for LOGIN_FIRST flows where the "Log In" button is on the
    // landing page and must not be hidden by the cookie banner.
    console.log('⏳ Waiting for Landing page to load...');
    try {
      await driver.waitUntil(async () => {
        return await isLandingPageReady(driver);
      }, {
        timeout: 30000,
        interval: 1000,
        timeoutMsg: 'Android app landing page did not load in 30s'
      });
      console.log('✅ Landing page loaded');
    } catch (e: any) {
      console.warn(`⚠️ Warning: Landing page wait timed out: ${e.message}`);
    }

    console.log('🍪 Accepting cookies (landing page preserved)...');
    try {
      await acceptCookiesIfPresent(driver);
      console.log('✅ Cookies accepted, landing page visible');
    } catch (e) {
      console.log('ℹ️ No cookie banner detected');
    }
  } else if (options.waitForHome !== false) {
    await waitForHomePage(driver);
  } else {
    console.log('ℹ️ Skipping waiting for Home page');
  }

  console.log('✅ Android app ready');
  console.log('═══════════════════════════════════════');
}
