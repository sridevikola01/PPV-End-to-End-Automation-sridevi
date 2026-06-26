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
import { getHomeOfBoxingData, getHomePageData } from './excelReader';

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

  for (const selector of modalSelectors) {
    const modalLocator = page.locator(selector).filter({ has: page.locator(ctaSelector) }).first();
    try {
      await modalLocator.waitFor({ state: 'visible', timeout: 2500 });
      if (await modalLocator.isVisible().catch(() => false)) {
        foundModal = modalLocator;
        break;
      }
    } catch {
      // Not found with this selector, try next
    }
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
      // Load popup validation rules using getHomePageData or getHomeOfBoxingData
      let popupRules: any[] = [];
      try {
        if (src === 'home-page-dont-miss' || src === 'home-biggest-fights') {
          popupRules = getHomePageData(src);
        } else {
          popupRules = getHomeOfBoxingData('home-boxing-tile');
        }
      } catch (err: any) {
        console.warn(`⚠️ [Popup Check] Could not load sheet data: ${err.message}`);
      }

      if (popupRules.length > 0) {
        // Run validations
        try {
          const isHomeField = src === 'home-page-dont-miss' || src === 'home-biggest-fights';
          const pageName = isHomeField ? 'Home Page' : 'Popup Modal';
          const ruleFlow = isHomeField ? src : 'home-boxing-tile';
          const pageType = isHomeField ? 'home-page' : 'home-boxing';
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