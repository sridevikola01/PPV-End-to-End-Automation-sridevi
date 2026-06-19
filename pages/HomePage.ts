import { Page } from '@playwright/test';
import { LandingPage } from './LandingPage';

export class HomePage extends LandingPage {
  protected baseUrl: string;

  constructor(page: Page, baseUrl: string = '') {
    super(page);
    this.baseUrl = baseUrl;
  }

  // Navigation for home-page flows
  override async navigate(baseUrl: string, source?: string, eventData?: Record<string, string>): Promise<void> {
    const welcomeUrl = `${baseUrl}/welcome`;
    console.log(`🌍 [HomePage] Navigating to Welcome page: ${welcomeUrl}`);
    await this.page.goto(welcomeUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
    await this.dismissConsentIfPresent();

    console.log(`✅ [HomePage] Welcome page loaded: ${this.page.url()}`);
    await this.clickExplore();

    console.log(`✅ [HomePage] Home page loaded: ${this.page.url()}`);

    // Wait for the hero banner or swiper component to render and be visible
    const bannerLocator = this.page.locator('main [class*="banner"], [class*="hero-banner-slider"], .swiper:not([class*="rail" i]):not([class*="tiles" i])').first();
    await bannerLocator.waitFor({ state: 'visible', timeout: 10000 }).catch((e) => {
      console.log('⚠️ [HomePage] Timeout waiting for hero banner/swiper: ' + e.message);
    });
  }

  protected async clickExplore(): Promise<void> {
    console.log('🔍 Looking for "Explore" button on welcome page...');

    const exploreSelectors = [
      'a:has-text("Explore")',
      'button:has-text("Explore")',
      'a[href*="/home" i]',
      'a:has-text("Explore DAZN")',
      'a:has-text("Explore without subscribing")',
      'a:has-text("Explore for free")',
      '[class*="explore" i]',
    ];

    const combinedSelector = exploreSelectors.join(', ');
    const anyExplore = this.page.locator(combinedSelector).first();
    const found = await anyExplore.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

    if (found) {
      console.log(`📍 Found Explore button`);
      await anyExplore.scrollIntoViewIfNeeded().catch(() => { });
      await anyExplore.click({ force: true });
      await this.page.waitForURL((url: URL) => url.toString().includes('/home'), { timeout: 15000 }).catch(() => { });
    } else {
      console.log('⚠️ Explore button not found — trying direct navigation to /home');
      const currentUrl = this.page.url();
      const baseMatch = currentUrl.match(/(https:\/\/[a-z0-9.-]*dazn\.com\/en-[A-Z]+)/i);
      const base = baseMatch?.[1] || this.getFallbackBaseUrl();
      await this.page.goto(`${base}/home`, { waitUntil: 'domcontentloaded' });
    }

    // Wait for Home page to be visually ready before next action
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
  }

  // Find container logic:
  // For home-page-banner: uses LandingPage.findPPVInBanner
  // For home-page-dont-miss: finds tile, clicks it to open modal, and returns the modal popup!
  override async findPPVContainer(eventData: Record<string, string>, source?: string): Promise<any> {
    const src = (source || '').toLowerCase();

    if (src === 'home-page-banner') {
      return super.findPPVInBanner(eventData);
    }

    if (src === 'home-biggest-fights') {
      console.log('🔍 [HomePage Biggest Fights] Flow: Home → Competition Page → Coming Up → Popup');

      // ── STEP 1: Scroll to "The Biggest Fights" heading ──────────────
      const sectionHeading = this.page.locator('h2').filter({ hasText: /The Biggest Fights/i }).first();

      let foundHeading = false;
      for (let i = 0; i < 15; i++) {
        if (await sectionHeading.isVisible().catch(() => false)) {
          foundHeading = true;
          break;
        }
        await this.page.evaluate((pos: number) => {
          window.scrollTo({ top: pos, behavior: 'instant' });
        }, (i + 1) * 500);
        foundHeading = await sectionHeading.waitFor({ state: 'attached', timeout: 400 })
          .then(() => true).catch(() => false);
        if (foundHeading) break;
      }

      if (!foundHeading) {
        throw new Error(
          `❌ [HomePage Biggest Fights] Section heading "The Biggest Fights" not found on Home page.`
        );
      }

      await sectionHeading.scrollIntoViewIfNeeded().catch(() => {});
      console.log('✅ [HomePage Biggest Fights] Section heading found');

      // ── STEP 2: Find the rail wrapper ────────────────────────────────
      // DOM: <h2 class="rail__title___xxx">The Biggest Fights</h2>
      // Parent chain has div with class containing "rail"
      let sectionWrapper = sectionHeading.locator('xpath=ancestor::div[contains(@class,"rail")][1]');
      let hasWrapper = await sectionWrapper.isVisible({ timeout: 3000 }).catch(() => false);
      if (!hasWrapper) {
        sectionWrapper = sectionHeading.locator('xpath=ancestor::section[1]');
        hasWrapper = await sectionWrapper.isVisible({ timeout: 2000 }).catch(() => false);
      }
      if (!hasWrapper) {
        // Fallback: use parent's parent
        sectionWrapper = sectionHeading.locator('xpath=../..');
        hasWrapper = await sectionWrapper.isVisible({ timeout: 1000 }).catch(() => false);
      }
      console.log(`✅ [HomePage Biggest Fights] Rail wrapper found (hasWrapper=${hasWrapper})`);

      // ── STEP 3: Find the matching PPV tile by fighter names ──────────
      const ppvName = eventData.PPV_NAME || '';
      const vsMatch = ppvName.match(/(\w+)\s+vs\.?\s+(\w+)/i);
      const fighter1 = vsMatch ? vsMatch[1] : '';
      const fighter2 = vsMatch ? vsMatch[2] : '';
      console.log(`🔍 [HomePage Biggest Fights] Looking for: "${ppvName}" (f1="${fighter1}", f2="${fighter2}")`);

      const cleanStr = (s: string) =>
        (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

      const nameParts = ppvName.split(/[:\-–]/).map(p => p.trim()).filter(p => p.length > 3);
      const partsWordLists = nameParts
        .map(part => cleanStr(part).split(/\s+/).filter(Boolean))
        .filter(list => list.length > 0);

      const matchesTileText = (text: string): boolean => {
        const ct = cleanStr(text);
        const matchTitle = partsWordLists.some(words => words.every(w => ct.includes(w)));
        const matchFighters = !!(
          fighter1 && fighter2 &&
          ct.includes(fighter1.toLowerCase()) &&
          ct.includes(fighter2.toLowerCase())
        );
        return matchTitle || matchFighters;
      };

      // Search for matching tile, navigating carousel if needed
      const tiles = sectionWrapper.locator('a[class*="tile" i], a[href*="competition"], a[href*="sport"]');
      const nextBtn = sectionWrapper.locator([
        'button[aria-label="Next slide"]',
        'button[class*="swiper-button-next"]',
        '[class*="next" i]',
      ].join(', ')).first();

      const findMatchingTile = async (): Promise<any> => {
        const count = await tiles.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const tile = tiles.nth(i);
          if (!await tile.isVisible().catch(() => false)) continue;
          const text = (await tile.textContent().catch(() => '')) || '';
          if (matchesTileText(text)) {
            console.log(`🔍 [Biggest Fights] Matched tile: "${text.replace(/\s+/g, ' ').trim().substring(0, 80)}"`);
            return tile;
          }
        }
        return null;
      };

      await sectionWrapper.hover({ force: true }).catch(() => {});

      let targetTile = await findMatchingTile();
      let clicks = 0;
      const maxClicks = 15;

      while (!targetTile && clicks < maxClicks) {
        const nextDisabled = await nextBtn.evaluate((el: Element) =>
          el.classList.contains('swiper-button-disabled') ||
          el.className.includes('disable') ||
          el.hasAttribute('disabled')
        ).catch(() => true);

        if (nextDisabled) {
          console.log('⚠️ [Biggest Fights] Next button disabled — end of carousel');
          break;
        }

        await sectionWrapper.hover({ force: true }).catch(() => {});
        console.log(`  [Biggest Fights] Click ${clicks + 1}: advancing carousel...`);
        await nextBtn.click({ force: true, timeout: 3000 }).catch(() => {});
        clicks++;
        await this.page.waitForTimeout(500);
        targetTile = await findMatchingTile();
      }

      if (!targetTile) {
        throw new Error(
          `❌ [HomePage Biggest Fights] PPV tile for "${ppvName}" not found in ` +
          `"The Biggest Fights" section after ${clicks} carousel slides.`
        );
      }

      console.log(`✅ [Biggest Fights] PPV tile found after ${clicks} carousel clicks`);

      // ── STEP 4: Click tile → Navigate to competition page ────────────
      await targetTile.click({ timeout: 5000 });
      console.log('🔗 [Biggest Fights] Clicked tile, waiting for competition page...');

      await this.page.waitForURL(
        (url: URL) => url.toString().includes('/competition/') || url.toString().includes('/sport/'),
        { timeout: 15000 }
      );
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      console.log(`✅ [Biggest Fights] Competition page loaded: ${this.page.url()}`);

      // ── STEP 5: Scroll to "Coming Up" section on competition page ────
      const comingUpHeading = this.page.locator('h2, h3, h4, [class*="title" i]')
        .filter({ hasText: /Coming [Uu]p/i }).first();

      let foundComingUp = false;
      for (let i = 0; i < 10; i++) {
        if (await comingUpHeading.isVisible().catch(() => false)) {
          foundComingUp = true;
          break;
        }
        await this.page.evaluate((pos: number) => {
          window.scrollTo({ top: pos, behavior: 'instant' });
        }, (i + 1) * 400);
        foundComingUp = await comingUpHeading.waitFor({ state: 'attached', timeout: 300 })
          .then(() => true).catch(() => false);
        if (foundComingUp) break;
      }

      if (!foundComingUp) {
        throw new Error('❌ [Competition Page] "Coming Up" section not found');
      }

      await comingUpHeading.scrollIntoViewIfNeeded().catch(() => {});
      console.log('✅ [Competition Page] "Coming Up" section found');

      // ── STEP 6: Find PPV tile in "Coming Up" rail ────────────────────
      let comingUpRail = comingUpHeading.locator('xpath=ancestor::div[contains(@class,"rail")][1]');
      let hasComingUpRail = await comingUpRail.isVisible({ timeout: 3000 }).catch(() => false);
      if (!hasComingUpRail) {
        comingUpRail = comingUpHeading.locator('xpath=ancestor::section[1]');
        hasComingUpRail = await comingUpRail.isVisible({ timeout: 2000 }).catch(() => false);
      }
      if (!hasComingUpRail) {
        comingUpRail = comingUpHeading.locator('xpath=../..');
      }

      const comingUpTiles = comingUpRail.locator('a[class*="tile" i], a, div[class*="tile" i]');
      const comingUpNext = comingUpRail.locator([
        'button[aria-label="Next slide"]',
        'button[class*="swiper-button-next"]',
        '[class*="next" i]',
      ].join(', ')).first();

      const findComingUpTile = async (): Promise<any> => {
        const count = await comingUpTiles.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const tile = comingUpTiles.nth(i);
          if (!await tile.isVisible().catch(() => false)) continue;
          const text = (await tile.textContent().catch(() => '')) || '';
          if (matchesTileText(text)) {
            console.log(`🔍 [Coming Up] Matched tile: "${text.replace(/\s+/g, ' ').trim().substring(0, 80)}"`);
            return tile;
          }
        }
        return null;
      };

      await comingUpRail.hover({ force: true }).catch(() => {});
      let comingUpTile = await findComingUpTile();
      let cuClicks = 0;

      while (!comingUpTile && cuClicks < 10) {
        const disabled = await comingUpNext.evaluate((el: Element) =>
          el.classList.contains('swiper-button-disabled') ||
          el.className.includes('disable') ||
          el.hasAttribute('disabled')
        ).catch(() => true);
        if (disabled) break;

        await comingUpRail.hover({ force: true }).catch(() => {});
        await comingUpNext.click({ force: true, timeout: 3000 }).catch(() => {});
        cuClicks++;
        await this.page.waitForTimeout(500);
        comingUpTile = await findComingUpTile();
      }

      if (!comingUpTile) {
        throw new Error(
          `❌ [Competition Page] PPV tile for "${ppvName}" not found in "Coming Up" section.`
        );
      }

      console.log(`✅ [Competition Page] PPV tile found in "Coming Up" after ${cuClicks} clicks`);
      return comingUpTile;
    }

    if (src === 'home-page-dont-miss') {
      console.log('🔍 [HomePage Tile] Flow: Tile + Modal popup flow');

      // 1. Scroll to section heading
      const sectionPattern = /don.t miss/i;
      const railHeader = this.page.getByText(sectionPattern).first();

      let foundHeading = false;
      for (let i = 0; i < 8; i++) {
        if (await railHeader.isVisible().catch(() => false)) {
          foundHeading = true;
          break;
        }
        const scrollPos = (i + 1) * 800;
        await this.page.evaluate((pos) => {
          window.scrollTo({ top: pos, behavior: 'instant' });
        }, scrollPos).catch(() => { });

        foundHeading = await railHeader.waitFor({ state: 'attached', timeout: 200 }).then(() => true).catch(() => false);
        if (foundHeading) break;
      }

      if (!foundHeading) {
        throw new Error(`❌ [HomePage Tile] "Don't Miss" rail heading not found in DOM`);
      }

      await railHeader.scrollIntoViewIfNeeded().catch(() => { });
      console.log(`✅ [HomePage Tile] Section heading is visible`);

      // 2. Locate rail wrapper
      const railWrapper = railHeader.locator('xpath=ancestor::*[contains(@class,"rail__rail-wrapper")][1] | ancestor::section[contains(@class,"rail")][1] | ancestor::div[contains(@class,"rail")][1] | ancestor::*[contains(@class,"railWrapper")][1]');
      await railWrapper.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
      console.log('✅ [HomePage Tile] Found rail wrapper');

      // 3. Build search parameters for tile (same as LandingPage.ts)
      const ppvName = eventData.PPV_NAME || '';
      const vsMatch = ppvName.match(/(\w+)\s+vs\.?\s+(\w+)/i);
      const fighter1 = vsMatch ? vsMatch[1] : '';
      const fighter2 = vsMatch ? vsMatch[2] : '';
      console.log(`🔍 [HomePage Tile] Searching tile for event: "${ppvName}" (fighter1="${fighter1}", fighter2="${fighter2}")`);

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
      const ppvTileLink = ppvImg.locator('xpath=ancestor::a[1]');

      const isTileInView = async (): Promise<any> => {
        // First check candidates by text
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
                }
              }
            }
          }
        }

        if (bestTile) {
          const tileText = await bestTile.textContent().catch(() => '');
          console.log(`✅ [HomePage Tile] Best matching tile (score=${bestScore}): "${(tileText || '').trim().replace(/\s+/g, ' ').substring(0, 80)}"`);
          return bestTile;
        }

        // Fallback to image alt matching
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
            return ppvTileLink;
          }
        }
        return null;
      };

      const nextBtn = railWrapper.locator([
        'button[aria-label="Next slide"]',
        'button[class*="swiper-button-next"]',
        '.custom-swiper-button-next',
        '[class*="next" i]',
      ].join(', ')).first();

      await nextBtn.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {
        console.log('⚠️ [HomePage Tile] Swiper next button not attached after 5s');
      });

      await railWrapper.hover({ force: true }).catch(() => { });
      await this.page.waitForTimeout(100);

      let clicks = 0;
      const maxClicks = 30;
      let found = await isTileInView();

      while (!found && clicks < maxClicks) {
        if (this.page.isClosed()) throw new Error('Page closed during swiper navigation');

        const nextDisabled = await nextBtn.evaluate((el: Element) => {
          return el.classList.contains('swiper-button-disabled') ||
            el.classList.contains('rail-module__disable') ||
            el.className.includes('disable') ||
            el.hasAttribute('disabled');
        }).catch(() => false);

        if (nextDisabled) {
          console.log('⚠️ [HomePage Tile] Next button disabled — end of rail reached');
          break;
        }

        let nextCount = await nextBtn.count().catch(() => 0);
        if (nextCount === 0) {
          await this.page.waitForTimeout(100);
          nextCount = await nextBtn.count().catch(() => 0);
          if (nextCount === 0) {
            console.log('⚠️ [HomePage Tile] Next button not found in DOM after retry');
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

      console.log(`✅ [HomePage Tile] Swiper "Next" clicks performed: ${clicks}`);

      if (!found && (await ppvImg.count()) > 0) {
        console.log('🔍 [HomePage Tile] Tile in DOM but not visible — scrolling into view');
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
        throw new Error(`❌ [HomePage Tile] Could not find "${fighter1 || ppvName}" tile in "Don't Miss" rail after ${clicks} clicks`);
      }

      console.log(`📌 [HomePage Tile] Found PPV tile, clicking to open modal...`);
      await found.scrollIntoViewIfNeeded().catch(() => { });
      await this.page.waitForTimeout(150);

      const beforeUrl = this.page.url();
      try {
        await found.click({ force: true, timeout: 10000 });
        console.log(`✅ [HomePage Tile] Clicked PPV tile`);
      } catch (e: any) {
        console.log('⚠️ Standard click failed → trying JS click');
        const handle = await found.elementHandle();
        if (handle) {
          await this.page.evaluate((el: any) => el.click(), handle);
          console.log(`✅ [HomePage Tile] JS click executed on PPV tile`);
        } else {
          throw new Error('❌ PPV tile click failed: ' + e.message);
        }
      }

      let modal: any = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        if (this.page.url() !== beforeUrl) {
          console.log(`✅ [HomePage Tile] Tile click navigated to: ${this.page.url()}`);
          return this.page.locator('body');
        }
        modal = await this.waitForModal();
        if (modal) {
          break;
        }
        await this.page.waitForTimeout(150);
      }

      if (!modal) {
        throw new Error('❌ [HomePage Tile] Modal popup did not appear after clicking tile');
      }

      console.log(`✅ [HomePage Tile] Modal popup found`);
      return modal;
    }

    // For home-page-get-started: locate the "Get Started" CTA on the welcome/home page
    if (src === 'home-page-get-started') {
      console.log('🔍 [HomePage] Finding "Get Started" CTA (preferring header)...');

      // Look in header first to trigger default signup flow without event context
      let getStartedBtn = this.page.locator([
        'header a:has-text("Get started")',
        'header button:has-text("Get started")',
        'header a:has-text("Sign up")',
        'header button:has-text("Sign up")',
        '[class*="header" i] a:has-text("Get started")',
        '[class*="header" i] button:has-text("Get started")',
        '[class*="header" i] a:has-text("Sign up")',
        '[class*="header" i] button:has-text("Sign up")'
      ].join(', ')).first();

      let found = await getStartedBtn.waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);

      if (found) {
        console.log('✅ [HomePage] Found "Get Started" CTA in header');
        return getStartedBtn;
      }

      console.log('⚠️ [HomePage] Header "Get Started" CTA not visible — trying page-wide search');
      getStartedBtn = this.page.locator(
        'button:has-text("Get started "), a:has-text("Get started"), ' +
        'button:has-text("Get started"), a:has-text("Get started")'
      ).first();

      found = await getStartedBtn.waitFor({ state: 'visible', timeout: 12000 })
        .then(() => true)
        .catch(() => false);

      if (!found) {
        // Scroll down to find it if not immediately visible
        for (let i = 1; i <= 5; i++) {
          await this.page.evaluate((pos: number) => {
            window.scrollTo({ top: pos, behavior: 'instant' });
          }, i * 600).catch(() => { });
          const visible = await getStartedBtn.isVisible().catch(() => false);
          if (visible) break;
        }
      }

      if (!(await getStartedBtn.isVisible().catch(() => false))) {
        throw new Error('❌ [HomePage] "Get Started" CTA not found on welcome/home page');
      }

      console.log('✅ [HomePage] "Get Started" CTA found');
      return getStartedBtn;
    }

    console.warn(`⚠️ Unknown source "${source || 'unknown'}" for HomePage. Valid sources: home-page-banner, home-page-dont-miss, home-page-get-started, home-biggest-fights.`);
    return null;
  }

  private async waitForModal(): Promise<any> {
    // Only match actual modal/dialog containers — NOT generic page elements
    const modalSelectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[class*="modal" i]',
      '[class*="popup" i]',
      '[class*="Dialog" i]',
      '.Modal',
    ];

    for (const selector of modalSelectors) {
      const modal = this.page.locator(selector).first();
      if (await modal.isVisible().catch(() => false)) {
        const hasBtn = await modal.locator('button, a').first().isVisible().catch(() => false);
        if (hasBtn) {
          return modal;
        }
      }
    }

    // Fallback: find any visible "Buy now" button inside a fixed/absolute overlay
    const buyNowBtn = this.page.locator('button:has-text("Buy now"), a:has-text("Buy now")').first();
    if (await buyNowBtn.isVisible().catch(() => false)) {
      // Walk up to find the closest container that is a true popup (fixed/absolute position)
      const popupContainer = await buyNowBtn.evaluate((el: HTMLElement) => {
        let current: HTMLElement | null = el.parentElement;
        for (let i = 0; i < 10 && current; i++) {
          const style = window.getComputedStyle(current);
          // A real popup is typically fixed or absolute positioned
          if (style.position === 'fixed' || style.position === 'absolute') {
            // Verify it covers a significant area (not just a small positioned element)
            const rect = current.getBoundingClientRect();
            if (rect.width > 200 && rect.height > 200) {
              return true;
            }
          }
          current = current.parentElement;
        }
        return false;
      }).catch(() => false);

      if (popupContainer) {
        // Re-locate the actual container element
        const containerLocator = buyNowBtn.locator('xpath=ancestor::div[contains(@class,"card") or contains(@class,"container") or contains(@class,"content") or contains(@class,"wrapper") or contains(@class,"box")][last()]');
        if (await containerLocator.isVisible().catch(() => false)) {
          console.log('✅ [waitForModal] Found popup via Buy now button in fixed/absolute overlay');
          return containerLocator;
        }
      }
    }

    return null;
  }

  // Click Buy Now logic:
  // For home-page-banner: uses LandingPage clickBuyNow (direct banner navigation)
  // For home-page-dont-miss: clicks Buy Now inside the modal popup
  override async clickBuyNow(container: any, source?: string): Promise<void> {
    const src = (source || '').toLowerCase();

    if (src === 'home-page-banner') {
      await super.clickBuyNow(container, 'banner');
      return;
    }

    if (src === 'home-page-get-started') {
      console.log('🖱️ [HomePage] Clicking "Get Started" CTA...');
      if (!container) {
        throw new Error('❌ [HomePage] Get Started container is null');
      }
      await container.scrollIntoViewIfNeeded().catch(() => { });
      await container.click({ force: true, timeout: 10000 });
      console.log('✅ [HomePage] Clicked "Get Started" CTA');
      return;
    }

    if (src === 'home-biggest-fights') {
      console.log('💳 [Biggest Fights] Clicking PPV tile on Competition page → Popup → Buy now');

      if (!container) {
        throw new Error('❌ [Biggest Fights] Coming Up tile container is null');
      }

      // Click the tile in "Coming Up" rail → popup modal appears
      await container.scrollIntoViewIfNeeded().catch(() => {});
      await container.click({ timeout: 5000 });
      console.log('✅ [Biggest Fights] Clicked Coming Up tile, waiting for popup modal...');

      // Wait for popup modal to appear
      const modalSelectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        '[class*="modal" i]',
        '[class*="popup" i]',
        '[class*="Dialog" i]',
      ];

      let foundModal: any = null;
      const ctaSelector =
        'button:has-text("Buy now"), a:has-text("Buy now"), ' +
        'button:has-text("Buy Now"), a:has-text("Buy Now"), ' +
        'button:has-text("Subscribe"), a:has-text("Subscribe"), ' +
        'button:has-text("Continue"), a:has-text("Continue")';

      for (const selector of modalSelectors) {
        const modalLocator = this.page.locator(selector)
          .filter({ has: this.page.locator(ctaSelector) }).first();
        try {
          await modalLocator.waitFor({ state: 'visible', timeout: 5000 });
          if (await modalLocator.isVisible().catch(() => false)) {
            foundModal = modalLocator;
            break;
          }
        } catch {
          // Try next selector
        }
      }

      if (!foundModal) {
        throw new Error('❌ [Biggest Fights] Popup modal not found after clicking Coming Up tile');
      }

      console.log('✅ [Biggest Fights] Popup modal appeared');

      // Click "Buy now" inside the popup modal
      const buyNowBtn = foundModal.locator(ctaSelector).first();
      const visible = await buyNowBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (!visible) {
        throw new Error('❌ [Biggest Fights] "Buy now" button not visible inside popup modal');
      }

      try {
        await buyNowBtn.click({ timeout: 5000 });
        console.log('✅ [Biggest Fights] Clicked Buy now in popup modal');
        return;
      } catch (clickErr: any) {
        console.log(`⚠️ Standard click failed: ${clickErr.message} — trying JS click`);
        const handle = await buyNowBtn.elementHandle().catch(() => null);
        if (handle) {
          await this.page.evaluate((el: any) => el.click(), handle);
          console.log('✅ [Biggest Fights] JS click on Buy now executed');
          return;
        }
        await buyNowBtn.click({ force: true, timeout: 5000 });
        console.log('✅ [Biggest Fights] Force-clicked Buy now');
        return;
      }
    }

    if (src === 'home-page-dont-miss') {
      console.log('💳 [HomePage Tile] Clicking "Buy now" in modal popup...');

      if (!container) {
        throw new Error('❌ [HomePage Tile] Modal container is null');
      }

      const ctaSelector = 'button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy Now"), ' +
                          'button:has-text("Subscribe"), a:has-text("Subscribe"), ' +
                          'button:has-text("Continue"), a:has-text("Continue")';

      const dialog = container.locator('[role="dialog"], [aria-modal="true"], [class*="modal" i]').first();
      let buyNowBtn = dialog.locator(ctaSelector).first();

      let visible = await buyNowBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!visible) {
        console.log('⏳ [HomePage Tile] Dialog selector not active. Trying generic container check...');
        buyNowBtn = container.locator(ctaSelector).first();
        visible = await buyNowBtn.isVisible({ timeout: 2000 }).catch(() => false);
      }

      if (!visible) {
        console.log('⏳ [HomePage Tile] Waiting for Buy now button in modal...');
        await this.page.waitForTimeout(1000);
        visible = await buyNowBtn.isVisible({ timeout: 3000 }).catch(() => false);
      }

      if (!visible) {
        throw new Error('❌ [HomePage Tile] Buy now button not found inside modal popup. Will NOT search page-wide to avoid clicking wrong PPV.');
      }

      // Try robust click strategies:
      // 1. Standard click
      try {
        console.log('🖱️ [HomePage Tile] Trying standard click on Buy now button...');
        await buyNowBtn.click({ timeout: 5000 });
        console.log('✅ [HomePage Tile] Clicked Buy now via standard click');
        return;
      } catch (clickErr: any) {
        console.log(`⚠️ [HomePage Tile] Standard click failed: ${clickErr.message} — trying JS click`);
        const handle = await buyNowBtn.elementHandle().catch(() => null);
        if (handle) {
          await this.page.evaluate((el: any) => {
            el.click();
          }, handle);
          console.log('✅ [HomePage Tile] JS click on Buy now executed');
          return;
        }

        console.log(`⚠️ [HomePage Tile] JS click not possible — trying force click`);
        try {
          await buyNowBtn.click({ force: true, timeout: 5000 });
          console.log('✅ [HomePage Tile] Clicked Buy now via force click');
          return;
        } catch (forceErr: any) {
          throw new Error('❌ [HomePage Tile] Buy now button click failed: ' + forceErr.message);
        }
      }
    }

    await super.clickBuyNow(container, source);
  }

  // --- EXISTING METHODS PRESERVED FOR BACKWARD COMPATIBILITY ---

  async navigateToMyAccount(): Promise<void> {
    console.log('👤 Navigating to My Account...');

    // ── Wait for page to be fully loaded ─────────────────────
    await this.page.waitForLoadState('domcontentloaded');

    // ── Dismiss any popup that may be blocking the page ──────
    // NOTE: Never scroll on home page — just dismiss popups
    console.log('⏳ Waiting for home page header...');
    await this.dismissPopup();
    await this.dismissPopup();

    // ── Click profile button ──────────────────────────────────
    console.log('🖱️  Clicking profile button...');

    // Try multiple selectors — UK uses XPath, IN uses avatar button
    const profileSelectors = [
      'xpath=//header//nav//ul[2]//li[2]//button',  // UK structure
      'button[class*="avatar" i]',
      'button[class*="profile" i]',
      '[class*="avatar" i] button',
      // IN structure — circle button with initial top right
      'header button:has([class*="avatar" i])',
      'header button:has([class*="initial" i])',
      // Generic — last button in header nav area
      'header nav button:last-child',
      'header > div button:last-child',
      // The dropdown arrow button next to avatar
      'header button[aria-haspopup]',
      'header button[aria-expanded]',
    ];

    let clicked = false;

    for (const selector of profileSelectors) {
      try {
        const btn = this.page.locator(selector).first();
        const box = await btn.boundingBox({ timeout: 1500 }).catch(() => null);

        if (box && box.width > 0 && box.height > 0) {
          // Verify it's in the top-right area (x > 60% of viewport)
          const viewportWidth = this.page.viewportSize()?.width || 1920;
          if (box.x < viewportWidth * 0.5) continue; // skip if not on right side

          console.log(`📍 Profile button found via: ${selector}`);
          console.log(`📍 boundingBox: ${JSON.stringify(box)}`);

          const cx = Math.round(box.x + box.width / 2);
          const cy = Math.round(box.y + box.height / 2);
          console.log(`🖱️  Clicking at: x=${cx} y=${cy}`);

          await this.page.mouse.move(cx, cy);
          await this.page.waitForTimeout(300);
          await this.page.mouse.click(cx, cy);
          console.log('✅ Profile button clicked');
          clicked = true;
          break;
        }
      } catch {
        // try next
      }
    }

    if (!clicked) {
      console.log('⚠️  Profile button not found — navigating directly');
      await this.navigateDirectly();
      return;
    }

    // ── Wait for dropdown to appear after click ───────────────
    await this.page.waitForTimeout(200);

    // ── Wait for My Account link and click ────────────────────
    const myAccountLink = this.page.locator(
      'a[href*="myaccount" i], ' +
      'a:has-text("My Account"), ' +
      'a:has-text("Account"), ' +
      '[data-testid*="myaccount" i], ' +
      'li:has-text("My Account") a, ' +
      '[class*="dropdown" i] a, ' +
      '[class*="menu" i] a[href*="account" i]'
    ).first();

    const linkVisible = await myAccountLink
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    console.log(`🔍 My Account link visible: ${linkVisible}`);

    if (linkVisible) {
      await myAccountLink.click({ force: true });
      console.log('✅ Clicked My Account');
    } else {
      console.log('⚠️  My Account link not visible — navigating directly');
      await this.navigateDirectly();
      return;
    }

    // ── Wait for My Account URL ───────────────────────────────
    try {
      await this.page.waitForURL(
        url => {
          const u = url.toString().toLowerCase();
          return (
            u.includes('/myaccount') ||
            (u.includes('/account') &&
              !u.includes('/signup') &&
              !u.includes('/signin') &&
              !u.includes('/personaldetails') &&
              !u.includes('/emaildetails') &&
              !u.includes('/content/'))
          );
        },
        { timeout: 15000 }
      );
      console.log(`✅ On My Account: ${this.page.url()}`);
    } catch {
      console.log('⚠️  URL did not change — navigating directly');
      await this.navigateDirectly();
    }
  }

  protected getFallbackBaseUrl(): string {
    const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
    const region = (process.env.DAZN_REGION || 'GB').toUpperCase();
    let domain = 'stag.dazn.com';
    if (env === 'beta') domain = 'beta.dazn.com';
    if (env === 'prod') domain = 'www.dazn.com';
    return `https://${domain}/en-${region}`;
  }

  private async navigateDirectly(): Promise<void> {
    const currentUrl = this.page.url();
    const baseUrlMatch = currentUrl.match(/(https:\/\/[a-z0-9.-]*dazn\.com\/en-[A-Z]+)/i);
    const cleanBase = baseUrlMatch?.[1]
      || this.baseUrl
      || this.getFallbackBaseUrl();

    console.log(`🔗 Direct navigation to: ${cleanBase}/myaccount`);
    await this.page.goto(`${cleanBase}/myaccount`, {
      waitUntil: 'domcontentloaded',
    });
    await this.page.waitForURL(
      url => {
        const u = url.toString().toLowerCase();
        return (
          u.includes('/myaccount') ||
          (u.includes('/account') &&
            !u.includes('/signup') &&
            !u.includes('/signin') &&
            !u.includes('/personaldetails') &&
            !u.includes('/emaildetails') &&
            !u.includes('/content/'))
        );
      },
      { timeout: 15000 }
    ).catch(() => { });
    await this.page.waitForLoadState('domcontentloaded').catch(() => { });
    console.log(`✅ On My Account: ${this.page.url()}`);
  }

  async dismissPopup(): Promise<void> {
    console.log('🔍 Checking for popups...');
    try {
      const dismissSelectors =
        'button:has-text("Keep me updated"), ' +
        'button:has-text("Keep Me Updated"), ' +
        'button:has-text("Maybe later"), ' +
        'button:has-text("Maybe Later"), ' +
        'button:has-text("No thanks"), ' +
        'button:has-text("No Thanks"), ' +
        'button:has-text("Not now"), ' +
        'button:has-text("Not Now"), ' +
        'button:has-text("Close"), ' +
        'button:has-text("Dismiss"), ' +
        'button:has-text("Skip"), ' +
        'button:has-text("Got it"), ' +
        'button:has-text("Got It"), ' +
        'button:has-text("OK"), ' +
        'button:has-text("Cancel"), ' +
        'button:has-text("Done"), ' +
        'button:has-text("Use web version"), ' +
        'button:has-text("Not interested"), ' +
        'button:has-text("Remind me later"), ' +
        'button:has-text("No, thanks"), ' +
        '[aria-label="Close"], ' +
        '[aria-label="close"], ' +
        '[aria-label*="close" i], ' +
        '[aria-label*="dismiss" i], ' +
        '[data-testid*="close" i], ' +
        '[data-testid*="dismiss" i], ' +
        '[role="dialog"] button[class*="close" i], ' +
        '[role="dialog"] button[aria-label*="close" i], ' +
        'button[class*="close" i]:not(input), ' +
        'button[class*="dismiss" i]:not(input)';

      for (let attempt = 0; attempt < 3; attempt++) {
        const popup = this.page.locator(dismissSelectors).first();

        if (await popup.isVisible({ timeout: attempt === 0 ? 2000 : 1000 }).catch(() => false)) {
          const btnText = await popup.textContent().catch(() => '');
          await popup.click({ force: true });
          await this.page.waitForTimeout(200);
          console.log(`✅ Dismissed popup (attempt ${attempt + 1}): "${btnText?.trim()}"`);
          continue;
        }
        break;
      }

      const modal = this.page.locator(
        '[role="dialog"]:not([aria-hidden="true"]), ' +
        '[role="alertdialog"], ' +
        '[class*="modal" i]:not([aria-hidden="true"]), ' +
        '[class*="overlay" i]:not([aria-hidden="true"]), ' +
        '[class*="popup" i]:not([aria-hidden="true"]), ' +
        '[class*="drawer" i]:not([aria-hidden="true"])'
      ).first();

      if (await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
        const closeBtn = modal.locator(
          'button[aria-label*="close" i], ' +
          'button[class*="close" i], ' +
          '[data-testid*="close" i]'
        ).first();

        if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          await closeBtn.click({ force: true });
          await this.page.waitForTimeout(200);
          console.log('✅ Dismissed modal via close button');
          return;
        }

        const modalBtn = modal.locator('button').last();
        if (await modalBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          const btnText = await modalBtn.textContent().catch(() => '');
          const dangerous = /confirm|subscribe|buy|pay|upgrade|continue with dazn/i;
          if (!dangerous.test(btnText || '')) {
            await modalBtn.click({ force: true });
            await this.page.waitForTimeout(200);
            console.log(`✅ Dismissed modal via last button: "${btnText?.trim()}"`);
            return;
          }
        }

        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(200);
        console.log('✅ Dismissed modal via Escape');
        return;
      }

      console.log('ℹ️  No popup found');
    } catch {
      console.log('ℹ️  No popup found');
    }
  }

  // ─────────────────────────────
  // SPORTS DROPDOWN TRIGGER HELPERS
  // ─────────────────────────────
  protected async clickAllSportsDropdown(): Promise<boolean> {
    console.log('🔍 Looking for "All Sports" or "Sports" dropdown menu trigger...');
    const triggers = [
      'button:has-text("Sports")',
      'a:has-text("Sports")',
      'button:has-text("All Sports")',
      'a:has-text("All Sports")',
      '[aria-label*="sports" i]',
      '[class*="sports" i]',
      'button[aria-haspopup="true"]',
    ];

    for (const selector of triggers) {
      const locator = this.page.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const el = locator.nth(i);
        if (await el.isVisible().catch(() => false)) {
          console.log(`🎯 Clicking Sports dropdown trigger: "${selector}"`);
          await el.scrollIntoViewIfNeeded().catch(() => { });
          await el.click({ force: true });

          // Wait up to 3 seconds for a dropdown container to appear
          const containerSelectors = ['[role="menu"]', '[role="listbox"]', '[class*="dropdown" i]', '[class*="menu" i]'];
          for (const cSel of containerSelectors) {
            const visible = await this.page.locator(cSel).first().waitFor({ state: 'visible', timeout: 1000 }).then(() => true).catch(() => false);
            if (visible) {
              console.log(`✅ Sports dropdown menu visible: "${cSel}"`);
              return true;
            }
          }
          await this.page.waitForTimeout(500); // Fallback wait
          return true;
        }
      }
    }
    console.log('⚠️ Could not click Sports dropdown trigger.');
    return false;
  }

  protected async selectSportFromDropdown(sportName: string): Promise<boolean> {
    console.log(`🔍 Selecting sport "${sportName}" from dropdown list...`);

    // Define potential dropdown container selectors to restrict search scope
    const containers = [
      '[role="menu"]',
      '[role="listbox"]',
      '[class*="dropdown" i]',
      '[class*="menu" i]',
      '[class*="sports" i]',
      'div' // generic fallback
    ];

    let activeContainer = this.page.locator('body');
    for (const cSelector of containers) {
      const locator = this.page.locator(cSelector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const c = locator.nth(i);
        if (await c.isVisible().catch(() => false)) {
          const hasOption = await c.locator(`a:has-text("${sportName}"), button:has-text("${sportName}"), li:has-text("${sportName}"), span:has-text("${sportName}")`).first().isVisible().catch(() => false);
          if (hasOption) {
            const box = await c.boundingBox().catch(() => null);
            // Increased max width to 1000 to accommodate multi-column sports mega-menus
            if (box && box.width > 0 && box.width < 1000) {
              activeContainer = c;
              console.log(`✅ Scoping sport search to active dropdown container: "${cSelector}" (width: ${Math.round(box.width)})`);
              break;
            }
          }
        }
      }
      if (activeContainer !== this.page.locator('body')) break;
    }

    const selectors = [
      `button:has-text("${sportName}")`,
      `button span:has-text("${sportName}")`,
      `a:has-text("${sportName}")`,
      `a[href*="sport"]:has-text("${sportName}")`,
      `a[href*="competition"]:has-text("${sportName}")`,
      `[role="menuitem"]:has-text("${sportName}")`,
      `li:has-text("${sportName}")`,
      `div:has-text("${sportName}")`
    ];

    for (const selector of selectors) {
      const locator = activeContainer.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const el = locator.nth(i);
        if (await el.isVisible().catch(() => false)) {
          const box = await el.boundingBox().catch(() => null);
          if (box && box.width > 0 && box.height > 0) {
            console.log(`🎯 Clicking sport link: "${selector}" inside container`);
            await el.scrollIntoViewIfNeeded().catch(() => { });
            const beforeUrl = this.page.url();
            await el.click({ force: true });

            const navigated = await this.page.waitForURL(
              (url: URL) => url.toString() !== beforeUrl,
              { timeout: 8000 }
            ).then(() => true).catch(() => false);

            if (navigated) {
              return true;
            } else {
              console.log(`⚠️ Clicked sport link "${selector}" but URL did not change from "${beforeUrl}"`);
            }
          }
        }
      }
    }
    return false;
  }
}