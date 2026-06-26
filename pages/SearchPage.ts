import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class SearchPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ── NAVIGATE ──────────────────────────────────────────────────
  async navigate(baseUrl: string) {
    const url = `${baseUrl}/search`;
    console.log(`🔍 Navigating to: ${url}`);
    await this.page.goto(url);
    await this.page.waitForLoadState('domcontentloaded');
    await this.waitForConsentAndDismiss();
    await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });

    console.log('✅ Search page loaded');
  }

  // ── SEARCH FOR EVENT ──────────────────────────────────────────
  async searchForEvent(eventName: string) {
    console.log(`🔍 Searching for: ${eventName}`);

    // Wait for search input
    const searchInput = this.page.locator(
      'input[type="search"], ' +
      'input[placeholder*="search" i], ' +
      'input[placeholder*="Search" i], ' +
      '[class*="search" i] input, ' +
      '[data-testid*="search" i] input'
    ).first();

    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.click();
    await searchInput.fill(eventName);
    await searchInput.press('Enter');

    // Wait for results to load — wait for spinner to disappear
    await this.page.waitForFunction(() => {
      const spinner = document.querySelector('[class*="spinner" i], [class*="loading" i], [class*="loader" i]');
      return !spinner || getComputedStyle(spinner).display === 'none';
    }, { timeout: 10000 }).catch(() => { });

    // Also wait for at least one result to appear
    await this.page.waitForFunction(
      (name: string) => {
        const els = Array.from(document.querySelectorAll('article, li, [class*="tile" i], [class*="card" i], [class*="result" i]'));
        return els.some(el => (el as HTMLElement).innerText?.toLowerCase().includes(name.toLowerCase().split(' ')[0]));
      },
      eventName,
      { timeout: 15000 }
    ).catch(() => console.log('⚠️  Results may not have loaded fully'));

    await this.page.waitForTimeout(1000);
    console.log(`✅ Search completed for: ${eventName}`);
  }

  // ── FIND AND CLICK PPV TILE ───────────────────────────────────
  async clickPPVTile(eventName: string): Promise<void> {
    console.log(`🎯 Looking for PPV tile: ${eventName}`);

    let matchPattern = eventName;
    if (eventName.includes(':')) {
      matchPattern = eventName.split(':').pop()?.trim() || eventName;
    }

    const regexesToTry = [new RegExp(matchPattern.replace(/\s+/g, '.*'), 'i')];
    const isStaging = (process.env.DAZN_ENV || 'prod').toLowerCase() === 'stag';
    if (isStaging) {
      const firstWord = matchPattern.split(/\s+/)[0]?.trim();
      if (firstWord && firstWord.length > 2 && firstWord.toLowerCase() !== 'the') {
        regexesToTry.push(new RegExp(firstWord, 'i'));
      }
    }

    // Try multiple selectors for search result tiles
    const selectors = [
      'article',
      '[class*="EventTile" i]',
      '[class*="event-tile" i]',
      '[class*="SearchResult" i]',
      '[class*="search-result" i]',
      '[class*="tile" i]',
      '[class*="card" i]',
      'li[class*="result" i]',
      'li',
    ];

    for (const regex of regexesToTry) {
      console.log(`🔍 Trying regex pattern: ${regex}`);
      for (const selector of selectors) {
        const tiles = this.page.locator(selector).filter({ hasText: regex });
        const count = await tiles.count().catch(() => 0);

        if (count > 0) {
          console.log(`🔍 Found ${count} tiles with selector: ${selector} for regex ${regex}`);

          for (let i = 0; i < count; i++) {
            const tile = tiles.nth(i);
            const text = await tile.textContent().catch(() => '');
            if (!text || text.length > 800) continue;

            // Exclude ancillary content like press conferences, weigh-ins, etc.
            const textLower = text.toLowerCase();
            const isAncillary = [
              'press conference',
              'weigh-in',
              'workout',
              'replay',
              'highlights',
              'preview',
              'promo',
              'interview',
              'behind the scenes',
              'episode',
              'documentary',
              'face off',
              'kickboxing'
            ].some(term => textLower.includes(term));
            if (isAncillary) continue;

            // Extra safety check: if the main title/heading has a colon or press/weigh terms, skip it
            const heading = await tile.locator('h1, h2, h3, h4, h5, [class*="title" i], [class*="heading" i]').first().textContent().catch(() => '');
            if (heading) {
              const headingLower = heading.toLowerCase();
              if (headingLower.includes(':') || headingLower.includes('press') || headingLower.includes('weigh')) {
                // Keep it if it is a test event, e.g. "Glory 108: Petch v Miguel Trindade (TEST)"
                if (!headingLower.includes('(test)')) {
                  continue;
                }
              }
            }

            console.log(`  Tile ${i}: "${text.substring(0, 80).trim()}"`);

            // Check for date badge (PPV tile indicator)
            const hasDate = await tile.locator('[class*="badge" i], [class*="date" i], time').isVisible({ timeout: 500 }).catch(() => false);
            const hasLock = await tile.locator('[class*="lock" i], [class*="ppv" i]').isVisible({ timeout: 500 }).catch(() => false);
            const hasMay = text.includes('MAY') || text.includes('May') || text.includes('9 MAY') || text.includes('20:30') || text.toLowerCase().includes('test');

            if (hasDate || hasLock || hasMay) {
              console.log(`✅ PPV tile found: "${text.substring(0, 80).trim()}"`);

              const scrollY = await this.page.evaluate(() => window.scrollY);
              await tile.scrollIntoViewIfNeeded().catch(() => { });
              await this.page.waitForTimeout(300);

              const box = await tile.boundingBox();
              if (!box) continue;

              await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

              const buyNowButton = this.page.locator(
                'a:has-text("Buy now"), button:has-text("Buy now"), ' +
                'a:has-text("Buy Now"), button:has-text("Buy Now"), ' +
                'a:has-text("Continue"), button:has-text("Continue")'
              ).first();

              await expect(buyNowButton).toBeVisible({ timeout: 15000 });

              await this.page.evaluate((y) => {
                window.scrollTo(0, y);
                document.body.style.overflow = 'hidden';
                document.documentElement.style.overflow = 'hidden';
              }, scrollY);

              console.log('🔒 Background scroll locked');
              console.log('✅ PPV popup opened & Buy button located');
              return;
            }
          }
        }
      }
    }

    // Debug — dump what's on the page
    const allText = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('article, li, [class*="result" i]'))
        .map(el => (el as HTMLElement).innerText?.substring(0, 100))
        .filter(t => t && t.length > 5)
        .slice(0, 10)
        .join('\n');
    }).catch(() => 'N/A');
    console.log('📋 Page content sample:\n', allText);

    throw new Error(`❌ PPV tile not found for: ${eventName}`);
  }

  // ── CLICK BUY NOW ─────────────────────────────────────────────
  async clickBuyNow(): Promise<void> {
    console.log('💳 Clicking Buy Now CTA...');
    const buyNow = this.page.locator(
      'a:has-text("Buy now"), button:has-text("Buy now"), ' +
      'a:has-text("Buy Now"), button:has-text("Buy Now"), ' +
      'a:has-text("Subscribe"), button:has-text("Subscribe"), ' +
      'a:has-text("Continue"), button:has-text("Continue")'
    ).first();

    await expect(buyNow).toBeVisible({ timeout: 8000 });
    await buyNow.click({ force: true });
    console.log('✅ Buy Now clicked');
  }

  // ═══════════════════════════════════════════════════════════════
  // DEV MODE: Enable dev mode to bypass phone number page
  // Flow: Landing → Explore → Home → Search → dev_mode_on → Copy ID → Back 2x → Back to Landing
  // ═══════════════════════════════════════════════════════════════
  async enableDevMode(): Promise<void> {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  🎭 ENABLING DEV MODE to bypass phone number page');
    console.log('═══════════════════════════════════════════════════\n');

    const originalUrl = this.page.url();
    console.log(`Original URL before dev mode: ${originalUrl}`);

    try {
      // ── Step 0: Check if dev mode is already active ────────────
      const yellowDot = this.page.locator('div[class*="dev-mode__circle"], [class*="dev-mode"]').first();
      const alreadyActive = await yellowDot.isVisible({ timeout: 1500 }).catch(() => false);
      if (alreadyActive) {
        console.log('✅ Dev mode is already active (yellow dot visible). Skipping activation flow.');
        return;
      }

      // ── Step 1: Navigate to search page ───────────
      const searchLink = this.page.locator('header a[href*="/search"], a[href*="/search"]').first();
      const searchVisible = await searchLink.isVisible({ timeout: 2000 }).catch(() => false);

      if (searchVisible) {
        console.log('✅ Found search link — navigating via client-side click');
        await Promise.all([
          this.page.waitForURL('**/search', { timeout: 10000 }).catch(() => { }),
          searchLink.click({ force: true })
        ]);
        await this.page.waitForLoadState('domcontentloaded').catch(() => { });
      } else {
        const baseUrl = this.page.url().match(/https:\/\/[^\/]+\/en-[A-Z]+/i)?.[0] || 'https://www.dazn.com/en-GB';
        const searchUrl = `${baseUrl}/search`;
        console.log(`🧭 Search link not visible — navigating directly to: ${searchUrl}`);
        await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await this.waitForConsentAndDismiss().catch(() => { });
      }
      console.log(`✅ On search page: ${this.page.url()}`);

      // ── Step 2: Type [dev_mode_on] and press Enter ────────────
      console.log('⌨️  Entering "[dev_mode_on]" in search...');
      const searchInput = this.page.locator(
        'input[type="search"], ' +
        'input[placeholder*="search" i], ' +
        'input[placeholder*="Search" i], ' +
        '[class*="search" i] input, ' +
        '[data-testid*="search" i] input'
      ).first();
      await searchInput.waitFor({ state: 'visible', timeout: 30000 });
      await searchInput.click();
      await searchInput.fill('[dev_mode_on]');
      await this.page.keyboard.press('Enter');
      console.log('✅ Text entered and Enter pressed');

      // ── Step 3: Wait for UUID popup and copy ID ────────────
      await this.page.waitForFunction(() => {
        const body = document.body.innerText || '';
        return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(body) ||
          body.includes('Copy ID');
      }, { timeout: 5000 }).catch(() => { });

      const bodyContent = await this.page.innerText('body').catch(() => '');
      const uuidMatch = bodyContent.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      const devModeId = uuidMatch ? uuidMatch[0] : null;
      console.log(`🔑 Extracted Dev Mode ID: ${devModeId}`);

      if (devModeId) {
        await this.page.evaluate((id) => {
          const textarea = document.createElement('textarea');
          textarea.value = id;
          document.body.appendChild(textarea);
          textarea.select();
          try { document.execCommand('copy'); } catch (e) { }
          document.body.removeChild(textarea);
          const clipboardData = new DataTransfer();
          clipboardData.setData('text/plain', id);
          document.dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }));
        }, devModeId).catch((err) => console.warn('⚠️ Copy error:', err.message));
      }

      // Capture search URL before copy (DAZN may auto-redirect after Copy ID)
      const searchPageUrl = this.page.url();
      console.log(`📌 Current search URL: ${searchPageUrl}`);

      const copyButton = this.page.locator('button:has-text("Copy ID")').first();
      const copyButtonVisible = await copyButton.isVisible({ timeout: 3000 }).catch(() => false);
      if (copyButtonVisible) {
        await copyButton.click();
        console.log('✅ Clicked Copy ID button');
      }

      // ── Step 4: Ensure we're on search page, refresh, verify yellow dot ──────
      // DAZN may auto-redirect to home after Copy ID — navigate back to search
      const currentUrl = this.page.url();
      if (!currentUrl.includes('/search')) {
        console.log(`⚠️ Redirected away from search to: ${currentUrl}`);
        console.log(`🔄 Navigating back to search page: ${searchPageUrl}`);
        await this.page.goto(searchPageUrl, { waitUntil: 'domcontentloaded' });
      }

      console.log('🔄 Refreshing search page to verify yellow dot...');
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { });

      const yellowDotVisible = await yellowDot.isVisible({ timeout: 5000 }).catch(() => false);
      if (yellowDotVisible) {
        console.log('✅ Yellow dot visible on search page — dev mode CONFIRMED ✨');
        await this.page.screenshot({ path: 'test-results/devmode-yellow-dot-confirmed.png', fullPage: false }).catch(() => { });

        // Navigate back to the original URL to continue the flow
        console.log(`🔄 Navigating back to original URL: ${originalUrl}`);
        await this.page.goto(originalUrl, { waitUntil: 'domcontentloaded' });
        await this.waitForConsentAndDismiss().catch(() => { });
      } else {
        console.log('❌ Yellow dot NOT visible — dev mode activation FAILED');
        await this.page.screenshot({ path: 'test-results/devmode-error-yellow-dot.png', fullPage: true }).catch(() => { });
        throw new Error('❌ Yellow dot not visible on search page after dev mode activation');
      }

      // ── Done — caller navigates to home/source ──────
      console.log('✅ Dev mode enabled — returning to caller for navigation');
      console.log('═══════════════════════════════════════════════════\n');

    } catch (e: any) {
      console.warn('⚠️  Dev mode error:', e.message);
      await this.page.screenshot({ path: 'test-results/devmode-error.png', fullPage: true }).catch(() => { });
      throw e;
    }
  }

}
