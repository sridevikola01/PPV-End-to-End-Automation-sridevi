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

    try {
      // Store the exact landing page URL to return to it robustly later
      const landingPageUrl = this.page.url();
      console.log(`📌 Storing landing page URL: ${landingPageUrl}`);

      // ── Step 1: Click "Explore" button in top right ────────────
      console.log('📸 [DevMode Step 1] Clicking "Explore" button...');
      await this.page.screenshot({ path: 'test-results/devmode-01-before-explore.png', fullPage: false }).catch(() => { });

      const exploreBtn = this.page.locator(
        'a:has-text("Explore"), button:has-text("Explore")'
      ).first();

      await exploreBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
      const exploreVisible = await exploreBtn.isVisible({ timeout: 3000 }).catch(() => false);

      if (exploreVisible) {
        console.log('✅ Found "Explore" button');
        await exploreBtn.click({ force: true });
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(2000);

        console.log(`📍 After Explore click, URL: ${this.page.url()}`);
      } else {
        console.log('⚠️  "Explore" button not found — navigating to home page directly');
        const baseUrl = landingPageUrl.match(/https:\/\/[^\/]+\/en-[A-Z]+/i)?.[0] || 'https://www.dazn.com/en-GB';
        await this.page.goto(`${baseUrl}/home`, { waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(2000);
      }

      await this.page.screenshot({ path: 'test-results/devmode-02-after-explore-home.png', fullPage: false }).catch(() => { });

      // ── Step 2: Click Search icon in the home page header ─────
      console.log('📸 [DevMode Step 2] Clicking search icon...');

      const baseUrl = this.page.url().match(/https:\/\/[^\/]+\/en-[A-Z]+/i)?.[0] || 'https://www.dazn.com/en-GB';

      // Ensure cookies are dismissed before clicking search link


      const searchLink = this.page.locator('header a[href*="/search"]').first();
      const searchVisible = await searchLink.isVisible({ timeout: 5000 }).catch(() => false);

      if (searchVisible) {
        console.log('✅ Found search link in header');
        await Promise.all([
          this.page.waitForURL('**/search', { timeout: 10000 }).catch(() => { }),
          searchLink.click({ force: true })
        ]);
        await this.page.waitForTimeout(2000);

      } else {
        console.log('⚠️  Search link not found, navigating directly');
        for (let retries = 0; retries < 3; retries++) {
          await this.page.goto(`${baseUrl}/search`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
          await this.page.waitForTimeout(2000);

          if (this.page.url().includes('/search')) {
            console.log('✅ Successfully landed on search page');
            break;
          }
          console.log(`🔄 Direct navigation to /search failed (current URL: ${this.page.url()}) — retrying...`);
        }
      }

      console.log(`📍 URL: ${this.page.url()}`);
      await this.page.screenshot({ path: 'test-results/devmode-03-search-this.page.png', fullPage: false }).catch(() => { });

      // ── Step 3: Type [dev_mode_on] and press Enter ────────────
      console.log('📸 [DevMode Step 3] Entering "[dev_mode_on]" in search...');
      await this.page.waitForTimeout(2000);

      const searchInput = this.page.locator('input[placeholder*="Search sports" i], input[placeholder*="Search sports, teams, events" i], input[type="search"]').first();
      const searchInputVisible = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

      if (searchInputVisible) {
        console.log('✅ Search input found — filling with [dev_mode_on]');
        await searchInput.click();
        await searchInput.fill('[dev_mode_on]');
        await this.page.waitForTimeout(500);
        console.log('✅ Text entered — pressing Enter key');
        await this.page.keyboard.press('Enter');
        console.log('✅ Enter key pressed');
      } else {
        console.log('⚠️  Search input not found');
      }

      await this.page.waitForTimeout(3000);

      await this.page.screenshot({ path: 'test-results/devmode-04-popup.png', fullPage: false }).catch(() => { });

      // Extract the dynamic Dev Mode ID from the page body
      const bodyContent = await this.page.innerText('body').catch(() => '');
      const uuidMatch = bodyContent.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      const devModeId = uuidMatch ? uuidMatch[0] : null;
      console.log(`🔑 Extracted Dev Mode ID: ${devModeId}`);

      if (devModeId) {
        console.log(`📋 Triggering manual copy event and fallback write for ID: ${devModeId}`);
        await this.page.evaluate((id) => {
          // 1. Use temporary textarea to trigger native browser copy behavior
          const textarea = document.createElement('textarea');
          textarea.value = id;
          document.body.appendChild(textarea);
          textarea.select();
          try {
            document.execCommand('copy');
            console.log('✅ execCommand copy succeeded');
          } catch (e: any) {
            console.warn('❌ execCommand copy failed:', e.message);
          }
          document.body.removeChild(textarea);

          // 2. Dispatch custom ClipboardEvent to trigger application listener
          const clipboardData = new DataTransfer();
          clipboardData.setData('text/plain', id);
          const copyEvent = new ClipboardEvent('copy', {
            clipboardData: clipboardData,
            bubbles: true,
            cancelable: true
          });
          document.dispatchEvent(copyEvent);
          console.log('✅ Custom copy event dispatched');
        }, devModeId).catch((err) => console.warn('⚠️ Error during manual copy triggering:', err.message));
      }

      const copyButton = this.page.locator('button:has-text("Copy ID")').first();
      const copyButtonVisible = await copyButton.isVisible({ timeout: 5000 }).catch(() => false);

      if (copyButtonVisible) {
        console.log('✅ Found "Copy ID" button');
        await copyButton.click();
        await this.page.waitForTimeout(1000);
        console.log('✅ Successfully clicked Copy ID button');
      } else {
        console.log('⚠️  Copy ID button not found — attempting with fallback selector');
        const fallbackButton = this.page.locator('button, [role="button"]').filter({ hasText: /Copy ID/i }).first();
        const fallbackVisible = await fallbackButton.isVisible({ timeout: 3000 }).catch(() => false);
        if (fallbackVisible) {
          await fallbackButton.click();
          await this.page.waitForTimeout(1000);
          console.log('✅ Clicked Copy ID via fallback selector');
        } else {
          console.log('⚠️  Copy ID button not found');
        }
      }

      await this.page.screenshot({ path: 'test-results/devmode-05-after-copy-id.png', fullPage: false }).catch(() => { });

      console.log('📸 [DevMode Step 4.5] Reloading search page to verify yellow dot indicator...');
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(2000);

      // Verify the yellow dot appears beside DAZN™
      const yellowDot = this.page.locator('div[class*="dev-mode__circle"], [class*="dev-mode"]').first();
      let yellowDotVisible = await yellowDot.isVisible({ timeout: 8000 }).catch(() => false);

      if (!yellowDotVisible) {
        console.log('⚠️ Yellow dot not visible on first reload. Trying second reload after 3s...');
        await this.page.waitForTimeout(3000);
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(1000);
        yellowDotVisible = await yellowDot.isVisible({ timeout: 8000 }).catch(() => false);
      }

      if (yellowDotVisible) {
        console.log('✅ Yellow dot indicator visible — dev mode activation CONFIRMED ✨');
        await this.page.screenshot({ path: 'test-results/devmode-04-5-reload-with-yellow-dot.png', fullPage: false }).catch(() => { });
      } else {
        console.log('❌ Yellow dot indicator not visible — dev mode activation FAILED');
        await this.page.screenshot({ path: 'test-results/devmode-error-yellow-dot.png', fullPage: true }).catch(() => { });
        throw new Error('❌ Yellow dot indicator not visible next to DAZN™ trademark in footer');
      }

      // ── Step 5: Go back to return to landing page ──────
      console.log('📸 [DevMode Step 5] Navigating back to landing this.page...');

      // Press Escape to dismiss any remaining modal/popup  
      await this.page.keyboard.press('Escape').catch(() => { });
      await this.page.waitForTimeout(500);

      // Remove any cookie overlay that might block interaction
      await this.page.evaluate(() => {
        document.querySelectorAll('#onetrust-banner-sdk, #onetrust-consent-sdk, [class*="onetrust"], [class*="ot-sdk"]').forEach(el => (el as HTMLElement).style.display = 'none');
      }).catch(() => { });

      // Navigate back twice
      for (let i = 0; i < 2; i++) {
        const beforeUrl = this.page.url();
        await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(async () => {
          await this.page.waitForTimeout(1000);
          await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => { });
        });
        await this.page.waitForTimeout(1500);
        const afterUrl = this.page.url();
        console.log(`  ↩️  Back ${i + 1}: ${beforeUrl} → ${afterUrl}`);
      }

      // Direct fallback if history back navigation got stuck on home page
      const finalUrl = this.page.url();
      console.log(`📍 URL after back navigation: ${finalUrl}`);
      if (finalUrl.includes('/home') || finalUrl === 'about:blank' || !finalUrl.includes('dazn.com')) {
        console.log(`⚠️  Still on home or blank page — navigating directly back to landing page: ${landingPageUrl}`);
        await this.page.goto(landingPageUrl, { waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(1500);
        console.log(`📍 Final URL: ${this.page.url()}`);
      } else {
        console.log(`✅ Successfully returned to landing page: ${this.page.url()}`);
      }

      await this.page.screenshot({ path: 'test-results/devmode-07-ready-to-checkout.png', fullPage: false }).catch(() => { });

      console.log('✅ Dev mode enabled successfully — continuing to ultimate flow');
      console.log('═══════════════════════════════════════════════════\n');

    } catch (e: any) {
      console.warn('⚠️  Dev mode error:', e.message);
      await this.page.screenshot({ path: 'test-results/devmode-error.png', fullPage: true }).catch(() => { });
      throw e;
    }
  }

}
