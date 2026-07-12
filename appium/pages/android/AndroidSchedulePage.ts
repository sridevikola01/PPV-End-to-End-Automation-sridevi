import { AndroidBasePage, AndroidFlowHooks, WdBrowser, WdElement, adbSwipe, adbTap, getScreenSize } from './AndroidBasePage';
import { navigateToPPVTile } from '../../utils/scheduleNavigator';

export class AndroidSchedulePage extends AndroidBasePage {
  async navigate(): Promise<void> {
    console.log('Navigating to Schedule tab...');
    await this.driver.saveScreenshot('./test-results/before_schedule_click.png');

    console.log('  Looking for Schedule button by text...');
    try {
      const scheduleText = await this.driver.$('android=new UiSelector().text("Schedule")');
      if (await scheduleText.isDisplayed()) {
        console.log('  Found Schedule button by text, clicking...');
        await scheduleText.click();
        await this.driver.pause(3000);
        console.log('Schedule tab clicked by text');
        await this.driver.saveScreenshot('./test-results/after_schedule_click.png');
        return;
      }
    } catch {
      console.log('  Schedule text not found as button');
    }

    console.log('  Taking screenshot to see home page layout...');
    await this.driver.saveScreenshot('./test-results/home_page_before_schedule.png');

    const screenSize = getScreenSize();
    const bottomNavY = Math.round(screenSize.height * 0.92);
    const scheduleX = Math.round(screenSize.width * 0.70);
    console.log(`  Tapping Schedule at coordinates (${scheduleX}, ${bottomNavY})`);
    adbTap(scheduleX, bottomNavY);
    await this.driver.pause(3000);
    await this.driver.saveScreenshot('./test-results/after_schedule_click.png');

    try {
      const scheduleHeader = await this.driver.$('android=new UiSelector().text("SCHEDULE")');
      const isSchedule = await scheduleHeader.isDisplayed();
      const homeTab = await this.driver.$('android=new UiSelector().text("Home")');
      const stillOnHome = await homeTab.isDisplayed();

      if (isSchedule && !stillOnHome) {
        console.log('Schedule tab clicked successfully');
        return;
      }
      if (stillOnHome) {
        console.log('  Still on Home page - tap did not navigate to Schedule');
      }
    } catch {}

    console.log('Could not navigate to Schedule tab');
  }

  async scrollToPPVTile(ppvName = this.ppvName): Promise<WdElement | null> {
    console.log(`  Target PPV: ${ppvName}`);
    console.log('  Step 1: Fast scroll to July...');

    for (let i = 0; i < 20; i++) {
      if (await this.isVisible('July', 300) || await this.isVisible('JUL', 300)) {
        console.log(`  Found July (step ${i + 1})`);
        break;
      }
      const screen = getScreenSize();
      adbSwipe(
        Math.round(screen.width / 2),
        Math.round(screen.height * 0.75),
        Math.round(screen.width / 2),
        Math.round(screen.height * 0.20),
      );
      await this.driver.pause(500);
    }

    await this.driver.pause(1000);
    console.log('  Step 2: Searching July for PPV...');

    for (let i = 0; i < 20; i++) {
      try {
        const ppvEl = await this.driver.$(`//android.widget.TextView[contains(@text, "${ppvName}")]`);
        if (await ppvEl.isDisplayed()) {
          console.log(`Found "${ppvName}" (step ${i + 1})`);
          const rect = await ppvEl.getRect();
          const screenH = getScreenSize().height;
          const bottomNavThreshold = screenH * 0.75;

          if (rect.y > bottomNavThreshold) {
            console.log(`  Tile at y=${rect.y}, scrolling to center...`);
            const screen = getScreenSize();
            adbSwipe(
              Math.round(screen.width / 2),
              Math.round(screenH * 0.75),
              Math.round(screen.width / 2),
              Math.round(screenH * 0.55),
            );
            await this.driver.pause(500);

            adbSwipe(
              Math.round(screen.width / 2),
              Math.round(screenH * 0.7),
              Math.round(screen.width / 2),
              Math.round(screenH * 0.3),
            );
            await this.driver.pause(1500);

            const centeredEl = await this.driver.$(`//android.widget.TextView[contains(@text, "${ppvName}")]`);
            if (await centeredEl.isDisplayed()) {
              const newRect = await centeredEl.getRect();
              console.log(`  Tile centered at y=${newRect.y}`);
              return centeredEl;
            }
          }

          return ppvEl;
        }
      } catch {}

      if (await this.isVisible('August', 200) || await this.isVisible('AUG', 200)) {
        console.log('  Reached August - stopping');
        break;
      }

      const screen = getScreenSize();
      adbSwipe(
        Math.round(screen.width / 2),
        Math.round(screen.height * 0.55),
        Math.round(screen.width / 2),
        Math.round(screen.height * 0.45),
      );
      await this.driver.pause(800);
    }

    return null;
  }

  async clickBoxingFilterIfPresent(): Promise<void> {
    console.log('Finding Boxing filter...');
    let boxingEl = null;

    try {
      boxingEl = await this.driver.$('//android.widget.TextView[@text="Boxing"]');
      console.log('  Found Boxing filter with XPath');
    } catch {
      try {
        boxingEl = await this.driver.$('android=new UiSelector().text("Boxing")');
        console.log('  Found Boxing filter with UiSelector');
      } catch {
        console.log('  Could not find Boxing filter element');
      }
    }

    if (!boxingEl) {
      console.log('  Boxing filter not found - continuing without filter');
      return;
    }

    try {
      if (await boxingEl.isDisplayed()) {
        await boxingEl.click();
        console.log('Boxing filter clicked successfully');
      }
    } catch (e: any) {
      console.log(`  Failed to click Boxing filter: ${e.message}`);
    }
  }

  async openPPVPaywall(eventConfig?: any, hooks: AndroidFlowHooks = {}): Promise<boolean> {
    console.log('Navigating to Schedule page...');
    await this.navigate();
    await this.driver.pause(3000);

    let onSchedule = false;
    let onBoxing = false;

    try {
      const scheduleHeader = await this.driver.$('android=new UiSelector().text("SCHEDULE")');
      onSchedule = await scheduleHeader.isDisplayed();
    } catch {}

    try {
      const boxingHeader = await this.driver.$('android=new UiSelector().text("Boxing")');
      onBoxing = await boxingHeader.isDisplayed();
    } catch {}

    if (onBoxing && !onSchedule) {
      await this.driver.saveScreenshot('./test-results/wrong_page_clicked.png');
      throw new Error('Clicked Boxing tab instead of Schedule.');
    }

    if (!onSchedule) {
      await this.driver.saveScreenshot('./test-results/schedule_navigation_failed.png');
      throw new Error('Neither Schedule nor Boxing detected.');
    }

    console.log('On Schedule page');
    await this.driver.pause(2000);
    await this.clickBoxingFilterIfPresent();
    await this.driver.pause(3000);

    console.log(`Navigating to ${this.ppvName} using schedule navigator...`);
    try {

      if (eventConfig) {
        await navigateToPPVTile(this.driver, eventConfig, hooks);
      } else {
        const ppvTile = await this.scrollToPPVTile(this.ppvName);
        if (ppvTile) {
          await this.runSurfaceValidation(hooks, 'PPV Tile');
          await ppvTile.click();
          console.log(`Clicked ${this.ppvName} tile`);
        }
      }
      hooks.recordAvailability?.(true, undefined, 'Schedule');
    } catch (e: any) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_schedule_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, 'Schedule');
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found on Schedule`);
      throw e;
    }

    await this.driver.pause(2000);

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';

    if (isUltimateUser && isLoginFirst) {
      console.log('✨ [Ultimate Active User with LOGIN_FIRST=true] Tile clicked, navigated to fixture page. Ending flow.');
      return true;
    }

    console.log('  On paywall screen - will capture URL via Copy button');
    await this.runPaywallValidation(hooks);
    return true;
  }
}

export async function navigateToSchedule(driver: WdBrowser): Promise<void> {
  return new AndroidSchedulePage(driver).navigate();
}

export async function scrollScheduleToPPVTile(driver: WdBrowser, ppvName: string): Promise<WdElement | null> {
  return new AndroidSchedulePage(driver, ppvName).scrollToPPVTile(ppvName);
}

export async function openSchedulePPVPaywall(
  driver: WdBrowser,
  ppvName: string,
  eventConfig?: any,
  hooks: AndroidFlowHooks = {},
): Promise<boolean> {
  return new AndroidSchedulePage(driver, ppvName).openPPVPaywall(eventConfig, hooks);
}
