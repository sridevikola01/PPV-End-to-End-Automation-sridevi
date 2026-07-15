import { Page } from '@playwright/test';
import { HomePage } from './HomePage';
import selectors from '../config/selectors.json';

/**
 * BoxingHomePage — Page object to dynamically handle navigation and checkout flow
 * for any sport landing page (Boxing, Kickboxing, Misfits Boxing, etc.).
 */
export class BoxingHomePage extends HomePage {

  constructor(page: Page) {
    super(page);
  }

  /**
   * Detect environment from current URL.
   * Returns 'stag' | 'beta' | 'prod'
   */
  private detectEnvironment(): 'stag' | 'beta' | 'prod' {
    const url = this.page.url();
    if (url.includes('stag.dazn.com')) return 'stag';
    if (url.includes('beta.dazn.com')) return 'beta';
    return 'prod';
  }

  async navigateToSportViaAllSports(source?: string, eventData?: Record<string, string>): Promise<void> {
    await this.dismissConsentIfPresent();

    let targetSport = '';
    const srcLower = (source || '').toLowerCase();
    if (srcLower.includes('kickboxing')) {
      targetSport = 'Kickboxing';
    } else if (srcLower.includes('misfits')) {
      targetSport = 'Misfits Boxing';
    } else if (srcLower.includes('wrestling')) {
      targetSport = 'Wrestling';
    } else if (srcLower.includes('boxing')) {
      targetSport = 'Boxing';
    }
    if (!targetSport) {
      targetSport = (eventData?.SPORT || 'Boxing').trim();
    }

    const eventSport = (eventData?.SPORT || '').trim();
    if (eventSport && targetSport.toLowerCase() !== eventSport.toLowerCase()) {
      throw new Error(
        `❌ [BoxingHomePage] Source "${source}" is for "${targetSport}" events, ` +
        `but this PPV event's SPORT is "${eventSport}". ` +
        `Use a "${eventSport.toLowerCase()}" source instead (e.g. "home-${eventSport.toLowerCase()}-tile").`
      );
    }

    console.log(`🧭 Navigating to "${targetSport}" landing page via All Sports dropdown...`);
    const dropdownClicked = await this.clickAllSportsDropdown();
    if (dropdownClicked) {
      const sportSelected = await this.selectSportFromDropdown(targetSport);
      if (!sportSelected) {
        console.log(`⚠️ Could not select "${targetSport}" from dropdown — trying direct navigation fallback`);
        await this.navigateToSportDirectFallback(targetSport);
      }
    } else {
      console.log(`⚠️ Could not open sports dropdown — trying direct navigation fallback`);
      await this.navigateToSportDirectFallback(targetSport);
    }

    await this.waitForSportPageContent(targetSport);
    const validated = await this.validateSportCompetitionPage(targetSport);
    if (!validated) {
      console.log(`⚠️ "Best of ${targetSport}" section not found — but continuing`);
    }
    console.log(`✅ ${targetSport} competition page ready: ${this.page.url()}`);
  }


  // ─────────────────────────────
  // NAVIGATE: Welcome → Explore → Home → Tab/Dropdown → Sport competition page
  // ─────────────────────────────
  override async navigate(baseUrl: string, source?: string, eventData?: Record<string, string>): Promise<void> {
    const welcomeUrl = `${baseUrl}/welcome`;
    console.log(`🌍 Navigating to Welcome page: ${welcomeUrl}`);
    await this.page.goto(welcomeUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
    await this.dismissConsentIfPresent();

    console.log(`✅ Welcome page loaded: ${this.page.url()}`);
    await this.clickExplore();

    // Dismiss cookie banner if it reappeared after Welcome → Home transition
    console.log('🍪 Waiting for cookie banner on Home page...');
    await this.dismissConsentIfPresent();

    // ── Resolve target sport from SOURCE name (source dictates sport page) ──
    // The source name (e.g. "home-kickboxing-tile") determines which sport
    // page to navigate to. If the event's SPORT doesn't match, we fail early
    // with a clear error message.
    let targetSport = '';
    const srcLower = (source || '').toLowerCase();
    if (srcLower.includes('kickboxing')) {
      targetSport = 'Kickboxing';
    } else if (srcLower.includes('misfits')) {
      targetSport = 'Misfits Boxing';
    } else if (srcLower.includes('wrestling')) {
      targetSport = 'Wrestling';
    } else if (srcLower.includes('boxing')) {
      targetSport = 'Boxing';
    }
    // Fallback to event config SPORT if source doesn't specify
    if (!targetSport) {
      targetSport = (eventData?.SPORT || 'Boxing').trim();
    }

    // Validate: source-derived sport must match event SPORT
    const eventSport = (eventData?.SPORT || '').trim();
    if (eventSport && targetSport.toLowerCase() !== eventSport.toLowerCase()) {
      throw new Error(
        `❌ [BoxingHomePage] Source "${source}" is for "${targetSport}" events, ` +
        `but this PPV event's SPORT is "${eventSport}". ` +
        `Use a "${eventSport.toLowerCase()}" source instead (e.g. "home-${eventSport.toLowerCase()}-tile").`
      );
    }
    console.log(`🏅 Target sport resolved for navigation: "${targetSport}" (from source: "${source || ''}", event SPORT: "${eventSport}")`);

    console.log(`🧭 Navigating to "${targetSport}" landing page via All Sports dropdown...`);
    const dropdownClicked = await this.clickAllSportsDropdown();
    if (dropdownClicked) {
      const sportSelected = await this.selectSportFromDropdown(targetSport);
      if (!sportSelected) {
        console.log(`⚠️ Could not select "${targetSport}" from dropdown — trying direct navigation fallback`);
        await this.navigateToSportDirectFallback(targetSport);
      }
    } else {
      console.log(`⚠️ Could not open sports dropdown — trying direct navigation fallback`);
      await this.navigateToSportDirectFallback(targetSport);
    }

    await this.waitForSportPageContent(targetSport);
    const validated = await this.validateSportCompetitionPage(targetSport);
    if (!validated) {
      console.log(`⚠️ "Best of ${targetSport}" section not found — but continuing`);
    }
    console.log(`✅ ${targetSport} competition page ready: ${this.page.url()}`);
  }


  // ─────────────────────────────
  // CLICK BOXING TAB on home page
  // ─────────────────────────────
  private async clickBoxingTab(): Promise<void> {
    console.log('🥊 Looking for "Boxing" tab/pill on home page...');

    const combinedSelector = [
      'button:has-text("Boxing")',
      'a:has-text("Boxing")',
      '[role="tab"]:has-text("Boxing")',
      '[role="button"]:has-text("Boxing")',
      'a[href*="boxing" i]',
    ].join(', ');

    const locator = this.page.locator(combinedSelector);
    await locator.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });

    const count = await locator.count().catch(() => 0);
    console.log(`🔍 Found ${count} potential Boxing tab elements`);

    for (let i = 0; i < count; i++) {
      const el = locator.nth(i);
      if (await el.isVisible().catch(() => false)) {
        const box = await el.boundingBox().catch(() => null);
        if (box) {
          console.log(`📍 Checking Boxing tab element ${i}: y=${Math.round(box.y)}, height=${Math.round(box.height)}`);
          if (box.y > 50 && box.y < 750 && box.width > 0 && box.height > 0) {
            console.log(`🎯 Clicking Boxing tab element ${i} at y=${Math.round(box.y)}`);
            await el.scrollIntoViewIfNeeded().catch(() => { });
            const beforeUrl = this.page.url();
            await el.click({ force: true });

            await this.page.waitForURL(
              (url: URL) => url.toString() !== beforeUrl,
              { timeout: 10000 }
            ).catch(() => { });

            await this.waitForSportPageContent('Boxing');
            console.log(`✅ Clicked Boxing tab — navigated to: ${this.page.url()}`);

            return;
          }
        }
      }
    }

    console.log('⚠️ No suitable Boxing tab element found — navigating directly');
    const currentUrl = this.page.url();
    const baseMatch = currentUrl.match(/(https:\/\/[a-z0-9.-]*dazn\.com\/en-[A-Z]+)/i);
    const base = baseMatch?.[1] || this.getFallbackBaseUrl();
    await this.page.goto(`${base}/sport/Sport:2x2oqzx60orpoeugkd754ga17`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await this.waitForSportPageContent('Boxing');
  }


  private async navigateToSportDirectFallback(sportName: string): Promise<void> {
    console.log(`🧭 [Fallback] Navigating directly to "${sportName}" competition page...`);
    const currentUrl = this.page.url();
    const baseMatch = currentUrl.match(/(https:\/\/[a-z0-9.-]*dazn\.com\/en-[A-Z]+)/i);
    const base = baseMatch?.[1] || this.getFallbackBaseUrl();

    let sportId = 'Sport:2x2oqzx60orpoeugkd754ga17'; // default Boxing
    if (sportName.toLowerCase() === 'kickboxing') {
      sportId = 'Sport:5rocwbb1fbfub9yh4yrff8khj';
    } else if (sportName.toLowerCase() === 'wrestling') {
      sportId = 'Sport:50dsk39gxuwwbkss8k2e24mca';
    } else if (sportName.toLowerCase().includes('misfits')) {
      sportId = 'Sport:2x2oqzx60orpoeugkd754ga17';
    }

    await this.page.goto(`${base}/sport/${sportId}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  }

  // ─────────────────────────────
  // WAIT FOR SPORT PAGE CONTENT
  // ─────────────────────────────
  private async waitForSportPageContent(sportName: string): Promise<void> {
    console.log(`⏳ Waiting for ${sportName} page main content to load...`);


    // Wait for network activity to settle
    await this.page.waitForLoadState('domcontentloaded').catch(() => { });
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });

    // Wait for any meaningful content indicator
    const contentSelectors = [
      '.swiper',
      '[class*="swiper"]',
      '[class*="rail" i]',
      '[class*="heroBanner" i]',
      '[class*="hero-banner" i]',
      '[class*="carousel" i]',
      'a:has-text("Buy now")',
      'a:has-text("Sign up")',
      'button:has-text("Buy now")',
      'button:has-text("Sign up")',
      `text=/${sportName}|Fight Card|Fight|Kickboxing/i`,
    ].join(', ');

    const contentReady = this.page.locator(contentSelectors).first();
    const contentLoaded = await contentReady.waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(() => false);

    if (contentLoaded) {
      console.log(`✅ ${sportName} page main content loaded`);
      await this.page.waitForTimeout(1000);
      return;
    }

    console.log(`⚠️ ${sportName} page content not visible — waiting longer...`);
    await this.page.waitForTimeout(2000);

    const afterConsent = await contentReady.waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (afterConsent) {
      console.log(`✅ ${sportName} page content appeared after consent dismissal`);
    } else {
      console.log(`⚠️ ${sportName} page main content still not visible after extended wait — continuing anyway`);
    }
    await this.page.waitForTimeout(1000);
  }

  // ─────────────────────────────
  // VALIDATE SPORT COMPETITION PAGE
  // ─────────────────────────────
  async validateSportCompetitionPage(sportName: string): Promise<boolean> {
    console.log(`🔍 Validating ${sportName} competition page — looking for "Best of ${sportName}"...`);
    const bestOfSport = this.page.locator(
      `text=/Best of ${sportName}/i, h1:has-text("Best of ${sportName}"), h2:has-text("Best of ${sportName}"), h3:has-text("Best of ${sportName}")`
    ).first();

    if (await bestOfSport.isVisible({ timeout: 3000 }).catch(() => false)) {
      return true;
    }
    const tabs = this.page.locator(':has-text("Upcoming Fights"), :has-text("Highlights"), :has-text("Fight Card")').first();
    return await tabs.isVisible({ timeout: 2000 }).catch(() => false);
  }

  // Backward compatible delegate method
  async validateBoxingCompetitionPage(): Promise<boolean> {
    return this.validateSportCompetitionPage('Boxing');
  }

  // ─────────────────────────────
  // FIND PPV CONTAINER — routes by source
  // ─────────────────────────────
  async findPPVContainer(eventData: Record<string, string>, source?: string): Promise<any> {
    const src = (source || '').toLowerCase();

    if (!source) {
      console.warn("⚠️ Warning: No source specified. Falling back to default (banner -> tile) search strategy.");
      try {
        const bannerResult = await this.findPPVInBanner(eventData);
        if (bannerResult) return bannerResult;
      } catch (e) {
        console.warn(`⚠️ Error in banner fallback search: ${(e as Error).message}`);
      }
      try {
        await this.scrollToDontMissSection();
        const tile = await this.findPPVTileInDontMissRail(eventData);
        if (tile) {
          await tile.scrollIntoViewIfNeeded().catch(() => { });
          await this.page.waitForTimeout(150);
          const beforeUrl = this.page.url();
          try {
            await tile.click({ force: true, timeout: 10000 });
          } catch (e: any) {
            const handle = await tile.elementHandle();
            if (handle) {
              await this.page.evaluate((el: any) => el.click(), handle);
            }
          }
          let modal: any = null;
          for (let attempt = 0; attempt < 15; attempt++) {
            if (this.page.url() !== beforeUrl) {
              return this.page.locator('body');
            }
            modal = await this.waitForSportModal();
            if (modal) {
              return modal;
            }
            await this.page.waitForTimeout(150);
          }
        }
      } catch (e) {
        console.warn(`⚠️ Error in tile fallback search: ${(e as Error).message}`);
      }
      return null;
    }

    if (src.includes('dont-miss') || src.includes('tile')) {
      console.log('🔍 [Home Sport Tile] Flow: Tile + Modal popup flow');

      try {
        // Determine section pattern based on sport — Boxing has "Don't miss",
        // Kickboxing/Wrestling/other sports have "Coming up"
        const sportName = (eventData?.SPORT || '').toLowerCase();
        const isBoxingSport = sportName === 'boxing' || sportName === '' || sportName.includes('misfits');
        let sectionPattern: RegExp = isBoxingSport ? /don't\s*miss/i : /coming\s*up/i;
        if (src.includes('biggest-fights') || src === 'home-biggest-fights') {
          sectionPattern = /biggest\s*fights/i;
        } else if (src.includes('upcoming')) {
          sectionPattern = /upcoming/i;
        }

        // Step 1: Scroll to expected section — try fallback patterns if primary not found
        const fallbackPatterns = isBoxingSport
          ? [/coming\s*up/i, /upcoming/i, /events/i]
          : [/don't\s*miss/i, /upcoming/i, /events/i];
        let sectionFound = false;
        try {
          await this.scrollToDontMissSection(sectionPattern);
          sectionFound = true;
        } catch {
          console.log(`⚠️ [Home Sport Tile] Section "${sectionPattern}" not found, trying fallback patterns...`);
          for (const fallback of fallbackPatterns) {
            try {
              await this.scrollToDontMissSection(fallback);
              sectionPattern = fallback;
              sectionFound = true;
              console.log(`✅ [Home Sport Tile] Found section via fallback pattern: ${fallback}`);
              break;
            } catch {
              continue;
            }
          }
          if (!sectionFound) {
            throw new Error(`❌ [Home Sport Tile] No matching section found (tried: ${sectionPattern}, ${fallbackPatterns.join(', ')})`);
          }
        }

        // Step 2: Find the PPV tile by navigating the swiper carousel
        const tile = await this.findPPVTileInDontMissRail(eventData, sectionPattern);
        if (!tile) {
          console.log(`⚠️ [Home Sport Tile] PPV tile not found in section matching pattern: ${sectionPattern}`);
          return null;
        }

        const tileCapture = await tile.evaluate((el: HTMLElement) => {
          const clean = (value: string | null | undefined) =>
            String(value ?? '').replace(/\s+/g, ' ').trim();
          const text = clean(el.innerText || el.textContent);
          const imgTexts = Array.from(el.querySelectorAll('img'))
            .map((img: HTMLImageElement) => clean(img.alt || img.getAttribute('aria-label') || img.getAttribute('title')))
            .filter(Boolean);
          const combined = clean(`${text} ${imgTexts.join(' ')} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`);
          const hasImage = Array.from(el.querySelectorAll<HTMLElement>('img, picture, [role="img"], div, span, a')).some(node => {
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            const hasBackground = !!style.backgroundImage && style.backgroundImage !== 'none';
            return node.tagName.toLowerCase() === 'img' ||
              node.tagName.toLowerCase() === 'picture' ||
              node.getAttribute('role') === 'img' ||
              (hasBackground && rect.width >= 80 && rect.height >= 45);
          });
          const dateMatch =
            combined.match(/\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|January|February|March|April|May|June|July|August|September|October|November|December)\b/i) ||
            combined.match(/\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/i);
          return {
            text: combined,
            dateText: dateMatch ? dateMatch[0] : '',
            hasImage,
          };
        }).catch(() => ({ text: '', dateText: '', hasImage: false }));

        eventData.__HOME_BOXING_TILE_FOUND = 'Yes';
        eventData.__HOME_BOXING_TILE_TEXT = tileCapture.text || '';
        eventData.__HOME_BOXING_TILE_DATE = tileCapture.dateText || eventData.LANDING_PAGE_PPV_DATE || '';
        eventData.__HOME_BOXING_IMAGE_PRESENT = tileCapture.hasImage ? 'Yes' : 'No';
        console.log(
          `[Home Sport Tile] Pre-captured tile validation data: ` +
          `date="${eventData.__HOME_BOXING_TILE_DATE}", ` +
          `image="${eventData.__HOME_BOXING_IMAGE_PRESENT}"`
        );

        console.log(`📌 [Home Sport Tile] Found PPV tile, clicking to open modal...`);
        await tile.scrollIntoViewIfNeeded().catch(() => { });
        await this.page.waitForTimeout(150);

        // Step 3: Click the tile to open modal popup
        const beforeUrl = this.page.url();
        try {
          await tile.click({ force: true, timeout: 10000 });
          console.log(`✅ [Home Sport Tile] Clicked PPV tile`);
        } catch (e: any) {
          console.log('⚠️ Standard click failed → trying JS click');
          const handle = await tile.elementHandle();
          if (handle) {
            await this.page.evaluate((el: any) => el.click(), handle);
            console.log(`✅ [Home Sport Tile] JS click executed on PPV tile`);
          } else {
            console.log('⚠️ PPV tile click failed: ' + e.message);
            return null;
          }
        }

        // Step 4: Wait for navigation or modal popup to appear dynamically
        let modal: any = null;
        for (let attempt = 0; attempt < 15; attempt++) {
          if (this.page.url() !== beforeUrl) {
            console.log(`✅ [Home Sport Tile] Tile click navigated to: ${this.page.url()}`);
            return this.page.locator('body');
          }
          modal = await this.waitForSportModal();
          if (modal) {
            break;
          }
          await this.page.waitForTimeout(150);
        }

        if (!modal) {
          console.log('⚠️ [Home Sport Tile] Modal popup did not appear after clicking tile');
          return null;
        }

        console.log(`✅ [Home Sport Tile] Modal popup found`);
        return modal;
      } catch (e) {
        console.log(`⚠️ Error in finding PPV tile section: ${(e as Error).message}`);
        return null;
      }
    }

    if (src.includes('upcoming')) {
      console.log('🔍 [Home Sport Upcoming] Starting Upcoming Fights flow...');
      // Login-first Ultimate users own the PPV. Their upcoming card intentionally
      // shows Fight card/Purchased instead of Buy now, so allow that card shape
      // only when the caller has explicitly marked this entitlement validation.
      const allowNoBuyNow = String(eventData.__ALLOW_NO_BUY_NOW || '').toLowerCase() === 'true';

      const env = this.detectEnvironment();
      if (env === 'stag') {
        console.log(`⚠️ "Upcoming Fights" tab/section not supported on stag environment for this flow.`);
        return null;
      }

      console.log(`📅 Clicking "Upcoming Fights" tab (env: ${env})...`);
      const tab = this.page.locator('a, button, [role="tab"]').filter({ hasText: /^Upcoming Fights$/i }).first();
      const tabFound = await tab.waitFor({ state: 'visible', timeout: 10000 })
        .then(() => true)
        .catch(() => false);

      if (!tabFound) {
        console.log(`⚠️ "Upcoming Fights" tab not found on ${env} environment within 10s.`);
        return null;
      }

      await tab.scrollIntoViewIfNeeded().catch(() => { });
      await tab.click({ force: true });
      console.log('✅ "Upcoming Fights" tab clicked');

      await this.page.waitForURL((url: URL) => url.toString().includes('tab=schedule'), { timeout: 10000 }).catch(() => { });
      await this.page.waitForLoadState('domcontentloaded').catch(() => { });
      await this.page.waitForTimeout(1500);

      // Scroll past the hero/banner section so the Upcoming Fights schedule cards
      // are in view. Without this, the card search finds the hero banner PPV card
      // (which also contains the event name + "Buy now") at y~=298 instead of the
      // correct schedule card further down the page.
      console.log('📜 [Home Sport Upcoming] Scrolling past hero banner to schedule section...');
      await this.page.evaluate(() => window.scrollTo({ top: 700, behavior: 'instant' })).catch(() => {});
      await this.page.waitForTimeout(800);

      const ppvName = eventData.PPV_NAME || '';
      console.log(`🔍 [Home Sport Upcoming] Searching for PPV card: "${ppvName}"`);

      const vsMatch = ppvName.match(/(\w+)\s+vs\.?\s+(\w+)/i);
      const fighter1 = vsMatch ? vsMatch[1].toLowerCase() : '';
      const fighter2 = vsMatch ? vsMatch[2].toLowerCase() : '';

      const cleanStr = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      const nameParts = ppvName.split(/[:\-–]/).map(p => p.trim()).filter(p => p.length > 3);
      const partsWordLists = nameParts.map(part => cleanStr(part).split(/\s+/).filter(Boolean)).filter(list => list.length > 0);

      const matchesCard = (text: string): boolean => {
        const cleanText = cleanStr(text);
        const matchTitle = partsWordLists.some(words => words.every(w => cleanText.includes(w)));
        const matchFighters = !!(fighter1 && fighter2 && cleanText.includes(fighter1) && cleanText.includes(fighter2));
        return matchTitle || matchFighters;
      };

      try {
        let ppvCard: any = null;
        let bestCardScore = 0;
        for (let scrollAttempt = 0; scrollAttempt < 15; scrollAttempt++) {
          const candidateLocators = [
            this.page.locator('article'),
            this.page.locator('[class*="tile" i]'),
            this.page.locator('[class*="card" i]'),
            this.page.locator('li'),
            this.page.locator('div')
          ];

          for (const locator of candidateLocators) {
            const count = await locator.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
              const el = locator.nth(i);
              if (await el.isVisible().catch(() => false)) {
                const text = (await el.textContent().catch(() => '')) || '';
                const lowerText = text.toLowerCase();
                const hasBuyNow = lowerText.includes('buy now') || lowerText.includes('buy');
                const hasFightCard = lowerText.includes('fight card');
                if (matchesCard(text) && (hasBuyNow || (allowNoBuyNow && hasFightCard))) {
                  const box = await el.boundingBox().catch(() => null);
                  const scrollY = await this.page.evaluate(() => window.scrollY).catch(() => 0);
                  const absoluteTop = box ? box.y + scrollY : 0;
                  // Use absolute page position instead of viewport y. The target
                  // schedule card can be slightly above the viewport after the
                  // initial schedule scroll, while hero/banner matches are much
                  // higher on the page and should still be excluded.
                  if (box && box.width > 50 && box.width < 1800 && box.height > 50 && box.height < 700 && absoluteTop > 450) {
                    const score = this.scorePPVMatch(text, ppvName);
                    if (score > bestCardScore) {
                      bestCardScore = score;
                      ppvCard = el;
                      console.log(`🔍 [Home Sport Upcoming] Candidate card (score=${score}): "${text.replace(/\s+/g, ' ').substring(0, 100)}"`);
                    }
                  }
                }
              }
            }
            if (ppvCard && bestCardScore >= 90) break; // Exact/near-exact match found
          }

          if (ppvCard) {
            const box = await ppvCard.boundingBox().catch(() => null);
            if (box) {
              console.log(`📜 [Home Sport Upcoming] Scrolling PPV card to viewport (y=${Math.round(box.y)})...`);
              await ppvCard.evaluate((el: HTMLElement) => {
                el.scrollIntoView({ block: 'center', inline: 'center' });
              }).catch(() => { });
              await this.page.waitForTimeout(1000);
            }
            break;
          }

          console.log(`📜 [Home Sport Upcoming] PPV card not found yet — scrolling down (attempt ${scrollAttempt + 1})...`);
          await this.page.evaluate(() => {
            window.scrollBy(0, 450);
          }).catch(() => { });
          await this.page.waitForTimeout(1000);
        }

        if (!ppvCard) {
          console.log(`⚠️ [Home Sport Upcoming] PPV card for "${ppvName}" not found under Upcoming Fights tab`);
          return null;
        }

        console.log('✅ [Home Sport Upcoming] Correct PPV card is identified');
        return ppvCard;
      } catch (e) {
        console.log(`⚠️ Error finding upcoming PPV card: ${(e as Error).message}`);
        return null;
      }
    }

    if (src.includes('banner')) {
      try {
        return await this.findPPVInBanner(eventData);
      } catch (e) {
        console.log(`⚠️ Error finding PPV banner slide: ${(e as Error).message}`);
        return null;
      }
    }

    return null;
  }

  // ─────────────────────────────
  // SCROLL TO "DON'T MISS" SECTION
  // ─────────────────────────────
  private async scrollToDontMissSection(sectionPattern: RegExp = /don't\s*miss/i): Promise<void> {
    const env = this.detectEnvironment();
    console.log(`📍 [Home Sport Tile] Scrolling to section matching pattern ${sectionPattern} (env: ${env})...`);

    const railHeader = this.page.locator('h1, h2, h3, h4, h5, h6, [class*="heading" i], [class*="title" i]')
      .filter({ hasText: sectionPattern })
      .first();

    let found = false;
    for (let i = 0; i < 8; i++) {
      if (await railHeader.isVisible().catch(() => false)) {
        found = true;
        break;
      }
      const scrollPos = (i + 1) * 800;
      await this.page.evaluate((pos) => {
        window.scrollTo({ top: pos, behavior: 'instant' });
      }, scrollPos).catch(() => { });

      found = await railHeader.waitFor({ state: 'attached', timeout: 200 }).then(() => true).catch(() => false);
      if (found) break;
    }

    if (!found) {
      found = await railHeader.waitFor({ state: 'attached', timeout: 5000 }).then(() => true).catch(() => false);
    }

    if (!found) {
      throw new Error(
        `❌ CRITICAL: Section heading matching pattern ${sectionPattern} not found on ${env} environment. ` +
        `The home-sport-tile flow cannot proceed without this section.`
      );
    }

    await railHeader.scrollIntoViewIfNeeded().catch(() => { });
    console.log(`✅ [Home Sport Tile] Section heading matching pattern ${sectionPattern} is visible`);
  }

  // ─────────────────────────────
  // FIND PPV TILE IN "DON'T MISS" or "COMING UP" RAIL
  // ─────────────────────────────
  private async findPPVTileInDontMissRail(eventData: Record<string, string>, sectionPattern: RegExp = /don't\s*miss/i): Promise<any> {
    const ppvName = eventData.PPV_NAME || '';
    console.log(`🔍 [Home Sport Tile] Navigating rail matching pattern ${sectionPattern} to find: "${ppvName}"`);

    const vsMatch = ppvName.match(/(\w+)\s+vs\.?\s+(\w+)/i);
    const fighter1 = vsMatch ? vsMatch[1] : '';
    const fighter2 = vsMatch ? vsMatch[2] : '';
    console.log(`🔍 [Home Sport Tile] Searching for image with alt containing: "${fighter1}" and "${fighter2}"`);

    const env = this.detectEnvironment();
    const railHeader = this.page.locator('h1, h2, h3, h4, h5, h6, [class*="heading" i], [class*="title" i]')
      .filter({ hasText: sectionPattern })
      .first();
    await railHeader.waitFor({ state: 'attached', timeout: 15000 });

    const railWrapper = railHeader.locator('xpath=ancestor::*[contains(@class,"rail__rail-wrapper")][1] | ancestor::section[contains(@class,"rail")][1] | ancestor::div[contains(@class,"rail")][1]');
    await railWrapper.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
    console.log('✅ [Home Sport Tile] Found rail wrapper');

    const cleanStr = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const nameParts = ppvName.split(/[:\-–]/).map(p => p.trim()).filter(p => p.length > 3);
    const partsWordLists = nameParts.map(part => cleanStr(part).split(/\s+/).filter(Boolean)).filter(list => list.length > 0);

    const matchesTileText = (text: string): boolean => {
      const ct = cleanStr(text);
      const matchTitle = partsWordLists.some(words => words.every(w => ct.includes(w)));
      const matchFighters = !!(fighter1 && fighter2 && ct.includes(fighter1.toLowerCase()) && ct.includes(fighter2.toLowerCase()));
      return matchTitle || matchFighters;
    };

    const exclusions = [
      'press conference', 'weigh-in', 'workout', 'replay', 'highlights',
      'preview', 'promo', 'interview', 'behind the scenes', 'episode',
      'documentary', 'face off'
    ];
    const exclusionSelector = exclusions.map(term => `:not([alt*="${term}" i])`).join('');

    let imgSelector = '';
    if (fighter1 && fighter2) {
      imgSelector = `img[alt*="${fighter1}" i][alt*="${fighter2}" i]${exclusionSelector}:not(.swiper-slide-duplicate img)`;
    } else if (fighter1) {
      imgSelector = `img[alt*="${fighter1}" i]${exclusionSelector}:not(.swiper-slide-duplicate img)`;
    } else {
      imgSelector = `img[alt*="${ppvName}" i]${exclusionSelector}:not(.swiper-slide-duplicate img)`;
    }

    const ppvImg = railWrapper.locator(imgSelector).first();
    const ppvTile = ppvImg.locator('xpath=ancestor::a[1]');

    const isTileInView = async (): Promise<any> => {
      const tileCandidates = railWrapper.locator('a[class*="tile__link" i], a[class*="tile" i], div[class*="tile" i], div[class*="card" i], a, button');
      const candidateCount = await tileCandidates.count().catch(() => 0);

      let bestTile: any = null;
      let bestScore = 0;

      for (let i = 0; i < candidateCount; i++) {
        const tile = tileCandidates.nth(i);
        if (await tile.isVisible().catch(() => false)) {
          const text = await tile.textContent().catch(() => '');
          if (text && matchesTileText(text)) {
            const inView = await tile.evaluate((el: HTMLElement) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
            }).catch(() => false);
            if (inView) {
              const score = this.scorePPVMatch(text, ppvName);
              if (score > bestScore) {
                bestScore = score;
                bestTile = tile;
                console.log(`🔍 [Home Sport Tile] Candidate tile (score=${score}): "${text.trim().replace(/\s+/g, ' ').substring(0, 80)}"`);
              }
            }
          }
        }
      }

      if (bestTile) {
        const tileText = await bestTile.textContent().catch(() => '');
        console.log(`✅ [Home Sport Tile] Best matching tile (score=${bestScore}): "${(tileText || '').trim().replace(/\s+/g, ' ').substring(0, 80)}"`);
        return bestTile;
      }

      // 2. Fallback to image alt matching
      for (let retry = 0; retry < 2; retry++) {
        const imgCount = await ppvImg.count().catch(() => 0);
        if (imgCount === 0) {
          if (retry === 0) {
            await this.page.waitForTimeout(100);
            continue;
          }
          break;
        }
        const inView = await ppvImg.evaluate((el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
        }).catch(() => false);
        if (inView) {
          return ppvTile;
        }
      }
      return null;
    };

    await railWrapper.hover({ force: true }).catch(() => { });
    await this.page.waitForTimeout(50);

    let found = await isTileInView();
    if (found) {
      console.log('✅ [Home Sport Tile] Tile already in view, no need to navigate rail');
      return found;
    }

    const nextBtn = railWrapper.locator('button[aria-label="Next slide"], button[class*="swiper-button-next"], .custom-swiper-button-next').first();

    await nextBtn.waitFor({ state: 'attached', timeout: 2000 }).catch(() => {
      console.log('⚠️ [Home Sport Tile] Swiper next button not attached after 2s');
    });

    let clicks = 0;
    const maxClicks = 30;

    while (!found && clicks < maxClicks) {
      if (this.page.isClosed()) throw new Error('Page closed during swiper navigation');

      const nextDisabled = await nextBtn.evaluate((el: Element) => {
        return el.classList.contains('swiper-button-disabled') ||
          el.classList.contains('rail-module__disable') ||
          el.className.includes('disable') ||
          el.hasAttribute('disabled');
      }).catch(() => false);

      if (nextDisabled) {
        console.log('⚠️ [Home Sport Tile] Next button disabled — end of rail');
        break;
      }

      let nextCount = await nextBtn.count().catch(() => 0);
      if (nextCount === 0) {
        await this.page.waitForTimeout(100);
        nextCount = await nextBtn.count().catch(() => 0);
        if (nextCount === 0) {
          console.log('⚠️ [Home Sport Tile] Next button not found in DOM after retry');
          break;
        }
      }

      await nextBtn.click({ timeout: 5000, force: true }).catch((e: any) => {
        console.log('⚠️ Next click error:', e.message);
      });
      clicks++;

      await this.page.waitForTimeout(250);
      found = await isTileInView();
    }

    console.log(`✅ [Home Sport Tile] Swiper "Next" clicks performed: ${clicks}`);

    if (!found && (await ppvImg.count()) > 0) {
      console.log('🔍 [Home Sport Tile] Tile in DOM but not visible — scrolling into view');
      await ppvImg.scrollIntoViewIfNeeded().catch(() => { });
      await this.page.waitForTimeout(150);
      found = await isTileInView();
    }

    if (!found) {
      const dump = await railWrapper.evaluate((el: HTMLElement) => {
        const imgs = Array.from(el.querySelectorAll('img')).slice(0, 20).map((img: HTMLImageElement) => ({
          alt: img.alt,
          src: img.src?.substring(0, 80),
          w: img.width,
          h: img.height,
        }));
        return {
          nextDisabled: el.querySelector('button[aria-label="Next slide"]')?.classList.contains('swiper-button-disabled'),
          imgs,
        };
      }).catch(() => null);

      console.log('=== RAIL DEBUG ===');
      console.log('Next disabled:', dump?.nextDisabled);
      console.log('Images:', JSON.stringify(dump?.imgs, null, 2));
      throw new Error(`❌ [Home Sport Tile] Could not find "${fighter1 || ppvName}" tile in rail after ${clicks} clicks`);
    }

    console.log(`... [Home Sport Tile] Tile in view after ${clicks} next clicks`);
    return found;
  }

  // ─────────────────────────────
  private async waitForSportModal(): Promise<any> {
    console.log('🔍 [Home Sport Tile] Searching for modal popup...');

    // ── Priority 1: DAZN-specific PPV popup selectors ──────────────────────────
    // These are the most reliable signals that a real PPV popup appeared after
    // clicking the tile. Check these FIRST to avoid matching the pre-existing
    // "DAZN Ultimate" promo section (which also has class*="modal") on the page.
    const daznPopupSelectors = [
      '#notification-layer [class*="signup-paywall"]',
      '#notification-layer [class*="modal"]',
      '#notification-layer [role="dialog"]',
      '[class*="signup-paywall"]',
    ];

    for (let attempt = 0; attempt < 25; attempt++) {
      // Priority 1: DAZN PPV-specific popup containers
      for (const selector of daznPopupSelectors) {
        const el = this.page.locator(selector).first();
        if (!await el.isVisible({ timeout: 100 }).catch(() => false)) continue;
        const hasBuyNow = await el.locator(
          'button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy Now")'
        ).first().isVisible().catch(() => false);
        if (hasBuyNow) {
          console.log(`✅ [Home Sport Tile] Found modal via priority selector: "${selector}"`);
          return el;
        }
      }

      // Priority 2: Generic modal selectors — but only if they contain "Buy now"
      // (not just any CTA like "Subscribe" or "Continue" from the Ultimate promo)
      const genericSelectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        '[class*="popup" i]',
        '[class*="Dialog" i]',
        '.Modal',
        '[class*="overlay" i]',
        '[class*="modal" i]',
      ];

      for (const selector of genericSelectors) {
        const modalElements = this.page.locator(selector);
        const count = await modalElements.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const modal = modalElements.nth(i);
          if (!await modal.isVisible().catch(() => false)) continue;
          const hasBuyNow = await modal.locator(
            'button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy Now")'
          ).first().isVisible().catch(() => false);
          if (hasBuyNow) {
            console.log(`✅ [Home Sport Tile] Found modal card via selector: "${selector}" (index ${i})`);
            return modal;
          }
        }
      }

      await this.page.waitForTimeout(100);
    }

    console.log('⚠️ [Home Sport Tile] No modal found with "Buy now" button');
    return null;
  }

  // ─────────────────────────────
  // CLICK BUY NOW — handles both tile (modal popup) and banner sources
  // ─────────────────────────────
  async clickBuyNow(container: any, source?: string): Promise<void> {
    const src = (source || '').toLowerCase();

    if (src.includes('banner')) {
      await super.clickBuyNow(container, source);
      return;
    }

    if (src.includes('upcoming')) {
      console.log('💳 [Home Sport Upcoming] Clicking "Buy now" CTA within the card...');
      if (!container) {
        throw new Error('❌ [Home Sport Upcoming] PPV card container is null');
      }

      await container.scrollIntoViewIfNeeded().catch(() => { });
      await this.page.waitForTimeout(300);
      await container.evaluate((el: HTMLElement) => {
        el.scrollIntoView({ block: 'center', inline: 'center' });
      }).catch(() => { });
      await this.page.waitForTimeout(300);

      const buyNowBtn = container.locator('button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy Now")').first();
      await buyNowBtn.waitFor({ state: 'visible', timeout: 10000 });

      const beforeUrl = this.page.url();
      await buyNowBtn.click({ force: true });
      console.log('✅ [Home Sport Upcoming] Clicked Buy now within card');

      await this.page.waitForURL(
        (url: URL) => url.toString() !== beforeUrl,
        { timeout: 8000 }
      ).catch(() => { });

      await this.page.waitForLoadState('domcontentloaded').catch(() => { });
      await this.page.waitForTimeout(800);
      console.log(`✅ [Home Sport Upcoming] Navigated to: ${this.page.url()}`);

      const currentUrl = this.page.url();
      const currentUrlLower = currentUrl.toLowerCase();
      const stayedOnSchedule =
        currentUrl === beforeUrl ||
        (currentUrlLower.includes('/sport/') && currentUrlLower.includes('tab=schedule'));

      if (stayedOnSchedule) {
        const cardText = await container.textContent().catch(() => '');
        throw new Error(
          `❌ [Home Sport Upcoming] Buy now click did not leave the Upcoming Fights schedule page. ` +
          `Refusing to click a page-wide CTA because it may belong to another event.\n` +
          `URL: ${currentUrl}\n` +
          `Card: ${(cardText || '').replace(/\s+/g, ' ').trim().substring(0, 200)}`
        );
      }

      const landedOnFixtureDetails =
        currentUrlLower.includes('/fixture/') ||
        currentUrlLower.includes('/event/') ||
        currentUrlLower.includes('contentid') ||
        (
          currentUrlLower.includes('/sport/') &&
          !currentUrlLower.includes('tab=schedule') &&
          currentUrl !== beforeUrl
        );

      if (landedOnFixtureDetails && !currentUrlLower.includes('plandetails') && !currentUrlLower.includes('tierplans') && !currentUrlLower.includes('signup') && !currentUrlLower.includes('checkout') && !currentUrlLower.includes('payment')) {
        console.log('📍 [Home Sport Upcoming] Landed on event details page. Looking for main "Buy now" button...');

        const detailsCta = this.page.locator('main a:has-text("Buy now"), main button:has-text("Buy now"), main a:has-text("Buy Now"), main button:has-text("Buy Now")').first();
        await detailsCta.waitFor({ state: 'visible', timeout: 6000 });

        const finalBeforeUrl = this.page.url();
        await detailsCta.click({ force: true });
        console.log('✅ [Home Sport Upcoming] Clicked main Buy now on event details page');

        await this.page.waitForURL(
          (url: URL) => url.toString() !== finalBeforeUrl,
          { timeout: 10000 }
        ).catch(() => { });
        await this.page.waitForLoadState('domcontentloaded').catch(() => { });
        console.log(`✅ [Home Sport Upcoming] Final URL after event details page: ${this.page.url()}`);
      }
      return;
    }

    if (src.includes('tile') || src.includes('dont-miss')) {
      console.log('💳 [Home Sport Tile] Clicking "Buy now" in modal popup...');

      if (!container) {
        throw new Error('❌ [Home Sport Tile] Modal container is null');
      }

      // Strictly match "Buy now" only — "Subscribe" and "Continue" are too broad
      // and match the DAZN Ultimate promo CTA for logged-in freemium users.
      const ctaSelector = 'button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy Now")';

      let buyNowBtn = container.locator(ctaSelector).first();

      let visible = await buyNowBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!visible) {
        // Try the #notification-layer directly as a fallback (more reliable scope)
        console.log('⏳ [Home Sport Tile] Container CTA not visible. Trying #notification-layer directly...');
        const notifLayer = this.page.locator('#notification-layer').first();
        if (await notifLayer.isVisible({ timeout: 1000 }).catch(() => false)) {
          buyNowBtn = notifLayer.locator(ctaSelector).first();
          visible = await buyNowBtn.isVisible({ timeout: 1000 }).catch(() => false);
        }
      }

      if (!visible) {
        console.log('⏳ [Home Sport Tile] Waiting for Buy now button in modal...');
        visible = await buyNowBtn.isVisible({ timeout: 1500 }).catch(() => false);
      }

      if (!visible) {
        throw new Error('❌ [Home Sport Tile] Buy now button not found inside modal popup. Will NOT search page-wide to avoid clicking wrong PPV.');
      }

      const beforeUrl = this.page.url();

      try {
        console.log('🖱️ [Home Sport Tile] Trying standard click on Buy now button...');
        await buyNowBtn.click({ timeout: 5000 });
        console.log('✅ [Home Sport Tile] Clicked Buy now via standard click');
      } catch (clickErr: any) {
        console.log(`⚠️ [Home Sport Tile] Standard click failed: ${clickErr.message} — trying JS click`);
        const handle = await buyNowBtn.elementHandle().catch(() => null);
        if (handle) {
          await this.page.evaluate((el: any) => {
            el.click();
          }, handle);
          console.log('✅ [Home Sport Tile] JS click on Buy now executed');
        } else {
          console.log('⚠️ [Home Sport Tile] JS click not possible — trying force click');
          try {
            await buyNowBtn.click({ force: true, timeout: 5000 });
            console.log('✅ [Home Sport Tile] Clicked Buy now via force click');
          } catch (forceErr: any) {
            throw new Error('❌ [Home Sport Tile] Buy now button click failed: ' + forceErr.message);
          }
        }
      }

      await this.page.waitForURL(
        (url: URL) => url.toString().includes('ppv') ||
          url.toString().includes('PlanDetails') ||
          url.toString().includes('signup') ||
          url.toString().includes('payment') ||
          url.toString().includes('contextualPpv'),
        { timeout: 20000 }
      ).catch(() => {
        console.log('⚠️ URL did not change after Buy now click — waiting for any URL change');
        return this.page.waitForURL(
          (url: URL) => url.toString() !== beforeUrl,
          { timeout: 15000 }
        ).catch(() => {
          console.log('⚠️ Still no URL change — waiting for load state');
        });
      });

      await this.page.waitForLoadState('domcontentloaded').catch(() => { });
      await this.page.waitForTimeout(2000);
      const newUrl = this.page.url();
      return;
    }
  }
}
