import { Page, Locator, expect } from '@playwright/test';
import { handleCookies, dismissMarketingPopup } from '../utils/helpers';


export class SchedulePage {
  constructor(private page: Page) { }

  // ── DISMISS POPUPS ─────────────────────────────────────────────
  async dismissSchedulePopups() {
    console.log('🔍 Checking for schedule page popups...');

    // Call the general marketing popup dismisser
    await dismissMarketingPopup(this.page);

    // Selectors for close button or "Maybe later" or similar dismiss CTAs
    const closeButtonSelectors = [
      'button[class*="close" i]',
      'div[class*="close" i]',
      '[aria-label*="close" i]',
      '[class*="CloseButton" i]',
      '[class*="ModalClose" i]',
      'button:has-text("Maybe later")',
      'a:has-text("Maybe later")',
      'button:has-text("Maybe Later")',
      'a:has-text("Maybe Later")'
    ];

    for (const selector of closeButtonSelectors) {
      const btn = this.page.locator(selector).first();
      if (await btn.isVisible().catch(() => false)) {
        console.log(`🔔 Popup close button found with selector: "${selector}". Clicking to dismiss...`);
        await btn.click({ force: true }).catch(() => { });
        await this.page.waitForTimeout(500);
        return;
      }
    }

    // Fallback: Click on elements that look like 'x' or 'X' inside dialog/modal wrapper
    const xButton = this.page.locator('[class*="Modal" i] button, [class*="dialog" i] button, [class*="popup" i] button')
      .filter({ hasText: /^(x|close)$/i }).first();
    if (await xButton.isVisible().catch(() => false)) {
      console.log('🔔 Popup close button found via child button filter. Clicking...');
      await xButton.click({ force: true }).catch(() => { });
      await this.page.waitForTimeout(500);
      return;
    }

    console.log('ℹ️ No schedule page popups found or dismissed.');
  }

  // ── NAVIGATE ──────────────────────────────────────────────────
  async navigate(baseUrl: string) {
    const url = `${baseUrl}/schedule`;
    console.log(`📅 Navigating to: ${url}`);
    await this.page.goto(url);
    await expect(this.page).toHaveURL(/schedule/);
    await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
    // Wait for networkidle so OneTrust's async cookie script has time to load
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
    // Use shorter timeout for cookie banner — if it takes too long, the page
    // or context may have been closed by the test runner (e.g. timeout abortion).
    await handleCookies(this.page, 5000);

    // Check if page/context is still open before proceeding (the test runner
    // may have closed it due to a timeout or external navigation).
    if (this.page.isClosed()) {
      console.warn('⚠️ Page was closed during schedule navigation — stopping navigate()');
      return;
    }

    await this.page.waitForSelector('body', { timeout: 8000 }).catch(() => {
      if (this.page.isClosed()) {
        console.warn('⚠️ Page was closed while waiting for body — stopping navigate()');
        return;
      }
      console.warn('⚠️ Body selector timed out but page is still open — continuing...');
    });

    // Check again after the potentially-failing body wait
    if (this.page.isClosed()) {
      console.warn('⚠️ Page was closed after body wait — stopping navigate()');
      return;
    }

    console.log('✅ Schedule page loaded');
    await this.page.waitForTimeout(1000); // Wait a brief moment for any popup to animate in
    await this.dismissSchedulePopups();
  }

  async selectSport(sport: string) {
    if (!sport) {
      throw new Error('❌ selectSport() called with undefined — check config has SPORT field');
    }
    console.log(`🥊 Selecting ${sport}...`);
    await handleCookies(this.page);

    const filterContainer = this.page.locator('#schedule-filter-container');
    const isFilterContainerVisible = await filterContainer.waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false);

    let useHorizontalFilter = false;
    if (isFilterContainerVisible) {
      const sportEl = filterContainer.getByText(sport, { exact: true });
      const sportVisible = await sportEl.isVisible().catch(() => false);
      if (sportVisible) {
        useHorizontalFilter = true;
      }
    }

    if (useHorizontalFilter) {
      const sportEl = filterContainer.getByText(sport, { exact: true });
      await sportEl.click();
    } else {
      console.log('ℹ️ Horizontal filter container not visible. Looking for "All Sports" dropdown...');
      const allSportsBtn = this.page.locator('button:has-text("All Sports"), [class*="sportsFilter" i] button, [class*="filter" i] button').first();
      await expect(allSportsBtn).toBeVisible({ timeout: 8000 });
      await allSportsBtn.click();
      console.log(' Clicked "All Sports" dropdown');

      // Now click the sport from the dropdown/menu
      const sportItem = this.page.locator(`role=option[name="${sport}" i], [role="menuitem"][name="${sport}" i], button:has-text("${sport}"), a:has-text("${sport}"), li:has-text("${sport}")`).first();
      await expect(sportItem).toBeVisible({ timeout: 8000 });
      await sportItem.click();
      console.log(`✅ Selected ${sport} from dropdown`);
    }

    await this.page.waitForFunction(
      () => document.querySelectorAll('article').length > 0,
      null,
      { timeout: 8000 }
    ).catch(() => { });
    await this.page.waitForTimeout(1000);

    // Reset scroll to top after sport filter applied
    await this.page.evaluate(() => window.scrollTo(0, 0));
    console.log(`✅ ${sport} selected`);
  }

  // ── FIND EVENT ────────────────────────────────────────────────
  async findEvent(eventName: string): Promise<Locator> {
    console.log(`🔍 Searching for event: ${eventName}`);
    await handleCookies(this.page);

    const regex = new RegExp(
      eventName.replace(/\s+/g, '.*'),
      'i'
    );

    // Non-PPV event keywords to skip
    const skipKeywords = [
      'press conference', 'weigh-in', 'weigh in',
      'preview', 'undercard', 'open workout',
    ];

    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.waitForTimeout(300);

    for (let i = 0; i < 25; i++) {
      const articles = this.page
        .locator('article')
        .filter({ hasText: regex });

      const count = await articles.count().catch(() => 0);

      for (let j = 0; j < count; j++) {
        const article = articles.nth(j);
        if (await article.isVisible().catch(() => false)) {
          const text = await article.innerText().catch(() => '');
          const lower = text.toLowerCase();

          // Skip non-PPV events (press conferences, weigh-ins, etc.)
          const isNonPPV = skipKeywords.some(kw => lower.includes(kw));
          if (isNonPPV) {
            const label = text.split('\n').find(l => l.trim()) || text.slice(0, 40);
            console.log(`⏭️  Skipping non-PPV: "${label.trim()}"`);
            continue;
          }

          console.log('✅ Event found');
          return article;
        }
      }

      await this.page.evaluate(() => {
        window.scrollBy({ top: window.innerHeight, behavior: 'instant' });
      });
      await this.page.waitForTimeout(300);
    }

    throw new Error(`❌ Event "${eventName}" not found on schedule page`);
  }

  // ── CLICK EVENT (open modal) ──────────────────────────────────
  async clickEvent(event: Locator) {
    console.log('🖱️ Clicking event...');
    await handleCookies(this.page);

    // Save scroll position BEFORE any scrolling
    const scrollY = await this.page.evaluate(() => window.scrollY);

    // Click using Playwright's built-in click
    try {
      await event.click({ timeout: 5000 });
    } catch (err: any) {
      console.warn(`⚠️ Standard click failed: ${err.message}. Falling back to manual scroll and mouse click...`);
      await event.scrollIntoViewIfNeeded();
      await this.page.waitForTimeout(500);
      const box = await event.boundingBox();
      if (!box) throw new Error('❌ Event not clickable — no bounding box');
      await this.page.mouse.click(
        box.x + box.width / 2,
        box.y + box.height / 2
      );
    }

    // Immediately restore scroll and lock background BEFORE waiting for Buy Now
    await this.page.evaluate((y) => {
      window.scrollTo(0, y);
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }, scrollY);

    // Wait for Buy Now button using manual poll (not expect, which can trigger scrollIntoView)
    const buyNowButton = this.page.locator(
      'a:has-text("Buy now"), ' +
      'button:has-text("Buy now"), ' +
      'a:has-text("Buy Now"), ' +
      'button:has-text("Buy Now")'
    ).first();

    let buyVisible = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      buyVisible = await buyNowButton.isVisible({ timeout: 500 }).catch(() => false);
      if (buyVisible) break;
      // Re-restore scroll position in case the modal opening caused a scroll change
      await this.page.evaluate((y) => {
        window.scrollTo(0, y);
      }, scrollY);
    }

    if (!buyVisible) {
      throw new Error('❌ Buy Now button not visible in modal after 15s');
    }

    // Final scroll restoration
    await this.page.evaluate((y) => {
      window.scrollTo(0, y);
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }, scrollY);

    console.log('🔒 Background scroll locked');
    console.log('✅ Modal opened & Buy button located');
  }

  // ── CLICK BUY NOW ─────────────────────────────────────────────
  async clickBuyNow(): Promise<void> {
    console.log('💳 Clicking Buy Now CTA...');
    await handleCookies(this.page);
    const buyNow = this.page.locator(
      'a:has-text("Buy now"), ' +
      'button:has-text("Buy now"), ' +
      'a:has-text("Buy Now"), ' +
      'button:has-text("Buy Now")'
    ).first();

    await expect(buyNow).toBeVisible({ timeout: 8000 });
    await buyNow.click({ force: true });
    console.log('✅ Buy Now clicked');
  }
}
