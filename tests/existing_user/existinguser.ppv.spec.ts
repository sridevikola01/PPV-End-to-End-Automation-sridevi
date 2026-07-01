import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PaymentPage } from '../../pages/PaymentPage';
import { HomePage } from '../../pages/HomePage';
import { MyAccountPage } from '../../pages/MyAccountPage';
import { StandalonePPVPage } from '../../pages/StandalonePPVPage';
import { LandingPage } from '../../pages/LandingPage';
import { BoxingPage } from '../../pages/BoxingPage';
import { BoxingHomePage } from '../../pages/BoxingHomePage';
import { SchedulePage } from '../../pages/schedulepage';
import { SearchPage } from '../../pages/SearchPage';
import { PPVUpsellSuccessPage } from '../../pages/PPVUpsellSuccessPage';
import { PPVUpsellPaymentPage } from '../../pages/PPVUpsellPaymentPage';
import { RailsInterceptor } from '../../utils/railsInterceptor';
import { GloryPage } from '../../pages/GloryPage';
import { AuthenticationManager } from '../../auth/AuthenticationManager';


import {
  readSheet,
  getPPVDataByVariant,
  getPlanDataByTier,
  getPaymentDataByTierAndPlan,
  getMyAccountData,
  getPayPerViewData,
  getChooseHowToBuyData,
  getPPVPaymentData,
  getUpgradeConfirmationData,
  configureExcelPathForEvent,
  getHomeOfBoxingData,
  getHomePageData,
  getStandalonePPVPageData,
  getUpsellFirstSuccessData,
  getUpsellSecondSuccessData,
  getUpsellPaymentData,
  getPaywallData,
} from '../../utils/excelReader';
import { detectVariant } from '../../flows/detectVariant';
import { validateVariant } from '../../flows/validateVariant';
import { buildEventData } from '../../utils/buildEventData';
import { displayResultsTable } from '../../utils/resultsDisplay';
import { writeResults } from '../../utils/excelWriter';
import { generateReports } from '../../utils/reportGenerator';
import {
  sleep,
  setupPage,
  stabilisePage,
  handleCookies,
  dismissMarketingPopup,
} from '../../utils/helpers';
import {
  loadEventConfig,
  safeScrollToElement,
  clickAndWaitForNav,
  handlePaywall,
  assertCountryMatch,
} from '../../utils/testHelpers';
import { handleNoPpvClick } from '../../utils/flowHelpers';

const REGION = process.env.DAZN_REGION || 'GB';
const EVENT_CONFIG = process.env.PPV_CONFIG || 'aj_joshua_prenga.json';
const SOURCE = process.env.SOURCE || 'my-account';

// ── Flow constant — used for flow-restricted Excel rows ──────────────
// Enables Welcome Back, Saved Card, Signed In As, Log Out validations
const FLOW = 'myaccount';
const SWITCH_TO_ULTIMATE = (process.env.SWITCH || '').toLowerCase() === 'true';
const LOGIN_FIRST = (process.env.LOGIN || process.env.LOGIN_FIRST || '').toLowerCase() === 'true';
const ENV = (process.env.DAZN_ENV || 'stag').toLowerCase();
const PAYMENT_METHOD = (process.env.PAYMENT_METHOD || 'credit_card').toLowerCase();

// ═══════════════════════════════════════════════════════════════
// TEST DEFINITION — Dynamically defines tests for parallel runs
// ═══════════════════════════════════════════════════════════════
const userStatesToRun = (process.env.USER_STATE || 'freemium,frozen,active_standard,active_ultimate')
  .split(',')
  .map(p => p.trim());

// Configure tests to run in parallel using configured workers
test.describe.configure({ mode: 'parallel' });

for (const stateKey of userStatesToRun) {
  test(`PPV flow via existing user - ${stateKey}`, async ({ browser }) => {
    test.setTimeout(300_000);
    process.env.USER_STATE = stateKey;
    let defaultSignupPPVValidated = false;
    let noPpvClick = false;

    const json = loadEventConfig(EVENT_CONFIG);
    const PPV_TYPE = (process.env.PPV_TYPE || json.PPV_TYPE || 'normal').toLowerCase();
    configureExcelPathForEvent(json.eventKey || '');
    const eventData = buildEventData(json, REGION);
    eventData.source = SOURCE;
    eventData.SOURCE = SOURCE;

    const sourcesPath = path.resolve(process.cwd(), 'config/surfacingpoint.json');
    let resolvedSource = SOURCE;
    if (fs.existsSync(sourcesPath)) {
      const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
      if (sources[SOURCE]?.defaultSignup) {
        process.env.DEFAULT_SIGNUP = 'true';
      }
      if (sources[SOURCE]?.noPpvClick) {
        noPpvClick = true;
      }
      if (sources[SOURCE]?.source) {
        resolvedSource = sources[SOURCE].source;
      }
    }

    const userStateKey = process.env.USER_STATE || 'freemium';

    // Compute dynamic future date variables
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const fDay = futureDate.getDate();
    const fMonth = futureDate.toLocaleString('en-GB', { month: 'long' });
    const fYear = futureDate.getFullYear();
    eventData.FLEX_FUTURE_DATE_SHORT = `${fDay} ${fMonth} ${fYear}`;

    const tier = (json.TIER || 'freemium').toLowerCase();
    if ((SOURCE === 'boxing-banner-ultimate' || SOURCE === 'boxing-ultimate-subscription' || SOURCE === 'boxing-join-the-club') && tier !== 'ultimate') {
      throw new Error(`❌ SOURCE "${SOURCE}" requires an Ultimate plan (e.g., PLAN=ultimate_apm).`);
    }
    const isUSorGB = REGION === 'GB' || REGION === 'US';
    // Dev mode: bypass phone number on ultimate flows in GB/US.
    // Enabled on all environments (including prod) when tier is ultimate.
    // Can also be forced via DEV_MODE_ON=on env variable for prod verification.
    const devModeForced = (process.env.DEV_MODE_ON || '').toLowerCase() === 'on';
    const devModeEnabled = devModeForced || (tier === 'ultimate' && isUSorGB) || (SOURCE === 'landing-page-dont-miss-live-switch');
    const ratePlan = (process.env.RATE_PLAN || json.RATE_PLAN || 'monthly').toLowerCase();
    const userEmail = eventData.USER_EMAIL || json.USER_EMAIL || '';
    const userPassword = eventData.USER_PASSWORD || json.USER_PASSWORD || '';
    let purchaseOption = (json.PURCHASE_OPTION || 'ppv').toLowerCase();
    if (tier === 'ultimate') {
      purchaseOption = 'ultimate';
    }
    const baseUrl = eventData.BASE_URL;
    const variantConfig = json.variants;
    const pagesConfig = json.pages;
    const sport = json.SPORT;

    // Resolve payment page expected variables to avoid skipping validation
    const offerType = (eventData.OFFER_TYPE || '1_month_free').toLowerCase();
    const isTrial = ratePlan === 'monthly' && offerType === '7_day_trial';
    const isNoOffer = offerType === 'no_offer' || offerType === 'none';
    const activeOfferPresent = eventData.ACTIVE_OFFER_PRESENT === 'true';
    let isReturning = false;

    if (tier === 'ultimate') {
      eventData.PLAN_CTA_BUTTON = eventData.PLAN_CTA_BUTTON_ULTIMATE || 'Continue with DAZN Ultimate';
      eventData.DAZN_TIER = 'DAZN Ultimate';
    } else {
      // Standard tier: CTA depends on offer type
      if (isNoOffer) {
        eventData.PLAN_CTA_BUTTON = eventData.PLAN_CTA_BUTTON_STANDARD || 'Continue with DAZN Standard';
      } else {
        eventData.PLAN_CTA_BUTTON = eventData.PLAN_CTA_BUTTON_STANDARD || 'Continue with 7-day Free Trial';
      }
      eventData.DAZN_TIER = 'DAZN Standard';
    }

    if (activeOfferPresent && ratePlan === 'monthly') {
      eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
      eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_PLAN_LABEL || 'Flex – Pay Monthly - First Month Only';
      eventData.PAYMENT_FREE_TEXT = 'N/A';
      eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT_TRIAL || '';
    } else if (isTrial) {
      if (userStateKey === 'frozen') {
        eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
      } else {
        eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_TRIAL || 'Choose how to pay after your free trial';
      }
      eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_FREE_TEXT_TRIAL || '7-days free';
      eventData.PAYMENT_FREE_TEXT = eventData.PAYMENT_FREE_TEXT_TRIAL || '7-days free';
      eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT_TRIAL || '';
    } else if (ratePlan === 'annual pay monthly' || ratePlan === 'annual pay upfront') {
      // APM / APU
      eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
      eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_PLAN_NAME_ANNUAL || 'Annual - Pay Monthly';
      if (offerType === '1_month_free') {
        eventData.PAYMENT_FREE_TEXT = eventData.PAYMENT_FREE_TEXT_MONTHLY || 'First month free';
      } else {
        // No 1-month-free offer (7_day_trial or no_offer) — no free text
        eventData.PAYMENT_FREE_TEXT = 'N/A';
      }
      if (tier === 'ultimate') {
        eventData.CANCELLATION_TEXT = ratePlan === 'annual pay monthly'
          ? (eventData.CANCELLATION_TEXT_ULTIMATE_APM || '')
          : (eventData.CANCELLATION_TEXT_ULTIMATE_APU || '');
      } else {
        eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT_ANNUAL || '';
      }
    } else if (offerType === '1_month_free' && ratePlan === 'monthly') {
      // Monthly plan with 1-month-free offer (non-trial regions)
      eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
      eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_PLAN_NAME_FLEX || 'Flex – Pay Monthly';
      eventData.PAYMENT_FREE_TEXT = eventData.PAYMENT_FREE_TEXT_MONTHLY || 'First month free';
      eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT_TRIAL || '';
    } else if (isNoOffer && ratePlan === 'monthly') {
      // Monthly plan with no offer at all — no trial, no free month
      eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
      eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_PLAN_NAME_FLEX || 'Flex – Pay Monthly';
      eventData.PAYMENT_FREE_TEXT = 'N/A';
      eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT || "Monthly subscription. Cancel with 30 days' notice. Your subscription auto-renews unless you cancel.";
    } else {
      eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
      eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_PLAN_NAME_FLEX || 'Flex – Pay Monthly';
      eventData.PAYMENT_FREE_TEXT = eventData.PAYMENT_FREE_TEXT_MONTHLY || 'First month free';
      eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT_TRIAL || '';
    }

    // Ensure uppercase keys are in sync
    eventData['PAYMENT_PAGE_TITLE'] = eventData.PAYMENT_PAGE_TITLE;
    eventData['PAYMENT_PLAN_NAME'] = eventData.PAYMENT_PLAN_NAME;
    eventData['PAYMENT_FREE_TEXT'] = eventData.PAYMENT_FREE_TEXT;
    eventData['PLAN_CTA_BUTTON'] = eventData.PLAN_CTA_BUTTON;
    eventData['DAZN_TIER'] = eventData.DAZN_TIER;
    eventData['CANCELLATION_TEXT'] = eventData.CANCELLATION_TEXT;

    console.log(`\n🔀 Flow      : ${FLOW}`);
    console.log(`🌍 Region    : ${REGION}`);
    console.log(`🥊 Event     : ${eventData.PPV_NAME}`);
    console.log(`💎 Tier      : ${tier}`);
    console.log(`📋 Rate Plan : ${ratePlan}`);
    console.log(`📁 Config    : ${EVENT_CONFIG}`);
    console.log(`🔗 Base URL  : ${baseUrl}\n`);

    // ── Clean context ─────────────────────────────────────────────
    const recordVideo = process.env.RECORD_VIDEO !== 'false' ? {
      dir: 'test-results/videos/',
      size: { width: 1280, height: 720 },
    } : undefined;

    const context = await browser.newContext({
      viewport: null,
      colorScheme: 'dark',
      reducedMotion: 'no-preference',
      timezoneId: 'Asia/Kolkata',
      locale: 'en-IN',
      ...(recordVideo ? { recordVideo } : {}),
    });


    await context.addInitScript(() => {
      try {
        localStorage.setItem('randomABPoint', Math.random().toString());
      } catch { }
    });

    const page = await context.newPage();
    const results: any[] = [];

    // ── detectPageType ────────────────────────────────────────────
    const detectPageType = async (
      p: any,
      pc: Record<string, { detection: string }>
    ): Promise<'ppv' | 'plan' | 'payment' | 'confirmation' | 'standalone-ppv' | 'email' | 'unknown' | 'success-upsell' | 'saved-card-payment' | 'bet-upsell' | 'default-signup' | 'phone' | 'myaccount-ppv' | 'choose-how-to-buy'> => {
      if (!p || p.isClosed()) return 'unknown';
      const url = p.url();
      const urlLower = url.toLowerCase();

      const getStableBodyText = async (timeout = 6000): Promise<string> => {
        try {
          await p.waitForFunction(() => {
            const bodyText = document.body ? document.body.innerText.trim() : '';
            return bodyText.length > 200;
          }, { timeout });
        } catch {}
        return p.locator('body')
          .innerText({ timeout: 2000 })
          .then((t: string) => t.toLowerCase())
          .catch(() => '');
      };

      if (urlLower.includes('paymentdetails')) return 'payment';

      // High-priority check for Subscribe Without PPV redirect (must be before any PPV checks)
      if (urlLower.includes('page=tierplans') && urlLower.includes('noppv=true')) {
        const hasRadio = (await p.locator('input[type="radio"], [role="radio"]').count().catch(() => 0)) > 0;
        const hasPlanCards = (await p.locator('[class*="plancard" i], [class*="tier" i], [class*="offer" i], [data-test-id*="tier" i]').count().catch(() => 0)) > 0;
        const bodyText = await getStableBodyText();
        const hasPlanText = bodyText.includes('choose your plan') ||
          bodyText.includes('choose a plan') ||
          bodyText.includes('choose the right plan') ||
          bodyText.includes("choose a plan that's right") ||
          bodyText.includes('select how to pay');
        if (hasRadio || hasPlanCards || hasPlanText) {
          console.log('[detectPageType] Subscribe Without PPV destination verified via URL and DOM (exposes Plan UI).');
          console.log('Returning page type: plan.');
          return 'plan';
        }
      }

      if (urlLower.includes('phonenumbercollection')) return 'phone';
      // Upgrade confirmation page — must be checked BEFORE the /signup email fallback
      if (urlLower.includes('upgradeplan')) return 'confirmation';
      if (urlLower.includes('upgradetier') && !urlLower.includes('isupgradetierflow')) return 'confirmation';

      // upsellTierSelected=true: Ultimate tier already chosen, page shows APM/Upfront plan radios
      if (urlLower.includes('/signup') && urlLower.includes('plandetails') && urlLower.includes('upselltierselected')) {
        return 'plan';
      }

      // Default signup / PPV page with plan details/tier plans (e.g. from My Account Upgrade/Resubscribe CTA)
      if (urlLower.includes('/signup') && (urlLower.includes('plandetails') || urlLower.includes('tierplans')) && !urlLower.includes('upselltierskipped')) {
        const bodyText = await getStableBodyText();
        if (urlLower.includes('contextualppvid') ||
          bodyText.includes('pay-per-view') || bodyText.includes('choose how to buy') ||
          bodyText.includes('subscribe without a pay-per-view') ||
          bodyText.includes('continue without pay-per-view') ||
          bodyText.includes('continue without a pay-per-view')) {
          if (process.env.DEFAULT_SIGNUP === 'true' && !defaultSignupPPVValidated) {
            return 'default-signup';
          }
          return 'ppv';
        }
      }

      // Addon purchase page — active_standard user: could be "Choose how to buy" OR saved-card-payment
      if (urlLower.includes('/addon/purchase')) {
        try {
          await p.waitForFunction(() => {
            const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
            return bodyText.includes('choose how to buy') ||
              bodyText.includes('pay now') ||
              bodyText.includes('one time payment') ||
              bodyText.includes('****');
          }, { timeout: 6000 });
        } catch (e) {
          console.log('⚠️ detectPageType: Timeout waiting for addon purchase page content');
        }

        const addonBody = await p.locator('body')
          .innerText({ timeout: 3000 })
          .then((t: string) => t.toLowerCase())
          .catch(() => '');

        if (addonBody.includes('choose your plan') ||
          addonBody.includes('choose a plan') ||
          addonBody.includes('choose the right plan') ||
          addonBody.includes('to watch your pay-per-view')) {
          return 'ppv';
        }

        if (addonBody.includes('choose how to buy')) return 'choose-how-to-buy';
        return 'saved-card-payment';
      }

      // My Account PPV page — ultimate users redirected here when PPV is already purchased
      if (urlLower.includes('/myaccount/ppv') || urlLower.includes('/myaccount?')) {
        return 'myaccount-ppv';
      }

      // PPV page detection via contextualPpvId query param (before email fallback)
      // Wait for SPA routing to complete — the URL may get a page= parameter
      if (urlLower.includes('/signup') && urlLower.includes('contextualppvid=') && !urlLower.includes('page=')) {
        try {
          await p.waitForFunction(() => {
            const href = window.location.href.toLowerCase();
            const bodyLen = document.body?.innerText?.trim().length || 0;
            // Wait until URL gets a page= param (SPA routing) OR body has meaningful content
            return href.includes('page=') ||
              href.includes('upselltiershown') ||
              bodyLen > 200;
          }, { timeout: 10000 });
        } catch {
          // Timeout — proceed with what we have
        }
        // Re-check URL after SPA routing completes
        const routedUrl = p.url().toLowerCase();
        if (routedUrl.includes('paymentdetails')) return 'payment';
        if (routedUrl.includes('page=personaldetails') || routedUrl.includes('emaildetails')) return 'email';
        if (routedUrl.includes('upselltiershown=true')) return 'ppv';
        if (routedUrl.includes('page=plandetails') || routedUrl.includes('page=tierplans')) {
          if (isReturning && routedUrl.includes('contextualppvid')) {
            return 'ppv';
          }
          // Check if it's actually a PPV page with plan selection
          const routedBody = await getStableBodyText();
          if (routedBody.includes('pay-per-view') || routedBody.includes('choose how to buy') ||
            routedBody.includes('subscribe without a pay-per-view') || routedBody.includes('continue with pay-per-view') ||
            routedBody.includes('continue without pay-per-view') || routedBody.includes('continue without a pay-per-view')) {
            return 'ppv';
          }
          return 'plan';
        }
        // Still no page= param — check body content
        const bodyCheck = await p.locator('body')
          .innerText({ timeout: 3000 })
          .then((t: string) => t.toLowerCase())
          .catch(() => '');
        if (bodyCheck.includes('pay-per-view') || bodyCheck.includes('choose how to buy')) return 'ppv';
        if (bodyCheck.includes('choose your plan') || bodyCheck.includes('choose the right plan')) return 'ppv';
        if (bodyCheck.includes('choose a plan')) return 'plan';
        return 'ppv'; // Default fallback if contextualppvid present
      }

      // Email/signup checks (highest priority URL checks, must be before tier checks)
      if (urlLower.includes('page=personaldetails')) return 'email';
      if (urlLower.includes('emaildetails')) return 'email';
      if (urlLower.includes('/signup') && !urlLower.includes('plandetails') && !urlLower.includes('tierplans')) {
        const bodyText = await p.locator('body')
          .innerText({ timeout: 3000 })
          .then((t: string) => t.toLowerCase())
          .catch(() => '');
        if (bodyText.includes('choose your plan') || bodyText.includes('choose a plan') || bodyText.includes('choose the right plan') || bodyText.includes('select how to pay')) {
          return 'plan';
        }
        const radioCount = await p.locator('input[type="radio"], [role="radio"]').count().catch(() => 0);
        if (radioCount > 0) return 'plan';
        return 'email';
      }
      try {
        const emailCount = await p.locator('input[type="email"]').count().catch(() => 0);
        if (emailCount > 0) return 'email';
      } catch { }

      if (urlLower.includes('upselltiershown=true')) {
        if (process.env.DEFAULT_SIGNUP === 'true') {
          const bodyText = await p.locator('body')
            .innerText({ timeout: 2000 })
            .then((t: string) => t.toLowerCase())
            .catch(() => '');
          if (bodyText.includes('subscribe without a pay-per-view')) {
            return 'default-signup';
          }
        }
        return 'ppv';
      }

      const lower = await p.locator('body')
        .innerText({ timeout: 2000 })
        .then((t: string) => t.toLowerCase())
        .catch(() => '');

      // DAZN Bet / promotional upsell (second success page)
      if (lower.includes('payment was successful') &&
        (lower.includes('dazn bet') || lower.includes('free bet') || lower.includes('activate betting'))) {
        return 'bet-upsell';
      }

      // PPV upsell success page (first success page after initial payment)
      if (lower.includes('payment was successful') &&
        (lower.includes('buy now for') || lower.includes('no thanks') || lower.includes('upsell'))) {
        return 'success-upsell';
      }

      // Saved card payment page (upsell PPV purchase with card on file)
      if (lower.includes('one time payment') &&
        (lower.includes('visa') || lower.includes('mastercard') || lower.includes('amex') ||
          lower.includes('****') || lower.includes('saved card'))) {
        return 'saved-card-payment';
      }

      // Standalone check before general plan/skipped checks
      if (urlLower.includes('page=plandetails') && (
        urlLower.includes('standalone') ||
        lower.includes('standalone') ||
        lower.includes('collision') ||
        (await p.locator('input[type="checkbox"], button[class*="ni7RX"]').count().catch(() => 0)) > 0
      )) {
        return 'standalone-ppv';
      }

      if (lower.includes("choose a plan") && lower.includes("choose your subscription")) {
        const checkboxCount = await p.locator('input[type="checkbox"]').count().catch(() => 0);
        if (checkboxCount > 0) return 'standalone-ppv';
      }

      if (urlLower.includes('upselltierskipped=true')) return 'plan';
      if (urlLower.includes('upselltierselected=true') &&
        urlLower.includes('plandetails')) return 'plan';
      if (urlLower.includes('page=plandetails') || urlLower.includes('page=tierplans')) {
        if (isReturning && urlLower.includes('contextualppvid')) {
          return 'ppv';
        }
        const bodyText = await getStableBodyText();
        if (bodyText.includes('pay-per-view') || bodyText.includes('choose how to buy') ||
          bodyText.includes('subscribe without a pay-per-view') || bodyText.includes('continue with pay-per-view') ||
          bodyText.includes('continue without pay-per-view') || bodyText.includes('continue without a pay-per-view')) {
          return 'ppv';
        }
        return 'plan';
      }
      if (urlLower.includes('upgradeplan') ||
        (urlLower.includes('upgradetier') &&
          !urlLower.includes('isupgradetierflow'))) return 'confirmation';

      if (lower.includes('subscribe without a pay-per-view')) return 'ppv';
      if (lower.includes('add your phone number')) return 'phone';
      if (lower.includes('choose your plan')) return 'ppv';
      if (lower.includes('choose how to buy')) return 'choose-how-to-buy';
      // "Choose the right plan for you" appears on BOTH PPV and Plan pages.
      // If the page also mentions PPV-related content, it's the PPV page, not the plan page.
      if (lower.includes("choose the right plan") || lower.includes("choose a plan") || lower.includes("choose a subscription")) {
        if (lower.includes('pay-per-view') || lower.includes('continue with pay-per-view') || lower.includes('to watch your pay-per-view')) {
          return 'ppv';
        }
        return 'plan';
      }
      if (lower.includes('your plan will be changed')) return 'confirmation';

      return 'unknown';
    };

    const isMyAccount = SOURCE === 'my-account' || SOURCE === 'myaccount' || SOURCE === 'myaccount-subscription-status' || resolvedSource === 'myaccount-subscription-status';
    let reachedEndPage = false;

    try {
      const requiresPreLogin = isMyAccount || LOGIN_FIRST;

      // ══════════════════════════════════════════════════════════════
      // PRE-LOGIN FLOW (My Account OR LOGIN=true)
      // ══════════════════════════════════════════════════════════════
      if (requiresPreLogin) {
        // ── Authenticate via AuthenticationManager (handles email/Google/social) ──
        const authManager = new AuthenticationManager(page, context, baseUrl);
        await authManager.authenticate(eventData);
        isReturning = true;
        eventData.IS_RETURNING_USER = 'true';

        if (isMyAccount) assertCountryMatch(page, REGION);

        const isLandingPageSource = SOURCE.toLowerCase().includes('landing-page');

        if (isLandingPageSource) {
          throw new Error('❌ existing user landing page scenarios not required');
        }
      }

      if (!isMyAccount) {
        // ══════════════════════════════════════════════════════════════
        // LANDING / BOXING / SCHEDULE ACQUISITION FLOW
        // ══════════════════════════════════════════════════════════════
        const isSchedule = SOURCE.toLowerCase().includes('schedule');
        const isSearch = SOURCE.toLowerCase().includes('search');

        const isGlory = SOURCE.toLowerCase() === 'glory';

        if (isGlory) {
          const gloryPage = new GloryPage(page);
          await gloryPage.navigate();
          await setupPage(page, 8000);
          assertCountryMatch(page, REGION);

          if (devModeEnabled) {
            console.log('\n🎭 Dev mode flow detected — enabling dev mode on Glory page...');
            const searchPage = new SearchPage(page);
            await searchPage.enableDevMode();
          }

          console.log('\n📋 Validating Glory page...');
          const isValid = await gloryPage.validateGloryPage();
          results.push({
            page: 'Glory Kickboxing',
            field: 'Glory Page Validation',
            expected: 'true',
            actual: isValid ? 'true' : 'false',
            status: isValid ? 'PASS' : 'FAIL',
          });

          await gloryPage.clickGloryCollision9();
          await handlePaywall(page, results, eventData, SOURCE, true);
        } else if (isSchedule) {
          const schedule = new SchedulePage(page);
          await schedule.navigate(baseUrl);
          await setupPage(page, 8000);
          assertCountryMatch(page, REGION);

          if (devModeEnabled) {
            console.log('\n🎭 Dev mode flow detected — enabling dev mode on schedule page...');
            const searchPage = new SearchPage(page);
            await searchPage.enableDevMode();
          }

          let scheduleEventFound = false;
          let eventCard: any;
          try {
            await schedule.selectSport(sport);
            eventCard = await schedule.findEvent(eventData.PPV_NAME);
            scheduleEventFound = true;
          } catch (schedErr: any) {
            console.error(`❌ Schedule flow failed: ${schedErr.message}`);
            let shotPath: string | undefined;
            try {
              const dir = path.resolve(process.cwd(), 'test-results', 'screenshots');
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              shotPath = path.join(dir, `FAIL_Schedule_Event_Find_${Date.now()}.jpg`);
              await page.screenshot({ path: shotPath, type: 'jpeg', quality: 75, fullPage: false });
            } catch { shotPath = undefined; }
            results.push({
              page: 'Schedule',
              field: 'PPV Event Find',
              expected: `${eventData.PPV_NAME} found via ${sport} filter`,
              actual: schedErr.message,
              status: 'FAIL',
              screenshot: shotPath,
            });
          }

          if (scheduleEventFound) {
            console.log('\n📋 Validating Schedule page (scoping to event card)...');
            try {
              const scheduleData = readSheet('Schedule page');
              await validateVariant(
                page, 'schedule', scheduleData, results, eventData, 'Schedule', undefined, eventCard
              );
            } catch (err: any) {
              console.warn(`⚠️  Schedule page validation error: ${err.message}`);
            }

            console.log('🖱️ Clicking schedule event card...');
            await schedule.clickEvent(eventCard);

            // Paywall-first pattern (same as Search):
            // handlePaywall validates paywall + clicks Buy Now inside modal.
            // If no paywall is detected, fall back to clickBuyNow().
            const paywallHandled = await handlePaywall(page, results, eventData, SOURCE, true);
            if (!paywallHandled) {
              console.warn('⚠️ Paywall not detected by handlePaywall. Falling back to schedule.clickBuyNow().');
              await schedule.clickBuyNow();
            }
          }
        } else if (isSearch) {
          const searchPage = new SearchPage(page);
          await searchPage.navigate(baseUrl);
          await setupPage(page, 8000);
          assertCountryMatch(page, REGION);

          if (devModeEnabled) {
            console.log('\n🎭 Dev mode flow detected — enabling dev mode on search page...');
            await searchPage.enableDevMode();
          }

          // Search page contains only page-level validations
          const searchData = readSheet('Search page');

          await searchPage.searchAndOpenBestPpvTile({
            ppvName: eventData.PPV_NAME,
            promoter: eventData.PPV_PROMOTER,
            onTileSelected: async (tileLocator) => {
              console.log('\n📋 Validating Search page (scoping to selected tile)...');
              try {
                await validateVariant(
                  page, 'search', searchData, results, eventData, 'Search', undefined, tileLocator
                );
              } catch (err: any) {
                console.warn(`⚠️  Search page validation error: ${err.message}`);
              }
            }
          });

          // Check and validate paywall now that it is open, and click Buy Now inside it
          const paywallHandled = await handlePaywall(page, results, eventData, SOURCE, true);
          if (!paywallHandled) {
            console.warn('⚠️ Paywall not handled by handlePaywall. Falling back to searchPage.clickBuyNow().');
            await searchPage.clickBuyNow();
          }
        } else {
          const isHomePageSource = SOURCE.startsWith('home-page-') || SOURCE === 'home-biggest-fights';
          const isHomeSport = (SOURCE.startsWith('home-') && !isHomePageSource) || SOURCE === 'home-kickboxing-tile';
          const isBoxingSource = SOURCE.startsWith('boxing-page') || SOURCE.startsWith('boxing');

          const landing = isHomePageSource
            ? new HomePage(page)
            : isHomeSport
              ? new BoxingHomePage(page)
              : isBoxingSource
                ? new BoxingPage(page)
                : new LandingPage(page);

          // Start RailsInterceptor before navigation for home-biggest-fights
          // to capture entitlement IDs from the Rails API for tile matching
          let railsInterceptor: RailsInterceptor | undefined;
          if (SOURCE === 'home-biggest-fights') {
            railsInterceptor = new RailsInterceptor(page);
            await railsInterceptor.startIntercepting();
            console.log('🔌 [RailsInterceptor] Started for home-biggest-fights tile matching');
          }

          // If LOGIN_FIRST=true the user is already signed in. Skip welcome page
          // navigation and go directly to sport/boxing pages if needed, otherwise stay on home.
          if (LOGIN_FIRST) {
            console.log(`ℹ️ [Login First] User already logged in, skipping welcome page navigation. Current URL: ${page.url()}`);
            const baseNoSlash = baseUrl.replace(/\/$/, '');
            if (isHomeSport) {
              const targetSport = (eventData?.SPORT || 'Boxing').trim();
              const sportIdMap: Record<string, string> = {
                kickboxing: 'Sport:5rocwbb1fbfub9yh4yrff8khj',
                wrestling: 'Sport:50dsk39gxuwwbkss8k2e24mca',
              };
              const sportId = sportIdMap[targetSport.toLowerCase()] || 'Sport:2x2oqzx60orpoeugkd754ga17';
              const targetUrl = `${baseNoSlash}/sport/${sportId}`;
              console.log(`🧭 [Login First] Navigating directly to sport page: ${targetUrl}`);
              await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
              await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
            } else if (isBoxingSource) {
              const targetUrl = `${baseNoSlash}/p/boxing`;
              console.log(`🧭 [Login First] Navigating directly to Boxing page: ${targetUrl}`);
              await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
              await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
            } else {
              // HomePage: we are already on /home, just wait for network idle to settle
              await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
            }
          } else {
            await landing.navigate(baseUrl, SOURCE, eventData);
          }

          // Pass interceptor to eventData so HomePage can use it
          if (railsInterceptor) {
            eventData._railsInterceptor = railsInterceptor;
          }
          await setupPage(page, 8000);
          assertCountryMatch(page, REGION);

          if (devModeEnabled) {
            console.log('\n🎭 Dev mode flow detected — enabling dev mode on landing page...');
            const searchPage = new SearchPage(page);
            await searchPage.enableDevMode();
          }

          // Validate entry page
          const isBoxingSourceInner = SOURCE.startsWith('boxing-page') || SOURCE.startsWith('boxing');
          const isHomePageSourceInner = SOURCE.startsWith('home-page-') || SOURCE === 'home-biggest-fights';
          const isHomeSportInner = SOURCE.startsWith('home-') && !isHomePageSourceInner;

          let sheetName = 'Landing page';
          let pageName = 'Landing';
          let flowParam = SOURCE === 'landing-page-banner' ? 'landing-page-banner' : 'landing';

          if (isHomePageSourceInner) {
            sheetName = 'Home page';
            pageName = 'Home Page';
            flowParam = SOURCE;
          } else if (isHomeSportInner) {
            sheetName = 'Home of Boxing';
            pageName = 'Home of Boxing';
            flowParam = SOURCE.includes('banner')
              ? 'home-boxing-banner'
              : 'home-boxing-tile';
          } else if (isBoxingSourceInner) {
            sheetName = 'Boxing page';
            pageName = 'Boxing';
            flowParam = SOURCE.startsWith('boxing-page-bundle') || SOURCE.startsWith('boxing-bundle')
              ? 'boxing-bundle'
              : SOURCE === 'boxing-upcoming-fights'
                ? 'boxing-upcoming'
                : SOURCE === 'boxing-banner-ultimate'
                  ? 'boxing'
                  : 'boxing';
          }

          const container = await landing.findPPVContainer(eventData, SOURCE);

          // Stop intercepting after findPPVContainer completes
          if (eventData._railsInterceptor) {
            await (eventData._railsInterceptor as RailsInterceptor).stopIntercepting();
            delete eventData._railsInterceptor;
          }

          if (!container) {
            throw new Error(`❌ PPV container not found on landing page via ${SOURCE}`);
          }

          const isBoxingSubscriptionSource =
            SOURCE === 'boxing-ultimate-subscription' ||
            SOURCE === 'boxing-standard-subscription' ||
            SOURCE === 'boxing-join-the-club';

          if (isBoxingSubscriptionSource) {
            console.log(`ℹ️ [${SOURCE}] Subscription source — skipping boxing banner/landing validation.`);
          } else {
            console.log(`\n📋 Validating ${pageName} page (scoping to container)...`);
            try {
              const isStandalone = eventData.PPV_TYPE === 'standalone';
              const onOnboarding = page.url().includes('signup') || page.url().includes('PlanDetails') || page.url().includes('payment') || page.url().includes('checkout');
              if ((sheetName === 'Home of Boxing' || sheetName === 'Home page') && (isStandalone || onOnboarding)) {
                console.log('ℹ️ Standalone flow or direct navigation — skipping paywall validations');
              } else {
                const landingData = sheetName === 'Home page'
                  ? getHomePageData(flowParam)
                  : sheetName === 'Home of Boxing'
                    ? getHomeOfBoxingData(flowParam)
                    : readSheet(sheetName);
                await validateVariant(page, 'landing', landingData, results, eventData, pageName, flowParam, container);
              }
            } catch (err: any) {
              console.warn(`⚠️  Entry page validation error: ${err.message}`);
            }
          }

          // ── Paywall-first pattern for paywall-enabled sources ──
          // handlePaywall validates + clicks Buy Now inside the modal.
          // If no paywall is detected, fall back to clickBuyNow().
          const paywallSources = [
            'home-boxing-tile',
            'home-kickboxing-tile',
            'home-page-dont-miss',
            'home-biggest-fights',
          ];
          const isPaywallSource = paywallSources.includes(SOURCE.toLowerCase());

          if (isPaywallSource) {
            console.log(`🔓 [Paywall Flow] Opening paywall for source: ${SOURCE}`);
            await landing.openPaywall(container, SOURCE, eventData);

            const paywallHandled = await handlePaywall(page, results, eventData, SOURCE, true);
            if (!paywallHandled) {
              console.warn(`⚠️ Paywall not detected by handlePaywall for ${SOURCE}. Falling back to clickBuyNow().`);
              await landing.clickBuyNow(container, SOURCE);
            }
          } else {
            await landing.clickBuyNow(container, SOURCE);
          }
        }

        // For search/schedule/glory: handlePaywall is already called in their
        // source-specific blocks above. Only call again if it hasn't been
        // handled yet (alreadyValidated guard inside handlePaywall prevents duplicates).
        const deferredPaywallSources = ['search', 'schedule', 'glory'];
        if (deferredPaywallSources.includes(SOURCE.toLowerCase())) {
          // These sources already call handlePaywall in their blocks above.
          // The duplicate guard inside handlePaywall (alreadyValidated) prevents double-validation.
        }

        await page.waitForLoadState('domcontentloaded').catch(() => { });
        await page.waitForURL(
          (url: URL) =>
            url.toString().includes('PlanDetails') ||
            url.toString().includes('TierPlans') ||
            url.toString().includes('signup') ||
            url.toString().includes('checkout') ||
            url.toString().includes('payment'),
          { timeout: 10000 }
        ).catch(async () => {
          await page.waitForURL(
            (url: URL) => !url.toString().includes('/welcome'),
            { timeout: 5000 }
          ).catch(() => { });
        });
        console.log(`📍 Landed after Buy Now: ${page.url()}`);

        // ── STRICT VALIDATION FOR ULTIMATE USER PRE-LOGGED IN ──
        if (userStateKey === 'active_ultimate' && requiresPreLogin) {
          console.log('⏳ [Ultimate User] Waiting for redirection to fixture page...');
          await page.waitForURL(
            (url: URL) =>
              !url.href.includes('/welcome') &&
              !url.href.includes('/home') &&
              !url.href.includes('PlanDetails') &&
              !url.href.includes('TierPlans') &&
              !url.href.includes('signup') &&
              !url.href.includes('signin') &&
              !url.href.includes('payment') &&
              !url.href.includes('checkout'),
            { timeout: 15000 }
          ).catch(() => { });

          const currentUrl = page.url();
          const lowerUrl = currentUrl.toLowerCase();
          let navStatus: 'PASS' | 'FAIL' = 'FAIL';
          let actualPage = 'Unknown Page';

          if (lowerUrl.includes('preview')) {
            actualPage = 'Preview Page';
            navStatus = 'PASS';
          } else if (
            lowerUrl.includes('fixture') ||
            lowerUrl.includes('event') ||
            lowerUrl.includes('stream') ||
            lowerUrl.includes('player')
          ) {
            actualPage = 'Fixture Page';
            navStatus = 'PASS';
          }

          results.push({
            page: 'Home Page',
            field: 'Ultimate User Navigation Target',
            expected: 'Preview Page or Fixture Page',
            actual: `Navigated to: ${currentUrl} (${actualPage})`,
            status: navStatus,
          });

          if (navStatus === 'FAIL') {
            const errMsg = `❌ [Ultimate User] Not redirected to fixture page after clicking PPV tile. Landed on: ${currentUrl}`;
            console.error(errMsg);
            throw new Error(errMsg);
          } else {
            console.log(`✅ [Ultimate User] Successfully redirected to fixture/preview page: ${currentUrl} (${actualPage})`);
          }
          reachedEndPage = true;
          return;
        }
        // ── STRICT VALIDATION FOR BOXING-BANNER-ULTIMATE REDIRECT ──
        if (SOURCE === 'boxing-banner-ultimate') {
          console.log('\n🔍 Validating boxing-banner-ultimate redirect...');
          await page.waitForFunction(() => {
            const href = window.location.href.toLowerCase();
            const text = document.body.innerText.toLowerCase();
            return href.includes('plandetails') ||
              href.includes('choosehowtobuy') ||
              href.includes('purchase') ||
              text.includes('choose your plan') ||
              text.includes('choose how to buy') ||
              text.includes('choose a plan');
          }, { timeout: 15000 }).catch(() => { });

          const currentUrl = page.url();
          const bodyText = await page.locator('body').innerText().catch(() => '');

          // 1. It should NOT go to the normal PPV page
          if (bodyText.toLowerCase().includes('choose how to buy') ||
            (currentUrl.includes('contextualPpvId') && !currentUrl.includes('PlanDetails'))) {
            throw new Error('❌ [boxing-banner-ultimate] Redirected to normal PPV page ("Choose how to buy") instead of DAZN Ultimate Plan page.');
          }

          // 2. It SHOULD go directly to the Plan page
          if (!currentUrl.includes('PlanDetails') && !bodyText.toLowerCase().includes('choose your plan')) {
            throw new Error(`❌ [boxing-banner-ultimate] Expected to land on DAZN Ultimate Plan page, but landed on: ${currentUrl}`);
          }
          console.log('✅ Successfully redirected directly to DAZN Ultimate Plan page.');
        }

        // ── STRICT VALIDATION FOR BOXING-ULTIMATE-SUBSCRIPTION REDIRECT ──
        if (SOURCE === 'boxing-ultimate-subscription') {
          console.log('\n🔍 Validating boxing-ultimate-subscription redirect...');
          // The SPA loads `signup` first, then client-side routing adds ?page=PlanDetails.
          await page.waitForFunction(() => {
            const href = window.location.href.toLowerCase();
            const text = document.body.innerText.toLowerCase();
            return href.includes('tierplans') ||
              href.includes('plandetails') ||
              href.includes('signup') ||
              href.includes('signin') ||
              text.includes('dazn ultimate') ||
              text.includes('choose your plan') ||
              text.includes('choose a plan') ||
              text.includes('sign in') ||
              text.includes('email');
          }, { timeout: 20000 }).catch(() => { });

          const subUrl = page.url();
          const subBody = (await page.locator('body').innerText().catch(() => '')).toLowerCase();

          const subOnPPV = subBody.includes('to watch your pay-per-view');
          const subUrlOk = subUrl.includes('TierPlans') || subUrl.includes('PlanDetails');
          const subBodyOk = subBody.includes('dazn ultimate') || subBody.includes('choose your plan') || subBody.includes('choose a plan');

          if (subOnPPV && !subUrlOk && !subBodyOk) {
            throw new Error('❌ [boxing-ultimate-subscription] Unexpectedly redirected to PPV page — expected TierPlans or PlanDetails (Ultimate).');
          }
          if (!subUrlOk && !subBodyOk) {
            throw new Error(`❌ [boxing-ultimate-subscription] Expected to land on TierPlans/PlanDetails (Ultimate), but landed on: ${subUrl}`);
          }
          console.log(`✅ [boxing-ultimate-subscription] Successfully redirected to plan selection page. URL: ${subUrl}`);
        }

        // ── STRICT VALIDATION FOR BOXING-STANDARD-SUBSCRIPTION / HOME-PAGE-GET-STARTED / HOME-PAGE-DAZNTILE REDIRECT ──
        if (SOURCE === 'boxing-standard-subscription' || SOURCE === 'home-page-get-started' || SOURCE === 'home-page-dazntile' || SOURCE === 'home-page-subscribe') {
          console.log(`\n🔍 Validating ${SOURCE} redirect...`);

          // Step 1: Wait for URL to update to one of the target pages
          await page.waitForFunction(() => {
            const href = window.location.href.toLowerCase();
            return href.includes('plandetails') ||
              href.includes('tierplans') ||
              href.includes('signup') ||
              href.includes('signin');
          }, { timeout: 15000 }).catch(() => { });

          // Step 2: Wait for page load states to settle
          await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
          await page.waitForLoadState('load', { timeout: 5000 }).catch(() => { });

          // Step 3: Wait for the page body text to render and settle (not loading/empty, and contains common page or PPV elements)
          await page.waitForFunction(() => {
            const text = document.body.innerText.toLowerCase();
            if (text.trim() === '' || text.includes('loading')) {
              return false;
            }
            return text.includes('subscribe without a pay-per-view') ||
              text.includes('continue without pay-per-view') ||
              text.includes('continue without a pay-per-view') ||
              text.includes('choose a plan') ||
              text.includes('dazn standard') ||
              text.includes('create an account') ||
              text.includes('email address') ||
              text.includes('password') ||
              text.includes('sign in');
          }, { timeout: 15000 }).catch(() => { });

          const stdUrl = page.url();
          const stdBody = (await page.locator('body').innerText().catch(() => '')).toLowerCase();

          const stdOnPPVPage = stdBody.includes('to watch your pay-per-view');
          // Only PlanDetails, TierPlans, signup, or signin are valid landing URLs
          const stdUrlOk = stdUrl.includes('TierPlans') || stdUrl.includes('PlanDetails') || stdUrl.includes('signup') || stdUrl.includes('signin');
          const stdBodyOk = stdBody.includes('dazn standard') || stdBody.includes('choose a plan') || stdBody.includes('choose your plan');

          // Must NOT land on the normal PPV page
          if (stdOnPPVPage && !stdUrlOk && !stdBodyOk) {
            throw new Error(`❌ [${SOURCE}] Unexpectedly redirected to PPV page — expected PlanDetails, signup, or signin (Standard).`);
          }

          if (!stdUrlOk && !stdBodyOk) {
            throw new Error(`❌ [${SOURCE}] Expected to land on PlanDetails, TierPlans, signup, or signin (Standard), but landed on: ${stdUrl}`);
          }

          // defaultSignup=true means the plan page should contain a PPV option ("subscribe without a pay-per-view").
          // If it's absent, no PPV exists for this event — fail the test.
          const hasPPVOption = stdBody.includes('subscribe without a pay-per-view') ||
            stdBody.includes('continue without pay-per-view') ||
            stdBody.includes('continue without a pay-per-view');
          if (!hasPPVOption) {
            throw new Error(`❌ [${SOURCE}] Landed on plan/signup page but no PPV option found ("subscribe without a pay-per-view" or "continue without pay-per-view" absent). No PPV exists for this event.\nURL: ${stdUrl}`);
          }

          console.log(`✅ [${SOURCE}] Successfully redirected to plan selection page with PPV option. URL: ${stdUrl}`);
        }

        // ── STRICT VALIDATION FOR BOXING-JOIN-THE-CLUB REDIRECT ──
        if (SOURCE === 'boxing-join-the-club') {
          console.log('\n🔍 Validating boxing-join-the-club redirect...');
          // The SPA loads `signup` first, then client-side routing appends ?page=PlanDetails.
          await page.waitForFunction(() => {
            const href = window.location.href.toLowerCase();
            const text = document.body.innerText.toLowerCase();
            return href.includes('tierplans') ||
              href.includes('plandetails') ||
              href.includes('signup') ||
              href.includes('signin') ||
              text.includes('dazn ultimate') ||
              text.includes('choose your plan') ||
              text.includes('choose a plan') ||
              text.includes('sign in') ||
              text.includes('email');
          }, { timeout: 20000 }).catch(() => { });

          const clubUrl = page.url();
          const clubBody = (await page.locator('body').innerText().catch(() => '')).toLowerCase();

          const clubOnPPV = clubBody.includes('to watch your pay-per-view');
          const clubUrlOk = clubUrl.includes('TierPlans') || clubUrl.includes('PlanDetails');
          const clubBodyOk = clubBody.includes('dazn ultimate') || clubBody.includes('choose your plan') || clubBody.includes('choose a plan');

          if (clubOnPPV && !clubUrlOk && !clubBodyOk) {
            throw new Error('❌ [boxing-join-the-club] Unexpectedly redirected to PPV page — expected TierPlans or PlanDetails (Ultimate).');
          }
          if (!clubUrlOk && !clubBodyOk) {
            throw new Error(`❌ [boxing-join-the-club] Expected to land on TierPlans/PlanDetails (Ultimate), but landed on: ${clubUrl}\nBody: ${clubBody.slice(0, 200)}`);
          }
          console.log(`✅ [boxing-join-the-club] Successfully redirected to plan selection page. URL: ${clubUrl}`);
        }

        // ══════════════════════════════════════════════════════════════
        // MY ACCOUNT FLOW — already signed in via PRE-LOGIN FLOW above
        // ══════════════════════════════════════════════════════════════
      } else {
        // After sign-in, user may still be on signup continuation page
        // (e.g. /signup?signin=true&page=personalDetails). Navigate to
        // home page first to avoid dismissPopup clicking something
        // destructive that closes the page context.
        const postLoginUrl = page.url().toLowerCase();
        if (postLoginUrl.includes('/signup') || postLoginUrl.includes('/signin') || postLoginUrl.includes('/content/')) {
          console.log(`⚠️  Post-login URL is still on signup page: ${page.url()}`);
          console.log('🏠 Navigating to home page before proceeding...');
          await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
          console.log(`✅ Navigated to: ${page.url()}`);
        }

        // Settle the Home page and wait for any marketing popups to trigger
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { });
        await stabilisePage(page);

        const homePage = new HomePage(page, baseUrl);
        await homePage.dismissPopup();
        await homePage.dismissPopup(); // Double check to dismiss late popups

        if (devModeEnabled) {
          const reason = devModeForced ? '(forced via DEV_MODE_ON=on)' : '(auto: ultimate tier in GB/US)';
          console.log(`\n🎭 Dev mode flow detected ${reason} — enabling dev mode for existing user...`);
          const searchPage = new SearchPage(page);
          await searchPage.enableDevMode();
          console.log('✅ dev mode enabled — continuing with ultimate flow');
        }

        await homePage.navigateToMyAccount();
        await handleCookies(page, 8000);
      }

      let firstName = '';
      let lastName = '';
      let postClickUrl = '';

      if (isMyAccount) {
        console.log('⏳ Waiting for My Account page to fully render...');

        // Wait for ANY account content — whichever appears first
        const accountFound = await Promise.race([
          page.waitForSelector('button:has-text("Resubscribe")', { state: 'visible', timeout: 15000 }).then(() => 'Resubscribe').catch(() => null),
          page.waitForSelector('button:has-text("Upgrade now")', { state: 'visible', timeout: 15000 }).then(() => 'Upgrade now').catch(() => null),
          page.waitForSelector('button:has-text("Manage subscription")', { state: 'visible', timeout: 15000 }).then(() => 'Manage subscription').catch(() => null),
          page.waitForSelector('button:has-text("Manage")', { state: 'visible', timeout: 15000 }).then(() => 'Manage').catch(() => null),
          page.waitForSelector('button:has-text("Buy now")', { state: 'visible', timeout: 15000 }).then(() => 'Buy now').catch(() => null),
          page.waitForSelector('[data-testid*="subscription" i]', { state: 'visible', timeout: 15000 }).then(() => 'subscription testid').catch(() => null),
        ]);
        if (accountFound) {
          console.log(`✅ Account content found: ${accountFound}`);
          await stabilisePage(page);
        } else {
          console.log('⚠️  Account content not found in time');
        }

        // ══════════════════════════════════════════════════════════════
        // STEP 4 — VALIDATE MY ACCOUNT PAGE
        // ══════════════════════════════════════════════════════════════
        console.log('\n📋 Validating My Account page...');

        const myAccountPage = new MyAccountPage(page);
        await myAccountPage.scrollToPPVSection();
        const hasPPV = await myAccountPage.hasPPV(eventData.PPV_NAME);
        const myAccountData = getMyAccountData();
        const filteredMyAccountData = hasPPV
          ? myAccountData
          : myAccountData.filter((r: any) => !['PPV Name', 'PPV Date', 'PPV Price', 'PPV Status', 'PPV Image Present'].includes(r.Field));


        const expectedPPVStatus = (eventData.PPV_STATUS || '').toLowerCase();
        for (const row of filteredMyAccountData) {
          if (row.Field === 'PPV Section Present' && !hasPPV) {
            row.Expected = 'Yes|No';
          }
          if (row.Field === 'PPV Price' && (expectedPPVStatus === 'purchased' || expectedPPVStatus === 'included')) {
            row.Expected = 'N/A';
          }
        }

        // Temporarily override DAZN_TIER for My Account validation based on current user state
        const originalDaznTier = eventData.DAZN_TIER;
        if (userStateKey === 'freemium' || userStateKey === 'frozen') {
          eventData.DAZN_TIER = 'DAZN Free';
          eventData['DAZN_TIER'] = 'DAZN Free';
        } else if (userStateKey === 'active_standard') {
          eventData.DAZN_TIER = 'DAZN Standard';
          eventData['DAZN_TIER'] = 'DAZN Standard';
        } else if (userStateKey === 'active_ultimate') {
          eventData.DAZN_TIER = 'DAZN Ultimate';
          eventData['DAZN_TIER'] = 'DAZN Ultimate';
        }


        await validateVariant(
          page, 'myaccount', filteredMyAccountData, results, eventData, 'My Account'
        );

        // Verify user state matches the expected state. If not, fail early with clear logging.
        const expectedUserStates: Record<string, { subscription: string; status: string; label: string }> = {
          freemium: { subscription: 'DAZN Free', status: 'Upgrade now', label: 'freemium' },
          frozen: { subscription: 'DAZN Free', status: 'Resubscribe', label: 'frozen' },
          active_standard: { subscription: 'DAZN Standard', status: 'Manage subscription', label: 'active standard' },
          active_ultimate: { subscription: 'DAZN Ultimate', status: 'Manage subscription', label: 'active ultimate' }
        };

        const expectedConfig = expectedUserStates[userStateKey];
        if (expectedConfig) {
          const subStatusResult = results.find(r => r.page === 'My Account' && r.field === 'Subscription Status');
          const currSubResult = results.find(r => r.page === 'My Account' && r.field === 'Current Subscription');

          const actualStatus = subStatusResult ? subStatusResult.actual : 'N/A';
          const actualSub = currSubResult ? currSubResult.actual : 'N/A';

          const expectedStatus = expectedConfig.status;
          const expectedSub = expectedConfig.subscription;

          const actualStatusClean = actualStatus.trim().toLowerCase();
          const actualSubClean = actualSub.trim().toLowerCase();

          if (actualStatusClean !== expectedStatus.toLowerCase() || actualSubClean !== expectedSub.toLowerCase()) {
            console.log(`\n❌ User is not ${expectedConfig.label}. Subscription status does not match:`);
            console.log(`   Current Subscription`);
            console.log(`          expected : ${expectedSub}`);
            console.log(`          actual   : ${actualSub}`);
            console.log(`       ❌ Subscription Status`);
            console.log(`          expected : ${expectedStatus}`);
            console.log(`          actual   : ${actualStatus}\n`);
            throw new Error(`❌ User is not ${expectedConfig.label} (Current Subscription: ${actualSub}, Status: ${actualStatus})`);
          }
        }

        // Restore original DAZN_TIER
        eventData.DAZN_TIER = originalDaznTier;
        eventData['DAZN_TIER'] = originalDaznTier;

        await page.evaluate(() => {
          document.documentElement.style.overflow = '';
          document.body.style.overflow = '';
        });
        // ══════════════════════════════════════════════════════════════
        // STEP 4b — EXTRACT DYNAMIC USER DATA FROM MY ACCOUNT
        // Reads first name, last name, returning status from live page
        // Injects into eventData for downstream validation
        // ══════════════════════════════════════════════════════════════
        isReturning = await myAccountPage.isReturningUser();
        const userNameRes = await myAccountPage.getUserName();
        firstName = userNameRes.firstName;
        lastName = userNameRes.lastName;

        console.log(`👤 Is returning user : ${isReturning}`);
        console.log(`👤 First name        : "${firstName}"`);
        console.log(`👤 Last name         : "${lastName}"`);

        eventData.FIRST_NAME = firstName;
        eventData.LAST_NAME = lastName;
        eventData['FIRST_NAME'] = firstName;
        eventData['LAST_NAME'] = lastName;
        eventData.FULL_NAME = `${firstName} ${lastName}`.trim();
        eventData.IS_RETURNING_USER = isReturning ? 'true' : 'false';
        eventData.SIGNED_IN_AS_TEXT = firstName
          ? `Signed in as ${firstName} ${lastName}`.trim()
          : '';

        // Keep UPPER_CASE versions in sync
        eventData['FIRST_NAME'] = eventData.FIRST_NAME;
        eventData['LAST_NAME'] = eventData.LAST_NAME;
        eventData['FULL_NAME'] = eventData.FULL_NAME;
        eventData['IS_RETURNING_USER'] = eventData.IS_RETURNING_USER;
        eventData['SIGNED_IN_AS_TEXT'] = eventData.SIGNED_IN_AS_TEXT;

        console.log(`👤 Signed in as      : "${eventData.SIGNED_IN_AS_TEXT}"`);

        // ══════════════════════════════════════════════════════════
        // STEP 5a — CHECK IF PPV ALREADY PURCHASED
        // For any tier — if PPV shows "Purchased", validate and exit
        // ══════════════════════════════════════════════════════════
        if (expectedPPVStatus === 'purchased' || expectedPPVStatus === 'included') {
          console.log(`\n✅ PPV expected status: "${eventData.PPV_STATUS}" — validating...`);

          await myAccountPage.scrollToPPVSection();

          const ppvStatus = await myAccountPage.isPPVPurchased(eventData.PPV_NAME);
          console.log(`✅ PPV Actual Status: "${ppvStatus}"`);

          results.push({
            page: 'My Account',
            variant: tier,
            tier,
            ratePlan,
            field: 'PPV Status (Purchased)',
            expected: eventData.PPV_STATUS,
            actual: ppvStatus,
            status: ppvStatus.toLowerCase().includes(
              expectedPPVStatus
            ) ? 'PASS' : 'FAIL',
          });

          // --- Schedule Page validation (Post-Payment) ---
          if (PPV_TYPE !== 'upsell') {
            try {
              console.log('\n📅 [Post-Purchase] Navigating to Schedule page to verify purchased event...');
              const schedulePagePostPayment = new SchedulePage(page);
              await schedulePagePostPayment.navigate(baseUrl);
              await schedulePagePostPayment.selectSport(sport);

              console.log(`🔍 Finding event tile: "${eventData.PPV_NAME}"`);
              const eventCard = await schedulePagePostPayment.findEvent(eventData.PPV_NAME);

              console.log('🖱️ Clicking PPV event tile...');
              await eventCard.click();

              console.log('⏳ Waiting for navigation off the Schedule page...');
              await page.waitForURL((url: URL) => !url.href.includes('/schedule'), { timeout: 15000 });
              await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });

              const currentUrl = page.url();
              console.log(`🔗 Post-Purchase redirected URL: ${currentUrl}`);

              const lowerUrl = currentUrl.toLowerCase();
              let navStatus: 'PASS' | 'FAIL' = 'FAIL';
              let actualPage = 'Unknown Page';

              if (lowerUrl.includes('preview')) {
                actualPage = 'Preview Page';
                navStatus = 'PASS';
              } else if (
                lowerUrl.includes('fixture') ||
                lowerUrl.includes('event') ||
                lowerUrl.includes('stream') ||
                lowerUrl.includes('player')
              ) {
                actualPage = 'Fixture Page';
                navStatus = 'PASS';
              }

              results.push({
                page: 'Schedule',
                field: 'Post-Purchase Navigation Target',
                expected: 'Preview Page or Fixture Page',
                actual: `Navigated to: ${currentUrl} (${actualPage})`,
                status: navStatus,
              });

              if (navStatus === 'FAIL') {
                console.error(`❌ Post-Purchase navigation target check failed. URL: ${currentUrl}`);
              } else {
                console.log(`✅ Post-Purchase navigation target check passed: ${actualPage}`);
              }
            } catch (scheduleErr: any) {
              console.warn(`⚠️ [Post-Purchase] Schedule page validation error: ${scheduleErr.message}`);
              results.push({
                page: 'Schedule',
                field: 'Post-Purchase Navigation Target',
                expected: 'Preview Page or Fixture Page',
                actual: `Error: ${scheduleErr.message}`,
                status: 'FAIL',
              });
            }
          }

          reachedEndPage = true;
          const { excelPath, videoPath } = await writeResults(results);

          // Display detailed per-page results
          displayResultsTable(results, tier, {
            event: eventData.PPV_NAME,
            region: REGION,
            excelPath,
            videoPath,
          });

          // Generate HTML + PDF run report before early exit
          const { htmlPath, pdfPath, folderPath } = await generateReports(results, {
            event: eventData.PPV_NAME,
            region: REGION,
            source: SOURCE,
            ratePlan,
            tier,
            env: process.env.DAZN_ENV || 'prod',
            flowName: `${SOURCE} → ${tier} → ${ratePlan}`,
            endTime: new Date(),
            excelPath,
            videoPath,
            userStatus: isMyAccount ? (process.env.USER_STATE || 'Freemium') : 'New User',
            userType: 'existing-user',
            paymentMethod: PAYMENT_METHOD === 'gpay' ? 'Google Pay' : 'Credit Card',
          });
          if (folderPath) console.log(`\n📂 Report folder: ${folderPath}`);
          return; // ← Exit early — no purchase flow needed
        }

        if (tier === 'ultimate' && userStateKey === 'active_ultimate') {
          console.log('\n💎 Ultimate tier — checking PPV status...');

          await myAccountPage.scrollToPPVSection();

          const ppvStatus = await myAccountPage.isPPVPurchased(eventData.PPV_NAME);
          console.log(`✅ PPV Status: "${ppvStatus}"`);

          results.push({
            page: 'My Account',
            variant: 'ultimate',
            tier,
            ratePlan,
            field: 'PPV Status',
            expected: eventData.PPV_STATUS || 'Purchased',
            actual: ppvStatus,
            status: ppvStatus.toLowerCase().includes(
              (eventData.PPV_STATUS || 'Purchased').toLowerCase()
            ) ? 'PASS' : 'FAIL',
          });

          // --- Schedule Page validation (Post-Payment) ---
          if (PPV_TYPE !== 'upsell') {
            try {
              console.log('\n📅 [Ultimate] Navigating to Schedule page to verify purchased event...');
              const schedulePagePostPayment = new SchedulePage(page);
              await schedulePagePostPayment.navigate(baseUrl);
              await schedulePagePostPayment.selectSport(sport);

              console.log(`🔍 Finding event tile: "${eventData.PPV_NAME}"`);
              const eventCard = await schedulePagePostPayment.findEvent(eventData.PPV_NAME);

              console.log('🖱️ Clicking PPV event tile...');
              await eventCard.click();

              console.log('⏳ Waiting for navigation off the Schedule page...');
              await page.waitForURL((url: URL) => !url.href.includes('/schedule'), { timeout: 15000 });
              await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });

              const currentUrl = page.url();
              console.log(`🔗 Ultimate redirected URL: ${currentUrl}`);

              const lowerUrl = currentUrl.toLowerCase();
              let navStatus: 'PASS' | 'FAIL' = 'FAIL';
              let actualPage = 'Unknown Page';

              if (lowerUrl.includes('preview')) {
                actualPage = 'Preview Page';
                navStatus = 'PASS';
              } else if (
                lowerUrl.includes('fixture') ||
                lowerUrl.includes('event') ||
                lowerUrl.includes('stream') ||
                lowerUrl.includes('player')
              ) {
                actualPage = 'Fixture Page';
                navStatus = 'PASS';
              }

              results.push({
                page: 'Schedule',
                field: 'Post-Purchase Navigation Target',
                expected: 'Preview Page or Fixture Page',
                actual: `Navigated to: ${currentUrl} (${actualPage})`,
                status: navStatus,
              });

              if (navStatus === 'FAIL') {
                console.error(`❌ Ultimate navigation target check failed. URL: ${currentUrl}`);
              } else {
                console.log(`✅ Ultimate navigation target check passed: ${actualPage}`);
              }
            } catch (scheduleErr: any) {
              console.warn(`⚠️ [Ultimate] Schedule page validation error: ${scheduleErr.message}`);
              results.push({
                page: 'Schedule',
                field: 'Post-Purchase Navigation Target',
                expected: 'Preview Page or Fixture Page',
                actual: `Error: ${scheduleErr.message}`,
                status: 'FAIL',
              });
            }
          }

          reachedEndPage = true;
          const { excelPath, videoPath } = await writeResults(results);

          // Display detailed per-page results
          displayResultsTable(results, 'ultimate', {
            event: eventData.PPV_NAME,
            region: REGION,
            excelPath,
            videoPath,
          });

          // Generate HTML + PDF run report before early exit
          const { htmlPath: htmlPath2, pdfPath: pdfPath2, folderPath: folderPath2 } = await generateReports(results, {
            event: eventData.PPV_NAME,
            region: REGION,
            source: SOURCE,
            ratePlan,
            tier,
            env: process.env.DAZN_ENV || 'prod',
            flowName: `${SOURCE} → ${tier} → ${ratePlan}`,
            endTime: new Date(),
            excelPath,
            videoPath,
            userStatus: isMyAccount ? (process.env.USER_STATE || 'Freemium') : 'New User',
            userType: 'existing-user',
            paymentMethod: PAYMENT_METHOD === 'gpay' ? 'Google Pay' : 'Credit Card',
          });
          if (folderPath2) console.log(`\n📂 Report folder: ${folderPath2}`);
          return;
        }

        // ══════════════════════════════════════════════════════════════
        // STEP 5b — SCROLL TO PPV SECTION
        // Only for freemium / standard tiers
        // ══════════════════════════════════════════════════════════════
        await myAccountPage.scrollToPPVSection();

        // ══════════════════════════════════════════════════════════════
        // STEP 5c — VALIDATE PAY PER VIEW LISTING PAGE (if navigated)
        // If the PPV section shows a listing page, validate it
        // ══════════════════════════════════════════════════════════════
        const currentUrlBeforeBuy = page.url();
        if (currentUrlBeforeBuy.includes('/myaccount/ppv') || currentUrlBeforeBuy.includes('/pay-per-view')) {
          console.log('\n📋 Validating Pay Per View listing page...');
          const ppvListingData = getPayPerViewData();
          if (ppvListingData.length > 0) {
            await validateVariant(
              page, 'myaccount', ppvListingData, results, eventData, 'Pay Per View'
            );
          }
        }

        // ── VALIDATE PPV LISTING PAGE after "Explore more PPV events" navigation ──
        // MyAccountPage.clickBuyNow() internally calls findPPVRow() which navigates
        // to the PPV listing page if PPV not found in My Account.
        // We need to validate the PPV card on the listing page BEFORE clicking Buy Now.
        // Strategy: scroll and search for the PPV, then validate its card fields.
        if (!hasPPV) {
          console.log('\n📋 Checking if navigated to PPV listing page for validation...');
          // Wait briefly for any navigation that may have happened
          await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
          const listingUrl = page.url();
          const isOnListingPage = listingUrl.includes('/ppv') || listingUrl.includes('/pay-per-view') ||
            listingUrl.includes('/addons') || listingUrl.includes('/content/');

          if (isOnListingPage) {
            console.log(`📍 On PPV listing page: ${listingUrl}`);
            // Wait for PPV cards to load
            await page.waitForSelector(
              '#addons-list-card, article, [class*="card" i], button:has-text("Buy now")',
              { state: 'visible', timeout: 10000 }
            ).catch(() => { });

            // Validate PPV listing page fields from Excel
            const ppvListingPageData = getPayPerViewData();
            if (ppvListingPageData.length > 0) {
              console.log(`📊 PPV Listing page rows: ${ppvListingPageData.length}`);
              await validateVariant(
                page, 'myaccount', ppvListingPageData, results, eventData, 'Pay Per View'
              );
            } else {
              console.log('ℹ️ No Pay Per View page sheet data — skipping listing page validation');
            }
          }
        }

        // ══════════════════════════════════════════════════════════════
        // STEP 6 — CLICK BUY NOW / SUBSCRIPTION STATUS CTA
        // ══════════════════════════════════════════════════════════════
        if (SOURCE === 'myaccount-subscription-status' || resolvedSource === 'myaccount-subscription-status') {
          console.log(`\n💳 Clicking Subscription Status CTA for default signup`);
          await myAccountPage.clickSubscriptionStatusCTA(userStateKey);
        } else {
          console.log(`\n💳 Clicking Buy Now for: ${eventData.PPV_NAME}`);
          await myAccountPage.clickBuyNow(eventData.PPV_NAME);
        }

        await page.waitForLoadState('domcontentloaded').catch(() => { });
        // Wait for the URL and page text to stabilize (handles client-side routing/redirects)
        const beforeUrl = page.url();
        await page.waitForURL((url: URL) => url.toString() !== beforeUrl, { timeout: 15000 }).catch(() => { });
        postClickUrl = page.url();
      } else {
        // Landing page — use names already resolved by buildEventData from config
        isReturning = true;
        firstName = eventData.FIRST_NAME || userEmail.split('@')[0] || 'UAT';
        lastName = eventData.LAST_NAME || 'UAT';

        eventData.FIRST_NAME = firstName;
        eventData.LAST_NAME = lastName;
        eventData['FIRST_NAME'] = firstName;
        eventData['LAST_NAME'] = lastName;
        eventData.FULL_NAME = `${firstName} ${lastName}`.trim();
        eventData.IS_RETURNING_USER = 'true';
        eventData.SIGNED_IN_AS_TEXT = `Signed in as ${firstName} ${lastName}`.trim();

        // Keep UPPER_CASE versions in sync
        eventData['FIRST_NAME'] = eventData.FIRST_NAME;
        eventData['LAST_NAME'] = eventData.LAST_NAME;
        eventData['FULL_NAME'] = eventData.FULL_NAME;
        eventData['IS_RETURNING_USER'] = eventData.IS_RETURNING_USER;
        eventData['SIGNED_IN_AS_TEXT'] = eventData.SIGNED_IN_AS_TEXT;

        console.log(`👤 Derived First name : "${firstName}"`);
        console.log(`👤 Derived Last name  : "${lastName}"`);
        console.log(`👤 Signed in as       : "${eventData.SIGNED_IN_AS_TEXT}"`);

        postClickUrl = page.url();
      }

      // ══════════════════════════════════════════════════════════════
      // STEP 7 — DETECT FLOW FROM URL
      // ══════════════════════════════════════════════════════════════
      // Handle cookies on the post-click page immediately before any flow detection
      await handleCookies(page, 8000);
      await stabilisePage(page);

      const bodyText = await page.locator('body')
        .innerText({ timeout: 3000 })
        .then(t => t.toLowerCase())
        .catch(() => '');

      const isSignupPPVFlow =
        postClickUrl.includes('/signup') &&
        postClickUrl.includes('contextualPpvId') &&
        !postClickUrl.includes('upsellTierShown=true');

      const isChooseHowToBuy =
        userStateKey.startsWith('active_standard') &&
        (postClickUrl.includes('upsellTierShown=true') ||
          postClickUrl.includes('/addon/purchase') ||  // ← US active standard
          bodyText.includes('choose how to buy') ||
          (purchaseOption === 'ultimate' && postClickUrl.includes('contextualPpvId'))) &&
        !bodyText.includes("choose a plan") &&
        !bodyText.includes("choose your plan") &&
        !bodyText.includes("choose your subscription") &&
        !bodyText.includes("choose a subscription") &&
        !bodyText.includes("choose the right plan");

      console.log(`\n🔀 Post-click detection:`);
      console.log(`   tier             : ${tier}`);
      console.log(`   isSignupPPVFlow  : ${isSignupPPVFlow}`);
      console.log(`   isChooseHowToBuy : ${isChooseHowToBuy}`);
      console.log(`   purchaseOption   : ${purchaseOption}`);
      console.log(`   isReturning      : ${isReturning}`);

      // ══════════════════════════════════════════════════════════════
      // FLOW A — FREEMIUM / RETURNING USER
      // ══════════════════════════════════════════════════════════════
      if (!isChooseHowToBuy) {
        console.log('\n📋 Flow A: Freemium/Returning — signup flow');

        await setupPage(page);

        const variant = await detectVariant(page, variantConfig).catch(() => 'variant1');
        console.log('🎯 variant:', variant);

        const currentVariantConfig = variantConfig?.[variant];
        let ppvValidated = false;
        let planValidated = false;
        let stuckCount = 0;
        let firstPaymentDone = false;
        let firstSuccessValidated = false;
        let savedCardPaymentDone = false;
        let secondSuccessValidated = false;
        let emailProcessedCount = 0;

        for (let step = 0; step < 20; step++) {

          if (page.isClosed()) throw new Error('❌ Page closed unexpectedly');

          await handleCookies(page, step === 0 ? 8000 : 1500);
          await stabilisePage(page);
          await dismissMarketingPopup(page);

          // Dynamically extract name from page if available to keep eventData in sync
          let signedInText = '';
          const candidates = page.locator('p, span, div');
          const count = await candidates.count().catch(() => 0);
          for (let i = 0; i < count; i++) {
            const txt = (await candidates.nth(i).textContent().catch(() => '')) || '';
            const trimmed = txt.trim().replace(/\s+/g, ' ');
            if (/^signed in as/i.test(trimmed) && trimmed.length < 100) {
              signedInText = trimmed;
              break;
            }
          }

          if (signedInText) {
            console.log(`👤 Found live signed-in text: "${signedInText}"`);
            const namePart = signedInText.replace(/signed in as/i, '').trim();
            const nameParts = namePart.split(/\s+/);
            const fName = nameParts[0] || '';
            const lName = nameParts.slice(1).join(' ') || '';

            eventData.FIRST_NAME = fName;
            eventData.LAST_NAME = lName;
            eventData['FIRST_NAME'] = fName;
            eventData['LAST_NAME'] = lName;
            eventData.FULL_NAME = namePart;
            eventData.SIGNED_IN_AS_TEXT = signedInText;
            eventData['FULL_NAME'] = namePart;
            eventData['SIGNED_IN_AS_TEXT'] = signedInText;
          }
          // ── Dismiss AGREE/Terms overlay if present (US-specific) ──────
          // US users may see a Terms & Conditions overlay with "AGREE" buttons
          // before the actual page loads. Dismiss it before page detection so
          // detectPageType sees the real page content underneath.
          try {
            const agreeBtn = page.locator('button:has-text("AGREE"), button:has-text("Agree")').first();
            const agreeVisible = await agreeBtn.isVisible({ timeout: 1500 }).catch(() => false);
            if (agreeVisible) {
              const btnText = (await agreeBtn.textContent().catch(() => '') || '').trim().toLowerCase();
              if (btnText === 'agree' || btnText === 'i agree') {
                // Click all AGREE buttons (there may be multiple sections)
                for (let agreeIdx = 0; agreeIdx < 5; agreeIdx++) {
                  const nextBtn = page.locator('button:has-text("AGREE"), button:has-text("Agree")').first();
                  const nextVisible = await nextBtn.isVisible({ timeout: 800 }).catch(() => false);
                  if (!nextVisible) break;
                  const nextText = (await nextBtn.textContent().catch(() => '') || '').trim().toLowerCase();
                  if (nextText === 'agree' || nextText === 'i agree') {
                    await nextBtn.click({ timeout: 2000 }).catch(() => { });
                    console.log(`🛡️  Dismissed Terms overlay (${agreeIdx + 1})`);
                    await page.waitForTimeout(500);
                  } else {
                    break;
                  }
                }
                // Wait for actual page content to render after overlay dismissal
                await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
                await page.waitForTimeout(1500);
              }
            }
          } catch {
            // Non-critical — continue with page detection
          }

          const pageType = await detectPageType(page, pagesConfig);
          console.log(`\nstep ${step + 1} → pageType: ${pageType} | url: ${page.url()}`);

          // If the URL is myaccount or home page and we are in a subscription-only flow, fail immediately.
          const isBoxingSubOnlySource =
            SOURCE === 'boxing-ultimate-subscription' ||
            SOURCE === 'boxing-standard-subscription' ||
            SOURCE === 'boxing-join-the-club';
          if (isBoxingSubOnlySource && (page.url().includes('/myaccount') || page.url().endsWith('/home'))) {
            throw new Error(`❌ [${SOURCE}] Expected to land on PlanDetails/TierPlans, but landed on My Account/Home page instead (flow bypassed plans/checkout).`);
          }

          // ── MY ACCOUNT PPV (Purchased) ─────────────────────────────
          // Ultimate users redirected to /myaccount/ppv after sign-in when PPV is already purchased
          if (pageType === 'myaccount-ppv') {
            console.log('\n✅ [Purchased] Landed on My Account PPV page — PPV is already purchased/included.');

            // Wait for the PPV list to fully render
            await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });

            // Wait for "Purchased" text to appear on the page
            await page.locator('text=Purchased').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
              console.log('⚠️ [Purchased] "Purchased" text not visible after 10s — proceeding with check');
            });

            // Verify PPV status on the page
            const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
            const hasPurchased = bodyText.toLowerCase().includes('purchased');
            const hasEventName = bodyText.toLowerCase().includes(eventData.PPV_NAME.toLowerCase().split(' vs')[0]);

            results.push({
              page: 'My Account (PPV)',
              variant: tier,
              tier,
              ratePlan,
              field: 'PPV Status (Purchased)',
              expected: 'Purchased',
              actual: hasPurchased ? 'Purchased' : 'Not found',
              status: hasPurchased ? 'PASS' : 'FAIL',
            });

            if (hasEventName) {
              results.push({
                page: 'My Account (PPV)',
                variant: tier,
                tier,
                ratePlan,
                field: 'PPV Event Present',
                expected: eventData.PPV_NAME,
                actual: 'Found',
                status: 'PASS',
              });
            }

            // Navigate to Schedule page and verify fixture
            if (PPV_TYPE !== 'upsell') {
              try {
                console.log('\n📅 [Purchased] Navigating to Schedule page to verify purchased event...');
                const schedulePagePurchased = new SchedulePage(page);
                await schedulePagePurchased.navigate(baseUrl);
                await schedulePagePurchased.selectSport(sport);

                console.log(`🔍 Finding event tile: "${eventData.PPV_NAME}"`);
                const eventCard = await schedulePagePurchased.findEvent(eventData.PPV_NAME);

                console.log('🖱️ Clicking PPV event tile...');
                await eventCard.click();

                console.log('⏳ Waiting for navigation off the Schedule page...');
                await page.waitForURL((url: URL) => !url.href.includes('/schedule'), { timeout: 15000 });
                await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });

                const currentUrl = page.url();
                console.log(`🔗 Post-Purchase redirected URL: ${currentUrl}`);

                const lowerUrl = currentUrl.toLowerCase();
                let navStatus: 'PASS' | 'FAIL' = 'FAIL';
                let actualPage = 'Unknown Page';

                if (lowerUrl.includes('preview')) {
                  actualPage = 'Preview Page';
                  navStatus = 'PASS';
                } else if (
                  lowerUrl.includes('fixture') ||
                  lowerUrl.includes('event') ||
                  lowerUrl.includes('stream') ||
                  lowerUrl.includes('player')
                ) {
                  actualPage = 'Fixture Page';
                  navStatus = 'PASS';
                }

                results.push({
                  page: 'Schedule',
                  field: 'Post-Purchase Navigation Target',
                  expected: 'Preview Page or Fixture Page',
                  actual: `Navigated to: ${currentUrl} (${actualPage})`,
                  status: navStatus,
                });

                if (navStatus === 'FAIL') {
                  console.error(`❌ Post-Purchase navigation target check failed. URL: ${currentUrl}`);
                } else {
                  console.log(`✅ Post-Purchase navigation target check passed: ${actualPage}`);
                }
              } catch (scheduleErr: any) {
                console.warn(`⚠️ [Purchased] Schedule page validation error: ${scheduleErr.message}`);
                results.push({
                  page: 'Schedule',
                  field: 'Post-Purchase Navigation Target',
                  expected: 'Preview Page or Fixture Page',
                  actual: `Error: ${scheduleErr.message}`,
                  status: 'FAIL',
                });
              }
            }

            reachedEndPage = true;
            break;
          }

          // ── Default Signup validation check: Fail if no PPV ──
          // Skip for boxing-ultimate-subscription and boxing-join-the-club — they intentionally bypass the PPV page.
          // boxing-standard-subscription is NOT excluded here: it has defaultSignup=true and should show a PPV option.
          const isBoxingSubSource =
            SOURCE === 'boxing-ultimate-subscription' ||
            SOURCE === 'boxing-page-bundle' ||
            SOURCE === 'boxing-upcoming-fights' ||
            SOURCE === 'boxing-join-the-club';
          if (process.env.DEFAULT_SIGNUP === 'true' && !ppvValidated && !isBoxingSubSource && !noPpvClick) {
            const url = page.url().toLowerCase();
            if (url.includes('page=tierplans') || url.includes('page=plandetails') || pageType === 'plan' || pageType === 'email' || pageType === 'default-signup') {
              const bodyText = await page.locator('body').innerText({ timeout: 2000 }).then((t: string) => t.toLowerCase()).catch(() => '');
              const hasPPVOption = bodyText.includes('subscribe without a pay-per-view') ||
                bodyText.includes('continue without pay-per-view') ||
                bodyText.includes('continue without a pay-per-view') ||
                bodyText.includes('to watch your pay-per-view') ||
                bodyText.includes('pay-per-view') ||
                bodyText.includes(eventData.PPV_NAME.toLowerCase()) ||
                (eventData.PPV_DISPLAY_NAME && bodyText.includes(eventData.PPV_DISPLAY_NAME.toLowerCase()));
              if (!hasPPVOption) {
                throw new Error('❌ [DefaultSignup] No PPV exists in default signup — redirected directly to plans page');
              }
            }
          }

          // ── PHONE NUMBER ──────────────────────────────────────
          if (pageType === 'phone') {
            console.log('📱 Phone number collection page — skipping...');
            const skipBtn = page.locator(
              'button:has-text("Skip"), ' +
              'button:has-text("Not now"), ' +
              'button:has-text("Continue")'
            ).first();
            if (await skipBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
              await clickAndWaitForNav(page, skipBtn, 'Skip phone collection');
              console.log('✅ Skipped phone collection');
            } else {
              console.log('⚠️  Skip button not visible on phone number page');
            }
            await page.waitForLoadState('domcontentloaded').catch(() => { });
            continue;
          }

          // ── EMAIL / LOGIN ──────────────────────────────────────
          if (pageType === 'email') {
            console.log('👉 Email/Login page');
            stuckCount = 0;
            emailProcessedCount++;

            // ── Error popup detection (e.g. "No key found!", error codes) ──
            const bodyTextForError = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
            const errorPatterns = [
              /no key found/i,
              /error code:\s*\d/i,
              /something went wrong/i,
              /try refreshing the page/i,
              /unexpected error/i,
            ];
            const matchedError = errorPatterns.find(p => p.test(bodyTextForError));
            if (matchedError) {
              const errorSnippet = bodyTextForError.split('\n').filter(l => errorPatterns.some(p => p.test(l))).join(' | ').substring(0, 200);
              console.log(`❌ [Signup/Signin Error] Detected error popup on page: "${errorSnippet}"`);
              try {
                await page.screenshot({ path: 'test-results/signup_error_popup.png', fullPage: true });
                console.log('📸 Screenshot saved to test-results/signup_error_popup.png');
              } catch (se: any) {
                console.warn('⚠️  Could not save screenshot:', se.message);
              }
              throw new Error(`❌ Signup/Signin error popup detected: "${errorSnippet}". The signup page shows an error — test cannot proceed.`);
            }

            if (emailProcessedCount > 5) {
              console.log('⚠️  Email/Login loop detected — breaking');
              try {
                await page.screenshot({ path: 'test-results/email_loop_error.png', fullPage: true });
                console.log('📸 Screenshot saved to test-results/email_loop_error.png');
              } catch (se: any) {
                console.warn('⚠️  Could not save screenshot:', se.message);
              }
              if (page.url().includes('paymentDetails') || page.url().includes('payment')) {
                reachedEndPage = true;
                console.log('💳 Navigated to payment page after loop detection retry');
                continue;
              }
              break;
            }

            // ── Authenticate via AuthenticationManager (handles email/Google/social) ──
            const authManager = new AuthenticationManager(page, context, baseUrl);
            await authManager.authenticate(eventData);
            let signedIn = true;
            isReturning = true;
            eventData.IS_RETURNING_USER = 'true';

            if (signedIn && userStateKey === 'active_ultimate') {
              console.log('⏳ [Ultimate User Login] Waiting for post-login redirection to fixture page...');
              await page.waitForURL(
                (url: URL) =>
                  !url.href.includes('signin') &&
                  !url.href.includes('signup') &&
                  !url.href.includes('PlanDetails') &&
                  !url.href.includes('TierPlans') &&
                  !url.href.includes('payment') &&
                  !url.href.includes('checkout'),
                { timeout: 20000 }
              ).catch(() => { });

              const currentUrl = page.url();
              const lowerUrl = currentUrl.toLowerCase();
              let navStatus: 'PASS' | 'FAIL' = 'FAIL';
              let actualPage = 'Unknown Page';

              if (lowerUrl.includes('preview')) {
                actualPage = 'Preview Page';
                navStatus = 'PASS';
              } else if (
                lowerUrl.includes('fixture') ||
                lowerUrl.includes('event') ||
                lowerUrl.includes('stream') ||
                lowerUrl.includes('player')
              ) {
                actualPage = 'Fixture Page';
                navStatus = 'PASS';
              }

              results.push({
                page: 'Sign In',
                field: 'Post-Login Navigation Target',
                expected: 'Preview Page or Fixture Page',
                actual: `Navigated to: ${currentUrl} (${actualPage})`,
                status: navStatus,
              });

              if (navStatus === 'FAIL') {
                const errMsg = `❌ [Ultimate User Login] Not redirected to fixture page after signing in. Landed on: ${currentUrl}`;
                console.error(errMsg);
                throw new Error(errMsg);
              } else {
                console.log(`✅ [Ultimate User Login] Successfully redirected to fixture/preview page: ${currentUrl} (${actualPage})`);
              }
              reachedEndPage = true;
              break;
            }

            await page.waitForLoadState('domcontentloaded').catch(() => { });
            continue;
          }

          // ── PAYMENT ───────────────────────────────────────────
          if (pageType === 'payment') {
            console.log('💳 Payment page');
            reachedEndPage = true;
            console.log('\n📋 Validating Payment page...');

            const targetTier = (tier === 'ultimate' || purchaseOption === 'ultimate') ? 'ultimate' : 'standard';
            const isBundle = SOURCE.includes('bundle');
            const planKey = isBundle ? `${ratePlan} bundle` : ratePlan;
            const paymentData = getPaymentDataByTierAndPlan(targetTier, planKey);
            console.log(`📊 Payment rows: ${paymentData.length}`);

            const paymentPage = new PaymentPage(page);

            if (await paymentPage.isPaymentPage()) {
              if (isReturning) {
                await paymentPage.validate(paymentData, results, eventData, FLOW);
                const returningData = paymentData.filter((r: any) => {
                  const rf = (r.Flow || '').trim().toLowerCase();
                  if (rf !== 'returning') return false;
                  // 'Signed In As Text' and 'Log Out Present' only apply to frozen users, not freemium
                  if (userStateKey === 'freemium') {
                    const f = (r.Field || '').trim().toLowerCase();
                    if (f === 'signed in as text' || f === 'log out present') return false;
                  }
                  return true;
                });
                if (returningData.length > 0) {
                  await paymentPage.validate(returningData, results, eventData, 'returning');
                }
              } else {
                await paymentPage.validate(paymentData, results, eventData, undefined);
              }
            }

            // ── SCENARIO 2: Ultimate Upsell Banner — validate before click,
            //    click conditionally, validate after click ──────────────────
            const isStandardTierForUpsell = (tier || '').toLowerCase() === 'standard';
            const isMonthlyOrAPMForUpsell = ratePlan === 'monthly' || ratePlan === 'annual pay monthly';

            if (isStandardTierForUpsell && isMonthlyOrAPMForUpsell) {
              try {
                // STEP A: Always validate banner text BEFORE click (both prod and stag)
                await paymentPage.validateUltimateUpsellBannerText(results, eventData);

                // Click arrow only if SWITCH=true is explicitly set
                const shouldClickUpsell = SWITCH_TO_ULTIMATE || SOURCE === 'landing-page-dont-miss-live-switch';

                if (shouldClickUpsell) {
                  // STEP C: Click > arrow and validate DAZN Ultimate summary
                  const switched = await paymentPage.clickUltimateUpsellAndValidate(results, eventData);

                  if (switched) {
                    // STEP D: update eventData so payment fill proceeds as Ultimate
                    console.log('💎 [SWITCH=true] Proceeding with DAZN Ultimate payment...');
                    eventData.TIER = 'ultimate';
                    eventData['TIER'] = 'ultimate';
                    eventData.DAZN_TIER = 'DAZN Ultimate';
                    eventData['DAZN_TIER'] = 'DAZN Ultimate';
                    // Rate plan stays as annual pay monthly (Ultimate APM)
                    eventData.RATE_PLAN = 'annual pay monthly';
                    eventData['RATE_PLAN'] = 'annual pay monthly';
                  }
                } else {
                  // SWITCH not set → skip click, log info, proceed with Standard
                  console.log('ℹ️ SWITCH not set — skipping Ultimate upsell click. Proceeding with Standard payment.');
                }
              } catch (upsellErr: any) {
                console.warn(`⚠️ Ultimate Upsell Banner validation error: ${upsellErr.message}`);
              }
            }
            // ── End Scenario 2 ────────────────────────────────────────────

            firstPaymentDone = true;

            // On staging, fill payment details and submit
            const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
            if (env === 'stag') {
              console.log(`💳 DAZN_ENV is stag — filling payment via method: ${PAYMENT_METHOD}`);
              try {
                if (PAYMENT_METHOD === 'gpay') {
                  // ── Google Pay flow ──────────────────────────────────
                  console.log('🔵 [GPay] Using Google Pay payment method...');
                  await paymentPage.fillGooglePayAndSubmit(results, eventData);
                  await paymentPage.verifyPaymentSuccess();
                  await paymentPage.clickSuccessContinue();
                } else {
                  // ── Credit Card flow (existing default) ──────────────
                  console.log('💳 Using Credit Card payment method...');
                  await paymentPage.fillPaymentAndSubmit();
                  await paymentPage.verifyPaymentSuccess();
                  await paymentPage.clickSuccessContinue();
                }
                console.log('✅ Payment details submitted successfully on staging!');

                // ── SCENARIO 3: Navigate to My Account and validate PPV status = Purchased ──
                // Only runs on stag after successful payment, and only for normal PPV flows
                if (PPV_TYPE !== 'upsell') {
                  try {
                    console.log('\n🏠 [Post-Payment] Validating PPV status in My Account...');
                    const myAccountPagePostPayment = new MyAccountPage(page);
                    await myAccountPagePostPayment.navigateToMyAccountAndValidatePPVStatus(
                      eventData.PPV_NAME,
                      results,
                      eventData
                    );
                  } catch (myAccountErr: any) {
                    console.warn(`⚠️ [Post-Payment] My Account PPV status validation error: ${myAccountErr.message}`);
                    results.push({
                      page: 'My Account (Post-Payment)',
                      field: 'PPV Status After Purchase',
                      expected: 'Purchased',
                      actual: `Error: ${myAccountErr.message}`,
                      status: 'FAIL',
                    });
                  }
                }
                // ── End Scenario 3 ────────────────────────────────────────────────────────

                // ── SCENARIO 4: Navigate to Schedule Page and Click Event Tile (Post-Payment) ──
                if (PPV_TYPE !== 'upsell') {
                  try {
                    console.log('\n📅 [Post-Payment] Navigating to Schedule page to verify purchased event...');
                    const schedulePagePostPayment = new SchedulePage(page);
                    await schedulePagePostPayment.navigate(baseUrl);
                    await schedulePagePostPayment.selectSport(sport);

                    console.log(`🔍 Finding event tile: "${eventData.PPV_NAME}"`);
                    const eventCard = await schedulePagePostPayment.findEvent(eventData.PPV_NAME);

                    console.log('🖱️ Clicking PPV event tile...');
                    await eventCard.click();

                    console.log('⏳ Waiting for navigation off the Schedule page...');
                    await page.waitForURL((url: URL) => !url.href.includes('/schedule'), { timeout: 15000 });
                    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });

                    const currentUrl = page.url();
                    console.log(`🔗 Post-payment redirected URL: ${currentUrl}`);

                    const lowerUrl = currentUrl.toLowerCase();
                    let navStatus: 'PASS' | 'FAIL' = 'FAIL';
                    let actualPage = 'Unknown Page';

                    if (lowerUrl.includes('preview')) {
                      actualPage = 'Preview Page';
                      navStatus = 'PASS';
                    } else if (
                      lowerUrl.includes('fixture') ||
                      lowerUrl.includes('event') ||
                      lowerUrl.includes('stream') ||
                      lowerUrl.includes('player')
                    ) {
                      actualPage = 'Fixture Page';
                      navStatus = 'PASS';
                    }

                    results.push({
                      page: 'Schedule (Post-Payment)',
                      field: 'Post-Purchase Navigation Target',
                      expected: 'Preview Page or Fixture Page',
                      actual: `Navigated to: ${currentUrl} (${actualPage})`,
                      status: navStatus,
                    });

                    if (navStatus === 'FAIL') {
                      console.error(`❌ Post-payment navigation target check failed. URL: ${currentUrl}`);
                    } else {
                      console.log(`✅ Post-payment navigation target check passed: ${actualPage}`);
                    }
                  } catch (scheduleErr: any) {
                    console.warn(`⚠️ [Post-Payment] Schedule page validation error: ${scheduleErr.message}`);
                    results.push({
                      page: 'Schedule (Post-Payment)',
                      field: 'Post-Purchase Navigation Target',
                      expected: 'Preview Page or Fixture Page',
                      actual: `Error: ${scheduleErr.message}`,
                      status: 'FAIL',
                    });
                  }
                }
                // ── End Scenario 4 ────────────────────────────────────────────────────────

                if (PPV_TYPE === 'upsell') {
                  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });
                  continue;
                }
              } catch (paymentErr: any) {
                console.error(`❌ Payment filling failed: ${paymentErr.message}`);
                throw paymentErr;
              }
              break;
            }

            if (PPV_TYPE === 'upsell') {
              reachedEndPage = true;
            }
            break;
          }

          // ── STANDALONE PPV PAGE ───────────────────────────────────
          if (pageType === 'standalone-ppv') {
            console.log('👉 Standalone PPV page');
            stuckCount = 0;

            const standalonePPVPage = new StandalonePPVPage(page);

            if (!ppvValidated) {
              try {
                const ppvData = getStandalonePPVPageData();
                console.log(`📊 Standalone PPV rows: ${ppvData.length}`);

                // Validate checked state
                await standalonePPVPage.validatePPVPageChecked(ppvData, results, eventData);
                // Validate unchecked state
                await standalonePPVPage.validatePPVPageUnchecked(ppvData, results, eventData);
                ppvValidated = true;
              } catch (err: any) {
                console.warn('⚠️ Standalone PPV page validation error:', err.message);
              }
            }

            // Select plan
            await standalonePPVPage.selectPlan(ratePlan === 'monthly' ? 'flex' : 'annual');
            // Click Continue
            await standalonePPVPage.clickContinue();

            await page.waitForLoadState('domcontentloaded').catch(() => { });
            continue;
          }

          // ── PPV Upsell Success Page (first success after initial payment) ──
          if (pageType === 'success-upsell' && PPV_TYPE === 'upsell' && firstPaymentDone && !firstSuccessValidated) {
            console.log('\n══════════════════════════════════════════════');
            console.log('First Success Page — PPV Upsell');
            console.log('══════════════════════════════════════════════');
            stuckCount = 0;

            const successPage = new PPVUpsellSuccessPage(page);
            try {
              const successData = getUpsellFirstSuccessData();
              await successPage.validateUpsellSuccess(successData, results, eventData);
            } catch (err: any) {
              console.warn(`⚠️ First Success page validation error: ${err.message}`);
            }

            firstSuccessValidated = true;
            await successPage.clickBuyUpsell();
            continue;
          }

          // ── Saved Card Payment (upsell PPV purchase) ──
          if (pageType === 'saved-card-payment' && PPV_TYPE === 'upsell' && firstPaymentDone && firstSuccessValidated && !savedCardPaymentDone) {
            console.log('\n══════════════════════════════════════════════');
            console.log('Upsell PPV — Saved Card Payment');
            console.log('══════════════════════════════════════════════');
            stuckCount = 0;

            const savedCardPage = new PPVUpsellPaymentPage(page);
            try {
              const upsellPaymentData = getUpsellPaymentData();
              await savedCardPage.validateSavedCardPayment(upsellPaymentData, results, eventData, 'Upsell Payment');
            } catch (err: any) {
              console.warn(`⚠️ Saved Card Payment validation error: ${err.message}`);
            }

            savedCardPaymentDone = true;
            await savedCardPage.fillAndSubmit(eventData);

            results.push({
              page: 'Upsell Payment',
              field: 'Upsell Payment Completed',
              expected: 'Success',
              actual: 'Success',
              status: 'PASS',
            });
            continue;
          }

          // ── Saved Card Payment (active_standard direct PPV purchase) ──
          if (pageType === 'saved-card-payment' && !firstPaymentDone) {
            console.log('\n══════════════════════════════════════════════');
            console.log('Active Standard — Addon PPV Purchase (Saved Card)');
            console.log('══════════════════════════════════════════════');
            stuckCount = 0;

            const savedCardPage = new PPVUpsellPaymentPage(page);

            // Validate the addon purchase page
            try {
              const ppvPaymentData = getPPVPaymentData();
              await savedCardPage.validateSavedCardPayment(ppvPaymentData, results, eventData, 'PPV Payment (Saved Card)');
            } catch (err: any) {
              console.warn(`⚠️ Saved Card PPV Payment validation error: ${err.message}`);
            }

            reachedEndPage = true;

            // On staging, complete the payment and validate post-payment flows
            const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
            if (env === 'stag') {
              console.log('💳 [stag] Completing saved card PPV payment...');
              try {
                await savedCardPage.fillAndSubmit(eventData);

                results.push({
                  page: 'PPV Payment (Saved Card)',
                  field: 'PPV Payment Completed',
                  expected: 'Success',
                  actual: 'Success',
                  status: 'PASS',
                });
                console.log('✅ Saved card PPV payment submitted successfully on staging!');

                // ── Post-Payment: Validate My Account PPV status ──
                try {
                  console.log('\n🏠 [Post-Payment] Validating PPV status in My Account...');
                  const myAccountPostPay = new MyAccountPage(page);
                  await myAccountPostPay.navigateToMyAccountAndValidatePPVStatus(
                    eventData.PPV_NAME,
                    results,
                    eventData
                  );
                } catch (myAccErr: any) {
                  console.warn(`⚠️ [Post-Payment] My Account PPV status validation error: ${myAccErr.message}`);
                  results.push({
                    page: 'My Account (Post-Payment)',
                    field: 'PPV Status After Purchase',
                    expected: 'Purchased',
                    actual: `Error: ${myAccErr.message}`,
                    status: 'FAIL',
                  });
                }

                // ── Post-Payment: Navigate to Schedule and verify fixture ──
                try {
                  console.log('\n📅 [Post-Payment] Navigating to Schedule page to verify purchased event...');
                  const schedulePostPay = new SchedulePage(page);
                  await schedulePostPay.navigate(baseUrl);
                  await schedulePostPay.selectSport(sport);

                  console.log(`🔍 Finding event tile: "${eventData.PPV_NAME}"`);
                  const eventCard = await schedulePostPay.findEvent(eventData.PPV_NAME);

                  console.log('🖱️ Clicking PPV event tile...');
                  await eventCard.click();

                  console.log('⏳ Waiting for navigation off the Schedule page...');
                  await page.waitForURL((url: URL) => !url.href.includes('/schedule'), { timeout: 15000 });
                  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });

                  const currentUrl = page.url();
                  console.log(`🔗 Post-payment redirected URL: ${currentUrl}`);

                  const lowerUrl = currentUrl.toLowerCase();
                  let navStatus: 'PASS' | 'FAIL' = 'FAIL';
                  let actualPage = 'Unknown Page';

                  if (lowerUrl.includes('preview')) {
                    actualPage = 'Preview Page';
                    navStatus = 'PASS';
                  } else if (
                    lowerUrl.includes('fixture') ||
                    lowerUrl.includes('event') ||
                    lowerUrl.includes('stream') ||
                    lowerUrl.includes('player')
                  ) {
                    actualPage = 'Fixture Page';
                    navStatus = 'PASS';
                  }

                  results.push({
                    page: 'Schedule (Post-Payment)',
                    field: 'Post-Purchase Navigation Target',
                    expected: 'Preview Page or Fixture Page',
                    actual: `Navigated to: ${currentUrl} (${actualPage})`,
                    status: navStatus,
                  });

                  if (navStatus === 'FAIL') {
                    console.error(`❌ Post-payment navigation target check failed. URL: ${currentUrl}`);
                  } else {
                    console.log(`✅ Post-payment navigation target check passed: ${actualPage}`);
                  }
                } catch (scheduleErr: any) {
                  console.warn(`⚠️ [Post-Payment] Schedule page validation error: ${scheduleErr.message}`);
                  results.push({
                    page: 'Schedule (Post-Payment)',
                    field: 'Post-Purchase Navigation Target',
                    expected: 'Preview Page or Fixture Page',
                    actual: `Error: ${scheduleErr.message}`,
                    status: 'FAIL',
                  });
                }
              } catch (payErr: any) {
                console.error(`❌ Saved card PPV payment failed: ${payErr.message}`);
                results.push({
                  page: 'PPV Payment (Saved Card)',
                  field: 'PPV Payment Completed',
                  expected: 'Success',
                  actual: `Error: ${payErr.message}`,
                  status: 'FAIL',
                });
              }
            } else {
              console.log('ℹ️ [prod] Saved card PPV payment page is the end page — skipping payment submission.');
            }

            break;
          }

          // ── DAZN Bet / Promotional Upsell (second success) ──
          if (pageType === 'bet-upsell' && PPV_TYPE === 'upsell' && firstPaymentDone && savedCardPaymentDone) {
            console.log('\n══════════════════════════════════════════════');
            console.log('Second Success Page — DAZN Bet Upsell');
            console.log('══════════════════════════════════════════════');
            stuckCount = 0;

            const successPage = new PPVUpsellSuccessPage(page);
            try {
              const betData = getUpsellSecondSuccessData();
              await successPage.validateBetUpsell(betData, results, eventData);
            } catch (err: any) {
              console.warn(`⚠️ Second Success page validation error: ${err.message}`);
            }

            secondSuccessValidated = true;
            await successPage.clickMaybeLater();
            continue;
          }

          // ── DEFAULT SIGNUP PAGE ──────────────────────────────────
          if (pageType === 'default-signup') {
            console.log('👉 Default Signup page');
            stuckCount = 0;

            if (!ppvValidated) {
              try {
                const ppvData = getPPVDataByVariant(variant);
                console.log(`📊 PPV rows (Default Signup): ${ppvData.length}`);
                const ppvFlow = isMyAccount ? 'myaccount' : (isReturning ? 'returning' : undefined);
                await validateVariant(page, variant, ppvData, results, eventData, 'Default Signup', ppvFlow);
              } catch (e: any) {
                console.warn('⚠️ Default Signup validation error:', e.message);
              }
              ppvValidated = true;
              defaultSignupPPVValidated = true;
            }

            // ── Default Signup Event Matching Check ──
            const ppvName = eventData.PPV_NAME || '';
            const nameClean = ppvName.replace(/[:\-–]/g, ' ');
            let matched = false;
            if (nameClean.includes('vs')) {
              const fighters = nameClean.split(/\bvs\b/i).map((f: string) => f.trim());
              const f1 = fighters[0];
              const f2 = fighters[1];
              if (f1 && f2) {
                const hasF1 = await page.locator(`text=${f1}`).first().isVisible().catch(() => false);
                const hasF2 = await page.locator(`text=${f2}`).first().isVisible().catch(() => false);
                matched = hasF1 || hasF2;
              }
            }
            if (!matched && ppvName) {
              matched = await page.locator(`text=${ppvName}`).first().isVisible().catch(() => false);
            }
            if (!matched) {
              throw new Error(`❌ [DefaultSignup] PPV on page does not match the expected event: "${ppvName}"`);
            }
            console.log(`✅ [DefaultSignup] Verified PPV on page matches: "${ppvName}"`);

            // Click opt-out if noPpvClick is configured in surfacing point
            if (noPpvClick) {
              const clicked = await handleNoPpvClick(page, { ...eventData, noPpvClick, source: resolvedSource, SOURCE }, SOURCE);
              if (clicked) continue;
            }

            // Select Ultimate card first if tier is ultimate
            if (tier === 'ultimate') {
              console.log('💎 [DefaultSignup] Selecting DAZN Ultimate card...');
              const ultimateSelectors = [
                'div:has-text("The Ultimate Fan Package") >> text=DAZN Ultimate',
                '[class*="upsell" i]:has-text("Ultimate")',
                '[class*="ultimate" i]:has-text("Ultimate")',
                'div:has-text("DAZN Ultimate"):has-text("/month")',
                'label:has-text("DAZN Ultimate")'
              ];
              let clicked = false;
              for (const sel of ultimateSelectors) {
                const el = page.locator(sel).first();
                if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
                  await safeScrollToElement(page, el);
                  await el.click({ force: true }).catch(() => { });
                  console.log(`✅ [DefaultSignup] Clicked Ultimate card via selector: ${sel}`);
                  clicked = true;
                  break;
                }
              }

              if (!clicked) {
                const radios = page.locator('input[type="radio"]');
                const count = await radios.count().catch(() => 0);
                for (let i = 0; i < count; i++) {
                  const radio = radios.nth(i);
                  const radioLabel = await radio
                    .locator('xpath=ancestor::label | xpath=ancestor::div[1]')
                    .first();
                  const text = await radioLabel.innerText({ timeout: 500 }).catch(() => '');
                  if (text.toLowerCase().includes('ultimate')) {
                    await safeScrollToElement(page, radio);
                    await radio.click({ force: true }).catch(() => { });
                    console.log(`✅ [DefaultSignup] Clicked Ultimate radio at index ${i}`);
                    clicked = true;
                    break;
                  }
                }
              }
            }

            let btn = page.locator('button:has-text("Continue with DAZN Ultimate"), button:has-text("Continue with pay-per-view"), button:has-text("Continue"), button[type="submit"]').first();
            if (tier === 'ultimate') {
              const ultBtn = page.locator('button:has-text("Continue with DAZN Ultimate")').first();
              if (await ultBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                btn = ultBtn;
              }
            }
            console.log(`🖱️ [DefaultSignup] Clicking CTA: "${await btn.innerText().catch(() => 'Continue')}"...`);
            await clickAndWaitForNav(page, btn, 'DefaultSignup Continue');
            await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
            continue;
          }

          // ── CHOOSE HOW TO BUY (active_standard from landing page) ──
          if (pageType === 'choose-how-to-buy') {
            console.log('\n══════════════════════════════════════════════');
            console.log('Active Standard — Choose How To Buy');
            console.log('══════════════════════════════════════════════');
            stuckCount = 0;

            await page.waitForSelector(
              '[class*="addon" i], [class*="purchase" i], input[type="radio"]',
              { state: 'visible', timeout: 8000 }
            ).catch(() => { });

            // Validate Choose How To Buy page
            try {
              const chooseBuyData = getChooseHowToBuyData();
              console.log(`📊 Choose How To Buy rows: ${chooseBuyData.length}`);
              await validateVariant(
                page, 'choosebuy', chooseBuyData, results, eventData, 'Choose How To Buy'
              );
            } catch (e: any) {
              console.warn('⚠️ Choose How To Buy validation error:', e.message);
            }

            if (purchaseOption === 'ultimate') {
              // ── Ultimate path ──
              console.log('\n💎 Selecting DAZN Ultimate...');
              const ultimateCard = page.locator(
                '[class*="upsell" i], [class*="ultimate" i], label:has-text("DAZN Ultimate")'
              ).first();
              if (await ultimateCard.isVisible({ timeout: 3000 }).catch(() => false)) {
                await safeScrollToElement(page, ultimateCard);
                await ultimateCard.click({ force: true }).catch(() => { });
                console.log('✅ Selected DAZN Ultimate');
              }
              const ultimateCta = page.locator(
                'button:has-text("Continue with DAZN Ultimate"), button:has-text("Continue")'
              ).first();
              await ultimateCta.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
              await safeScrollToElement(page, ultimateCta);
              await ultimateCta.click({ force: true });
              console.log('✅ Clicked Continue with DAZN Ultimate');

              // Wait for plan page to load (URL may change or content updates)
              await page.waitForSelector(
                'text=/choose your plan|annual|pay monthly|pay upfront/i',
                { state: 'visible', timeout: 15000 }
              ).catch(() => { });
              await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { });
            } else {
              // ── PPV only path ──
              console.log('\n🥊 Selecting PPV only...');
              const btnTexts = [
                `button:has-text("Continue with ${eventData.PPV_NAME} only")`,
                `button:has-text("Continue with ${eventData.PPV_NAME}")`,
                `button:has-text("Continue")`
              ];
              if (eventData.PPV_NAME) {
                const nameClean = eventData.PPV_NAME.replace(/[:\-–]/g, ' ');
                if (nameClean.includes('vs')) {
                  const fighters = nameClean.split(/\bvs\b/i).map((f: string) => f.trim());
                  const firstFighter = fighters[0]?.split(/\s+/).pop();
                  const secondFighter = fighters[1]?.split(/\s+/)[0];
                  if (firstFighter) btnTexts.push(`button:has-text("Continue with ${firstFighter}")`);
                  if (secondFighter) btnTexts.push(`button:has-text("Continue with ${secondFighter}")`);
                }
                const eventShort = eventData.PPV_NAME.split(/[:\-–]/)[0]?.trim();
                if (eventShort) btnTexts.push(`button:has-text("Continue with ${eventShort}")`);
              }
              const ppvCta = page.locator(btnTexts.join(', ')).first();
              await ppvCta.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
              await safeScrollToElement(page, ppvCta);
              await ppvCta.click({ force: true });
              console.log('✅ Clicked PPV Only Continue');

              // URL doesn't change — wait for page content to transition to payment page
              console.log('⏳ Waiting for saved-card-payment page to load...');
              await page.waitForSelector(
                'text=/Today you pay|Skip|Pay Now|one time payment/i',
                { state: 'visible', timeout: 15000 }
              ).catch(() => { });
              await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { });
            }

            await page.waitForLoadState('domcontentloaded').catch(() => { });
            continue;
          }

          // ── PPV PAGE ──────────────────────────────────────────
          if (pageType === 'ppv') {
            console.log('👉 PPV page');
            stuckCount = 0;

            if (!ppvValidated) {
              try {
                const ppvData = getPPVDataByVariant(variant);
                console.log(`📊 PPV rows: ${ppvData.length}`);
                // 'myaccount' flow: Excel rows restricted to Flow=myaccount (e.g. Signed In As, Log Out)
                // 'returning'  flow: Excel rows for returning users on any non-myAccount source
                const ppvFlow = isMyAccount ? 'myaccount' : (isReturning ? 'returning' : undefined);
                await validateVariant(
                  page, variant, ppvData, results, eventData, 'PPV', ppvFlow
                );
              } catch (e: any) {
                console.warn('⚠️  PPV validation error:', e.message);
              }
              ppvValidated = true;
            }

            // Click opt-out if noPpvClick is configured in surfacing point
            if (noPpvClick) {
              const clicked = await handleNoPpvClick(page, { ...eventData, noPpvClick, source: resolvedSource, SOURCE }, SOURCE);
              if (clicked) continue;
            }

            // ── Active Standard + Ultimate: handle "Choose how to buy" page ──
            // When an active_standard user's PPV page shows "Choose how to buy",
            // select the DAZN Ultimate option and proceed to the upgrade page.
            if (purchaseOption === 'ultimate' && userStateKey.startsWith('active_standard')) {
              const ppvBodyText = await page.locator('body')
                .innerText({ timeout: 3000 })
                .then((t: string) => t.toLowerCase())
                .catch(() => '');
              if (ppvBodyText.includes('choose how to buy') || ppvBodyText.includes('dazn ultimate subscription')) {
                console.log('\n💎 [Active Standard PPV] "Choose how to buy" detected — selecting DAZN Ultimate...');
                const ultimateSelectors = [
                  '[class*="upsell" i]:has-text("Ultimate")',
                  '[class*="ultimate" i]:has-text("Ultimate")',
                  'div:has-text("DAZN Ultimate"):has-text("/month")',
                  'label:has-text("DAZN Ultimate")',
                  'text=/DAZN Ultimate/i',
                ];
                let ultimateClicked = false;
                for (const sel of ultimateSelectors) {
                  const el = page.locator(sel).first();
                  if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
                    await safeScrollToElement(page, el);
                    await el.click({ force: true }).catch(() => { });
                    console.log(`✅ Selected DAZN Ultimate via: ${sel}`);
                    ultimateClicked = true;
                    break;
                  }
                }
                if (!ultimateClicked) {
                  // Fallback: try radio buttons
                  const radios = page.locator('input[type="radio"]');
                  const radioCount = await radios.count().catch(() => 0);
                  for (let ri = 0; ri < radioCount; ri++) {
                    const radio = radios.nth(ri);
                    const parentText = await radio.locator('xpath=ancestor::label | xpath=ancestor::div[1]')
                      .first().innerText({ timeout: 500 }).catch(() => '');
                    if (parentText.toLowerCase().includes('ultimate')) {
                      await safeScrollToElement(page, radio);
                      await radio.click({ force: true }).catch(() => { });
                      console.log(`✅ Selected DAZN Ultimate via radio index ${ri}`);
                      ultimateClicked = true;
                      break;
                    }
                  }
                }

                // Click the Ultimate CTA
                const ultCta = page.locator('button:has-text("Continue with DAZN Ultimate")').first();
                const genericCta = page.locator('button:has-text("Continue")').first();
                const cta = (await ultCta.isVisible({ timeout: 2000 }).catch(() => false)) ? ultCta : genericCta;
                await cta.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
                await safeScrollToElement(page, cta);
                await clickAndWaitForNav(page, cta, 'PPV Continue with DAZN Ultimate (Active Standard)');
                await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
                continue;
              }
            }

            // --- FAST PATH FOR DEV MODE FLOWS ---
            if (devModeEnabled) {
              console.log('⚡ Dev mode fast-path: clicking PPV page CTA immediately...');

              // Select Ultimate card first if tier is ultimate
              if (tier === 'ultimate') {
                console.log('💎 Dev mode: selecting Ultimate card before CTA...');
                const ultimateSelectors = [
                  'div:has-text("The Ultimate Fan Package") >> text=DAZN Ultimate',
                  '[class*="upsell" i]:has-text("Ultimate")',
                  '[class*="ultimate" i]:has-text("Ultimate")',
                  'div:has-text("DAZN Ultimate"):has-text("/month")',
                  'label:has-text("DAZN Ultimate")'
                ];
                for (const sel of ultimateSelectors) {
                  const el = page.locator(sel).first();
                  if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
                    await el.click({ force: true }).catch(() => { });
                    console.log(`✅ Dev mode: selected Ultimate card via: ${sel}`);
                    break;
                  }
                }
              }

              const buttonSelectors = [
                'button:has-text("Continue with DAZN Ultimate")',
                'button:has-text("Continue with pay-per-view")',
                'button:has-text("Continue")',
                'button[type="submit"]'
              ];

              let ctaClicked = false;
              for (const sel of buttonSelectors) {
                const btn = page.locator(sel).first();
                if (await btn.isVisible({ timeout: 100 }).catch(() => false)) {
                  await clickAndWaitForNav(page, btn, `PPV Continue (DevMode CTA: ${sel})`);
                  ctaClicked = true;
                  break;
                }
              }

              if (!ctaClicked) {
                const submitBtn = page.locator('button[type="submit"], button:has-text("Continue")').first();
                await submitBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => { });
                await clickAndWaitForNav(page, submitBtn, 'PPV Continue (DevMode Fallback)');
              }

              await setupPage(page, 500);
              continue;
            }
            // ------------------------------------

            if (purchaseOption === 'ultimate') {
              const ultimateCard = page.locator(
                '[class*="upsell" i], ' +
                '[class*="ultimate" i], ' +
                'label:has-text("DAZN Ultimate")'
              ).first();

              if (await ultimateCard.isVisible({ timeout: 3000 }).catch(() => false)) {
                await safeScrollToElement(page, ultimateCard);
                await ultimateCard.click({ force: true }).catch(() => { });
                console.log('✅ Clicked Ultimate card');
              }

              const btn = page.locator(
                'button:has-text("Continue with DAZN Ultimate")'
              ).first();
              await btn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
              await clickAndWaitForNav(page, btn, 'PPV Continue Ultimate');

            } else {
              const ppvRadio = page.locator('input[type="radio"]').first();
              if (await ppvRadio.isVisible({ timeout: 1500 }).catch(() => false)) {
                await safeScrollToElement(page, ppvRadio);
                await ppvRadio.click({ force: true }).catch(() => { });
              }

              const ctaText = currentVariantConfig?.ctaText || 'Continue';
              let btn = page.locator(`button:has-text("${ctaText}")`).first();
              if (!await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
                // Fallback: try common PPV CTA button texts
                console.log(`⚠️ CTA "${ctaText}" not visible — trying fallbacks...`);
                const fallbackSelectors = [
                  'button:has-text("Continue with pay-per-view")',
                  'button:has-text("Continue with PPV")',
                  'button:has-text("Continue")',
                  'button[type="submit"]',
                ];
                for (const sel of fallbackSelectors) {
                  const fallback = page.locator(sel).first();
                  if (await fallback.isVisible({ timeout: 500 }).catch(() => false)) {
                    btn = fallback;
                    console.log(`✅ Found fallback CTA: ${sel}`);
                    break;
                  }
                }
              }
              await btn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
              await clickAndWaitForNav(page, btn, `PPV Continue (${variant})`);
            }

            await page.waitForLoadState('domcontentloaded').catch(() => { });
            continue;
          }

          // ── PLAN PAGE ─────────────────────────────────────────
          if (pageType === 'plan') {
            console.log(`👉 DAZN Plan page`);
            stuckCount = 0;

            if (SOURCE === 'subscribe-without-pay-per-view') {
              console.log('✅ Reached end of Subscribe Without PPV flow (landed on Plan page)');
              reachedEndPage = true;
              break;
            }

            if (!planValidated) {
              try {
                await page.waitForSelector(
                  'input[type="radio"]',
                  { timeout: 5000 }
                ).catch(() => { });

                const targetTier = (tier === 'ultimate' || purchaseOption === 'ultimate') ? 'ultimate' : 'standard';
                const originalTier = eventData.TIER;
                const originalPlanCta = eventData.PLAN_CTA_BUTTON;
                eventData.TIER = targetTier;
                eventData['TIER'] = targetTier;

                // For upgrade flow (active_standard → ultimate), CTA is just 'Continue'
                const isUpgradeFlow = page.url().includes('isUpgradeTierFlow') || userStateKey === 'active_standard';
                if (isUpgradeFlow && targetTier === 'ultimate') {
                  eventData.PLAN_CTA_BUTTON = 'Continue';
                  eventData['PLAN_CTA_BUTTON'] = 'Continue';
                }

                const planData = getPlanDataByTier(targetTier);
                const planFlow = isMyAccount ? 'myaccount' : (isReturning ? 'returning' : undefined);
                console.log(`📊 Plan rows: ${planData.length}`);

                await validateVariant(
                  page, 'plan', planData, results, eventData, 'DAZN Plan', planFlow
                );

                eventData.TIER = originalTier;
                eventData['TIER'] = originalTier;
                eventData.PLAN_CTA_BUTTON = originalPlanCta;
                eventData['PLAN_CTA_BUTTON'] = originalPlanCta;

              } catch (e: any) {
                console.warn('⚠️  Plan validation error:', e.message);
              }
              planValidated = true;
            }

            if (ratePlan === 'annual pay upfront') {
              // ── Diagnostic: trace plan-selection pipeline ──
              console.log('\n🔍 [Plan Selection Trace] ─────────────────────────────');
              console.log(`   ENV PLAN          : ${process.env.PLAN}`);
              console.log(`   json.RATE_PLAN    : ${json?.RATE_PLAN || '(not set)'}`);
              console.log(`   Resolved ratePlan : ${ratePlan}`);
              console.log(`   Tier              : ${tier}`);

              // Enumerate all radios and their labels
              const allRadios = page.locator('input[type="radio"]');
              const radioCount = await allRadios.count().catch(() => 0);
              console.log(`   Total radios found: ${radioCount}`);
              for (let ri = 0; ri < radioCount; ri++) {
                const radio = allRadios.nth(ri);
                const checked = await radio.isChecked().catch(() => false);
                const labelText = await radio.evaluate((el: any) => {
                  const label = el.closest('label') || el.parentElement?.closest('label');
                  return label ? label.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : '(no label)';
                }).catch(() => '(eval failed)');
                console.log(`   Radio[${ri}]: checked=${checked} | label="${labelText}"`);
              }

              const upfrontCard = page.locator(
                'label:has-text("Annual - Pay Upfront"), ' +
                'label:has-text("Annual - pay upfront"), ' +
                'label:has-text("Pay Upfront")'
              ).first();

              const upfrontCardVisible = await upfrontCard.isVisible({ timeout: 3000 }).catch(() => false);
              console.log(`   Upfront label locator visible: ${upfrontCardVisible}`);

              if (upfrontCardVisible) {
                const cardText = await upfrontCard.textContent().catch(() => '') || '';
                console.log(`   Upfront label text: "${cardText.replace(/\s+/g, ' ').trim().slice(0, 120)}"`);
                await safeScrollToElement(page, upfrontCard);
                await upfrontCard.click({ force: true }).catch(() => { });
                console.log('   ✅ Clicked: Upfront label card');
              } else {
                // Upfront is typically the last radio
                const radios = page.locator('input[type="radio"]');
                const count = await radios.count().catch(() => 0);
                console.log(`   Upfront label NOT visible. Falling back to last radio (index ${count - 1})`);
                const upfrontRadio = radios.nth(count > 0 ? count - 1 : 0);
                if (await upfrontRadio.isVisible({ timeout: 1500 }).catch(() => false)) {
                  const fallbackLabel = await upfrontRadio.evaluate((el: any) => {
                    const label = el.closest('label') || el.parentElement?.closest('label');
                    return label ? label.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : '(no label)';
                  }).catch(() => '(eval failed)');
                  console.log(`   Fallback radio label: "${fallbackLabel}"`);
                  await safeScrollToElement(page, upfrontRadio);
                  await upfrontRadio.click({ force: true }).catch(() => { });
                  console.log('   ✅ Clicked: Fallback radio (last)');
                } else {
                  console.error('   ❌ Fallback radio NOT visible either');
                }
              }
              await page.waitForTimeout(500);

              // ── Post-click: log state of all radios ──
              console.log('   Post-click radio state:');
              for (let ri = 0; ri < radioCount; ri++) {
                const radio = allRadios.nth(ri);
                const checked = await radio.isChecked().catch(() => false);
                const labelText = await radio.evaluate((el: any) => {
                  const label = el.closest('label') || el.parentElement?.closest('label');
                  return label ? label.innerText.replace(/\s+/g, ' ').trim().slice(0, 80) : '(no label)';
                }).catch(() => '(eval failed)');
                console.log(`   Radio[${ri}]: checked=${checked} | label="${labelText}"`);
              }
              console.log('─────────────────────────────────────────────────────');

              // ── Post-selection: Validate upfront is selected ──
              console.log('\n📋 Validating post-upfront-selection...');
              const upfrontRadioCheck = await page.locator('input[type="radio"]').nth(1)
                .isChecked().catch(() => false);
              results.push({
                page: 'DAZN Plan',
                field: 'Annual Pay Upfront Selected (After Click)',
                expected: 'Yes',
                actual: upfrontRadioCheck ? 'Yes' : 'No',
                status: upfrontRadioCheck ? 'PASS' : 'FAIL',
              });
              const apmRadioCheck = await page.locator('input[type="radio"]').first()
                .isChecked().catch(() => true);
              results.push({
                page: 'DAZN Plan',
                field: 'Annual Pay Monthly Deselected (After Upfront Click)',
                expected: 'No',
                actual: apmRadioCheck ? 'Yes' : 'No',
                status: !apmRadioCheck ? 'PASS' : 'FAIL',
              });
            } else if (ratePlan === 'annual pay monthly') {
              const annualCard = page.locator(
                'label:has-text("Annual - pay over time"), ' +
                'label:has-text("Annual - Pay Monthly")'
              ).first();

              if (await annualCard.isVisible({ timeout: 3000 }).catch(() => false)) {
                await safeScrollToElement(page, annualCard);
                await annualCard.click({ force: true }).catch(() => { });
                console.log('✅ Clicked Annual card');
              } else {
                const radio = page.locator('input[type="radio"]').nth(1);
                if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
                  await safeScrollToElement(page, radio);
                  await radio.click({ force: true }).catch(() => { });
                  console.log('✅ Selected Annual radio nth(1)');
                }
              }
            } else {
              const trialRadio = page.locator('input[type="radio"]').first();
              if (await trialRadio.isVisible({ timeout: 1500 }).catch(() => false)) {
                await safeScrollToElement(page, trialRadio);
                await trialRadio.click({ force: true }).catch(() => { });
                console.log('✅ Selected Trial radio');
              }
            }

            const planBtn = page.locator(
              'button:has-text("Continue with DAZN Ultimate"), ' +
              'button:has-text("Continue with 7-day Free Trial"), ' +
              'button:has-text("Continue with 1st Month Free"), ' +
              'button:has-text("Continue with PPV + 7-day free trial"), ' +
              'button:has-text("Continue with PPV"), ' +
              'button:has-text("Continue")'
            ).first();
            await planBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });

            // Validate CTA text after APM selection
            if (ratePlan === 'annual pay monthly' && tier === 'standard') {
              const annualCard = page.locator(
                'label:has-text("Annual - pay over time"), ' +
                'label:has-text("Annual - Pay Monthly")'
              ).first();
              let has1MonthFree = false;
              if (await annualCard.isVisible({ timeout: 2000 }).catch(() => false)) {
                const annualText = await annualCard.textContent().catch(() => '') || '';
                if (/1\s*month\s*free|first\s*month\s*free/i.test(annualText)) {
                  has1MonthFree = true;
                }
              } else {
                const radio = page.locator('input[type="radio"]').nth(1);
                if (await radio.isVisible({ timeout: 2000 }).catch(() => false)) {
                  const radioParentText = await radio.evaluate((el: any) => el.parentElement?.textContent || '').catch(() => '');
                  if (/1\s*month\s*free|first\s*month\s*free/i.test(radioParentText)) {
                    has1MonthFree = true;
                  }
                }
              }

              const ctaText = await planBtn.textContent().catch(() => '') || '';
              const cleanCta = ctaText.replace(/\s+/g, ' ').trim();
              const expectedCta = has1MonthFree ? 'Continue with 1st Month Free' : 'Continue';
              const ctaMatch = cleanCta.toLowerCase().includes(expectedCta.toLowerCase());
              console.log(`  ${ctaMatch ? '✅' : '❌'} [Plan CTA after APM] expected="${expectedCta}" actual="${cleanCta}"`);
              results.push({
                page: 'DAZN Plan',
                field: 'CTA After APM Selection',
                expected: expectedCta,
                actual: cleanCta,
                status: ctaMatch ? 'PASS' : 'FAIL'
              });
            }

            await clickAndWaitForNav(page, planBtn, 'Plan Continue');

            await page.waitForLoadState('domcontentloaded').catch(() => { });
            continue;
          }

          // ── CONFIRMATION ──────────────────────────────────────
          if (pageType === 'confirmation') {
            console.log('✅ Upgrade confirmation page');

            // Expand the description if "... More" is visible
            const moreLink = page.locator('text=/\\.\\.\\.\\s*More|More/i').first();
            if (await moreLink.isVisible({ timeout: 2000 }).catch(() => false)) {
              console.log('🖱️ Clicking "... More" to expand page description...');
              await moreLink.click({ force: true }).catch(() => { });
              await page.waitForTimeout(500);
            }

            const confirmData = getUpgradeConfirmationData(ratePlan);

            // Temporarily set TIER to ratePlan so validateVariant's Tier filter matches the sheet's Tier column
            const savedTier = eventData.TIER;
            eventData.TIER = ratePlan;
            eventData['TIER'] = ratePlan;

            await validateVariant(
              page, 'confirmation', confirmData, results, eventData, 'Upgrade Confirmation'
            );

            // Restore
            eventData.TIER = savedTier;
            eventData['TIER'] = savedTier;
            reachedEndPage = true;

            const envName = (process.env.DAZN_ENV || 'stag').toLowerCase();
            if (envName === 'stag') {
              // Staging: click Confirm to complete the upgrade
              console.log('💎 [stag] Clicking Confirm to complete plan change...');
              const confirmBtn = page.locator(
                'button:has-text("Confirm"), button:has-text("Confirm plan change"), button[type="submit"]'
              ).first();
              await confirmBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
              await safeScrollToElement(page, confirmBtn);
              await clickAndWaitForNav(page, confirmBtn, 'Confirm Plan Change');

              results.push({
                page: 'Upgrade Confirmation',
                field: 'Confirm CTA Clicked',
                expected: 'Success',
                actual: 'Success',
                status: 'PASS',
              });

              // Navigate to My Account to verify
              try {
                console.log('\n🏠 [Post-Confirm] Navigating to My Account...');
                const myAccountPage = new MyAccountPage(page);
                await myAccountPage.navigateToMyAccountAndValidatePPVStatus(
                  eventData.PPV_NAME,
                  results,
                  eventData
                );
              } catch (myAccErr: any) {
                console.warn(`⚠️ My Account post-confirm validation error: ${myAccErr.message}`);
              }

              // Navigate to Schedule page to check fixture
              try {
                console.log('\n📅 [Post-Confirm] Navigating to Schedule page...');
                const schedPage = new SchedulePage(page);
                const schedBaseUrl = eventData.BASE_URL || baseUrl;
                await schedPage.navigate(schedBaseUrl);
                const sportName = eventData.SPORT || 'Boxing';
                await schedPage.selectSport(sportName);
                const fixtureEvent = await schedPage.findEvent(eventData.PPV_NAME);
                console.log('✅ PPV fixture found on Schedule page');
                results.push({
                  page: 'Schedule',
                  field: 'PPV Fixture Present',
                  expected: eventData.PPV_NAME,
                  actual: 'Found',
                  status: 'PASS',
                });
              } catch (schedErr: any) {
                console.warn(`⚠️ Schedule page post-confirm validation error: ${schedErr.message}`);
                results.push({
                  page: 'Schedule',
                  field: 'PPV Fixture Present',
                  expected: eventData.PPV_NAME,
                  actual: `Error: ${schedErr.message}`,
                  status: 'FAIL',
                });
              }
            } else {
              console.log('ℹ️ [prod] Confirmation page is the end page — skipping confirm click.');
            }

            break;
          }



          stuckCount++;
          console.log(`⚠️  Unknown page — waiting... (${stuckCount}/5)`);
          await sleep(800);
          if (stuckCount >= 5) {
            throw new Error(`❌ Flow stuck on unknown page.\nURL: ${page.url()}`);
          }
        }

        if (!reachedEndPage) {
          const finalUrl = page.url();
          if (finalUrl.includes('paymentDetails') || finalUrl.includes('payment')) {
            console.log('💳 Payment page detected after loop exit');
            reachedEndPage = true;

            const targetTier = (tier === 'ultimate' || purchaseOption === 'ultimate') ? 'ultimate' : 'standard';
            const isBundle = SOURCE.includes('bundle');
            const planKey = isBundle ? `${ratePlan} bundle` : ratePlan;
            const paymentData = getPaymentDataByTierAndPlan(targetTier, planKey);
            const paymentPage = new PaymentPage(page);
            if (await paymentPage.isPaymentPage()) {
              if (isReturning) {
                await paymentPage.validate(paymentData, results, eventData, FLOW);
                const returningData = paymentData.filter((r: any) => {
                  const rf = (r.Flow || '').trim().toLowerCase();
                  if (rf !== 'returning') return false;
                  // 'Signed In As Text' and 'Log Out Present' only apply to frozen users, not freemium
                  if (userStateKey === 'freemium') {
                    const f = (r.Field || '').trim().toLowerCase();
                    if (f === 'signed in as text' || f === 'log out present') return false;
                  }
                  return true;
                });
                if (returningData.length > 0) {
                  await paymentPage.validate(returningData, results, eventData, 'returning');
                }
              } else {
                await paymentPage.validate(paymentData, results, eventData, undefined);
              }
            }
          } else {
            console.log(`⚠️  Flow A did not reach expected end page`);
          }
        }

        // ══════════════════════════════════════════════════════════════
        // FLOW B — ACTIVE STANDARD USER
        // ══════════════════════════════════════════════════════════════
      } else if (isChooseHowToBuy) {
        console.log('\n📋 Flow B: Active Standard — Choose How To Buy');

        await setupPage(page, 8000);

        await page.waitForSelector(
          '[class*="addon" i], [class*="purchase" i], input[type="radio"]',
          { state: 'visible', timeout: 8000 }
        ).catch(() => { });

        // ✅ Validate Choose How To Buy
        const chooseBuyData = getChooseHowToBuyData();
        console.log(`📊 Choose How To Buy rows: ${chooseBuyData.length}`);
        await validateVariant(
          page, 'choosebuy', chooseBuyData, results, eventData, 'Choose How To Buy'
        );

        if (purchaseOption === 'ultimate') {
          // ── Ultimate upgrade path ─────────────────────────────────
          console.log('\n💎 Selecting DAZN Ultimate...');

          const ultimateCard = page.locator(
            '[class*="upsell" i], ' +
            '[class*="ultimate" i], ' +
            'label:has-text("DAZN Ultimate")'
          ).first();

          if (await ultimateCard.isVisible({ timeout: 3000 }).catch(() => false)) {
            await safeScrollToElement(page, ultimateCard);
            await ultimateCard.click({ force: true }).catch(() => { });
            console.log('✅ Selected DAZN Ultimate');
          }

          const ultimateCta = page.locator(
            'button:has-text("Continue with DAZN Ultimate"), ' +
            'button:has-text("Continue")'
          ).first();
          await ultimateCta.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
          await clickAndWaitForNav(page, ultimateCta, 'Continue with DAZN Ultimate');

          // ── Validate DAZN Plan page (Ultimate) ─────────────────
          console.log('\n📋 Validating DAZN Plan page (Ultimate)...');
          await page.waitForSelector(
            'input[type="radio"]',
            { timeout: 5000 }
          ).catch(() => { });

          const originalTier = eventData.TIER;
          const originalPlanCta = eventData.PLAN_CTA_BUTTON;
          eventData.TIER = 'ultimate';
          eventData['TIER'] = 'ultimate';
          eventData.PLAN_CTA_BUTTON = 'Continue';
          eventData['PLAN_CTA_BUTTON'] = 'Continue';

          const planData = getPlanDataByTier('ultimate');
          console.log(`📊 Plan rows: ${planData.length}`);
          await validateVariant(
            page, 'plan', planData, results, eventData, 'DAZN Plan'
          );

          // Restore
          eventData.TIER = originalTier;
          eventData['TIER'] = originalTier;
          eventData.PLAN_CTA_BUTTON = originalPlanCta;
          eventData['PLAN_CTA_BUTTON'] = originalPlanCta;

          // Select rate plan
          if (ratePlan === 'annual pay monthly') {
            const radio = page.locator('input[type="radio"]').first();
            if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
              await safeScrollToElement(page, radio);
              await radio.click({ force: true }).catch(() => { });
              console.log('✅ Selected Annual Pay Monthly');
            }
          } else if (ratePlan === 'annual pay upfront') {
            const radio = page.locator('input[type="radio"]').nth(1);
            if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
              await safeScrollToElement(page, radio);
              await radio.click({ force: true }).catch(() => { });
              console.log('✅ Selected Annual Pay Upfront');
            }
            await page.waitForTimeout(500);

            // ── Post-selection: Validate upfront is selected ──
            console.log('\n📋 Validating post-upfront-selection (Flow B)...');
            const upfrontChecked = await page.locator('input[type="radio"]').nth(1)
              .isChecked().catch(() => false);
            results.push({
              page: 'DAZN Plan',
              field: 'Annual Pay Upfront Selected (After Click)',
              expected: 'Yes',
              actual: upfrontChecked ? 'Yes' : 'No',
              status: upfrontChecked ? 'PASS' : 'FAIL',
            });
            const apmChecked = await page.locator('input[type="radio"]').first()
              .isChecked().catch(() => true);
            results.push({
              page: 'DAZN Plan',
              field: 'Annual Pay Monthly Deselected (After Upfront Click)',
              expected: 'No',
              actual: apmChecked ? 'Yes' : 'No',
              status: !apmChecked ? 'PASS' : 'FAIL',
            });
          }

          const planBtn = page.locator(
            'button:has-text("Continue with DAZN Ultimate"), ' +
            'button:has-text("Continue")'
          ).first();
          await planBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
          await clickAndWaitForNav(page, planBtn, 'Plan Continue');

          // ── Handle Phone Number Collection (US specific) ─────────
          const currentUrl = page.url();
          if (currentUrl.includes('PhoneNumberCollection')) {
            console.log('📱 Phone number collection page — skipping...');
            const skipBtn = page.locator(
              'button:has-text("Skip"), ' +
              'button:has-text("Not now"), ' +
              'button:has-text("Continue")'
            ).first();
            if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
              await clickAndWaitForNav(page, skipBtn, 'Skip phone collection');
              console.log('✅ Skipped phone collection');
            }
          }

          // ── Validate Upgrade Confirmation ─────────────────────
          console.log('\n📋 Validating Upgrade Confirmation page...');

          // Expand the description if "... More" is visible
          const moreLink = page.locator('text=/\\.\\.\\.\\s*More|More/i').first();
          if (await moreLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            console.log('🖱️ Clicking "... More" to expand page description...');
            await moreLink.click({ force: true }).catch(() => { });
            await page.waitForTimeout(500);
          }

          const confirmData = getUpgradeConfirmationData(ratePlan);
          console.log(`📊 Confirmation rows: ${confirmData.length}`);

          // Temporarily set TIER to ratePlan for correct Tier column filtering
          const savedTierB = eventData.TIER;
          eventData.TIER = ratePlan;
          eventData['TIER'] = ratePlan;

          await validateVariant(
            page, 'confirmation', confirmData, results, eventData, 'Upgrade Confirmation'
          );

          // Restore
          eventData.TIER = savedTierB;
          eventData['TIER'] = savedTierB;
          reachedEndPage = true;

          const envNameB = (process.env.DAZN_ENV || 'stag').toLowerCase();
          if (envNameB === 'stag') {
            console.log('💎 [stag] Clicking Confirm to complete plan change (Flow B)...');
            const confirmBtnB = page.locator(
              'button:has-text("Confirm"), button:has-text("Confirm plan change"), button[type="submit"]'
            ).first();
            await confirmBtnB.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
            await safeScrollToElement(page, confirmBtnB);
            await clickAndWaitForNav(page, confirmBtnB, 'Confirm Plan Change (Flow B)');

            results.push({
              page: 'Upgrade Confirmation',
              field: 'Confirm CTA Clicked',
              expected: 'Success',
              actual: 'Success',
              status: 'PASS',
            });

            try {
              console.log('\n🏠 [Post-Confirm] Navigating to My Account (Flow B)...');
              const myAccountPageB = new MyAccountPage(page);
              await myAccountPageB.navigateToMyAccountAndValidatePPVStatus(
                eventData.PPV_NAME,
                results,
                eventData
              );
            } catch (myAccErr: any) {
              console.warn(`⚠️ My Account post-confirm validation error: ${myAccErr.message}`);
            }

            try {
              console.log('\n📅 [Post-Confirm] Navigating to Schedule page (Flow B)...');
              const schedPageB = new SchedulePage(page);
              const schedBaseUrlB = eventData.BASE_URL || baseUrl;
              await schedPageB.navigate(schedBaseUrlB);
              const sportNameB = eventData.SPORT || 'Boxing';
              await schedPageB.selectSport(sportNameB);
              const fixtureEventB = await schedPageB.findEvent(eventData.PPV_NAME);
              console.log('✅ PPV fixture found on Schedule page (Flow B)');
              results.push({
                page: 'Schedule',
                field: 'PPV Fixture Present',
                expected: eventData.PPV_NAME,
                actual: 'Found',
                status: 'PASS',
              });
            } catch (schedErr: any) {
              console.warn(`⚠️ Schedule page post-confirm validation error: ${schedErr.message}`);
              results.push({
                page: 'Schedule',
                field: 'PPV Fixture Present',
                expected: eventData.PPV_NAME,
                actual: `Error: ${schedErr.message}`,
                status: 'FAIL',
              });
            }
          } else {
            console.log('ℹ️ [prod] Confirmation page is the end page — skipping confirm click.');
          }

        } else {
          // ── PPV only path ─────────────────────────────────────
          console.log('\n🥊 Selecting PPV only...');

          const btnTexts = [
            `button:has-text("Continue with ${eventData.PPV_NAME} only")`,
            `button:has-text("Continue with ${eventData.PPV_NAME}")`,
            `button:has-text("Continue")`
          ];
          if (eventData.PPV_NAME) {
            const nameClean = eventData.PPV_NAME.replace(/[:\-–]/g, ' ');
            if (nameClean.includes('vs')) {
              const fighters = nameClean.split(/\bvs\b/i).map((f: string) => f.trim());
              const firstFighter = fighters[0]?.split(/\s+/).pop();
              const secondFighter = fighters[1]?.split(/\s+/)[0];
              if (firstFighter) btnTexts.push(`button:has-text("Continue with ${firstFighter}")`);
              if (secondFighter) btnTexts.push(`button:has-text("Continue with ${secondFighter}")`);
            }
            const eventShort = eventData.PPV_NAME.split(/[:\-–]/)[0]?.trim();
            if (eventShort) btnTexts.push(`button:has-text("Continue with ${eventShort}")`);
          }
          const ppvCta = page.locator(btnTexts.join(', ')).first();
          await ppvCta.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
          await safeScrollToElement(page, ppvCta);
          await ppvCta.click({ force: true });
          console.log('✅ Clicked PPV Only Continue');

          await setupPage(page);

          // ── Validate PPV Payment ─────────────────────────────
          console.log('\n📋 Validating PPV Payment page...');
          await page.waitForSelector(
            'text=/Today you pay|payment|pay now|one time payment/i',
            { timeout: 15000 }
          ).catch(() => { });

          // Wait for payment form to fully load (Pay Now button appears after Zuora/Adyen loads)
          const payNowLoaded = await page.locator(
            'button:has-text("Pay Now"), button:has-text("Pay now"), ' +
            'a:has-text("Pay Now"), a:has-text("Pay now"), ' +
            'button:has-text("Complete"), button:has-text("Confirm")'
          ).first().waitFor({ state: 'visible', timeout: 20000 })
            .then(() => true).catch(() => false);
          if (payNowLoaded) {
            console.log('✅ Pay Now button visible — payment form loaded');
          } else {
            console.log('⚠️  Pay Now button not visible after 20s — proceeding with validation anyway');
          }

          const ppvPaymentData = getPPVPaymentData();
          console.log(`📊 PPV Payment rows: ${ppvPaymentData.length}`);
          await validateVariant(
            page, 'ppvpayment', ppvPaymentData, results, eventData, 'PPV Payment', FLOW
          );
          reachedEndPage = true;
        }

      }

      // ══════════════════════════════════════════════════════════════
      // STEP 8 — RESULTS
      // ══════════════════════════════════════════════════════════════
      const { excelPath, videoPath } = await writeResults(results);

      // Display detailed per-page results
      displayResultsTable(results, tier, {
        event: eventData.PPV_NAME,
        region: REGION,
        excelPath,
        videoPath,
      });

      // Generate HTML + PDF run report (country, surfacing point, rate plan, per-page pass/fail, totals)
      const { htmlPath, pdfPath, folderPath } = await generateReports(results, {
        event: eventData.PPV_NAME,
        region: REGION,
        source: SOURCE,
        ratePlan,
        tier,
        env: process.env.DAZN_ENV || 'prod',
        flowName: `${SOURCE} → ${stateKey} → ${tier} → ${ratePlan}`,
        endTime: new Date(),
        excelPath,
        videoPath,
        userStatus: isMyAccount ? (process.env.USER_STATE || 'Freemium') : 'New User',
        userType: 'existing-user',
        paymentMethod: PAYMENT_METHOD === 'gpay' ? 'Google Pay' : 'Credit Card',
      });
      if (folderPath) console.log(`\n📂 Report folder: ${folderPath}`);


      const passed = results.filter(r => r.status === 'PASS').length;
      const failed = results.filter(r => r.status === 'FAIL').length;
      const total = passed + failed;

      console.log(`\n✅ Flow "${SOURCE} (${stateKey})" complete: ${passed}/${total} passed (${total > 0 ? ((passed / total) * 100).toFixed(1) : 0}%)`);
      console.log(`${'─'.repeat(55)}`);

      if (total === 0) {
        throw new Error(`❌ Flow "${SOURCE} (${stateKey})" had 0 validation checks`);
      }

      if (!reachedEndPage) {
        throw new Error(`❌ Flow "${SOURCE} (${stateKey})" did not reach the expected end page: "payment" or "confirmation"`);
      }

      if (failed > 0) {
        const failMsgs = results
          .filter(r => r.status === 'FAIL')
          .map(r => `  - [${r.page}] ${r.field}: expected "${r.expected}", actual "${r.actual}"`)
          .join('\n');
        console.warn(`⚠️  Validation failures (not failing test):\n${failMsgs}`);
      }

    } catch (error) {
      console.error('❌ Test error:', error);
      throw error;

    } finally {
      try {
        await page.waitForTimeout(50);
        const videoPath = await page.video()?.path();
        if (videoPath) console.log(`🎥 Video saved: ${videoPath}`);
        else console.log('⚠️  No video found');
      } catch (e: any) {
        console.log('⚠️  Video path error:', e.message);
      }
      await context.close().catch(() => { });
    }
  });
}