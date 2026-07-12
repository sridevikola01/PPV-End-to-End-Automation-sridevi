import {
  AndroidBasePage,
  AndroidCopyResult,
  WdBrowser,
  adbTap,
  getScreenSize,
  adb,
  adbSwipe,
} from './AndroidBasePage';

export interface AndroidCopyOptions {
  screenshotPrefix?: string;
  retrySwipeBackToPPV?: boolean;
  ppvName?: string;
  isLandingPageBanner?: boolean;
}

export class AndroidPaywallPage extends AndroidBasePage {
  async copyImmediateCheckoutUrl(label: string, options: AndroidCopyOptions = {}): Promise<AndroidCopyResult> {
    const screenshotPrefix = options.screenshotPrefix || label.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const isLandingPageBanner = options.isLandingPageBanner ?? (label === 'landing-page-banner');
    const surfaceLabel = isLandingPageBanner ? 'Landing banner' : 'Paywall overlay';

    console.log(`  🚀 ${surfaceLabel} - FAST copying URL (${label})...`);
    await this.driver.saveScreenshot(`./test-results/android_${screenshotPrefix}_${isLandingPageBanner ? 'banner' : 'paywall'}.png`);

    if (isLandingPageBanner && options.ppvName) {
      const copied = await this.clickCopyOnLandingBanner(label, options.ppvName);
      if (!copied) {
        console.log('  ⚠️ Landing banner Copy button was not clicked. Clipboard validation will decide next step.');
      }
    } else {
      await this.clickCopyButton(label);
    }
    await this.driver.pause(500);
    await this.driver.saveScreenshot(`./test-results/android_${screenshotPrefix}_after_copy.png`);

    let url = await this.readClipboardText();
    if (this.isValidCheckoutUrl(url)) {
      console.log(`  ✅ URL captured (${label}): ${url.substring(0, 100)}...`);
      if (isLandingPageBanner) {
        this.closeLandingBannerApp();
      }
      return { captured: true, url };
    }

    console.log('  Clipboard did not contain a valid DAZN URL. Will retry in shared block...');

    if (options.retrySwipeBackToPPV && options.ppvName) {
      const retryUrl = await this.retryCopyAfterSwipingBack(options.ppvName, label);
      if (this.isValidCheckoutUrl(retryUrl)) {
        if (isLandingPageBanner) {
          this.closeLandingBannerApp();
        }
        return { captured: true, url: retryUrl };
      }
      url = retryUrl || url;
    }

    return { captured: false, url };
  }

  private async isCopyButtonVisible(): Promise<boolean> {
    const selectors = [
      '//android.widget.Button[@text="Copy"]',
      '//android.widget.TextView[@text="Copy"]',
      '//*[@content-desc="Copy"]',
      '//android.view.View[.//android.widget.TextView[@text="Copy"] or .//android.widget.Button[@text="Copy"]]',
    ];

    for (const selector of selectors) {
      try {
        const copyBtn = await this.driver.$(selector);
        if (await copyBtn.isDisplayed({ timeout: 500 })) {
          return true;
        }
      } catch {}
    }

    return false;
  }

  private async clickCopyButton(label: string): Promise<boolean> {
    const startTime = Date.now();
    const selectors = [
      { label: 'parent', selector: '//android.view.View[.//android.widget.TextView[@text="Copy"] or .//android.widget.Button[@text="Copy"]]' },
      { label: 'button', selector: '//android.widget.Button[@text="Copy"]' },
      { label: 'text', selector: '//android.widget.TextView[@text="Copy"]' },
      { label: 'content-desc', selector: '//*[@content-desc="Copy"]' },
      { label: 'XPath', selector: '//android.view.View[@resource-id="ItemContent"]/android.view.View/android.widget.Button' },
    ];

    for (const candidate of selectors) {
      try {
        const copyBtn = await this.driver.$(candidate.selector);
        if (!await copyBtn.isDisplayed({ timeout: 800 })) continue;
        await copyBtn.click();
        console.log(`  ⚡ Copy clicked via ${candidate.label} (${Date.now() - startTime}ms)`);
        return true;
      } catch {}
    }

    console.log(`  ⚠️ Copy button not found by any selector (${Date.now() - startTime}ms)`);
    return false;
  }

  private async clickCopyOnLandingBanner(label: string, ppvName: string): Promise<boolean> {
    console.log('  🔍 Landing banner copy controls should be on the banner, not a paywall.');

    console.log('  Checking whether the PPV banner is active before tapping Copy...');
    const ppvVisible = await this.ensureLandingPPVBannerVisible(ppvName);
    if (!ppvVisible) {
      console.log(`  ⚠️ Could not bring PPV banner "${ppvName}" into view before copying.`);
      return false;
    }

    if (await this.isCopyButtonVisible()) {
      console.log('  ✅ Copy button is visible on the PPV banner');
      return this.clickCopyButton(label);
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      if (await this.isCopyButtonVisible()) {
        console.log(`  ✅ Copy button appeared on PPV banner after ${attempt + 1} check(s)`);
        return this.clickCopyButton(label);
      }
      await this.driver.pause(500);
    }

    return this.clickCopyButton(label);
  }

  private async ensureLandingPPVBannerVisible(ppvName: string): Promise<boolean> {
    if (await this.isVisible(ppvName, 1500)) {
      console.log(`  ✅ PPV banner "${ppvName}" is visible`);
      return true;
    }

    console.log(`  ⚡ PPV banner not visible. Swiping carousel to find "${ppvName}"...`);
    const { width, height } = await this.driver.getWindowSize();
    const y = Math.round(height * 0.45);
    const swipeSets = [
      { name: 'right', fromX: Math.round(width * 0.2), toX: Math.round(width * 0.8) },
      { name: 'left', fromX: Math.round(width * 0.8), toX: Math.round(width * 0.2) },
    ];

    for (const swipeSet of swipeSets) {
      for (let attempt = 0; attempt < 5; attempt++) {
        await this.driver.action('pointer')
          .move({ x: swipeSet.fromX, y })
          .down()
          .move({ x: swipeSet.toX, y })
          .up()
          .perform();
        await this.driver.pause(600);

        if (await this.isVisible(ppvName, 1000)) {
          console.log(`  ✅ PPV banner found after ${attempt + 1} ${swipeSet.name} swipe(s)`);
          return true;
        }
      }
    }

    return false;
  }

  private closeLandingBannerApp(): void {
    const appPackage = process.env.APP_PACKAGE || 'com.dazn';
    console.log(`  📱 Closing DAZN app (${appPackage}) before mobile web handoff...`);
    adb(`shell am force-stop ${appPackage}`);
  }

  private async retryCopyAfterSwipingBack(ppvName: string, label: string): Promise<string> {
    const startTime = Date.now();
    console.log('  ⚡ Carousel recovery - swiping back to PPV...');
    const { width, height } = await this.driver.getWindowSize();
    const screen = getScreenSize();
    const copyX = Math.round(screen.width * 0.19);
    const copyY = Math.round(screen.height * 0.89);

    for (let swipeBack = 0; swipeBack < 5; swipeBack++) {
      const ppvVisible = await this.isVisible(ppvName, 800); // Reduced from 1000
      if (!ppvVisible) {
        await this.driver.action('pointer')
          .move({ x: Math.round(width * 0.2), y: Math.round(height * 0.35) })
          .down()
          .move({ x: Math.round(width * 0.8), y: Math.round(height * 0.35) })
          .up()
          .perform();
        await this.driver.pause(600); // Reduced from 800
        continue;
      }

      console.log(`  ✅ Found PPV after ${swipeBack} swipe(s) (${Date.now() - startTime}ms)`);

      // Fast retry loop
      for (let retry = 0; retry < 8; retry++) { // Reduced from 10
        await this.driver.pause(300); // Reduced from 500

        try {
          const copyBtn = await this.driver.$('//android.view.View[@resource-id="ItemContent"]/android.view.View/android.widget.Button');
          if (await copyBtn.isDisplayed({ timeout: 400 })) { // Reduced from 500
            await copyBtn.click();
            console.log(`  ⚡ Copy clicked on retry ${retry + 1} (${Date.now() - startTime}ms)`);
            await this.driver.pause(400); // Reduced from 1000
            const retryUrl = await this.readClipboardText();
            if (this.isValidCheckoutUrl(retryUrl)) {
              console.log(`  ✅ URL recovered in ${Date.now() - startTime}ms`);
              return retryUrl;
            }
            break;
          }
        } catch {}

        // No coordinate tap - only element-based clicks
      }

      // Swipe back right
      await this.driver.action('pointer')
        .move({ x: Math.round(width * 0.2), y: Math.round(height * 0.35) })
        .down()
        .move({ x: Math.round(width * 0.8), y: Math.round(height * 0.35) })
        .up()
        .perform();
      await this.driver.pause(600);
    }

    console.log(`  ⚠️ Copy recovery failed after ${Date.now() - startTime}ms`);
    return '';
  }

  async captureHandoffUrl(options: { label: string; ppvName?: string }): Promise<string> {
    console.log("\n── Capturing Handoff URL from Paywall Screen ──────────────────");
    
    // First, scroll up slightly to ensure Copy button is fully visible
    console.log("  Scrolling up to ensure Copy button is visible...");
    const screenSize = getScreenSize();
    
    adbSwipe(Math.round(screenSize.width / 2), 
             Math.round(screenSize.height * 0.85), 
             Math.round(screenSize.width / 2), 
             Math.round(screenSize.height * 0.75));
    await this.driver.pause(1000);
    
    // Try clicking the parent element of the Copy button
    try {
      const parentCopyBtn = await this.driver.$('//android.view.View[./android.widget.TextView[@text="Copy"]]');
      console.log("  Found parent of Copy button, waiting for display...");
      await parentCopyBtn.waitForDisplayed({ timeout: 5000 });
      console.log("  Parent displayed, attempting click...");
      await parentCopyBtn.click();
      console.log("  ✅ Clicked parent of Copy button");
      await this.driver.pause(2000);
      await this.driver.saveScreenshot("./test-results/android_after_copy_click.png");
    } catch (e: any) {
      console.log(`  ❌ Failed to click parent: ${e.message}`);
      console.log("  Trying coordinate tap as fallback...");
      
      const copyBtnX = Math.round(screenSize.width * 0.19);
      const copyBtnY = Math.round(screenSize.height * 0.89);
      
      console.log(`  Tapping Copy button at coordinates (${copyBtnX}, ${copyBtnY})`);
      adbTap(copyBtnX, copyBtnY);
      await this.driver.pause(2000);
      await this.driver.saveScreenshot("./test-results/android_after_copy_tap.png");
    }
    
    let checkoutUrl = '';
    try {
      const base64Content = await this.driver.getClipboard();
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
      await this.driver.saveScreenshot("./test-results/android_url_not_found.png");
      throw new Error(`❌ Could not capture checkout URL from paywall.\n   Clipboard content: ${checkoutUrl}`);
    }

    return checkoutUrl;
  }
}

export async function copyImmediateCheckoutUrl(
  driver: WdBrowser,
  label: string,
  options: AndroidCopyOptions = {},
): Promise<AndroidCopyResult> {
  return new AndroidPaywallPage(driver).copyImmediateCheckoutUrl(label, options);
}

export async function captureHandoffUrl(
  driver: WdBrowser,
  options: { label: string; ppvName?: string },
): Promise<string> {
  return new AndroidPaywallPage(driver).captureHandoffUrl(options);
}
