import { Page } from '@playwright/test';
import { LandingPage } from './LandingPage';
import { handleCookies, stabilisePage, dismissCookieBanner, isCookieSdkBlocked, resetCookieSdkBlock } from '../utils/helpers';
import { RailsInterceptor, RailTileMatch, clickTileByRailPosition } from '../utils/railsInterceptor';

export class HomePage extends LandingPage {
  protected baseUrl: string;
  /** Stores the RailsInterceptor instance when navigating with rails capture (home-page-dazntile). */
  private _railsInterceptor: RailsInterceptor | null = null;

  constructor(page: Page, baseUrl: string = '') {
    super(page);
    this.baseUrl = baseUrl;
  }

  // Navigation for home-page flows
  override async navigate(baseUrl: string, source?: string, eventData?: Record<string, string>): Promise<void> {
    // ── EARLY PATH: home-page-dazntile ───────────────────────────────────
    // The rails interceptor MUST start BEFORE page.goto() to capture all API rail responses.
    if (source === 'home-page-dazntile') {
      const targetUrl = `${baseUrl}/home`;
      console.log(`🌍 [HomePage] Navigating to: ${targetUrl} (with rails API interception)`);

      // Parse target entitlements early so we can pass them for early-stop scrolling
      const rawEnt = eventData?.ENTITLEMENT_IDS || eventData?.RAIL_ENTITLEMENT || process.env.ENTITLEMENT_IDS || '';
      const targetEntitlements = rawEnt
        ? rawEnt.split(',').map((e: string) => e.trim()).filter(Boolean)
        : ['base_dazn_content'];
      console.log(`🎯 [HomePage] Target entitlements: [${targetEntitlements.join(', ')}]`);

      // Unblock OneTrust CDN so cookie banner can appear fresh on this navigation
      await resetCookieSdkBlock(this.page);

      // Clear OneTrust consent from localStorage so banner triggers again
      await this.page.addInitScript(() => {
        try {
          localStorage.removeItem('OptanonConsent');
          localStorage.removeItem('OptanonAlertBoxClosed');
          localStorage.removeItem('eupubconsent-v2');
        } catch {}
      });

      this._railsInterceptor = new RailsInterceptor(this.page);
      await this._railsInterceptor.captureAllRailsResponses(
        async () => {
          await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
          await this.page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});

          // Dismiss cookie banner using the shared utility.
          // dismissCookieBanner() will inject a synthetic banner if OneTrust
          // doesn't load (e.g. non-EU IP in CI/dev), ensuring every run
          // exercises the cookie-dismiss flow.
          await dismissCookieBanner(this.page, true);
        },
        30000,
        20,                  // max scroll steps (only used if early-stop doesn't trigger)
        targetEntitlements   // stop scrolling as soon as a matching tile is found
      );
      console.log(`✅ [HomePage] Rails captured. Total rails: ${this._railsInterceptor.getAllRails().length}. Page: ${this.page.url()}`);
      return;
    }

    const isHomePage = source === 'home-page-get-started' || source === 'home-page-live-tv-rail';
    const targetUrl = isHomePage
      ? `${baseUrl}/home`
      : `${baseUrl}/welcome`;
    console.log(`🌍 [HomePage] Navigating to: ${targetUrl}`);
    await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});

    // If SDK is already blocked (warmup done for non-home-page sources), skip cookie handling.
    // If this IS a home-page source, dismiss cookies here (this is the warmup page).
    if (!isCookieSdkBlocked()) {
      await dismissCookieBanner(this.page, true); // skipNavigation=true — already on the page
    }

    console.log(`✅ [HomePage] Page loaded: ${this.page.url()}`);

    if (source === 'home-page-get-started' || source === 'home-page-live-tv-rail') {
      return;
    }

    if (source !== 'home-page-get-started' && source !== 'home-page-live-tv-rail') {
      await this.clickExplore();
      console.log(`✅ [HomePage] Home page loaded: ${this.page.url()}`);
    }

    // Wait for the hero banner or swiper component to render and be visible
    const bannerLocator = this.page.locator('main [class*="banner"], [class*="hero-banner-slider"], .swiper').first();
    await bannerLocator.waitFor({ state: 'visible', timeout: 10000 }).catch((e) => {
      console.log('⚠️ [HomePage] Timeout waiting for hero banner/swiper: ' + e.message);
    });
  }

  private async clickExplore(): Promise<void> {
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

    await this.page.waitForLoadState('domcontentloaded').catch(() => { });
  }

  // Find container logic:
  // For home-page-banner: uses LandingPage.findPPVInBanner
  // For home-page-dont-miss: finds tile, clicks it to open modal, and returns the modal popup!
  override async findPPVContainer(eventData: Record<string, string>, source?: string): Promise<any> {
    const src = (source || '').toLowerCase();

    if (src === 'home-page-banner') {
      return super.findPPVInBanner(eventData);
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

    // ── home-page-live-tv-rail: find Sports Program tile in Live TV rail ──
    if (src === 'home-page-live-tv-rail') {
      console.log('🔍 [HomePage] Flow: Live TV rail — finding tile or Subscribe entry...');

      // Wait for page to load then scroll to find Live TV section
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(2000);

      // Scroll down gradually to load Live TV rail
      for (let i = 1; i <= 10; i++) {
        await this.page.evaluate((pos: number) => window.scrollTo({ top: pos, behavior: 'instant' }), i * 500).catch(() => {});
        await this.page.waitForTimeout(400);
      }
      await this.page.waitForTimeout(500);

      // Strategy 1: Find "Live TV" rail heading and get a tile from it
      const liveTvHeadings = [
        this.page.getByText(/Live TV/i).first(),
        this.page.locator('h2, h3, [class*="rail-header" i], [class*="railHeader" i]').filter({ hasText: /Live TV|Live Channels|Live Now/i }).first(),
      ];
      for (const heading of liveTvHeadings) {
        if (await heading.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log('✅ [HomePage] Found Live TV section heading');
          // Try to get the rail wrapper from the heading
          const railWrapper = heading.locator('xpath=ancestor::section[1] | ancestor::div[contains(@class,"rail")][1] | ancestor::*[contains(@class,"rail")][1]');
          if (await railWrapper.count().catch(() => 0) > 0) {
            const firstTile = railWrapper.locator('a').first();
            if (await firstTile.isVisible({ timeout: 2000 }).catch(() => false)) {
              const tileText = await firstTile.textContent().catch(() => '');
              console.log(`✅ [HomePage] Found tile in Live TV rail: "${(tileText || '').trim().substring(0, 50)}"`);
              return firstTile;
            }
          }
        }
      }

      // Strategy 2: Find Sports Program tile directly by its text
      const sportsTile = this.page.locator('a').filter({ hasText: /Sports Program/i }).first();
      if (await sportsTile.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('✅ [HomePage] Found Sports Program tile by text');
        return sportsTile;
      }

      // Strategy 3: Find tile with "Red Bull TV" subtitle (Sports Program channel)
      const redBullTile = this.page.locator('a').filter({ hasText: /Red Bull TV/i }).first();
      if (await redBullTile.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('✅ [HomePage] Found Red Bull TV tile');
        return redBullTile;
      }

      // Strategy 4: Scan all visible links for lock icon
      const allLinks = this.page.locator('a[href]');
      const count = await allLinks.count().catch(() => 0);
      console.log(`📊 [HomePage] Scanning ${count} links for locked tile`);

      for (let i = 0; i < Math.min(count, 100); i++) {
        const link = allLinks.nth(i);
        if (!await link.isVisible({ timeout: 100 }).catch(() => false)) continue;

        const hasLock = await link.evaluate((el: Element) => {
          const children = el.querySelectorAll('*');
          for (const child of children) {
            const cls = (child.className || '').toString().toLowerCase();
            if (cls.includes('lock') || cls.includes('padlock')) return true;
          }
          return false;
        }).catch(() => false);

        if (hasLock) {
          const text = await link.textContent().catch(() => '');
          console.log(`✅ [HomePage] Found locked tile: "${(text||'').trim().substring(0,50)}"`);
          return link;
        }
      }

      // Strategy 5: Find any tile in any rail that is a channel/live content
      const channelTile = this.page.locator('a').filter({ hasText: /Live|Channel|TV|Stream/i }).first();
      if (await channelTile.isVisible({ timeout: 2000 }).catch(() => false)) {
        const tileText = await channelTile.textContent().catch(() => '');
        console.log(`✅ [HomePage] Found channel/live tile: "${(tileText || '').trim().substring(0, 50)}"`);
        return channelTile;
      }

      // Strategy 6 (Final Fallback): Use header Subscribe/Get Started button as entry point
      // This handles the case where the Live TV rail doesn't exist but we still need
      // to get the user into the signup flow from the home page
      console.log('⚠️ [HomePage] No Live TV rail tile found — falling back to header Subscribe/Get Started button');
      const headerBtn = this.page.locator([
        'header a:has-text("Subscribe")',
        'header button:has-text("Subscribe")',
        'header a:has-text("Get started")',
        'header button:has-text("Get started")',
        'header a:has-text("Sign up")',
        'header button:has-text("Sign up")',
        'a:has-text("Subscribe")',
        'button:has-text("Subscribe")',
        'a:has-text("Get started")',
        'button:has-text("Get started")',
      ].join(', ')).first();

      if (await headerBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        const btnText = await headerBtn.textContent().catch(() => '');
        console.log(`✅ [HomePage] Found header CTA button: "${(btnText || '').trim()}"`);
        return headerBtn;
      }

      throw new Error('❌ [HomePage] No Live TV rail tile or Subscribe button found on home page');
    }

    if (src === 'home-page-dazntile') {
      return await this.findTileLocatorByEntitlement(eventData);
    }

    // Strict source validation — no cross-source fallback
    throw new Error(
      `❌ PPV not found in expected source: "${source || 'unknown'}". ` +
      `No fallback search will be attempted. Valid sources: home-page-banner, home-page-dont-miss, home-page-get-started, home-page-live-tv-rail, home-page-dazntile.`
    );
  }

  private async waitForModal(): Promise<any> {
    const modalSelectors = [
      '[role="dialog"]',
      '[class*="modal" i]',
      '[class*="popup" i]',
      '[aria-modal="true"]',
      '[class*="overlay" i]',
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

    if (src === 'home-page-dont-miss') {
      console.log('💳 [HomePage Tile] Clicking "Buy now" in modal popup...');

      if (!container) {
        throw new Error('❌ [HomePage Tile] Modal container is null');
      }

      const dialog = container.locator('[role="dialog"], [aria-modal="true"], [class*="modal" i]').first();
      let buyNowBtn = dialog
        .locator('button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy Now")')
        .first();

      let visible = await buyNowBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!visible) {
        console.log('⏳ [HomePage Tile] Dialog selector not active. Trying generic container check...');
        buyNowBtn = container
          .locator('button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy Now")')
          .first();
        visible = await buyNowBtn.isVisible({ timeout: 2000 }).catch(() => false);
      }

      if (!visible) {
        console.log('⏳ [HomePage Tile] Waiting for Buy now button in modal...');
        await this.page.waitForTimeout(1000);
        visible = await buyNowBtn.isVisible({ timeout: 3000 }).catch(() => false);
      }

      if (!visible) {
        console.log('🔍 [HomePage Tile] Searching entire page for Buy now...');
        const pageBuyNow = this.page.locator(
          'button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy Now")'
        ).first();
        if (await pageBuyNow.isVisible({ timeout: 3000 }).catch(() => false)) {
          console.log(`✅ [HomePage Tile] Found Buy now on page`);
          await pageBuyNow.click({ force: true, timeout: 8000 });
          return;
        }
        throw new Error('❌ [HomePage Tile] Buy now button not found/visible inside modal popup or page');
      }

      await buyNowBtn.click({ force: true, timeout: 8000 });
      console.log('✅ [HomePage Tile] Clicked Buy now in modal');
      return;
    }

    if (src === 'home-page-live-tv-rail') {
      console.log('🖱️ [HomePage] Clicking Live TV rail tile...');
      if (!container) {
        throw new Error('❌ [HomePage] Live TV tile container is null');
      }
      await container.scrollIntoViewIfNeeded().catch(() => {});

      const beforeUrl = this.page.url();

      // Try clicking the tile — use normal click first (not force) to preserve native behavior
      try {
        await Promise.all([
          this.page.waitForURL((url: URL) => url.toString() !== beforeUrl, { timeout: 8000 }).catch(() => {}),
          container.click({ timeout: 5000 }),
        ]);
      } catch {
        // Fallback to force click if normal click is intercepted
        await container.click({ force: true, timeout: 5000 }).catch(() => {});
      }

      console.log('✅ [HomePage] Clicked Live TV rail tile — checking for navigation or modal...');
      await this.page.waitForTimeout(2000);

      // Check if tile click already navigated
      let currentUrl = this.page.url();
      if (currentUrl !== beforeUrl) {
        console.log(`✅ [HomePage] Tile click navigated to: ${currentUrl}`);
        return;
      }

      // Look for modal popup after tile click
      console.log('🔍 [HomePage] Looking for modal popup...');
      const modalSelectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        '[class*="modal" i]',
        '[class*="popup" i]',
        '[class*="overlay" i]:has(button)',
        '[class*="drawer" i]',
      ];

      let modal: any = null;
      for (const sel of modalSelectors) {
        const candidate = this.page.locator(sel).first();
        if (await candidate.isVisible({ timeout: 1500 }).catch(() => false)) {
          const hasBtn = await candidate.locator('button, a[href]').first().isVisible().catch(() => false);
          if (hasBtn) {
            modal = candidate;
            console.log(`✅ [HomePage] Modal found via: ${sel}`);
            break;
          }
        }
      }

      if (modal) {
        // Find Subscribe/Get started button inside modal
        const btnSelectors = [
          'a:has-text("Subscribe")',
          'button:has-text("Subscribe")',
          'a:has-text("Get started")',
          'button:has-text("Get started")',
          'a:has-text("Sign up")',
          'button:has-text("Sign up")',
          'a:has-text("Get DAZN")',
          'button:has-text("Get DAZN")',
        ];

        let subscribeBtn: any = null;
        for (const sel of btnSelectors) {
          const btn = modal.locator(sel).first();
          if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
            subscribeBtn = btn;
            const btnText = await btn.textContent().catch(() => '');
            console.log(`✅ [HomePage] Found modal button: "${(btnText || '').trim()}" via: ${sel}`);
            break;
          }
        }

        if (!subscribeBtn) {
          // Fallback: any button or link in modal
          subscribeBtn = modal.locator('a[href], button').first();
          const btnText = await subscribeBtn.textContent().catch(() => '');
          console.log(`⚠️ [HomePage] Using fallback modal button: "${(btnText || '').trim()}"`);
        }

        if (subscribeBtn) {
          // First: try to extract href and navigate directly (most reliable)
          const href = await subscribeBtn.getAttribute('href').catch(() => null);
          if (href && (href.includes('signup') || href.includes('subscribe') || href.startsWith('/'))) {
            const fullUrl = href.startsWith('http') ? href : new URL(href, beforeUrl).toString();
            console.log(`🔗 [HomePage] Navigating directly via href: ${fullUrl}`);
            await this.page.goto(fullUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
            console.log(`✅ [HomePage] Navigated to: ${this.page.url()}`);
            return;
          }

          // Second: try normal click with waitForNavigation
          console.log('🖱️ [HomePage] Clicking Subscribe button (normal click)...');
          try {
            await Promise.all([
              this.page.waitForURL((url: URL) => url.toString() !== beforeUrl, { timeout: 10000 }),
              subscribeBtn.click({ timeout: 5000 }),
            ]);
            console.log(`✅ [HomePage] Subscribe click navigated to: ${this.page.url()}`);
            return;
          } catch {
            console.log('⚠️ [HomePage] Normal click did not navigate — trying force click...');
          }

          // Third: try force click
          await subscribeBtn.click({ force: true }).catch(() => {});
          await this.page.waitForTimeout(2000);
          currentUrl = this.page.url();
          if (currentUrl !== beforeUrl) {
            console.log(`✅ [HomePage] Force click navigated to: ${currentUrl}`);
            return;
          }

          // Fourth: try JS click
          console.log('⚠️ [HomePage] Force click did not navigate — trying JS click...');
          await subscribeBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {});
          await this.page.waitForTimeout(2000);
          currentUrl = this.page.url();
          if (currentUrl !== beforeUrl) {
            console.log(`✅ [HomePage] JS click navigated to: ${currentUrl}`);
            return;
          }
        }
      }

      // No modal or modal click didn't work — try header Subscribe/Get started button
      console.log('⚠️ [HomePage] Modal approach failed — trying header Subscribe/Get started...');
      const headerBtns = [
        'header a:has-text("Subscribe")',
        'header a:has-text("Get started")',
        'header a:has-text("Sign up")',
        'a:has-text("Subscribe")',
        'a:has-text("Get started")',
      ];

      for (const sel of headerBtns) {
        const btn = this.page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          const href = await btn.getAttribute('href').catch(() => null);
          const btnText = await btn.textContent().catch(() => '');
          console.log(`✅ [HomePage] Found header button: "${(btnText || '').trim()}" href=${href}`);

          if (href && (href.includes('signup') || href.includes('subscribe') || href.startsWith('/'))) {
            const fullUrl = href.startsWith('http') ? href : new URL(href, beforeUrl).toString();
            console.log(`🔗 [HomePage] Navigating via header button href: ${fullUrl}`);
            await this.page.goto(fullUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
            console.log(`✅ [HomePage] Navigated to: ${this.page.url()}`);
            return;
          }

          // Normal click with navigation wait
          try {
            await Promise.all([
              this.page.waitForURL((url: URL) => url.toString() !== beforeUrl, { timeout: 8000 }),
              btn.click({ timeout: 5000 }),
            ]);
            console.log(`✅ [HomePage] Header button navigated to: ${this.page.url()}`);
            return;
          } catch {
            console.log('⚠️ [HomePage] Header button click did not navigate');
          }
        }
      }

      // Last resort: directly navigate to signup
      console.log('⚠️ [HomePage] All click approaches failed — navigating directly to signup...');
      const baseMatch = beforeUrl.match(/(https:\/\/[a-z0-9.-]*dazn\.com\/en-[A-Z]+)/i);
      if (baseMatch) {
        await this.page.goto(`${baseMatch[1]}/signup`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        console.log(`✅ [HomePage] Direct navigation to: ${this.page.url()}`);
      }

      return;
    }

    if (src === 'home-page-dazntile') {
      console.log('🖱️ [HomePage] Clicking entitlement-based rail tile...');
      if (!container) throw new Error('❌ [HomePage] Entitlement tile container is null');
      await container.scrollIntoViewIfNeeded().catch(() => {});
      await this.page.waitForTimeout(300);
      try {
        await container.click({ force: true, timeout: 10000 });
      } catch {
        // Fallback: JS click bypasses viewport / aria-hidden restrictions
        await container.evaluate((el: HTMLElement) => el.click()).catch(() => {});
      }
      console.log('✅ [HomePage] Clicked entitlement-based rail tile');
      return;
    }

    await super.clickBuyNow(container, source);
  }

  // ═══════════════════════════════════════════════════════════════
  // ENTITLEMENT-BASED TILE FINDING (Rails API Interception)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Navigate to /home while intercepting all rails API responses.
   * Use this when you need to find tiles by their EntitlementIds from the API.
   *
   * @param baseUrl - Base URL (e.g., 'https://stag.dazn.com/en-GB')
   * @returns RailsInterceptor instance with captured data
   *
   * @example
   * ```ts
   * const homePage = new HomePage(page);
   * const interceptor = await homePage.navigateWithRailsCapture('https://stag.dazn.com/en-GB');
   * const ppvTiles = interceptor.findTilesByEntitlement(['base_dazn_content']);
   * // or find tiles that are NOT base content (i.e., PPV tiles)
   * const ppvOnly = interceptor.findTilesExcludingEntitlement(['base_dazn_content']);
   * ```
   */
  async navigateWithRailsCapture(baseUrl: string): Promise<RailsInterceptor> {
    const targetUrl = `${baseUrl}/home`;
    console.log(`🌍 [HomePage] Navigating to ${targetUrl} with rails interception...`);

    const interceptor = new RailsInterceptor(this.page);

    await interceptor.captureAllRailsResponses(async () => {
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
      // Dismiss cookie banner before scrolling so lazy-rail intersection observers fire correctly
      if (!isCookieSdkBlocked()) {
        await dismissCookieBanner(this.page, true);
      }
    }, 30000);

    console.log(`✅ [HomePage] Page loaded with rails captured: ${this.page.url()}`);
    return interceptor;
  }

  /**
   * [PRIVATE] Resolves the DOM locator for a tile matching the given entitlement IDs.
   *
   * Reads entitlements from `eventData.ENTITLEMENT_IDS` (comma-separated string)
   * or defaults to `['base_dazn_content']` if not set.
   *
   * Called by `findPPVContainer()` for the `home-page-dazntile` source.
   * Requires `navigate()` to have been called first (which populates `this._railsInterceptor`).
   */
  private async findTileLocatorByEntitlement(eventData: Record<string, string>): Promise<any> {
    // Parse target entitlements — check eventData first, then env var, then default
    const rawEntitlements =
      eventData?.ENTITLEMENT_IDS ||
      eventData?.RAIL_ENTITLEMENT ||
      process.env.ENTITLEMENT_IDS ||
      '';
    const entitlements: string[] = rawEntitlements
      ? rawEntitlements.split(',').map((e: string) => e.trim()).filter(Boolean)
      : ['base_dazn_content'];

    const interceptor = this._railsInterceptor;
    if (!interceptor) {
      throw new Error(
        '❌ [HomePage] Rails interceptor not initialised. ' +
        'Make sure navigate() was called with source="home-page-dazntile".'
      );
    }

    interceptor.printRailsSummary();

    const matches = interceptor.findTilesByEntitlement(entitlements);
    if (matches.length === 0) {
      throw new Error(
        `❌ [HomePage] No tiles found with EntitlementIds [${entitlements.join(', ')}]. ` +
        `Total rails captured: ${interceptor.getAllRails().length}. ` +
        `Run tests/examples/debug-rails-response.spec.ts to inspect actual entitlement values.`
      );
    }

    // Try each matching tile until one is found in the DOM.
    // IMPORTANT: never fall back to a non-matching tile — the whole point is
    // to click a tile that HAS the target entitlement.
    console.log(`🎯 [HomePage] ${matches.length} tile(s) match [${entitlements.join(', ')}] — scanning DOM for first visible`);

    // Build all clean IDs up-front for a fast multi-ID scan
    const cleanIds = matches
      .map(m => m.tileId.replace(/^(List:|Tile:|Asset:|Content:|Episode:|Series:|Video:|Article:|ArticleId:)/i, ''))
      .filter(Boolean);

    // ── Quick scan: try each tile title immediately (no scrolling at all) ──────
    // Tiles at tileIndex=0 in visible rails (e.g. "Don't Miss") are often already
    // rendered in the viewport. Check all matches first before doing any scrolling.
    for (const match of matches) {
      if (!match.tileTitle) continue;
      const titleEsc = match.tileTitle.replace(/'/g, "\\'");
      const candidates = [
        this.page.locator(`a:has-text("${titleEsc}")`).first(),
        this.page.locator(`img[alt*="${titleEsc}" i]`).locator('xpath=ancestor::a[1]'),
      ];
      for (const loc of candidates) {
        if (await loc.isVisible().catch(() => false)) {
          console.log(`✅ [HomePage] Quick scan: clicked "${match.tileTitle}" immediately (no scroll)`);
          return loc;
        }
      }
    }

    // Scroll back to top
    await this.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
    await this.page.waitForTimeout(200);

    // Pass 1: JS DOM scan + incremental scroll (checks ALL non-hidden <a href> — not just visible)
    // DAZN carousel tiles may be in DOM but off-screen (swiper off position) → isVisible() fails.
    // Limit to 5 scroll steps (~3000px) to avoid scrolling to bottom of page.
    for (let step = 0; step <= 5; step++) {
      if (step > 0) {
        await this.page.evaluate((pos: number) => window.scrollTo({ top: pos, behavior: 'instant' }), step * 600).catch(() => {});
        await this.page.waitForTimeout(200);
      }
      const foundId = await this.page.evaluate((ids: string[]) => {
        const links = document.querySelectorAll<HTMLAnchorElement>(
          'a[href]:not([aria-hidden="true"]):not([tabindex="-1"])'
        );
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          for (const id of ids) {
            if (id && href.includes(id)) return id;
          }
        }
        return null;
      }, cleanIds).catch(() => null);

      if (foundId) {
        const matchInfo = matches.find(m => m.tileId.includes(foundId));
        console.log(`✅ [HomePage] Tile found via JS DOM scan (step ${step}): "${matchInfo?.tileTitle}" (cleanId="${foundId}")`);
        const tile = this.page.locator(`a[href*="${foundId}"]:not([aria-hidden="true"]):not([tabindex="-1"])`).first();
        await tile.scrollIntoViewIfNeeded().catch(() => {});
        await this.page.waitForTimeout(300);
        return tile;
      }
    }

    // Pass 2: try each match by title in its rail (with carousel swipe)
    await this.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
    await this.page.waitForTimeout(200);

    for (const match of matches) {
      const locator = await this.tryFindTileInRail(match);
      if (locator) return locator;
    }

    throw new Error(
      `❌ [HomePage] No matching tile found in DOM for entitlements [${entitlements.join(', ')}]. ` +
      `Tried ${matches.length} API matches across ${15} scroll steps. Total rails: ${interceptor.getAllRails().length}.`
    );
  }

  /**
   * [PRIVATE] Scrolls through the page to locate a tile in the DOM using RailTileMatch data
   * from the rails API response, and returns its Playwright locator (without clicking).
   *
   * Strategy 0: find link by tileId in href (most reliable — unique content ID).
   * Strategy 1: find the rail by heading text → locate tile by matching title text within rail.
   * Strategy 2: fallback to finding tile by title text anywhere on the page.
   */
  private async findTileDOMLocator(match: RailTileMatch): Promise<any> {
    console.log(`🔍 [HomePage] Locating DOM tile: rail="${match.railTitle}", tile="${match.tileTitle}", id="${match.tileId}", idx=${match.tileIndex}`);

    // Scroll back to top first — captureAllRailsResponses leaves page scrolled to bottom
    await this.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
    await this.page.waitForTimeout(500);

    // ── Strategy 0: Find link by tileId in href ───────────────────────────────
    // DAZN API tileIds look like "List:cni81xb2km491e47norzjw52v" or "Asset:xyz".
    // DAZN hrefs look like /en-GB/home/ArticleId:cni81xb2km491e47norzjw52v/cni81xb2km491e47norzjw52v
    // Strip any known prefix so the bare content ID can match the href.
    if (match.tileId) {
      const cleanId = match.tileId.replace(/^(List:|Tile:|Asset:|Content:|Episode:|Series:|Video:|Article:|ArticleId:)/i, '');
      console.log(`🔑 [HomePage] Searching by cleanId="${cleanId}" (raw="${match.tileId}")`);

      if (cleanId) {
        const byId = this.page.locator(`a[href*="${cleanId}"]`).first();
        // Scroll incrementally to expose lazy-loaded tiles
        for (let s = 0; s < 15; s++) {
          if (await byId.isVisible().catch(() => false)) {
            console.log(`✅ [HomePage] Tile found by href cleanId="${cleanId}"`);
            return byId;
          }
          await this.page.evaluate((pos: number) => window.scrollTo({ top: pos, behavior: 'instant' }), (s + 1) * 600).catch(() => {});
          await this.page.waitForTimeout(300);
        }
        // Scroll back to top for Strategy 1
        await this.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
        await this.page.waitForTimeout(400);
      }
    }

    // ── Strategy 1: Rail heading → find tile by title text within rail ────────
    if (match.railTitle) {
      const railHeading = this.page.getByText(new RegExp(this.escapeRegexStr(match.railTitle), 'i')).first();

      // Scroll down to find the rail heading
      for (let s = 0; s < 20; s++) {
        if (await railHeading.isVisible().catch(() => false)) break;
        await this.page.evaluate((pos: number) => window.scrollTo({ top: pos, behavior: 'instant' }), (s + 1) * 600).catch(() => {});
        await this.page.waitForTimeout(300);
      }

      if (await railHeading.isVisible().catch(() => false)) {
        await railHeading.scrollIntoViewIfNeeded().catch(() => {});
        await this.page.waitForTimeout(400);
        console.log(`✅ [HomePage] Rail heading found: "${match.railTitle}"`);

        const railWrapper = railHeading.locator(
          'xpath=ancestor::section[1] | ancestor::div[contains(@class,"rail")][1] | ancestor::*[contains(@class,"rail__rail-wrapper")][1]'
        );

        if (await railWrapper.count() > 0) {
          await railWrapper.hover({ force: true }).catch(() => {});

          // Find tile by its title text within the rail (NOT by index)
          if (match.tileTitle) {
            const titleEscaped = match.tileTitle.replace(/'/g, "\\'");
            const tileByTitle = railWrapper.locator(`a:has-text("${titleEscaped}")`).first();
            let titleFound = await tileByTitle.isVisible().catch(() => false);

            if (!titleFound) {
              // Try swiping through the rail to expose the tile
              const nextBtn = railWrapper.locator(
                'button[aria-label="Next slide"], button[class*="swiper-button-next"], [class*="next" i]'
              ).first();
              for (let swipe = 0; swipe < 15; swipe++) {
                titleFound = await tileByTitle.isVisible().catch(() => false);
                if (titleFound) break;
                const disabled = await nextBtn.evaluate((el: Element) =>
                  el.classList.contains('swiper-button-disabled') || el.hasAttribute('disabled')
                ).catch(() => true);
                if (disabled) break;
                await nextBtn.click({ force: true }).catch(() => {});
                await this.page.waitForTimeout(300);
              }
            }

            if (titleFound) {
              console.log(`✅ [HomePage] Tile found by title in rail "${match.railTitle}": "${match.tileTitle}"`);
              return tileByTitle;
            }
          }

          // Fall back to first visible, non-hidden tile in rail
          // Exclude aria-hidden="true" and tabindex="-1" which are swiper duplicate/clone slides
          const tileLinks = railWrapper.locator(
            'a[class*="tile" i]:not([aria-hidden="true"]):not([tabindex="-1"]), ' +
            'a[href]:not([href=""]):not([aria-hidden="true"]):not([tabindex="-1"])'
          );
          const tileCount = await tileLinks.count().catch(() => 0);
          for (let i = 0; i < tileCount; i++) {
            const tile = tileLinks.nth(i);
            const visible = await tile.isVisible().catch(() => false);
            if (visible) {
              const tileText = await tile.textContent().catch(() => '');
              console.log(`⚠️ [HomePage] Using first visible non-hidden tile in rail "${match.railTitle}": "${(tileText || '').trim().substring(0, 50)}" (title match failed)`);
              return tile;
            }
          }
        }
      }

      // Scroll back to top for Strategy 2
      await this.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
      await this.page.waitForTimeout(300);
    }

    // ── Strategy 2: Tile title text search anywhere on page ───────────────────
    if (match.tileTitle) {
      for (let s = 0; s < 20; s++) {
        const tile = this.page.locator(`a:has-text("${match.tileTitle}")`).first();
        if (await tile.isVisible().catch(() => false)) {
          console.log(`✅ [HomePage] Tile found by title text on page: "${match.tileTitle}"`);
          return tile;
        }
        await this.page.evaluate((pos: number) => window.scrollTo({ top: pos, behavior: 'instant' }), (s + 1) * 600).catch(() => {});
        await this.page.waitForTimeout(300);
      }
    }

    throw new Error(
      `❌ [HomePage] Could not locate DOM tile for rail="${match.railTitle}", tile="${match.tileTitle}", id="${match.tileId}". ` +
      `The tile may not be visible or the content ID is not present in any link href on the page.`
    );
  }

  /**
   * Find and click a tile on the home page based on its entitlement ID from the rails API.
   *
   * This method:
   * 1. Navigates to /home while intercepting rails API responses
   * 2. Parses the response to find tiles matching the target entitlement
   * 3. Scrolls to the correct rail and clicks the matching tile
   *
   * @param baseUrl - Base URL (e.g., 'https://stag.dazn.com/en-GB')
   * @param targetEntitlements - Array of entitlement IDs to look for (e.g., ['base_dazn_content'])
   * @param options - Configuration options
   * @returns The clicked tile's info or throws if not found
   *
   * @example
   * ```ts
   * const homePage = new HomePage(page);
   * // Find and click a tile that has "base_dazn_content" entitlement
   * const tileInfo = await homePage.findAndClickTileByEntitlement(
   *   'https://stag.dazn.com/en-GB',
   *   ['base_dazn_content']
   * );
   *
   * // Find PPV tiles (tiles NOT having base_dazn_content)
   * const ppvTileInfo = await homePage.findAndClickTileByEntitlement(
   *   'https://stag.dazn.com/en-GB',
   *   ['base_dazn_content'],
   *   { excludeMode: true }
   * );
   * ```
   */
  async findAndClickTileByEntitlement(
    baseUrl: string,
    targetEntitlements: string[],
    options: {
      excludeMode?: boolean;
      tileIndex?: number;
      railTitlePattern?: RegExp;
      printSummary?: boolean;
    } = {}
  ): Promise<RailTileMatch> {
    const { excludeMode = false, tileIndex = 0, railTitlePattern, printSummary = true } = options;

    // Step 1: Navigate with rails capture
    const interceptor = await this.navigateWithRailsCapture(baseUrl);

    if (printSummary) {
      interceptor.printRailsSummary();
    }

    // Step 2: Find matching tiles
    let matches: RailTileMatch[];
    if (excludeMode) {
      matches = interceptor.findTilesExcludingEntitlement(targetEntitlements);
    } else {
      matches = interceptor.findTilesByEntitlement(targetEntitlements);
    }

    // Step 3: Filter by rail title pattern if provided
    if (railTitlePattern && matches.length > 0) {
      const filtered = matches.filter(m => railTitlePattern.test(m.railTitle));
      if (filtered.length > 0) {
        matches = filtered;
        console.log(`🔍 [HomePage] Filtered to ${matches.length} tiles matching rail pattern: ${railTitlePattern}`);
      }
    }

    if (matches.length === 0) {
      const mode = excludeMode ? 'excluding' : 'matching';
      throw new Error(
        `❌ [HomePage] No tiles found ${mode} entitlements: [${targetEntitlements.join(', ')}]. ` +
        `Total rails captured: ${interceptor.getAllRails().length}`
      );
    }

    // Step 4: Select the target tile
    const selectedIdx = Math.min(tileIndex, matches.length - 1);
    const targetTile = matches[selectedIdx];
    console.log(`🎯 [HomePage] Selected tile: "${targetTile.tileTitle}" in rail "${targetTile.railTitle}" (index ${selectedIdx}/${matches.length})`);

    // Step 5: Scroll to the rail and click the tile
    await this.scrollToRailAndClickTile(targetTile);

    return targetTile;
  }

  /**
   * Scroll to a specific rail on the page and click a tile by its position.
   * Uses multiple strategies to locate the rail and tile.
   */
  private async scrollToRailAndClickTile(match: RailTileMatch): Promise<void> {
    console.log(`📜 [HomePage] Scrolling to rail "${match.railTitle}" to click tile at index ${match.tileIndex}...`);

    // Strategy 1: Find the rail by its heading text
    const railHeading = this.page.getByText(new RegExp(this.escapeRegexStr(match.railTitle), 'i')).first();

    // Scroll down to find the rail heading
    let headingFound = false;
    for (let scroll = 0; scroll < 15; scroll++) {
      if (await railHeading.isVisible().catch(() => false)) {
        headingFound = true;
        break;
      }
      await this.page.evaluate((pos) => {
        window.scrollTo({ top: pos, behavior: 'instant' });
      }, (scroll + 1) * 600).catch(() => {});
      await this.page.waitForTimeout(300);
    }

    if (headingFound) {
      await railHeading.scrollIntoViewIfNeeded().catch(() => {});
      await this.page.waitForTimeout(500);
      console.log(`✅ [HomePage] Found rail heading: "${match.railTitle}"`);

      // Get rail wrapper
      const railWrapper = railHeading.locator(
        'xpath=ancestor::section[1] | ancestor::div[contains(@class,"rail")][1] | ancestor::*[contains(@class,"rail__rail-wrapper")][1] | ancestor::*[contains(@class,"railWrapper")][1]'
      );

      if (await railWrapper.count() > 0) {
        // Hover over rail to show navigation buttons
        await railWrapper.hover({ force: true }).catch(() => {});
        await this.page.waitForTimeout(200);

        // Get tiles in the rail
        const tileLinks = railWrapper.locator('a[class*="tile" i], a[href]:not([href=""]), div[class*="tile" i] a, div[class*="card" i] a');
        const tileCount = await tileLinks.count();
        console.log(`📊 [HomePage] Rail has ${tileCount} visible tile links`);

        if (match.tileIndex < tileCount) {
          // Tile might need swiping into view
          const targetTile = tileLinks.nth(match.tileIndex);
          const isVisible = await targetTile.isVisible().catch(() => false);

          if (!isVisible) {
            // Swipe right to bring tile into view
            const nextBtn = railWrapper.locator(
              'button[aria-label="Next slide"], button[class*="swiper-button-next"], [class*="next" i]'
            ).first();

            for (let click = 0; click < match.tileIndex + 3; click++) {
              const disabled = await nextBtn.evaluate((el: Element) =>
                el.classList.contains('swiper-button-disabled') || el.hasAttribute('disabled')
              ).catch(() => true);
              if (disabled) break;

              await nextBtn.click({ force: true }).catch(() => {});
              await this.page.waitForTimeout(300);

              if (await targetTile.isVisible().catch(() => false)) break;
            }
          }

          await targetTile.scrollIntoViewIfNeeded().catch(() => {});
          await this.page.waitForTimeout(200);
          await targetTile.click({ force: true });
          console.log(`✅ [HomePage] Clicked tile at index ${match.tileIndex} in rail "${match.railTitle}"`);
          return;
        }
      }
    }

    // Strategy 2: Find tile by its title text on the page
    if (match.tileTitle) {
      console.log(`🔍 [HomePage] Trying to find tile by title text: "${match.tileTitle}"`);

      // Scroll through page to find the tile
      for (let scroll = 0; scroll < 15; scroll++) {
        const tileByText = this.page.locator(`a:has-text("${match.tileTitle}")`).first();
        if (await tileByText.isVisible().catch(() => false)) {
          await tileByText.scrollIntoViewIfNeeded().catch(() => {});
          await this.page.waitForTimeout(200);
          await tileByText.click({ force: true });
          console.log(`✅ [HomePage] Clicked tile by title: "${match.tileTitle}"`);
          return;
        }
        await this.page.evaluate((pos) => {
          window.scrollTo({ top: pos, behavior: 'instant' });
        }, (scroll + 1) * 600).catch(() => {});
        await this.page.waitForTimeout(300);
      }
    }

    // Strategy 3: Find tile by image alt text
    if (match.tileTitle) {
      const imgTile = this.page.locator(`img[alt*="${match.tileTitle}" i]`).first();
      if (await imgTile.isVisible({ timeout: 3000 }).catch(() => false)) {
        const tileLink = imgTile.locator('xpath=ancestor::a[1]');
        if (await tileLink.count() > 0) {
          await tileLink.scrollIntoViewIfNeeded().catch(() => {});
          await this.page.waitForTimeout(200);
          await tileLink.click({ force: true });
          console.log(`✅ [HomePage] Clicked tile by image alt: "${match.tileTitle}"`);
          return;
        }
      }
    }

    throw new Error(`❌ [HomePage] Could not locate tile "${match.tileTitle}" (rail="${match.railTitle}", index=${match.tileIndex}) on the page`);
  }

  /**
   * [PRIVATE] Try to find a specific tile in its rail by title text.
   * Returns the locator if found, or null if not found (no fallback to wrong tiles).
   * Scrolls just enough to find the rail heading — does NOT scroll the full page.
   */
  private async tryFindTileInRail(match: RailTileMatch): Promise<any> {
    if (!match.railTitle && !match.tileTitle) return null;

    // Find rail heading — scroll up to 3 steps (1800px) only
    const railHeading = this.page.getByText(new RegExp(this.escapeRegexStr(match.railTitle), 'i')).first();
    for (let s = 0; s <= 3; s++) {
      if (await railHeading.isVisible().catch(() => false)) break;
      await this.page.evaluate((pos: number) => window.scrollTo({ top: pos, behavior: 'instant' }), s * 600).catch(() => {});
      await this.page.waitForTimeout(150);
    }

    if (!await railHeading.isVisible().catch(() => false)) {
      console.log(`⚠️ [HomePage] Rail heading "${match.railTitle}" not found in DOM`);
      return null;
    }

    await railHeading.scrollIntoViewIfNeeded().catch(() => {});
    await this.page.waitForTimeout(300);

    const railWrapper = railHeading.locator(
      'xpath=ancestor::section[1] | ancestor::div[contains(@class,"rail")][1] | ancestor::*[contains(@class,"rail__rail-wrapper")][1]'
    );
    if (await railWrapper.count() === 0) return null;

    await railWrapper.hover({ force: true }).catch(() => {});

    // Try to find tile — DAZN renders tiles as image tiles, so try multiple strategies
    if (match.tileTitle) {
      const title = match.tileTitle;
      const titleEscaped = title.replace(/'/g, "\\'");

      // Build locators using different strategies
      // Strategy A: text inside <a>  (works for text tiles)
      // Strategy B: img[alt] inside <a> (works for image tiles — DAZN's typical structure)
      const findTile = async (): Promise<any> => {
        const candidates = [
          railWrapper.locator(`a:has-text("${titleEscaped}")`).first(),
          railWrapper.locator(`a:has(img[alt*="${titleEscaped}"])`).first(),
          railWrapper.locator(`img[alt*="${titleEscaped}"]`).locator('xpath=ancestor::a[1]'),
        ];
        for (const loc of candidates) {
          if (await loc.isVisible().catch(() => false)) return loc;
        }
        return null;
      };

      let found = await findTile();
      if (found) {
        console.log(`✅ [HomePage] tryFindTileInRail: found "${title}" in "${match.railTitle}"`);
        return found;
      }

      // Swipe through the carousel (limited — avoid long horizontal scroll)
      const maxSwipes = Math.min(match.tileIndex + 2, 5);
      const nextBtn = railWrapper.locator(
        'button[aria-label="Next slide"], button[class*="swiper-button-next"], [class*="next" i]'
      ).first();
      for (let swipe = 0; swipe < maxSwipes; swipe++) {
        const disabled = await nextBtn.evaluate((el: Element) =>
          el.classList.contains('swiper-button-disabled') || el.hasAttribute('disabled')
        ).catch(() => true);
        if (disabled) break;
        await nextBtn.click({ force: true }).catch(() => {});
        await this.page.waitForTimeout(200);
        found = await findTile();
        if (found) {
          console.log(`✅ [HomePage] tryFindTileInRail: found "${title}" after ${swipe + 1} swipes`);
          return found;
        }
      }
    }

    // Title not found in this rail — return null (caller will try next match)
    console.log(`⚠️ [HomePage] tryFindTileInRail: tile "${match.tileTitle}" not found in rail "${match.railTitle}"`);
    return null;
  }

  private escapeRegexStr(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      await this.page.waitForURL(/myaccount/i, { timeout: 15000 });
      console.log(`✅ On My Account: ${this.page.url()}`);
    } catch {
      console.log('⚠️  URL did not change — navigating directly');
      await this.navigateDirectly();
    }
  }

  private getFallbackBaseUrl(): string {
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
    await this.page.waitForURL(/myaccount/i, { timeout: 15000 }).catch(() => { });
    await this.page.waitForLoadState('domcontentloaded').catch(() => { });
    console.log(`✅ On My Account: ${this.page.url()}`);
  }

  async dismissPopup(): Promise<void> {
    console.log('🔍 Checking for popups...');
    try {
      const dismissSelectors =
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
}