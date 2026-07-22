import {
  AndroidFlowHooks,
  WdBrowser,
  adbSwipe,
  adbTap,
  getScreenSize,
} from './AndroidBasePage';
import { AndroidLandingPage } from './AndroidLandingPage';
import https from 'https';

export class AndroidHomePage extends AndroidLandingPage {
  async ensureOnHome(): Promise<void> {
    const homeTab = await this.driver.$('android=new UiSelector().text("Home")');
    if (await homeTab.isDisplayed().catch(() => false)) {
      console.log('  Already on Home page');
      return;
    }

    const homeClicked = await this.tapByText('Home', 3000);
    if (!homeClicked) {
      const screen = getScreenSize();
      adbTap(Math.round(screen.width * 0.15), Math.round(screen.height * 0.92));
    }
    await this.driver.pause(3000);
  }

  async openHomeBannerPaywall(hooks: AndroidFlowHooks = {}, options: { immediatePaywall?: boolean } = {}): Promise<boolean> {
    await this.ensureOnHome();
    await this.driver.pause(2000);

    return this.openBannerPaywall({
      label: 'Home Page',
      pageName: 'Home page',
      missingScreenshot: './test-results/android_home_ppv_banner_not_found.png',
      foundScreenshot: './test-results/android_home_ppv_banner_found.png',
      buyMissingScreenshot: './test-results/android_home_buy_cta_not_found.png',
      validateSurface: 'PPV Banner',
      immediatePaywall: options.immediatePaywall ?? true,
      recordPage: 'Home Page',
    }, hooks);
  }

  async openGenericPPVPaywall(hooks: AndroidFlowHooks = {}): Promise<boolean> {
    console.log(`Unknown source fallback - finding "${this.ppvName}" from current screen`);
    const found = await this.findPPVBanner(this.ppvName);
    if (!found) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot);
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found`);
      throw new Error(`"${this.ppvName}" not found`);
    }

    hooks.recordAvailability?.(true);
    await this.runSurfaceValidation(hooks, 'PPV Banner');
    await this.tapByText(this.ppvName);
    await this.driver.pause(2000);

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';

    if (isUltimateUser && isLoginFirst) {
      console.log('✨ [Ultimate Active User with LOGIN_FIRST=true] Tile clicked (generic). Skipping Buy click and returning true.');
      return true;
    }

    return this.tapBuyCtaWithFallback(['Buy now', 'Buy Now', 'Buy'], { scrollBeforeFallback: false });
  }

  async openHomePageDontMissPaywall(hooks: AndroidFlowHooks = {}): Promise<boolean> {
    console.log('Home Page -> Find "Don\'t Miss" rail -> Scroll to middle -> Horizontally swipe to PPV tile -> Validate tile -> Click PPV tile');
    await this.ensureOnHome();

    console.log('  Waiting for scrollable content container to load...');
    const scrollableEl = await this.driver.$('android=new UiSelector().scrollable(true)');
    await scrollableEl.waitForDisplayed({ timeout: 15000 }).catch(() => {
      console.warn('  ⚠️ Scrollable container did not appear within 15s. Proceeding...');
    });
    await this.driver.pause(3000);

    // 1. Locate "Don't Miss" rail header
    console.log('  Locating "Don\'t Miss" rail header...');
    let found = false;
    let dontMissEl: any = null;

    for (let i = 0; i < 15; i++) {
      const candidates = [
        'android=new UiSelector().text("Don\'t Miss")',
        'android=new UiSelector().textContains("Don\'t Miss")',
        '//android.widget.TextView[contains(@text, "Don\'t Miss")]',
      ];

      for (const sel of candidates) {
        try {
          const el = await this.driver.$(sel);
          if (await el.isDisplayed().catch(() => false)) {
            dontMissEl = el;
            found = true;
            console.log(`  ✅ Found "Don't Miss" rail header on screen!`);
            break;
          }
        } catch {}
      }

      if (found) break;

      console.log(`  "Don't Miss" rail header not visible (attempt ${i + 1}/15). Scrolling down...`);
      await this.scrollDown();
      await this.driver.pause(1500);
    }

    if (!found) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_dont_miss_rail_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot);
      await hooks.generateAvailabilityFailureReport?.(' "Don\'t Miss" rail header not found');
      throw new Error('❌ "Don\'t Miss" rail header not found');
    }

    // Function to get fresh coordinates of the rail header
    const getRailHeaderRect = async () => {
      const el = await this.driver.$('android=new UiSelector().text("Don\'t Miss")');
      const loc = await el.getLocation();
      const size = await el.getSize();
      return { x: loc.x, y: loc.y, width: size.width, height: size.height };
    };

    // Position it approximately in the middle of the screen
    const { width, height } = await this.driver.getWindowSize();
    let rect = await getRailHeaderRect();
    console.log(`  "Don't Miss" rail header found at y=${rect.y}, height=${rect.height}. Centering...`);

    const targetY = Math.round(height * 0.45);
    const diffY = rect.y - targetY;
    if (Math.abs(diffY) > 80) {
      const startY = Math.round(height * 0.6);
      const endY = startY - diffY;
      const safeEndY = Math.max(Math.round(height * 0.15), Math.min(Math.round(height * 0.85), endY));
      await this.driver.action('pointer')
        .move({ x: Math.round(width / 2), y: startY })
        .down()
        .move({ x: Math.round(width / 2), y: safeEndY })
        .up()
        .perform();
      await this.driver.pause(1500);
      // Refresh rect coordinates
      rect = await getRailHeaderRect();
      console.log(`  Adjusted Y position of "Don't Miss" rail header: y=${rect.y}`);
    }

    // 2. Perform horizontal swipe through the rail one tile at a time
    // Swipe Y coordinate: below the rail header, e.g. rect.y + rect.height + height * 0.12
    const swipeY = rect.y + rect.height + Math.round(height * 0.12);
    console.log(`  Horizontal swipe will use Y coordinate: ${swipeY}`);

    let tileX: number | null = null;
    let tileY: number | null = null;

    // Check if the expected PPV tile is visible. We inspect text/content-desc, Gemini visual detection, and Lock+Bell heuristics
    const isPPVTileVisible = async (): Promise<boolean> => {
      try {
        const pageSource = await this.driver.getPageSource();
        const lowerSource = pageSource.toLowerCase();

        // 1. Text / Content-Desc Keyword Match on Screen inside Rail
        const keywords = [
          this.ppvName.toLowerCase(),
          ...this.ppvName.toLowerCase().split(/\s+vs\.?\s+/g),
        ].filter(k => k.length > 2);

        const hasTextInSource = keywords.some(k => lowerSource.includes(k));

        if (hasTextInSource) {
          const elements: any[] = [];
          const matches = pageSource.matchAll(/<([a-zA-Z0-9.]+)\b([^>]*)bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g);
          for (const match of matches) {
            const tag = match[1];
            const attrs = match[2];
            const left = parseInt(match[3], 10);
            const top = parseInt(match[4], 10);
            const right = parseInt(match[5], 10);
            const bottom = parseInt(match[6], 10);
            const clickable = attrs.includes('clickable="true"');
            const textMatch = keywords.some(k => attrs.toLowerCase().includes(k));
            elements.push({ tag, attrs, left, top, right, bottom, clickable, textMatch });
          }

          const railTop = rect.y;
          const railBottom = rect.y + Math.round(height * 0.35);

          for (const el of elements) {
            if (el.clickable && el.top >= railTop - 50 && el.bottom <= railBottom + 100 && el.right > width * 0.25) {
              if (el.textMatch) {
                tileX = Math.round((el.left + el.right) / 2);
                tileY = Math.round((el.top + el.bottom) / 2);
                console.log(`🎯 [Text Match] Found PPV tile with title matching "${this.ppvName}" at x=${tileX}, y=${tileY}`);
                return true;
              }
            }
          }
        }

        // 2. Gemini Visual OCR Detection
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey && apiKey !== 'your_gemini_api_key_here') {
          const detection = await locatePPVTileWithGemini(this.driver, this.ppvName);
          if (detection.visible && detection.x && detection.y) {
            tileX = detection.x;
            tileY = detection.y;
            console.log(`🎯 [Gemini AI] Detected PPV tile visual match for "${this.ppvName}" at x=${tileX}, y=${tileY}`);
            return true;
          }
        }

        // 3. Fallback Bounding Box & Lock/Bell Heuristic
        const elements: any[] = [];
        const matches = pageSource.matchAll(/<([a-zA-Z0-9.]+)\b([^>]*)bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g);
        for (const match of matches) {
          const tag = match[1];
          const attrs = match[2];
          const left = parseInt(match[3], 10);
          const top = parseInt(match[4], 10);
          const right = parseInt(match[5], 10);
          const bottom = parseInt(match[6], 10);
          const clickable = attrs.includes('clickable="true"');
          elements.push({ tag, left, top, right, bottom, clickable });
        }

        const railTop = rect.y;
        const railBottom = rect.y + Math.round(height * 0.35);

        for (const el of elements) {
          if (el.clickable && el.top >= railTop - 50 && el.bottom <= railBottom + 100 && el.right > width * 0.25) {
            let hasLock = false;
            let hasBell = false;

            for (const child of elements) {
              if (child === el) continue;
              if (child.left >= el.left && child.right <= el.right && child.top >= el.top && child.bottom <= el.bottom) {
                const cWidth = child.right - child.left;
                const cHeight = child.bottom - child.top;

                if (child.left > el.left && (child.left - el.left) < 120 && cWidth >= 20 && cWidth <= 90 && cHeight >= 20 && cHeight <= 90) {
                  hasLock = true;
                }
                if (child.right < el.right && (el.right - child.right) < 120 && cWidth >= 60 && cWidth <= 200 && cHeight >= 60 && cHeight <= 200) {
                  hasBell = true;
                }
              }
            }

            if (hasLock && hasBell) {
              tileX = Math.round((el.left + el.right) / 2);
              tileY = Math.round((el.top + el.bottom) / 2);
              console.log(`🎯 [Heuristic] Found PPV tile with Lock & Bell nested elements at x=${tileX}, y=${tileY}`);
              return true;
            }
          }
        }

        return false;
      } catch (err: any) {
        console.warn('⚠️ Error checking PPV tile visibility:', err.message);
        return false;
      }
    };

    let tileFound = await isPPVTileVisible();
    const maxHorizontalSwipes = 10;

    for (let swipeIdx = 0; swipeIdx < maxHorizontalSwipes && !tileFound; swipeIdx++) {
      console.log(`  PPV tile not visible. Swiping left in rail (swipe ${swipeIdx + 1}/${maxHorizontalSwipes})...`);
      // Swipe from right to left in the rail area
      const startX = Math.round(width * 0.85);
      const endX = Math.round(width * 0.15);
      await this.driver.action('pointer')
        .move({ x: startX, y: swipeY })
        .down()
        .move({ x: endX, y: swipeY })
        .up()
        .perform();
      await this.driver.pause(1500);
      tileFound = await isPPVTileVisible();
    }

    if (!tileFound) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_dont_miss_ppv_tile_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot);
      await hooks.generateAvailabilityFailureReport?.(`PPV tile "${this.ppvName}" not found in "Don't Miss" rail`);
      throw new Error(`❌ PPV tile "${this.ppvName}" not found in "Don't Miss" rail`);
    }

    console.log('✅ PPV tile found in "Don\'t Miss" rail.');
    await this.driver.saveScreenshot('./test-results/android_dont_miss_ppv_tile_found.png');

    // 3. Run validation on the PPV Tile using the existing sheet-driven framework
    hooks.recordAvailability?.(true);
    await this.runSurfaceValidation(hooks, 'PPV Tile');

    // 4. Click the PPV Tile
    console.log(`  Clicking the PPV tile for "${this.ppvName}"...`);
    if (tileX && tileY) {
      adbTap(tileX, tileY);
    } else {
      const xpath = `//*[contains(@text, "${this.ppvName}") or contains(@content-desc, "${this.ppvName}")]`;
      const ppvTileEl = await this.driver.$(xpath);
      await ppvTileEl.click();
    }
    await this.driver.pause(3000);

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';

    if (isUltimateUser && isLoginFirst) {
      console.log('✨ [Ultimate Active User with LOGIN_FIRST=true] Tile clicked. Skipping Buy click and returning true.');
      return true;
    }

    const buyTapped = await this.tapBuyCtaWithFallback(['Buy now', 'Buy Now', 'Buy', 'Get PPV', 'Purchase']);
    if (!buyTapped) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_dont_miss_buy_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot);
      await hooks.generateAvailabilityFailureReport?.(`Buy CTA for PPV "${this.ppvName}" not found after clicking tile`);
    }
    return buyTapped;
  }
}


export async function openHomeBannerPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: AndroidFlowHooks = {},
  options: { immediatePaywall?: boolean } = {},
): Promise<boolean> {
  return new AndroidHomePage(driver, ppvName).openHomeBannerPaywall(hooks, options);
}

export async function openGenericPPVPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: AndroidFlowHooks = {},
): Promise<boolean> {
  return new AndroidHomePage(driver, ppvName).openGenericPPVPaywall(hooks);
}

export async function openHomePageDontMissPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: AndroidFlowHooks = {},
): Promise<boolean> {
  return new AndroidHomePage(driver, ppvName).openHomePageDontMissPaywall(hooks);
}



async function locatePPVTileWithGemini(driver: WdBrowser, ppvName: string): Promise<{ visible: boolean; x: number | null; y: number | null }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.warn('⚠️ [Gemini] GEMINI_API_KEY not configured. Cannot perform visual tile detection.');
    return { visible: false, x: null, y: null };
  }

  try {
    const screenshotBase64 = await driver.takeScreenshot();

    const prompt = `
      Analyze the attached screenshot of the mobile app home screen.
      Locate the "Don't Miss" rail. Under "Don't Miss" header, there is a horizontal list of tiles.
      Identify if the PPV tile for "${ppvName}" (e.g. featuring fighter "Joshua" or "Prenga" on it, typically with text "JOSHUA" or "PRENGA" or "July 25") is currently visible on the screen.
      
      If it is visible, provide the center coordinates (x, y) in pixels.
      Note: The screenshot is 1080x2340 pixels (width x height) or similar. Make sure to return coordinates in the same scale as the screenshot.
      
      Return ONLY valid JSON matching this schema:
      {
        "visible": boolean,
        "x": number | null,
        "y": number | null
      }
    `;

    const schema = {
      type: 'object',
      properties: {
        visible: { type: 'boolean' },
        x: { type: 'number', nullable: true },
        y: { type: 'number', nullable: true }
      },
      required: ['visible', 'x', 'y']
    };

    const payload = Buffer.from(JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: 'image/png', data: screenshotBase64 } },
          { text: prompt }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0
      }
    }));

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = https.request(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': String(payload.length)
          }
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => resolve({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8')
          }));
        }
      );
      req.setTimeout(30000, () => req.destroy(new Error('Gemini request timed out')));
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Gemini returned HTTP ${response.statusCode}: ${response.body}`);
    }

    const resObj = JSON.parse(response.body);
    const textResult = resObj.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text;
    if (!textResult) throw new Error('No text in Gemini response');

    const result = JSON.parse(textResult);
    console.log(`🤖 [Gemini] Tile detection result for "${ppvName}":`, result);
    return result;
  } catch (err: any) {
    console.error(`⚠️ [Gemini] Failed to detect tile: ${err.message}`);
    return { visible: false, x: null, y: null };
  }
}
