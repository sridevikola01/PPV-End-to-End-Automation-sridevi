import { Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════
// PAGE TYPE DETECTION (fixed for plan loop)
// ═══════════════════════════════════════════════════════════════
export async function detectPageType(
  p: any,
  pc: Record<string, { detection: string }>,
  planClickCount: number
): Promise<'ppv' | 'plan' | 'email' | 'payment' | 'phone' | 'otp' | 'unknown' | 'standalone-ppv' | 'success-upsell' | 'saved-card-payment' | 'bet-upsell' | 'default-signup'> {
  if (!p || p.isClosed()) return 'unknown';

  // ── Body text detection FIRST for highly specific pages (OTP & Phone) ──
  // This prevents URL-based false positives when SPA navigation updates UI before URL changes
  const body = await p.locator('body')
    .innerText({ timeout: 2000 })
    .then((t: string) => t.toLowerCase())
    .catch(() => '');

  // ── Post-payment pages (must check BEFORE OTP/phone to avoid false positives) ──

  // DAZN Bet / promotional upsell (second success page)
  // Generic: "payment was successful" + bet/promo indicators
  if (body.includes('payment was successful') &&
      (body.includes('dazn bet') || body.includes('free bet') || body.includes('activate betting'))) {
    return 'bet-upsell';
  }

  // PPV upsell success page (first success page after initial payment)
  // Generic: "payment was successful" + upsell buy CTA or dismiss link
  if (body.includes('payment was successful') &&
      (body.includes('buy now for') || body.includes('no thanks'))) {
    return 'success-upsell';
  }

  // Saved card payment page (upsell PPV purchase with card on file)
  // Generic: "one time payment" + any saved card brand/pattern
  if (body.includes('one time payment') &&
      (body.includes('visa') || body.includes('mastercard') || body.includes('amex') ||
       body.includes('****') || body.includes('saved card'))) {
    return 'saved-card-payment';
  }

  // OTP verification page
  if (body.includes('enter the code below') || body.includes('4-digit code') || body.includes('resend code') || body.includes('verify your phone') || body.includes('enter your code')) {
    return 'otp';
  }

  // Phone number page
  if (body.includes('add your phone number')) {
    return 'phone';
  }

  // ── URL-based detection ──────────────
  const url = p.url();
  const urlLower = url.toLowerCase();

  // High-priority check for Subscribe Without PPV redirect (must be before any PPV checks)
  if (urlLower.includes('page=tierplans') && urlLower.includes('noppv=true')) {
    const hasRadio = (await p.locator('input[type="radio"], [role="radio"]').count().catch(() => 0)) > 0;
    const hasPlanCards = (await p.locator('[class*="plancard" i], [class*="tier" i], [class*="offer" i], [data-test-id*="tier" i]').count().catch(() => 0)) > 0;
    const hasPlanText = body.includes('choose your plan') || 
                        body.includes('choose a plan') || 
                        body.includes('choose the right plan') ||
                        body.includes("choose a plan that's right") ||
                        body.includes('select how to pay');
    if (hasRadio || hasPlanCards || hasPlanText) {
      console.log('[detectPageType] Subscribe Without PPV destination verified via URL and DOM (exposes Plan UI).');
      console.log('Returning page type: plan.');
      return 'plan';
    }
  }

  // Phone/OTP pages (highest priority URL checks)
  if (urlLower.includes('phonenumbercollection')) return 'phone';
  if (urlLower.includes('phoneverification') || urlLower.includes('otpverification')) return 'otp';

  // Payment page
  if (urlLower.includes('paymentdetails') || urlLower.includes('page=payment')) return 'payment';

  // Personal details / Email page — MUST be before upsellTierSelected check
  if (urlLower.includes('page=personaldetails')) return 'email';
  if (urlLower.includes('emaildetails')) return 'email';

  // Plan page detection with planClickCount guard
  if (urlLower.includes('upselltierselected=true')) {
    if (planClickCount >= 1) return 'email';
    return 'plan';
  }

  // ── Default Signup page detection (must check BEFORE general PPV) ──
  // The Default Signup page has the same URL pattern (upsellTierShown=true)
  // as the normal PPV page, but uniquely contains "subscribe without a pay-per-view".
  // Normal PPV page only has "Continue with pay-per-view".
  if (
    process.env.DEFAULT_SIGNUP === 'true' &&
    urlLower.includes('upselltiershown=true') &&
    body.includes('subscribe without a pay-per-view')
  ) {
    return 'default-signup';
  }

  if (urlLower.includes('upselltiershown=true')) return 'ppv';
  if (urlLower.includes('upselltierskipped=true')) return 'plan';
  
  // Standalone/Glory PPV page detection (must be before general page=PlanDetails check)
  // Relies on structural indicators (checkbox/toggle) rather than event-name keywords
  // which could appear on ANY page (e.g., "GLORY Collision 9" in headers/breadcrumbs).
  if (urlLower.includes('page=plandetails') && (
    urlLower.includes('standalone') || 
    body.toLowerCase().includes('standalone') ||
    (await p.locator('input[type="checkbox"], button[class*="ni7RX"]').count().catch(() => 0)) > 0
  )) {
    return 'standalone-ppv';
  }

  // ── PPV/Default-signup page intercept (before generic plan fallback) ──
  // Pages with plandetails/tierplans in URL may actually be PPV pages if they
  // contain PPV-related content. Only applies when contextualPpvId or pay-per-view
  // body text is present. Gated behind DEFAULT_SIGNUP to avoid affecting other flows.
  if (urlLower.includes('page=plandetails') || urlLower.includes('page=tierplans')) {
    if (urlLower.includes('contextualppvid') ||
        body.includes('pay-per-view') ||
        body.includes('choose how to buy') ||
        body.includes('subscribe without a pay-per-view') ||
        body.includes('continue without pay-per-view') ||
        body.includes('continue without a pay-per-view')) {
      if (process.env.DEFAULT_SIGNUP === 'true' && body.includes('subscribe without a pay-per-view')) {
        return 'default-signup';
      }
      return 'ppv';
    }
    return 'plan';
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

  // ── Rest of fallbacks ─────────────────────────
  // Email/signup page
  if (urlLower.includes('/signup') && !urlLower.includes('plandetails')) return 'email';

  try {
    const emailCount = await p.locator('input[type="email"]').count();
    if (emailCount > 0) return 'email';
  } catch {}

  try {
    const nameCount = await p.locator('[data-test-id="FIRST_NAME"], input[name="firstName"]').count();
    if (nameCount > 0) return 'email';
  } catch {}

  if (body.includes('first name') && body.includes('last name')) return 'email';

  // PPV page detection
  const ppvDetect = pc?.ppv?.detection?.toLowerCase() || '';
  if (ppvDetect && body.includes(ppvDetect)) return 'ppv';
  if (body.includes('subscribe without a pay-per-view')) return 'ppv';
  if (body.includes('choose your plan')) return 'ppv';
  if (body.includes('choose how to buy')) return 'ppv';

  // Standalone/Glory PPV page detection
  if (body.includes("choose a plan that's right") && body.includes("choose your subscription")) {
    const checkboxCount = await p.locator('input[type="checkbox"]').count().catch(() => 0);
    if (checkboxCount > 0) return 'standalone-ppv';
  }

  // Plan page detection (body text fallback)
  if (body.includes("choose a plan that's right")) return 'plan';
  if (body.includes('pick a plan to go with')) return 'plan';

  return 'unknown';
}

// ═══════════════════════════════════════════════════════════════
// HANDLE "Subscribe without a pay-per-view" OPT-OUT CLICK
// Centralized helper — invoked from both existinguser and newuser specs.
// ═══════════════════════════════════════════════════════════════
import { safeScrollToElement } from './testHelpers';

export async function handleNoPpvClick(
  page: Page,
  eventData: Record<string, any>,
  source: string
): Promise<boolean> {
  // ── Precondition guards ──
  // Only execute for the subscribe-without-pay-per-view surfacing point.
  const noPpvClick = eventData.noPpvClick === true || eventData.noPpvClick === 'true';
  const defaultSignup = process.env.DEFAULT_SIGNUP === 'true';
  const isSubscribeWithoutPpvSource = source === 'subscribe-without-pay-per-view';
  const isMyAccountSubStatusSource = eventData.source === 'myaccount-subscription-status' ||
    source === 'myaccount-subscription-status' ||
    eventData.SOURCE === 'subscribe-without-pay-per-view';

  if (!noPpvClick || !defaultSignup || (!isSubscribeWithoutPpvSource && !isMyAccountSubStatusSource)) {
    return false; // Preconditions not met — do nothing
  }

  console.log('🔗 [handleNoPpvClick] Attempting to click "Subscribe without a pay-per-view"...');

  // Step 1: Wait for page stability, then scroll to bottom
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(1000);

  // Step 2: Broad selector search (any element type, case-insensitive)
  const noPpvLink = page.locator('text=/subscribe without a pay-per-view/i').first();
  let found = await noPpvLink.isVisible().catch(() => false);

  // Step 3: If not found and URL has contextualPpvId, strip it and retry
  if (!found) {
    const currentUrl = page.url();
    if (currentUrl.toLowerCase().includes('contextualppvid')) {
      console.log('⚠️  [handleNoPpvClick] Button not found — contextualPpvId detected in URL. Stripping and navigating...');
      const url = new URL(currentUrl);
      url.searchParams.delete('contextualPpvId');
      // Also try lowercase variant
      for (const [key] of url.searchParams.entries()) {
        if (key.toLowerCase() === 'contextualppvid') {
          url.searchParams.delete(key);
        }
      }
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { });

      // Scroll to bottom again on the new page
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
      await page.waitForTimeout(1000);

      found = await noPpvLink.isVisible().catch(() => false);
    }
  }

  // Step 4: Fallback — check body text and try alternative selectors
  // Set the temporary page-type detection marker BEFORE the click
  process.env.SUBSCRIBE_WITHOUT_PPV_ACTIVE = 'true';

  if (!found) {
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const hasText = bodyText.toLowerCase().includes('subscribe without');
    console.log(`⚠️  [handleNoPpvClick] noPpvLink not visible after scroll. Body has "subscribe without": ${hasText}`);
    if (hasText) {
      // Try clicking by exact text content
      await page.locator(':text-is("Subscribe without a pay-per-view")').first().click({ timeout: 5000 });
    } else {
      process.env.SUBSCRIBE_WITHOUT_PPV_ACTIVE = 'false';
      throw new Error('❌ [handleNoPpvClick] "Subscribe without a pay-per-view" link not found on page after all retries');
    }
  } else {
    await safeScrollToElement(page, noPpvLink);
    await noPpvLink.click();
  }

  // Step 5: Wait for navigation to complete and page to load fully
  try {
    console.log('⏳ [handleNoPpvClick] Waiting for URL to contain "noPpv=true"...');
    await page.waitForURL(url => url.href.toLowerCase().includes('noppv=true'), { timeout: 15000 });
    console.log('⏳ [handleNoPpvClick] URL matches! Waiting for page to load (networkidle)...');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
  } catch (e) {
    console.log('⚠️ [handleNoPpvClick] Timeout waiting for URL or load state:', e);
  }

  // Step 6: Verify navigation destination
  const finalUrl = page.url().toLowerCase();
  if (finalUrl.includes('page=tierplans') && finalUrl.includes('noppv=true')) {
    console.log('[handleNoPpvClick] Click successful.');
    console.log(`[handleNoPpvClick] Navigated to: ${page.url()}`);
    
    // Step 7: Mark the business flow event flags
    eventData.SUBSCRIBE_WITHOUT_PPV = 'true';
    eventData['SUBSCRIBE_WITHOUT_PPV'] = 'true';
    process.env.SUBSCRIBE_WITHOUT_PPV = 'true';
    
    return true;
  } else {
    console.log(`⚠️ [handleNoPpvClick] Navigated to unexpected URL: ${page.url()}`);
    process.env.SUBSCRIBE_WITHOUT_PPV_ACTIVE = 'false';
    return false;
  }
}