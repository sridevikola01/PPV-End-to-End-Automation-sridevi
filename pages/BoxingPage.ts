import { Page } from '@playwright/test';
import { LandingPage } from './LandingPage';

export class BoxingPage extends LandingPage {
  constructor(page: Page) {
    super(page);
  }

  // ─────────────────────────────
  // NAVIGATE TO BOXING URL
  // ─────────────────────────────
  override async navigate(baseUrl: string, source?: string): Promise<void> {
    const url = `${baseUrl}/p/boxing`;
    console.log(`🌍 Navigating to Boxing page: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
    await this.dismissConsentIfPresent();
    const isStag = url.includes('stag') || (process.env.DAZN_ENV || '').toLowerCase() === 'stag';
    const waitTimeout = isStag ? 2000 : 15000;
    await this.page.waitForSelector(
      'button:has-text("Buy this fight"), button:has-text("Get included")',
      { state: 'visible', timeout: waitTimeout }
    ).catch(() => { });
    console.log(`✅ Landed on: ${this.page.url()}`);
  }

  // ─────────────────────────────
  // FIND PPV CARD IN "UPCOMING BIG FIGHTS" SECTION
  // Strict: throws if section not found. Uses > carousel button
  // to navigate through all cards if PPV not immediately visible.
  // Pattern mirrors SportsLandingPage.findPPVTileInDontMissRail()
  // ─────────────────────────────
  async findUpcomingFightsPPV(eventData: Record<string, string>): Promise<any> {
    const ppvName = eventData.PPV_NAME || '';
    const vsMatch = ppvName.match(/(\w+)\s+vs\.?\s+(\w+)/i);
    const fighter1 = vsMatch ? vsMatch[1] : '';
    const fighter2 = vsMatch ? vsMatch[2] : '';

    console.log(`🔍 [Upcoming Big Fights] Looking for "${ppvName}"...`);

    // ── STEP 1: Scroll to find "Upcoming Big Fights" heading ──────────
    // STRICT: if heading not found → throw, no fallback
    let sectionHeading: any = null;
    for (let scroll = 0; scroll < 12; scroll++) {
      const heading = this.page.locator(
        'h2, h3, h4, [class*="heading" i], [class*="title" i], [class*="sectionTitle" i]'
      ).filter({ hasText: /upcoming big fights/i }).first();

      if (await heading.isVisible({ timeout: 800 }).catch(() => false)) {
        sectionHeading = heading;
        break;
      }
      await this.page.evaluate(() => window.scrollBy(0, 400));
      await this.page.waitForTimeout(300);
    }

    if (!sectionHeading) {
      throw new Error(
        `❌ [Upcoming Big Fights] Section heading "Upcoming Big Fights" not found on Boxing page. ` +
        `This section must be present for source "boxing-upcoming-fights" to work. ` +
        `No fallback will be attempted.`
      );
    }

    console.log('✅ [Upcoming Big Fights] Section heading found');
    await sectionHeading.scrollIntoViewIfNeeded().catch(() => {});
    await this.page.waitForTimeout(500);

    // ── STEP 2: Find the section wrapper / rail container ─────────────
    // Walk up from the heading to find the container that holds the cards
    let sectionWrapper: any = null;

    // Try common wrapper class patterns (same approach as SportsLandingPage)
    const wrapperSelectors = [
      'xpath=ancestor::*[contains(@class,"railWrapper")][1]',
      'xpath=ancestor::*[contains(@class,"rail__rail-wrapper")][1]',
      'xpath=ancestor::section[1]',
      'xpath=ancestor::div[contains(@class,"section")][1]',
      'xpath=ancestor::div[contains(@class,"upcoming")][1]',
      'xpath=ancestor::div[contains(@class,"fights")][1]',
    ];

    for (const sel of wrapperSelectors) {
      const wrapper = sectionHeading.locator(sel);
      if (await wrapper.isVisible({ timeout: 1000 }).catch(() => false)) {
        sectionWrapper = wrapper;
        console.log(`✅ [Upcoming Big Fights] Found section wrapper via: ${sel}`);
        break;
      }
    }

    // Fallback: use the heading's parent section/div
    if (!sectionWrapper) {
      sectionWrapper = sectionHeading.locator('xpath=ancestor::*[self::section or self::div][1]');
      const hasWrapper = await sectionWrapper.isVisible({ timeout: 1000 }).catch(() => false);
      if (!hasWrapper) {
        // Last resort: scope to page but log warning
        console.log('⚠️ [Upcoming Big Fights] Could not find section wrapper — scoping to full page');
        sectionWrapper = this.page.locator('body');
      }
    }

    // ── STEP 3: Wait for fight cards to render ────────────────────────
    await this.page.waitForSelector(
      'button:has-text("Buy now"), a:has-text("Buy now")',
      { state: 'visible', timeout: 8000 }
    ).catch(() => {
      console.log('⚠️ [Upcoming Big Fights] No "Buy now" buttons found within timeout');
    });

    // ── STEP 4: Build name matchers (same pattern as SportsLandingPage) ─
    const cleanStr = (s: string) =>
      (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

    const nameParts = ppvName.split(/[:\-–]/).map(p => p.trim()).filter(p => p.length > 3);
    const partsWordLists = nameParts
      .map(part => cleanStr(part).split(/\s+/).filter(Boolean))
      .filter(list => list.length > 0);

    const matchesCard = (text: string): boolean => {
      const ct = cleanStr(text);
      const matchTitle = partsWordLists.some(words => words.every(w => ct.includes(w)));
      const matchFighters = !!(
        fighter1 && fighter2 &&
        ct.includes(fighter1.toLowerCase()) &&
        ct.includes(fighter2.toLowerCase())
      );
      return matchTitle || matchFighters;
    };

    // ── STEP 5: Check if PPV card is already visible ──────────────────
    const isTileInView = async (): Promise<any> => {
      // Find all cards that have "Buy now" button
      const cardCandidates = sectionWrapper.locator(
        '[class*="card" i], [class*="fight" i], [class*="event" i], [class*="tile" i], article, li'
      ).filter({ has: this.page.locator('button:has-text("Buy now"), a:has-text("Buy now")') });

      const count = await cardCandidates.count().catch(() => 0);
      let bestCard: any = null;
      let bestScore = 0;

      for (let i = 0; i < count; i++) {
        const card = cardCandidates.nth(i);
        if (!await card.isVisible().catch(() => false)) continue;

        const text = (await card.textContent().catch(() => '')) || '';
        if (!matchesCard(text)) continue;

        // Check if card is in viewport (not hidden by carousel overflow)
        const inView = await card.evaluate((el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
        }).catch(() => false);

        if (!inView) continue;

        // Score the match (exact match = 100, partial = lower)
        const score = (() => {
          const ct = cleanStr(text);
          const cn = cleanStr(ppvName);
          if (ct === cn) return 100;
          const nameWords = cn.split(/\s+/).filter(Boolean);
          const allMatch = nameWords.every(w => ct.includes(w));
          if (!allMatch) return 0;
          return Math.round((cn.length / ct.length) * 90);
        })();

        if (score > bestScore) {
          bestScore = score;
          bestCard = card;
          console.log(`🔍 [Upcoming Big Fights] Candidate card (score=${score}): "${text.replace(/\s+/g, ' ').substring(0, 80)}"`);
        }
      }

      return bestCard;
    };

    // ── STEP 6: Navigate carousel using > button (same as SportsLandingPage) ─
    // Find the next/chevron button within the section
    const nextBtn = sectionWrapper.locator([
      'button[aria-label="Next slide"]',
      'button[class*="swiper-button-next"]',
      '[class*="next" i]:not([class*="disabled" i])',
      'button[class*="chevron" i]',
      'button[class*="arrow" i]',
      'svg[class*="chevron" i]',
    ].join(', ')).first();

    // Hover to reveal navigation arrows (same pattern as SportsLandingPage)
    await sectionWrapper.hover({ force: true }).catch(() => {});
    await this.page.waitForTimeout(300);

    let found = await isTileInView();
    if (found) {
      console.log('✅ [Upcoming Big Fights] PPV card already visible — no carousel navigation needed');
      return found;
    }

    // Navigate carousel with > button until PPV found or end reached
    const maxClicks = 30;
    let clicks = 0;

    while (!found && clicks < maxClicks) {
      if (this.page.isClosed()) throw new Error('Page closed during carousel navigation');

      // Hover to keep arrows visible
      await sectionWrapper.hover({ force: true }).catch(() => {});
      await this.page.waitForTimeout(200);

      // Check if next button is disabled (end of carousel)
      const nextDisabled = await nextBtn.evaluate((el: Element) => {
        return el.classList.contains('swiper-button-disabled') ||
          el.classList.contains('rail-module__disable') ||
          el.className.includes('disable') ||
          el.hasAttribute('disabled');
      }).catch(() => false);

      if (nextDisabled) {
        console.log('⚠️ [Upcoming Big Fights] Next button disabled — end of carousel reached');
        break;
      }

      // Check next button exists in DOM (retry once for transient detach)
      let nextCount = await nextBtn.count().catch(() => 0);
      if (nextCount === 0) {
        await this.page.waitForTimeout(400);
        nextCount = await nextBtn.count().catch(() => 0);
        if (nextCount === 0) {
          console.log('⚠️ [Upcoming Big Fights] Next button not found in DOM after retry');
          break;
        }
      }

      console.log(`  [Upcoming Big Fights] Click ${clicks + 1}: advancing carousel...`);
      await nextBtn.click({ timeout: 5000, force: true }).catch((e: any) => {
        console.log(`⚠️ Next click error: ${e.message}`);
      });
      clicks++;
      await this.page.waitForTimeout(600);

      found = await isTileInView();
    }

    console.log(`📊 [Upcoming Big Fights] Carousel clicks performed: ${clicks}`);

    // If still not found after carousel navigation → FAIL
    if (!found) {
      throw new Error(
        `❌ [Upcoming Big Fights] PPV card for "${ppvName}" not found in "Upcoming Big Fights" ` +
        `section after navigating ${clicks} carousel slides. ` +
        `No fallback will be attempted.`
      );
    }

    console.log(`✅ [Upcoming Big Fights] PPV card found after ${clicks} carousel clicks`);
    return found;
  }

  // ─────────────────────────────
  // FIND BUNDLE SECTION on /boxing page
  // ─────────────────────────────
  async findBundleSection(): Promise<any> {
    console.log('🔍 [Bundle] Looking for bundle section on boxing page...');

    // Scroll down to find the bundle section
    for (let scroll = 0; scroll < 5; scroll++) {
      await this.page.evaluate(() => {
        window.scrollBy(0, 600);
      }).catch(() => { });
      await this.page.waitForTimeout(500);

      // Check if bundle section is visible
      const bundleHeading = this.page.locator('text=/Save with a fight bundle/i').first();
      if (await bundleHeading.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('✅ [Bundle] Found "Save with a fight bundle" section');
        break;
      }
    }

    // Wait for Get Started button
    const getStartedBtn = this.page.locator('button:has-text("Get Started"), a:has-text("Get Started")').first();
    await getStartedBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
      console.log('⚠️  [Bundle] "Get Started" button not found');
    });

    // Find the bundle card container
    const bundleCard = this.page.locator(
      '[class*="bundle" i], [class*="Bundle" i]'
    ).first();

    if (await bundleCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('✅ [Bundle] Bundle card found');
      return bundleCard;
    }

    // Fallback: return the section containing the Get Started button
    if (await getStartedBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('✅ [Bundle] Returning section with Get Started button');
      return this.page.locator('body').first();
    }

    console.log('⚠️  [Bundle] Bundle section not found');
    return null;
  }

  override async findPPVContainer(eventData: Record<string, string>, source?: string): Promise<any> {
    if (source && (source.startsWith('boxing-bundle') || source.startsWith('boxing-page-bundle'))) {
      return this.findBundleSection();
    }
    if (source === 'boxing-upcoming-fights') {
      // Returns the specific PPV card element — clickBuyNow will find
      // "Buy now" inside it. Throws if section or PPV not found.
      return this.findUpcomingFightsPPV(eventData);
    }
    return this.page.locator('body').first();
  }

  override async clickBuyNow(container: any, source?: string): Promise<void> {
    if (!container) {
      throw new Error('❌ No PPV container found — cannot click Buy Now');
    }

    console.log(`` + `💳 Clicking Boxing CTA via source: ${source}...`);
    await this.stopCarouselAutoSlide();
    await this.dismissConsentIfPresent();

    let btn;
    if (source === 'boxing-bundle' || source === 'boxing-page-bundle' || source === 'boxing-bundle-ultimate') {
      if (source === 'boxing-bundle-ultimate') {
        // Look for container with Ultimate text and find its Get Started button
        const ultimateBtn = this.page.locator('div:has-text("Ultimate"), [class*="ultimate" i]')
          .locator('button:has-text("Get Started"), a:has-text("Get Started")')
          .first();
        if (await ultimateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          btn = ultimateBtn;
        } else {
          const btns = this.page.locator('button:has-text("Get Started"), a:has-text("Get Started")');
          if (await btns.count().catch(() => 0) > 1) {
            btn = btns.nth(1);
          } else {
            btn = btns.first();
          }
        }
      } else {
        btn = this.page.locator('button:has-text("Get Started"), a:has-text("Get Started")').first();
      }
    } else {
      let btnSelector = '';
      if (source === 'boxing-buy' || source === 'boxing-page-banner') {
        btnSelector = 'button:has-text("Buy this fight"), a:has-text("Buy this fight")';
      } else if (source === 'boxing-ultimate') {
        btnSelector = 'button:has-text("Get included in DAZN Ultimate"), a:has-text("Get included in DAZN Ultimate")';
      } else if (source === 'boxing-upcoming-fights') {
        // container IS the specific PPV card — find "Buy now" inside it
        // Do NOT fall back to page-level search
        const cardBuyNow = container.locator(
          'button:has-text("Buy now"), a:has-text("Buy now")'
        ).first();
        const isVisible = await cardBuyNow.isVisible({ timeout: 3000 }).catch(() => false);
        if (!isVisible) {
          throw new Error(
            `❌ [Upcoming Big Fights] "Buy now" button not found inside PPV card. ` +
            `Will NOT search page-wide to avoid clicking wrong PPV.`
          );
        }
        btn = cardBuyNow;
      }
      if (!btn || (source !== 'boxing-upcoming-fights' && !btnSelector)) {
        btn = this.page.locator(btnSelector || 'button:has-text("Buy now")').first();
      } else if (source !== 'boxing-upcoming-fights') {
        btn = this.page.locator(btnSelector).first();
      }
    }

    const isBtnVisible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isBtnVisible) {
      const isStag = this.page.url().includes('stag') || (process.env.DAZN_ENV || '').toLowerCase() === 'stag';
      if (isStag) {
        throw new Error(`❌ STAGING FAST FAIL: Boxing PPV banner not available on staging environment.`);
      }
      throw new Error(`❌ Boxing CTA button not visible on page (source: ${source})`);
    }

    await btn.waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
      await btn.scrollIntoViewIfNeeded().catch(() => { });
      await this.page.waitForTimeout(500);
    });

    await btn.scrollIntoViewIfNeeded().catch(() => { });
    await this.page.waitForTimeout(300);

    const beforeUrl = this.page.url();

    try {
      await btn.click({ force: true, timeout: 5000 });
    } catch {
      console.log('⚠️  Click intercepted → forcing JS click');
      const handle = await btn.elementHandle({ timeout: 2000 });
      if (!handle) throw new Error('❌ Boxing CTA element handle not found');
      await this.page.evaluate((el: any) => el.click(), handle);
    }

    console.log(`✅ Clicked Boxing CTA`);
    await this.page.waitForLoadState('domcontentloaded').catch(() => { });

    const newUrl = this.page.url();
    console.log(`✅ Navigated to: ${newUrl}`);

    // Verify navigation
    if (newUrl !== beforeUrl && !newUrl.includes('ppv') &&
      !newUrl.includes('contextualPpv') && !newUrl.includes('signup')) {
      console.log(`⚠️  WARNING: Unexpected URL: ${newUrl}`);
    }
  }
}
