import { Page, BrowserContext } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// SLEEP
// ─────────────────────────────────────────────────────────────────
export const sleep = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));


// ─────────────────────────────────────────────────────────────────
// HANDLE COOKIES — dismiss cookie banner via UI click
// ── Called after every navigation. Dismisses cookie consent banner
//    by clicking the Accept button. Only runs once per BrowserContext.
// ─────────────────────────────────────────────────────────────────

const _dismissedContexts = new WeakSet<BrowserContext>();

export async function handleCookies(page: Page, timeout: number = 8000): Promise<void> {
  if (page.isClosed()) return;

  const context = page.context();

  // If already dismissed in this context, do a fast visible check first
  // and only proceed if the banner reappeared (e.g. on a new page/redirect)
  if (_dismissedContexts.has(context)) {
    const isVisibleNow = await page.locator('#onetrust-accept-btn-handler')
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (!isVisibleNow) return;
    console.log('🍪 Cookie banner reappeared after initial dismissal — dismissing again...');
  }

  // ── DAZN pattern: wait the full timeout for the Accept button ─────
  // Always use the caller-provided timeout so late-loading banners
  // (e.g. on signin page) are caught reliably.
  const cookieAcceptBtn = page.locator('#onetrust-accept-btn-handler');
  const isVisible = await cookieAcceptBtn
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);

  if (isVisible) {
    try {
      await cookieAcceptBtn.click({ timeout: 3000 });
      console.log('🍪 Accepted cookies via #onetrust-accept-btn-handler');
      _dismissedContexts.add(context);
      // Wait for banner to disappear after clicking
      await page.locator('#onetrust-banner-sdk')
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => { });
      await stabilisePage(page);
      return;
    } catch {
      // Force click fallback
      try {
        await cookieAcceptBtn.click({ force: true, timeout: 3000 });
        console.log('🍪 Accepted cookies via forced click');
        _dismissedContexts.add(context);
        await stabilisePage(page);
        return;
      } catch {
        // JS click as last resort
        const handle = await cookieAcceptBtn.elementHandle({ timeout: 2000 }).catch(() => null);
        if (handle) {
          await page.evaluate((el: any) => el.click(), handle).catch(() => { });
          console.log('🍪 Accepted cookies via JS click');
          _dismissedContexts.add(context);
          await stabilisePage(page);
          return;
        }
      }
    }
  }

  // ── Fallback: try other common cookie accept selectors ───────
  const fallbackSelectors = [
    '[data-test-id="COOKIE_BUTTON"]',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("Agree")',
    'button:has-text("Allow all")',
  ];

  for (const selector of fallbackSelectors) {
    const btn = page.locator(selector).first();
    const btnVisible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
    if (btnVisible) {
      try {
        await btn.click({ timeout: 3000 });
        console.log(`🍪 Accepted cookies via fallback: ${selector}`);
        _dismissedContexts.add(context);
        await stabilisePage(page);
        return;
      } catch {
        // continue to next selector
      }
    }
  }

  // Cookie banner not displayed
  console.log('🍪 Cookie banner not displayed — skipping');
}

// ─────────────────────────────────────────────────────────────────
// STABILISE PAGE — remove cookie overlays from DOM
// ─────────────────────────────────────────────────────────────────
export async function stabilisePage(page: Page): Promise<void> {
  if (page.isClosed()) return;
  // Cap at 3s: page.evaluate() has no built-in timeout and will hang
  // indefinitely on a CPU-starved runner until the test timeout kills it.
  const evalWork = page.evaluate(() => {
    if (window.location.href.includes('/myaccount')) return;
    [
      '#onetrust-banner-sdk',
      '#onetrust-consent-sdk',
      '#onetrust-pc-sdk',
      '.onetrust-pc-dark-filter',
      '[class*="cookie-banner" i]',
      '[class*="consent-banner" i]',
      '[class*="cookie-disclaimer" i]',
      '[data-test-id="COOKIE_CONTAINER"]',
    ].forEach(sel =>
      document.querySelectorAll<HTMLElement>(sel)
        .forEach(el => el.remove())
    );
  }).catch(() => { });
  const timeout = new Promise<void>(resolve => setTimeout(resolve, 3000));
  await Promise.race([evalWork, timeout]);
}

// ─────────────────────────────────────────────────────────────────
// DISMISS MARKETING POPUP ("Unlock exclusive content")
// ─────────────────────────────────────────────────────────────────
export async function dismissMarketingPopup(
  page: Page,
  timeout: number = 0,
  options: { preservePpvPromo?: boolean } = {}
): Promise<void> {
  if (page.isClosed()) return;
  try {
    const dismissSelectors = [
      'button:has-text("Keep me updated")',
      'button:has-text("Keep Me Updated")',
      'button:has-text("Maybe later")',
      'button:has-text("Maybe Later")',
      'button:has-text("No thanks")',
      'button:has-text("No Thanks")',
      'button:has-text("Not now")',
      'button:has-text("Not Now")',
      'button:has-text("Close")',
      'button:has-text("Dismiss")',
      '[aria-label="Close"]',
      '[aria-label="close"]',
      '[aria-label*="close" i]',
      '[data-testid*="close" i]',
    ].join(', ');

    const popup = page.locator(dismissSelectors).first();

    let isVisible = false;
    if (timeout > 0) {
      isVisible = await popup.waitFor({ state: 'visible', timeout })
        .then(() => true)
        .catch(() => false);
    } else {
      isVisible = await popup.isVisible().catch(() => false);
    }

    if (isVisible) {
      if (options.preservePpvPromo) {
        const ppvPromo = page.locator(
          '[role="dialog"], [aria-modal="true"], [class*="content-promotion" i], [class*="modal" i], [class*="popup" i]'
        ).filter({ hasText: /buy now/i }).first();
        if (await ppvPromo.isVisible({ timeout: 500 }).catch(() => false)) {
          console.log('ℹ️ PPV promo detected — preserving it for validation and Buy Now flow');
          return;
        }
      }
      const btnText = await popup.textContent().catch(() => '');

      // When preservePpvPromo is set, skip dismissing PPV purchase prompts
      // so the home-page-popup flow can interact with the Buy Now CTA.
      if (options.preservePpvPromo && btnText) {
        const lower = btnText.toLowerCase();
        const isPpvPopup =
          lower.includes('buy now') ||
          lower.includes('get it now') ||
          lower.includes('ppv') ||
          lower.includes('pay-per-view');
        if (isPpvPopup) {
          console.log(`🛡️ PPV promo popup preserved ("${btnText.trim().substring(0, 80)}")`);
          return;
        }
      }

      console.log(`🔔 Marketing popup detected ("${btnText?.trim()}"). Dismissing...`);
      await popup.click({ force: true }).catch(() => { });
      console.log('✅ Dismissed marketing popup');
    }
  } catch (e) {
    console.warn('⚠️ Error in dismissMarketingPopup:', e);
  }
}

// ─────────────────────────────────────────────────────────────────
// WAIT FOR SPA READY
// ─────────────────────────────────────────────────────────────────
export async function waitForSPAReady(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.waitForLoadState('domcontentloaded').catch(() => { });
}

// ─────────────────────────────────────────────────────────────────
// TRIGGER LAZY LOAD — only called explicitly after selectSport()
// ─────────────────────────────────────────────────────────────────
export async function triggerLazyLoad(page: Page): Promise<void> {
  if (page.isClosed()) return;
  const url = page.url();
  if (!url.includes('/schedule')) return;
  await page.evaluate(() => {
    const target = Math.min(
      document.body.scrollHeight,
      window.innerHeight * 3
    );
    window.scrollTo(0, target);
  }).catch(() => { });
  await sleep(150);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => { });
}

// ─────────────────────────────────────────────────────────────────
// SETUP PAGE — single call after navigation (safety net only)
// ─────────────────────────────────────────────────────────────────
export async function setupPage(page: Page, _cookieTimeout: number = 500): Promise<void> {
  if (page.isClosed()) return;
  await handleCookies(page, _cookieTimeout);
}

// ─────────────────────────────────────────────────────────────────
// SCROLL TO CENTER
// ─────────────────────────────────────────────────────────────────
export async function scrollToCenter(
  page: Page,
  selector: string
): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, selector).catch(() => { });
}

// ─────────────────────────────────────────────────────────────────
// DOM NODE INTERFACE
// ─────────────────────────────────────────────────────────────────
export interface DOMNode {
  tag: string;
  text: string;
  classes: string;
  childCount: number;
  isInModal: boolean;
  isStrike?: boolean;
  isChecked?: boolean;
  type?: string;
  src?: string;
  href?: string;
  ariaPressed?: string;
  ariaChecked?: string;
  id?: string;
  hasCheckedSvg?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// GET PAGE SNAPSHOT — bulk DOM read in one JS call
// ─────────────────────────────────────────────────────────────────
export async function getPageSnapshot(page: Page): Promise<DOMNode[]> {
  if (page.isClosed()) return [];
  try {
    return await page.evaluate((): any[] => {
      // Initialize global __name helper to prevent ReferenceError in transpiled bundles
      const g = typeof window !== 'undefined' ? window : globalThis;
      (g as any).__name = (g as any).__name || ((target: any) => target);

      const clean = (s: string) =>
        s.replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();


      const getElementClasses = (el: Element): string =>
        (el.getAttribute('class') || '')
          .trim()
          .replace(/\s+/g, ' ');


      const modalSelectors = [
        '[role="dialog" i]',
        '[aria-modal="true"]',
        '[class*="modal" i]',
        '[class*="overlay" i]',
        '[class*="popup" i]',
      ];

      const isInModal = (el: Element): boolean =>
        modalSelectors.some(sel => {
          const closest = el.closest(sel);
          return closest !== null && closest.tagName !== 'BODY' && closest.tagName !== 'HTML';
        });

      const isInInactiveSlide = (el: any): boolean => {
        const slide = el.closest('.swiper-slide, [class*="swiper-slide"]');
        if (!slide) return false;
        const isHero = el.closest([
          'main [class*="banner"]',
          'main [class*="hero"]',
          'main .swiper',
          'section[class*="banner"]',
          '[class*="heroBanner"]',
          '[class*="hero-banner"]',
        ].join(', '));
        if (!isHero) return false;
        return slide.closest('.swiper-slide-active, [class*="swiper-slide-active"]') === null;
      };

      // OPTIMIZED: avoid getComputedStyle — use offsetWidth/Height + inline style checks
      const isRendered = (el: HTMLElement): boolean => {
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (!isMobile && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
        const style = el.style;
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (style.opacity === '0') return false;
        if (el.hidden) return false;
        if (isInInactiveSlide(el)) return false;
        return true;
      };

      // OPTIMIZED: avoid getComputedStyle — use only DOM-based checks, except for price elements
      const isStrikethrough = (el: HTMLElement): boolean => {
        if (el.closest('del, s') !== null) return true;
        if (el.closest('[style*="line-through"]') !== null) return true;
        if (el.closest('[class*="strike" i], [class*="line-through" i], [class*="crossed" i], [class*="original" i]') !== null) return true;

        // Target specifically text elements that look like prices or contain numbers
        const txt = el.textContent || '';
        if (txt.includes('£') || txt.includes('$') || txt.includes('€') || txt.includes('₹') || /\d/.test(txt)) {
          let current: HTMLElement | null = el;
          for (let depth = 0; depth < 8 && current; depth++) {
            try {
              const style = window.getComputedStyle(current);
              if (style.textDecoration.includes('line-through') || style.textDecorationLine.includes('line-through')) {
                return true;
              }
            } catch (e) { }
            current = current.parentElement;
          }
        }
        return false;
      };

      const getNonStrikeText = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent || '';
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
          const htmlEl = node as HTMLElement;
          const tagName = htmlEl.tagName.toUpperCase();
          if (tagName === 'SCRIPT' || tagName === 'STYLE') {
            return '';
          }
          if (isStrikethrough(htmlEl)) {
            return '';
          }
          let text = '';
          for (let i = 0; i < htmlEl.childNodes.length; i++) {
            text += getNonStrikeText(htmlEl.childNodes[i]);
          }
          return text;
        }
        return '';
      };

      const tags = [
        'button', 'a', 'h1', 'h2', 'h3', 'h4', 'h5',
        'p', 'span', 'li', 'label',
        'small', 'time', 'strong', 'b', 'em', 'div',
        'img', 'input'
      ];

      const results: any[] = [];
      const seen = new Set<string>();
      let totalProcessed = 0;
      const MAX_ELEMENTS = 5000; // Performance budget: stop after processing this many elements

      for (const tag of tags) {
        const els = document.querySelectorAll<HTMLElement>(tag);
        for (const el of els) {
          totalProcessed++;
          if (totalProcessed > MAX_ELEMENTS) break;
          if (!isRendered(el)) continue;
          const text = isStrikethrough(el) ? clean(el.textContent || '') : clean(getNonStrikeText(el));
          const isInteractive = ['button', 'a', 'img', 'input'].includes(tag);
          if (!isInteractive && (!text || text.length < 2 || text.length > 500)) continue;
          const key = text ? `${tag}:${text}` : `${tag}:${getElementClasses(el)}:${results.length}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const hasCheckedSvg = (() => {
            const svgs = el.getElementsByTagName('svg');
            for (let i = 0; i < svgs.length; i++) {
              const svg = svgs[i];
              const classes = (svg.getAttribute('class') || '').toLowerCase();
              if (classes.includes('checked') || classes.includes('checkmark')) return true;
            }
            const children = el.getElementsByTagName('*');
            for (let i = 0; i < children.length; i++) {
              const child = children[i];
              const classes = (child.getAttribute('class') || '').toLowerCase();
              if (classes.includes('checked') || classes.includes('checkmark')) return true;
            }
            return false;
          })();

          results.push({
            tag,
            text,
            classes: getElementClasses(el),
            childCount: el.children.length,
            isInModal: isInModal(el),
            isStrike: isStrikethrough(el),
            isChecked: (el as HTMLInputElement).checked || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true',
            type: el.getAttribute('type') || undefined,
            src: (el as HTMLImageElement).src || el.getAttribute('src') || undefined,
            href: (el as HTMLAnchorElement).href || el.getAttribute('href') || undefined,
            ariaPressed: el.getAttribute('aria-pressed') || undefined,
            ariaChecked: el.getAttribute('aria-checked') || undefined,
            id: el.id || undefined,
            hasCheckedSvg,
          });
          if (results.length >= 2000) break;
        }
        if (results.length >= 2000 || totalProcessed > MAX_ELEMENTS) break;
      }
      return results;
    });
  } catch (err: any) {
    console.error('❌ getPageSnapshot page.evaluate failed:', err);
    return [];
  }
}
