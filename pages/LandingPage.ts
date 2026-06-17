import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import selectors from '../config/selectors.json';

export class LandingPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ─────────────────────────────
  // NAVIGATE TO BASE URL
  // ─────────────────────────────
  async navigate(baseUrl: string, source?: string): Promise<void> {
    const url = `${baseUrl}/welcome`;
    console.log(`🌍 Navigating to: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
    await this.dismissConsentIfPresent();

    // Wait for the page structure (main content or banner or explore button) to render
    const pageLoadedIndicator = this.page.locator('main [class*="banner"], main .swiper, a:has-text("Buy now"), button:has-text("Buy now"), button:has-text("Explore"), a:has-text("Explore")').first();
    await pageLoadedIndicator.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });

    console.log(`✅ Landed on: ${this.page.url()}`);
  }

  // ─────────────────────────────
  // DISMISS CONSENT
  // ─────────────────────────────
  async dismissConsentIfPresent(): Promise<void> {
    await this.waitForConsentAndDismiss();
  }

  // ─────────────────────────────
  // FIND BANNER CAROUSEL CONTAINER (resilient selector)
  // ─────────────────────────────
  protected bannerCarousel(): import('@playwright/test').Locator {
    // Use specific selectors to find the hero banner carousel, excluding general rail swipers
    return this.page.locator([
      'main [class*="hero-banner" i]',
      'main [class*="heroBanner" i]',
      'main [class*="herobanner" i]',
      'main div.heroBannerSlider',
      'main [class*="bannersContainer" i]',
      'main [class*="hero-slider" i]',
      'main [class*="heroSlider" i]',
      'main [class*="hero" i] .swiper',
      'main [class*="banner" i] .swiper',
      '[class*="hero-banner" i]',
      '[class*="heroBanner" i]',
      '[class*="bannersContainer" i]',
    ].join(', ')).first();
  }

  // ─────────────────────────────
  // GET ALL BANNER SLIDES (resilient selector)
  // ─────────────────────────────
  protected bannerSlides(carousel?: import('@playwright/test').Locator): import('@playwright/test').Locator {
    const parent = carousel || this.bannerCarousel();
    return parent.locator('.swiper-slide:not(.swiper-slide-duplicate)');
  }

  // ─────────────────────────────
  // STOP CAROUSEL AUTO-SLIDE
  // ─────────────────────────────
  protected async stopCarouselAutoSlide(): Promise<void> {
    await this.page.evaluate(() => {
      try {
        const stopSwiper = (swiper: any) => {
          if (!swiper) return;
          swiper.autoplay?.stop();
          swiper.params.autoplay = false;
          swiper.params.loop = false;
          if (swiper.autoplay?.running) {
            swiper.autoplay.stop();
          }
        };
        const swiperEl = document.querySelector('.swiper') as any;
        if (swiperEl?.swiper) {
          stopSwiper(swiperEl.swiper);
        }
        const allSwipers = document.querySelectorAll('.swiper, [class*="swiper"]');
        allSwipers.forEach((el: any) => {
          if (el.swiper) {
            stopSwiper(el.swiper);
          }
        });
        if ((window as any).swiper) {
          stopSwiper((window as any).swiper);
        }
      } catch { }
    }).catch(() => { });
  }

  // ─────────────────────────────
  // MATCH PPV NAME (flexible, splits colons/hyphens)
  // ─────────────────────────────
  protected matchesPPVName(text: string, ppvName: string): boolean {
    if (!text || !ppvName) return false;
    const nameParts = ppvName.split(/[:\-–]/).map(p => p.trim()).filter(p => p.length > 3);
    const cleanStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const cleanText = cleanStr(text);
    return nameParts.some(part => {
      const words = cleanStr(part).split(/\s+/).filter(Boolean);
      if (words.length === 0) return false;
      return words.every(w => cleanText.includes(w));
    });
  }

  /**
   * Score how closely a tile text matches the PPV name.
   * Higher score = better match. 0 = no match.
   * Exact match (tile text equals PPV name) scores highest.
   * Partial match (PPV name words found in longer text) scores lower.
   */
  protected scorePPVMatch(tileText: string, ppvName: string): number {
    if (!tileText || !ppvName) return 0;
    const cleanStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const cleanTile = cleanStr(tileText);
    const cleanName = cleanStr(ppvName);

    // Exact match (after normalization) — highest score
    if (cleanTile === cleanName) return 100;

    // Check if all words of PPV name are in tile text
    const nameWords = cleanName.split(/\s+/).filter(Boolean);
    const allWordsMatch = nameWords.every(w => cleanTile.includes(w));
    if (!allWordsMatch) return 0;

    // Score inversely by how much extra text the tile has
    // "GLORY COLLISION 9" (18 chars) matching "Glory Collision 9: Prelims" (26 chars)
    // vs matching "GLORY COLLISION 9" (18 chars) — latter scores higher
    const ratio = cleanName.length / cleanTile.length;
    return Math.round(ratio * 90); // Max 90 for partial match, 100 for exact
  }

  // ─────────────────────────────
  // FIND PPV IN BANNER (carousel) — with resilient selectors
  // ─────────────────────────────
  async findPPVInBanner(eventData: Record<string, string>): Promise<any> {
    const ppvName = eventData.PPV_NAME || '';
    console.log(`🔍 [Banner] Finding PPV: ${ppvName}`);

    // Stop auto-slide
    await this.stopCarouselAutoSlide();

    // Check if carousel exists (wait for it to become visible)
    const carousel = this.bannerCarousel();
    if (!await carousel.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)) {
      console.log('⚠️  [Banner] No banner carousel found on page');
      return null;
    }

    // Check active slide first — try selectors.json path, then fallback to carousel content
    const activeSlide = carousel.locator(selectors.banner.activeSlide).locator(':visible').first();
    let activeText = '';
    const isActiveVisible = await activeSlide.isVisible({ timeout: 1000 }).catch(() => false);
    if (isActiveVisible) {
      activeText = (await activeSlide.textContent().catch(() => ''))?.trim() || '';
      if (activeText && this.matchesPPVName(activeText, ppvName)) {
        console.log(`✅ [Banner] PPV already on active slide`);
        return activeSlide;
      }
      console.log(`ℹ️  Active slide: "${activeText.substring(0, 50)}..." — not our PPV`);
    } else {
      // If active slide locator is not visible, check if we have any swiper slides
      const slides = this.bannerSlides(carousel);
      const slideCount = await slides.count().catch(() => 0);
      if (slideCount === 0) {
        console.log('🔍 [Banner] No swiper slides found. Checking static banner container content...');
        const containerText = await carousel.textContent().catch(() => '');
        if (containerText && this.matchesPPVName(containerText, ppvName)) {
          console.log('✅ [Banner] PPV found on static banner container');
          return carousel;
        }
        console.log('⚠️ [Banner] PPV not found on static banner');
        return null;
      }
    }

    // Navigate carousel using "Buy now" + CheVRON buttons
    try {
      const nextBtnSelectors = [
        selectors.banner.nextButton,
        '.swiper-button-next',
        '[class*="swiper-button-next"]',
        'button[data-test-id="CHEVRON_RIGHT_ICON"]',
        'svg[data-test-id="CHEVRON_RIGHT_ICON"]',
        '[aria-label="Next slide"]',
        'button[aria-label*="next" i]',
        'button[class*="swiper-next" i]',
        'button[class*="chevron" i]',
      ].filter(Boolean).join(', ');

      const nextBtn = carousel.locator(nextBtnSelectors).first();
      let firstSlideText = '';

      for (let attempt = 0; attempt < 6; attempt++) {
        await this.stopCarouselAutoSlide();

        let currentText = '';
        const current = carousel.locator(selectors.banner.activeSlide).locator(':visible').first();

        if (await current.isVisible({ timeout: 1000 }).catch(() => false)) {
          currentText = (await current.textContent().catch(() => ''))?.trim() || '';
        } else {
          // Fallback: re-read carousel text
          currentText = (await carousel.innerText().catch(() => ''))?.trim() || '';
        }

        if (currentText && this.matchesPPVName(currentText, ppvName)) {
          console.log(`✅ [Banner] PPV found after ${attempt} clicks`);
          await this.stopCarouselAutoSlide();
          await this.page.waitForTimeout(200);
          await this.stopCarouselAutoSlide();
          return current;
        }

        // Loop detection
        if (attempt === 0) {
          firstSlideText = currentText.substring(0, 100);
        } else if (attempt > 2 && currentText.substring(0, 100) === firstSlideText) {
          console.log('🔁 [Banner] Carousel looped — PPV not found');
          break;
        }

        console.log(`  slide ${attempt + 1}: "${currentText.substring(0, 50)}..." — clicking next`);

        const prevText = currentText;
        if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await nextBtn.click({ force: true }).catch(() => { });

          // Wait up to 3 seconds for slide text to change
          await this.page.waitForFunction((args) => {
            const activeEl = document.querySelector(args.activeSelector);
            const text = activeEl?.textContent?.trim() || '';
            return text !== args.prevText;
          }, { activeSelector: selectors.banner.activeSlide, prevText }, { timeout: 3000 }).catch(() => { });

          await this.page.waitForTimeout(800); // Wait a brief moment for swiper to fully settle
          await this.stopCarouselAutoSlide();
        } else {
          // Try clicking carousel area to trigger slide change
          console.log('⚠️  Next button not visible — trying carousel click');
          await carousel.click({ force: true }).catch(() => { });

          await this.page.waitForFunction((args) => {
            const activeEl = document.querySelector(args.activeSelector);
            const text = activeEl?.textContent?.trim() || '';
            return text !== args.prevText;
          }, { activeSelector: selectors.banner.activeSlide, prevText }, { timeout: 3000 }).catch(() => { });

          await this.page.waitForTimeout(800);
          await this.stopCarouselAutoSlide();

          if (attempt > 3) {
            console.log('⚠️  [Banner] Cannot navigate carousel — giving up');
            break;
          }
        }
      }
    } catch (e) {
      console.log(`⚠️ [Banner] Carousel navigation failed: ${(e as Error).message}`);
    }

    // Check all slides directly using the resilient selector
    console.log('🔍 [Banner] Checking all slides (resilient selector)...');
    const allSlides = this.bannerSlides(carousel);
    const slideCount = await allSlides.count().catch(() => 0);

    for (let i = 0; i < slideCount; i++) {
      const slide = allSlides.nth(i);
      if (!await slide.isVisible().catch(() => false)) continue;
      const text = (await slide.textContent().catch(() => ''))?.trim() || '';
      if (text && this.matchesPPVName(text, ppvName)) {
        console.log(`✅ [Banner] PPV found in slide ${i} — navigating`);
        await this.page.evaluate((index) => {
          const swiperEl = document.querySelector('.swiper') as any;
          if (swiperEl?.swiper) {
            swiperEl.swiper.autoplay?.stop();
            if (swiperEl.swiper.params.loop && typeof swiperEl.swiper.slideToLoop === 'function') {
              swiperEl.swiper.slideToLoop(index);
            } else {
              swiperEl.swiper.slideTo(index);
            }
          }
        }, i).catch(() => { });

        await this.page.waitForTimeout(500);
        await this.stopCarouselAutoSlide();
        await this.page.waitForTimeout(200);
        await this.stopCarouselAutoSlide();
        return slide;
      }
    }

    console.log('⚠️  [Banner] PPV not found in carousel');
    return null;
  }

  // ─────────────────────────────
  // FIND PPV IN "DON'T MISS LIVE" TILE SECTION
  // ─────────────────────────────
  async findPPVInTileSection(eventData: Record<string, string>): Promise<any> {
    const ppvName = eventData.PPV_NAME || '';
    console.log(`🔍 [Tile] Finding PPV in "Don't miss" section: ${ppvName}`);

    // Build multiple name parts for verification
    const nameParts = ppvName.split(/[:\-–]/).map(p => p.trim()).filter(p => p.length > 3);
    const cleanStr = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

    // Extract fighter names for image alt-text matching (e.g., "Fury vs. Hall")
    const vsMatch = ppvName.match(/(\w+)\s+vs\.?\s+(\w+)/i);
    const fighter1 = vsMatch ? vsMatch[1] : '';
    const fighter2 = vsMatch ? vsMatch[2] : '';
    if (fighter1) console.log(`🔍 [Tile] Fighter names: "${fighter1}" vs "${fighter2}"`);

    const isBannerElement = async (locator: any): Promise<boolean> => {
      return locator.evaluate((node: HTMLElement) => {
        const rect = node.getBoundingClientRect();
        const pageY = rect.top + window.scrollY;
        if (pageY > 0 && pageY < 750) return true;

        let parent = node.parentElement;
        for (let i = 0; i < 15; i++) {
          if (!parent) break;
          const cls = parent.className || '';
          const clsLower = typeof cls === 'string' ? cls.toLowerCase() : '';
          if (clsLower.includes('hero') || (clsLower.includes('banner') && !clsLower.includes('rail'))) {
            return true;
          }
          parent = parent.parentElement;
        }
        return false;
      }).catch(() => false);
    };

    const matchesPPV = (text: string): boolean => {
      return this.matchesPPVName(text, ppvName);
    };

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 1: Scroll to "Don't Miss" heading and locate the rail wrapper
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📜 [Tile] Scrolling down to find "Don\'t miss" section...');
    await this.page.evaluate(() => {
      window.scrollTo({ top: 1200, behavior: 'instant' });
    }).catch(() => { });
    await this.page.waitForTimeout(800);

    const railHeadingLocator = this.page.getByText(/don.t miss/i);
    let railHeadingCount = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      railHeadingCount = await railHeadingLocator.count().catch(() => 0);
      if (railHeadingCount > 0) break;
      await this.page.evaluate(() => {
        window.scrollTo({ top: 2500 + Math.random() * 500, behavior: 'instant' });
      }).catch(() => { });
      await this.page.waitForTimeout(600);
    }

    try {
      await railHeadingLocator.first().waitFor({ state: 'attached', timeout: 8000 });
    } catch (e) {
      throw new Error(`❌ [Tile] "Don't Miss" rail heading not attached/found in DOM after timeout for event: "${ppvName}"`);
    }

    railHeadingCount = await railHeadingLocator.count().catch(() => 0);
    if (railHeadingCount === 0) {
      throw new Error(`❌ [Tile] "Don't Miss" rail heading count is 0 in DOM for event: "${ppvName}"`);
    }
    const railHeading = railHeadingLocator.first();
    await railHeading.scrollIntoViewIfNeeded().catch(() => { });
    console.log('✅ [Tile] "Don\'t miss" heading found');

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 2: Get the rail wrapper container and swiper next button
    // ─────────────────────────────────────────────────────────────────────────
    // Try both class patterns: "railWrapper" (welcome page) and "rail__rail-wrapper" (boxing page)
    let railWrapper = railHeading.locator('xpath=ancestor::*[contains(@class,"railWrapper")][1]');
    let hasWrapper = await railWrapper.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasWrapper) {
      railWrapper = railHeading.locator('xpath=ancestor::*[contains(@class,"rail__rail-wrapper")][1]');
      hasWrapper = await railWrapper.isVisible({ timeout: 3000 }).catch(() => false);
    }
    if (!hasWrapper) {
      // Broad fallback: find nearest ancestor with "rail" in className
      railWrapper = railHeading.locator('xpath=ancestor::*[contains(@class,"rail")][1]');
      hasWrapper = await railWrapper.isVisible({ timeout: 2000 }).catch(() => false);
    }

    if (!hasWrapper) {
      throw new Error(`❌ [Tile] Rail wrapper container not found in DOM for "Don't Miss" section for event: "${ppvName}"`);
    }
    console.log('✅ [Tile] Rail wrapper container found');

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 2.5: Build image selector for PPV tile (same approach as BoxingHomePage)
    // ─────────────────────────────────────────────────────────────────────────
    // Build an exclusion selector to avoid matching ancillary content
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

    const textTileLocator = railWrapper.locator('.swiper-slide, [class*="tile" i], article, li').filter({
      hasText: fighter1 && fighter2 ? new RegExp(`${fighter1}|${fighter2}`, 'i') : ppvName
    }).first();

    // Helper: check if the PPV tile is currently in view (with retry for transient detachments)
    const isTileInView = async (): Promise<any> => {
      for (let retry = 0; retry < 2; retry++) {
        // Strategy A: Find by Text Content
        const candidates = railWrapper.locator('.swiper-slide, [class*="tile" i], article, li');
        const count = await candidates.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const el = candidates.nth(i);
          if (await el.isVisible().catch(() => false)) {
            const text = (await el.textContent().catch(() => '')) || '';
            const match = matchesPPV(text) ||
              (fighter1 && text.toLowerCase().includes(fighter1.toLowerCase())) ||
              (fighter2 && text.toLowerCase().includes(fighter2.toLowerCase()));
            
            if (match) {
              const inView = await el.evaluate((node: HTMLElement) => {
                const r = node.getBoundingClientRect();
                return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
              }).catch(() => false);
              
              if (inView) {
                const buyNowBtn = el.locator('button:has-text("Buy now"), button:has-text("Buy"), a:has-text("Buy now"), a:has-text("Buy")').first();
                if (await buyNowBtn.isVisible().catch(() => false)) {
                  console.log('✅ Found matching tile and its Buy Now button in view');
                  return buyNowBtn;
                }
                const anchor = el.locator('xpath=self::a | ancestor-or-self::a').first();
                if (await anchor.count().catch(() => 0) > 0) {
                  console.log('✅ Found matching tile anchor in view');
                  return anchor;
                }
                console.log('✅ Found matching tile element in view');
                return el;
              }
            }
          }
        }

        // Strategy B: Fallback to original image alt-text search
        const imgCount = await ppvImg.count().catch(() => 0);
        if (imgCount > 0) {
          const inView = await ppvImg.evaluate((el: HTMLElement) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.right > 0 && r.left < window.innerWidth;
          }).catch(() => false);
          if (inView) {
            console.log('✅ Found matching tile via image alt-text in view');
            return ppvTileLink;
          }
        }

        if (retry === 0) {
          await this.page.waitForTimeout(400);
          continue;
        }
      }
      return null;
    };

    // Find the next-slide button (support multiple selector patterns across landing page variants)
    const nextBtn = railWrapper.locator([
      'button[aria-label="Next slide"]',
      'button[class*="swiper-button-next"]',
      '.custom-swiper-button-next',
      '[class*="next" i]',
    ].join(', ')).first();

    // Wait for swiper navigation to be attached
    await nextBtn.waitFor({ state: 'attached', timeout: 8000 }).catch(() => {
      console.log('⚠️  [Tile] Swiper next button not attached after 8s');
    });

    // Hover rail wrapper to make swiper arrows visible
    await railWrapper.hover({ force: true }).catch(() => { });
    await this.page.waitForTimeout(500);

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 3: Navigate the swiper rail — click > until PPV tile is found (same as BoxingHomePage)
    // ─────────────────────────────────────────────────────────────────────────
    let clicks = 0;
    const maxClicks = 30;
    let found = await isTileInView();

    while (!found && clicks < maxClicks) {
      if (this.page.isClosed()) throw new Error('Page closed during swiper navigation');

      await railWrapper.hover({ force: true }).catch(() => { });
      await this.page.waitForTimeout(200);

      // Check if next button is disabled (end of rail) — check all known disable class patterns
      const nextDisabled = await nextBtn.evaluate((el: Element) => {
        return el.classList.contains('swiper-button-disabled') ||
          el.classList.contains('rail-module__disable') ||
          el.className.includes('disable') ||
          el.hasAttribute('disabled');
      }).catch(() => false);

      if (nextDisabled) {
        console.log('⚠️  [Tile] Next button disabled — end of rail reached');
        break;
      }

      // Check if next button exists in DOM (retry once for transient detach during animation)
      let nextCount = await nextBtn.count().catch(() => 0);
      if (nextCount === 0) {
        await this.page.waitForTimeout(400);
        nextCount = await nextBtn.count().catch(() => 0);
        if (nextCount === 0) {
          console.log('⚠️  [Tile] Next button not found in DOM after retry');
          break;
        }
      }

      console.log(`  [Tile] Click ${clicks + 1}: advancing to next slide...`);
      await nextBtn.click({ timeout: 5000, force: true }).catch((e: any) => {
        console.log('⚠️  Next click error:', e.message);
      });
      clicks++;
      await this.page.waitForTimeout(800);
      found = await isTileInView();
    }

    console.log(`✅ [Tile] Swiper "Next" clicks performed: ${clicks}`);

    // Fallback: if tile exists in DOM but not in viewport, scroll it into view
    const hasTextTile = await textTileLocator.count().catch(() => 0) > 0;
    if (!found && (hasTextTile || (await ppvImg.count()) > 0)) {
      console.log('🔍 [Tile] Tile in DOM but not visible — scrolling into view');
      const scrollTarget = hasTextTile ? textTileLocator : ppvImg;
      await scrollTarget.scrollIntoViewIfNeeded().catch(() => { });
      await this.page.waitForTimeout(500);
      found = await isTileInView();
    }

    if (!found) {
      // Debug dump — show all images in rail for diagnostics
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
      throw new Error(`❌ [Tile] Could not find "${fighter1 || ppvName}" tile in "Don't Miss" rail after ${clicks} clicks`);
    }

    console.log(`✅ [Tile] Tile in view after ${clicks} next clicks`);
    await found.scrollIntoViewIfNeeded().catch(() => { });
    await found.hover().catch(() => { });
    await this.page.waitForTimeout(300);
    return found;
  }

  /**
   * Static fallback DOM search for findPPVInTileSection.
   * This is the original Strategy 2 + Strategy 3 logic, used as a last resort
   * when swiper navigation fails (e.g., no rail wrapper found, no next button).
   */
  private async _findPPVInTileSectionStaticFallback(
    eventData: Record<string, string>,
    nameParts: string[],
    cleanStr: (s: string) => string,
    matchesPPV: (text: string) => boolean,
    isBannerElement: (locator: any) => Promise<boolean>,
  ): Promise<any> {
    throw new Error(`❌ [Tile Fallback] Page-wide fallback is disabled. PPV tile for "${eventData.PPV_NAME}" was not found in the "Don't Miss" rail.`);
  }

  // ─────────────────────────────
  // FIND PPV IN WELCOME PAGE "DON'T MISS LIVE" SWIPER RAIL
  // ─────────────────────────────
  async findPPVInWelcomeRail(eventData: Record<string, string>): Promise<any> {
    const ppvDisplayName = eventData.PPV_DISPLAY_NAME || eventData.PPV_NAME || '';
    console.log(`🔍 [WelcomeRail] Finding PPV tile: "${ppvDisplayName}"`);

    const matchesTile = (text: string): boolean => {
      return this.matchesPPVName(text, ppvDisplayName);
    };

    // Scroll down to find "Don't miss live on DAZN" heading
    console.log('📍 [WelcomeRail] Scrolling to rail heading...');
    await this.page.evaluate(() => { window.scrollTo({ top: 1200, behavior: 'instant' }); }).catch(() => { });
    await this.page.waitForTimeout(800);

    const railHeading = this.page.getByText(/don.t miss live/i).first();
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await railHeading.count().catch(() => 0) > 0) break;
      await this.page.evaluate(() => {
        window.scrollTo({ top: 2500 + Math.random() * 500, behavior: 'instant' });
      }).catch(() => { });
      await this.page.waitForTimeout(600);
    }

    const headingFound = await railHeading.waitFor({ state: 'attached', timeout: 8000 })
      .then(() => true).catch(() => false);
    if (!headingFound) {
      console.log('⚠️ [WelcomeRail] "Don\'t miss live on DAZN" heading not found');
      return null;
    }
    await railHeading.scrollIntoViewIfNeeded().catch(() => { });
    console.log('✅ [WelcomeRail] Rail heading found');

    // Get rail wrapper container
    const railWrapper = railHeading.locator('xpath=ancestor::*[contains(@class,"railWrapper")][1]');
    const hasWrapper = await railWrapper.isVisible({ timeout: 3000 }).catch(() => false);
    const railContainer = hasWrapper ? railWrapper : this.page.locator('body');

    // Find next-slide button (welcome page uses div[class*="next"], not button[aria-label])
    const nextBtn = railContainer.locator('[class*="next" i]').first();

    let ppvTile: any = null;
    for (let click = 0; click < 20; click++) {
      // Hover to reveal navigation arrows
      await railContainer.hover().catch(() => { });
      await this.page.waitForTimeout(300);

      // Search for tile matching PPV name with "Buy now" CTA — score all and pick best
      const candidates = railContainer.locator('a, div[class*="tile" i], article, li');
      const count = await candidates.count().catch(() => 0);

      let bestScore = ppvTile ? this.scorePPVMatch(await ppvTile.textContent().catch(() => '') || '', ppvDisplayName) : 0;

      for (let i = 0; i < count; i++) {
        const el = candidates.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        const text = (await el.textContent().catch(() => '')) || '';
        const lower = text.toLowerCase();
        if (matchesTile(text) && (lower.includes('buy now') || lower.includes('buy'))) {
          const box = await el.boundingBox().catch(() => null);
          if (box && box.width > 50 && box.width < 700 && box.height > 50 && box.height < 600) {
            const score = this.scorePPVMatch(text, ppvDisplayName);
            if (score > bestScore) {
              bestScore = score;
              ppvTile = el;
              console.log(`🔍 [WelcomeRail] Candidate tile (score=${score}): "${text.replace(/\s+/g, ' ').substring(0, 100)}"`);
            }
          }
        }
      }
      if (ppvTile) break;

      // Click next slide
      if (await nextBtn.isVisible().catch(() => false)) {
        const disabled = await nextBtn.evaluate((el: Element) =>
          el.classList.contains('rail-module__disable') || el.className.includes('disable')
        ).catch(() => false);
        if (disabled) {
          console.log('⚠️ [WelcomeRail] Next button disabled — end of rail');
          break;
        }
        await nextBtn.click({ force: true }).catch(() => { });
        await this.page.waitForTimeout(800);
      } else {
        console.log('⚠️ [WelcomeRail] Next slide button not visible');
        break;
      }
    }

    if (!ppvTile) {
      console.log(`⚠️ [WelcomeRail] PPV tile "${ppvDisplayName}" not found in rail`);
    }
    return ppvTile;
  }

  async findPPVContainer(eventData: Record<string, string>, source?: string): Promise<any> {
    const src = (source || '').toLowerCase();

    if (src === 'welcome-rail') {
      return this.findPPVInWelcomeRail(eventData);
    }

    if (src.includes('banner')) {
      return this.findPPVInBanner(eventData);
    }

    if (src.includes('dont-miss') || src.includes('tile') || src.includes('upcoming')) {
      return this.findPPVInTileSection(eventData);
    }

    // Strict source validation — no cross-source fallback
    throw new Error(
      `❌ PPV not found in expected source: "${source || 'unknown'}". ` +
      `No fallback search will be attempted. Valid sources: landing-page-banner, landing-page-dont-miss-live, welcome-rail.`
    );
  }

  async clickBuyNow(container: any, source?: string): Promise<void> {
    if (!container) {
      throw new Error('❌ No PPV container found — cannot click Buy Now');
    }

    const src = (source || '').toLowerCase();
    console.log('💳 Clicking Buy Now via container...');

    await this.stopCarouselAutoSlide();
    await container.scrollIntoViewIfNeeded().catch(() => { });
    await this.page.waitForTimeout(200);

    let targetContainer = container;

    // Check if container is a swiper slide
    try {
      const isSwiperSlide = await container.evaluate((node: HTMLElement) => {
        return node.classList.contains('swiper-slide') || !!node.closest('.swiper-slide');
      }).catch(() => false);

      if (isSwiperSlide) {
        console.log('🔄 Container is a swiper slide — checking active slide in swiper...');

        const slideIndex = await container.evaluate((node: HTMLElement) => {
          const slideEl = node.classList.contains('swiper-slide') ? node : node.closest('.swiper-slide');
          if (!slideEl) return null;
          const slideIndexAttr = slideEl.getAttribute('data-swiper-slide-index');
          if (slideIndexAttr !== null && slideIndexAttr !== undefined) {
            return { type: 'loop', index: parseInt(slideIndexAttr, 10) };
          }
          const swiperEl = slideEl.parentElement?.closest('.swiper, [class*="swiper"]');
          const slides = Array.from(swiperEl?.querySelectorAll('.swiper-slide') || []);
          const idx = slides.indexOf(slideEl);
          return { type: 'normal', index: idx };
        }).catch(() => null);

        console.log(`ℹ️ Target slide info: ${JSON.stringify(slideIndex)}`);

        if (slideIndex !== null) {
          const swiperLocator = container.locator('xpath=ancestor-or-self::*[contains(@class, "swiper") or contains(@class, "Swiper")][1]');
          const swiperCount = await swiperLocator.count().catch(() => 0);
          const activeSlideLocator = (swiperCount > 0)
            ? swiperLocator.locator('.swiper-slide-active, [class*="swiper-slide-active"]').first()
            : this.page.locator('.swiper-slide-active, [class*="swiper-slide-active"]').first();
          let isActiveMatching = false;
          if (await activeSlideLocator.isVisible().catch(() => false)) {
            const activeInfo = await activeSlideLocator.evaluate((node: HTMLElement) => {
              const slideIndexAttr = node.getAttribute('data-swiper-slide-index');
              if (slideIndexAttr !== null && slideIndexAttr !== undefined) {
                return { type: 'loop', index: parseInt(slideIndexAttr, 10) };
              }
              const swiperEl = node.parentElement?.closest('.swiper, [class*="swiper"]');
              const slides = Array.from(swiperEl?.querySelectorAll('.swiper-slide') || []);
              const idx = slides.indexOf(node);
              return { type: 'normal', index: idx };
            }).catch(() => null);

            console.log(`ℹ️ Current active slide info: ${JSON.stringify(activeInfo)}`);
            if (activeInfo && activeInfo.type === slideIndex.type && activeInfo.index === slideIndex.index) {
              isActiveMatching = true;
              targetContainer = activeSlideLocator;
              console.log('✅ Active slide already matches target slide index');
            }
          }

          if (!isActiveMatching) {
            console.log('🔄 Active slide does not match target index — triggering slide navigation...');
            const handle = await container.elementHandle().catch(() => null);
            if (handle) {
              await this.page.evaluate((slideNode: any) => {
                if (!slideNode) return;
                const slideEl = slideNode.classList.contains('swiper-slide') ? slideNode : slideNode.closest('.swiper-slide');
                if (!slideEl) return;
                const swiperEl = slideEl.parentElement?.closest('.swiper, [class*="swiper"]');
                const swiper = (swiperEl as any)?.swiper;
                if (swiper) {
                  swiper.autoplay?.stop();
                  const slideIndexAttr = slideEl.getAttribute('data-swiper-slide-index');
                  if (slideIndexAttr !== null && slideIndexAttr !== undefined) {
                    swiper.slideToLoop(parseInt(slideIndexAttr, 10));
                  } else {
                    const slides = Array.from(swiperEl.querySelectorAll('.swiper-slide') || []);
                    const idx = slides.indexOf(slideEl);
                    if (idx !== -1) {
                      swiper.slideTo(idx);
                    }
                  }
                }
              }, handle);
              await this.page.waitForTimeout(1000); // Wait for transition animation

              // Verify active slide now matches
              if (await activeSlideLocator.isVisible().catch(() => false)) {
                const newActiveInfo = await activeSlideLocator.evaluate((node: HTMLElement) => {
                  const slideIndexAttr = node.getAttribute('data-swiper-slide-index');
                  if (slideIndexAttr !== null && slideIndexAttr !== undefined) {
                    return { type: 'loop', index: parseInt(slideIndexAttr, 10) };
                  }
                  const swiperEl = node.parentElement?.closest('.swiper, [class*="swiper"]');
                  const slides = Array.from(swiperEl?.querySelectorAll('.swiper-slide') || []);
                  const idx = slides.indexOf(node);
                  return { type: 'normal', index: idx };
                }).catch(() => null);
                if (newActiveInfo && newActiveInfo.type === slideIndex.type && newActiveInfo.index === slideIndex.index) {
                  targetContainer = activeSlideLocator;
                  console.log('✅ Navigated to matching active slide');
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.log(`⚠️ Slide activation/matching warning in clickBuyNow: ${(e as Error).message}`);
    }

    let containerText = (await targetContainer.textContent().catch(() => ''))?.trim() || '';
    console.log(`📋 Container preview: "${containerText.substring(0, 80)}"`);

    // Check if carousel rotated away (container is stale/invisible)
    const containerBox = await targetContainer.boundingBox().catch(() => null);
    if (containerText.length === 0 || (containerBox && containerBox.width === 0)) {
      console.log('⚠️  Container appears stale/rotated away — re-finding Buy Now on page');
      containerText = ''; // Force fallback path below
    }

    let buyNowBtn: any = null;

    if (containerText.length > 0) {
      // Normal path: container has content, find Buy Now inside it
      buyNowBtn = targetContainer
        .locator('a, button')
        .filter({ hasText: /buy now/i })
        .first();

      // Verify the button is findable
      const btnVisible = await buyNowBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (!btnVisible) {
        console.log('⚠️  Buy Now not visible inside container — checking container itself');
        // The container might BE the Buy Now link (e.g., <a> with "Buy now" text)
        if (/buy now/i.test(containerText)) {
          buyNowBtn = targetContainer;
        } else if (src.includes('banner') || src.includes('tile') || src.includes('dont-miss')) {
          // Strict: for banner/tile sources, do NOT fall back to clicking random buttons
          throw new Error(
            `❌ [${src.includes('banner') ? 'Banner' : 'Tile'}] "Buy Now" button not found inside PPV container. ` +
            `Container text: "${containerText.substring(0, 100)}". ` +
            `Will not click arbitrary buttons — the PPV may not have a Buy Now CTA in this source.`
          );
        } else {
          buyNowBtn = null; // Force fallback for other sources
        }
      }
    }

    // Fallback: container is empty/stale — search page-level for visible Buy Now
    if (!buyNowBtn || containerText.length === 0) {
      if (src.includes('tile') || src.includes('dont-miss')) {
        throw new Error(`❌ [Tile] Buy Now button not found or stale inside PPV tile container.`);
      }
      if (src.includes('banner')) {
        throw new Error(`❌ [Banner] Buy Now button not found or stale inside PPV banner container.`);
      }
      console.log('🔄 Container empty or Buy Now not found — falling back to page-level search');
      const pageBuyNow = this.page.locator('a:has-text("Buy now"), button:has-text("Buy now")');
      const count = await pageBuyNow.count().catch(() => 0);

      for (let i = 0; i < count; i++) {
        const btn = pageBuyNow.nth(i);
        if (!(await btn.isVisible().catch(() => false))) continue;

        // Exclude banner Buy Now buttons (hero section at top of page)
        const isBanner = await btn.evaluate((el: HTMLElement) => {
          const rect = el.getBoundingClientRect();
          const pageY = rect.top + window.scrollY;
          if (pageY > 0 && pageY < 750) return true;
          let parent = el.parentElement;
          for (let d = 0; d < 15; d++) {
            if (!parent) break;
            const cls = typeof parent.className === 'string' ? parent.className.toLowerCase() : '';
            if (cls.includes('hero') || (cls.includes('banner') && !cls.includes('rail'))) return true;
            parent = parent.parentElement;
          }
          return false;
        }).catch(() => false);

        if (isBanner && !src.includes('banner')) {
          console.log(`  [Fallback] Skipping banner Buy Now button ${i}`);
          continue;
        }

        buyNowBtn = btn;
        console.log(`✅ [Fallback] Found visible Buy Now button at index ${i}`);
        break;
      }
    }

    if (!buyNowBtn) {
      throw new Error('❌ Buy Now button not found — neither in container nor on page');
    }

    // Wait for Buy Now to be visible
    await buyNowBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
      await buyNowBtn.scrollIntoViewIfNeeded().catch(() => { });
      await this.page.waitForTimeout(500);
    });

    await this.stopCarouselAutoSlide();

    // Try boundingBox but don't fail hard — fall through to force click
    const box = await buyNowBtn.boundingBox({ timeout: 5000 }).catch(() => null);
    if (!box || box.width === 0 || box.height === 0) {
      console.log('⚠️  Buy Now has zero/null bounding box — attempting force click anyway');
    }

    const beforeUrl = this.page.url();

    try {
      await buyNowBtn.click({ force: true, timeout: 5000 });
    } catch {
      console.log('⚠️  Click intercepted → forcing JS click');
      const handle = await buyNowBtn.elementHandle().catch(() => null);
      if (handle) {
        await this.page.evaluate((el: any) => el.click(), handle);
      } else {
        // Last resort: for constrained sources, do NOT search entire page
        if (src.includes('banner') || src.includes('tile') || src.includes('dont-miss')) {
          throw new Error(`❌ [${src}] elementHandle failed — cannot click Buy Now. Will not search entire page.`);
        }
        console.log('⚠️  elementHandle failed — trying page.evaluate click');
        await this.page.evaluate(() => {
          const btns = document.querySelectorAll('a, button');
          for (const btn of btns) {
            if (/buy now/i.test(btn.textContent || '')) {
              const rect = btn.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0 && rect.top > 0) {
                (btn as HTMLElement).click();
                return;
              }
            }
          }
        }).catch(() => { });
      }
    }

    console.log(`✅ Clicked Buy Now`);
    await this.page.waitForLoadState('domcontentloaded').catch(() => { });

    const newUrl = this.page.url();
    console.log(`✅ Navigated to: ${newUrl}`);

    // Verify navigation
    if (newUrl !== beforeUrl && !newUrl.includes('ppv') &&
      !newUrl.includes('contextualPpv') && !newUrl.includes('signup')) {
      console.log(`⚠️  WARNING: Unexpected URL: ${newUrl}`);
    }
  }

  // ─────────────────────────────
  // GET EVENT DATE (from container)
  // ─────────────────────────────
  async getEventDate(container: any): Promise<string> {
    if (!container) return 'N/A';
    try {
      const allEls = container.locator('span, p, div, time');
      const count = await allEls.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const text = (await allEls.nth(i).textContent().catch(() => ''))?.trim() || '';
        if (/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(text) && text.length < 60) return text;
        if (/\d{1,2}(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text) && text.length < 60) return text;
        if (/this\s+evening/i.test(text) && text.length < 60) return text;
        if (/tonight/i.test(text) && text.length < 60) return text;
      }
    } catch { }
    return 'N/A';
  }
}