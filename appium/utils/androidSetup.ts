import { execSync } from 'child_process';

const APP_PACKAGE = process.env.APP_PACKAGE || 'com.dazn';
const ANDROID_SDK = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
const ADB = `${ANDROID_SDK}/platform-tools/adb`;
const COOKIE_BUTTON_XPATH = '//android.widget.Button[@resource-id="com.dazn:id/btn_accept_cookies"]';

type WdBrowser = any;
type WdElement = any;

type PrepareAndroidAppOptions = {
  clearAppData?: boolean;
};

function adb(cmd: string, driver?: any): string {
  try {
    const udid = driver?.capabilities?.['appium:udid'] || driver?.capabilities?.udid || process.env.DEVICE_SERIAL || '';
    const prefix = udid ? `-s ${udid} ` : '';
    return execSync(`${ADB} ${prefix}${cmd}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    }).trim();
  } catch {
    return '';
  }
}

async function clickIfVisible(el: WdElement, label: string): Promise<boolean> {
  try {
    if (await el.isDisplayed()) {
      await el.click();
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
      if (await clickIfVisible(el, label)) return true;
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
    'android=new UiSelector().resourceId("com.android.permissioncontroller:id/permission_allow_button")',
    'android=new UiSelector().resourceId("com.android.permissioncontroller:id/permission_allow_foreground_only_button")',
    'android=new UiSelector().resourceId("android:id/button1")',
    'android=new UiSelector().descriptionContains("Close")',
    'android=new UiSelector().descriptionContains("Dismiss")',
    'android=new UiSelector().textMatches("(?i)^(Explore|Continue|Start watching|Done|OK|Allow)$")',
    'android=new UiSelector().textMatches("(?i)^(Not now|No thanks|Maybe later|Skip|Cancel|Remind me later)$")',
  ], 'Startup dialog dismissed');
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

export async function waitForHomePage(driver: WdBrowser, timeoutMs = 90000): Promise<void> {
  let sawCookiePrompt = false;
  let sawStartupDialog = false;

  try {
    await driver.waitUntil(async () => {
      if (await acceptCookiesIfPresent(driver)) {
        sawCookiePrompt = true;
        // Pause briefly after cookie dismissal so the app can transition to home
        await driver.pause(2000);
        return false;
      }

      if (await isHomeReady(driver)) {
        return true;
      }

      if (await dismissOneStartupDialog(driver)) {
        sawStartupDialog = true;
        // Pause briefly after dialog dismissal to let the UI settle
        await driver.pause(1500);
        return false;
      }

      return false;
    }, {
      timeout: timeoutMs,
      interval: 1000,
      timeoutMsg: 'Android app did not reach Home page after startup cleanup',
    });
  } catch (error) {
    await driver.saveScreenshot('./test-results/android_startup_not_ready.png').catch(() => {});
    throw error;
  }

  if (!sawCookiePrompt) console.log('ℹ️ Cookie popup not shown');
  if (!sawStartupDialog) console.log('ℹ️ Startup dialogs not shown');
  console.log('✅ Home page detected');
}

export async function prepareAndroidApp(driver: WdBrowser, options: PrepareAndroidAppOptions = {}) {
  const clearAppData = options.clearAppData !== false;

  console.log('═══════════════════════════════════════');
  console.log('📱 Preparing Android app');
  console.log('═══════════════════════════════════════');

  // Kill app if already running
  try {
    await driver.terminateApp(APP_PACKAGE);
    console.log('✅ App terminated');
  } catch {}

  if (clearAppData) {
    try {
      adb(`shell pm clear ${APP_PACKAGE}`, driver);
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

  await waitForHomePage(driver);

  console.log('✅ Android app ready');
  console.log('═══════════════════════════════════════');
}
