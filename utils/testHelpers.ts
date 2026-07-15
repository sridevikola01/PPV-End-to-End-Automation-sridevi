import fs from 'fs';

import path from 'path';

// ─────────────────────────────────────────────────────────────────
// FIND CONFIG FILE recursively under config/
// ─────────────────────────────────────────────────────────────────
export function findConfig(dir: string, filename: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findConfig(full, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return full;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// LOAD EVENT CONFIG — simple JSON require with recursive search
// NOTE: buildEventData() handles base config merging downstream
// so this just loads the raw flow config
// ─────────────────────────────────────────────────────────────────
import { loadEventConfig as delegateLoad } from './configLoader';

export function loadEventConfig(eventConfig?: string, planConfig?: string): Record<string, any> {
  return delegateLoad(eventConfig, planConfig);
}

// ─────────────────────────────────────────────────────────────────
// SAFE SCROLL TO ELEMENT
// ─────────────────────────────────────────────────────────────────
export async function safeScrollToElement(page: any, locator: any): Promise<void> {
  try {
    const handle = await locator.elementHandle({ timeout: 3000 });
    if (!handle) return;
    await page.evaluate((el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const inView =
        rect.top >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.left >= 0 &&
        rect.right <= window.innerWidth;
      if (!inView) {
        const scrollTop = window.scrollY + rect.top - 150;
        window.scrollTo({ top: Math.max(0, scrollTop), behavior: 'instant' });
      }
    }, handle);
  } catch (e) {
    console.warn(`⚠️  safeScrollToElement failed: ${e instanceof Error ? e.message : 'unknown error'}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// CLICK AND WAIT FOR NAVIGATION
// ─────────────────────────────────────────────────────────────────
export async function clickAndWaitForNav(
  page: any,
  btn: any,
  label: string
): Promise<void> {
  console.log(`clicking: ${label}`);
  const before = page.url();
  await safeScrollToElement(page, btn);
  await btn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
  await btn.click({ force: true });
  try {
    await page.waitForURL(
      (url: URL) => url.toString() !== before,
      { timeout: 5000 }
    );
    console.log(`navigated to: ${page.url()}`);
  } catch {
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => { });
    console.log(`navigated to: ${page.url()}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// CREATE FRESH BROWSER CONTEXT (new user flow)
// ─────────────────────────────────────────────────────────────────
export async function createFreshContext(browser: any): Promise<{ context: any; page: any }> {
  const context = await browser.newContext({
    viewport: null,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    recordVideo: {
      dir: 'test-results/videos/',
      size: { width: 1920, height: 1080 },
    },
  });



  await context.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('randomABPoint', Math.random().toString());
    } catch { }
  });

  const page = await context.newPage();
  return { context, page };
}

// ─────────────────────────────────────────────────────────────────
// LOG VIDEO PATH
// ─────────────────────────────────────────────────────────────────
export async function logVideoPath(page: any): Promise<void> {
  try {
    const videoPath = await page.video()?.path();
    if (videoPath) console.log(`🎥 Video: ${videoPath}`);
  } catch { }
}

import { validateVariant } from '../flows/validateVariant';
import { getHomeOfBoxingData, getHomePageData, getSearchPagePopupData, getSchedulePagePopupData } from './excelReader';

// ─────────────────────────────────────────────────────────────────
// HANDLE POPUP MODAL (VALIDATION & OPTIONAL CLICK THROUGH)
// ─────────────────────────────────────────────────────────────────
export async function handlePopupModal(
  page: any,
  results: any[],
  eventData: any,
  source: string,
  clickBuyNow: boolean
): Promise<boolean> {
  const src = (source || '').toLowerCase();

  // 1. Skip check for landing-page-dont-miss flows since they are cards, not tiles (no popup modal displayed)
  if (src.includes('dont-miss') && !src.includes('home-') && !src.includes('sport')) {
    console.log('ℹ️ [Popup Check] Skipping popup check for standard landing-page-dont-miss (direct card flow)');
    return false;
  }

  // 2. Skip validation if already validated to avoid duplicate errors
  const alreadyValidated = results.some(r => r.page === 'Popup Modal' || r.page === 'Home Page' || r.page === 'Home of Boxing');
  if (alreadyValidated && !clickBuyNow) {
    console.log('ℹ️ [Popup Check] Popup modal/Home of Boxing already validated. Skipping.');
    return true;
  }

  // 3. Skip check if page has already navigated to signup, PlanDetails, payment, or checkout
  const currentUrl = page.url();
  if (
    currentUrl.includes('signup') ||
    currentUrl.includes('PlanDetails') ||
    currentUrl.includes('payment') ||
    currentUrl.includes('checkout')
  ) {
    console.log('ℹ️ [Popup Check] Already navigated to onboarding/checkout pages. No popup check needed.');
    return false;
  }

  console.log(`🔍 [Popup Check] Checking if a popup modal is visible (clickBuyNow=${clickBuyNow})...`);

  const modalSelectors = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[class*="modal" i]',
    '[class*="popup" i]',
    '[class*="Dialog" i]',
    '.Modal',
  ];

  let foundModal: any = null;

  // Wait up to 2.5s for a modal with a CTA to appear (replaces polling loop)
  const ctaSelector = [
    'button:has-text("Buy now")', 'a:has-text("Buy now")', 'button:has-text("Buy Now")',
    'button:has-text("Subscribe")', 'a:has-text("Subscribe")', 'button:has-text("Continue")', 'a:has-text("Continue")',
    'button:has-text("Sign up")', 'a:has-text("Sign up")', 'button:has-text("Sign up for free")', 'a:has-text("Sign up for free")',
    'button:has-text("Start watching")', 'a:has-text("Start watching")', 'button:has-text("Get started")', 'a:has-text("Get started")'
  ].join(', ');

  const modalLocator = page.locator(modalSelectors.join(', ')).filter({ has: page.locator(ctaSelector) }).first();
  try {
    await modalLocator.waitFor({ state: 'visible', timeout: src === 'home-page-dont-miss' ? 1000 : 2500 });
    if (await modalLocator.isVisible().catch(() => false)) {
      foundModal = modalLocator;
    }
  } catch {
    // Not found yet; navigation guard below will decide whether to continue.
  }

  // Check if page navigated during the wait
  if (!foundModal) {
    const intermediateUrl = page.url();
    if (
      intermediateUrl.includes('signup') ||
      intermediateUrl.includes('PlanDetails') ||
      intermediateUrl.includes('payment') ||
      intermediateUrl.includes('checkout')
    ) {
      console.log('ℹ️ [Popup Check] Background navigation detected. Aborting popup check.');
      return false;
    }
  }

  if (foundModal) {
    console.log('✅ [Popup Check] Popup modal detected!');

    if (!alreadyValidated) {
      // Load popup validation rules from the source-specific Excel sheet
      let popupRules: any[] = [];
      try {
        if (src.includes('search')) {
          // Search page has its own Popup - fields embedded in the Search page sheet
          popupRules = getSearchPagePopupData();
        } else if (src.includes('schedule')) {
          // Schedule page has its own Popup - fields embedded in the Schedule page sheet
          popupRules = getSchedulePagePopupData();
        } else if (src === 'home-page-dont-miss' || src === 'home-biggest-fights') {
          popupRules = getHomePageData(src);
        } else {
          // Default: Home of Boxing sheet (home-boxing-tile, home-boxing-banner, etc.)
          popupRules = getHomeOfBoxingData('home-boxing-tile');
        }
      } catch (err: any) {
        console.warn(`⚠️ [Popup Check] Could not load sheet data: ${err.message}`);
      }

      if (popupRules.length > 0) {
        const popupValidationFields = new Set([
          'popup - event title',
          'popup - event date',
          'popup - promoter',
          'popup - buy now cta',
          'popup - event description',
          'popup - close button',
          'popup - image present',
          'popup - close button',
        ]);
        popupRules = popupRules.filter(rule =>
          popupValidationFields.has(String(rule.Field || '').trim().toLowerCase())
        );

        // Run validations
        try {
          const isHomeField = src === 'home-page-dont-miss' || src === 'home-biggest-fights';
          // Use source-specific page name so popup results appear in the same
          // report section as tile fields (not as a separate 'Popup Modal' section)
          let pageName: string;
          if (isHomeField) {
            pageName = 'Home Page';
          } else if (src.includes('search')) {
            pageName = 'Search';
          } else if (src.includes('schedule')) {
            pageName = 'Schedule';
          } else {
            pageName = 'Popup Modal';
          }
          const ruleFlow = isHomeField ? src : (src.includes('search') ? 'search' : src.includes('schedule') ? 'schedule' : 'home-boxing-tile');
          const pageType = isHomeField ? 'home-page' : 'popup';
          await validateVariant(page, pageType, popupRules, results, eventData, pageName, ruleFlow);
          console.log('✅ [Popup Check] Popup modal validations completed successfully.');
        } catch (err: any) {
          console.warn(`⚠️ [Popup Check] Popup modal validation error/warning: ${err.message}`);
        }

      } else {
        console.warn('⚠️ [Popup Check] No popup rules available in sheet. Skipping validations.');
      }
    }

    if (clickBuyNow) {
      // Click "Buy now" inside the modal popup to proceed
      console.log('💳 [Popup Check] Clicking "Buy now" / CTA inside modal popup...');
      const dialog = foundModal.locator('[role="dialog"], [aria-modal="true"], [class*="modal" i]').first();
      let buyNowBtn = dialog.locator(ctaSelector).first();

      let visible = await buyNowBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!visible) {
        buyNowBtn = foundModal.locator(ctaSelector).first();
      }

      await buyNowBtn.click({ force: true }).catch((e: any) => {
        console.error(`❌ [Popup Check] Failed to click Buy Now button in modal: ${e.message}`);
      });

      // Wait for the navigation to kick in
      await page.waitForURL(
        (url: URL) =>
          url.toString().includes('PlanDetails') ||
          url.toString().includes('signup') ||
          url.toString().includes('payment') ||
          url.toString().includes('checkout'),
        { timeout: 10000 }
      ).catch(() => {
        console.log(`⚠️ [Popup Check] Timeout waiting for onboarding pages. Current URL: ${page.url()}`);
      });
    }

    return true;
  } else {
    console.log('ℹ️ [Popup Check] No popup modal detected.');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// ASSERT COUNTRY MATCH
// ─────────────────────────────────────────────────────────────────
export function assertCountryMatch(page: any, region: string): void {
  if (process.env.BYPASS_COUNTRY_CHECK === 'true') {
    console.log(`⚠️ [Country Match Check] Bypassed country match assertion (requested region: "${region}").`);
    return;
  }
  const url = page.url();
  const regionLower = region.toLowerCase();

  let matches = false;
  if (regionLower === 'gb') {
    matches = url.toLowerCase().includes('-gb') || url.toLowerCase().includes('-uk') || url.toLowerCase().includes('-gg') || url.toLowerCase().includes('-je');
  } else {
    matches = url.toLowerCase().includes(`-${regionLower}`);
  }

  if (!matches) {
    throw new Error(`❌ [Country Match Check] Country mismatch: expected region "${region}" but URL is "${url}". Please ensure your VPN is connected to the correct region.`);
  }
  console.log(`✅ [Country Match Check] URL matches expected region "${region}": ${url}`);
}

// ─────────────────────────────────────────────────────────────────
// POLL FOR HOME PAGE POPUP
// Polls every 2 seconds up to maxWaitMs for a modal containing
// a "Buy Now" CTA to appear on the home page.
// Returns the modal locator if found, null if not found.
// ─────────────────────────────────────────────────────────────────
export async function pollForHomePagePopup(
  page: any,
  maxWaitMs: number = 40000
): Promise<any | null> {
  const popupCtaSelector = [
    'button:has-text("Buy Now")', 'a:has-text("Buy Now")',
    'button:has-text("Buy now")', 'a:has-text("Buy now")',
  ].join(', ');

  const modalSelectors = [
    '[class*="content-promotion__modal"]',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[class*="modal" i]',
    '[class*="popup" i]',
    '[class*="Dialog" i]',
    '.Modal',
  ];

  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const elapsed = Date.now() - startTime;
    console.log(`⏳ [Home Page Popup] Polling... ${elapsed}ms / ${maxWaitMs}ms | URL: ${page.url()}`);

    for (const selector of modalSelectors) {
      try {
        const modalLocator = page.locator(selector)
          .filter({ has: page.locator(popupCtaSelector) })
          .first();
        const isVisible = await modalLocator.isVisible({ timeout: 500 }).catch(() => false);
        if (isVisible) {
          console.log(`✅ [Home Page Popup] Popup detected after ${elapsed}ms via selector: ${selector}`);
          return modalLocator;
        }
      } catch {
        // selector not found, try next
      }
    }

    await page.waitForTimeout(2000);
  }

  console.log(`⚠️ [Home Page Popup] Popup not found after ${maxWaitMs}ms`);
  return null;
}

// ─────────────────────────────────────────────────────────────────
// WAIT FOR HOME POPUP AUTH COMPLETION
// Used after signup Continue / password sign-in so the next step does not
// replace the URL while DAZN is still completing authentication. For new
// users DAZN can finish signup on TierPlans instead of /home.
// ─────────────────────────────────────────────────────────────────
export async function waitForHomePageAuthRedirect(
  page: any,
  label: string = 'Home Page Popup auth',
  timeoutMs: number = 60000
): Promise<'home' | 'tier-plans'> {
  const beforeUrl = page.url();
  console.log(`⏳ [${label}] Waiting for signup/login completion from: ${beforeUrl}`);

  const completedOn = await page.waitForURL(
    (url: URL) => {
      const href = url.toString();
      const lower = href.toLowerCase();
      return /\/home(?:[/?#]|$)/i.test(href) ||
        (lower.includes('/signup') &&
          (lower.includes('page=tierplans') || lower.includes('page=plandetails')));
    },
    { timeout: timeoutMs }
  ).then(() => {
    const lower = page.url().toLowerCase();
    return lower.includes('page=tierplans') || lower.includes('page=plandetails')
      ? 'tier-plans'
      : 'home';
  }).catch(() => null);

  if (!completedOn) {
    const currentUrl = page.url();
    const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    throw new Error(
      `❌ [${label}] Auth action did not complete before timeout.\n` +
      `Started at: ${beforeUrl}\n` +
      `Current URL: ${currentUrl}\n` +
      `Page text: ${bodyText.slice(0, 1200)}`
    );
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
  console.log(`✅ [${label}] Signup/login completed on ${completedOn}: ${page.url()}`);
  return completedOn;
}

// ─────────────────────────────────────────────────────────────────
// LOGOUT HELPER FOR HOME PAGE POPUP RETRY
// Logs out the current user from the DAZN home page.
// Uses the profile menu → Sign Out → Log out confirmation flow.
// ─────────────────────────────────────────────────────────────────
export async function logoutForPopupRetry(
  page: any,
  baseUrl: string
): Promise<void> {
  console.log('🔓 [Home Page Popup] Logging out for retry...');

  if (!/\/home/i.test(page.url())) {
    await page.goto(`${baseUrl}/home`, { waitUntil: 'domcontentloaded' }).catch(() => { });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
  }

  const profileCandidates = [
    page.getByRole('button').filter({ hasText: /^[A-Z]$/ }).first(),
    page.locator('button').filter({ hasText: /^[A-Z]$/ }).first(),
    page.locator('[aria-haspopup="menu"]').first(),
    page.locator('[data-test-id*="user-menu" i], [data-test-id*="profile" i], [data-test-id*="avatar" i]').first(),
    page.locator('[aria-label*="account" i], [aria-label*="profile" i]').first(),
    page.locator('[class*="user-menu" i], [class*="avatar" i], [class*="profile" i]').first(),
  ];

  let menuOpened = false;
  for (const candidate of profileCandidates) {
    if (await candidate.isVisible({ timeout: 2000 }).catch(() => false)) {
      await candidate.click({ force: true });
      await page.waitForTimeout(800);
      const signOutVisible = await page.getByRole('menuitem', { name: /sign out|log out/i })
        .first()
        .isVisible({ timeout: 1500 })
        .catch(() => false);
      const fallbackVisible = await page.locator(
        'button:has-text("Sign Out"), button:has-text("Sign out"), button:has-text("Log out"), ' +
        'a:has-text("Sign Out"), a:has-text("Sign out"), a:has-text("Log out"), ' +
        '[role="menuitem"]:has-text("Sign Out"), [role="menuitem"]:has-text("Sign out"), [role="menuitem"]:has-text("Log out")'
      ).first().isVisible({ timeout: 500 }).catch(() => false);
      if (signOutVisible || fallbackVisible) {
        menuOpened = true;
        console.log('✅ [Home Page Popup] Opened profile menu for logout');
        break;
      }
    }
  }

  if (!menuOpened) {
    throw new Error(`❌ [Home Page Popup] Could not open profile menu for logout. URL: ${page.url()}`);
  }

  const signOutCandidates = [
    page.getByRole('menuitem', { name: /sign out/i }).first(),
    page.getByRole('menuitem', { name: /log out/i }).first(),
    page.locator(
      '[role="menuitem"]:has-text("Sign Out"), [role="menuitem"]:has-text("Sign out"), [role="menuitem"]:has-text("Log out"), ' +
      'button:has-text("Sign Out"), button:has-text("Sign out"), button:has-text("Log out"), ' +
      'a:has-text("Sign Out"), a:has-text("Sign out"), a:has-text("Log out")'
    ).first(),
  ];

  let signOutClicked = false;
  for (const candidate of signOutCandidates) {
    if (await candidate.isVisible({ timeout: 3000 }).catch(() => false)) {
      await candidate.click({ force: true });
      signOutClicked = true;
      console.log('✅ [Home Page Popup] Clicked Sign Out from profile menu');
      break;
    }
  }

  if (!signOutClicked) {
    throw new Error(`❌ [Home Page Popup] Sign Out menu item was not visible after opening profile menu. URL: ${page.url()}`);
  }

  const confirmCandidates = [
    page.getByRole('button', { name: /^Log out$/i }).first(),
    page.getByRole('button', { name: /^Sign out$/i }).first(),
    page.locator('button:has-text("Log out"), button:has-text("Sign out"), button:has-text("Sign Out")').first(),
  ];

  let confirmClicked = false;
  for (const candidate of confirmCandidates) {
    if (await candidate.isVisible({ timeout: 8000 }).catch(() => false)) {
      await candidate.click({ force: true });
      confirmClicked = true;
      console.log('✅ [Home Page Popup] Confirmed logout');
      break;
    }
  }

  if (!confirmClicked) {
    throw new Error(`❌ [Home Page Popup] Logout confirmation button was not visible. URL: ${page.url()}`);
  }

  await page.waitForURL(/welcome|signin|signup|account\/content\/.*signup/i, { timeout: 15000 }).catch(() => { });
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
  console.log(`✅ [Home Page Popup] Logged out via profile menu — on: ${page.url()}`);
}
