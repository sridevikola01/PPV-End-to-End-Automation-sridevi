import { Page, BrowserContext } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// SLEEP
// ─────────────────────────────────────────────────────────────────
export const sleep = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────
// DISMISS COOKIE BANNER (Warmup)
// ── Navigate to /home, wait for cookie banner, dismiss it naturally.
//    After dismissal, block OneTrust SDK from loading on subsequent pages
//    so the banner can never appear again in this session.
//    Call ONCE per page, BEFORE navigating to the actual flow URL.
//    If skipNavigation=true, assumes page is already on the correct URL.
// ─────────────────────────────────────────────────────────────────
let _cookieSdkBlocked = false;

export async function dismissCookieBanner(page: Page, skipNavigation = false): Promise<void> {
  const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
  let domain = 'stag.dazn.com';
  if (env === 'beta') domain = 'beta.dazn.com';
  if (env === 'prod') domain = 'www.dazn.com';

  const region = (process.env.DAZN_REGION || 'GB').toUpperCase();
  const langPath = region === 'AU' ? '/en-AU' : region === 'IE' ? '/en-IE' : '/en-GB';
  const warmupUrl = `https://${domain}${langPath}/home`;

  if (!skipNavigation) {
    console.log(`🍪 [Warmup] Navigating to ${warmupUrl} to dismiss cookie banner...`);
    await page.goto(warmupUrl, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
  } else {
    console.log(`🍪 [Warmup] Dismissing cookie banner on current page: ${page.url()}`);
    // Ensure page is fully loaded (OneTrust loads asynchronously after DOMContentLoaded)
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
  }

  // OneTrust loads asynchronously — wait for networkidle to ensure scripts are fetched
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // Give OneTrust extra time to initialize after scripts load (geolocation check + render)
  await sleep(2000);

  // Wait for the OneTrust banner to appear (up to 10s — prod loads it async after page)
  const bannerSelector = '#onetrust-banner-sdk';
  const acceptBtnSelector = '#onetrust-accept-btn-handler'; // "Accept"
  const rejectBtnSelector = '#onetrust-reject-all-handler'; // "Essential cookies only"

  // First check if OneTrust SDK wrapper is in DOM at all (even if banner not visible yet)
  const sdkInDom = await page.locator('#onetrust-consent-sdk, #onetrust-banner-sdk')
    .waitFor({ state: 'attached', timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (sdkInDom) {
    console.log('🍪 [Warmup] OneTrust SDK detected in DOM — waiting for banner to render...');
  } else {
    console.log('🍪 [Warmup] OneTrust SDK not found in DOM after 8s');
  }

  let bannerVisible = await page.locator(bannerSelector)
    .waitFor({ state: 'visible', timeout: sdkInDom ? 5000 : 3000 })
    .then(() => true)
    .catch(() => false);

  if (!bannerVisible) {
    console.log('🍪 [Warmup] Cookie banner did not appear — may already be dismissed.');
  } else {
    console.log('🍪 [Warmup] Cookie banner visible — clicking Accept...');

    // Prefer "Accept", fall back to "Essential cookies only"
    let dismissed = false;
    for (const sel of [acceptBtnSelector, rejectBtnSelector]) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        try {
          await btn.click({ timeout: 5000 });
          dismissed = true;
          console.log(`🍪 [Warmup] Clicked: ${sel}`);
        } catch {
          await btn.click({ force: true, timeout: 3000 }).catch(() => {});
          dismissed = true;
          console.log(`🍪 [Warmup] Force-clicked: ${sel}`);
        }
        break;
      }
    }

    if (!dismissed) {
      const fallbackBtn = page.locator('button:has-text("Essential cookies only"), button:has-text("Accept")').first();
      if (await fallbackBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await fallbackBtn.click({ timeout: 5000 }).catch(() => {});
        dismissed = true;
      }
    }

    if (dismissed) {
      await page.locator(bannerSelector)
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => {});
      // Let OneTrust write its cookies naturally
      await sleep(1000);
      console.log('🍪 [Warmup] Cookie banner dismissed naturally');
    } else {
      console.log('🍪 [Warmup] WARNING: Could not dismiss cookie banner');
    }
  }

  // ── BLOCK OneTrust SDK from loading on ALL subsequent navigations ──
  // This prevents the banner from ever appearing again in this session.
  // Only block the actual OneTrust CDN scripts — NOT any URL that happens
  // to contain "optanon" as a query param (that would break DAZN's own APIs).
  const context = page.context();
  await context.route('**/cdn.cookielaw.org/**', (route) => {
    route.abort().catch(() => {});
  });
  await context.route('**/geolocation.onetrust.com/**', (route) => {
    route.abort().catch(() => {});
  });
  await context.route('**/cookie-cdn.cookiepro.com/**', (route) => {
    route.abort().catch(() => {});
  });
  _cookieSdkBlocked = true;
  console.log('🍪 [Warmup] OneTrust CDN blocked for all subsequent page loads');
}

export function isCookieSdkBlocked(): boolean {
  return _cookieSdkBlocked;
}

/**
 * Unblock the OneTrust CDN so the cookie banner can appear again.
 * Call this BEFORE navigating to a page where you want the banner to show.
 */
export async function resetCookieSdkBlock(page: Page): Promise<void> {
  try {
    const context = page.context();
    // Unroute any existing CDN blocks
    await context.unroute('**/cdn.cookielaw.org/**').catch(() => {});
    await context.unroute('**/geolocation.onetrust.com/**').catch(() => {});
    await context.unroute('**/cookie-cdn.cookiepro.com/**').catch(() => {});
    // Clear ONLY the OneTrust consent cookies — preserves login/session cookies
    await context.clearCookies({ name: 'OptanonConsent' }).catch(() => {});
    await context.clearCookies({ name: 'OptanonAlertBoxClosed' }).catch(() => {});
    // Mock OneTrust geolocation API to return GB+EU so the GDPR cookie banner always appears.
    // Without this, OneTrust uses the real IP (resolves to India in CI/dev) and skips the banner.
    // The `continent` field is required — OneTrust skips GDPR consent if continent != "EU".
    await context.route('**/geolocation.onetrust.com/**', async (route) => {
      console.log(`🌍 [GeoMock] Intercepted: ${route.request().url()} → returning GB/EU`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ country: 'GB', state: '', continent: 'EU', stateCode: '' }),
      });
    });
    console.log('🍪 [CookieReset] Geolocation mocked → GB/EU, CDN unblocked, consent cookies cleared');
  } catch {}
  _cookieSdkBlocked = false;
}

// ─────────────────────────────────────────────────────────────────
// PRE-INJECT CONSENT COOKIES (DEPRECATED — use dismissCookieBanner instead)
// ── Call ONCE per BrowserContext, BEFORE the first navigation.
//    This sets OneTrust cookies so the banner never appears.
// ─────────────────────────────────────────────────────────────────
export async function injectConsentCookies(context: BrowserContext): Promise<void> {
  const region = (process.env.DAZN_REGION || 'GB').toUpperCase();
  const env = (process.env.DAZN_ENV || 'stag').toLowerCase();

  let domain = 'stag.dazn.com';
  if (env === 'beta') domain = 'beta.dazn.com';
  if (env === 'prod') domain = 'www.dazn.com';

  const baseDomain = '.dazn.com';
  const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;

  const cookiesToSet = [domain, baseDomain].flatMap(dom => [
    {
      name: 'OptanonAlertBoxClosed',
      value: new Date().toISOString(),
      domain: dom,
      path: '/',
      expires: expiry,
    },
    {
      name: 'OptanonConsent',
      value: `isGpcEnabled=0&datestamp=${encodeURIComponent(new Date().toISOString())}&version=202603.1.0&browserGpcFlag=0&isIABGlobal=false&identifierType=Cookie+Unique+Id&hosts=&consentId=test-automation-${Date.now()}&interactionCount=1&isAnonUser=1&prevHadToken=0&landingPath=NotLandingPage&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1%2CV2STACK42%3A1&geolocation=${region}%3BEN`,
      domain: dom,
      path: '/',
      expires: expiry,
    },
  ]);

  await context.addCookies(cookiesToSet);
  console.log(`🍪 Pre-injected OneTrust consent cookies for ${domain} (region: ${region})`);
}

const autoCookieGuardPages = new WeakSet<Page>();

export async function installCookieAutoAccept(page: Page): Promise<void> {
  if (page.isClosed() || autoCookieGuardPages.has(page)) return;
  // If SDK is already blocked, no need for auto-accept — banner can't appear
  if (_cookieSdkBlocked) return;
  autoCookieGuardPages.add(page);

  await page.addInitScript(() => {
    const removeBanner = () => {
      const els = document.querySelectorAll('#onetrust-banner-sdk, #onetrust-consent-sdk, .onetrust-pc-dark-filter');
      els.forEach(el => el.remove());
    };

    const clickAndRemove = () => {
      const selectors = [
        '#onetrust-reject-all-handler',
        '#onetrust-accept-btn-handler',
        '[data-test-id="COOKIE_BUTTON"]',
      ];

      for (const selector of selectors) {
        const btn = document.querySelector<HTMLElement>(selector);
        if (btn) {
          btn.click();
          setTimeout(removeBanner, 100);
          return true;
        }
      }
      const allBtns = document.querySelectorAll<HTMLElement>('button');
      for (const btn of allBtns) {
        const t = (btn.textContent || '').trim().toLowerCase();
        if (t === 'accept' || t === 'accept all' || t === 'essential cookies only') {
          btn.click();
          setTimeout(removeBanner, 100);
          return true;
        }
      }
      removeBanner();
      return false;
    };

    const observer = new MutationObserver(() => {
      const banner = document.querySelector('#onetrust-banner-sdk, #onetrust-consent-sdk');
      if (banner) {
        clickAndRemove();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    clickAndRemove();
    window.addEventListener('load', clickAndRemove);
    document.addEventListener('DOMContentLoaded', clickAndRemove);
    const interval = setInterval(() => {
      const banner = document.querySelector('#onetrust-banner-sdk');
      if (banner) {
        clickAndRemove();
        clearInterval(interval);
      }
    }, 200);
    setTimeout(() => clearInterval(interval), 10000);
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────
// HANDLE COOKIES
// ── Wait for cookie banner when requested, accept it, then ensure it is gone.
// ─────────────────────────────────────────────────────────────────

export async function handleCookies(page: Page, timeout: number = 500): Promise<void> {
  if (page.isClosed()) return;

  // Even if SDK is blocked, do a quick DOM removal as a safety net
  // (scripts may have been cached/loaded before blocking was applied)
  if (_cookieSdkBlocked) {
    await stabilisePage(page);
    return;
  }

  await installCookieAutoAccept(page);

  const bannerSelector =
    '#onetrust-banner-sdk, ' +
    '#onetrust-consent-sdk, ' +
    '[class*="cookie-banner" i], ' +
    '[class*="consent-banner" i], ' +
    '[data-test-id="COOKIE_CONTAINER"], ' +
    'h2:has-text("Select your cookie preferences")';

  const acceptSelectors = [
    '#onetrust-reject-all-handler',
    '#onetrust-accept-btn-handler',
    '[data-test-id="COOKIE_BUTTON"]',
    'button:has-text("Essential cookies only")',
    'button:has-text("Accept")',
    'button:has-text("Accept All")',
    'button:has-text("Agree")',
    'button:has-text("Allow all")',
  ];
  const acceptSelector = acceptSelectors.join(', ');

  let bannerVisible = false;

  if (timeout > 1000) {
    bannerVisible = await page.locator(acceptSelector).first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);

    if (!bannerVisible) return;
  } else {
    // Quick visibility check for later pages where we do not want to wait long.
    bannerVisible = await page.locator(bannerSelector).first()
      .isVisible()
      .catch(() => false);
  }

  if (!bannerVisible) {
    return;
  }

  console.log(timeout > 1000
    ? '🍪 Cookie banner visible — accepting before continuing...'
    : '🍪 Cookie banner unexpectedly visible — dismissing...');

  for (const sel of acceptSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      try {
        await btn.click({ timeout: 3000 });
      } catch {
        await btn.click({ force: true, timeout: 3000 }).catch(() => {});
      }


      await page.locator(bannerSelector).first()
        .waitFor({ state: 'hidden', timeout: 2000 })
        .catch(() => {});
      await page.waitForFunction(
        (selector) => !document.querySelector(selector),
        bannerSelector,
        { timeout: 2000 }
      ).catch(() => {});
      console.log('🍪 Cookie banner dismissed');
      break;
    }
  }

  // Remove any remaining overlay elements from the DOM
  await stabilisePage(page);
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
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────
// WAIT FOR SPA READY
// ─────────────────────────────────────────────────────────────────
export async function waitForSPAReady(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.waitForLoadState('domcontentloaded').catch(() => {});
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
  }).catch(() => {});
  await sleep(150);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────
// SETUP PAGE — single call after navigation (safety net only)
// ─────────────────────────────────────────────────────────────────
export async function setupPage(page: Page, _cookieTimeout: number = 500): Promise<void> {
  if (page.isClosed()) return;
  // If SDK is blocked, still do a quick DOM removal as safety net
  if (_cookieSdkBlocked) {
    await stabilisePage(page);
    return;
  }
  await installCookieAutoAccept(page);
  await handleCookies(page);
}

// ─────────────────────────────────────────────────────────────────
// SCROLL TO CENTER
// ─────────────────────────────────────────────────────────────────
export async function scrollToCenter(
  page:     Page,
  selector: string
): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, selector).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────
// DOM NODE INTERFACE
// ─────────────────────────────────────────────────────────────────
export interface DOMNode {
  tag:          string;
  text:         string;
  classes:      string;
  childCount:   number;
  isInModal:    boolean;
  isStrike?:    boolean;
  type?:        string;
  isChecked?:   boolean;
  src?:         string;
  ariaChecked?: string;
  ariaPressed?: string;
  href?:        string;
  role?:        string;
  value?:       string;
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
        return true;
      };

      // OPTIMIZED: avoid getComputedStyle — use only DOM-based checks
      const isStrikethrough = (el: HTMLElement): boolean => {
        if (el.closest('del, s') !== null) return true;
        if (el.closest('[style*="line-through"]') !== null) return true;
        if (el.closest('[class*="strike" i], [class*="line-through" i], [class*="crossed" i], [class*="original" i]') !== null) return true;
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
        'button','a','h1','h2','h3','h4','h5',
        'p','span','li','label',
        'small','time','strong','b','em'
      ];

      const results: any[] = [];
      const seen = new Set<string>();
      let totalProcessed = 0;
      const MAX_ELEMENTS = 800; // Performance budget: reduced from 2000 for speed

      for (const tag of tags) {
        const els = document.querySelectorAll<HTMLElement>(tag);
        for (const el of els) {
          totalProcessed++;
          if (totalProcessed > MAX_ELEMENTS) break;
          if (!isRendered(el)) continue;
          const text = isStrikethrough(el) ? clean(el.textContent || '') : clean(getNonStrikeText(el));
          const isInteractive = tag === 'button' || tag === 'a';
          if (!isInteractive && (!text || text.length < 2 || text.length > 500)) continue;
          const key = text ? `${tag}:${text}` : `${tag}:${el.className || ''}:${results.length}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            tag,
            text,
            classes:    el.className || '',
            childCount: el.children.length,
            isInModal:  isInModal(el),
            isStrike:   isStrikethrough(el),
          });
          if (results.length >= 800) break;
        }
        if (results.length >= 800 || totalProcessed > MAX_ELEMENTS) break;
      }
      return results;
    });
  } catch {
    return [];
  }
}
