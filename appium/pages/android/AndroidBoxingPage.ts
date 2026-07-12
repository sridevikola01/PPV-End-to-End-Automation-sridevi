import { AndroidBasePage, AndroidFlowHooks, WdBrowser, adbSwipe, adbTap, getScreenSize } from './AndroidBasePage';

export interface AndroidPPVDateParts {
  month: string;
  monthShort: string;
  day: string;
}

export function getPPVDateParts(eventConfig?: any): AndroidPPVDateParts {
  try {
    const utcDate = eventConfig?.global?.PPV_UTC_DATE || eventConfig?.PPV_UTC_DATE || '';
    if (utcDate) {
      const d = new Date(utcDate);
      return {
        month: d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }),
        monthShort: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase(),
        day: String(d.getUTCDate()),
      };
    }
  } catch (e: any) {
    console.log(`  Could not read PPV date from config: ${e.message}`);
  }

  return { month: 'July', monthShort: 'JUL', day: '' };
}

export class AndroidBoxingPage extends AndroidBasePage {
  async navigateViaSports(): Promise<void> {
    console.log('Navigating to Boxing page via Sports tab...');
    const sportsTapped = await this.tapByText('Sports', 5000) || await this.tapByText('Sport', 4000);
    if (sportsTapped) {
      await this.driver.pause(1500);
      if (await this.scrollToText('Boxing') || await this.tapByText('Boxing', 6000)) {
        await this.driver.pause(2000);
        console.log('On Boxing page');
        return;
      }
    }
    if (await this.tapByText('Boxing', 5000)) {
      await this.driver.pause(2000);
      return;
    }
    console.log('Could not confirm Boxing page - continuing from current screen');
  }

  async clickHomeBoxingFilter(): Promise<void> {
    console.log('  Clicking Boxing filter chip on home page...');

    const selectors = [
      'android=new UiSelector().text("Boxing")',
      'android=new UiSelector().textContains("Boxing")',
      '//android.widget.TextView[@text="Boxing"]',
    ];

    const tryClick = async (): Promise<boolean> => {
      for (const selector of selectors) {
        try {
          const el = await this.driver.$(selector);
          if (await el.isDisplayed()) {
            await el.click();
            console.log('  Boxing filter clicked');
            return true;
          }
        } catch {}
      }
      return false;
    };

    if (await tryClick()) {
      await this.driver.pause(2500);
      return;
    }

    console.log('  Boxing filter not immediately visible - swiping filter rail...');
    const screen = getScreenSize();
    for (let i = 0; i < 5; i++) {
      adbSwipe(
        Math.round(screen.width * 0.75),
        Math.round(screen.height * 0.22),
        Math.round(screen.width * 0.25),
        Math.round(screen.height * 0.22),
      );
      await this.driver.pause(700);
      if (await tryClick()) {
        console.log(`  Boxing filter clicked after ${i + 1} swipe(s)`);
        await this.driver.pause(2500);
        return;
      }
    }

    await this.driver.saveScreenshot('./test-results/android_boxing_filter_not_found.png');
    throw new Error('Boxing filter chip not found on home page. See test-results/android_boxing_filter_not_found.png');
  }

  async clickUpcomingFightsFilter(): Promise<void> {
    console.log('  Clicking "Upcoming Fights" filter on boxing page...');
    let clicked = false;
    const selectors = [
      'android=new UiSelector().text("Upcoming Fights")',
      'android=new UiSelector().textContains("Upcoming Fights")',
      'android=new UiSelector().textContains("Upcoming")',
      '//android.widget.TextView[contains(@text,"Upcoming")]',
    ];

    const tryClick = async (): Promise<boolean> => {
      for (const selector of selectors) {
        try {
          const el = await this.driver.$(selector);
          if (await el.isDisplayed()) {
            await el.click();
            console.log('  "Upcoming Fights" filter clicked');
            return true;
          }
        } catch {}
      }
      return false;
    };

    clicked = await tryClick();
    if (!clicked) {
      const screen = getScreenSize();
      for (let i = 0; i < 4; i++) {
        adbSwipe(
          Math.round(screen.width * 0.75),
          Math.round(screen.height * 0.22),
          Math.round(screen.width * 0.25),
          Math.round(screen.height * 0.22),
        );
        await this.driver.pause(700);
        clicked = await tryClick();
        if (clicked) break;
      }
    }

    if (!clicked) {
      console.log('  "Upcoming Fights" filter not found - continuing without it...');
      await this.driver.saveScreenshot('./test-results/android_upcoming_filter_not_found.png');
    }
  }

  async scrollToUpcomingPPV(dateParts: AndroidPPVDateParts): Promise<boolean> {
    console.log(`  Scrolling to PPV - fast to "${dateParts.month}", slow to day "${dateParts.day}"...`);
    const screen = getScreenSize();
    const cx = Math.round(screen.width / 2);

    const monthOnScreen = async (): Promise<boolean> => {
      for (const label of [dateParts.month, dateParts.monthShort]) {
        if (label && await this.isVisible(label, 300)) return true;
      }
      return false;
    };

    const dateOnScreen = async (): Promise<boolean> => {
      if (!dateParts.day) return false;
      for (const label of [dateParts.day, `${dateParts.monthShort} ${dateParts.day}`, `${dateParts.month} ${dateParts.day}`]) {
        if (await this.isVisible(label, 300)) return true;
      }
      return this.isVisible(this.ppvName, 300);
    };

    let monthFound = await monthOnScreen();
    for (let i = 0; i < 25 && !monthFound; i++) {
      adbSwipe(cx, Math.round(screen.height * 0.78), cx, Math.round(screen.height * 0.18));
      await this.driver.pause(400);
      monthFound = await monthOnScreen();
    }

    if (!monthFound) {
      await this.driver.saveScreenshot('./test-results/android_month_not_found.png');
      console.log(`  Could not find "${dateParts.month}" - proceeding with slow scroll`);
    }

    let ppvDateFound = await dateOnScreen();
    for (let i = 0; i < 20 && !ppvDateFound; i++) {
      adbSwipe(cx, Math.round(screen.height * 0.60), cx, Math.round(screen.height * 0.40));
      await this.driver.pause(700);
      ppvDateFound = await dateOnScreen();
    }

    if (!ppvDateFound) {
      await this.driver.saveScreenshot('./test-results/android_ppv_date_not_found.png');
      console.log(`  PPV date "${dateParts.day}" not found - trying Buy now from current position`);
    }

    let ppvFound = await this.isVisible(this.ppvName, 3000);
    for (let i = 0; i < 5 && !ppvFound; i++) {
      adbSwipe(cx, Math.round(screen.height * 0.60), cx, Math.round(screen.height * 0.40));
      await this.driver.pause(600);
      ppvFound = await this.isVisible(this.ppvName, 1000);
    }

    if (ppvFound) {
      await this.driver.saveScreenshot('./test-results/android_ppv_tile_area.png');
    } else {
      await this.driver.saveScreenshot('./test-results/android_ppv_not_found.png');
      console.log(`  "${this.ppvName}" not found - trying Buy now from current position`);
    }

    return ppvFound;
  }

  async tapBuyNowNearPPV(): Promise<boolean> {
    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';

    if (isUltimateUser && isLoginFirst) {
      console.log(`✨ [Ultimate Active User with LOGIN_FIRST=true] Clicking the PPV tile itself for "${this.ppvName}"...`);
      const ppvEls = await this.driver.$$(`//*[contains(@text, "${this.ppvName}")]`);
      for (const el of ppvEls) {
        if (await el.isDisplayed().catch(() => false)) {
          await el.click();
          console.log(`  Tapped PPV tile text: "${this.ppvName}"`);
          return true;
        }
      }
      return false;
    }

    const screen = getScreenSize();
    const cx = Math.round(screen.width / 2);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log(`  Looking for Buy Now button belonging to "${this.ppvName}" (attempt ${attempt + 1})...`);
        const ppvEls = await this.driver.$$(`//*[contains(@text, "${this.ppvName}")]`);
        let ppvLoc = null;
        for (const el of ppvEls) {
          if (await el.isDisplayed().catch(() => false)) {
            ppvLoc = await el.getLocation();
            break;
          }
        }

        if (ppvLoc) {
          const buyBtns = await this.driver.$$('//android.widget.TextView[@text="Buy now" or @text="Buy Now" or @text="Buy" or @text="Get PPV"]');
          let targetBtn = null;
          let minDiff = Infinity;

          for (const btn of buyBtns) {
            if (await btn.isDisplayed().catch(() => false)) {
              const btnLoc = await btn.getLocation();
              const diffY = btnLoc.y - ppvLoc.y;
              if (diffY >= -150 && diffY < minDiff && diffY < 1200) {
                minDiff = diffY;
                targetBtn = btn;
              }
            }
          }

          if (targetBtn) {
            await targetBtn.click();
            console.log('  Tapped "Buy now" specific to the PPV card');
            return true;
          }
        }
      } catch (e: any) {
        console.log(`  PPV-specific Buy now check error: ${e.message}`);
      }

      adbSwipe(cx, Math.round(screen.height * 0.65), cx, Math.round(screen.height * 0.45));
      await this.driver.pause(1500);
    }

    console.log('  Falling back to generic Buy CTA search...');
    return this.tapBuyCtaWithFallback(['Buy now', 'Buy Now', 'Buy', 'Get PPV']);
  }

  async openBoxingUpcomingFightsPaywall(hooks: AndroidFlowHooks = {}): Promise<boolean> {
    // Ensure we're on Home page before navigating to Sports (post-login behavior)
    const homeTab = await this.driver.$('android=new UiSelector().text("Home")');
    if (!(await homeTab.isDisplayed().catch(() => false))) {
      const homeClicked = await this.tapByText('Home', 3000);
      if (!homeClicked) {
        const screen = getScreenSize();
        adbTap(Math.round(screen.width * 0.15), Math.round(screen.height * 0.92));
      }
      await this.driver.pause(3000);
    }
    
    await this.navigateViaSports();
    console.log(`Searching for "${this.ppvName}" in Upcoming Big Fights...`);

    let found = await this.findPPVBanner(this.ppvName);
    for (let i = 0; i < 12 && !found; i++) {
      await this.scrollDown();
      found = await this.isVisible(this.ppvName, 1200);
    }

    if (!found) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_boxing_debug.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, 'Home of Boxing');
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found on Boxing page`);
      throw new Error(`"${this.ppvName}" not found on Boxing page. Check test-results/android_boxing_debug.png`);
    }

    hooks.recordAvailability?.(true, undefined, 'Home of Boxing');
    await this.driver.saveScreenshot('./test-results/android_ppv_found.png');
    await this.runSurfaceValidation(hooks, 'PPV Tile');
    await this.tapByText(this.ppvName);
    await this.driver.pause(2500);
    await this.driver.saveScreenshot('./test-results/android_ppv_detail.png');

    let buyTapped = await this.tapBuyCtaWithFallback(['Buy now', 'Buy Now', 'Buy', 'Get PPV', 'Purchase']);
    for (let i = 0; i < 4 && !buyTapped; i++) {
      await this.scrollDown();
      buyTapped = await this.tapBuyCtaWithFallback(['Buy now', 'Buy Now', 'Buy', 'Get PPV'], {
        primaryTimeoutMs: 2000,
        scrollBeforeFallback: false,
      });
    }
    return buyTapped;
  }

  async openBoxingPageBannerPaywall(hooks: AndroidFlowHooks = {}, options: { requireBanner?: boolean } = {}): Promise<boolean> {
    // Ensure we're on Home page before navigating to Sports (post-login behavior)
    const homeTab = await this.driver.$('android=new UiSelector().text("Home")');
    if (!(await homeTab.isDisplayed().catch(() => false))) {
      const homeClicked = await this.tapByText('Home', 3000);
      if (!homeClicked) {
        const screen = getScreenSize();
        adbTap(Math.round(screen.width * 0.15), Math.round(screen.height * 0.92));
      }
      await this.driver.pause(3000);
    }
    
    await this.navigateViaSports();
    await this.driver.pause(1500);

    const found = await this.findPPVBanner(this.ppvName);
    if (!found && options.requireBanner) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_boxing_page_ppv_banner_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, 'Home of Boxing');
      await hooks.generateAvailabilityFailureReport?.(`PPV banner "${this.ppvName}" not found on Boxing page`);
      throw new Error(`PPV banner "${this.ppvName}" not found on Boxing page. See test-results/android_boxing_page_ppv_banner_not_found.png`);
    }

    if (found) {
      hooks.recordAvailability?.(true, undefined, 'Home of Boxing');
      await this.runSurfaceValidation(hooks, 'PPV Banner');
    }

    return this.tapBuyCtaWithFallback(['Buy this fight', 'Buy now', 'Buy Now', 'Buy'], {
      primaryTimeoutMs: 7000,
      scrollBeforeFallback: false,
    });
  }

  async openHomeBoxingBannerPaywall(hooks: AndroidFlowHooks = {}): Promise<boolean> {
    console.log('Home -> Boxing filter -> Boxing page -> PPV banner -> Buy now');
    await this.clickHomeBoxingFilter();
    await this.driver.saveScreenshot('./test-results/android_boxing_page.png');

    let found = await this.findPPVBanner(this.ppvName);
    for (let i = 0; i < 8 && !found; i++) {
      await this.scrollDown();
      found = await this.isVisible(this.ppvName, 1500);
    }

    if (!found) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_ppv_banner_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, 'Home of Boxing');
      await hooks.generateAvailabilityFailureReport?.(`PPV banner "${this.ppvName}" not found on Boxing page`);
      throw new Error(`PPV banner "${this.ppvName}" not found on boxing page. See test-results/android_ppv_banner_not_found.png`);
    }

    hooks.recordAvailability?.(true, undefined, 'Home of Boxing');
    await this.driver.saveScreenshot('./test-results/android_ppv_banner_found.png');
    await this.runSurfaceValidation(hooks, 'PPV Banner');

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';

    if (isUltimateUser && isLoginFirst) {
      console.log('✨ [Ultimate Active User with LOGIN_FIRST=true] PPV banner verified (boxing). Skipping Buy click and returning true.');
      return true;
    }

    return this.tapBuyCtaWithFallback();
  }

  async openHomeBoxingUpcomingPaywall(eventConfig?: any, hooks: AndroidFlowHooks = {}): Promise<boolean> {
    console.log('Home -> Boxing filter -> Upcoming Fights -> smart scroll -> Buy now');
    
    // Ensure we're on Home page before clicking Boxing filter (post-login behavior)
    const homeTab = await this.driver.$('android=new UiSelector().text("Home")');
    if (!(await homeTab.isDisplayed().catch(() => false))) {
      const homeClicked = await this.tapByText('Home', 3000);
      if (!homeClicked) {
        const screen = getScreenSize();
        adbTap(Math.round(screen.width * 0.15), Math.round(screen.height * 0.92));
      }
      await this.driver.pause(3000);
    }
    
    const dateParts = getPPVDateParts(eventConfig);
    console.log(`  PPV date from config/fallback: ${dateParts.month} ${dateParts.day} (${dateParts.monthShort})`);

    await this.clickHomeBoxingFilter();
    await this.driver.saveScreenshot('./test-results/android_boxing_page.png');
    await this.clickUpcomingFightsFilter();
    await this.driver.pause(2000);
    await this.driver.saveScreenshot('./test-results/android_upcoming_fights.png');

    const found = await this.scrollToUpcomingPPV(dateParts);
    if (found) {
      hooks.recordAvailability?.(true, undefined, 'Home of Boxing');
    }

    await this.runSurfaceValidation(hooks, 'PPV Tile');
    const buyTapped = await this.tapBuyNowNearPPV();
    if (!buyTapped) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_home_boxing_upcoming_buy_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, 'Home of Boxing');
      await hooks.generateAvailabilityFailureReport?.(`Buy CTA for PPV "${this.ppvName}" not found in Home Boxing Upcoming`);
    }
    return buyTapped;
  }
}

export async function navigateToBoxingPage(driver: WdBrowser): Promise<void> {
  return new AndroidBoxingPage(driver).navigateViaSports();
}

export async function clickHomeBoxingFilter(driver: WdBrowser): Promise<void> {
  return new AndroidBoxingPage(driver).clickHomeBoxingFilter();
}

export async function openBoxingUpcomingFightsPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: AndroidFlowHooks = {},
): Promise<boolean> {
  return new AndroidBoxingPage(driver, ppvName).openBoxingUpcomingFightsPaywall(hooks);
}

export async function openBoxingPageBannerPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: AndroidFlowHooks = {},
  options: { requireBanner?: boolean } = {},
): Promise<boolean> {
  return new AndroidBoxingPage(driver, ppvName).openBoxingPageBannerPaywall(hooks, options);
}

export async function openHomeBoxingBannerPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: AndroidFlowHooks = {},
): Promise<boolean> {
  return new AndroidBoxingPage(driver, ppvName).openHomeBoxingBannerPaywall(hooks);
}

export async function openHomeBoxingUpcomingPaywall(
  driver: WdBrowser,
  ppvName: string,
  eventConfig?: any,
  hooks: AndroidFlowHooks = {},
): Promise<boolean> {
  return new AndroidBoxingPage(driver, ppvName).openHomeBoxingUpcomingPaywall(eventConfig, hooks);
}
