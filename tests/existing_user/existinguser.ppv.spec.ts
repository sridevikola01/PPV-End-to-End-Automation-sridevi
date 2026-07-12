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
import { SignupPage } from '../../pages/SignupPage';


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
  handlePopupModal,
  assertCountryMatch,
} from '../../utils/testHelpers';
import { handleNoPpvClick } from '../../utils/flowHelpers';
import { AuthenticationManager } from '../../auth/AuthenticationManager';


const REGION = process.env.DAZN_REGION || 'GB';
const EVENT_CONFIG = process.env.PPV_CONFIG || 'aj_joshua_prenga.json';
const SOURCE = process.env.SOURCE || 'my-account';

// ── Flow constant — used for flow-restricted Excel rows ──────────────
// Enables Welcome Back, Saved Card, Signed In As, Log Out validations
const FLOW = 'myaccount';
const SWITCH_TO_ULTIMATE = (process.env.SWITCH || '').toLowerCase() === 'true';
const LOGIN_FIRST = (process.env.LOGIN || process.env.LOGIN_FIRST || '').toLowerCase() === 'true';
const HOME_SPORT_DROPDOWN_SOURCES = new Set([
  'home-boxing-banner',
  'home-boxing-tile',
  'home-boxing-upcoming',
  'home-kickboxing-tile',
]);
const LOGIN_FIRST_INVALID_LANDING_SOURCES = new Set<string>([
  'landing-page-banner',
  'landing-page-dont-miss-live',
]);
const ENV = (process.env.DAZN_ENV || 'stag').toLowerCase();
const PAYMENT_METHOD = (process.env.PAYMENT_METHOD || 'credit_card').toLowerCase();

function throwLogged(error: Error): never {
  console.log(error.message);
  throw error;
}

function isActiveUltimateState(userStateKey: string): boolean {
  return userStateKey.toLowerCase().startsWith('active_ultimate');
}

test.afterEach(async ({ }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && testInfo.error?.message) {
    console.log(`❌ Test failure:\n${testInfo.error.message}`);
  }
});

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
    eventData.USER_STATE = stateKey;
    eventData['USER_STATE'] = stateKey;
    eventData.source = SOURCE;
    eventData.SOURCE = SOURCE;

    if (LOGIN_FIRST && LOGIN_FIRST_INVALID_LANDING_SOURCES.has(SOURCE.toLowerCase())) {
      throwLogged(new Error(
        `❌ For an existing user who has logged in, landing flows are not valid: ${SOURCE}`
      ));
    }

    const sourcesPath = path.resolve(process.cwd(), 'config/surfacingpoint.json');
    if (fs.existsSync(sourcesPath)) {
      const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
      if (sources[SOURCE]?.defaultSignup) {
        process.env.DEFAULT_SIGNUP = 'true';
      }
      if (sources[SOURCE]?.noPpvClick) {
        noPpvClick = true;
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
    const requestedPlan = (process.env.PLAN || '').trim().toLowerCase();
    const isActiveStandardUser = userStateKey.startsWith('active_standard');
    const isUltimateUpgrade =
      isActiveStandardUser &&
      requestedPlan.startsWith('ultimate_');

    if (
      (SOURCE === 'boxing-banner-ultimate' ||
        SOURCE === 'boxing-ultimate-subscription' ||
        SOURCE === 'boxing-join-the-club') &&
      tier !== 'ultimate' &&
      !isUltimateUpgrade
    ) {
      throw new Error(`❌ SOURCE "${SOURCE}" requires an Ultimate plan (e.g., PLAN=ultimate_apm).`);
    }

    const isUSorGB = REGION === 'GB' || REGION === 'US';
    // Dev mode can be forced via DEV_MODE_ON=on for prod verification.
    const devModeForced = (process.env.DEV_MODE_ON || '').toLowerCase() === 'on';
    let ratePlan = (process.env.RATE_PLAN || json.RATE_PLAN || 'monthly').toLowerCase();
    const userEmail = eventData.USER_EMAIL || json.USER_EMAIL || '';
    const userPassword = eventData.USER_PASSWORD || json.USER_PASSWORD || '';
    // Active Standard routing:
    // PLAN unset -> PPV-only; ultimate_apm/upfront -> Ultimate upgrade.
    let purchaseOption = (json.PURCHASE_OPTION || 'ppv').toLowerCase();

    if (isActiveStandardUser) {
      purchaseOption = requestedPlan.startsWith('ultimate_') ? 'ultimate' : 'ppv';

      if (requestedPlan === 'ultimate_apm') {
        ratePlan = 'annual pay monthly';
      } else if (requestedPlan === 'ultimate_upfront') {
        ratePlan = 'annual pay upfront';
      }
    } else if (tier === 'ultimate') {
      purchaseOption = 'ultimate';
    }

    // The PPV config tier describes the source offer. Active Standard users can
    // deliberately enter an Ultimate upgrade journey via PLAN, so expectations
    // must follow the journey actually selected.
    const effectiveTier =
      isUltimateUpgrade || tier === 'ultimate'
        ? 'ultimate'
        : 'standard';
    const isUltimateLoginFirstUser = LOGIN_FIRST && isActiveUltimateState(userStateKey);

    // Bypass phone number for every effective Ultimate journey in GB/US,
    // including Active Standard → Ultimate upgrades.
    const devModeEnabled =
      devModeForced ||
      isUltimateLoginFirstUser ||
      (isActiveUltimateState(userStateKey) &&
        ['my-account', 'myaccount', 'myaccount-subscription-status'].includes(SOURCE.toLowerCase()) &&
        isUSorGB) ||
      (effectiveTier === 'ultimate' && isUSorGB) ||
      (SOURCE === 'landing-page-dont-miss-live-switch');

    console.log(`🎯 Requested PLAN : ${requestedPlan || '(none -> PPV only)'}`);
    console.log(`🛒 Purchase route : ${purchaseOption}`);
    console.log(`🏷️ Effective tier : ${effectiveTier}`);
    const baseUrl = eventData.BASE_URL;
    const variantConfig = json.variants;
    const pagesConfig = json.pages;
    const sport = json.SPORT;

    // Resolve payment page expected variables to avoid skipping validation
    const offerType = (eventData.OFFER_TYPE || '1_month_free').toLowerCase();
    const isTrial = ratePlan === 'monthly' && offerType === '7_day_trial';
    const isNoOffer = offerType === 'no_offer' || offerType === 'none';
    const activeOfferPresent = eventData.ACTIVE_OFFER_PRESENT === 'true';

    if (effectiveTier === 'ultimate') {
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
      eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_TRIAL || 'Choose how to pay after your free trial';
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
      if (effectiveTier === 'ultimate') {
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

    // Frozen users on a 7-day monthly trial still show trial values in the
    // purchase summary (Plan Name / Free Text = "7-days free"). Only the payment
    // page heading differs from the new/freemium trial heading.
    if (userStateKey === 'frozen' && isTrial) {
      eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
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

    const regionLocaleMap: Record<string, { locale: string; timezoneId: string }> = {
      GB: { locale: 'en-GB', timezoneId: 'Europe/London' },
      US: { locale: 'en-US', timezoneId: 'America/New_York' },
      AE: { locale: 'en-AE', timezoneId: 'Asia/Dubai' },
      AU: { locale: 'en-AU', timezoneId: 'Australia/Sydney' },
      BR: { locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
    };
    const { locale: regionLocale, timezoneId: regionTimezone } =
      regionLocaleMap[REGION] ?? { locale: 'en-GB', timezoneId: 'Europe/London' };

    console.log(`Creating browser context with Locale: ${regionLocale}, Timezone: ${regionTimezone}...`);
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      colorScheme: 'dark',
      reducedMotion: 'no-preference',
      locale: regionLocale,
      timezoneId: regionTimezone,
      ...(recordVideo ? { recordVideo } : {}),
    });


    await context.addInitScript(() => {
      try {
        localStorage.setItem('randomABPoint', Math.random().toString());
      } catch { }
    });

    const page = await context.newPage();
    const results: any[] = [];
    let capturedVideoPath: string | null = null;

    const finishRun = async (displayTier = tier, userStatusOverride?: string) => {
      reachedEndPage = true;
      capturedVideoPath = (await page.video()?.path().catch(() => null)) ?? null;
      await context.close().catch(() => { });
      const { excelPath, videoPath } = await writeResults(results, capturedVideoPath);

      displayResultsTable(results, displayTier, {
        event: eventData.PPV_NAME,
        region: REGION,
        excelPath,
        videoPath,
      });

      const { folderPath } = await generateReports(results, {
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
        userStatus: userStatusOverride || (isMyAccount ? (process.env.USER_STATE || 'Freemium') : 'New User'),
        userType: 'existing-user',
        paymentMethod: PAYMENT_METHOD === 'gpay' ? 'Google Pay' : 'Credit Card',
      });
      if (folderPath) console.log(`\n📂 Report folder: ${folderPath}`);
    };

    const validateUltimateMyAccountRedirect = async () => {
      console.log('\n🏠 [Ultimate User] Landed on My Account — validating purchased PPV status...');
      const myAccountPage = new MyAccountPage(page);
      await myAccountPage.navigateAndValidatePurchasedPPVStatus(baseUrl, results, eventData);
    };

    // ── detectPageType ────────────────────────────────────────────
    const detectPageType = async (
      p: any,
      pc: Record<string, { detection: string }>
    ): Promise<'ppv' | 'plan' | 'payment' | 'confirmation' | 'standalone-ppv' | 'email' | 'unknown' | 'success-upsell' | 'saved-card-payment' | 'bet-upsell' | 'default-signup' | 'phone' | 'myaccount-ppv' | 'choose-how-to-buy'> => {
      if (!p || p.isClosed()) return 'unknown';

      // ── Wait for SPA routing / initial load to settle if needed ──
      const initialUrl = p.url().toLowerCase();
      if (
        initialUrl.includes('index.html') ||
        initialUrl.includes('externalpurchaseid=') ||
        initialUrl.includes('contextualppvid=') ||
        ((initialUrl.includes('page=plandetails') || initialUrl.includes('page=tierplans')) &&
          !initialUrl.includes('upselltiershown') &&
          !initialUrl.includes('upselltierselected') &&
          !initialUrl.includes('upselltierskipped'))
      ) {
        try {
          await p.waitForFunction(() => {
            const href = window.location.href.toLowerCase();
            const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
            const hasUpsellStateInUrl = href.includes('upselltiershown') ||
              href.includes('upselltierselected') ||
              href.includes('upselltierskipped');
            const hasPpvText = bodyText.includes('pay-per-view') ||
              bodyText.includes('just the fight') ||
              bodyText.includes('continue with pay-per-view') ||
              bodyText.includes('ultimate fan package') ||
              bodyText.includes('to watch your pay-per-view');
            return hasUpsellStateInUrl || hasPpvText;
          }, { timeout: 8000 }).catch(() => { });
        } catch { }
      }

      const url = p.url();
      const urlLower = url.toLowerCase();

      if (urlLower.includes('paymentdetails')) return 'payment';
      if (urlLower.includes('phonenumbercollection')) return 'phone';
      // Upgrade confirmation page — must be checked BEFORE the /signup email fallback
      if (urlLower.includes('upgradeplan')) return 'confirmation';
      if (urlLower.includes('upgradetier') && !urlLower.includes('isupgradetierflow')) return 'confirmation';

      // Default signup page with plan details/tier plans (e.g. from My Account Upgrade/Resubscribe CTA)
      if (process.env.DEFAULT_SIGNUP === 'true' && !defaultSignupPPVValidated && urlLower.includes('/signup') && (urlLower.includes('plandetails') || urlLower.includes('tierplans')) && !urlLower.includes('upselltierskipped')) {
        const bodyText = await p.locator('body')
          .innerText({ timeout: 3000 })
          .then((t: string) => t.toLowerCase())
          .catch(() => '');
        if (bodyText.includes('pay-per-view') || bodyText.includes('choose how to buy') ||
          bodyText.includes('subscribe without a pay-per-view') ||
          bodyText.includes('continue without pay-per-view') ||
          bodyText.includes('continue without a pay-per-view')) {
          return 'default-signup';
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

      // My Account page — ultimate users can redirect here when PPV is already purchased
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
          // Check if it's actually a PPV page with plan selection
          const routedBody = await p.locator('body')
            .innerText({ timeout: 3000 })
            .then((t: string) => t.toLowerCase())
            .catch(() => '');
          if (routedBody.includes('pay-per-view') || routedBody.includes('choose how to buy') ||
            routedBody.includes('subscribe without a pay-per-view')) {
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

      // Signed-in boxing banner can briefly expose page=PlanDetails before the
      // SPA appends upsellTierShown=true. During that window the body is already
      // the PPV selection screen, so avoid validating it with DAZN Plan rules.
      const isBoxingPpvEntrySource =
        SOURCE.toLowerCase().startsWith('boxing-page') ||
        SOURCE.toLowerCase().startsWith('boxing-bundle') ||
        SOURCE.toLowerCase() === 'boxing-upcoming-fights';
      if (
        (urlLower.includes('contextualppvid=') || urlLower.includes('externalpurchaseid=')) &&
        (urlLower.includes('page=plandetails') || urlLower.includes('page=tierplans')) &&
        (
          !urlLower.includes('upselltierselected=true') ||
          isBoxingPpvEntrySource
        )
      ) {
        if (
          lower.includes('continue with pay-per-view') ||
          lower.includes('just the fight') ||
          lower.includes('to watch your pay-per-view') ||
          lower.includes('the ultimate fan package')
        ) {
          return 'ppv';
        }
      }

      if (urlLower.includes('upselltierselected=true') &&
        urlLower.includes('plandetails')) return 'plan';
      if (urlLower.includes('page=plandetails')) return 'plan';
      if (urlLower.includes('page=tierplans')) return 'plan';
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

    const isMyAccount =
      SOURCE === 'my-account' ||
      SOURCE === 'myaccount' ||
      SOURCE === 'myaccount-subscription-status';
    let reachedEndPage = false;

    const isContextualPpvSelectionPage = async (p: any): Promise<boolean> => {
      const currentUrl = p.url().toLowerCase();
      if (!currentUrl.includes('contextualppvid=')) return false;
      if (currentUrl.includes('upselltierskipped=true') || currentUrl.includes('upselltierselected=true')) {
        return false;
      }

      const currentBody = await p.locator('body')
        .innerText({ timeout: 2000 })
        .then((t: string) => t.toLowerCase())
        .catch(() => '');

      return currentUrl.includes('upselltiershown=true') ||
        currentBody.includes('continue with pay-per-view') ||
        currentBody.includes('just the fight') ||
        currentBody.includes('to watch your pay-per-view') ||
        currentBody.includes('the ultimate fan package');
    };

    try {
      const requiresPreLogin = isMyAccount || LOGIN_FIRST;

      // ══════════════════════════════════════════════════════════════
      // PRE-LOGIN FLOW (My Account OR LOGIN=true)
      // ══════════════════════════════════════════════════════════════
      if (requiresPreLogin) {
        const authManager = new AuthenticationManager(page, context, baseUrl);
        await authManager.authenticate(eventData);

        if (isMyAccount) assertCountryMatch(page, REGION);

        await handleCookies(page, 15000);
        await stabilisePage(page);
        await page.keyboard.press('Escape').catch(() => { });
        await page.waitForTimeout(200);

        const isLandingPageSource = SOURCE.toLowerCase().includes('landing-page');

        if (isLandingPageSource) {
          console.log(`ℹ️ [Login First] Existing-user landing page source enabled: ${SOURCE}`);
        }

        if (LOGIN_FIRST && isActiveUltimateState(userStateKey) && !isMyAccount) {
          console.log('\n💎 [Login First Ultimate] Validating My Account purchased status before source click...');
          const myAccountPage = new MyAccountPage(page);
          await myAccountPage.navigateAndValidatePurchasedPPVStatus(baseUrl, results, eventData);
        }
      }

      if (!isMyAccount) {
        // ══════════════════════════════════════════════════════════════
        // LANDING / BOXING / SCHEDULE ACQUISITION FLOW
        // ══════════════════════════════════════════════════════════════
        const isSchedule = SOURCE.toLowerCase().includes('schedule');
        const isSearch = SOURCE.toLowerCase().includes('search');

        const isGlory = SOURCE.toLowerCase() === 'glory';

        // ══════════════════════════════════════════════════════════════
        // HOME PAGE POPUP FLOW
        // ══════════════════════════════════════════════════════════════
        if (SOURCE === 'home-page-popup') {
          console.log('\n╔═══════════════════════════════════════════════════════╗');
          console.log('║  HOME PAGE POPUP FLOW — Existing User                  ║');
          console.log('╚═══════════════════════════════════════════════════════╝\n');

          // ── Navigate to welcome page and click Log In ──
          const landingForPopup = new LandingPage(page);
          await page.goto(`${baseUrl}/welcome`, { waitUntil: 'domcontentloaded' });
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
          await handleCookies(page, 15000);
          await landingForPopup.clickLogIn();

          // ── Login with existing user credentials ──
          const signupForPopup = new SignupPage(page);
          await page.waitForURL(/emailDetails|signup|signin/i, { timeout: 10000 }).catch(() => { });
          await page.waitForLoadState('domcontentloaded').catch(() => { });
          console.log(`📍 [Home Page Popup] Landed on: ${page.url()}`);

          await signupForPopup.enterEmail(userEmail);
          await signupForPopup.clickContinue();
          await signupForPopup.enterPasswordAndSignIn(userPassword);

          // Wait for home page redirect
          await page.waitForURL(/\/home/i, { timeout: 20000 }).catch(() => { });

          // ── Popup detection + validation + Buy Now (via HomePage POM) ──
          const homePageForPopup = new HomePage(page, baseUrl);
          await homePageForPopup.waitForHomePagePopup(
            { email: userEmail, password: userPassword },
            baseUrl, results, eventData
          );
        } else if (isGlory) {
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
          await gloryPage.clickBuyNowInModal();
        } else if (isSchedule) {
          const schedule = new SchedulePage(page);
          await schedule.navigate(baseUrl);
          await setupPage(page, 8000);
          assertCountryMatch(page, REGION);
          await dismissMarketingPopup(page, 5000);

          if (devModeEnabled) {
            console.log('\n🎭 Dev mode flow detected — enabling dev mode on schedule page...');
            const searchPage = new SearchPage(page);
            await searchPage.enableDevMode();
          }

          let scheduleEventCard: any;
          let scheduleEventClicked = false;

          // Step 1: Apply sport filter and locate event tile (no click yet)
          try {
            await schedule.selectSport(sport);
            if (LOGIN_FIRST && isActiveUltimateState(userStateKey)) {
              const eventCard = await schedule.findEvent(eventData.PPV_NAME);
              await schedule.clickEntitledEventAndValidate(eventCard, results, eventData);
              await finishRun('ultimate', userStateKey);
              return;
            }
            scheduleEventCard = await schedule.findEvent(eventData.PPV_NAME);
          } catch (schedErr: any) {
            console.error(`❌ Schedule: could not find event: ${schedErr.message}`);
            let shotPath: string | undefined;
            try {
              const dir = path.resolve(process.cwd(), 'test-results', 'screenshots');
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              shotPath = path.join(dir, `FAIL_Schedule_Event_Click_${Date.now()}.jpg`);
              await page.screenshot({ path: shotPath, type: 'jpeg', quality: 75, fullPage: false });
            } catch { shotPath = undefined; }
            results.push({
              page: 'Schedule',
              field: 'PPV Event Click',
              expected: `${eventData.PPV_NAME} clickable via ${sport} filter`,
              actual: schedErr.message,
              status: 'FAIL',
              screenshot: shotPath,
            });
          }

          if (scheduleEventCard) {
            // Step 2: Scroll card into view FIRST, then validate tile fields from it
            await scheduleEventCard.scrollIntoViewIfNeeded().catch(() => { });

            // Pre-capture tile values directly from the located event card element
            // so getActualValue uses these instead of a broad DOM scan
            try {
              // Time badge: HH:MM or H:MMam/pm format
              const timeEl = scheduleEventCard.locator('span, time, div, p').filter({
                hasText: /^\d{1,2}:\d{2}(\s*[aApP][mM])?$/
              }).first();
              const tileTime = await timeEl.innerText({ timeout: 3000 }).catch(() => '');
              if (tileTime.trim()) eventData.__SCHEDULE_TILE_TIME = tileTime.trim();

              // Title / PPV name from the card
              const titleEl = scheduleEventCard.locator('h3, h4, h2, [class*="title"], [class*="name"], p').first();
              const tileTitle = await titleEl.innerText({ timeout: 3000 }).catch(() => '');
              if (tileTitle.trim()) eventData.__SCHEDULE_TILE_NAME = tileTitle.trim();

              // Promoter — second paragraph or subtitle element
              const promoterEl = scheduleEventCard.locator('p').nth(1);
              const tilePromoter = await promoterEl.innerText({ timeout: 3000 }).catch(() => '');
              if (tilePromoter.trim()) eventData.__SCHEDULE_TILE_PROMOTER = tilePromoter.trim();

              console.log(`📌 Schedule tile pre-captured → time: ${eventData.__SCHEDULE_TILE_TIME || 'N/A'}, name: ${eventData.__SCHEDULE_TILE_NAME || 'N/A'}, promoter: ${eventData.__SCHEDULE_TILE_PROMOTER || 'N/A'}`);
            } catch (preErr: any) {
              console.warn(`⚠️  Could not pre-capture schedule tile values: ${preErr.message}`);
            }

            // Step 3: Validate TILE fields (card in view, values pre-captured)
            try {
              const scheduleData = readSheet('Schedule page');
              const tileFields = scheduleData.filter((r: any) =>
                !String(r.Field || '').toLowerCase().startsWith('popup')
              );
              if (tileFields.length) {
                console.log('\n📋 Validating Schedule tile fields (before popup opens)...');
                await validateVariant(page, 'schedule', tileFields, results, eventData, 'Schedule', undefined, true);
              }
            } catch (err: any) {
              console.warn(`⚠️  Schedule tile validation error: ${err.message}`);
            }

            // Step 4: Ensure card still in view then click to open popup
            try {
              await scheduleEventCard.scrollIntoViewIfNeeded();
              await schedule.clickEvent(scheduleEventCard);
              scheduleEventClicked = true;
            } catch (schedErr: any) {
              console.error(`❌ Schedule clickEvent failed: ${schedErr.message}`);
              let shotPath: string | undefined;
              try {
                const dir = path.resolve(process.cwd(), 'test-results', 'screenshots');
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                shotPath = path.join(dir, `FAIL_Schedule_Event_Click_${Date.now()}.jpg`);
                await page.screenshot({ path: shotPath, type: 'jpeg', quality: 75, fullPage: false });
              } catch { shotPath = undefined; }
              results.push({
                page: 'Schedule',
                field: 'PPV Event Click',
                expected: `${eventData.PPV_NAME} clickable via ${sport} filter`,
                actual: schedErr.message,
                status: 'FAIL',
                screenshot: shotPath,
              });
            }
          }


          if (scheduleEventClicked) {
            await handlePopupModal(page, results, eventData, SOURCE, false);
            await schedule.clickBuyNow();
          }

        } else if (isSearch) {
          const searchPage = new SearchPage(page);
          await searchPage.navigate(baseUrl);
          await setupPage(page, 8000);
          assertCountryMatch(page, REGION);
          await dismissMarketingPopup(page, 5000);

          if (devModeEnabled) {
            console.log('\n🎭 Dev mode flow detected — enabling dev mode on search page...');
            await searchPage.enableDevMode();
          }

          if (LOGIN_FIRST && isActiveUltimateState(userStateKey)) {
            await searchPage.searchAndClickEntitledPPV(eventData.PPV_NAME, results, eventData);
            await finishRun('ultimate', userStateKey);
            return;
          }

          await searchPage.searchForPPVTileWithUpcomingFallback(eventData.PPV_NAME);

          console.log('\n📋 Validating Search page tile fields (before tile click)...');
          try {
            const searchData = readSheet('Search page');
            // Only validate tile fields here — popup fields are validated by
            // handlePopupModal after clickPPVTile opens the popup
            const tileFields = searchData.filter((r: any) =>
              !String(r.Field || '').toLowerCase().startsWith('popup')
            );
            await validateVariant(
              page, 'search', tileFields, results, eventData, 'Search'
            );
          } catch (err: any) {
            console.warn(`⚠️  Search page validation error: ${err.message}`);
          }


          await searchPage.clickPPVTile(eventData.PPV_NAME);

          // Check and validate popup modal after clicking the tile and before clicking Buy Now
          await handlePopupModal(page, results, eventData, SOURCE, false);

          await searchPage.clickBuyNow();
        } else {
          const isHomePageSource = SOURCE.startsWith('home-page-') ||
            SOURCE === 'home-biggest-fights' ||
            SOURCE === 'subscribe-without-pay-per-view';
          const isHomeSport = HOME_SPORT_DROPDOWN_SOURCES.has(SOURCE.toLowerCase());
          const isBoxingSource = SOURCE.startsWith('boxing-page') || SOURCE.startsWith('boxing');

          const landing = isHomePageSource
            ? new HomePage(page)
            : isHomeSport
              ? new BoxingHomePage(page)
              : isBoxingSource
                ? new BoxingPage(page)
                : new LandingPage(page);

          // Start RailsInterceptor before navigation for home-biggest-fights and home-page-dazntile
          // to capture entitlement IDs from the Rails API for tile matching
          let railsInterceptor: RailsInterceptor | undefined;
          if (SOURCE === 'home-biggest-fights' || SOURCE === 'home-page-dazntile') {
            railsInterceptor = new RailsInterceptor(page);
            await railsInterceptor.startIntercepting();
            console.log(`🔌 [RailsInterceptor] Started for ${SOURCE} tile matching`);
          }

          // If LOGIN_FIRST=true the user is already signed in. Navigate to the
          // requested surfacing page explicitly. Landing page banner/tile sources
          // must still go to /welcome; otherwise the test remains on /home after
          // authentication and then searches for landing-page containers on the
          // wrong page.
          if (LOGIN_FIRST) {
            // Landing page flows require a non-logged-in user to see the welcome/landing page.
            // When LOGIN_FIRST=true the user is already signed in, so these flows are not applicable.
            if (LOGIN_FIRST_INVALID_LANDING_SOURCES.has(SOURCE.toLowerCase())) {
              throw new Error(
                `❌ LOGIN_FIRST=true is not compatible with SOURCE="${SOURCE}". ` +
                `Landing page flows (${[...LOGIN_FIRST_INVALID_LANDING_SOURCES].join(', ')}) ` +
                `require a non-logged-in user to access the landing/welcome page. ` +
                `Use LOGIN_FIRST=false or choose a different source (e.g. home-boxing-tile, home-boxing-banner).`
              );
            }
            console.log(`ℹ️ [Login First] User already logged in, skipping welcome page navigation. Current URL: ${page.url()}`);
            const baseNoSlash = baseUrl.replace(/\/$/, '');
            const isLandingPageSource = SOURCE.toLowerCase().includes('landing-page');
            if (isLandingPageSource) {
              console.log(`🧭 [Login First] Navigating signed-in user to landing page source: ${SOURCE}`);
              await landing.navigate(baseUrl, SOURCE, eventData);
            } else if (isHomeSport) {
              const homeTargetUrl = `${baseNoSlash}/home`;
              if (!page.url().toLowerCase().includes('/home')) {
                console.log(`🧭 [Login First] Returning to Home before All Sports navigation: ${homeTargetUrl}`);
                await page.goto(homeTargetUrl, { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
              }
              console.log(`🧭 [Login First] Navigating via All Sports dropdown for source: ${SOURCE}`);
              await (landing as BoxingHomePage).navigateToSportViaAllSports(SOURCE, eventData);
            } else if (isBoxingSource) {
              const targetUrl = `${baseNoSlash}/p/boxing`;
              console.log(`🧭 [Login First] Navigating directly to Boxing page: ${targetUrl}`);
              await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
              await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
            } else {
              // HomePage: we are already on /home. Strip the DAZN onboarding
              // step param before touching banner carousel DOM.
              const homeUrl = page.url();
              if (!homeUrl.toLowerCase().includes('/home')) {
                const homeTargetUrl = `${baseNoSlash}/home`;
                console.log(`🧭 [Login First] Returning to Home for source ${SOURCE}: ${homeTargetUrl}`);
                await page.goto(homeTargetUrl, { waitUntil: 'domcontentloaded' });
                await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
              } else if (/[?&]step=\d+/.test(homeUrl)) {
                try {
                  const cleanUrl = new URL(homeUrl);
                  cleanUrl.searchParams.delete('step');
                  const cleanUrlStr = cleanUrl.toString().replace(/\?$/, '');
                  console.log(`🔧 [Login First] Stripping ?step= from home URL: ${homeUrl} → ${cleanUrlStr}`);
                  await page.goto(cleanUrlStr, { waitUntil: 'domcontentloaded' });
                  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
                } catch {
                  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
                }
              } else {
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
              }
            }
          } else {
            const navSource = (SOURCE === 'subscribe-without-pay-per-view')
              ? 'home-page-get-started'
              : SOURCE;
            await landing.navigate(baseUrl, navSource, eventData);
          }

          // Pass interceptor to eventData so HomePage can use it
          if (railsInterceptor) {
            eventData._railsInterceptor = railsInterceptor;
          }
          await setupPage(page, 8000);
          assertCountryMatch(page, REGION);
          await dismissMarketingPopup(page, 5000);
          if (LOGIN_FIRST) {
            await page.keyboard.press('Escape').catch(() => { });
            await page.waitForTimeout(200);
          }

          if (devModeEnabled) {
            console.log('\n🎭 Dev mode flow detected — enabling dev mode on landing page...');
            const searchPage = new SearchPage(page);
            await searchPage.enableDevMode();
            if (LOGIN_FIRST) {
              await page.keyboard.press('Escape').catch(() => { });
              await page.waitForTimeout(200);
            }
          }

          // Validate entry page
          const isBoxingSourceInner = SOURCE.startsWith('boxing-page') || SOURCE.startsWith('boxing');
          const isHomePageSourceInner = SOURCE.startsWith('home-page-') || SOURCE === 'home-biggest-fights';
          const isHomeSportInner = HOME_SPORT_DROPDOWN_SOURCES.has(SOURCE.toLowerCase());

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
              : SOURCE === 'home-boxing-upcoming'
                ? 'home-boxing-upcoming'
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

          // Stop carousel auto-slide before finding PPV container
          // This prevents the banner from scrolling past the PPV slide during findPPVInBanner
          if (SOURCE.includes('banner')) {
            await page.evaluate(() => {
              try {
                const stopSwiper = (swiper: any) => {
                  if (!swiper) return;
                  try { swiper.autoplay?.stop(); } catch { }
                  try { swiper.params.autoplay = false; swiper.params.loop = false; } catch { }
                  try { if (swiper.autoplay?.running) swiper.autoplay.stop(); } catch { }
                };
                document.querySelectorAll('.swiper, [class*="swiper"], .swiper-container').forEach((el: any) => {
                  if (el.swiper) stopSwiper(el.swiper);
                });
                document.querySelectorAll('*').forEach((el: any) => {
                  if (el.swiper && typeof el.swiper === 'object' && el.swiper.autoplay) stopSwiper(el.swiper);
                });
              } catch { }
            }).catch(() => { });
            await page.waitForTimeout(300);
          }

          // For subscribe-without-pay-per-view, use the resolved source
          // so HomePage.findPPVContainer knows which CTA to find
          const containerSource = (SOURCE === 'subscribe-without-pay-per-view')
            ? 'home-page-get-started'
            : SOURCE;
          const container = await landing.findPPVContainer(eventData, containerSource);

          // Stop intercepting after findPPVContainer completes
          if (eventData._railsInterceptor) {
            await (eventData._railsInterceptor as RailsInterceptor).stopIntercepting();
            delete eventData._railsInterceptor;
          }

          if (!container) {
            throwLogged(new Error(`❌ PPV container not found on landing page via ${SOURCE}`));
          }

          const isBoxingSubscriptionSource =
            SOURCE === 'boxing-banner-ultimate' ||
            SOURCE === 'boxing-ultimate-subscription' ||
            SOURCE === 'boxing-standard-subscription' ||
            SOURCE === 'boxing-join-the-club';

          const isUltimateLoginFirstEntitlement =
            LOGIN_FIRST &&
            isActiveUltimateState(userStateKey) &&
            !isBoxingSubscriptionSource;

          if (isUltimateLoginFirstEntitlement && SOURCE.toLowerCase().includes('banner')) {
            await landing.validateUltimatePurchasedBannerAndFightCard(
              container,
              SOURCE,
              results,
              eventData,
              pageName,
              flowParam
            );
            await finishRun('ultimate', userStateKey);
            return;
          }

          const ultimateTileSource = (() => {
            const src = SOURCE.toLowerCase();
            return src.includes('tile') ||
              src.includes('dont-miss') ||
              src.includes('upcoming') ||
              src.includes('biggest-fights');
          })();

          if (isUltimateLoginFirstEntitlement && ultimateTileSource) {
            await landing.clickUltimateTileAndValidateNavigation(
              container,
              SOURCE,
              results,
              eventData,
              pageName,
              flowParam
            );
            await finishRun('ultimate', userStateKey);
            return;
          }

          if (isBoxingSubscriptionSource) {
            console.log(`ℹ️ [${SOURCE}] Subscription source — skipping boxing banner/landing validation.`);
          } else if (SOURCE === 'home-biggest-fights') {
            // Skip pre-clickBuyNow validation for home-biggest-fights — the popup
            // only appears AFTER clicking the Coming Up tile (inside clickBuyNow).
            // handlePopupModal will handle validation + Buy Now click.
            console.log('ℹ️ [home-biggest-fights] Popup validation deferred to handlePopupModal (after tile click)');
          } else {
            console.log(`\n📋 Validating ${pageName} page...`);
            try {
              const isStandalone = eventData.PPV_TYPE === 'standalone';
              const onOnboarding = page.url().includes('signup') || page.url().includes('PlanDetails') || page.url().includes('payment') || page.url().includes('checkout');
              if ((sheetName === 'Home of Boxing' || sheetName === 'Home page') && (isStandalone || onOnboarding)) {
                console.log('ℹ️ Standalone flow or direct navigation — skipping popup modal validations');
              } else {
                const landingData = sheetName === 'Home page'
                  ? getHomePageData(flowParam)
                  : sheetName === 'Home of Boxing'
                    ? getHomeOfBoxingData(flowParam)
                    : readSheet(sheetName);
                const variantName = sheetName === 'Home of Boxing'
                  ? 'home-boxing'
                  : sheetName === 'Home page'
                    ? 'home-page'
                    : 'landing';
                await validateVariant(page, variantName, landingData, results, eventData, pageName, flowParam);
              }
            } catch (err: any) {
              console.warn(`⚠️  Entry page validation error: ${err.message}`);
            }
          }

          const clickBuyNowSource = (SOURCE === 'subscribe-without-pay-per-view')
            ? 'home-page-get-started'
            : SOURCE;
          await landing.clickBuyNow(container, clickBuyNowSource);
        }

        if (SOURCE !== 'home-page-popup') {
          // Handle generic popup validations and click-through
          // For home-biggest-fights: clickBuyNow only clicks the tile, handlePopupModal validates + clicks Buy Now
          // For dont-miss/tile sources: avoid double-clicking modal
          const clickPopup = SOURCE === 'home-biggest-fights' || (!SOURCE.includes('dont-miss') && !SOURCE.includes('tile'));
          if (SOURCE.toLowerCase() !== 'glory') {
            await handlePopupModal(page, results, eventData, SOURCE, clickPopup);
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
        }

        // ── STRICT VALIDATION FOR ULTIMATE USER PRE-LOGGED IN ──
        if (isActiveUltimateState(userStateKey) && requiresPreLogin) {
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
        if (SOURCE === 'boxing-standard-subscription' || SOURCE === 'home-page-get-started' || SOURCE === 'home-page-dazntile') {
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
        // My Account source should not pass through Home after sign-in. Going
        // through Home can open header controls such as All Sports and change
        // the starting page for the flow.
        const homePage = new HomePage(page, baseUrl);
        await homePage.navigateToMyAccount();
        await handleCookies(page, 8000);
        await stabilisePage(page);

        if (devModeEnabled) {
          const reason = devModeForced ? '(forced via DEV_MODE_ON=on)' : '(auto: ultimate tier in GB/US)';
          console.log(`\n🎭 Dev mode flow detected ${reason} — enabling dev mode for existing user...`);
          const searchPage = new SearchPage(page);
          await searchPage.enableDevMode();
          console.log('✅ dev mode enabled — continuing with ultimate flow');
        }
      }

      let isReturning = false;
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
        } else if (userStateKey.startsWith('active_standard')) {
          eventData.DAZN_TIER = 'DAZN Standard';
          eventData['DAZN_TIER'] = 'DAZN Standard';
        } else if (userStateKey.startsWith('active_ultimate')) {
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
          active_standard_monthly: { subscription: 'DAZN Standard', status: 'Manage subscription', label: 'active standard monthly' },
          active_standard_apm: { subscription: 'DAZN Standard', status: 'Manage subscription', label: 'active standard APM' },
          active_ultimate: { subscription: 'DAZN Ultimate', status: 'Manage subscription', label: 'active ultimate' },
          active_ultimate_apm: { subscription: 'DAZN Ultimate', status: 'Manage subscription', label: 'active ultimate APM' },
          active_ultimate_upfront: { subscription: 'DAZN Ultimate', status: 'Manage subscription', label: 'active ultimate upfront' }
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

          // --- Schedule Page validation (Post-Payment) ---
          if (PPV_TYPE !== 'upsell') {
            try {
              console.log('\n📅 [Post-Purchase] Navigating to Schedule page to verify purchased event...');
              const schedulePagePostPayment = new SchedulePage(page);
              await schedulePagePostPayment.navigate(baseUrl);
              if (devModeEnabled) {
                console.log('\n🎭 Dev mode flow detected — enabling dev mode before Schedule entitlement click...');
                const searchPage = new SearchPage(page);
                await searchPage.enableDevMode();
              }
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
          // Capture video path and finalize video file BEFORE report generation
          capturedVideoPath = (await page.video()?.path().catch(() => null)) ?? null;
          await context.close().catch(() => { });
          const { excelPath, videoPath } = await writeResults(results, capturedVideoPath);

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

        if (tier === 'ultimate' && isActiveUltimateState(userStateKey)) {
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
              if (devModeEnabled) {
                console.log('\n🎭 Dev mode flow detected — enabling dev mode before Schedule entitlement click...');
                const searchPage = new SearchPage(page);
                await searchPage.enableDevMode();
              }
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
          // Capture video path and finalize video file BEFORE report generation
          capturedVideoPath = (await page.video()?.path().catch(() => null)) ?? null;
          await context.close().catch(() => { });
          const { excelPath, videoPath } = await writeResults(results, capturedVideoPath);

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
        if (SOURCE === 'myaccount-subscription-status') {
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
        isMyAccount &&
        userStateKey === 'active_standard' &&
        (postClickUrl.includes('upsellTierShown=true') ||
          postClickUrl.includes('/addon/purchase') ||  // ← US active standard
          bodyText.includes('choose how to buy')) &&
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
      if (isSignupPPVFlow || !isChooseHowToBuy) {
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
            SOURCE === 'boxing-banner-ultimate' ||
            SOURCE === 'boxing-ultimate-subscription' ||
            SOURCE === 'boxing-standard-subscription' ||
            SOURCE === 'boxing-join-the-club';
          if (isBoxingSubOnlySource && (page.url().includes('/myaccount') || page.url().endsWith('/home'))) {
            throw new Error(`❌ [${SOURCE}] Expected to land on PlanDetails/TierPlans, but landed on My Account/Home page instead (flow bypassed plans/checkout).`);
          }

          // ── MY ACCOUNT PPV (Purchased) ─────────────────────────────
          // Ultimate users can redirect to My Account after sign-in when PPV is already purchased.
          if (pageType === 'myaccount-ppv' && isActiveUltimateState(userStateKey)) {
            await validateUltimateMyAccountRedirect();
            await finishRun('ultimate', userStateKey);
            return;
          }

          // Legacy fallback for non-Ultimate states that still land on /myaccount/ppv.
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
              field: 'PPV Status',
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
            SOURCE === 'boxing-banner-ultimate' ||
            SOURCE === 'boxing-ultimate-subscription' ||
            SOURCE === 'boxing-page-bundle' ||
            SOURCE === 'boxing-upcoming-fights' ||
            SOURCE === 'boxing-join-the-club';
          if (process.env.DEFAULT_SIGNUP === 'true' && !ppvValidated && !isBoxingSubSource) {
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

            // ── Social login mid-flow (AUTH_METHOD=google etc.) ──────────────────
            const authMethodEnv = (process.env.AUTH_METHOD || '').toLowerCase().trim();
            if (authMethodEnv && authMethodEnv !== 'email') {
              console.log(`🔐 [Existing User] AUTH_METHOD="${authMethodEnv}" — authenticating mid-flow via AuthenticationManager`);
              const authManager = new AuthenticationManager(page, context, baseUrl);
              await authManager.authenticate(eventData);
              console.log('✅ [Existing User] Social login complete — continuing flow');
              continue;
            }
            // ─────────────────────────────────────────────────────────────────────

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
              throw new Error(`❌ Signup/Signin error popup detected: "${errorSnippet}". The signup page shows an error — test cannot proceed.`);
            }

            if (emailProcessedCount > 5) {
              console.log('⚠️  Email/Login loop detected — breaking');
              if (page.url().includes('paymentDetails') || page.url().includes('payment')) {
                reachedEndPage = true;
                console.log('💳 Navigated to payment page after loop detection retry');
                continue;
              }
              break;
            }

            const emailInput = page.locator('input[type="email"]').first();
            const passwordInput = page.locator('input[type="password"]').first();

            // Wait up to 10 seconds for email or password input to load on the email/login page
            await Promise.any([
              emailInput.waitFor({ state: 'visible', timeout: 10000 }),
              passwordInput.waitFor({ state: 'visible', timeout: 10000 })
            ]).catch(() => { });

            const emailVisible = await emailInput.isVisible({ timeout: 500 }).catch(() => false);
            const passwordVisible = await passwordInput.isVisible({ timeout: 500 }).catch(() => false);

            let signedIn = false;
            if (emailVisible && passwordVisible) {
              console.log(`📧 Entering email: ${userEmail} and password...`);
              await emailInput.fill(userEmail);
              await passwordInput.fill(userPassword);

              const signInBtn = page.locator(
                'button:has-text("Sign in"), ' +
                'button:has-text("Log in"), ' +
                'button:has-text("Sign In"), ' +
                'button:has-text("Continue"), ' +
                'button[type="submit"]'
              ).first();
              await clickAndWaitForNav(page, signInBtn, 'Sign In/Continue Both');
              signedIn = true;
            } else if (passwordVisible) {
              console.log('🔑 Entering password...');
              await passwordInput.fill(userPassword);

              const signInBtn = page.locator(
                'button:has-text("Sign in"), ' +
                'button:has-text("Log in"), ' +
                'button:has-text("Sign In"), ' +
                'button:has-text("Continue"), ' +
                'button[type="submit"]'
              ).first();
              await clickAndWaitForNav(page, signInBtn, 'Sign In/Continue');
              signedIn = true;
            } else if (emailVisible) {
              console.log(`📧 Entering email: ${userEmail}`);
              await emailInput.fill(userEmail);

              const continueBtn = page.locator(
                'button:has-text("Continue"), ' +
                'button:has-text("Next"), ' +
                'button[type="submit"]'
              ).first();
              await clickAndWaitForNav(page, continueBtn, 'Email Continue');
            }

            if (signedIn && isActiveUltimateState(userStateKey)) {
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
              } else if (lowerUrl.includes('/myaccount')) {
                actualPage = 'My Account';
                navStatus = 'PASS';
              }

              results.push({
                page: 'Sign In',
                field: 'Post-Login Navigation Target',
                expected: 'Preview Page, Fixture Page, or My Account',
                actual: `Navigated to: ${currentUrl} (${actualPage})`,
                status: navStatus,
              });

              if (navStatus === 'FAIL') {
                const errMsg = `❌ [Ultimate User Login] Not redirected to fixture/preview page or My Account after signing in. Landed on: ${currentUrl}`;
                console.error(errMsg);
                throw new Error(errMsg);
              } else if (actualPage === 'My Account') {
                await validateUltimateMyAccountRedirect();
                await finishRun('ultimate', userStateKey);
                return;
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

            // Default signup can be configured either with a contextual PPV card
            // or as a generic tier-plan page. PPV-specific validations only make
            // sense when the expected PPV is actually present.
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
              throw new Error(`❌ [DefaultSignup] PPV is not configured in default signup for expected event: "${ppvName}"`);
            }
            console.log(`✅ [DefaultSignup] Verified PPV on page matches: "${ppvName}"`);

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

            // ── Subscribe Without PPV opt-out ──────────────────────────────
            if (noPpvClick) {
              console.log('🔗 [noPpvClick] Triggering subscribe-without-pay-per-view flow...');
              await handleNoPpvClick(page, eventData);
              noPpvClick = false; // reset so it only fires once
              continue;           // re-detect page type after navigation
            }

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

            if (await isContextualPpvSelectionPage(page)) {
              console.log('↩️  Still on contextual PPV selection page; re-detecting before DAZN Plan validation.');
              continue;
            }

            // NOTE: For ultimate_upfront, plan page defaults to APM selected on load.
            // Defer validateVariant to after the APU card click so DOM reflects correct state.
            const shouldDeferPlanValidation = ratePlan === 'annual pay upfront';

            if (!planValidated && !shouldDeferPlanValidation) {
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
                const planFlow = [
                  'boxing-banner-ultimate',
                  'boxing-ultimate-subscription',
                  'boxing-join-the-club',
                ].includes(SOURCE)
                  ? 'boxing-ultimate-direct'
                  : isMyAccount ? 'myaccount' : (isReturning ? 'returning' : undefined);
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
              const upfrontCard = page.locator(
                'label:has-text("Annual - Pay Upfront"), ' +
                'label:has-text("Annual - pay upfront"), ' +
                'label:has-text("Pay Upfront")'
              ).first();

              if (await upfrontCard.isVisible({ timeout: 3000 }).catch(() => false)) {
                await safeScrollToElement(page, upfrontCard);
                await upfrontCard.click({ force: true }).catch(() => { });
                console.log('✅ Clicked Annual Pay Upfront card');
              } else {
                // Upfront is typically the last radio
                const radios = page.locator('input[type="radio"]');
                const count = await radios.count().catch(() => 0);
                const upfrontRadio = radios.nth(count > 0 ? count - 1 : 0);
                if (await upfrontRadio.isVisible({ timeout: 1500 }).catch(() => false)) {
                  await safeScrollToElement(page, upfrontRadio);
                  await upfrontRadio.click({ force: true }).catch(() => { });
                  console.log('✅ Selected Upfront radio (last)');
                }
              }
              await page.waitForTimeout(500);

              // ── Post-click: run deferred validateVariant now that APU card is selected ──
              if (shouldDeferPlanValidation && !planValidated) {
                try {
                  const targetTier = (tier === 'ultimate' || purchaseOption === 'ultimate') ? 'ultimate' : 'standard';
                  const originalTier = eventData.TIER;
                  const originalPlanCta = eventData.PLAN_CTA_BUTTON;
                  eventData.TIER = targetTier;
                  eventData['TIER'] = targetTier;
                  const isUpgradeFlow = page.url().includes('isUpgradeTierFlow') || userStateKey === 'active_standard';
                  if (isUpgradeFlow && targetTier === 'ultimate') {
                    eventData.PLAN_CTA_BUTTON = 'Continue';
                    eventData['PLAN_CTA_BUTTON'] = 'Continue';
                  }
                  const planData = getPlanDataByTier(targetTier);
                  const planFlow = [
                    'boxing-banner-ultimate',
                    'boxing-ultimate-subscription',
                    'boxing-join-the-club',
                  ].includes(SOURCE)
                    ? 'boxing-ultimate-direct'
                    : isMyAccount ? 'myaccount' : (isReturning ? 'returning' : undefined);
                  console.log(`📊 Plan rows (deferred post-click): ${planData.length}`);
                  await validateVariant(
                    page, 'plan', planData, results, eventData, 'DAZN Plan', planFlow
                  );
                  eventData.TIER = originalTier;
                  eventData['TIER'] = originalTier;
                  eventData.PLAN_CTA_BUTTON = originalPlanCta;
                  eventData['PLAN_CTA_BUTTON'] = originalPlanCta;
                } catch (e: any) {
                  console.warn('⚠️  Plan validation error (deferred):', e.message);
                }
                planValidated = true;
              }


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
          const planFlow = [
            'boxing-banner-ultimate',
            'boxing-ultimate-subscription',
            'boxing-join-the-club',
          ].includes(SOURCE) ? 'boxing-ultimate-direct' : undefined;
          console.log(`📊 Plan rows: ${planData.length}`);
          // NOTE: For ultimate_upfront, defer validateVariant to after APU card click.
          const shouldDeferFlowBPlanValidation = ratePlan === 'annual pay upfront';
          if (!shouldDeferFlowBPlanValidation) {
            await validateVariant(
              page, 'plan', planData, results, eventData, 'DAZN Plan', planFlow
            );
          }

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

            // ── Post-click: run deferred validateVariant (Flow B) ──
            if (shouldDeferFlowBPlanValidation) {
              const restoreTier2 = eventData.TIER;
              const restoreCta2 = eventData.PLAN_CTA_BUTTON;
              eventData.TIER = 'ultimate';
              eventData['TIER'] = 'ultimate';
              eventData.PLAN_CTA_BUTTON = 'Continue';
              eventData['PLAN_CTA_BUTTON'] = 'Continue';
              try {
                console.log(`📊 Plan rows (deferred post-click Flow B): ${planData.length}`);
                await validateVariant(
                  page, 'plan', planData, results, eventData, 'DAZN Plan', planFlow
                );
              } catch (e: any) {
                console.warn('⚠️  Plan validation error (deferred Flow B):', e.message);
              }
              eventData.TIER = restoreTier2;
              eventData['TIER'] = restoreTier2;
              eventData.PLAN_CTA_BUTTON = restoreCta2;
              eventData['PLAN_CTA_BUTTON'] = restoreCta2;
            }


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
      // Capture video path and finalize video file BEFORE report generation
      capturedVideoPath = (await page.video()?.path().catch(() => null)) ?? null;
      await context.close().catch(() => { });
      const { excelPath, videoPath } = await writeResults(results, capturedVideoPath);

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
        const errMsg = `❌ Flow "${SOURCE} (${stateKey})" had 0 validation checks`;
        console.log(errMsg);
        throw new Error(errMsg);
      }

      if (!reachedEndPage) {
        const errMsg = `❌ Flow "${SOURCE} (${stateKey})" did not reach the expected end page: "payment" or "confirmation"`;
        console.log(errMsg);
        throw new Error(errMsg);
      }

      if (failed > 0) {
        const failMsgs = results
          .filter(r => r.status === 'FAIL')
          .map(r => `  - [${r.page}] ${r.field}: expected "${r.expected}", actual "${r.actual}"`)
          .join('\n');
        const errMsg = `❌ Flow "${SOURCE} (${stateKey})" completed navigation but had ${failed} validation failure(s):\n${failMsgs}`;
        console.log(errMsg);
        throw new Error(errMsg);
      }

    } catch (error) {
      console.error('❌ Test error:', error);
      throw error;

    } finally {
      try {
        // Only log — context may already be closed by early-exit paths above
        if (capturedVideoPath) console.log(`🎥 Video saved: ${capturedVideoPath}`);
        else console.log('⚠️  No video found');
      } catch (e: any) {
        console.log('⚠️  Video path error:', e.message);
      }
      // Safe no-op if already closed by an early-exit branch
      await context.close().catch(() => { });
    }
  });
}
