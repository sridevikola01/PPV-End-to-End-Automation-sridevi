import { Page } from '@playwright/test';
import { PPVPage } from '../pages/PPVPage';
import { MyAccountPage } from '../pages/MyAccountPage';
import { PaymentPage } from '../pages/PaymentPage';
import { SignupPage } from '../pages/SignupPage';
import { AuthenticationManager } from '../auth/AuthenticationManager';
import { captureFailures } from '../utils/failureCapture';
import {
  validateCanadaTierHeaderDetails,
  validateCanadaTierCardsAndFeatures,
  validateCanadaTierPage,
  validateCanadaUpgradePopupModal,
  validateCanadaPlanDetailsPage,
  validateCanadaPaymentSummaryPage,
  validateCanadaPPVAddonPurchasePage,
} from '../utils/canadaValidationHelper';

export interface CanadaUFTConfig {
  tier: 'Standard' | 'Ultimate';
  subscriptionInput: string;
  subscriptionCard: 'DAZN' | 'DAZN+' | 'DAZN Ultimate' | 'DAZN+ Ultimate';
  plan: 'Annual - Pay over time' | 'Annual - Pay now' | 'Monthly';
  rawPlanInput: string;
  tierPlanDisplay: string;
  flowDisplay: string;
}

/**
 * Parses single command-line parameter in the format `<tier>-<subscription>-<plan>`.
 * Examples:
 *   - "standard-dazn+-annual-pay over time"
 *   - "standard-dazn-Annual-pay now"
 *   - "ultimate-dazn-annual-pay now"
 *   - "ultimate-dazn+-monthly"
 */
export function parseCanadaCommand(commandStr?: string): CanadaUFTConfig {
  const rawInput = (commandStr || process.env.CANADA_PLAN || process.env.UFT_PLAN || process.env.PLAN || '').trim();
  if (!rawInput) {
    const userState = (process.env.USER_STATE || '').toLowerCase();
    if (userState.startsWith('active_')) {
      console.log(`🇨🇦 [Canada Command Parser] No CANADA_PLAN supplied for active user ("${userState}"). Direct PPV addon purchase flow will be executed.`);
      return {
        tier: 'Standard',
        subscriptionInput: 'dazn',
        subscriptionCard: 'DAZN',
        plan: 'Monthly',
        rawPlanInput: 'monthly',
        tierPlanDisplay: 'Active User (No Plan Required)',
        flowDisplay: `${process.env.SOURCE || 'myaccount'} -> ${userState} -> PPV Addon Purchase`,
      };
    }
    console.log(`🇨🇦 [Canada Command Parser] No CANADA_PLAN supplied; defaulting to "standard-dazn+-Annual-pay now".`);
    return {
      tier: 'Standard',
      subscriptionInput: 'dazn+',
      subscriptionCard: 'DAZN+',
      plan: 'Annual - Pay now',
      rawPlanInput: 'annual-pay now',
      tierPlanDisplay: 'Standard -> DAZN+ -> Annual - Pay now',
      flowDisplay: 'Standard -> DAZN+ -> Annual - Pay now',
    };
  }
  const input = rawInput.toLowerCase();

  console.log(`🇨🇦 [Canada Command Parser] Parsing command input: "${rawInput}"`);

  // Default values
  let tier: 'Standard' | 'Ultimate' = 'Standard';
  let subscriptionInput = 'dazn+';
  let rawPlanInput = 'annual-pay over time';

  // Tokenize original string preserving case where helpful
  const rawParts = rawInput.split('-').map(p => p.trim());

  if (rawParts.length >= 3) {
    subscriptionInput = rawParts[1];
    rawPlanInput = rawParts.slice(2).join('-');
  } else if (rawParts.length === 2) {
    subscriptionInput = rawParts[1];
  }

  // Check tier prefix
  const rawTier = rawParts[0] || 'standard';
  if (input.startsWith('ultimate')) {
    tier = 'Ultimate';
  } else if (input.startsWith('standard')) {
    tier = 'Standard';
  }

  // Map Subscription Card based on Tier
  let subscriptionCard: 'DAZN' | 'DAZN+' | 'DAZN Ultimate' | 'DAZN+ Ultimate';
  const subLower = subscriptionInput.toLowerCase();

  if (tier === 'Standard') {
    if (subLower.includes('dazn+') || subLower.includes('plus')) {
      subscriptionCard = 'DAZN+';
    } else {
      subscriptionCard = 'DAZN';
    }
  } else {
    // Ultimate Tier
    if (subLower.includes('dazn+') || subLower.includes('plus')) {
      subscriptionCard = 'DAZN+ Ultimate';
    } else {
      subscriptionCard = 'DAZN Ultimate';
    }
  }

  // Map Plan
  let plan: 'Annual - Pay over time' | 'Annual - Pay now' | 'Monthly' = 'Annual - Pay over time';
  const planLower = rawPlanInput.toLowerCase();

  if (planLower.includes('over time') || planLower.includes('pay over time')) {
    plan = 'Annual - Pay over time';
  } else if (planLower.includes('pay now') || planLower.includes('upfront')) {
    plan = 'Annual - Pay now';
  } else if (planLower.includes('monthly') || planLower.includes('month')) {
    plan = 'Monthly';
  }

  // Keep the report hierarchy stable: content tier -> card item -> plan.
  // The Ultimate suffix belongs to the selected tier, so the card item remains
  // DAZN or DAZN+ in the report.
  const cardDisplay = subscriptionCard.includes('+') ? 'DAZN+' : 'DAZN';
  const tierPlanDisplay = `${tier} -> ${cardDisplay} -> ${plan}`;
  const sourceStr = process.env.SOURCE || 'myaccount';
  const userStateStr = process.env.USER_STATE || 'freemium';
  const flowDisplay = `${sourceStr} → ${userStateStr} → ${tierPlanDisplay}`;

  const config: CanadaUFTConfig = {
    tier,
    subscriptionInput,
    subscriptionCard,
    plan,
    rawPlanInput,
    tierPlanDisplay,
    flowDisplay,
  };

  console.log(`🇨🇦 [Canada Config Parsed] Display: "${config.tierPlanDisplay}" | Flow: "${config.flowDisplay}"`);
  return config;
}

/**
 * Executes the Canada (CA) UFT Subscription Flow using Canada-specific methods in Page Objects.
 */
export async function executeCanadaSubscriptionFlow(
  page: Page,
  ppvPage: PPVPage,
  paymentPage: PaymentPage,
  eventData: Record<string, string>,
  results: any[],
  commandStr?: string,
  userParam?: any
): Promise<void> {
  console.log('\n🇨🇦 =======================================================');
  console.log('🇨🇦 EXECUTING CANADA (CA) UFT SUBSCRIPTION FLOW');
  console.log('🇨🇦 =======================================================\n');

  const config = parseCanadaCommand(commandStr);

  // Sync eventData fields so Report Meta displays Canada Tier & Rate Plan correctly
  eventData.TIER = config.tierPlanDisplay;
  eventData.DAZN_TIER = config.subscriptionCard;
  eventData.RATE_PLAN = '';
  eventData.CANADA_TIER_PLAN_STR = config.tierPlanDisplay;
  eventData.CANADA_FLOW_STR = config.flowDisplay;
  eventData.PLAN = `${config.tier.toLowerCase()}-${config.subscriptionCard.toLowerCase().replace(/\s+/g, '_')}-${config.plan.toLowerCase().replace(/\s+/g, '_')}`;

  // ── STEP 1: Tier Page Tab & Card Selection, Validations & CTA ────────
  // 1. Validate PPV Header details on Tier Page
  await validateCanadaTierHeaderDetails(page, eventData, results);

  // 2. Scroll down to Tier options section
  await ppvPage.scrollToTierOptions();

  // 3. Select tier tab option (Standard or Ultimate)
  await ppvPage.selectCanadaTier(config.tier);

  // 4. Select subscription card (Card 1: DAZN vs Card 2: DAZN+)
  await ppvPage.selectCanadaSubscriptionCardOnly(config.subscriptionCard);

  // 5. Validate Tier Page Active Cards & Feature Bar Items
  await validateCanadaTierCardsAndFeatures(page, eventData, config, results);

  // Capture any Tier Page failure screenshots while STILL on Tier Page
  await captureFailures(page, results, 'Tier Page', eventData);

  // 6. Click "Get Started" button on selected tier card
  await ppvPage.clickGetStartedCTA(config.subscriptionCard);

  // ── STEP 2: Upgrade Popup Validations, Failure Capture & Selection ──
  await validateCanadaUpgradePopupModal(page, config, results, eventData);
  await captureFailures(page, results, 'Upgrade Popup Modal', eventData);
  await ppvPage.handleCanadaUpgradePopup(config.tier, results);

  // ── STEP 3: Plans Page Validations, Failure Capture & Selection ─────
  await validateCanadaPlanDetailsPage(page, eventData, config, results);
  await captureFailures(page, results, 'Plan Details Page', eventData);

  // 6. Select plan (e.g. Annual - Pay now) & click Continue
  await ppvPage.selectCanadaPlan(config.plan);

  // ── STEP 3.5: Account Auth (Sign In Mid-Flow vs New User Registration) ──
  const userStateKey = (process.env.USER_STATE || eventData.USER_STATE || '').toLowerCase();
  const isExistingUser = !!userStateKey && userStateKey !== 'new' && userStateKey !== 'freemium';

  await page.waitForTimeout(1500);

  let currentUrl = page.url().toLowerCase();
  const signup = new SignupPage(page);
  let emailInput = await signup.findEmailInput();

  if (emailInput || currentUrl.includes('register') || currentUrl.includes('email') || currentUrl.includes('account') || currentUrl.includes('signin')) {
    if (isExistingUser) {
      console.log(`🔐 [CA Existing User: ${userStateKey}] Mid-flow Sign-In detected on ${page.url()}. Signing in via AuthenticationManager...`);
      const signInBtn = page.locator('a:has-text("Sign in"), button:has-text("Sign in"), [data-test-id*="SIGN_IN" i], [class*="signin" i]').first();
      if (await signInBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('👇 [CA Existing User] Clicking "Sign in" link on registration page...');
        await signInBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1500);
      }

      const authManager = new AuthenticationManager(page, page.context(), eventData.BASE_URL || 'https://www.dazn.com/en-CA');
      await authManager.authenticate(eventData);
      await page.waitForTimeout(2000);
    } else {
      console.log(`👤 [CA New User] Account Registration page detected (${page.url()}). Filling email & personal details...`);
      const user = userParam || {
        email: `test_ca_${Date.now()}@dazn.com`,
        firstName: 'Test',
        lastName: 'User',
        password: 'Password@123',
      };

      if (emailInput) {
        console.log(`📧 [CA New User] Entering email: ${user.email}...`);
        await signup.enterEmail(user.email);
        await signup.clickContinue();
        await page.waitForTimeout(1500);
        currentUrl = page.url().toLowerCase();
      }

      const firstNameEl = page.locator('[data-test-id="FIRST_NAME"], input[name="firstName"]').first();
      const isFirstNameVisible = await firstNameEl.isVisible({ timeout: 6000 }).catch(() => false);
      if (isFirstNameVisible || currentUrl.includes('personaldetails') || currentUrl.includes('register')) {
        console.log(`👤 [CA New User] Entering personal details (Name & Password)...`);
        await signup.fillPersonalDetails(user);
        await signup.clickPersonalDetailsContinue().catch((err: any) => {
          console.warn(`⚠️ [CA New User] Personal details submit warning: ${err.message}`);
        });
        await page.waitForTimeout(2000);
      }
    }
  }

  // ── STEP 4: Payment Page Validations & Failure Capture ───────────────
  if (page.url().toLowerCase().includes('addon/purchase')) {
    await validateCanadaPPVAddonPurchasePage(page, eventData, results);
  } else {
    await validateCanadaPaymentSummaryPage(page, eventData, config, results);
  }
  await captureFailures(page, results, 'Payment Page', eventData);

  console.log('\n🇨🇦 ✅ Canada (CA) UFT Subscription Flow Completed Successfully!\n');
}

/**
 * Canada Ultimate User — PPV Addon Purchase Flow.
 *
 * For Canada, Ultimate users are NOT entitled to PPV events for free.
 * They must purchase PPV explicitly via /account/addon/purchase.
 *
 * Flow:
 *   1. Click "Buy now" on the PPV card in My Account
 *   2. Wait for the addon purchase page to load
 *   3. Validate page contents (title, price, payment options, etc.)
 *   4. Capture any failures as screenshots
 *
 * NOTE: myAccountPage.clickBuyNow() is used here because we are on the
 * My Account page — NOT on a PPV landing page. PPVPage has no clickBuyNow.
 */
export async function executeCanadaPPVAddonPurchaseFlow(
  page: Page,
  myAccountPage: MyAccountPage,
  eventData: Record<string, string>,
  results: any[]
): Promise<void> {
  console.log('\n🇨🇦 =====================================================');
  console.log('🇨🇦 CANADA ULTIMATE — PPV ADDON PURCHASE FLOW');
  console.log('🇨🇦 =====================================================\n');

  const ppvName = (eventData.PPV_NAME || '').trim();

  // ── Step 1: Scroll to PPV section & click Buy now ────────────────
  console.log(`🖱️ [CA Ultimate] Clicking "Buy now" for: "${ppvName}"`);
  try {
    await myAccountPage.scrollToPPVSection();
    await myAccountPage.clickBuyNow(ppvName);
  } catch (err: any) {
    console.warn(`⚠️ [CA Ultimate] clickBuyNow failed: ${err.message}`);
    results.push({
      page: 'Payment Page',
      field: 'Buy Now Click',
      expected: 'Clicked successfully',
      actual: `Error: ${err.message}`,
      status: 'FAIL',
    });
    return;
  }

  // ── Step 2: Wait for /account/addon/purchase ────────────────────────
  console.log('⏳ [CA Ultimate] Waiting for PPV addon purchase page...');
  try {
    await page.waitForURL(
      (url: URL) => url.pathname.includes('/addon/purchase'),
      { timeout: 20000 }
    );
    console.log(`✅ [CA Ultimate] Navigated to: ${page.url()}`);
  } catch (navErr: any) {
    const currentUrl = page.url();
    console.warn(`⚠️ [CA Ultimate] Timeout waiting for /addon/purchase. Current URL: ${currentUrl}`);
    results.push({
      page: 'Payment Page',
      field: 'Page Navigation',
      expected: '/account/addon/purchase',
      actual: currentUrl || 'Navigation timeout',
      status: 'FAIL',
    });
    return;
  }

  // ── Step 3: Validate the addon purchase page ───────────────────────
  await validateCanadaPPVAddonPurchasePage(page, eventData, results);

  // ── Step 4: Capture failure screenshots ────────────────────────────
  await captureFailures(page, results, 'Payment Page', eventData);

  console.log('\n🇨🇦 ✅ Canada Ultimate PPV Addon Purchase Flow Complete!\n');
}
