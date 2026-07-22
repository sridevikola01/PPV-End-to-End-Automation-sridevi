import { execSync } from 'child_process';
import { BannerInteraction } from '../../utils/bannerInteraction';

export type WdBrowser = any;
export type WdElement = any;

export interface AndroidScreenSize {
  width: number;
  height: number;
}

export type AndroidPPVSurface = 'PPV Banner' | 'PPV Tile';

export interface AndroidFlowHooks {
  validateSurface?: (surface: AndroidPPVSurface) => Promise<void>;
  validatePaywall?: () => Promise<void>;
  recordAvailability?: (available: boolean, screenshot?: string, page?: string) => void;
  saveScreenshot?: (relativePath: string) => Promise<string | undefined>;
  generateAvailabilityFailureReport?: (errorMessage: string) => Promise<void>;
}

export interface AndroidCopyResult {
  captured: boolean;
  url: string;
}

const MOBILE_BROWSER_PACKAGE = process.env.MOBILE_BROWSER_PACKAGE || 'com.android.chrome';
const ANDROID_SDK = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
const ADB = `${ANDROID_SDK}/platform-tools/adb`;
const DEVICE_SERIAL = process.env.DEVICE_SERIAL || '';

export function adb(cmd: string): string {
  try {
    const serialArg = DEVICE_SERIAL ? `-s ${DEVICE_SERIAL} ` : '';
    return execSync(`${ADB} ${serialArg}${cmd}`, { encoding: 'utf-8', timeout: 15000 }).trim();
  } catch {
    return '';
  }
}

export function getScreenSize(): AndroidScreenSize {
  const output = adb('shell wm size');
  const match = output.match(/(\d+)x(\d+)/);
  if (match) {
    return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
  }
  return { width: 1080, height: 2340 };
}

export function adbTap(x: number, y: number): void {
  adb(`shell input tap ${x} ${y}`);
}

export function adbSwipe(x1: number, y1: number, x2: number, y2: number): void {
  adb(`shell input swipe ${x1} ${y1} ${x2} ${y2} 150`);
}

export function adbBack(): void {
  adb('shell input keyevent 4');
}

export function closeMobileBrowser(): void {
  console.log(`Closing mobile browser (${MOBILE_BROWSER_PACKAGE})...`);
  adb(`shell am force-stop ${MOBILE_BROWSER_PACKAGE}`);
}

export function getChromeUrl(): string {
  adb('shell uiautomator dump /sdcard/window_dump.xml');
  const dump = adb('shell cat /sdcard/window_dump.xml');
  const m1 = dump.match(/https:\/\/[^\s"']*dazn\.com[^\s"']*/);
  if (m1) return m1[0];
  const tabs = adb('shell content query --uri content://com.android.chrome.FileProvider 2>/dev/null');
  const m2 = tabs.match(/https:\/\/[^\s'"]*dazn\.com[^\s'"]*/);
  if (m2) return m2[0];
  return '';
}

export class AndroidBasePage {
  constructor(protected driver: WdBrowser, protected ppvName = process.env.PPV_NAME || 'Joshua') {}

  async findEl(sel: string, timeoutMs = 10000): Promise<WdElement> {
    try {
      const el = await this.driver.$(sel);
      await el.waitForDisplayed({ timeout: timeoutMs });
      return el;
    } catch {
      return null;
    }
  }

  async tapByText(text: string, timeoutMs = 10000): Promise<boolean> {
    const el = await this.findEl(`android=new UiSelector().textContains("${text}")`, timeoutMs);
    if (!el) return false;
    await el.click();
    return true;
  }

  async tapFirstText(texts: string[], timeoutMs = 6000): Promise<string> {
    for (const text of texts) {
      if (await this.tapByText(text, timeoutMs)) {
        console.log(`Tapped "${text}"`);
        return text;
      }
    }
    return '';
  }

  async isVisible(text: string, timeoutMs = 3000): Promise<boolean> {
    try {
      const el = await this.driver.$(`android=new UiSelector().textContains("${text}")`);
      await el.waitForDisplayed({ timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * For Ultimate users logged in app: after tapping a PPV tile, a PIN Protection modal may appear.
   * Clicks the "WATCH NOW" button to proceed to the fixture page.
   */
  async handlePinProtectionIfPresent(timeoutMs = 6000): Promise<boolean> {
    console.log('🔒 Checking for PIN Protection screen / "WATCH NOW" button...');
    await this.driver.pause(2500);

    const watchNowSelectors = [
      'android=new UiSelector().text("WATCH NOW")',
      'android=new UiSelector().textContains("WATCH NOW")',
      'android=new UiSelector().text("Watch Now")',
      'android=new UiSelector().textContains("Watch Now")',
      'android=new UiSelector().textMatches("(?i)WATCH NOW")',
      '//*[contains(@text, "WATCH NOW") or contains(@text, "Watch Now") or contains(@text, "Watch now")]',
      '//*[@content-desc="WATCH NOW" or @content-desc="Watch Now"]',
      '//*[contains(translate(@text, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "watch now")]',
    ];

    let watchNowBtn: WdElement = null;

    for (const selector of watchNowSelectors) {
      try {
        const el = await this.driver.$(selector);
        if (await el.isDisplayed().catch(() => false)) {
          watchNowBtn = el;
          console.log(`  Found "WATCH NOW" button with selector: ${selector}`);
          break;
        }
      } catch {
        // continue trying other selectors
      }
    }

    if (!watchNowBtn) {
      try {
        const pinHeader = await this.driver.$('android=new UiSelector().textContains("PIN PROTECTION")');
        if (await pinHeader.isDisplayed().catch(() => false)) {
          console.log('  Found PIN PROTECTION header, searching for WATCH NOW button...');
          watchNowBtn = await this.findEl('android=new UiSelector().textContains("WATCH")', 3000);
        }
      } catch {
        // no pin header found
      }
    }

    if (watchNowBtn) {
      console.log('✨ [PIN Protection] Modal detected! Tapping "WATCH NOW" button...');
      try {
        await watchNowBtn.click();
      } catch {
        console.log('  Direct click on WATCH NOW failed, trying tapByText fallback...');
        await this.tapByText('WATCH NOW', 3000);
      }
      await this.driver.pause(4000);
      await this.driver.saveScreenshot('./test-results/android_pin_protection_watch_now_clicked.png').catch(() => {});
      console.log('  ✓ Tapped "WATCH NOW" button and navigated to fixture page.');
      return true;
    } else {
      console.log('  ℹ️ PIN Protection screen not displayed or already bypassed.');
      return false;
    }
  }

  async scrollToText(text: string): Promise<boolean> {
    try {
      const el = await this.driver.$(
        `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(` +
        `new UiSelector().textContains("${text}"))`,
      );
      return await el.isDisplayed();
    } catch {
      return false;
    }
  }

  async swipeLeft(): Promise<void> {
    const { width, height } = await this.driver.getWindowSize();
    await this.driver.action('pointer')
      .move({ x: Math.round(width * 0.8), y: Math.round(height * 0.35) })
      .down()
      .move({ x: Math.round(width * 0.2), y: Math.round(height * 0.35) })
      .up()
      .perform();
    await this.driver.pause(800);
  }

  async scrollDown(): Promise<void> {
    const { width, height } = await this.driver.getWindowSize();
    await this.driver.action('pointer')
      .move({ x: Math.round(width / 2), y: Math.round(height * 0.75) })
      .down()
      .move({ x: Math.round(width / 2), y: Math.round(height * 0.25) })
      .up()
      .perform();
    await this.driver.pause(600);
  }

  async findPPVBanner(ppvName = this.ppvName): Promise<boolean> {
    if (await this.isVisible(ppvName, 4000)) return true;
    for (let i = 0; i < 5; i++) {
      await this.swipeLeft();
      if (await this.isVisible(ppvName, 1500)) return true;
    }
    if (await this.scrollToText(ppvName)) return true;
    for (let i = 0; i < 8; i++) {
      await this.scrollDown();
      if (await this.isVisible(ppvName, 1500)) return true;
    }
    return false;
  }

  async findBannerOnCurrentPage(
    ppvName = this.ppvName,
    options: { horizontalSwipes?: number; verticalScrolls?: number } = {},
  ): Promise<boolean> {
    const horizontalSwipes = options.horizontalSwipes ?? 8;
    const verticalScrolls = options.verticalScrolls ?? 5;

    const isCurrentBannerPPV = async (timeoutMs: number): Promise<boolean> => {
      if (await this.isVisible(ppvName, timeoutMs)) return true;

      // Compose carousel text is sometimes available in the UI hierarchy a
      // fraction before UiSelector reports it as displayed. Checking it here
      // prevents a visible PPV card being skipped while the carousel moves.
      try {
        return (await this.driver.getPageSource()).toLowerCase().includes(ppvName.toLowerCase());
      } catch {
        return false;
      }
    };

    // Let the auto-advancing card render naturally first. This is faster and
    // more reliable than swiping away the PPV card while it is entering view.
    console.log(`  Waiting for "${ppvName}" to become the current banner...`);
    for (let attempt = 0; attempt < 16; attempt++) {
      if (await isCurrentBannerPPV(500)) return true;
      await this.driver.pause(250);
    }

    console.log(`  PPV banner not immediately visible. Swiping left to find "${ppvName}"...`);
    for (let i = 0; i < horizontalSwipes; i++) {
      await this.swipeLeft();
      if (await isCurrentBannerPPV(750)) return true;
    }

    console.log('  Swiping left exhausted. Trying vertical scroll down...');
    for (let i = 0; i < verticalScrolls; i++) {
      await this.scrollDown();
      if (await isCurrentBannerPPV(750)) return true;
    }

    return false;
  }

  async tapBuyCtaWithFallback(
    ctas = ['Buy now', 'Buy Now', 'Buy this fight', 'Buy', 'Get PPV'],
    options: { primaryTimeoutMs?: number; fallbackTimeoutMs?: number; scrollBeforeFallback?: boolean } = {},
  ): Promise<boolean> {
    const primaryTimeoutMs = options.primaryTimeoutMs ?? 6000;
    const fallbackTimeoutMs = options.fallbackTimeoutMs ?? 3000;

    const primary = await this.tapFirstText(ctas, primaryTimeoutMs);
    if (primary) return true;

    if (options.scrollBeforeFallback !== false) {
      await this.scrollDown();
      await this.driver.pause(1000);
    }

    const fallback = await this.tapFirstText(['Buy now', 'Buy Now', 'Buy', 'Get PPV'], fallbackTimeoutMs);
    return !!fallback;
  }

  async runSurfaceValidation(hooks: AndroidFlowHooks | undefined, surface: AndroidPPVSurface): Promise<void> {
    if (!hooks?.validateSurface) return;
    try {
      // Banner carousels advance automatically.  Hold the currently displayed
      // banner before collecting its copy so the PPV banner we found is the
      // banner that is validated (and later used for the Buy CTA).
      if (surface === 'PPV Banner') {
        const bannerInteraction = new BannerInteraction(this.driver);
        await bannerInteraction.withLock(async () => {
          await hooks.validateSurface!(surface);
        }, this.ppvName);
      } else {
        await hooks.validateSurface(surface);
      }
    } catch (err: any) {
      console.warn(`Mobile ${surface.toLowerCase()} validation failed: ${err.message}`);
    }
  }

  async runPaywallValidation(hooks: AndroidFlowHooks | undefined): Promise<void> {
    if (!hooks?.validatePaywall) return;
    try {
      await hooks.validatePaywall();
    } catch (err: any) {
      console.warn(`Mobile paywall validation failed: ${err.message}`);
    }
  }

  async readClipboardText(): Promise<string> {
    try {
      const base64Content = await this.driver.getClipboard();
      return Buffer.from(base64Content, 'base64').toString('utf8');
    } catch (e: any) {
      console.log(`Failed to get clipboard via Appium: ${e.message}. Trying ADB...`);
      return adb('shell am clipht get');
    }
  }

  isValidCheckoutUrl(url: string): boolean {
    return !!url && (url.includes('dazn.com') || url.includes('amazonaws.com'));
  }

  async captureCheckoutUrl(): Promise<string> {
    for (let attempt = 0; attempt < 15; attempt++) {
      await this.driver.pause(1000);
      try {
        const contexts = await this.driver.getContexts() as string[];
        const webCtx = contexts.find(
          (c) => c !== 'NATIVE_APP' && (c.includes('WEBVIEW') || c.includes('CHROMIUM') || c.includes('CDP')),
        );
        if (webCtx) {
          await this.driver.switchContext(webCtx);
          const url = await this.driver.getUrl();
          if (url && url.includes('dazn.com')) return url;
          await this.driver.switchContext('NATIVE_APP').catch(() => {});
        }
      } catch {}
      if (attempt % 3 === 2) {
        const adbUrl = getChromeUrl();
        if (adbUrl.includes('dazn.com')) return adbUrl;
      }
    }
    return getChromeUrl();
  }
}

export async function findEl(driver: WdBrowser, sel: string, timeoutMs = 10000): Promise<WdElement> {
  return new AndroidBasePage(driver).findEl(sel, timeoutMs);
}

export async function tapByText(driver: WdBrowser, text: string, timeoutMs = 10000): Promise<boolean> {
  return new AndroidBasePage(driver).tapByText(text, timeoutMs);
}

export async function isVisible(driver: WdBrowser, text: string, timeoutMs = 3000): Promise<boolean> {
  return new AndroidBasePage(driver).isVisible(text, timeoutMs);
}

export async function scrollToText(driver: WdBrowser, text: string): Promise<boolean> {
  return new AndroidBasePage(driver).scrollToText(text);
}

export async function swipeLeft(driver: WdBrowser): Promise<void> {
  return new AndroidBasePage(driver).swipeLeft();
}

export async function scrollDown(driver: WdBrowser): Promise<void> {
  return new AndroidBasePage(driver).scrollDown();
}

export async function findPPVBanner(driver: WdBrowser, ppvName: string): Promise<boolean> {
  return new AndroidBasePage(driver, ppvName).findPPVBanner(ppvName);
}

export async function captureCheckoutUrl(driver: WdBrowser): Promise<string> {
  return new AndroidBasePage(driver).captureCheckoutUrl();
}
