import { test } from '@playwright/test';
import { PaymentPage } from '../../pages/PaymentPage';
import { HomePage } from '../../pages/HomePage';
import { MyAccountPage } from '../../pages/MyAccountPage';
import { StandalonePPVPage } from '../../pages/StandalonePPVPage';
import { LandingPage } from '../../pages/LandingPage';
import { BoxingPage } from '../../pages/BoxingPage';
import { BoxingHomePage } from '../../pages/BoxingHomePage';
import { SchedulePage } from '../../pages/schedulepage';
import { SearchPage } from '../../pages/SearchPage';
import { PaymentFillPage } from '../../pages/PaymentFillPage';
import { PPVUpsellSuccessPage } from '../../pages/PPVUpsellSuccessPage';
import { PPVUpsellPaymentPage } from '../../pages/PPVUpsellPaymentPage';
import {
  readSheet,
  readSheet as readUpsellSheet,
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
  injectConsentCookies,
} from '../../utils/helpers';
import {
  loadEventConfig,
  safeScrollToElement,
  clickAndWaitForNav,
  handlePopupModal,
} from '../../utils/testHelpers';

const REGION = process.env.DAZN_REGION || 'GB';
const EVENT_CONFIG = process.env.PPV_CONFIG || 'beauty_and_beast';
const SOURCE = process.env.SOURCE || 'my-account';

// ── Flow constant — used for flow-restricted Excel rows ──────────────
// Enables Welcome Back, Saved Card, Signed In As, Log Out validations
const FLOW = 'myaccount';

test('PPV flow via existing user my account', async ({ browser }) => {
  test.setTimeout(300_000);

  const json = loadEventConfig(EVENT_CONFIG);
  configureExcelPathForEvent(json.eventKey || '');
  const eventData = buildEventData(json, REGION);
  const userStateKey = process.env.USER_STATE || 'freemium';

  // Compute dynamic future date variables
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 7);
  const fDay = futureDate.getDate();
  const fMonth = futureDate.toLocaleString('en-GB', { month: 'long' });
  const fYear = futureDate.getFullYear();
  eventData.FLEX_FUTURE_DATE_SHORT = `${fDay} ${fMonth} ${fYear}`;

  const tier = (json.TIER || 'freemium').toLowerCase();
  const ratePlan = (json.RATE_PLAN || 'monthly').toLowerCase();
  const userEmail = eventData.USER_EMAIL || json.USER_EMAIL || '';
  const userPassword = eventData.USER_PASSWORD || json.USER_PASSWORD || '';
  const purchaseOption = (json.PURCHASE_OPTION || 'ppv').toLowerCase();
  const baseUrl = eventData.BASE_URL;
  const variantConfig = json.variants;
  const pagesConfig = json.pages;
  const sport = json.SPORT;

  // Resolve payment page expected variables to avoid skipping validation
  const offerType = (eventData.OFFER_TYPE || '1_month_free').toLowerCase();
  const isTrial = ratePlan === 'monthly' && offerType === '7_day_trial';
  const activeOfferPresent = eventData.ACTIVE_OFFER_PRESENT === 'true';

  if (tier === 'ultimate') {
    eventData.PLAN_CTA_BUTTON = eventData.PLAN_CTA_BUTTON_ULTIMATE || 'Continue with DAZN Ultimate';
    eventData.DAZN_TIER = 'DAZN Ultimate';
  } else {
    // Standard tier: CTA depends on rate plan
    // Flex - Pay Monthly is always selected by default initially, so CTA is Continue with 7-day Free Trial
    eventData.PLAN_CTA_BUTTON = eventData.PLAN_CTA_BUTTON_STANDARD || 'Continue with 7-day Free Trial';
    eventData.DAZN_TIER = 'DAZN Standard';
  }

  if (activeOfferPresent && ratePlan === 'monthly') {
    eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
    eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_PLAN_LABEL || 'Flex – Pay Monthly - First Month Only';
    eventData.PAYMENT_FREE_TEXT = 'N/A';
    eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT_TRIAL || '';
  } else if (isTrial) {
    eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
    eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_FREE_TEXT_TRIAL || '7-days free';
    eventData.PAYMENT_FREE_TEXT = eventData.PAYMENT_FREE_TEXT_TRIAL || '7-days free';
    eventData.CANCELLATION_TEXT = eventData.CANCELLATION_TEXT_TRIAL || '';
  } else if (ratePlan === 'annual pay monthly' || ratePlan === 'annual pay upfront') {
    // APM / APU — 1 month free offer
    eventData.PAYMENT_PAGE_TITLE = eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
    eventData.PAYMENT_PLAN_NAME = eventData.PAYMENT_PLAN_NAME_ANNUAL || 'Annual - Pay Monthly';
    eventData.PAYMENT_FREE_TEXT = eventData.PAYMENT_FREE_TEXT_MONTHLY || 'First month free';
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
    ...(recordVideo ? { recordVideo } : {}),
  });

  // Pre-inject OneTrust consent cookies so banner never appears
  await injectConsentCookies(context);

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
  ): Promise<'ppv' | 'plan' | 'payment' | 'confirmation' | 'standalone-ppv' | 'email' | 'unknown' | 'success-upsell' | 'saved-card-payment' | 'bet-upsell' | 'default-signup'> => {
    if (!p || p.isClosed()) return 'unknown';
    const url = p.url();

    if (url.includes('paymentDetails')) return 'payment';

    // PPV page detection via contextualPpvId query param (before email fallback)
    if (url.includes('/signup') && url.includes('contextualPpvId=') && !url.includes('page=')) return 'ppv';

    // Email/signup checks (highest priority URL checks, must be before tier checks)
    if (url.includes('page=personalDetails')) return 'email';
    if (url.includes('emailDetails')) return 'email';
    if (url.includes('/signup') && !url.includes('PlanDetails') && !url.includes('TierPlans')) return 'email';
    try {
      const emailCount = await p.locator('input[type="email"]').count().catch(() => 0);
      if (emailCount > 0) return 'email';
    } catch { }

    if (url.includes('upsellTierShown=true')) {
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
    if (url.includes('page=PlanDetails') && (
      url.toLowerCase().includes('standalone') ||
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

    if (url.includes('upsellTierSkipped=true')) return 'plan';
    if (url.includes('upsellTierSelected=true') &&
      url.includes('PlanDetails')) return 'plan';
    if (url.includes('page=PlanDetails')) return 'plan';
    if (url.includes('page=TierPlans')) return 'plan';
    if (url.includes('UpgradePlan') ||
      (url.includes('UpgradeTier') &&
        !url.includes('isUpgradeTierFlow'))) return 'confirmation';

    if (lower.includes('subscribe without a pay-per-view')) return 'ppv';
    if (lower.includes('choose your plan')) return 'ppv';
    if (lower.includes('choose how to buy')) return 'ppv';
    if (lower.includes("choose the right plan") || lower.includes("choose a plan") || lower.includes("choose a subscription")) return 'plan';
    if (lower.includes('your plan will be changed')) return 'confirmation';

    return 'unknown';
  };

  const isMyAccount = SOURCE === 'my-account' || SOURCE === 'myaccount';
  let reachedEndPage = false;

  try {
    if (!isMyAccount) {
      // ══════════════════════════════════════════════════════════════
      // LANDING / BOXING / SCHEDULE ACQUISITION FLOW
      // ══════════════════════════════════════════════════════════════
      const isSchedule = SOURCE.toLowerCase().includes('schedule');
      const isSearch = SOURCE.toLowerCase().includes('search');

      if (isSchedule) {
        const schedule = new SchedulePage(page);
        await schedule.navigate(baseUrl);
        await setupPage(page, 8000);
        await schedule.selectSport(sport);

        const eventCard = await schedule.findEvent(eventData.PPV_NAME);
        await schedule.clickEvent(eventCard);

        console.log('\n📋 Validating Schedule page...');
        try {
          const scheduleData = readSheet('Schedule page');
          await validateVariant(
            page, 'schedule', scheduleData, results, eventData, 'Schedule'
          );
        } catch (err: any) {
          console.warn(`⚠️  Schedule page validation error: ${err.message}`);
        }

        await schedule.clickBuyNow();
      } else if (isSearch) {
        const searchPage = new SearchPage(page);
        await searchPage.navigate(baseUrl);
        let searchQuery = eventData.PPV_NAME;
        if (eventData.PPV_NAME && eventData.PPV_NAME.includes(':')) {
          searchQuery = eventData.PPV_NAME.split(':').pop()?.trim() || eventData.PPV_NAME;
        }

        let searchSuccess = false;
        try {
          await searchPage.searchForEvent(searchQuery);
          await searchPage.clickPPVTile(eventData.PPV_NAME);
          searchSuccess = true;
        } catch (err: any) {
          console.log(`⚠️ Search for "${searchQuery}" failed: ${err.message}. Trying fallback search...`);
        }

        if (!searchSuccess && eventData.PPV_PROMOTER && eventData.PPV_PROMOTER !== 'N/A') {
          console.log(`🔄 Searching with promoter fallback: "${eventData.PPV_PROMOTER}"`);
          await searchPage.searchForEvent(eventData.PPV_PROMOTER);
          await searchPage.clickPPVTile(eventData.PPV_NAME);
        }

        console.log('\n📋 Validating Search page...');
        try {
          const searchData = readSheet('Search page');
          await validateVariant(
            page, 'search', searchData, results, eventData, 'Search'
          );
        } catch (err: any) {
          console.warn(`⚠️  Search page validation error: ${err.message}`);
        }

        // Check and validate popup modal if visible BEFORE clicking Buy Now
        await handlePopupModal(page, results, eventData, SOURCE, false);

        await searchPage.clickBuyNow();
      } else {
        const isHomePageSource = SOURCE.startsWith('home-page-');
        const isHomeSport = SOURCE.startsWith('home-') && !isHomePageSource;
        const isBoxingSource = SOURCE.startsWith('boxing-page') || SOURCE.startsWith('boxing');

        const landing = isHomePageSource
          ? new HomePage(page)
          : isHomeSport
            ? new BoxingHomePage(page)
            : isBoxingSource
              ? new BoxingPage(page)
              : new LandingPage(page);

        await landing.navigate(baseUrl, SOURCE, eventData);
        await setupPage(page, 8000);

        // Validate entry page
        const isBoxingSourceInner = SOURCE.startsWith('boxing-page') || SOURCE.startsWith('boxing');
        const isHomePageSourceInner = SOURCE.startsWith('home-page-');
        const isHomeSportInner = SOURCE.startsWith('home-') && !isHomePageSourceInner;

        let sheetName = 'Landing page';
        let pageName = 'Landing';
        let flowParam = 'landing';

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
            : 'boxing';
        }

        const container = await landing.findPPVContainer(eventData, SOURCE);
        if (!container) {
          throw new Error(`❌ PPV container not found on landing page via ${SOURCE}`);
        }

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
            await validateVariant(page, 'landing', landingData, results, eventData, pageName, flowParam);
          }
        } catch (err: any) {
          console.warn(`⚠️  Entry page validation error: ${err.message}`);
        }

        await landing.clickBuyNow(container, SOURCE);
      }

      // Handle generic popup validations and click-through
      // Avoid double-clicking modal if already clicked by clickBuyNow
      const clickPopup = !SOURCE.includes('dont-miss') && !SOURCE.includes('tile');
      await handlePopupModal(page, results, eventData, SOURCE, clickPopup);

      await page.waitForLoadState('domcontentloaded').catch(() => { });
      await page.waitForURL(
        (url: URL) => url.toString().includes('PlanDetails') || url.toString().includes('signup') || url.toString().includes('checkout') || url.toString().includes('payment'),
        { timeout: 10000 }
      ).catch(async () => {
        await page.waitForURL(
          (url: URL) => !url.toString().includes('/welcome'),
          { timeout: 5000 }
        ).catch(() => { });
      });
      console.log(`📍 Landed after Buy Now: ${page.url()}`);

    } else {
      // ══════════════════════════════════════════════════════════════
      // MY ACCOUNT FLOW — SIGN IN FIRST
      // ══════════════════════════════════════════════════════════════
      const signinUrl = `${baseUrl}/signin`;
      console.log(`\n🔐 Navigating to: ${signinUrl}`);
      await page.goto(signinUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('domcontentloaded').catch(() => { });

      // Wait for signin page or email details redirect to settle before handling cookies
      await page.waitForURL(/emailDetails|signup/i, { timeout: 10000 }).catch(() => { });
      await page.waitForLoadState('domcontentloaded').catch(() => { });
      console.log(`📍 Landed on: ${page.url()}`);

      console.log('🍪 Waiting for cookie banner...');
      await handleCookies(page, 10000);
      await stabilisePage(page);

      console.log(`📧 Entering email: ${userEmail}`);
      const emailInput = page.locator(
        'input[type="email"], ' +
        'input[name="email"], ' +
        'input[placeholder*="email" i]'
      ).first();
      await emailInput.waitFor({ state: 'visible', timeout: 10000 });
      await emailInput.fill(userEmail);

      const emailNextBtn = page.locator(
        'button:has-text("Next"), ' +
        'button:has-text("Continue"), ' +
        'button[type="submit"]'
      ).first();
      await clickAndWaitForNav(page, emailNextBtn, 'Email Next');

      console.log('🔑 Entering password...');
      const passwordInput = page.locator(
        'input[type="password"], ' +
        'input[name="password"]'
      ).first();
      await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
      await passwordInput.fill(userPassword);

      const signInBtn = page.locator(
        'button:has-text("Sign in"), ' +
        'button:has-text("Log in"), ' +
        'button:has-text("Sign In"), ' +
        'button[type="submit"]'
      ).first();
      await clickAndWaitForNav(page, signInBtn, 'Sign In');

      await page.waitForURL(/\/home/i, { timeout: 20000 }).catch(() => { });
      await page.waitForLoadState('domcontentloaded').catch(() => { });
      console.log(`✅ Signed in — on: ${page.url()}`);

      console.log('🍪 Waiting for cookie banner on Home page...');
      await handleCookies(page, 8000);
      await stabilisePage(page);

      // Dismiss popup and navigate to My Account
      const homePage = new HomePage(page, baseUrl);
      await homePage.dismissPopup();
      await homePage.navigateToMyAccount();
      await handleCookies(page, 8000);
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
      const hasPPV = await myAccountPage.hasPPV(eventData.PPV_NAME);
      const myAccountData = getMyAccountData();
      const filteredMyAccountData = hasPPV
        ? myAccountData
        : myAccountData.filter((r: any) => !['PPV Name', 'PPV Date', 'PPV Price', 'PPV Status'].includes(r.Field));

      for (const row of filteredMyAccountData) {
        if (row.Field === 'PPV Section Present' && !hasPPV) {
          row.Expected = 'Yes|No';
        }
      }

      // Temporarily override DAZN_TIER to DAZN Free for freemium/frozen on My Account
      const originalDaznTier = eventData.DAZN_TIER;
      if (userStateKey === 'freemium' || userStateKey === 'frozen') {
        eventData.DAZN_TIER = 'DAZN Free';
        eventData['DAZN_TIER'] = 'DAZN Free';
      }

      await page.evaluate(() => {
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      });

      await validateVariant(
        page, 'myaccount', filteredMyAccountData, results, eventData, 'My Account'
      );

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
      const expectedPPVStatus = (eventData.PPV_STATUS || '').toLowerCase();
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
        const { htmlPath, pdfPath } = await generateReports(results, {
          event: eventData.PPV_NAME,
          region: REGION,
          source: SOURCE,
          ratePlan,
          tier,
          env: process.env.DAZN_ENV || 'prod',
          flowName: `${SOURCE} → ${tier} → ${ratePlan} (${userStateKey})`,
          endTime: new Date(),
          excelPath,
          videoPath,
          userStatus: userStateKey.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          userType: 'existing-user' as const,
          paymentMethod: 'Credit Card (Visa)',
        });
        if (htmlPath) console.log(`\n📊 Report: ${htmlPath}${pdfPath ? `\n📊 Report: ${pdfPath}` : ''}`);
        return; // ← Exit early — no purchase flow needed
      }

      if (tier === 'ultimate') {
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
        const { htmlPath: htmlPath2, pdfPath: pdfPath2 } = await generateReports(results, {
          event: eventData.PPV_NAME,
          region: REGION,
          source: SOURCE,
          ratePlan,
          tier,
          env: process.env.DAZN_ENV || 'prod',
          flowName: `${SOURCE} → ${tier} → ${ratePlan} (${userStateKey})`,
          endTime: new Date(),
          excelPath,
          videoPath,
          userStatus: userStateKey.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          userType: 'existing-user' as const,
          paymentMethod: 'Credit Card (Visa)',
        });
        if (htmlPath2) console.log(`\n📊 Report: ${htmlPath2}${pdfPath2 ? `\n📊 Report: ${pdfPath2}` : ''}`);
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

      // ══════════════════════════════════════════════════════════════
      // STEP 6 — CLICK BUY NOW
      // ══════════════════════════════════════════════════════════════
      console.log(`\n💳 Clicking Buy Now for: ${eventData.PPV_NAME}`);
      await myAccountPage.clickBuyNow(eventData.PPV_NAME);

      await page.waitForLoadState('domcontentloaded').catch(() => { });
      // Wait for the URL and page text to stabilize (handles client-side routing/redirects)
      const beforeUrl = page.url();
      await page.waitForURL((url: URL) => url.toString() !== beforeUrl, { timeout: 10000 }).catch(() => { });
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

        const pageType = await detectPageType(page, pagesConfig);
        console.log(`\nstep ${step + 1} → pageType: ${pageType} | url: ${page.url()}`);

        // ── EMAIL / LOGIN ──────────────────────────────────────
        if (pageType === 'email') {
          console.log('👉 Email/Login page');
          stuckCount = 0;
          emailProcessedCount++;

          if (emailProcessedCount > 2) {
            console.log('⚠️  Email/Login loop detected — breaking');
            try {
              await page.screenshot({ path: 'test-results/email_loop_error.png', fullPage: true });
              console.log('📸 Screenshot saved to test-results/email_loop_error.png');
            } catch (se: any) {
              console.warn('⚠️  Could not save screenshot:', se.message);
            }
            if (page.url().includes('paymentDetails') || page.url().includes('payment')) {
              reachedEndPage = true;
            }
            break;
          }

          const emailInput = page.locator('input[type="email"]').first();
          const passwordInput = page.locator('input[type="password"]').first();

          const emailVisible = await emailInput.isVisible({ timeout: 2000 }).catch(() => false);
          const passwordVisible = await passwordInput.isVisible({ timeout: 2000 }).catch(() => false);

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

          await page.waitForLoadState('domcontentloaded').catch(() => { });
          continue;
        }

        // ── PAYMENT ───────────────────────────────────────────
        if (pageType === 'payment') {
          console.log('💳 Payment page');
          reachedEndPage = true;
          console.log('\n📋 Validating Payment page...');

          const targetTier = tier === 'ultimate' ? 'ultimate' : 'standard';
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
                return rf === 'returning';
              });
              if (returningData.length > 0) {
                await paymentPage.validate(returningData, results, eventData, 'returning');
              }
            } else {
              await paymentPage.validate(paymentData, results, eventData, undefined);
            }
          }

          firstPaymentDone = true;

          // On staging, fill payment details and submit
          const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
          if (env === 'stag') {
            console.log('💳 DAZN_ENV is stag — filling credit card payment details...');
            const paymentFill = new PaymentFillPage(page);
            try {
              await paymentFill.fillPaymentAndSubmit();
              await paymentFill.verifyPaymentSuccess();
              await paymentFill.clickSuccessContinue();
              console.log('✅ Payment details submitted successfully on staging!');
            } catch (paymentErr: any) {
              console.error(`❌ Payment filling failed: ${paymentErr.message}`);
              throw paymentErr;
            }
            continue;
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
              const ppvData = readSheet('PPV page');
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
        if (pageType === 'success-upsell' && firstPaymentDone && !firstSuccessValidated) {
          console.log('\n══════════════════════════════════════════════');
          console.log('First Success Page — PPV Upsell');
          console.log('══════════════════════════════════════════════');
          stuckCount = 0;

          const successPage = new PPVUpsellSuccessPage(page);
          try {
            const successData = readUpsellSheet('First Success page');
            await successPage.validateUpsellSuccess(successData, results, eventData);
          } catch (err: any) {
            console.warn(`⚠️ First Success page validation error: ${err.message}`);
          }

          firstSuccessValidated = true;
          await successPage.clickBuyUpsell();
          continue;
        }

        // ── Saved Card Payment (upsell PPV purchase) ──
        if (pageType === 'saved-card-payment' && firstPaymentDone && firstSuccessValidated) {
          console.log('\n══════════════════════════════════════════════');
          console.log('Upsell PPV — Saved Card Payment');
          console.log('══════════════════════════════════════════════');
          stuckCount = 0;

          const savedCardPage = new PPVUpsellPaymentPage(page);
          try {
            const upsellPaymentData = readUpsellSheet('Upsell Payment page');
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

        // ── DAZN Bet / Promotional Upsell (second success) ──
        if (pageType === 'bet-upsell' && firstPaymentDone && savedCardPaymentDone) {
          console.log('\n══════════════════════════════════════════════');
          console.log('Second Success Page — DAZN Bet Upsell');
          console.log('══════════════════════════════════════════════');
          stuckCount = 0;

          const successPage = new PPVUpsellSuccessPage(page);
          try {
            const betData = readUpsellSheet('Second Success page');
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
              const ppvFlow = isReturning ? 'returning' : undefined;
              await validateVariant(page, variant, ppvData, results, eventData, 'Default Signup', ppvFlow);
            } catch (e: any) {
              console.warn('⚠️ Default Signup validation error:', e.message);
            }
            ppvValidated = true;
          }

          console.log('🖱️ [DefaultSignup] Clicking "Continue with pay-per-view"...');
          await page.locator('button:has-text("Continue with pay-per-view"), a:has-text("Continue with pay-per-view")').first().click({ force: true });
          console.log('✅ [DefaultSignup] Clicked "Continue with pay-per-view"');
          await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
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

              const ppvFlow = isReturning ? 'returning' : undefined;
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

          if (!planValidated) {
            try {
              await page.waitForSelector(
                'input[type="radio"]',
                { timeout: 5000 }
              ).catch(() => { });

              const originalTier = eventData.TIER;
              eventData.TIER = 'standard';
              eventData['TIER'] = 'standard';

              const planData = getPlanDataByTier('standard');
              const planFlow = isReturning ? 'returning' : undefined;
              console.log(`📊 Plan rows: ${planData.length}`);

              await validateVariant(
                page, 'plan', planData, results, eventData, 'DAZN Plan', planFlow
              );

              eventData.TIER = originalTier;
              eventData['TIER'] = originalTier;

            } catch (e: any) {
              console.warn('⚠️  Plan validation error:', e.message);
            }
            planValidated = true;
          }

          if (ratePlan === 'annual pay monthly') {
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
            'button:has-text("Continue with 7-day Free Trial"), ' +
            'button:has-text("Continue with 1st Month Free"), ' +
            'button:has-text("Continue with PPV + 7-day free trial"), ' +
            'button:has-text("Continue with PPV"), ' +
            'button:has-text("Continue")'
          ).first();
          await planBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
          await clickAndWaitForNav(page, planBtn, 'Plan Continue');

          await page.waitForLoadState('domcontentloaded').catch(() => { });
          continue;
        }

        // ── CONFIRMATION ──────────────────────────────────────
        if (pageType === 'confirmation') {
          console.log('✅ Upgrade confirmation page');
          const confirmData = getUpgradeConfirmationData(ratePlan);
          await validateVariant(
            page, 'confirmation', confirmData, results, eventData, 'Upgrade Confirmation'
          );
          reachedEndPage = true;
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

          const targetTier = tier === 'ultimate' ? 'ultimate' : 'standard';
          const isBundle = SOURCE.includes('bundle');
          const planKey = isBundle ? `${ratePlan} bundle` : ratePlan;
          const paymentData = getPaymentDataByTierAndPlan(targetTier, planKey);
          const paymentPage = new PaymentPage(page);
          if (await paymentPage.isPaymentPage()) {
            if (isReturning) {
              await paymentPage.validate(paymentData, results, eventData, FLOW);
              const returningData = paymentData.filter((r: any) => {
                const rf = (r.Flow || '').trim().toLowerCase();
                return rf === 'returning';
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
        eventData.TIER = 'ultimate';
        eventData['TIER'] = 'ultimate';

        const planData = getPlanDataByTier('ultimate');
        console.log(`📊 Plan rows: ${planData.length}`);
        await validateVariant(
          page, 'plan', planData, results, eventData, 'DAZN Plan'
        );

        // Restore
        eventData.TIER = originalTier;
        eventData['TIER'] = originalTier;

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
        const confirmData = getUpgradeConfirmationData(ratePlan);
        console.log(`📊 Confirmation rows: ${confirmData.length}`);
        await validateVariant(
          page, 'confirmation', confirmData, results, eventData, 'Upgrade Confirmation'
        );
        reachedEndPage = true;

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
        await clickAndWaitForNav(page, ppvCta, 'PPV Only Continue');

        await setupPage(page);

        // ── Validate PPV Payment ─────────────────────────────
        console.log('\n📋 Validating PPV Payment page...');
        await page.waitForSelector(
          'text=/Today you pay|payment/i',
          { timeout: 10000 }
        ).catch(() => { });

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
    const { htmlPath, pdfPath } = await generateReports(results, {
      event: eventData.PPV_NAME,
      region: REGION,
      source: SOURCE,
      ratePlan,
      tier,
      env: process.env.DAZN_ENV || 'prod',
      flowName: `${SOURCE} → ${tier} → ${ratePlan} (${userStateKey})`,
      endTime: new Date(),
      excelPath,
      videoPath,
      userStatus: userStateKey.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      userType: 'existing-user' as const,
      paymentMethod: 'Credit Card (Visa)',
    });
    if (htmlPath) console.log(`\n📊 Report: ${htmlPath}${pdfPath ? `\n📊 Report: ${pdfPath}` : ''}`);


    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const total = passed + failed;

    console.log(`\n✅ Flow "${SOURCE}" complete: ${passed}/${total} passed (${total > 0 ? ((passed / total) * 100).toFixed(1) : 0}%)`);
    console.log(`${'─'.repeat(55)}`);

    if (total === 0) {
      throw new Error(`❌ Flow "${SOURCE}" had 0 validation checks`);
    }

    if (!reachedEndPage) {
      throw new Error(`❌ Flow "${SOURCE}" did not reach the expected end page: "payment" or "confirmation"`);
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