import { Page, BrowserContext } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// SLEEP
// ─────────────────────────────────────────────────────────────────
export const sleep = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────
// PRE-INJECT CONSENT COOKIES (DEPRECATED — no-op)
// ── Kept for backward compatibility. Cookie banner is now dismissed
//    by clicking the Accept button via handleCookies().
// ─────────────────────────────────────────────────────────────────
export async function injectConsentCookies(_context: BrowserContext): Promise<void> {
  // No-op — cookie banner is now handled via UI click in handleCookies()
  console.log('🍪 [DEPRECATED] injectConsentCookies is a no-op — cookie banner will be dismissed via UI click');
}

// ─────────────────────────────────────────────────────────────────
// HANDLE COOKIES — dismiss cookie banner via UI click
// ── Called after every navigation. Dismisses cookie consent banner
//    by clicking the Accept button. Only runs once per BrowserContext.
// ─────────────────────────────────────────────────────────────────

const _dismissedContexts = new WeakSet<BrowserContext>();
const _initialCheckDone = new WeakSet<BrowserContext>();

export async function handleCookies(page: Page, timeout: number = 8000): Promise<void> {
  if (page.isClosed()) return;

  const context = page.context();

  // Skip entirely if we already dismissed in this context,
  // BUT do a fast check in case the cookie banner reappeared (e.g. on new pages/redirects)
  if (_dismissedContexts.has(context)) {
    const isVisibleNow = await page.locator('#onetrust-accept-btn-handler')
      .isVisible()
      .catch(() => false);
    if (!isVisibleNow) return;
    console.log('🍪 Cookie banner reappeared after initial dismissal — dismissing again...');
  }

  // Use a shorter activeTimeout if the initial wait has already been completed
  let activeTimeout = timeout;
  if (_initialCheckDone.has(context)) {
    activeTimeout = 100;
  } else {
    _initialCheckDone.add(context);
  }

  // ── DAZN pattern: directly target the Accept button ──────────
  // Instead of waiting for a banner container first, go straight
  // for the accept button. This is more reliable when the banner
  // wrapper uses dynamic/unpredictable class names.
  const cookieAcceptBtn = page.locator('#onetrust-accept-btn-handler');
  const isVisible = await cookieAcceptBtn
    .waitFor({ state: 'visible', timeout: activeTimeout })
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
        const handle = await cookieAcceptBtn.elementHandle().catch(() => null);
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
    const btnVisible = await btn.isVisible().catch(() => false);
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

  // Cookie banner not displayed — skipping
  if (!_initialCheckDone.has(context)) {
    // Don't mark as dismissed so we can retry on next navigation
    console.log('🍪 Cookie banner not displayed — skipping');
  }
}

// ─────────────────────────────────────────────────────────────────
// STABILISE PAGE — remove cookie overlays from DOM
// ─────────────────────────────────────────────────────────────────
export async function stabilisePage(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(() => {
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
}

// ─────────────────────────────────────────────────────────────────
// DISMISS MARKETING POPUP ("Unlock exclusive content")
// ─────────────────────────────────────────────────────────────────
export async function dismissMarketingPopup(page: Page): Promise<void> {
  if (page.isClosed()) return;
  try {
    const keepMeUpdatedBtn = page.locator('button:has-text("Keep me updated"), button:has-text("Keep Me Updated")').first();
    if (await keepMeUpdatedBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log('🔔 Marketing popup ("Unlock exclusive content") detected. Clicking "Keep me updated"...');
      await keepMeUpdatedBtn.click({ force: true }).catch(() => { });
      console.log('✅ Clicked "Keep me updated"');
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
      const clean = (s: string) =>
        s.replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();

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

      const isInInactiveSlide = (el: Element): boolean => {
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
      // getComputedStyle forces a full style recalculation per element and blocks the thread
      const isRendered = (el: HTMLElement): boolean => {
        if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
        const style = el.style;
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (style.opacity === '0') return false;
        // Check for hidden attribute
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
          // Walk up parent elements — text-decoration is NOT inherited via CSS,
          // so the line-through may be on a parent element (e.g. parent div with the class)
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
          const key = text ? `${tag}:${text}` : `${tag}:${el.className || ''}:${results.length}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            tag,
            text,
            classes: el.className || '',
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
            hasCheckedSvg: el.querySelector('svg[class*="checked" i], [class*="checkmark" i]') !== null,
          });
          if (results.length >= 2000) break;
        }
        if (results.length >= 2000 || totalProcessed > MAX_ELEMENTS) break;
      }
      return results;
    });
  } catch {
    return [];
  }
}
