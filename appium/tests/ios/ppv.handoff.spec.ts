// ─────────────────────────────────────────────────────────────────────────────
// DAZN PPV — iOS Appium Test
//
// FLOW:
//   1. Open DAZN app (already installed on simulator, user logged-in)
//   2. Wait for Home screen
//   3. Find and tap the PPV event banner
//   4. On the in-app paywall, tap "Buy" / "Buy Now"
//   5. Apple consent sheet appears: "Open in Safari?" — tap "Open"
//   6. Safari opens with the checkout URL
//   7. Extract URL via WDA (WebDriverAgent)
//   8. Write URL to mobile_entry_url.txt for Playwright handoff
//
// HOW TO RUN:
//   cd appium
//   npm run ios
//
// ENV VARS:
//   PPV_NAME       : PPV event name (default: Joshua)
//   DAZN_BUNDLE_ID : App bundle ID  (default: com.dazn.enterprise)
//   IOS_UDID       : Simulator UDID (default: iPhone 16 Pro)
// ─────────────────────────────────────────────────────────────────────────────

// WebdriverIO injects `browser` as a global at runtime — declare so TS is happy.
// eslint-disable-next-line no-var
declare var browser: any;
type WdBrowser = any;

import { writeHandoffUrl, clearHandoffUrl } from '../../utils/handoff';

const PPV_NAME = process.env.PPV_NAME || 'Joshua';

// ── Helper: find element by accessibility label or text ──────────────────────
async function findByText(driver: WdBrowser, text: string, timeout = 10000) {
  return driver.$(`-ios predicate string:label CONTAINS[c] '${text}' OR name CONTAINS[c] '${text}'`)
    .waitForDisplayed({ timeout }).then(() =>
      driver.$(`-ios predicate string:label CONTAINS[c] '${text}' OR name CONTAINS[c] '${text}'`)
    );
}

async function isVisible(driver: WdBrowser, text: string): Promise<boolean> {
  try {
    const el = await driver.$(`-ios predicate string:label CONTAINS[c] '${text}' OR name CONTAINS[c] '${text}'`);
    return await el.isDisplayed({ timeout: 3000 } as any);
  } catch {
    return false;
  }
}

async function tapByText(driver: WdBrowser, text: string, timeout = 10000): Promise<boolean> {
  try {
    const el = await driver.$(`-ios predicate string:label CONTAINS[c] '${text}' OR name CONTAINS[c] '${text}'`);
    await el.waitForDisplayed({ timeout });
    await el.click();
    return true;
  } catch {
    return false;
  }
}

// ── Helper: swipe left on carousel ───────────────────────────────────────────
async function swipeLeft(driver: WdBrowser) {
  const { width, height } = await driver.getWindowSize();
  await driver.action('pointer')
    .move({ x: Math.round(width * 0.8), y: Math.round(height * 0.35) })
    .down()
    .move({ x: Math.round(width * 0.2), y: Math.round(height * 0.35) })
    .up()
    .perform();
  await driver.pause(800);
}

// ── Helper: scroll down ───────────────────────────────────────────────────────
async function scrollDown(driver: WdBrowser) {
  const { width, height } = await driver.getWindowSize();
  await driver.action('pointer')
    .move({ x: Math.round(width / 2), y: Math.round(height * 0.7) })
    .down()
    .move({ x: Math.round(width / 2), y: Math.round(height * 0.3) })
    .up()
    .perform();
  await driver.pause(600);
}

// ════════════════════════════════════════════════════════════════════════════
// TEST
// ════════════════════════════════════════════════════════════════════════════
describe('DAZN iOS PPV → Web Handoff', () => {
  before(async () => {
    clearHandoffUrl();
    console.log(`\n📱 iOS PPV Handoff Test — PPV: "${PPV_NAME}"`);
  });

  it('should tap PPV banner, reach paywall, redirect to Safari and capture checkout URL', async () => {
    const driver = browser;

    // ── Step 1: Wait for Home screen ─────────────────────────────────────────
    console.log('⏳ Waiting for DAZN Home screen...');
    await driver.pause(4000);

    // Dismiss any system alerts (notifications, tracking, etc.)
    for (const label of ["Allow", "Allow Once", "Don't Allow", "OK", "Continue", "Got it"]) {
      await tapByText(driver, label, 2000).catch(() => {});
    }

    console.log('✅ Home screen ready');

    // ── Step 2: Tap Home tab if needed ────────────────────────────────────────
    await tapByText(driver, 'Home', 3000).catch(() => {});
    await driver.pause(1000);

    // ── Step 3: Find PPV banner ───────────────────────────────────────────────
    console.log(`🔍 Looking for PPV banner: "${PPV_NAME}"`);

    let foundBanner = false;

    // First check if banner is directly visible
    if (await isVisible(driver, PPV_NAME)) {
      foundBanner = true;
    }

    if (!foundBanner) {
      // Swipe carousel left up to 5 times
      for (let i = 0; i < 5; i++) {
        await swipeLeft(driver);
        if (await isVisible(driver, PPV_NAME)) {
          foundBanner = true;
          break;
        }
      }
    }

    if (!foundBanner) {
      // Scroll down to check rails
      for (let i = 0; i < 8; i++) {
        await scrollDown(driver);
        if (await isVisible(driver, PPV_NAME)) {
          foundBanner = true;
          break;
        }
      }
    }

    if (!foundBanner) {
      await driver.saveScreenshot('./test-results/ios_home_debug.png');
      const src = await driver.getPageSource();
      require('fs').writeFileSync('./test-results/ios_page_source.xml', src);
      throw new Error(`❌ PPV banner for "${PPV_NAME}" not found on Home screen`);
    }

    console.log(`✅ Found PPV banner`);
    await driver.saveScreenshot('./test-results/ios_banner_found.png');

    // ── Step 4: Tap the banner ────────────────────────────────────────────────
    await tapByText(driver, PPV_NAME);
    await driver.pause(2000);
    console.log('✅ Tapped PPV banner');
    await driver.saveScreenshot('./test-results/ios_after_banner_tap.png');

    // ── Step 5: Tap Buy/Purchase CTA on paywall ───────────────────────────────
    console.log('🔍 Looking for Buy/Purchase CTA...');
    const buyCtas = ['Buy now', 'Buy Now', 'Buy', 'Get PPV', 'Purchase', 'Continue'];
    let buyTapped = false;

    for (const cta of buyCtas) {
      if (await tapByText(driver, cta, 5000)) {
        buyTapped = true;
        console.log(`✅ Tapped "${cta}"`);
        break;
      }
    }

    if (!buyTapped) {
      // Scroll down and retry
      for (let i = 0; i < 3; i++) {
        await scrollDown(driver);
        for (const cta of buyCtas) {
          if (await tapByText(driver, cta, 2000)) {
            buyTapped = true;
            console.log(`✅ Tapped "${cta}" after scroll`);
            break;
          }
        }
        if (buyTapped) break;
      }
    }

    if (!buyTapped) {
      await driver.saveScreenshot('./test-results/ios_paywall_debug.png');
      throw new Error('❌ Could not find Buy CTA on the in-app paywall');
    }

    await driver.pause(2000);
    await driver.saveScreenshot('./test-results/ios_after_buy_tap.png');

    // ── Step 6: Handle Apple "Open in Safari?" consent sheet ─────────────────
    // On iOS, when the app redirects to DAZN web, Apple shows a system alert:
    // "dazn.com wants to open 'Safari'" with options [Cancel] [Open]
    console.log('⏳ Waiting for Apple redirect consent sheet...');
    await driver.pause(3000);

    // Handle native iOS alert
    try {
      const alert = await driver.getAlertText();
      if (alert && (alert.includes('Safari') || alert.includes('dazn'))) {
        await driver.acceptAlert();
        console.log('✅ Accepted Safari redirect alert');
      }
    } catch {
      // No standard alert — look for sheet buttons
    }

    // Also look for "Open" button in the sheet
    for (const label of ['Open', 'Open in Safari', 'Continue in Safari', 'Open Safari']) {
      if (await tapByText(driver, label, 3000)) {
        console.log(`✅ Tapped "${label}" on redirect sheet`);
        break;
      }
    }

    await driver.pause(4000);
    await driver.saveScreenshot('./test-results/ios_after_safari_redirect.png');

    // ── Step 7: Capture URL from Safari ───────────────────────────────────────
    console.log('⏳ Waiting for Safari to load checkout URL...');
    let checkoutUrl = '';

    // Try switching to Safari web context
    for (let attempt = 0; attempt < 15; attempt++) {
      await driver.pause(1000);

      try {
        const contexts = await driver.getContexts() as string[];
        console.log(`Contexts (attempt ${attempt + 1}):`, contexts);

        // Look for a web context (Safari)
        const webCtx = contexts.find(c =>
          c.includes('WEBVIEW') ||
          (typeof c === 'string' && c !== 'NATIVE_APP')
        );

        if (webCtx) {
          await driver.switchContext(webCtx);
          const url = await driver.getUrl();
          console.log(`URL from web context: ${url}`);

          if (url.includes('dazn.com')) {
            checkoutUrl = url;
            break;
          }

          // Switch back to native to keep polling
          await driver.switchContext('NATIVE_APP').catch(() => {});
        }
      } catch (e) {
        // Keep polling
      }
    }

    // Fallback: look for address bar text in Safari native UI
    if (!checkoutUrl) {
      try {
        await driver.switchContext('NATIVE_APP').catch(() => {});
        const addressBar = await driver.$(`-ios predicate string:type == 'XCUIElementTypeTextField' AND value CONTAINS 'dazn'`);
        if (await addressBar.isDisplayed().catch(() => false)) {
          checkoutUrl = await addressBar.getValue() as string;
          console.log(`URL from address bar: ${checkoutUrl}`);
        }
      } catch { }
    }

    if (!checkoutUrl || !checkoutUrl.includes('dazn.com')) {
      await driver.saveScreenshot('./test-results/ios_safari_debug.png');
      throw new Error(`❌ Could not capture DAZN checkout URL from Safari. Got: "${checkoutUrl}"`);
    }

    console.log(`\n🌐 Captured checkout URL: ${checkoutUrl}`);

    // ── Step 8: Write URL for Playwright handoff ───────────────────────────────
    writeHandoffUrl(checkoutUrl);
    console.log('✅ Handoff complete — Playwright will pick up from here');
  });
});
